import type { ResultadoPermisoPayload } from '../_lib/bridge/protocol';

type PedirCamara = (permiso: 'camara', divulgacionMostrada: boolean) => Promise<ResultadoPermisoPayload>;

/** Un timeout del puente no significa que Android haya denegado la cámara. */
export async function consultarCamaraConReintento(pedir: PedirCamara): Promise<ResultadoPermisoPayload> {
  try {
    return await pedir('camara', true);
  } catch {
    // La actividad de cámara puede estar terminando cuando se monta la próxima tarea.
    // Solo se reintenta un fallo de comunicación; una denegación explícita se respeta.
    return pedir('camara', true);
  }
}
