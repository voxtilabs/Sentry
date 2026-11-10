import { pedirApi } from './guard-outbox';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import { estadoTareasInicial, type EstadoTareas } from './guard-tareas-modelo';
import { recuperarTareasGuardadas, tareasGuardadasConTrabajo } from './guard-tareas-recuperacion';

jest.mock('./guard-outbox', () => ({ pedirApi: jest.fn() }));
jest.mock('./guard-tareas-flujo', () => ({ sincronizarTareasGuardadas: jest.fn() }));
const pedir = jest.mocked(pedirApi), sincronizar = jest.mocked(sincronizarTareasGuardadas);
const propia = 'a0000000-0000-4000-8000-000000000007';
const ajena = 'b0000000-0000-4000-8000-000000000007';
const pendiente = (patrolId: string): EstadoTareas => ({ ...estadoTareasInicial(patrolId), cola: [{
  itemId: 'tarea', checkpointId: 'punto', value: 'foto', respondidaAt: 'ahora', exigeFoto: true,
  clientScanId: 'scan-cliente', fotos: [{ clientPhotoId: 'foto-cliente' }], estado: 'pendiente',
}] });
beforeEach(() => jest.resetAllMocks());
describe('recuperación tras cerrar una ronda y volver a la portada sin asignación', () => {
  it('encuentra trabajo entre las rondas guardadas sin ofrecer plantillas o JSON corrupto', () => {
    const filas = new Map([
      ['sentrycore.guard.tareas.v1:'+propia, JSON.stringify(pendiente(propia))],
      ['sentrycore.guard.tareas.v1:'+ajena, JSON.stringify(estadoTareasInicial(ajena))],
      ['sentrycore.guard.tareas.v1:corrupta', '{'],
      ['sentrycore.guard.tareas.plantilla.v1:'+propia, '{}'],
    ]);
    const states = tareasGuardadasConTrabajo({ length: filas.size,
      key: (i) => [...filas.keys()][i] ?? null, getItem: (key) => filas.get(key) ?? null });
    expect(states.map((s) => s.patrolId)).toEqual([propia]);
  });
  it('recupera los ids de escaneos del servidor aunque la ronda ya no sea la activa', async () => {
    pedir.mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncScans: [{
      clientScanId: 'scan-cliente', scanId: 'scan-servidor',
    }] }) } as Response);
    await recuperarTareasGuardadas('/api', [pendiente(propia)]);
    expect(pedir).toHaveBeenCalledWith('/api', `/checklists/patrols/${propia}/template?includeScanIds=true`);
    expect(sincronizar).toHaveBeenCalledWith('/api', propia, {
      'scan-cliente': { clientScanId: 'scan-cliente', scanId: 'scan-servidor' },
    });
  });
  it('una ronda que no pertenece a la sesión no envía fotos ni respuestas y conserva su trabajo', async () => {
    pedir.mockResolvedValue({ ok: false, status: 404 } as Response);
    const estados = [pendiente(ajena)], antes = JSON.stringify(estados), descartadas = new Set<string>();
    await recuperarTareasGuardadas('/api', estados, undefined, descartadas);
    await recuperarTareasGuardadas('/api', estados, undefined, descartadas);
    expect(sincronizar).not.toHaveBeenCalled();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(estados)).toBe(antes);
  });
  it('el panel de la ronda activa conserva su propio proceso de sincronización', async () => {
    await recuperarTareasGuardadas('/api', [pendiente(propia)], propia);
    expect(pedir).not.toHaveBeenCalled();
    expect(sincronizar).not.toHaveBeenCalled();
  });
});
