import { guardarFoto, leerFoto, _reiniciarMemoria, anotarReciboFotoTarea, listarPendientes } from './guard-photo-store';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import { subirFotoDeTarea, enviarRespuestasDeTareas } from './guard-outbox';
import { cargarEstadoTareas, guardarEstadoTareas, responderTarea, estadoTareasInicial, _reiniciarTareasDurables,
  rehidratarTareasDurables, recuperarCapturasTareas, modificarEstadoTareas, type ItemTarea } from './guard-tareas-modelo';

jest.mock('./guard-outbox', () => ({ subirFotoDeTarea: jest.fn(), enviarRespuestasDeTareas: jest.fn() }));
const subir = jest.mocked(subirFotoDeTarea), enviar = jest.mocked(enviarRespuestasDeTareas);
const tarea: ItemTarea = { id: 'tarea', position: 1, label: '¿Acceso cerrado?', responseType: 'si_no',
  requiresPhoto: true, requiresPhotoOnFail: false, checkpointId: 'punto', photoMinCount: 2, photoMaxCount: 3 };
const registros = { punto: { clientScanId: 'cliente-scan', scanId: 'servidor-scan' } };
const mapa = new Map<string, string>();
const ventanaOriginal = globalThis.window;
beforeEach(() => {
  mapa.clear(); _reiniciarMemoria(); _reiniciarTareasDurables(); jest.resetAllMocks();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), {
    localStorage: { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => mapa.set(k, v) },
  }) });
  subir.mockImplementation(async (_api, _scan, _foto, at) => ({ ok: true, photoId: at }));
  enviar.mockImplementation(async (_api, _ronda, responses) => responses.map((r) => ({ itemId: r.itemId, status: 'aplicado' })));
});
afterEach(() => { Object.defineProperty(globalThis, 'window', { configurable: true, value: ventanaOriginal }); });
async function guardarDosFotos() {
  for (const id of ['foto-1', 'foto-2']) await guardarFoto(id, new Blob([id]), id, null, 'tarea');
  await guardarEstadoTareas({ ...estadoTareasInicial('ronda'), borradores: {
    tarea: { value: '', clientScanId: 'cliente-scan', fotos: [{ clientPhotoId: 'foto-1' }, { clientPhotoId: 'foto-2' }] },
  } });
}
describe('envío inmediato de fotos y cola de tareas sin pérdida de evidencia', () => {
  it('serializa cambios simultáneos sobre el estado más reciente aunque falle localStorage', async () => {
    await guardarDosFotos();
    window.localStorage.setItem = () => { throw new Error('Cuota agotada'); };
    await Promise.all(['primera', 'segunda'].map((id) => modificarEstadoTareas('ronda', (actual) => ({
      ...actual, borradores: { ...actual.borradores, [id]: { value: id, clientScanId: 'cliente-scan', fotos: [] } },
    }))));
    expect(Object.keys(cargarEstadoTareas('ronda').borradores!)).toEqual(['tarea', 'primera', 'segunda']);
    _reiniciarTareasDurables();
    await rehidratarTareasDurables();
    expect(Object.keys(cargarEstadoTareas('ronda').borradores!)).toEqual(['tarea', 'primera', 'segunda']);
  });
  it('un cierre brusco que revierte localStorage no pierde la respuesta confirmada en IndexedDB', async () => {
    await guardarDosFotos();
    const actual = cargarEstadoTareas('ronda');
    await guardarEstadoTareas(responderTarea(actual, { item: tarea, value: 'no', respondidaAt: 'ahora',
      clientScanId: 'cliente-scan', fotos: actual.borradores!.tarea!.fotos }));
    mapa.set('sentrycore.guard.tareas.v1:ronda', JSON.stringify(estadoTareasInicial('ronda')));
    _reiniciarTareasDurables(); // Proceso nuevo; el almacén durable permanece.
    await rehidratarTareasDurables();
    expect(cargarEstadoTareas('ronda').cola[0]?.fotos).toHaveLength(2);
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(enviar).toHaveBeenCalledWith('/api', 'ronda', [{ itemId: 'tarea', value: 'no', photoIds: ['foto-1', 'foto-2'] }]);
  });
  it('recupera una captura huérfana de una tarea fotográfica inequívoca sin inventar respuestas escritas', () => {
    const item = { ...tarea, responseType: 'foto' as const };
    const base = { ...estadoTareasInicial('ronda'), borradores: { tarea: { value: '', clientScanId: 'cliente-scan', fotos: [{ clientPhotoId: 'f1' }] } } };
    const scans = [{ clientScanId: 'cliente-scan', scanId: 'servidor-scan', checkpointId: 'punto' }];
    const fotos = [{ clientEventId: 'f2', serverId: 'servidor-scan', destino: 'tarea' }];
    const recuperada = recuperarCapturasTareas(base, [item], scans, fotos);
    expect(recuperada.cola[0]?.value).toBe('foto');
    expect(recuperada.cola[0]?.fotos).toHaveLength(2);
    expect(recuperarCapturasTareas(base, [item, { ...item, id: 'otra' }], scans, fotos)).toEqual(base);
    expect(recuperarCapturasTareas(base, [{ ...tarea, responseType: 'texto' }], scans, fotos).cola).toEqual([]);
  });
  it('sube cada foto antes de responder y espera la pregunta para completar la tarea', async () => {
    await guardarDosFotos();
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(subir).toHaveBeenCalledTimes(2);
    expect(enviar).not.toHaveBeenCalled();
    expect(await listarPendientes()).toEqual([]); // Fotos confirmadas, aunque aún falte contestar.
    const actual = cargarEstadoTareas('ronda');
    await guardarEstadoTareas(responderTarea(actual, { item: tarea, value: 'si', respondidaAt: 'ahora',
      clientScanId: 'cliente-scan', fotos: actual.borradores!.tarea!.fotos }));
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(enviar).toHaveBeenCalledWith('/api', 'ronda', [{ itemId: 'tarea', value: 'si', photoIds: ['foto-1', 'foto-2'] }]);
    expect(subir).toHaveBeenCalledTimes(2);
    expect(await leerFoto('foto-1')).toBeUndefined();
  });
  it('sin conexión conserva fotos y respuesta; reconectar envía todo una sola vez', async () => {
    await guardarDosFotos();
    const actual = cargarEstadoTareas('ronda');
    await guardarEstadoTareas(responderTarea(actual, { item: tarea, value: 'no', respondidaAt: 'ahora',
      clientScanId: 'cliente-scan', fotos: actual.borradores!.tarea!.fotos }));
    subir.mockResolvedValue({ ok: false });
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(enviar).not.toHaveBeenCalled();
    expect(await leerFoto('foto-1')).toBeDefined();
    expect(cargarEstadoTareas('ronda').cola).toHaveLength(1);
    subir.mockImplementation(async (_api, _scan, _foto, at) => ({ ok: true, photoId: at }));
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(cargarEstadoTareas('ronda').enviadas).toEqual(['tarea']);
    expect(cargarEstadoTareas('ronda').cola).toEqual([]);
  });
  it('recupera el recibo guardado antes de un cierre de app sin subir otra vez la foto', async () => {
    await guardarDosFotos();
    await anotarReciboFotoTarea('foto-1', 'id-ya-subido');
    await sincronizarTareasGuardadas('/api', 'ronda', registros);
    expect(subir).toHaveBeenCalledTimes(1);
    expect(cargarEstadoTareas('ronda').borradores!.tarea!.fotos[0]!.photoId).toBe('id-ya-subido');
  });
  it('una respuesta en vuelo no borra la foto de otra tarea capturada mientras tanto', async () => {
    let resolver!: (r: { itemId: string; status: 'aplicado' }[]) => void;
    let llego!: () => void;
    const inicio = new Promise<void>((r) => { llego = r; });
    enviar.mockImplementation(() => { llego(); return new Promise((r) => { resolver = r; }); });
    await guardarEstadoTareas(responderTarea(estadoTareasInicial('ronda'), { item: { ...tarea, requiresPhoto: false }, value: 'si', respondidaAt: 'ahora' }));
    const enviando = sincronizarTareasGuardadas('/api', 'ronda', registros);
    await inicio;
    await guardarEstadoTareas({ ...cargarEstadoTareas('ronda'), borradores: {
      otra: { value: 'Pendiente de explicación', clientScanId: 'otro-scan', fotos: [{ clientPhotoId: 'foto-nueva' }] },
    } });
    resolver([{ itemId: 'tarea', status: 'aplicado' }]);
    await enviando;
    expect(cargarEstadoTareas('ronda').borradores?.otra?.fotos).toEqual([{ clientPhotoId: 'foto-nueva' }]);
  });
});
