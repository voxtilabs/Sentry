'use client';
import { conSubidaExclusiva, leerFoto, borrarFoto } from './guard-photo-store';
import { subirFotoPunto, subirFotoNovedad } from './guard-outbox';

export function subirFotoPersistida(
  apiUrl: string,
  clientEventId: string,
  serverId: string,
): Promise<boolean | undefined> {
  // Una sola subida por foto aunque la pidan dos caminos a la vez: el del
  // veredicto de la cola y el de la foto recien tomada se cruzan justo cuando la
  // señal vuelve a mitad del procesado. Ver conSubidaExclusiva.
  return conSubidaExclusiva(clientEventId, async () => {
    const guardada = await leerFoto(clientEventId);
    if (!guardada || guardada.destino === 'tarea') return undefined;
    // Se manda la hora de CAPTURA que quedo guardada con la foto, no la de ahora:
    // esta subida puede ocurrir horas despues, al recuperar señal.
    //
    // El destino decide el endpoint: la foto de un punto cuelga del escaneo y la
    // de una novedad, del evento. El almacén guarda las dos y por eso lo dice.
    const subir = guardada.destino === 'escaneo' ? subirFotoPunto : subirFotoNovedad;
    const subida = await subir(apiUrl, serverId, guardada.blob as File, guardada.takenAtDevice);
    if (subida) await borrarFoto(clientEventId);
    return subida;
  });
}
