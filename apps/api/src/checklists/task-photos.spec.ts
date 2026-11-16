import { DEFAULT_PATROL_RULES } from '@sentrycore/shared';
import { BadRequestException } from '@nestjs/common';
import { ChecklistsService, type ChecklistItemView } from './checklists.service';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import type { MailQueueService } from '../mail/mail-queue.service';
import type { EventsStreamService } from '../events-stream/events-stream.service';

const item: ChecklistItemView = { id: 'item', position: 1, label: '¿Portón cerrado?', responseType: 'si_no',
  checkpointId: 'punto', dueLocalTime: null, requiresPhoto: true, requiresPhotoOnFail: false,
  photoMinCount: 2, photoMaxCount: 3 };
function preparar(tarea = item, opciones: { fotoAjena?: boolean; duplicado?: boolean } = {}) {
  const query = jest.fn(async (sql: string, parametros?: unknown[]) => {
    if (sql.includes('FROM patrols p')) return [{ id: 'ronda', tenant_id: 'tenant', site_id: 'recinto', shift_id: null }];
    if (sql.includes('LEFT JOIN checklist_items')) return [{ id: 'plantilla', name: 'Control', items: [tarea] }];
    if (sql.includes('FROM scan_photos')) return opciones.fotoAjena ? [] : [{ id: parametros?.[0] }];
    if (sql.includes('INSERT INTO checklist_responses')) return opciones.duplicado ? [] : [{ id: 'respuesta' }];
    return [];
  });
  const publish = jest.fn();
  const service = new ChecklistsService({ manager: { query } } as unknown as TenantContextService,
    { enqueue: jest.fn() } as unknown as MailQueueService,
    { effective: jest.fn().mockResolvedValue({ ...DEFAULT_PATROL_RULES, checklistFailureNotify: false }) } as unknown as RulesService,
    { publish } as unknown as EventsStreamService);
  return { service, query, publish };
}
describe('tareas: cantidades y pertenencia de todas las fotos', () => {
  it('rechaza la respuesta antes del mínimo sin escribir evidencia incompleta', async () => {
    const { service, query } = preparar();
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'si', photoIds: ['foto-1'] }] });
    expect(r.results[0]?.status).toBe('rechazado');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO checklist_responses'))).toBe(false);
  });
  it('valida cada foto contra la ronda Y el punto, y conserva las tres en orden', async () => {
    const { service, query, publish } = preparar();
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'no', photoIds: ['f1', 'f2', 'f3'] }] });
    expect(r.results[0]?.status).toBe('aplicado');
    for (const id of ['f1', 'f2', 'f3']) expect(query).toHaveBeenCalledWith(expect.stringContaining('checkpoint_id = $3'), [id, 'ronda', 'punto']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO checklist_response_photos'), ['respuesta', ['f1', 'f2', 'f3']]);
    expect(publish).not.toHaveBeenCalled(); // Una pregunta Sí/No no convierte cualquier NO en una falla.
  });
  it.each([['f1', 'f2', 'f3', 'f4'], ['f1', 'f1']])('no acepta exceso ni ids repetidos: %j', async (...photoIds) => {
    const { service } = preparar();
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'si', photoIds }] });
    expect(r.results[0]?.status).toBe('rechazado');
  });
  it('una foto de otro punto no completa la tarea', async () => {
    const { service } = preparar(item, { fotoAjena: true });
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'si', photoIds: ['f1', 'f2'] }] });
    expect(r.results[0]?.status).toBe('rechazado');
  });
  it('el reenvío offline no duplica enlaces ni notificaciones', async () => {
    const { service, query } = preparar(item, { duplicado: true });
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'si', photoIds: ['f1', 'f2'] }] });
    expect(r.results[0]?.status).toBe('duplicado');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO checklist_response_photos'))).toBe(false);
  });
  it('solo fotos se completa sin exigir una respuesta escrita ficticia', async () => {
    const { service } = preparar({ ...item, responseType: 'foto' });
    const r = await service.saveResponses('ronda', 'guardia', { responses: [{ itemId: 'item', value: 'foto', photoIds: ['f1', 'f2'] }] });
    expect(r.results[0]?.status).toBe('aplicado');
  });
  it('no publica una configuración con el mínimo mayor al máximo', async () => {
    const { service } = preparar();
    await expect(service.createTemplate({ name: 'Configuración', items: [{ label: 'Evidencia', responseType: 'si_no', photoMinCount: 3, photoMaxCount: 2 }] })).rejects.toThrow(BadRequestException);
  });
});
