'use client';

import { subirFotoDeTarea, enviarRespuestasDeTareas } from './guard-outbox';
import { anotarReciboFotoTarea, borrarFoto, conSubidaExclusiva, leerFoto } from './guard-photo-store';
import {
  anotarFotoDeTarea,
  enviarPendientes,
  fotosDeTareaAdoptables,
  cargarEstadoTareas,
  guardarEstadoTareas,
  type EstadoTareas,
} from './guard-tareas-modelo';

/**
 * El pegamento entre el modelo de tareas y la red (#265).
 *
 * Acá no se decide nada: QUÉ se manda, QUÉ espera foto y QUÉ se adopta lo dice
 * `guard-tareas-modelo`, que es puro y tiene pruebas. Esto solo hace la parte
 * que toca IndexedDB y `fetch`, y existe separado del componente porque lo
 * necesitan dos: el panel del punto y el arranque de la pantalla, que repara en
 * frío lo que quedó a medias en la sesión anterior.
 *
 * La foto de la tarea recorre EXACTAMENTE el mismo camino que la del punto —se
 * procesa con marca de agua, se guarda en el almacén persistente antes de tocar
 * la red y cuelga del escaneo, en `/evidence/scans/:scanId/photos`—. Lo único
 * distinto es que acá hace falta el id que devuelve el servidor: la respuesta
 * del checklist lo cita como `photoId`.
 */

/**
 * Sube la foto de una tarea desde el almacén y la borra si el servidor la
 * recibió. `photoId` es lo que la respuesta necesita para poder citarla.
 *
 * `conSubidaExclusiva` es el mismo candado de siempre: la misma foto no se manda
 * dos veces a la vez. Y no es teórico — la API rechaza con 409 el sha256
 * repetido, así que el segundo POST volvería como «no se pudo subir» de una foto
 * que el servidor sí tiene.
 */
export async function subirFotoDeTareaGuardada(
  apiUrl: string,
  clientPhotoId: string,
  scanId: string,
): Promise<{ ok: boolean; photoId?: string }> {
  const subida = await conSubidaExclusiva(clientPhotoId, async () => {
    const guardada = await leerFoto(clientPhotoId);
    // `undefined` = ya no estaba: otro camino la subió y la borró.
    if (!guardada) return undefined;
    if (guardada.photoId) {
      idsDeFotoDeTarea.set(clientPhotoId, guardada.photoId);
      return true;
    }
    // La hora de CAPTURA que quedó con la foto, no la de ahora: esta subida
    // puede ocurrir horas después, al recuperar señal.
    const resultado = await subirFotoDeTarea(
      apiUrl,
      scanId,
      guardada.blob as File,
      guardada.takenAtDevice,
    );
    if (!resultado.ok) return false;
    if (resultado.photoId) idsDeFotoDeTarea.set(clientPhotoId, resultado.photoId);
    if (resultado.photoId) await anotarReciboFotoTarea(clientPhotoId, resultado.photoId);
    return true;
  });

  const photoId = idsDeFotoDeTarea.get(clientPhotoId);
  // `undefined` = la foto ya no estaba. Si la subió otro camino de esta misma
  // sesión, su id quedó anotado y la respuesta igual puede citarlo.
  if (subida === undefined) return photoId ? { ok: true, photoId } : { ok: false };
  return subida && photoId ? { ok: true, photoId } : { ok: subida };
}

/**
 * El id que devolvió el servidor por cada foto de tarea, POR CLAVE de foto.
 *
 * Vive fuera de `conSubidaExclusiva` porque ese candado comparte un booleano
 * entre quienes esperan la misma subida y el id no cabe ahí. Y va en un mapa y
 * no en una variable suelta a propósito: dos tareas del mismo punto suben casi
 * a la vez, y cruzar los ids sería colgarle a una tarea la evidencia de otra.
 */
const idsDeFotoDeTarea = new Map<string, string>();

/**
 * Reparación en frío al abrir la pantalla: las fotos de tarea que quedaron sin
 * el id de su escaneo y ya lo pueden tener, según el estado de la ronda.
 */
