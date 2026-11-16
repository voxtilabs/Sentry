import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyAccessCode1793827200000 implements MigrationInterface {
  name = 'CompanyAccessCode1793827200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE tenants
      ADD COLUMN login_access_code_hash text,
      ADD COLUMN login_access_code_updated_at timestamptz,
      ADD CONSTRAINT tenant_access_code_hash_check CHECK
        (login_access_code_hash IS NULL OR login_access_code_hash ~ '^[0-9a-f]{64}$')`);
    await runner.query(`CREATE UNIQUE INDEX tenant_access_code_hash_uniq
      ON tenants(login_access_code_hash) WHERE login_access_code_hash IS NOT NULL`);
    await runner.query(`CREATE FUNCTION authenticate_company_code(code_lookup text)
      RETURNS TABLE (user_id uuid, password_hash text, tenant_id uuid, tenant_name text,
        tenant_status text, role_key text, is_platform_role boolean,
        max_failed_attempts integer, window_seconds integer, base_lock_seconds integer,
        max_lock_seconds integer, nfc_pin_hash text, tenant_slug text, guard_name text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT u.id, ''::text, t.id, t.display_name, t.status, m.role_key,
          false, 10, 900, 60, 900, NULL::text, t.slug,
          trim(u.given_name || ' ' || u.family_name)
        FROM public.tenants t
        JOIN public.memberships m ON m.tenant_id=t.id AND m.role_key='GUARDIA'
        JOIN public.users u ON u.id=m.user_id AND u.is_active
        WHERE t.login_access_code_hash=code_lookup AND t.status='active'
        ORDER BY u.given_name,u.family_name,u.id
      $$`);
    await runner.query(`ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_action_check`);
    await runner.query(`ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_action_check
      CHECK (action IN ('tenant.created','tenant.suspended','tenant.reactivated',
        'tenant.company_card_updated','tenant.company_code_updated'))`);
    await runner.query(`CREATE FUNCTION platform_company_code_status(actor_id uuid, target_tenant_id uuid)
      RETURNS TABLE(configured boolean, updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      BEGIN
        PERFORM public.assert_platform_superadmin(actor_id);
        RETURN QUERY SELECT login_access_code_hash IS NOT NULL, login_access_code_updated_at
          FROM public.tenants WHERE id=target_tenant_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE='P0002'; END IF;
      END $$`);
    await runner.query(`CREATE FUNCTION platform_set_company_code(actor_id uuid, target_tenant_id uuid, code_lookup text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      BEGIN
        PERFORM public.assert_platform_superadmin(actor_id);
        UPDATE public.tenants SET login_access_code_hash=code_lookup, login_access_code_updated_at=now()
          WHERE id=target_tenant_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE='P0002'; END IF;
        INSERT INTO public.platform_audit_log(tenant_id,actor_user_id,action)
          VALUES(target_tenant_id,actor_id,'tenant.company_code_updated');
      END $$`);
    for (const signature of ['authenticate_company_code(text)', 'platform_company_code_status(uuid,uuid)',
      'platform_set_company_code(uuid,uuid,text)']) {
      await runner.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
      await runner.query(`GRANT EXECUTE ON FUNCTION ${signature} TO sentrycore_app`);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP FUNCTION authenticate_company_code(text)');
    await runner.query('DROP FUNCTION platform_company_code_status(uuid,uuid)');
    await runner.query('DROP FUNCTION platform_set_company_code(uuid,uuid,text)');
    await runner.query('DROP INDEX tenant_access_code_hash_uniq');
    await runner.query('ALTER TABLE tenants DROP COLUMN login_access_code_hash, DROP COLUMN login_access_code_updated_at');
    // Conservar la acción de auditoría: el historial es append-only.
  }
}
