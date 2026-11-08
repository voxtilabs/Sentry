'use client';
import { useEffect, useRef, useState } from 'react';
import { crearClientePuente, type ClientePuente } from '../_lib/bridge/web-client';
import type { ReferenceState } from '../_lib/bridge/protocol';
import { pedirApi } from './guard-outbox';
interface Walk { checkpoints?:Array<{uids:string[]}>; id:string; deadline:string; target_accuracy_m:number; status:string }
interface Detail { walk:Walk; checkpoints:Array<{id:string;name:string;position:number;scans:number;estimate:{accuracyM:number;samples:number;stationary:boolean}|null}>;
  points:Array<{latitude:number;longitude:number}> }
interface Scan {clientScanId:string;uid:string;scannedAt:string}
const scanKey=(id:string)=>`sentrycore.reference.scans:${id}`;
const readScans=(id:string):Scan[]=>JSON.parse(localStorage.getItem(scanKey(id))??'[]') as Scan[];

export function ReferencePatrol({apiUrl}:{apiUrl:string}) {
  const bridge=useRef<ClientePuente|null>(null),busySync=useRef(false),walkRef=useRef<Walk|null>(null);
  const [supported,setSupported]=useState(false),[walk,setWalk]=useState<Walk|null>(null);
  const [routes,setRoutes]=useState<Array<{id:string;name:string;site_name:string}>>([]),[route,setRoute]=useState('');
  const [state,setState]=useState<ReferenceState|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const setCurrent=(w:Walk|null)=>{walkRef.current=w;setWalk(w)};
  async function api<T>(path:string,body?:unknown):Promise<T> {
    const r=await pedirApi(apiUrl,`/reference-patrols${path}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){if(r.status===401||r.status===403)void bridge.current?.referencia({action:'stop'}).catch(()=>undefined);const b=await r.json().catch(()=>null) as {message?:string}|null;throw new Error(typeof b?.message==='string'?b.message:'No pudimos sincronizar la ronda patrón.');}
    return await r.json() as T;
  }
  async function load(){const c=await api<{routes:typeof routes;active:Walk|null}>('');setRoutes(c.routes);setCurrent(c.active);if(c.active)setDetail(await api<Detail>(`/${c.active.id}`));}
  async function flush(id:string,all=false){
    if(busySync.current)return false;busySync.current=true;
    try{
      if(!navigator.onLine)return false;
      for(let i=0;i<(all?300:5);i++){
        const pending=await bridge.current!.referencia({action:'pending',walkId:id});
        if(!pending.points.length)break;
        const ack=await api<{acknowledged:string[]}>(`/${id}/samples`,{points:pending.points});
        await bridge.current!.referencia({action:'ack',walkId:id,pointIds:ack.acknowledged});
      }
      for(const scan of readScans(id)){
        await api(`/${id}/scans`,scan);
        localStorage.setItem(scanKey(id),JSON.stringify(readScans(id).filter(s=>s.clientScanId!==scan.clientScanId)));
      }
      return true;
    }finally{busySync.current=false}
  }
  useEffect(()=>{
    const b=crearClientePuente();bridge.current=b;let alive=true,ticks=0,polling=false;
    void b.conectar().then(s=>{if(alive)setSupported(s.clase==='listo'&&s.info.dispositivo.gpsReferencia===true)}).catch(()=>undefined);
    void load().catch(e=>{if(alive)setError(e instanceof Error?e.message:'Sin conexión')});
    const timer=setInterval(()=>{
      const w=walkRef.current;if(!w||polling)return;polling=true;
      void (async()=>{const s=await b.referencia({action:'state',walkId:w.id});if(alive)setState(s);
        if(++ticks%5===0&&await flush(w.id)){const d=await api<Detail>(`/${w.id}`);if(alive)setDetail(d)}
      })().catch(()=>{if(alive)setMessage('Las posiciones quedan guardadas en el teléfono y se envían al recuperar conexión.')}).finally(()=>{polling=false});
    },1000);
    return()=>{alive=false;clearInterval(timer);void b.referencia({action:'stop'}).catch(()=>undefined);b.desconectar();bridge.current=null};
    // Una sola conexión al puente; la captura nativa continúa si Android duerme el WebView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[apiUrl]);
  async function start(resume=false){
    setBusy(true);setError('');
    let created:Walk|null=null;
    try{
      const permission=await bridge.current!.pedirPermiso('ubicacion',true);
      if(permission.estado!=='concedido')throw new Error('Activa la ubicación precisa para capturar la ronda patrón.');
      const w=resume?walkRef.current!:await api<Walk>('',{routeId:route});
      if(!resume)created=w;setCurrent(w);
      const remaining=Math.floor((Date.parse(w.deadline)-Date.now())/1000);
      if(remaining<60)throw new Error('La ventana de captura terminó. Cancela esta captura e inicia otra.');
      const s=await bridge.current!.referencia({action:'start',walkId:w.id,maxDurationSeconds:Math.min(14400,remaining)});
      setState(s);if(!s.active)throw new Error('No se pudo activar el GPS. Revisa el permiso preciso y que el GPS esté encendido.');
      setMessage('GPS continuo activo. Camina la ruta y escanea cada etiqueta. Mantén el teléfono quieto al escanear.');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo iniciar la captura');if(created){await api(`/${created.id}/cancel`,{}).catch(()=>undefined);setCurrent(null)}}finally{setBusy(false)}
  }
  async function scan(){
    if(!walk)return;setBusy(true);setError('');
    try{
      const s=await bridge.current!.escanearNfc({titulo:'Ronda patrón · acerca el NFC',timeoutMs:60000});
      if(!walk.checkpoints?.some(p=>p.uids.includes(s.uid)))throw new Error('Esta etiqueta no pertenece a la ruta seleccionada. Escanea un punto de esta ronda patrón.');
      if(Date.parse(s.scannedAt)>Date.parse(walk.deadline))throw new Error('La ventana de captura terminó. Finaliza o cancela esta captura.');
      const pending=readScans(walk.id);
      localStorage.setItem(scanKey(walk.id),JSON.stringify([...pending,{clientScanId:crypto.randomUUID(),uid:s.uid,scannedAt:s.scannedAt}]));
      setMessage('Etiqueta guardada. Mantén el teléfono quieto unos segundos para medir la posición del punto.');
      await new Promise(resolve=>setTimeout(resolve,6000));
      if(await flush(walk.id))setDetail(await api<Detail>(`/${walk.id}`));
    }catch(e){setError(e instanceof Error?e.message:'No pudimos leer la etiqueta')}finally{setBusy(false)}
  }
  async function finish(cancel=false){
    if(!walk)return;setBusy(true);setError('');
    try{
      await bridge.current!.referencia({action:'stop',walkId:walk.id});
      setState(await bridge.current!.referencia({action:'state',walkId:walk.id}));
      if(!await flush(walk.id,true))throw new Error('GPS detenido. Conéctate y vuelve a pulsar finalizar para subir la captura.');
      const pending=await bridge.current!.referencia({action:'pending',walkId:walk.id});
      if(pending.pending||readScans(walk.id).length)throw new Error('GPS detenido. Espera a que termine la sincronización y vuelve a finalizar.');
      const result=await api<Detail>(`/${walk.id}/${cancel?'cancel':'finish'}`,{});setDetail(result);setCurrent(null);
      setMessage(cancel?'Captura cancelada; GPS y sensores detenidos.':'Ronda patrón guardada con su recorrido y observaciones de los puntos. GPS y sensores detenidos.');
      localStorage.removeItem(scanKey(walk.id));
    }catch(e){setError(e instanceof Error?e.message:'No pudimos finalizar. La captura sigue guardada.')}finally{setBusy(false)}
  }
  const coordinates=detail?.points??[];
  const latitudes=coordinates.map(p=>p.latitude),longitudes=coordinates.map(p=>p.longitude);
  const minLat=Math.min(...latitudes),maxLat=Math.max(...latitudes),minLng=Math.min(...longitudes),maxLng=Math.max(...longitudes);
  const path=coordinates.filter((_,i)=>i%Math.max(1,Math.ceil(coordinates.length/1500))===0).map(p=>`${10+380*(p.longitude-minLng)/(maxLng-minLng||1)},${190-180*(p.latitude-minLat)/(maxLat-minLat||1)}`).join(' ');
  return <section className="activity-card reference-patrol">
    <h2>Ronda patrón</h2>
    <p>1. Instala y vincula las etiquetas en <a href="?vista=terreno">Puntos y etiquetas</a>. 2. Inicia la captura y recorre la ruta escaneando cada NFC.</p>
    <p>Durante esta captura se usa GPS continuo de alta precisión, acelerómetro y giroscopio. El consumo de batería será elevado. Solo se registra mientras activas este modo; puedes detenerlo desde la notificación del teléfono.</p>
    {!supported?<p role="status">Actualiza la app Android para utilizar la captura GPS de ronda patrón.</p>:null}
    {!walk?<><label>Ruta<select value={route} onChange={e=>setRoute(e.target.value)}><option value="">Selecciona una ruta</option>{routes.map(r=><option key={r.id} value={r.id}>{r.site_name} · {r.name}</option>)}</select></label>
      <button className="primary-button" type="button" disabled={!supported||!route||busy} onClick={()=>void start()}>Iniciar ronda patrón</button></>:<>
      <p><strong>{state?.active?'Capturando GPS':'GPS detenido'}</strong> · Objetivo ≤ {walk.target_accuracy_m} m · {state?.pending??0} posiciones por enviar</p>
      <dl><dt>Precisión informada por el GPS</dt><dd>{state?.accuracyM===null||state?.accuracyM===undefined?'Esperando señal':`± ${state.accuracyM.toFixed(1)} m`}</dd>
      <dt>Velocidad</dt><dd>{state?.speedMps===null||state?.speedMps===undefined?'Sin dato':`${(state.speedMps*3.6).toFixed(1)} km/h`}</dd>
      <dt>Satélites utilizados</dt><dd>{state?.satellitesUsed??0}</dd><dt>Acelerómetro / giroscopio</dt><dd>{state?.accelerometer?'Activo':'No disponible'} / {state?.gyroscope?'Activo':'No disponible'} · {state?.accelSamples??0} / {state?.gyroSamples??0} muestras</dd>
      <dt>GNSS continuo</dt><dd>{state?.fullGnss?'Activado':'GPS de alta precisión; GNSS continuo no disponible en este dispositivo'}</dd></dl>
      {state?.error?<p role="alert">La captura se detuvo ({state.error}). Revisa el GPS y retoma la captura.</p>:null}
      {!state?.active?<button className="primary-button" disabled={busy||!supported} onClick={()=>void start(true)}>Retomar captura</button>:null}
      <button className="primary-button" type="button" disabled={busy||!state?.active} onClick={()=>void scan()}>{busy?'Procesando…':'Escanear punto NFC'}</button>
      <button className="primary-button" type="button" disabled={busy} onClick={()=>void finish()}>Finalizar ronda patrón</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={()=>void finish(true)}>Cancelar captura</button>
    </>}
    {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
    {path?<svg viewBox="0 0 400 200" role="img" aria-label="Recorrido GPS registrado" style={{width:'100%',maxHeight:300}}><polyline points={path} fill="none" stroke="currentColor" strokeWidth="2"/></svg>:null}
    {detail?<ol>{detail.checkpoints.map(p=><li key={p.id}>{p.name} · {p.estimate?`± ${p.estimate.accuracyM.toFixed(1)} m · ${p.estimate.samples} muestras${p.estimate.stationary?' en reposo':''}`:'Pendiente de escaneo y señal GPS'} {p.estimate&&p.estimate.accuracyM<=detail.walk.target_accuracy_m?'✓':''}</li>)}</ol>:null}
    <p className="muted">La precisión depende de la señal y del equipo. Esta captura conserva las mediciones originales y no modifica las coordenadas de los puntos ni los informes anteriores.</p>
  </section>;
}
