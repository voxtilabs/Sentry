import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable deduplication survives Redis cleanup. No report contents are stored here. */
export class ReportDigestDeliveries1794862800000 implements MigrationInterface {
  name = 'ReportDigestDeliveries1794862800000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE report_dispatch_attempts DROP CONSTRAINT report_dispatch_attempts_reason_check');
    await q.query(`ALTER TABLE report_dispatch_attempts ADD CONSTRAINT report_dispatch_attempts_reason_check
      CHECK(reason IN ('envio_desactivado','sin_destinatarios','dominio_no_despachable','sobre_umbral'))`);
    await q.query(`CREATE TABLE report_digest_deliveries (
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
      timezone text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
      recipient_email text NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(),
      CHECK (period_end > period_start),
      PRIMARY KEY (tenant_id, frequency, timezone, period_start, recipient_email)
    )`);
    await q.query('ALTER TABLE report_digest_deliveries ENABLE ROW LEVEL SECURITY');
    await q.query('ALTER TABLE report_digest_deliveries FORCE ROW LEVEL SECURITY');
    await q.query(`CREATE POLICY report_digest_isolation ON report_digest_deliveries
      USING (tenant_id=app_tenant_id()) WITH CHECK (tenant_id=app_tenant_id())`);
    await q.query('REVOKE ALL ON report_digest_deliveries FROM PUBLIC');
    await q.query('REVOKE ALL ON report_digest_deliveries FROM sentrycore_app');
    await q.query('GRANT SELECT, INSERT ON report_digest_deliveries TO sentrycore_app');
    // Only identifiers, without tenant context. Jobs open their own RLS transaction.
    await q.query(`CREATE FUNCTION report_digest_tenants() RETURNS TABLE(tenant_id uuid)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        SELECT t.id FROM public.tenants t
        WHERE t.status='active' AND NULLIF(current_setting('app.tenant_id',true),'') IS NULL
        ORDER BY t.id
      $$`);
    await q.query('REVOKE ALL ON FUNCTION report_digest_tenants() FROM PUBLIC');
    await q.query('GRANT EXECUTE ON FUNCTION report_digest_tenants() TO sentrycore_app');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE report_dispatch_attempts SET reason='envio_desactivado' WHERE reason='sobre_umbral'");
    await q.query('ALTER TABLE report_dispatch_attempts DROP CONSTRAINT report_dispatch_attempts_reason_check');
    await q.query(`ALTER TABLE report_dispatch_attempts ADD CONSTRAINT report_dispatch_attempts_reason_check
      CHECK(reason IN ('envio_desactivado','sin_destinatarios','dominio_no_despachable'))`);
    await q.query('DROP FUNCTION report_digest_tenants()');
    await q.query('DROP TABLE report_digest_deliveries');
  }
}
