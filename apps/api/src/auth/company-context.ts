import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import type { AuthIdentityRow } from './auth.types';

type Guard = AuthIdentityRow & { guard_name: string };
interface Context { tenantId: string; issuerId?: string; uid?: string; binding: string }
const ttl = 30 * 24 * 60 * 60;
const key = (token: string) => `auth:company-context:${createHash('sha256').update(token).digest('hex')}`;
const binding = (device: string) => createHash('sha256').update(device).digest('hex');

/** Company continuation grants only the guard picker, never panel permissions. */
export class CompanyContext {
  constructor(private readonly db: DataSource, private readonly redis: Redis) {}
  async issue(context: Omit<Context, 'binding'>, device: string) {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(key(token), JSON.stringify({ ...context, binding: binding(device) }), 'EX', ttl);
    return token;
  }
  async revoke(token?: string) { if (token) await this.redis.del(key(token)); }
  async guards(token: string | undefined, device: string): Promise<{ context: Context; guards: Guard[] }> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Selecciona una empresa');
    const raw = await this.redis.get(key(token));
    if (!raw) throw new UnauthorizedException('Vuelve a acercar la tarjeta de empresa');
    const context = JSON.parse(raw) as Context;
    if (context.binding !== binding(device)) throw new UnauthorizedException('Vuelve a identificar la empresa');
    const guards = context.uid
      ? await this.db.query<Guard[]>('SELECT * FROM authenticate_company_card($1)', [context.uid])
      : await this.tenantGuards(context.tenantId, context.issuerId!);
    const own = guards.filter(g => g.tenant_id === context.tenantId && g.role_key === 'GUARDIA');
    if (!own.length) throw new UnauthorizedException('Empresa sin guardias disponibles');
    return { context, guards: own };
  }
  async tenantGuards(tenantId: string, issuerId: string, endDay = false): Promise<Guard[]> {
    return this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const issuer = await manager.query(`SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id
        JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2
        AND m.role_key='GUARDIA' AND u.is_active AND t.status='active' FOR UPDATE OF m`, [tenantId, issuerId]);
      if (!issuer.length) throw new ForbiddenException('Guardia no disponible');
      if (endDay) {
        const active = await manager.query(`SELECT id FROM patrols WHERE tenant_id=$1 AND guard_id=$2 AND (status IN('en_curso','pausada') OR (status IN('completada','incompleta') AND NOT guard_flow_completed)) LIMIT 1`, [tenantId, issuerId]);
        if (active.length) throw new ConflictException('Termina la ronda activa antes de finalizar tu jornada.');
        await manager.query(`UPDATE shift_assignments SET status='cerrado', ended_at=now()
          WHERE tenant_id=$1 AND guard_id=$2 AND status='en_curso'`, [tenantId, issuerId]);
      }
      return manager.query<Guard[]>(`SELECT u.id AS user_id, ''::text AS password_hash,
        t.id AS tenant_id, t.display_name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status,
        m.role_key, false AS is_platform_role, NULL::text AS nfc_pin_hash,
        trim(u.given_name || ' ' || u.family_name) AS guard_name
        FROM tenants t JOIN memberships m ON m.tenant_id=t.id AND m.role_key='GUARDIA'
        JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE t.id=$1 AND t.status='active' ORDER BY u.given_name,u.family_name,u.id`, [tenantId]);
    });
  }
}
