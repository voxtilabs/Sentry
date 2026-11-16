import { guardarFoto, leerFoto, fijarServerId, _reiniciarMemoria } from './guard-photo-store';
import { subirFotoPersistida } from './guard-evidence-upload';
import { cargarEstadoTareas } from './guard-tareas-modelo';
import { subirFotoPunto, subirFotoNovedad } from './guard-outbox';

jest.mock('./guard-tareas-modelo', () => ({ cargarEstadoTareas: jest.fn() }));
jest.mock('./guard-outbox', () => ({ subirFotoPunto: jest.fn(), subirFotoNovedad: jest.fn() }));
beforeEach(() => { _reiniciarMemoria(); jest.resetAllMocks(); });

it('una foto de punto conserva la ronda al recibir el scan y espera su término', async () => {
  jest.mocked(cargarEstadoTareas).mockReturnValue({ patrolId: 'ronda', cola: [], enviadas: [] });
  await guardarFoto('foto', new Blob(['foto']), 'captura', null, 'escaneo', 'ronda');
  await fijarServerId('foto', 'scan');
  expect((await leerFoto('foto'))?.patrolId).toBe('ronda');
  expect(await subirFotoPersistida('/api', 'foto', 'scan')).toBe(false);
  expect(subirFotoPunto).not.toHaveBeenCalled();
  jest.mocked(cargarEstadoTareas).mockReturnValue({ patrolId: 'ronda', cola: [], enviadas: [], envioSolicitado: true });
  jest.mocked(subirFotoPunto).mockResolvedValue(true);
  expect(await subirFotoPersistida('/api', 'foto', 'scan')).toBe(true);
  expect(subirFotoPunto).toHaveBeenCalledWith('/api', 'scan', expect.any(Blob), 'captura');
  expect(await leerFoto('foto')).toBeUndefined();
});

it('las novedades conservan el envío inmediato', async () => {
  await guardarFoto('evento', new Blob(['novedad']), 'captura');
  jest.mocked(subirFotoNovedad).mockResolvedValue(true);
  await subirFotoPersistida('/api', 'evento', 'servidor');
  expect(subirFotoNovedad).toHaveBeenCalledTimes(1);
  expect(cargarEstadoTareas).not.toHaveBeenCalled();
});

it('un fallo de IndexedDB no se disfraza de guardado durable en memoria', async () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: () => {
      const request = { error: new Error('QuotaExceededError'), onerror: () => undefined };
      queueMicrotask(() => request.onerror());
      return request;
    },
  } });
  try {
    await expect(guardarFoto('foto', new Blob(['evidencia']), 'captura')).rejects.toThrow('QuotaExceededError');
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'indexedDB', anterior);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
  expect(await leerFoto('foto')).toBeUndefined();
});
