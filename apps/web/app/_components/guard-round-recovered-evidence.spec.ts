import { enviarTareasAlTerminar } from './guard-round-finish';
import { pedirApi, subirFotoDeTarea, enviarRespuestasDeTareas } from './guard-outbox';
import { guardarFoto, listarPendientes, _reiniciarMemoria } from './guard-photo-store';
import { estadoInicial, guardarEstadoRonda } from './guard-shift-state';
import { cargarEstadoTareas, guardarEstadoTareas, estadoTareasInicial, responderTarea,
  _reiniciarTareasDurables, type ItemTarea } from './guard-tareas-modelo';

jest.mock('./guard-outbox', () => ({ pedirApi: jest.fn(), sincronizar: jest.fn(),
  subirFotoDeTarea: jest.fn(), enviarRespuestasDeTareas: jest.fn() }));
const original = globalThis.window;
const tarea: ItemTarea = { id: 'tarea', checkpointId: 'punto', position: 1, label: 'Acceso cerrado',
  responseType: 'si_no', requiresPhoto: true, requiresPhotoOnFail: false, photoMinCount: 1, photoMaxCount: 3 };
beforeEach(() => {
  jest.resetAllMocks(); _reiniciarMemoria(); _reiniciarTareasDurables();
  const datos = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), {
    localStorage: { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => datos.set(k, v) },
  }) });
  jest.mocked(subirFotoDeTarea).mockResolvedValue({ ok: true, photoId: 'foto-servidor' });
  jest.mocked(enviarRespuestasDeTareas).mockImplementation(async (_api, _patrol, respuestas) =>
    respuestas.map((r) => ({ itemId: r.itemId, status: 'aplicado' })));
});
afterEach(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: original }));

async function preparar(clientScanId: string, scanId?: string) {
  guardarEstadoRonda({ ...estadoInicial('ronda'), puntos: { punto: { estado: 'escaneado', clientScanId,
    scanId, anomalias: [], confirmado: true, scannedAt: '2026-11-09T12:00:00Z' } } });
  await guardarFoto('foto-local', new Blob(['captura real guardada']), 'captura', null, 'tarea');
  await guardarEstadoTareas(responderTarea(estadoTareasInicial('ronda'), { item: tarea, value: 'si',
    clientScanId, respondidaAt: 'ahora', fotos: [{ clientPhotoId: 'foto-local' }] }));
}

it('retoma un punto reconstruido del servidor, sube la foto y confirma su respuesta sin perder evidencia', async () => {
  await preparar('desde-servidor:punto');
  jest.mocked(pedirApi).mockResolvedValue(new Response(JSON.stringify({ syncScans: [
    { checkpointId: 'punto', clientScanId: 'cliente-original', scanId: 'scan-servidor' },
  ] })));
  await enviarTareasAlTerminar('/api', 'ronda');
  expect(pedirApi).toHaveBeenCalledWith('/api', '/checklists/patrols/ronda/template?includeScanIds=true');
  expect(subirFotoDeTarea).toHaveBeenCalledWith('/api', 'scan-servidor', expect.any(Blob), 'captura');
  expect(enviarRespuestasDeTareas).toHaveBeenCalled();
  expect(cargarEstadoTareas('ronda').enviadas).toEqual(['tarea']);
  expect(await listarPendientes()).toHaveLength(0);
});

it('no agrega una consulta al cierre normal cuando ya conoce el id del escaneo', async () => {
  await preparar('cliente-original', 'scan-servidor');
  await enviarTareasAlTerminar('/api', 'ronda');
  expect(pedirApi).not.toHaveBeenCalled();
  expect(cargarEstadoTareas('ronda').enviadas).toEqual(['tarea']);
});

it('conserva foto y respuesta si la sesión no puede recuperar la ronda', async () => {
  await preparar('desde-servidor:punto');
  jest.mocked(pedirApi).mockResolvedValue(new Response('{}', { status: 403 }));
  await expect(enviarTareasAlTerminar('/api', 'ronda')).rejects.toThrow();
  expect(subirFotoDeTarea).not.toHaveBeenCalled();
  expect(enviarRespuestasDeTareas).not.toHaveBeenCalled();
  expect(await listarPendientes()).toHaveLength(1);
  expect(cargarEstadoTareas('ronda').cola).toHaveLength(1);
});

it('no reasigna un UUID local desconocido a otro escaneo del mismo punto', async () => {
  await preparar('otro-cliente');
  jest.mocked(pedirApi).mockResolvedValue(new Response(JSON.stringify({ syncScans: [
    { checkpointId: 'punto', clientScanId: 'cliente-original', scanId: 'scan-servidor' },
  ] })));
  await expect(enviarTareasAlTerminar('/api', 'ronda')).rejects.toThrow('siguen guardadas');
  expect(subirFotoDeTarea).not.toHaveBeenCalled();
  expect(await listarPendientes()).toHaveLength(1);
});
