import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { hasPermission, ROLES, type Permission, type Role } from '@sentrycore/shared';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { IS_PUBLIC } from './decorators/public.decorator';
import { AUTH_REDIS } from './redis.provider';
import { REQUIRED_PERMISSIONS } from './decorators/permissions.decorator';
import { REQUIRES_TENANT } from './decorators/tenant-scope.decorator';
import { requestLogContext } from '../observability/request-context';
import { elSoporteLoPuedeLeer } from './soporte-lectura';

export interface AuthenticatedUser {
  sub: string;
  tenant_id: string | null;
  role: Role;
  sid: string;
}

interface AuthenticatedRequest extends Request {
  cookies: Record<string, string>;
  user?: AuthenticatedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  /*
   * La ventana de soporte se resuelve con una consulta directa y no inyectando
   * `SupportAccessService`: ese servicio vive en un modulo que importa este, y
   * meterlo aca cierra un ciclo de dependencias que cuelga el arranque entero
   * de Nest —la prueba de arranque se queda esperando para siempre—. La funcion
   * es la MISMA que usa el servicio, asi que la regla sigue viviendo en un solo
   * lugar: la base.
   */
  private async ventanaDeSoporte(accessId: string, userId: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(accessId)) return null;
    try {
      const filas = await this.dataSource.query<Array<{ tenant_id: string | null }>>(
        `SELECT platform_resolve_support_access($1::uuid, $2::uuid) AS tenant_id`,
        [accessId, userId],
      );
      return filas[0]?.tenant_id ?? null;
    } catch {
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (!requiredPermissions?.length) {
      this.auditDenied(context, 'missing_authorization_metadata');
      throw new ForbiddenException('Endpoint cerrado por defecto');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Se requiere autenticación');

    let payload: AuthenticatedUser;
    try {
      payload = await this.jwt.verifyAsync<AuthenticatedUser>(token, {
        algorithms: ['HS256'],
        issuer: 'sentrycore-api',
        audience: 'sentrycore-clients',
      });
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    const porSuRol =
      ROLES.includes(payload.role) &&
      requiredPermissions.every((permission) => hasPermission(payload.role, permission));

    /*
     * La ventana de soporte auditada (#109) es la UNICA forma de que esto sea
     * cierto sin que lo sea por el rol. Ver `soporte-lectura.ts`: solo
     * SUPERADMIN, solo GET, solo cuatro permisos de lectura y solo con una
     * ventana vigente que el ADMIN de esa empresa puede leer en su registro.
     *
     * Se resuelve DESPUES de comprobar el rol para no ir a la base en el camino
     * normal, que es el de todas las peticiones del producto.
     */
    let tenantDeSoporte: string | null = null;
    if (!porSuRol) {
      const cabecera = request.headers?.['x-support-access-id'];
      if (typeof cabecera === 'string' && cabecera.length > 0) {
        tenantDeSoporte = await this.ventanaDeSoporte(cabecera, payload.sub);
      }
    }

    const porSoporte =
      !porSuRol &&
      elSoporteLoPuedeLeer({
        role: payload.role,
        metodo: request.method,
        tenantDeLaVentana: tenantDeSoporte,
        permisosExigidos: requiredPermissions,
      });

    if (!porSuRol && !porSoporte) {
      this.auditDenied(context, 'permission_forbidden', payload);
      throw new ForbiddenException('No tienes permiso para esta operación');
    }

    if (porSoporte) {
      // Que la ventana exista queda en `support_access_log`; esto deja ademas
      // QUE se miro, que es lo que convierte el registro en algo revisable.
      this.logger.log(
        JSON.stringify({
          event: 'soporte_leyendo_empresa',
          tenant_id: tenantDeSoporte,
          path: request.url?.split('?')[0],
        }),
      );
    }

    if (await this.redis.exists(`auth:revoked-family:${payload.sid}`)) {
      this.auditDenied(context, 'revoked_session', payload);
      throw new UnauthorizedException('La sesión ya no está activa');
    }
    const sessionKey = `auth:session:${payload.sid}`;
    const serializedSession = await this.redis.get(sessionKey);
    if (serializedSession) {
      try {
        const session = JSON.parse(serializedSession) as Record<string, unknown>;
        session.lastUsedAt = new Date().toISOString();
        await this.redis.set(sessionKey, JSON.stringify(session), 'KEEPTTL');
      } catch {
        // Una metadata dañada no concede ni quita acceso; el JWT y la revocación mandan.
      }
    }

    const requiresTenant = this.reflector.getAllAndOverride<boolean>(REQUIRES_TENANT, targets);
    /*
     * La empresa de la ventana de soporte CUENTA como contexto de empresa: es
     * exactamente la que el interceptor va a poner en la transaccion. Sin esto,
     * el permiso se concedia y el endpoint moria un renglon mas abajo pidiendo
     * un tenant que el SUPERADMIN no tiene nunca — que es justo el caso que la
     * ventana viene a resolver.
     */
    if (requiresTenant && !payload.tenant_id && !tenantDeSoporte) {
      this.auditDenied(context, 'tenant_required', payload);
      throw new ForbiddenException('La operación requiere contexto de empresa');
    }

    if (payload.tenant_id) {
      const rows = await this.dataSource.query<Array<{ active: boolean }>>(
        `SELECT is_active_tenant_session($1, $2, $3) AS active`,
        [payload.sub, payload.tenant_id, payload.role],
      );
      if (!rows[0]?.active) {
        this.auditDenied(context, 'inactive_tenant_session', payload);
        throw new UnauthorizedException('La sesión ya no está activa');
      }
    }

    request.user = payload;
    requestLogContext.setTenant(payload.tenant_id);
    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | undefined {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
    return request.cookies?.sentrycore_access;
  }

  private auditDenied(
    context: ExecutionContext,
    reason: string,
    user?: AuthenticatedUser,
  ): void {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.logger.warn(
      JSON.stringify({
        event: 'authorization_denied',
        reason,
        tenant_id: user?.tenant_id ?? null,
        request_id: request.headers['x-request-id'] ?? null,
        method: request.method,
        path: request.path,
      }),
    );
  }
}
