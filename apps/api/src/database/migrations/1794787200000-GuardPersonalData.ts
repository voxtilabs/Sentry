import type { MigrationInterface,QueryRunner } from 'typeorm';
/** Optional encrypted civil identifier; excluded from authentication and report queries. */
export class GuardPersonalData1794787200000 implements MigrationInterface {
 name='GuardPersonalData1794787200000';
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE TABLE guard_personal_data(tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,user_id uuid NOT NULL,encrypted_rut bytea NOT NULL CHECK(octet_length(encrypted_rut) BETWEEN 30 AND 128),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,user_id),FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE)`);
  await q.query('ALTER TABLE guard_personal_data ENABLE ROW LEVEL SECURITY');
  await q.query('ALTER TABLE guard_personal_data FORCE ROW LEVEL SECURITY');
  await q.query(`CREATE POLICY guard_personal_data_tenant ON guard_personal_data USING (tenant_id=app_tenant_id()) WITH CHECK(tenant_id=app_tenant_id())`);
  await q.query('GRANT SELECT,INSERT,UPDATE,DELETE ON guard_personal_data TO sentrycore_app');
 }
 async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE guard_personal_data');}
}
