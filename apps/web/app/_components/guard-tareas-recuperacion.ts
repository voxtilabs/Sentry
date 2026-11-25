'use client';

import { useEffect } from 'react';
import { pedirApi } from './guard-outbox';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import { cargarEstadoTareas, modificarEstadoTareas, recuperarCapturasTareas, rehidratarTareasDurables,
  type ItemTarea, type EstadoTareas } from './guard-tareas-modelo';
import { listarPendientes } from './guard-photo-store';
import { mapaEscaneosRecuperados } from './guard-scan-recovery';
import { enviarTareasAlTerminar } from './guard-round-finish';
import { escribirJson, leerJson } from './guard-storage';

const NO_DISPONIBLE_MS = 30 * 60_000;
const MAX_NO_DISPONIBLES = 128;

interface OpcionesRecuperacion {
  descartadas?: Set<string>;
  recoveryScope?: string;
  signal?: AbortSignal;
}

/** También se ejecuta cuando el servidor ya no ofrece la ronda recién cerrada. */
export function tareasGuardadasConTrabajo(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): EstadoTareas[] {
  const estados: EstadoTareas[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith('sentrycore.guard.tareas.v1:')) continue;
    try {
      const estado = JSON.parse(storage.getItem(key) ?? 'null') as EstadoTareas | null;
      if (!estado || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(estado.patrolId) || !Array.isArray(estado.cola)) continue;
      if (estado.cola.some((r) => r.estado === 'pendiente') ||
        Object.values(estado.borradores ?? {}).some((b) => b.fotos?.some(f=>!f.photoId))) estados.push(estado);
    } catch { /* Un registro corrupto no descarta el resto de la evidencia. */ }
  }
  return estados;
}

export async function recuperarTareasGuardadas(apiUrl: string, estados: readonly EstadoTareas[],
  activePatrolId?: string, { descartadas, recoveryScope, signal }: OpcionesRecuperacion = {}) {
  const clave = recoveryScope ? `sentrycore.guard.rondas-no-disponibles.v1:${recoveryScope}` : undefined;
  const guardadas = clave ? leerJson<Record<string, number> | null>(clave, {}) : {};
  const ahora = Date.now();
  const expiraciones = new Map(Object.entries(guardadas ?? {}).filter(([, vence]) => vence > ahora));
  let cambio = false;
  try {
    for (const estado of estados) {
      const id = estado.patrolId;
      if (signal?.aborted) return;
      if (id === activePatrolId || expiraciones.has(id) || descartadas?.has(id)) continue;
      // El servidor valida guardia y empresa. Guardamos solo el rechazo temporal:
      // la cola queda disponible cuando entre el guardia al que le pertenece.
      const ruta = `/checklists/patrols/${encodeURIComponent(id)}/template?includeScanIds=true`;
      const r = signal ? await pedirApi(apiUrl, ruta, { signal }) : await pedirApi(apiUrl, ruta);
      if (signal?.aborted || r.status === 401) return;
      if (r.status === 403 || r.status === 404) {
        if (clave) {
          expiraciones.set(id, Date.now() + NO_DISPONIBLE_MS);
          cambio = true;
        } else {
          descartadas?.add(id);
        }
        continue;
      }
      if (!r.ok) continue;
      const body = await r.json() as { patrolStatus?: string; template?: { items: ItemTarea[] };
        syncScans?: Array<{ clientScanId: string; scanId: string; checkpointId: string }> };
      if (signal?.aborted) return;
      if (body.template?.items) {
        const pendientes = await listarPendientes();
        await modificarEstadoTareas(id, (actual) =>
          recuperarCapturasTareas(actual, body.template!.items, body.syncScans ?? [], pendientes));
      }
      if (signal?.aborted) return;
      if (body.patrolStatus && ['completada', 'incompleta', 'vencida'].includes(body.patrolStatus)) {
        await enviarTareasAlTerminar(apiUrl, id, { permitirIncompletas: true });
      } else {
        await sincronizarTareasGuardadas(apiUrl, id, mapaEscaneosRecuperados(body.syncScans ?? []));
      }
    }
  } finally {
    if (clave && cambio) escribirJson(clave, Object.fromEntries([...expiraciones].slice(-MAX_NO_DISPONIBLES)));
  }
}

export function useRecuperarTareasGuardadas(apiUrl: string, activePatrolId?: string, recoveryScope?: string) {
  useEffect(() => {
    const descartadas = new Set<string>();
    const controller = new AbortController();
    const { signal } = controller;
    let corriendo = false;
    const sincronizar = async () => {
      if (corriendo || signal.aborted || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      corriendo = true;
      try {
        const durables = await rehidratarTareasDurables();
        const estados = new Map(durables.map((e) => [e.patrolId, cargarEstadoTareas(e.patrolId)]));
        for (const estado of tareasGuardadasConTrabajo(window.localStorage)) estados.set(estado.patrolId, estado);
        const fotosDeRondas=new Set((await listarPendientes()).filter(f=>f.destino==='escaneo'&&f.patrolId).map(f=>f.patrolId!));
        for(const id of fotosDeRondas)if(!estados.has(id))estados.set(id,cargarEstadoTareas(id));
        await recuperarTareasGuardadas(apiUrl, [...estados.values()].filter((e) => e.cola.length ||
          Object.values(e.borradores ?? {}).some((b) => b.fotos.some(f=>!f.photoId))||fotosDeRondas.has(e.patrolId)), activePatrolId,
          { descartadas, recoveryScope, signal });
      }
      catch { /* Se conserva la cola completa y se reintenta al reconectar. */ }
      finally { corriendo = false; }
    };
    void sincronizar();
    const alVolver = () => { if (document.visibilityState === 'visible') void sincronizar(); };
    window.addEventListener('online', sincronizar);
    document.addEventListener('visibilitychange', alVolver);
    const timer = window.setInterval(() => void sincronizar(), 10_000);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener('online', sincronizar);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [apiUrl, activePatrolId, recoveryScope]);
}
