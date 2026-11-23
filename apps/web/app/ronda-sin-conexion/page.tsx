'use client';

import { useEffect, useState } from 'react';
import { GuardShift, type GuardShiftData } from '../_components/guard-shift';
import { forgetOfflineRound, readOfflineRound } from '../_components/guard-offline-session';
import { restoreSessionFromCookies } from '../_components/use-session-refresh';
import { esAppDelGuardia } from '../_lib/app-del-guardia';

/** Public application code. The cached HTML contains no session or route data. */
export default function OfflineRound() {
  const [data,setData] = useState<GuardShiftData | null>();
  useEffect(() => {
    if (!esAppDelGuardia(navigator.userAgent)) { setData(null); return; }
    const reload = () => window.location.replace('/app/guardia');
    if (window.location.search !== '?reanudar=1') { reload(); return; }
    const saved = readOfflineRound();
    const controller = new AbortController();
    const validate = async () => {
      if (!saved) { if (navigator.onLine) reload(); return; }
      try {
        const api = process.env.NEXT_PUBLIC_API_URL ?? '/api';
        const home = () => fetch(api+'/guard/home',{credentials:'include',cache:'no-store',signal:controller.signal});
        let response = await home();
        if (response.status === 401 && await restoreSessionFromCookies(api) === 'GUARDIA') response = await home();
        if (response.status === 401 || response.status === 403) { forgetOfflineRound(); reload(); return; }
        if (!response.ok) return;
        const fresh = await response.json() as GuardShiftData;
        if (fresh.patrol?.id !== saved.patrol?.id || fresh.patrol?.status !== saved.patrol?.status) {
          forgetOfflineRound(); reload();
        }
      } catch { /* The encrypted/queued operations keep their original identifiers. */ }
    };
    setData(saved);
    if (navigator.onLine && saved) void validate();
    window.addEventListener('online', validate);
    return () => { controller.abort(); window.removeEventListener('online', validate); };
  }, []);
  return <main className="dashboard-content">
    {data ? <GuardShift data={data} apiUrl={process.env.NEXT_PUBLIC_API_URL ?? '/api'} offlineSnapshot />
      : <section className="management-card" role="status"><h2>{data === undefined ? 'Abriendo ronda…' : 'Sin conexión'}</h2>
        {data === null && <><p>Para iniciar una ronda nueva o elegir un guardia, conecta el teléfono a internet.</p>
          <button className="primary-button" onClick={()=>window.location.replace('/')}>Volver a conectar</button></>}
      </section>}
  </main>;
}
