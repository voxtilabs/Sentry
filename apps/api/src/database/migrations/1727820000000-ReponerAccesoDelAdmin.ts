import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reponer el acceso del ADMIN de una empresa cuando su correo no sirve.
 *
 * El caso real que lo pide: `prueba-terreno` se dio de alta con
 * `admin@prueba-terreno.cl`, un dominio que no existe. La invitacion nunca
 * llego, la clave nunca se definio, y la recuperacion de contraseña iria al
 * mismo buzon muerto. La empresa quedo sin administrador y no hay forma de
 * entrar: el aprovisionamiento siembra una clave aleatoria que NADIE conoce, a
 * proposito.
 *
 * Eso ultimo no se toca. La plataforma sigue sin poder entrar como el
 * administrador de un cliente, que es la propiedad que de verdad importa: esta
 * funcion no devuelve ninguna clave ni la fija. Lo unico que hace es mover la
 * invitacion a una direccion que si recibe, para que la persona defina SU clave.
 *
 * Por que SECURITY DEFINER, como el resto de /platform: `users`, `memberships`
 * y `auth_action_tokens` llevan RLS y el SUPERADMIN no tiene contexto de
 * empresa. Y empieza declarando la sesion ANTES del assert porque el assert lee
 * `users`, que se filtra por `app_user_id()` (ver 1727740800000).
 */
export class ReponerAccesoDelAdmin1727820000000 implements MigrationInterface {
  name = 'ReponerAccesoDelAdmin1727820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION platform_reponer_admin(
        actor_id uuid,
        target_tenant_id uuid,
        correo_nuevo citext,
        token_hash text,
        vence_en timestamptz
      )
      RETURNS TABLE (user_id uuid, email citext, tenant_name text)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        admin_id uuid;
        nombre text;
      BEGIN
        PERFORM set_config('app.user_id', actor_id::text, true);
        PERFORM public.assert_platform_superadmin(actor_id);

        SELECT tenant.display_name INTO nombre
          FROM public.tenants tenant WHERE tenant.id = target_tenant_id;
        IF nombre IS NULL THEN
          RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'no_data_found';
        END IF;

        /*
         * El ADMIN mas antiguo de la empresa: el que creo el aprovisionamiento.
         * Si hubiera varios, reponer el acceso del primero es lo predecible;
         * los demas los administra el propio cliente.
         */
        SELECT m.user_id INTO admin_id
          FROM public.memberships m
          JOIN public.users u ON u.id = m.user_id
         WHERE m.tenant_id = target_tenant_id
           AND m.role_key = 'ADMIN'
         ORDER BY u.created_at
         LIMIT 1;

        IF admin_id IS NULL THEN
          RAISE EXCEPTION 'tenant has no admin' USING ERRCODE = 'no_data_found';
        END IF;

        -- El correo se mueve a uno que reciba. La clave NO se toca: sigue
        -- siendo la aleatoria que nadie conoce hasta que la persona entre por
        -- la invitacion y defina la suya.
        UPDATE public.users SET email = correo_nuevo WHERE id = admin_id;

        /*
         * El token sale por la misma puerta que el del alta: issue_auth_action_token
         * ya valida formato y vigencia, ya exige que el usuario tenga membresia en
         * esa empresa, y ya quema las invitaciones anteriores. Duplicar aqui el
         * INSERT seria otra copia que se desincroniza sola.
         */
        PERFORM public.issue_auth_action_token(
          admin_id, target_tenant_id, 'invitation', token_hash, vence_en
        );

        RETURN QUERY SELECT admin_id, correo_nuevo, nombre;
      END
      $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentrycore_app') THEN
          REVOKE ALL ON FUNCTION platform_reponer_admin(uuid, uuid, citext, text, timestamptz) FROM PUBLIC;
          GRANT EXECUTE ON FUNCTION platform_reponer_admin(uuid, uuid, citext, text, timestamptz) TO sentrycore_app;
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION platform_reponer_admin(uuid, uuid, citext, text, timestamptz)`,
    );
  }
}
