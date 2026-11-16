import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { RulesService } from '../rules/rules.service';
import type { PatrolRules } from '@sentrycore/shared';

export const DIGEST_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type DigestFrequency = typeof DIGEST_FREQUENCIES[number];
const SUFFIX = {daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly'} as const;
const UNIT = {daily: 'day', weekly: 'week', monthly: 'month'} as const;
const LABEL = {daily: 'diario', weekly: 'semanal', monthly: 'mensual'} as const;
interface Site {id: string; name: string; branch_name: string; timezone: string}
export interface DigestPeriod {start_at: Date; end_at: Date; label: string; due: boolean}
export interface DigestStats {total: number; closed: number; below: number; unknown: number; average: number | null; active: number}
interface Bucket {label: string; total: number; average: number | null}
export interface DigestSite {name: string; threshold: number; stats: DigestStats; buckets: Bucket[]}
interface Group {frequency: DigestFrequency; timezone: string; period: DigestPeriod; email: string; ready: boolean; sites: DigestSite[]}

/** Aggregates only: no guard names, IDs, RUT, GPS, answers, or photographs in email. */
export function digestText(frequency: DigestFrequency, period: string, sites: DigestSite[]): string {
  const total = sites.reduce((n,s) => n+s.stats.total,0);
  const closed = sites.reduce((n,s) => n+s.stats.closed,0);
  const below = sites.reduce((n,s) => n+s.stats.below,0);
  return [`SentryCore — Resumen ${LABEL[frequency]}`, `Período: ${period}`, '',
    `Rondas del período: ${total} · Cerradas: ${closed} · Bajo el mínimo: ${below}`, '',
    ...sites.flatMap(site => [
      `${site.name} · mínimo ${site.threshold}%`,
      `Rondas: ${site.stats.total} · Cerradas: ${site.stats.closed} · En curso/pausadas: ${site.stats.active}`,
      `Cumplimiento promedio de cerradas: ${site.stats.average === null ? 'sin datos' : `${site.stats.average}%`}`,
      `Bajo el mínimo: ${site.stats.below} · Cerradas sin medición: ${site.stats.unknown}`,
      ...site.buckets.map(b => `  ${b.label}: ${b.total} rondas · ${b.average === null ? 'sin medición' : `${b.average}% promedio de cerradas`}`), '',
    ]),
    'Las rondas se agrupan por su inicio programado, en la hora local del recinto. El mínimo es el configurado al generar este resumen. En el mensual, las semanas de los extremos incluyen solo los días del mes.',
    'Datos disponibles al generar el correo; las sincronizaciones posteriores se reflejan en el panel.',
    'Este correo resume el período; no contiene fotos ni información personal de guardias. Los informes completos siguen disponibles en el panel de SentryCore con acceso autorizado.',
  ].join('\n');
}

@Injectable()
export class ReportDigestService {
  constructor(private readonly ctx: TenantContextService, private readonly rules: RulesService, private readonly mail: MailQueueService) {}

  async period(frequency: DigestFrequency, timezone: string, hour: number, now: Date): Promise<DigestPeriod> {
    const [p] = await this.ctx.manager.query<DigestPeriod[]>(`WITH boundary AS (
      SELECT date_trunc($1, $2::timestamptz AT TIME ZONE $3) AS local_end
    ) SELECT (local_end - ('1 '||$1)::interval) AT TIME ZONE $3 AS start_at,
      local_end AT TIME ZONE $3 AS end_at,
      to_char(local_end - ('1 '||$1)::interval,'DD/MM/YYYY') || ' – ' || to_char(local_end - interval '1 day','DD/MM/YYYY') AS label,
      ($2::timestamptz AT TIME ZONE $3) >= local_end + make_interval(hours => $4) AS due FROM boundary`,
      [UNIT[frequency], now, timezone, hour]);
    if (!p) throw new Error('No se pudo resolver el período del resumen');
    return p;
  }

  async dispatch(tenantId: string, now = new Date()): Promise<{queued: number}> {
    const sites = await this.ctx.manager.query<Site[]>('SELECT id,name,branch_name,timezone FROM sites WHERE is_active ORDER BY branch_name,name,id');
    const groups = new Map<string,Group>();
    for (const site of sites) {
      const rules = await this.rules.effective({siteId: site.id});
      for (const frequency of DIGEST_FREQUENCIES) {
        const suffix = SUFFIX[frequency];
        if (!rules[`report${suffix}Enabled`]) continue;
        const recipients = this.recipients(rules, frequency);
        if (!recipients.length) continue;
        const period = await this.period(frequency, site.timezone, rules.reportDigestHour, now);
        // Read only once per site/frequency, regardless of recipient count.
        const stats = await this.stats(site.id, period, rules.complianceThreshold);
        const buckets = await this.buckets(site.id, period, frequency, site.timezone);
        for (const email of recipients) {
          const key = JSON.stringify([frequency,site.timezone,period.start_at,email]);
          let group = groups.get(key);
          if (!group) {group = {frequency,timezone:site.timezone,period,email,ready:true,sites:[]}; groups.set(key,group);}
          group.ready = group.ready && period.due;
          group.sites.push({name:`${site.name} (${site.branch_name})`,threshold:rules.complianceThreshold,stats,buckets});
        }
      }
    }
    let queued = 0;
    for (const group of groups.values()) {
      if (!group.ready) continue;
      const rows = await this.ctx.manager.query<Array<{tenant_id: string}>>(`INSERT INTO report_digest_deliveries
        (tenant_id,frequency,timezone,period_start,period_end,recipient_email) VALUES(app_tenant_id(),$1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING RETURNING tenant_id`, [group.frequency,group.timezone,group.period.start_at,group.period.end_at,group.email]);
      if (!rows.length) continue;
      const key = createHash('sha256').update(JSON.stringify([tenantId,group.frequency,group.timezone,group.period.start_at,group.email])).digest('hex');
      const result = await this.mail.enqueue({to:group.email,tenantId,
        template:{subject:'SentryCore · {{recintos}} · Resumen {{frecuencia}} · {{periodo}}',text:'{{contenido}}'},
        variables:{recintos:group.sites.map(s=>s.name).join(', ').slice(0,200),frecuencia:LABEL[group.frequency],periodo:group.period.label,
          contenido:digestText(group.frequency,group.period.label,group.sites)},
      },{idempotencyKey:`report-digest:${key}`});
      if (result.estado === 'encolado') queued++;
    }
    return {queued};
  }

  private recipients(rules: PatrolRules, frequency: DigestFrequency): string[] {
    const specific = rules[`report${SUFFIX[frequency]}Recipients`];
    return [...new Set((specific.length ? specific : rules.reportRecipients).map(r=>r.trim().toLowerCase()))];
  }
  private async stats(siteId: string, period: DigestPeriod, threshold: number): Promise<DigestStats> {
    const [stats] = await this.ctx.manager.query<DigestStats[]>(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE status IN ('completada','incompleta','vencida'))::int AS closed,
      count(*) FILTER(WHERE status IN ('completada','incompleta','vencida') AND compliance_pct < $4)::int AS below,
      count(*) FILTER(WHERE status IN ('completada','incompleta','vencida') AND compliance_pct IS NULL)::int AS unknown,
      round(avg(compliance_pct) FILTER(WHERE status IN ('completada','incompleta','vencida')))::int AS average,
      count(*) FILTER(WHERE status IN ('en_curso','pausada'))::int AS active
      FROM patrols WHERE site_id=$1 AND scheduled_start_at >= $2 AND scheduled_start_at < $3`,
      [siteId,period.start_at,period.end_at,threshold]);
    if (!stats) throw new Error('No se pudo calcular el resumen');
    return stats;
  }
  private async buckets(siteId: string, period: DigestPeriod, frequency: DigestFrequency, timezone: string): Promise<Bucket[]> {
    return this.ctx.manager.query<Bucket[]>(`SELECT CASE WHEN $4='week' THEN 'Semana del ' ELSE '' END || to_char(date_trunc($4,scheduled_start_at AT TIME ZONE $5),'DD/MM/YYYY') AS label,
      count(*)::int AS total, round(avg(compliance_pct) FILTER(WHERE status IN ('completada','incompleta','vencida')))::int AS average
      FROM patrols WHERE site_id=$1 AND scheduled_start_at >= $2 AND scheduled_start_at < $3 GROUP BY 1 ORDER BY min(scheduled_start_at)`,
      [siteId,period.start_at,period.end_at,frequency==='monthly'?'week':'day',timezone]);
  }
}
