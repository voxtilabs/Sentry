import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { filasDe } from '../consent/sql-result';

export interface OpenSupportAccessInput {
  readonly tenantId: string;
  readonly reason: string;
  readonly minutes?: number;
}

/**
 * Acceso de soporte del SUPERADMIN a un tenant. Ver issue #109.
 *
 * El mecanismo existia en la base desde la migracion de RLS —
 * `app_has_audited_support_access()` y `support_access_log`— pero estaba MUERTO:
 * nada seteaba `app.support_access_id`, asi que la funcion siempre devolvia
 * false. Esto lo activa.
 *
 * Por que asi y no dandole al SUPERADMIN un rol con BYPASSRLS: un bypass no deja
 * rastro y no caduca. Aca cada entrada a los datos de una empresa exige un
 * motivo escrito, vence sola, y queda registrada en una tabla que el propio
 * ADMIN del tenant puede leer. El soporte que mira tus datos sin que lo sepas es
 * exactamente lo que un cliente de seguridad privada no puede aceptar.
 *
 * Corre FUERA del contexto de tenant (el SUPERADMIN no tiene uno), asi que usa
 * el DataSource directo en vez de TenantContextService.
 */
@Injectable()
export class SupportAccessService {
  constructor(private readonly dataSource: DataSource) {}

  private async assertSuperadmin(userId: string) {
    const filas = await this.dataSource.query(
      `SELECT 1 FROM platform_memberships
       WHERE user_id = $1 AND role_key = 'SUPERADMIN'`,
      [userId],
    );
    if (!filas.length) throw new ForbiddenException('Solo el SUPERADMIN abre accesos de soporte');
  }

  /** Abre una ventana de acceso con motivo y vencimiento. */
  async open(superadminId: string, input: OpenSupportAccessInput) {
    await this.assertSuperadmin(superadminId);

    const motivo = input.reason.trim();
    if (motivo.length < 10) {
      throw new BadRequestException('El motivo debe explicar el acceso (mínimo 10 caracteres)');
    }
    // Techo duro: una ventana de soporte no es una sesion permanente.
    const minutos = Math.min(Math.max(input.minutes ?? 60, 5), 8 * 60);

    /*
     * Por funcion y no con SELECT/INSERT pelados: `tenants` y
     * `support_access_log` llevan RLS FORCE y la API se conecta con un rol
     * sujeto a ella. Sin contexto de empresa —que es la situacion del
     * SUPERADMIN, por definicion— no veia ni una fila: abrir respondia "La
     * empresa no existe" y el mecanismo entero estaba muerto.
     */
    let filas: Array<{
      id: string;
      tenant_id: string;
      tenant_name: string;
      reason: string;
      started_at: string;
      expires_at: string;
    }>;
    try {
      filas = await this.dataSource.query(
        `SELECT * FROM platform_open_support_access($1::uuid, $2::uuid, $3, $4)`,
        [superadminId, input.tenantId, motivo, minutos],
      );
    } catch (error) {
      const codigo = (error as { code?: string })?.code;
      if (codigo === 'P0002' || codigo === '02000') throw new NotFoundException('La empresa no existe');
      if (codigo === '23505') {
        throw new ConflictException('Ya tienes un acceso de soporte abierto a esta empresa');
      }
      throw error;
    }

    const creado = filas[0];
    if (!creado) throw new NotFoundException('La empresa no existe');

    return {
      supportAccessId: creado.id,
      tenantId: creado.tenant_id,
      tenantName: creado.tenant_name,
      reason: creado.reason,
      startedAt: creado.started_at,
      expiresAt: creado.expires_at,
    };
  }

  /** Cierra la ventana antes de que venza. */
  async close(superadminId: string, supportAccessId: string) {
    await this.assertSuperadmin(superadminId);
    /*
     * `filasDe` porque la funcion devuelve el RETURNING de un UPDATE: cerrar un
     * acceso inexistente —o el de OTRO superadmin— tiene que ser 404 y no un
     * 200 con `tenantId: undefined`. En una ventana de soporte el cierre falso
     * es peor que el error: deja creer que ya nadie mira los datos del cliente.
     */
    const filas = filasDe<{ id: string; tenant_id: string }>(
      await this.dataSource.query(
        `SELECT * FROM platform_close_support_access($1::uuid, $2::uuid)`,
        [superadminId, supportAccessId],
      ),
    );
    if (!filas.length) throw new NotFoundException('No hay un acceso abierto con ese id');
    return { supportAccessId, tenantId: filas[0]!.tenant_id, closed: true };
  }

  /** Accesos vigentes del SUPERADMIN, para saber qué tiene abierto. */
  async active(superadminId: string) {
    await this.assertSuperadmin(superadminId);
    const filas = await this.dataSource.query(
      `SELECT * FROM platform_active_support_access($1::uuid)`,
      [superadminId],
    );
    return filas.map((f: Record<string, unknown>) => ({
      supportAccessId: f.id,
      tenantId: f.tenant_id,
      tenantName: f.tenant_name,
      reason: f.reason,
      startedAt: f.started_at,
      expiresAt: f.expires_at,
    }));
  }

  /**
   * Valida que el acceso siga vigente y devuelve su tenant. Lo usa el
   * interceptor antes de abrir la transaccion con contexto de soporte.
   */
  async resolve(supportAccessId: string, userId: string) {
    const filas = await this.dataSource.query(
      `SELECT platform_resolve_support_access($1::uuid, $2::uuid) AS tenant_id`,
      [supportAccessId, userId],
    );
    return filas.length ? ((filas[0].tenant_id as string | null) ?? null) : null;
  }

}
