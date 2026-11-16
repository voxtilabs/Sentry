import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ReferencePatrol1793327700000 implements MigrationInterface {
  name='ReferencePatrol1793327700000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE patrols ADD COLUMN guard_flow_completed boolean NOT NULL DEFAULT true');
    await q.query('ALTER TABLE patrols ALTER COLUMN guard_flow_completed SET DEFAULT false');
    await q.query(`CREATE TABLE reference_walks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
      site_id uuid NOT NULL,route_id uuid NOT NULL,operator_id uuid NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),deadline timestamptz NOT NULL,ended_at timestamptz,
      status text NOT NULL DEFAULT 'recording' CHECK(status IN('recording','completed','cancelled')),
      target_accuracy_m integer NOT NULL CHECK(target_accuracy_m BETWEEN 1 AND 50),
      checkpoints jsonb NOT NULL CHECK(jsonb_typeof(checkpoints)='array'),UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,site_id) REFERENCES sites(tenant_id,id),
      FOREIGN KEY(tenant_id,route_id) REFERENCES routes(tenant_id,id),
      FOREIGN KEY(tenant_id,operator_id) REFERENCES memberships(tenant_id,user_id),
      CHECK(deadline>started_at),CHECK((status='recording')=(ended_at IS NULL))
    )`);
    await q.query(`CREATE UNIQUE INDEX reference_walk_one_active ON reference_walks(tenant_id,operator_id) WHERE status='recording'`);
    await q.query(`CREATE TABLE reference_samples (
      tenant_id uuid NOT NULL, walk_id uuid NOT NULL,client_point_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL, point jsonb NOT NULL CHECK(jsonb_typeof(point)='object'),
      PRIMARY KEY(tenant_id,walk_id,client_point_id),
      FOREIGN KEY(tenant_id,walk_id) REFERENCES reference_walks(tenant_id,id)
    )`);
    await q.query(`CREATE INDEX reference_sample_time ON reference_samples(tenant_id,walk_id,recorded_at)`);
    await q.query(`CREATE TABLE reference_scans (
      tenant_id uuid NOT NULL,walk_id uuid NOT NULL,client_scan_id uuid NOT NULL,
      checkpoint_id uuid NOT NULL,scanned_at timestamptz NOT NULL,
      PRIMARY KEY(tenant_id,walk_id,client_scan_id),
      FOREIGN KEY(tenant_id,walk_id) REFERENCES reference_walks(tenant_id,id),
      FOREIGN KEY(tenant_id,checkpoint_id) REFERENCES checkpoints(tenant_id,id)
    )`);
    for (const table of ['reference_walks','reference_samples','reference_scans']) {
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY ${table}_isolation ON ${table} FOR ALL
        USING(tenant_id=app_tenant_id() OR app_has_audited_support_access(tenant_id)) WITH CHECK(tenant_id=app_tenant_id())`);
      await q.query(`REVOKE ALL ON ${table} FROM sentrycore_app`);
      await q.query(`GRANT SELECT,INSERT ON ${table} TO sentrycore_app`);
    }
    await q.query('GRANT UPDATE(status,ended_at) ON reference_walks TO sentrycore_app');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE patrols DROP COLUMN guard_flow_completed');
    await q.query('DROP TABLE reference_scans,reference_samples,reference_walks');
  }
}
