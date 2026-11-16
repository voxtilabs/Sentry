'use client';

import { listarPendientes } from './guard-photo-store';
import { cargarEstadoRonda } from './guard-shift-state';
import { subirFotoPersistida } from './guard-evidence-upload';
import { useState } from 'react';
import { crearClientePuente } from '../_lib/bridge/web-client';
import { pedirApi, sincronizar, estadoCola } from './guard-outbox';
import { recuperarTareasGuardadas, tareasGuardadasConTrabajo } from './guard-tareas-recuperacion';
import { cargarEstadoTareas, rehidratarTareasDurables, tareasPendientesDeSubir, estadoTareasInicial } from './guard-tareas-modelo';

export function GuardEndDay() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function end() {
    if (busy) return;
    setBusy(true); setError('');
    const api = process.env.NEXT_PUBLIC_API_URL ?? '/api';
    try {
      if (!navigator.onLine) throw new Error('Conéctate para terminar la jornada y cambiar de guardia.');
      await sincronizar(api);
      if (estadoCola().pendientes) throw new Error('Espera a que se envíen los registros pendientes.');
      const states = new Map((await rehidratarTareasDurables()).map(e => [e.patrolId, e]));
      for (const e of tareasGuardadasConTrabajo(window.localStorage)) states.set(e.patrolId, e);
      for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        const id=key?.startsWith('sentrycore.guard.patrol.v1:')?key.slice('sentrycore.guard.patrol.v1:'.length):'';
        if (/^[0-9a-f-]{36}$/i.test(id) && !states.has(id)) states.set(id,estadoTareasInicial(id));
      }
      const ownPhotoClients=new Set<string>(),ownScanIds=new Set<string>();
      const own: typeof states = new Map();
      for (const [id, e] of states) {
        const check = await pedirApi(api, `/checklists/patrols/${id}/template?includeScanIds=true`);
        if (check.status === 403 || check.status === 404) continue;
        if (!check.ok) throw new Error('No pudimos verificar la evidencia pendiente. Intenta de nuevo.');
        const body=await check.json() as {syncScans?:Array<{scanId:string;clientScanId:string}>};
        for (const scan of body.syncScans??[]) { ownScanIds.add(scan.scanId);ownPhotoClients.add(scan.clientScanId); }
        for (const n of cargarEstadoRonda(id).novedades) ownPhotoClients.add(n.clientEventId);
        own.set(id, e);
      }
      const ownPhoto=(f:Awaited<ReturnType<typeof listarPendientes>>[number])=>
        ownPhotoClients.has(f.clientEventId)||(f.serverId!==null&&ownScanIds.has(f.serverId));
      for(const photo of (await listarPendientes()).filter(ownPhoto)) {
        if (photo.destino!=='tarea' && photo.serverId) await subirFotoPersistida(api,photo.clientEventId,photo.serverId);
      }
      await recuperarTareasGuardadas(api, [...own.values()]);
      if((await listarPendientes()).some(f=>f.destino!=='tarea'&&ownPhoto(f)))
        throw new Error('Espera a que se envíen tus fotos antes de cambiar de guardia.');
      if ([...own.keys()].some(id => tareasPendientesDeSubir(cargarEstadoTareas(id)))) {
        throw new Error('Se están enviando tus fotos y respuestas. Espera y vuelve a terminar la jornada.');
      }
      const response = await pedirApi(api, '/auth/guard-day/end', { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(typeof body?.message === 'string' ? body.message : 'No pudimos terminar tu jornada.');
      }
      const bridge = crearClientePuente();
      try {
        const connected = await bridge.conectar();
        if (connected.clase === 'listo') {
          bridge.detenerTraza();
          await bridge.borrarRutaOffline().catch(() => undefined);
        }
      } catch { /* El cierre ya fue confirmado: un puente lento no impide volver al selector. */ }
      finally { bridge.desconectar(); }
      window.location.replace('/?guardias=1');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos terminar tu jornada.');
      setBusy(false);
    }
  }
  return <div className="guard-end-day">
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void end()}>
      {busy ? 'Finalizando…' : 'Término de Jornada'}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
