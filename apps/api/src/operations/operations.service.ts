import type { PatrolRules } from '@sentrycore/shared';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { RulesService } from '../rules/rules.service';
import { MailSettingsDto, OperationsQuery } from './operations.dto';
type Actor = Pick<AuthenticatedUser, 'sub' | 'role'>;
@Injectable()
export class OperationsService {
    constructor(private readonly ctx: TenantContextService, private readonly rules: RulesService) { }
    async sites(actor: Actor) { return this.ctx.manager.query(`SELECT id,name,branch_name AS "branchName",timezone FROM sites s WHERE is_active AND ($1::boolean OR EXISTS(SELECT 1 FROM supervisor_sites ss WHERE ss.site_id=s.id AND ss.supervisor_id=$2)) ORDER BY branch_name,name`, [actor.role === 'ADMIN', actor.sub]); }
    async site(siteId: string, actor: Actor) {
        const rows = await this.ctx.manager.query<Array<{
            id: string;
        }>>('SELECT id FROM sites WHERE id=$1', [siteId]);
        if (!rows.length)
            throw new NotFoundException('Recinto no disponible.');
        if (actor.role !== 'ADMIN') {
            const scope = await this.ctx.manager.query<Array<{
                site_id: string;
            }>>('SELECT site_id FROM supervisor_sites WHERE site_id=$1 AND supervisor_id=$2', [siteId, actor.sub]);
            if (!scope.length)
                throw new ForbiddenException('No tienes este recinto asignado.');
        }
    }
    async recent(query: OperationsQuery, actor: Actor) {
        if (query.from && query.to && new Date(query.from) > new Date(query.to))
            throw new BadRequestException('La fecha inicial debe ser anterior a la final.');
        if (query.siteId)
            await this.site(query.siteId, actor);
        const limit = query.limit ?? 50, offset = query.offset ?? 0;
        const rows = await this.ctx.manager.query<Array<{
            id: string;
        }>>(`SELECT p.id,p.site_id AS "siteId",s.name AS "siteName",s.branch_name AS "branchName",s.timezone,
    r.name AS "routeName",trim(u.given_name||' '||u.family_name) AS "guardName",p.status,p.scheduled_start_at AS "scheduledStartAt",p.started_at AS "startedAt",p.closed_at AS "closedAt",p.compliance_pct::float AS "compliancePct"
   FROM patrols p JOIN sites s ON s.id=p.site_id JOIN routes r ON r.id=p.route_id JOIN users u ON u.id=p.guard_id
   WHERE ($1::boolean OR EXISTS(SELECT 1 FROM supervisor_sites ss WHERE ss.site_id=p.site_id AND ss.supervisor_id=$2))
    AND ($3::uuid IS NULL OR p.site_id=$3)
    AND ($4::text IS NULL OR p.scheduled_start_at >= CASE WHEN length($4::text)=10 THEN ($4::date::timestamp AT TIME ZONE s.timezone) ELSE $4::timestamptz END)
    AND ($5::text IS NULL OR p.scheduled_start_at < CASE WHEN length($5::text)=10 THEN (($5::date+1)::timestamp AT TIME ZONE s.timezone) ELSE $5::timestamptz END)
   ORDER BY p.scheduled_start_at DESC,p.id DESC LIMIT $6 OFFSET $7`, [actor.role === 'ADMIN', actor.sub, query.siteId ?? null, query.from ?? null, query.to ?? null, limit + 1, offset]);
        return { patrols: rows.slice(0, limit), hasMore: rows.length > limit, nextOffset: offset + limit };
    }
    async recipients(siteId: string, actor: Actor) { await this.site(siteId, actor); const rules = await this.rules.effective({ siteId }); return this.mailSettings(siteId, rules); }
    private mailSettings(siteId: string, rules: PatrolRules) { return { siteId, recipients: rules.reportRecipients, onlyBelowThreshold: rules.reportOnlyBelowThreshold,
            threshold: rules.complianceThreshold, hour: rules.reportDigestHour,
            dailyEnabled: rules.reportDailyEnabled, weeklyEnabled: rules.reportWeeklyEnabled, monthlyEnabled: rules.reportMonthlyEnabled,
            dailyRecipients: rules.reportDailyRecipients, weeklyRecipients: rules.reportWeeklyRecipients, monthlyRecipients: rules.reportMonthlyRecipients }; }
    async setRecipients(siteId: string, recipients: string[], actor: Actor, options?: MailSettingsDto) {
        await this.site(siteId, actor);
        await this.ctx.manager.query('SELECT id FROM sites WHERE id=$1 FOR UPDATE', [siteId]);
        const previous = await this.ctx.manager.query<Array<{
            overrides: Record<string, unknown>;
        }>>('SELECT overrides FROM site_rules WHERE site_id=$1 FOR UPDATE', [siteId]);
        const normalize = (values: string[]) => [...new Set(values.map(v => v.trim().toLowerCase()))];
        const patch: Record<string, unknown> = { reportRecipients: normalize(recipients) };
        if (options) {
            const mapping = {onlyBelowThreshold:'reportOnlyBelowThreshold',threshold:'complianceThreshold',hour:'reportDigestHour',
                dailyEnabled:'reportDailyEnabled',weeklyEnabled:'reportWeeklyEnabled',monthlyEnabled:'reportMonthlyEnabled',
                dailyRecipients:'reportDailyRecipients',weeklyRecipients:'reportWeeklyRecipients',monthlyRecipients:'reportMonthlyRecipients'} as const;
            for (const [field, rule] of Object.entries(mapping)) {
                const value = options[field as keyof typeof mapping];
                if (value !== undefined) patch[rule] = Array.isArray(value) ? normalize(value) : value;
            }
            const effective = {...await this.rules.effective({siteId}), ...patch};
            for (const frequency of ['Daily','Weekly','Monthly'] as const) {
                const list = effective[`report${frequency}Recipients`] as string[];
                if (effective[`report${frequency}Enabled`] && !list.length && !recipients.length)
                    throw new BadRequestException('Cada resumen activo necesita destinatarios propios o una lista común.');
            }
        }
        const saved = await this.rules.updateSiteOverrides(siteId, { ...(previous[0]?.overrides ?? {}), ...patch }, actor.sub);
        return this.mailSettings(siteId, saved.effective);
    }
    async guards(actor: Actor) {
        return this.ctx.manager.query(`SELECT u.id,u.given_name AS "givenName",u.family_name AS "familyName",u.is_active AS "isActive",(g.user_id IS NOT NULL) AS "hasRut"
  FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN guard_personal_data g ON g.user_id=u.id
  WHERE m.role_key='GUARDIA' AND ($1::boolean OR EXISTS(SELECT 1 FROM guard_sites gs JOIN supervisor_sites ss ON ss.site_id=gs.site_id WHERE gs.guard_id=u.id AND ss.supervisor_id=$2)) ORDER BY u.family_name,u.given_name`, [actor.role === 'ADMIN', actor.sub]);
    }
}
