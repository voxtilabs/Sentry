'use client';

import { useEffect } from 'react';
import { pedirApi } from './guard-outbox';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import type { EstadoTareas } from './guard-tareas-modelo';

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
        Object.values(estado.borradores ?? {}).some((b) => b.fotos?.some((f) => !f.photoId))) estados.push(estado);
    } catch { /* Un registro corrupto no descarta el resto de la evidencia. */ }
  }
  return estados;
}

export async function recuperarTareasGuardadas(apiUrl: string, estados: readonly EstadoTareas[],
  activePatrolId?: string, descartadas = new Set<string>()) {
  for (const estado of estados) {
    if (estado.patrolId === activePatrolId || descartadas.has(estado.patrolId)) continue;
    // El servidor comprueba guardia y tenant ANTES de devolver los escaneos.
    // Un teléfono compartido no envía el trabajo de otro guardia bajo la sesión nueva.
    const r = await pedirApi(apiUrl, `/checklists/patrols/${encodeURIComponent(estado.patrolId)}/template?includeScanIds=true`);
    if (r.status === 403 || r.status === 404) { descartadas.add(estado.patrolId); continue; }
    if (!r.ok) continue;
    const body = await r.json() as { syncScans?: Array<{ clientScanId: string; scanId: string }> };
    await sincronizarTareasGuardadas(apiUrl, estado.patrolId,
      Object.fromEntries((body.syncScans ?? []).map((s) => [s.clientScanId, s])));
  }
}

export function useRecuperarTareasGuardadas(apiUrl: string, activePatrolId?: string) {
  useEffect(() => {
    const descartadas = new Set<string>();
    let corriendo = false, vivo = true;
    const sincronizar = async () => {
      if (corriendo || !vivo || navigator.onLine === false) return;
      corriendo = true;
      try { await recuperarTareasGuardadas(apiUrl, tareasGuardadasConTrabajo(window.localStorage), activePatrolId, descartadas); }
      catch { /* Se conserva la cola completa y se reintenta al reconectar. */ }
      finally { corriendo = false; }
    };
    void sincronizar();
    const alVolver = () => { if (document.visibilityState === 'visible') void sincronizar(); };
    window.addEventListener('online', sincronizar);
    document.addEventListener('visibilitychange', alVolver);
    const timer = window.setInterval(() => void sincronizar(), 10_000);
    return () => {
      vivo = false; window.clearInterval(timer);
      window.removeEventListener('online', sincronizar);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [apiUrl, activePatrolId]);
}
