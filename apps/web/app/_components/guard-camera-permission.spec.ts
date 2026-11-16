import { consultarCamaraConReintento } from './guard-camera-permission';
import type { ResultadoPermisoPayload } from '../_lib/bridge/protocol';

const concedido = { permiso: 'camara', estado: 'concedido' } as ResultadoPermisoPayload;
const denegado = { permiso: 'camara', estado: 'denegado' } as ResultadoPermisoPayload;

describe('cámara al cambiar de tarea', () => {
  it('recupera automáticamente un timeout del puente sin declarar un permiso denegado', async () => {
    const pedir = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(concedido);
    await expect(consultarCamaraConReintento(pedir)).resolves.toEqual(concedido);
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(pedir).toHaveBeenLastCalledWith('camara', true);
  });
  it('respeta una denegación real de Android sin volver a pedir permiso', async () => {
    const pedir = jest.fn().mockResolvedValue(denegado);
    await expect(consultarCamaraConReintento(pedir)).resolves.toEqual(denegado);
    expect(pedir).toHaveBeenCalledTimes(1);
  });
  it('un puente que sigue sin responder da error y no queda en un bucle de reintentos', async () => {
    const pedir = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(consultarCamaraConReintento(pedir)).rejects.toThrow('timeout');
    expect(pedir).toHaveBeenCalledTimes(2);
  });
});
