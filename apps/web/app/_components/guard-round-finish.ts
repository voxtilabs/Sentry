import { pedirApi, sincronizar } from './guard-outbox';
import { listarPendientes, fijarServerId } from './guard-photo-store';
import { subirFotoPersistida } from './guard-evidence-upload';
import { cargarEstadoRonda } from './guard-shift-state';
import { cargarEstadoTareas, modificarEstadoTareas } from './guard-tareas-modelo';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import { conSubidasAcotadas } from './guard-upload-pool';
import { recuperarIdsParaEvidencia } from './guard-scan-recovery';

/** Persiste la intención antes de la red; un reinicio conserva el reintento. */
export async function enviarTareasAlTerminar(apiUrl: string, patrolId: string): Promise<void> {
  await modificarEstadoTareas(patrolId, (estado) => ({ ...estado, envioSolicitado: true }));
  await sincronizar(apiUrl);
  const ronda = cargarEstadoRonda(patrolId);
  const idsLocales = new Set(Object.values(ronda.puntos).map((p) => p.clientScanId));
  const fotos = (await listarPendientes()).filter((f) =>
    f.destino === 'escaneo' && (idsLocales.has(f.clientEventId) || f.patrolId === patrolId));
  const estadoTareas = cargarEstadoTareas(patrolId);
  const necesarios = [...fotos.filter((f) => !f.serverId).map((f) => f.clientEventId),
    ...[...estadoTareas.cola, ...Object.values(estadoTareas.borradores ?? {})]
      .filter((r) => r.clientScanId && (r.fotos?.some((f) => !f.photoId) || ('clientPhotoId' in r && r.clientPhotoId && !r.photoId)))
      .map((r) => r.clientScanId!)];
  const registros = await recuperarIdsParaEvidencia(apiUrl, patrolId, ronda.puntos, necesarios);
  const scans = new Map(Object.values(registros).map((p) => [p.clientScanId, p.scanId]));
  await conSubidasAcotadas(fotos, async (foto) => {
    const id = foto.serverId ?? scans.get(foto.clientEventId);
    if (!id) throw new Error('Espera a que se sincronicen los puntos de la ronda.');
    await fijarServerId(foto.clientEventId, id);
    if (await subirFotoPersistida(apiUrl, foto.clientEventId, id) === false) {
      throw new Error('La foto sigue guardada. Conéctate y vuelve a terminar la ronda para completar el envío.');
    }
  });
  await sincronizarTareasGuardadas(apiUrl, patrolId, registros);
  const tareas = cargarEstadoTareas(patrolId);
  if (tareas.cola.length || Object.values(tareas.borradores ?? {}).some((b) => b.fotos.length)) {
    throw new Error('Tus fotos y respuestas siguen guardadas. Conéctate y vuelve a terminar la ronda para completar el envío.');
  }
}


/** Confirm first, then replace the document so an offline router cache cannot retain the closed round. */
export async function confirmarTerminoDeRonda(apiUrl: string, patrolId: string,
  navegar: (path: string) => void, pedir: typeof pedirApi = pedirApi): Promise<void> {
  await enviarTareasAlTerminar(apiUrl, patrolId);
  const response = await pedir(apiUrl, `/guard/patrols/${patrolId}/confirm-flow`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : 'No pudimos confirmar el cierre. Intenta nuevamente.');
  }
  navegar('/app/guardia');
}
