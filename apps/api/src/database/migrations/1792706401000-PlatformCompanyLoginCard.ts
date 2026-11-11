import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformCompanyLoginCard1792706401000 implements MigrationInterface {
  name = 'PlatformCompanyLoginCard1792706401000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_action_check`);
    await runner.query(`ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_action_check
      CHECK (action IN ('tenant.created', 'tenant.suspended', 'tenant.reactivated', 'tenant.company_card_updated'))`);
    await runner.query(`CREATE FUNCTION platform_get_company_card(actor_id uuid, target_tenant_id uuid)
      RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE card text;
      BEGIN
        PERFORM public.assert_platform_superadmin(actor_id);
        SELECT login_card_uid INTO card FROM public.tenants WHERE id = target_tenant_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'P0002'; END IF;
        RETURN card;
      END $$`);
    await runner.query(`CREATE FUNCTION platform_set_company_card(actor_id uuid, target_tenant_id uuid, card_uid text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        PERFORM public.assert_platform_superadmin(actor_id);
        UPDATE public.tenants SET login_card_uid = NULLIF(card_uid, ''), login_card_updated_at = now()
        WHERE id = target_tenant_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'P0002'; END IF;
        INSERT INTO public.platform_audit_log(tenant_id, actor_user_id, action)
          VALUES (target_tenant_id, actor_id, 'tenant.company_card_updated');
      END $$`);
    for (const signature of ['platform_get_company_card(uuid, uuid)', 'platform_set_company_card(uuid, uuid, text)']) {
      await runner.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
      await runner.query(`GRANT EXECUTE ON FUNCTION ${signature} TO sentrycore_app`);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP FUNCTION platform_get_company_card(uuid, uuid)');
    await runner.query('DROP FUNCTION platform_set_company_card(uuid, uuid, text)');
    // Audit history is append-only; retain its expanded action constraint.
  }
}
