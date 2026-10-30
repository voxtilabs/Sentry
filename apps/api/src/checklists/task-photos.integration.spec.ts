import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PATROL_RULES } from '@sentrycore/shared';
import { ChecklistsService } from './checklists.service';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import type { MailQueueService } from '../mail/mail-queue.service';
import type { EventsStreamService } from '../events-stream/events-stream.service';
import { SQL_TAREAS_DEL_TURNO } from '../reports/patrol-report.service';

const url = process.env.DATABASE_APP_TEST_URL;
const conBase = url ? describe : describe.skip;
const tenant = 'a0000000-0000-4000-8000-000000000001';
const otroTenant = 'b0000000-0000-4000-8000-000000000001';
const patrol = 'a0000000-0000-4000-8000-000000000007';
const guard = 'a0000000-0000-4000-8000-000000000002';
const punto = 'a0000000-0000-4000-8000-000000000004';
const puntoAjeno = 'a0000000-0000-4000-8000-000000000005';
const site = 'a0000000-0000-4000-8000-000000000003';

conBase('fotos múltiples y versiones contra PostgreSQL con RLS', () => {
  let db: DataSource;
  beforeAll(async () => { db = await new DataSource({ type: 'postgres', url, entities: [] }).initialize(); });
  afterAll(async () => { await db?.destroy(); });
  async function transaccion(fn: (service: ChecklistsService, runner: QueryRunner) => Promise<void>) {
    const runner = db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await runner.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [tenant, guard]);
      const ctx = new TenantContextService();
      const service = new ChecklistsService(ctx, {} as MailQueueService,
        { effective: async () => ({ ...DEFAULT_PATROL_RULES, checklistFailureNotify: false }) } as RulesService,
        { publish: () => undefined } as unknown as EventsStreamService);
      await ctx.run(runner, () => fn(service, runner));
    } finally { await runner.rollbackTransaction(); await runner.release(); }
  }
  async function foto(runner: QueryRunner, checkpointId = punto) {
    const scanId = randomUUID(), id = randomUUID();
    await runner.query(`INSERT INTO scans(id,tenant_id,patrol_id,checkpoint_id,method,client_scan_id)
      VALUES($1,app_tenant_id(),$2,$3,'nfc',$4)`, [scanId, patrol, checkpointId, randomUUID()]);
    await runner.query(`INSERT INTO scan_photos(id,tenant_id,scan_id,patrol_id,checkpoint_id,storage_path,mime_type,size_bytes,sha256)
      VALUES($1,app_tenant_id(),$2,$3,$4,'prueba/no-archivo.jpg','image/jpeg',200,$5)`,
    [id, scanId, patrol, checkpointId, (id + scanId).replaceAll('-', '')]);
    return id;
  }
  async function plantilla(service: ChecklistsService, runner: QueryRunner) {
    await runner.query(`UPDATE checklist_templates SET is_active=false`);
    const creada = await service.createTemplate({ name: 'Prueba de fotos', siteId: site, items: [{
      label: '¿Puerta cerrada?', responseType: 'si_no', checkpointId: punto,
      requiresPhoto: true, photoMinCount: 2, photoMaxCount: 3,
    }] });
    const vista = await service.templateForPatrol(patrol, guard);
    if (!vista.hasChecklist) throw new Error('Falta plantilla');
    return { id: creada.id, itemId: vista.template.items[0]!.id };
  }
  it('guarda tres fotos, las muestra en el informe y bloquea lectura cruzada y UPDATE', async () => transaccion(async (service, runner) => {
    const t = await plantilla(service, runner);
    const ids = [await foto(runner), await foto(runner), await foto(runner)];
    const resultado = await service.saveResponses(patrol, guard, { responses: [{ itemId: t.itemId, value: 'si', photoIds: ids }] });
    expect(resultado.results[0]?.status).toBe('aplicado');
    const rows = await runner.query(SQL_TAREAS_DEL_TURNO, [patrol]);
    expect(rows[0].photo_ids).toEqual(ids);
    await runner.query(`SELECT set_config('app.tenant_id',$1,true)`, [otroTenant]);
    expect(await runner.query(`SELECT * FROM checklist_response_photos`)).toEqual([]);
    await runner.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant]);
    expect((await runner.query(`SELECT * FROM checklist_response_photos`)).length).toBe(3);
    await runner.query('SAVEPOINT privilegios');
    await expect(runner.query(`UPDATE checklist_response_photos SET position=1`)).rejects.toMatchObject({ code: '42501' });
    await runner.query('ROLLBACK TO SAVEPOINT privilegios');
  }));
  it('la foto de otro punto no satisface el mínimo aunque pertenezca a la misma ronda', async () => transaccion(async (service, runner) => {
    const t = await plantilla(service, runner);
    const ids = [await foto(runner), await foto(runner, puntoAjeno)];
    const r = await service.saveResponses(patrol, guard, { responses: [{ itemId: t.itemId, value: 'si', photoIds: ids }] });
    expect(r.results[0]?.status).toBe('rechazado');
    expect(await runner.query(`SELECT * FROM checklist_responses WHERE item_id=$1`, [t.itemId])).toEqual([]);
  }));
  it('recupera escaneos para la cola de su guardia y no permite obtenerlos con otra sesión', async () => transaccion(async (service, runner) => {
    await plantilla(service, runner);
    await foto(runner);
    const expected = await runner.query(`SELECT client_scan_id AS "clientScanId", id AS "scanId", checkpoint_id AS "checkpointId" FROM scans WHERE patrol_id=$1 ORDER BY scanned_at_server`, [patrol]);
    const recuperada = await service.templateForPatrol(patrol, guard, true);
    expect(recuperada.hasChecklist && recuperada.syncScans).toEqual(expected);
    await expect(service.templateForPatrol(patrol, 'b0000000-0000-4000-8000-000000000002', true))
      .rejects.toMatchObject({ status: 404 });
  }));
  it('publicar cambios conserva la plantilla congelada y acepta la cola de la ronda anterior', async () => transaccion(async (service, runner) => {
    const t = await plantilla(service, runner);
    const nueva = await service.updateTemplate(t.id, { replaceAnswered: true, name: 'Configuración nueva', items: [{
      label: 'Solo evidencia', responseType: 'foto', checkpointId: punto, photoMinCount: 1, photoMaxCount: 3,
    }] });
    expect(nueva.id).not.toBe(t.id);
    const original = await service.templateForPatrol(patrol, guard);
    expect(original.hasChecklist && original.template.id).toBe(t.id);
    const r = await service.saveResponses(patrol, guard, { responses: [{ itemId: t.itemId, value: 'no',
      photoIds: [await foto(runner), await foto(runner)] }] });
    expect(r.results[0]?.status).toBe('aplicado');
    expect((await runner.query(SQL_TAREAS_DEL_TURNO, [patrol]))[0].label).toBe('¿Puerta cerrada?');
  }));
});
