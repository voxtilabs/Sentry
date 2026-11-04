import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { patrolRulesSchema } from '@sentrycore/shared';
import { DataSource } from 'typeorm';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import { EvidenceService } from './evidence.service';

const describeDb = process.env.DATABASE_TEST_URL && process.env.DATABASE_APP_TEST_URL
  ? describe : describe.skip;

describeDb('reintentos de evidencia contra PostgreSQL y archivos reales', () => {
  let admin: DataSource, app: DataSource, directory: string;
  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: process.env.DATABASE_TEST_URL }).initialize();
    app = await new DataSource({ type: 'postgres', url: process.env.DATABASE_APP_TEST_URL }).initialize();
    directory = await mkdtemp(join(tmpdir(), 'sentry-evidence-retry-'));
  });
  afterAll(async () => {
    await app?.destroy(); await admin?.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('recupera la captura una sola vez; rechaza otro escaneo, otro guardia y otro tenant', async () => {
    const [fixture] = await admin.query(`SELECT p.tenant_id, p.id AS patrol_id, p.guard_id,
      rc.checkpoint_id FROM patrols p JOIN route_checkpoints rc
      ON rc.tenant_id=p.tenant_id AND rc.route_id=p.route_id LIMIT 1`);
    expect(fixture).toBeDefined(); // la base de integración debe tener el seed de desarrollo
    const runner = app.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await runner.query("SELECT set_config('app.tenant_id',$1,true)", [fixture.tenant_id]);
      const scanIds = [randomUUID(), randomUUID()];
      for (const scanId of scanIds) {
        await runner.query(`INSERT INTO scans(id,tenant_id,patrol_id,checkpoint_id,method,client_scan_id)
          VALUES($1,app_tenant_id(),$2,$3,'nfc',$4)`,
        [scanId, fixture.patrol_id, fixture.checkpoint_id, randomUUID()]);
      }
      const service = new EvidenceService(
        { manager: runner.manager } as TenantContextService,
        { effective: async () => patrolRulesSchema.parse({}) } as unknown as RulesService,
        { getOrThrow: () => directory } as unknown as ConfigService,
      );
      const buffer = randomBytes(32);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
      buffer.writeUInt32BE(13, 8); buffer.write('IHDR', 12);
      buffer.writeUInt32BE(640, 16); buffer.writeUInt32BE(480, 20);
      const file = { buffer, size: buffer.length, mimetype: 'image/png' };
      const captured = '2026-11-04T18:00:00.123Z';
      const first = await service.storePhoto(scanIds[0]!, fixture.guard_id, file, captured);
      const retry = await service.storePhoto(scanIds[0]!, fixture.guard_id, file, captured);
      expect(retry).toEqual(first);
      const rows = await runner.query('SELECT storage_path FROM scan_photos WHERE sha256=$1', [first.sha256]);
      expect(rows).toHaveLength(1);
      expect(await readFile(join(directory, rows[0].storage_path))).toEqual(buffer);
      await expect(service.storePhoto(scanIds[1]!, fixture.guard_id, file, captured))
        .rejects.toThrow('foto reusada');
      await expect(service.storePhoto(scanIds[0]!, randomUUID(), file, captured))
        .rejects.toThrow('no pertenece');
      await runner.query("SELECT set_config('app.tenant_id',$1,true)", [randomUUID()]);
      await expect(service.storePhoto(scanIds[0]!, fixture.guard_id, file, captured))
        .rejects.toThrow('no pertenece');
    } finally {
      await runner.rollbackTransaction(); await runner.release();
    }
  });
});
