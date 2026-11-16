import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El acceso de soporte auditado (#109) existia y no se podia usar.
 *
 * `SupportAccessService` abria la ventana con SELECT y INSERT pelados sobre
 * `tenants` y `support_access_log`, dos tablas con RLS FORCE. La API se conecta
 * como `sentrycore_app`, que esta sujeto a esas politicas y —sin contexto de
 * empresa, que es justamente la situacion del SUPERADMIN— no ve ninguna fila:
 * abrir un acceso respondia "La empresa no existe" y cerrar uno respondia que
 * no habia ninguno abierto.
 *
 * Se resuelve como el resto de /platform: funciones SECURITY DEFINER que
 * empiezan validando que el actor es SUPERADMIN. La alternativa —darle
 * BYPASSRLS al rol de la aplicacion— dejaria a toda la API leyendo cualquier
 * empresa para siempre, que es exactamente lo que la RLS de este producto
 * existe para impedir.
 *
 * El registro no cambia: sigue exigiendo motivo escrito, sigue venciendo solo,
 * y el ADMIN del tenant lo sigue leyendo. Lo que cambia es que ahora ocurre.
 */
export class AccesoDeSoporteAlcanzable1727733600000 implements MigrationInterface {
  name = 'AccesoDeSoporteAlcanzable1727733600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION platform_open_support_access(
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

        SELECT tenant.display_name INTO nombre
          FROM public.tenants tenant WHERE tenant.id = target_tenant_id;
        IF nombre IS NULL THEN
          RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'no_data_found';
        END IF;

        -- Una sola ventana abierta por superadmin y empresa. Es del dominio y
        -- no de la capa de arriba: dos ventanas simultaneas harian que cerrar
        -- una deje la otra viva, y el registro diria que ya nadie esta mirando.
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
      CREATE FUNCTION platform_close_support_access(actor_id uuid, access_id uuid)
      RETURNS TABLE (id uuid, tenant_id uuid)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        PERFORM public.assert_platform_superadmin(actor_id);
        -- Solo la PROPIA ventana y solo si sigue abierta: cerrar la de otro
        -- superadmin dejaria creer que ya nadie mira los datos del cliente.
        RETURN QUERY
        UPDATE public.support_access_log a SET ended_at = now()
         WHERE a.id = access_id AND a.superadmin_user_id = actor_id AND a.ended_at IS NULL
        RETURNING a.id, a.tenant_id;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE FUNCTION platform_active_support_access(actor_id uuid)
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
      CREATE FUNCTION platform_resolve_support_access(access_id uuid, actor_id uuid)
      RETURNS uuid
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        destino uuid;
      BEGIN
        -- La usa el interceptor en CADA peticion con la cabecera: tiene que ser
        -- barata y no puede confiar en el contexto, porque su trabajo es
        -- decidir cual va a ser. Sin assert de superadmin: filtra por el dueño
        -- de la ventana, que es una condicion mas estrecha.
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

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentrycore_app') THEN
          REVOKE ALL ON FUNCTION platform_open_support_access(uuid, uuid, text, integer) FROM PUBLIC;
          REVOKE ALL ON FUNCTION platform_close_support_access(uuid, uuid) FROM PUBLIC;
          REVOKE ALL ON FUNCTION platform_active_support_access(uuid) FROM PUBLIC;
          REVOKE ALL ON FUNCTION platform_resolve_support_access(uuid, uuid) FROM PUBLIC;
          GRANT EXECUTE ON FUNCTION platform_open_support_access(uuid, uuid, text, integer) TO sentrycore_app;
          GRANT EXECUTE ON FUNCTION platform_close_support_access(uuid, uuid) TO sentrycore_app;
          GRANT EXECUTE ON FUNCTION platform_active_support_access(uuid) TO sentrycore_app;
          GRANT EXECUTE ON FUNCTION platform_resolve_support_access(uuid, uuid) TO sentrycore_app;
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION platform_resolve_support_access(uuid, uuid)`);
    await queryRunner.query(`DROP FUNCTION platform_active_support_access(uuid)`);
    await queryRunner.query(`DROP FUNCTION platform_close_support_access(uuid, uuid)`);
    await queryRunner.query(
      `DROP FUNCTION platform_open_support_access(uuid, uuid, text, integer)`,
    );
  }
}