export async function adoptarFotosDeTareas(
  apiUrl: string,
  estado: EstadoTareas,
  /**
   * Escaneos con su id de servidor. Sirven los registros de la ronda
   * (`EstadoRonda['puntos']`) y también el mapa que se arma con los veredictos
   * recién llegados: lo único que hace falta de cada uno es ese par.
   */
  registros: Readonly<Record<string, { clientScanId: string; scanId?: string }>>,
): Promise<EstadoTareas> {
  let siguiente = estado;
  for (const { clientPhotoId, scanId } of fotosDeTareaAdoptables(estado, registros)) {
    const subida = await subirFotoDeTareaGuardada(apiUrl, clientPhotoId, scanId);
    if (subida.ok && subida.photoId) {
      siguiente = anotarFotoDeTarea(siguiente, clientPhotoId, subida.photoId);
    }
  }
  return siguiente;
}

/**
 * Manda lo que la cola tenga listo. Sin señal devuelve el mismo estado: la cola
 * queda intacta y se reintenta sola en el próximo intento.
 */
export function sincronizarTareas(apiUrl: string, estado: EstadoTareas): Promise<EstadoTareas> {
  return enviarPendientes(estado, (lote) =>
    enviarRespuestasDeTareas(apiUrl, estado.patrolId, lote),
  );
}

const sincronizaciones = new Map<string, Promise<EstadoTareas>>();

/** Un solo envío por ronda. Relee lo capturado durante la red antes de persistir. */
export function sincronizarTareasGuardadas(apiUrl: string, patrolId: string,
  registros: Parameters<typeof adoptarFotosDeTareas>[2]): Promise<EstadoTareas> {
  const enCurso = sincronizaciones.get(patrolId);
  if (enCurso) return enCurso.then(() => sincronizarTareasGuardadas(apiUrl, patrolId, registros));
  const promesa = (async () => {
    const base = cargarEstadoTareas(patrolId);
    const adoptado = await adoptarFotosDeTareas(apiUrl, base, registros);
    let actual = cargarEstadoTareas(patrolId);
    const fotos = [...adoptado.cola.flatMap((r) => r.fotos ??
      (r.clientPhotoId ? [{ clientPhotoId: r.clientPhotoId, photoId: r.photoId }] : [])),
      ...Object.values(adoptado.borradores ?? {}).flatMap((b) => b.fotos)];
    for (const foto of fotos) if (foto.photoId) actual = anotarFotoDeTarea(actual, foto.clientPhotoId, foto.photoId);
    if (typeof window !== 'undefined') {
      for (const r of [...actual.cola, ...Object.values(actual.borradores ?? {})]) {
        if (r.clientScanId && r.fotos?.some((f) => f.photoId)) {
          window.dispatchEvent(new CustomEvent('sentrycore:foto-tarea-subida',
            { detail: { clientScanId: r.clientScanId } }));
        }
      }
    }
    guardarEstadoTareas(actual);
    const resultado = await sincronizarTareas(apiUrl, actual);
    const reciente = cargarEstadoTareas(patrolId);
    const enviadas = [...new Set([...reciente.enviadas, ...resultado.enviadas])];
    const siguiente = { ...reciente, enviadas,
      cola: reciente.cola.filter((r) => !enviadas.includes(r.itemId)).map((r) => {
        const rechazo = resultado.cola.find((otro) => otro.itemId === r.itemId &&
          otro.respondidaAt === r.respondidaAt && otro.estado === 'rechazada');
        return rechazo ?? r;
      }) };
    guardarEstadoTareas(siguiente);
    for (const r of actual.cola) if (enviadas.includes(r.itemId)) {
      for (const f of r.fotos ?? (r.clientPhotoId ? [{ clientPhotoId: r.clientPhotoId }] : [])) {
        await borrarFoto(f.clientPhotoId);
      }
    }
    return siguiente;
  })().finally(() => sincronizaciones.delete(patrolId));
  sincronizaciones.set(patrolId, promesa);
  return promesa;
}
