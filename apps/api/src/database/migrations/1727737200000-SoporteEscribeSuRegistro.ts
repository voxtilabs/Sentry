import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El registro de acceso de soporte no se podia ESCRIBIR (#109).
 *
 * `support_access_log` tiene RLS FORCE y una sola politica, `FOR SELECT`. Con
 * RLS activa y sin politica de escritura, PostgreSQL rechaza todo INSERT y todo
 * UPDATE con 42501 —incluido el del dueño de la tabla, que es lo que significa
 * FORCE—. O sea que abrir una ventana de soporte era imposible por tercera vez
 * seguida, ahora desde el almacenamiento: primero faltaba el decorador, despues
 * salir de la RLS para leer, y debajo de todo esto.
 *
 * Las politicas nuevas dicen la regla que ya estaba en el servicio: cada
 * superadmin escribe y cierra SU ventana, no la de otro. Y las funciones de
 * plataforma declaran localmente de quien es la sesion antes de escribir —lo
 * hacen DESPUES de validar que es SUPERADMIN, asi que no se concede nada que no
 * estuviera ya concedido—.
 *
 * `set_config(..., true)` es local a la transaccion: en estas llamadas, que son
 * una sentencia suelta, se descarta al terminar y no deja contexto pegado en la
 * conexion del pool.
 */
export class SoporteEscribeSuRegistro1727737200000 implements MigrationInterface {
  name = 'SoporteEscribeSuRegistro1727737200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY support_access_superadmin_abre ON support_access_log
      FOR INSERT
      WITH CHECK (superadmin_user_id = app_user_id())
    `);

    await queryRunner.query(`
      CREATE POLICY support_access_superadmin_cierra ON support_access_log
      FOR UPDATE
      USING (superadmin_user_id = app_user_id())
      WITH CHECK (superadmin_user_id = app_user_id())
    `);

    // Las cuatro funciones pasan a declarar la sesion antes de tocar la tabla.
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
        PERFORM public.assert_platform_superadmin(actor_id);
        PERFORM set_config('app.user_id', actor_id::text, true);

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
        PERFORM public.assert_platform_superadmin(actor_id);
        PERFORM set_config('app.user_id', actor_id::text, true);
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
        PERFORM public.assert_platform_superadmin(actor_id);
        PERFORM set_config('app.user_id', actor_id::text, true);
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

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_resolve_support_access(access_id uuid, actor_id uuid)
      RETURNS uuid
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        destino uuid;
      BEGIN
        PERFORM set_config('app.user_id', actor_id::text, true);
        SELECT a.tenant_id INTO destino
          FROM public.support_access_log a
         WHERE a.id = access_id
           AND a.superadmin_user_id = actor_id
           AND a.ended_at IS NULL
           AND a.started_at <= now()
           AND a.expires_at > now();
        RETURN destino;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY support_access_superadmin_cierra ON support_access_log`);
    await queryRunner.query(`DROP POLICY support_access_superadmin_abre ON support_access_log`);
  }
}
