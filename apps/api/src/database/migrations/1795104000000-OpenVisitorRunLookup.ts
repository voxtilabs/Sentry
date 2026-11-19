import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OpenVisitorRunLookup1795104000000 implements MigrationInterface {
  name = 'OpenVisitorRunLookup1795104000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE INDEX visitor_sessions_open_run_idx
      ON visitor_sessions (tenant_id, site_id, run, entered_at_device DESC, id DESC)
      WHERE exited_at_device IS NULL`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX visitor_sessions_open_run_idx');
  }
}
