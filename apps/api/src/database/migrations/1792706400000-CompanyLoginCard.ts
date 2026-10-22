import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyLoginCard1792706400000 implements MigrationInterface {
  name = 'CompanyLoginCard1792706400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tenants
      ADD COLUMN login_card_uid text,
      ADD COLUMN login_card_updated_at timestamptz,
      ADD CONSTRAINT tenant_login_card_uid_check CHECK
        (login_card_uid IS NULL OR login_card_uid ~ '^[0-9A-F]{4,64}$')`);
    await runner.query(`CREATE UNIQUE INDEX tenant_login_card_uid_uniq
      ON tenants(login_card_uid) WHERE login_card_uid IS NOT NULL`);
    // Prelogin lookup: a valid company card is the credential. No tenant from the client.
    await runner.query(`CREATE FUNCTION authenticate_company_card(card_uid text)
      RETURNS TABLE (user_id uuid, password_hash text, tenant_id uuid, tenant_name text,
        tenant_status text, role_key text, is_platform_role boolean,
        max_failed_attempts integer, window_seconds integer, base_lock_seconds integer,
        max_lock_seconds integer, nfc_pin_hash text, tenant_slug text, guard_name text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT u.id, ''::text, t.id, t.display_name, t.status, m.role_key,
          false, 10, 900, 60, 900, NULL::text, t.slug,
          trim(u.given_name || ' ' || u.family_name)
        FROM public.tenants t
        JOIN public.memberships m ON m.tenant_id = t.id AND m.role_key = 'GUARDIA'
        JOIN public.users u ON u.id = m.user_id AND u.is_active
        WHERE t.login_card_uid = card_uid AND t.status = 'active'
        ORDER BY u.given_name, u.family_name, u.id
      $$`);
    await runner.query('REVOKE ALL ON FUNCTION authenticate_company_card(text) FROM PUBLIC');
    await runner.query('GRANT EXECUTE ON FUNCTION authenticate_company_card(text) TO sentrycore_app');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP FUNCTION authenticate_company_card(text)');
    await runner.query('DROP INDEX tenant_login_card_uid_uniq');
    await runner.query('ALTER TABLE tenants DROP COLUMN login_card_uid, DROP COLUMN login_card_updated_at');
  }
}
