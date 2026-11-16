import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El orden de dos lineas, y el acceso de soporte seguia caido (#109).
 *
 * Las funciones validaban primero que el actor fuera SUPERADMIN y recien
 * despues declaraban quien era la sesion. Pero `assert_platform_superadmin`
 * lee `users`, que tiene RLS FORCE con la politica `id = app_user_id() OR ...`:
 * sin declarar antes la sesion, ese SELECT no ve NI SU PROPIA FILA, el assert
 * concluye que no es superadmin y levanta 42501 contra un superadmin legitimo.
 *
 * Declarar la identidad no concede nada: `set_config` solo dice quien dice ser
 * la sesion, y la unica fila que eso desbloquea es la del propio usuario, que
 * es justo la que el assert necesita mirar para decidir. La autorizacion sigue
 * siendo la misma linea de siempre, dos renglones mas abajo.
 */
export class SoporteDeclaraQuienEsAntes1727740800000 implements MigrationInterface {
  name = 'SoporteDeclaraQuienEsAntes1727740800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_open_support_access(
        actor_id uuid,
        target_tenant_id uuid,
        motivo text,
        minutos integer
      )
      RETURNS TABLE (
        id uuid,
        tenant_id uuid,
        tenant_name text,
        reason text,
        started_at timestamptz,
        expires_at timestamptz
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        nombre text;
        creado public.support_access_log;
      BEGIN
        PERFORM set_config('app.user_id', actor_id::text, true);
        PERFORM public.assert_platform_superadmin(actor_id);

        SELECT tenant.display_name INTO nombre
          FROM public.tenants tenant WHERE tenant.id = target_tenant_id;
        IF nombre IS NULL THEN
          RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'no_data_found';
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.support_access_log a
          WHERE a.tenant_id = target_tenant_id
            AND a.superadmin_user_id = actor_id
            AND a.ended_at IS NULL
            AND a.expires_at > now()
        ) THEN
          RAISE EXCEPTION 'support access already open' USING ERRCODE = 'unique_violation';
        END IF;

        INSERT INTO public.support_access_log (tenant_id, superadmin_user_id, reason, expires_at)
        VALUES (target_tenant_id, actor_id, motivo, now() + make_interval(mins => minutos))
        RETURNING * INTO creado;

        RETURN QUERY SELECT creado.id, creado.tenant_id, nombre, creado.reason,
                            creado.started_at, creado.expires_at;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_close_support_access(actor_id uuid, access_id uuid)
      RETURNS TABLE (id uuid, tenant_id uuid)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        PERFORM set_config('app.user_id', actor_id::text, true);
        PERFORM public.assert_platform_superadmin(actor_id);
        RETURN QUERY
        UPDATE public.support_access_log a SET ended_at = now()
         WHERE a.id = access_id AND a.superadmin_user_id = actor_id AND a.ended_at IS NULL
        RETURNING a.id, a.tenant_id;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_active_support_access(actor_id uuid)
      RETURNS TABLE (
        id uuid,
        tenant_id uuid,
        tenant_name text,
        reason text,
        started_at timestamptz,
        expires_at timestamptz
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        PERFORM set_config('app.user_id', actor_id::text, true);
        PERFORM public.assert_platform_superadmin(actor_id);
        RETURN QUERY
        SELECT a.id, a.tenant_id, tenant.display_name, a.reason, a.started_at, a.expires_at
          FROM public.support_access_log a
          JOIN public.tenants tenant ON tenant.id = a.tenant_id
         WHERE a.superadmin_user_id = actor_id
           AND a.ended_at IS NULL
           AND a.expires_at > now()
         ORDER BY a.started_at DESC;
      END
      $$
    `);
  }

  public async down(): Promise<void> {
    // Sin vuelta atras: revertir seria volver a dejar el mecanismo caido.
  }
}
