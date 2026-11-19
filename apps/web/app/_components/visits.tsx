'use client';

import { normalizarPatente, normalizarRun } from '@sentrycore/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useGuardBridge, type PuenteGuardia } from './use-guard-bridge';

export interface VisitsContext {
  sites: Array<{id:string;name:string;branchName:string}>;
  actorId:string;
  tenantId:string;
  notice:string;
  retentionDays:number;
}
interface VehicleCheck {
  lookupId:string;plate:string;source:string|null;checkedAt:string;
  detailsStatus:string;make:string|null;model:string|null;color:string|null;ownerName:string|null;
  stolenStatus:string;finesStatus:string;finesCount:number|null;finesTotal:number|null;
  year?:number|null;lookupPending?:boolean;
  officialCheck?:{source:string;status:'pendiente'|'consultado'|'no_disponible';checkedAt:string|null};
  inspection?:{source:string;date:string|null;expiresAt:string|null;result:string|null};
  community?:{source:string;status:'reportado'|'sin_reporte'|'sin_registro'|'no_disponible';checkedAt:string;
    make:string|null;model:string|null;color:string|null};
}
interface Visit {
  id:string;siteId?:string;clientVisitId:string;givenNames:string;familyNames:string;run:string;
  enteredAt:string;exitedAt:string|null;plate:string|null;vehicleCheck?:VehicleCheck;
  destination?:string|null;originCompany?:string|null;
}
type PendingSync = {kind:'visit';clientVisitId:string}|{kind:'exit';visitId:string};

async function json<T>(url:string,init?:RequestInit):Promise<T> {
  const response=await fetch(url,{...init,credentials:'include'});
  if(!response.ok) {
    const error=await response.json().catch(()=>({}));
    throw Object.assign(new Error(typeof error.message==='string'?error.message:'No pudimos completar la solicitud'),{status:response.status});
  }
  return response.json() as Promise<T>;
}
const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const time=(value:string)=>new Date(value).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'});

/** La portería no depende de aceptar geolocalización para una ronda. */
export function GuardHomeEntrance({children,context,initialSiteId,apiUrl}:{children:ReactNode;context:VisitsContext|null;initialSiteId?:string;apiUrl:string}) {
  const [open,setOpen]=useState(false);
  if(open)return <StandaloneVisits context={context} initialSiteId={initialSiteId} apiUrl={apiUrl} onClose={()=>setOpen(false)}/>;
  return <>{context?.sites.length?<button type="button" className="secondary-button guard-visits-button" onClick={()=>setOpen(true)}>REGISTRAR VISITAS</button>:null}{children}</>;
}
function StandaloneVisits(props:{context:VisitsContext|null;initialSiteId?:string;apiUrl:string;onClose:()=>void}) {
  const bridge=useGuardBridge(props.apiUrl);
  return <Visits {...props} bridge={bridge}/>;
}

export function Visits({apiUrl,context,initialSiteId,bridge,onClose}:{
  apiUrl:string;context:VisitsContext|null;initialSiteId?:string;bridge:PuenteGuardia;onClose:()=>void;
}) {
  const { sincronizarCola,cancelarOcr,cancelarConsultaPublica }=bridge;
  const [siteId,setSiteId]=useState(initialSiteId ?? context?.sites[0]?.id ?? '');
  const [step,setStep]=useState<'identity'|'vehicle-question'|'vehicle'|'done'>('identity');
  const [givenNames,setGivenNames]=useState('');
  const [familyNames,setFamilyNames]=useState('');
  const [run,setRun]=useState('');
  const [originCompany,setOriginCompany]=useState('');
  const [destination,setDestination]=useState('');
  const [informed,setInformed]=useState(false);
  const [plate,setPlate]=useState('');
  const [candidates,setCandidates]=useState<readonly string[]>([]);
  const [check,setCheck]=useState<VehicleCheck>();
  const lastCheck=useRef<VehicleCheck|undefined>(undefined);
  useEffect(()=>{lastCheck.current=check;},[check]);
  const [visits,setVisits]=useState<Visit[]>([]);
  const [busy,setBusy]=useState(false);
  const [lookingUp,setLookingUp]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pendingSync,setPendingSync]=useState<PendingSync>();
  const clientId=useRef<string>('');
  const enteredAt=useRef<string>('');
  const formRef=useRef<HTMLFormElement>(null);

  const load=useCallback(async()=>{
    if(!siteId) return [];
    const rows=await json<Visit[]>(`${apiUrl}/visits/guard/sites/${siteId}`);
    setVisits(rows);
    return rows;
  },[apiUrl,siteId]);

  useEffect(()=>{setVisits([]);void load().catch(()=>undefined);},[load]);
  useEffect(()=>{
    if(!bridge.conexion.enLinea) return;
    let cancelled=false;
    let retry:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      try {
        // Android puede anunciar conexión antes de que la red ya responda.
        // Confirmamos la fila en el servidor, no solo que terminó el envío.
        // El worker de Android puede haberla enviado aunque el puente falle.
        await sincronizarCola().catch(()=>undefined);
        const rows=await load();
        const confirmed=pendingSync&&rows.some(v=>pendingSync.kind==='visit'
          ? v.clientVisitId===pendingSync.clientVisitId
          : v.id===pendingSync.visitId&&Boolean(v.exitedAt));
        if(!cancelled&&confirmed) {
          setPendingSync(undefined);
          setNotice(pendingSync.kind==='visit'?'Visita sincronizada.':'Salida sincronizada.');
          return;
        }
      } catch { /* La cola conserva la operación y su reintento. */ }
      if(!cancelled&&pendingSync) retry=setTimeout(()=>void refresh(),5_000);
    };
    void refresh();
    return()=>{cancelled=true;if(retry)clearTimeout(retry);};
  },[bridge.conexion.enLinea,sincronizarCola,load,pendingSync]);
  useEffect(()=>()=>{cancelarOcr();cancelarConsultaPublica();},[cancelarOcr,cancelarConsultaPublica]);

  useEffect(()=>{
    const normalized=normalizarPatente(plate);
    setLookingUp(false);
    if(!['vehicle','done'].includes(step)||!normalized||!bridge.conexion.enLinea)return;
    const previous=lastCheck.current;
    if(step==='done'&&(!previous?.lookupPending||previous.plate!==normalized))return;
    let cancelled=false;
    const controller=new AbortController();
    let poll:ReturnType<typeof setTimeout>|undefined;
    const until=Date.now()+180_000;
    setLookingUp(true);
    // El servidor ejecuta y conserva el resultado incluso si esta vista se cierra.
    async function update(id?:string) {
      try {
        const result=await json<VehicleCheck>(id?`${apiUrl}/visits/guard/vehicle/${id}`:`${apiUrl}/visits/guard/vehicle`,
          id?{signal:controller.signal}:{...post({siteId,plate:normalized}),signal:controller.signal});
        if(cancelled)return;
        setCheck(result);
        if(result.lookupPending&&Date.now()<until) {
          poll=setTimeout(()=>void update(result.lookupId),2000);
          return;
        }
        if(result.lookupPending)setNotice('La consulta continúa en el servidor. Puedes registrar la visita y revisar el informe después.');
        setLookingUp(false);
      }catch(e) {
        if(!cancelled) {setError(e instanceof Error?e.message:'No se pudo completar la consulta automática');setLookingUp(false);}
      }
    }
    const timer=setTimeout(()=>{setError('');void update(step==='done'?previous?.lookupId:undefined);},350);
    return()=>{cancelled=true;clearTimeout(timer);if(poll)clearTimeout(poll);controller.abort();};
  },[apiUrl,siteId,plate,step,bridge.conexion.enLinea]);

  async function read(kind:'identity'|'plate') {
    setError('');
    if(!bridge.soportaVisitas) {setError('Actualiza SentryCore para leer con la cámara. Puedes escribir los datos manualmente.');return;}
    if(kind==='identity'&&!informed) {setError('Informa a la visita sobre el registro antes de leer su carnet.');return;}
    setBusy(true);
    try {
      const result=await bridge.escanearOcr(kind);
      if(kind==='identity') {
        if(result.givenNames) setGivenNames(result.givenNames);
        if(result.familyNames) setFamilyNames(result.familyNames);
        if(result.run) setRun(result.run);
        setNotice('Revisa y completa los datos leídos antes de continuar.');
      } else {
        const plates = result.plates ?? [];
        setCandidates(plates);
        if (plates.length > 0) {
          setPlate(plates[0] ?? '');
          setCheck(undefined);
        }
      }
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo completar la lectura');}
    finally {setBusy(false);}
  }

  function next(event:FormEvent) {
    event.preventDefault();setError('');
    if(!normalizarRun(run)) {setError('Revisa el RUN y su dígito verificador.');return;}
    if(!givenNames.trim()||!familyNames.trim()) {setError('Completa los nombres y apellidos.');return;}
    if(!siteId||!informed) {setError('Selecciona el recinto e informa a la visita antes de continuar.');return;}
    clientId.current ||= crypto.randomUUID();
    enteredAt.current ||= new Date().toISOString();
    setStep('vehicle-question');setNotice('');
  }

  async function save(vehicle:boolean) {
    if(vehicle&&!normalizarPatente(plate)) {setError('Revisa la patente antes de registrar.');return;}
    if(!context) {setError('Carga el registro con conexión antes de guardar visitas.');return;}
    setBusy(true);setError('');
    clientId.current ||= crypto.randomUUID();enteredAt.current ||= new Date().toISOString();
    const body={clientVisitId:clientId.current,siteId,expectedActorId:context.actorId,expectedTenantId:context.tenantId,
      givenNames,familyNames,run,enteredAt:enteredAt.current,arrivesInVehicle:vehicle,visitorInformed:true,
      originCompany,destination,...(vehicle?{plate:normalizarPatente(plate),
        ...(check?.plate===normalizarPatente(plate)?{vehicleCheckId:check.lookupId}:{})}:{})};
    try {
      let offline=false;
      try {await json(`${apiUrl}/visits/guard`,post(body));}
      catch(e) {
        const status=(e as {status?:number}).status;
        if(status&&status<500) throw e;
        if(!bridge.soportaVisitas) throw new Error('Necesitas conexión o actualizar la app para guardar visitas sin señal.');
        await bridge.encolarSync({apiUrl:new URL(apiUrl,window.location.origin).href.replace(/\/$/,''),
          portalOrigin:window.location.origin,operation:{type:'visit',clientId:clientId.current,payload:body,queuedAt:new Date().toISOString()}});
        setPendingSync({kind:'visit',clientVisitId:clientId.current});
        offline=true;
      }
      setNotice(offline?'Visita guardada en la cola cifrada del teléfono. Pendiente de sincronizar cuando vuelva la conexión.':'Visita registrada.');
      setStep('done');
      if(!offline) await load().catch(()=>undefined);
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo guardar la visita');}
    finally {setBusy(false);}
  }

  async function exit(visit:Visit):Promise<boolean> {
    if(!context)return false;
    setBusy(true);setError('');
    const body={visitId:visit.id,expectedActorId:context.actorId,expectedTenantId:context.tenantId,exitedAt:new Date().toISOString()};
    try {
      try {await json(`${apiUrl}/visits/guard/exit`,post(body));setNotice('Salida registrada.');}
      catch(e) {
        const status=(e as {status?:number}).status;
        if(status&&status<500)throw e;
        if(!bridge.soportaVisitas)throw new Error('Necesitas conexión para registrar esta salida.');
        await bridge.encolarSync({apiUrl:new URL(apiUrl,window.location.origin).href.replace(/\/$/,''),portalOrigin:window.location.origin,
          operation:{type:'visit-exit',clientId:crypto.randomUUID(),payload:body,queuedAt:new Date().toISOString()}});
        setPendingSync({kind:'exit',visitId:visit.id});
        setNotice('Salida guardada en la cola cifrada. Pendiente de sincronizar.');
      }
      setVisits(rows=>rows.map(row=>row.id===visit.id?{...row,exitedAt:body.exitedAt}:row));
      return true;
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo registrar la salida');return false;}
    finally {setBusy(false);}
  }

  function reset() {
    clientId.current='';enteredAt.current='';setGivenNames('');setFamilyNames('');setRun('');setPlate('');
    setCheck(undefined);setCandidates([]);setOriginCompany('');setDestination('');
    setInformed(false);setStep('identity');setNotice('');setError('');
  }

  return <section className="visits-panel">
    <div className="visits-heading"><h2>Registro de visitas</h2><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Volver</button></div>
    {context?<>
      <label>Recinto<select value={siteId} disabled={step!=='identity'||busy} onChange={e=>setSiteId(e.target.value)}>
        <option value="">Selecciona un recinto</option>{context.sites.map(s=><option key={s.id} value={s.id}>{s.branchName?`${s.branchName} · `:''}{s.name}</option>)}
      </select></label>
      {!bridge.conexion.enLinea?<p role="status">Sin conexión. Los registros se guardarán cifrados en este teléfono.</p>:null}
      {step==='identity'&&siteId?<ExitVisitSearch key={siteId} apiUrl={apiUrl} siteId={siteId} localVisits={visits}
        offline={!bridge.conexion.enLinea} busy={busy} onExit={exit}/>:null}
      {step==='identity'?<form ref={formRef} onSubmit={next}>
        <details><summary>Aviso para la visita</summary><p>{context.notice}</p><p>Plazo de conservación: {context.retentionDays} días.</p></details>
        <label className="visits-checkbox"><input type="checkbox" checked={informed} onChange={e=>setInformed(e.target.checked)} required/>He informado a la visita sobre el uso de sus datos para el control de acceso.</label>
        <button className="primary-button" type="button" disabled={busy||!siteId||!informed} onClick={()=>void read('identity')}>{busy?'Leyendo…':'Leer carnet con la cámara'}</button>
        <p>Confirma nombre y RUN. El número de documento y la foto del carnet no se guardan.</p>
        <label>Nombres<input autoComplete="off" required maxLength={120} value={givenNames} onChange={e=>setGivenNames(e.target.value)}/></label>
        <label>Apellidos<input autoComplete="off" required maxLength={120} value={familyNames} onChange={e=>setFamilyNames(e.target.value)}/></label>
        <label>RUN / RUT<input autoComplete="off" required maxLength={12} placeholder="12345678-5" value={run} onChange={e=>setRun(e.target.value.toUpperCase())}/></label>
        <label>Empresa de procedencia (opcional)<input autoComplete="off" maxLength={160} value={originCompany} onChange={e=>setOriginCompany(e.target.value)}/></label>
        <label>Persona o lugar de destino (opcional)<input autoComplete="off" maxLength={200} value={destination} onChange={e=>setDestination(e.target.value)}/></label>
        <button className="primary-button" disabled={busy||!siteId} type="submit">Continuar</button>
      </form>:null}
      {step==='vehicle-question'?<div className="visits-step"><h3>¿VIENE EN VEHÍCULO?</h3><p>{givenNames} {familyNames} · {run}</p>
        <button className="primary-button" disabled={busy} onClick={()=>{setStep('vehicle');if(bridge.soportaVisitas)void read('plate');}}>Sí, leer patente</button>
        <button className="secondary-button" disabled={busy} onClick={()=>void save(false)}>No, registrar visita</button>
        <button className="text-button" disabled={busy} onClick={()=>setStep('identity')}>Corregir datos</button></div>:null}
      {step==='vehicle'?<div className="visits-step"><h3>Ficha del vehículo {plate?`· ${plate}`:''}</h3>
        <button className="secondary-button" disabled={busy||!bridge.soportaVisitas} onClick={()=>void read('plate')}>{busy?'Leyendo patente…':plate?'Volver a leer con la cámara':'Leer patente con la cámara'}</button>
        <label>Patente
          <input autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={10} value={plate}
            onChange={e=>{setPlate(e.target.value.toUpperCase());setCheck(undefined);}} placeholder="Ingresa la patente si la cámara no la lee" />
        </label>
        {error ? <p className="visits-error" role="alert">{error}</p> : null}
        {candidates.length>1?<label>Patentes reconocidas<select value={plate} onChange={e=>{setPlate(e.target.value);setCheck(undefined);}}>{candidates.map(p=><option key={p}>{p}</option>)}</select></label>:null}
        {lookingUp?<p role="status">Consultando antecedentes del vehículo…</p>:null}
        {check?<VehicleResult check={check}/>:!lookingUp?<p>{normalizarPatente(plate)?'Antecedentes no disponibles. La patente puede registrarse igualmente.':'Escanea la patente para obtener la ficha del vehículo.'}</p>:null}
        <button className="primary-button" disabled={busy||(lookingUp&&!check)||!normalizarPatente(plate)} onClick={()=>void save(true)}>Registrar visita con vehículo</button>
        <button className="text-button" disabled={busy} onClick={()=>setStep('vehicle-question')}>Volver a la pregunta</button>
      </div>:null}
      {step==='done'?<>{check?<VehicleResult check={check}/>:null}<button className="primary-button" onClick={reset}>Registrar otra visita</button></>:null}
      {notice?<p className="visits-notice" role="status">{notice}</p>:null}
      {error&&step!=='vehicle'?<p className="visits-error" role="alert">{error}</p>:null}
      <div className="visits-heading"><h3>Últimas visitas del recinto</h3><button type="button" className="text-button" disabled={busy||!bridge.conexion.enLinea} onClick={()=>void load().catch(()=>setError('No se pudo actualizar el listado'))}>Actualizar</button></div>
      <VisitList visits={visits} exit={visit=>void exit(visit)} disabled={busy}/>
    </>:<p role="alert">No se pudo cargar el registro. Vuelve a abrirlo cuando tengas conexión.</p>}
  </section>;
}

function ExitVisitSearch({apiUrl,siteId,localVisits,offline,busy,onExit}:{
  apiUrl:string;siteId:string;localVisits:Visit[];offline:boolean;busy:boolean;onExit:(visit:Visit)=>Promise<boolean>;
}) {
  const [run,setRun]=useState('');
  const [result,setResult]=useState<{run:string;rows:Visit[];error?:string}>();
  const [exitError,setExitError]=useState('');
  const normalized=normalizarRun(run);
  const current=result?.run===normalized?result:undefined;
  const local=normalized?localVisits.filter(visit=>visit.run===normalized&&!visit.exitedAt):[];
  const rows=current&&!current.error?current.rows:local;

  useEffect(()=>{
    if(!normalized||offline)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      void json<Visit[]>(`${apiUrl}/visits/guard/find-exit`,{
        ...post({siteId,run:normalized}),cache:'no-store',signal:controller.signal,
      }).then(rows=>{
        if(!controller.signal.aborted)setResult({run:normalized,rows});
      }).catch(()=>{
        if(!controller.signal.aborted)setResult({run:normalized,rows:[],error:'No se pudo consultar el ingreso. Revisa la conexión e intenta otra vez.'});
      });
    },220);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[apiUrl,normalized,offline,siteId]);

  return <details className="visits-exit-search">
    <summary>Registrar salida por RUN</summary>
    <label>RUN de la visita<input autoComplete="off" autoCapitalize="characters" spellCheck={false}
      maxLength={12} disabled={busy} value={run} placeholder="12345678-5"
      onChange={event=>{setRun(event.target.value.toUpperCase());setExitError('');}} /></label>
    {normalized&&!current&&!offline&&rows.length===0?<p role="status">Buscando ingreso…</p>:null}
    {current?.error||exitError?<p role="alert">{exitError||current?.error}</p>:null}
    {normalized&&rows.length===0&&current&&!current.error?<p role="status">No hay un ingreso abierto para este RUN en el recinto.</p>:null}
    {normalized&&rows.length===0&&offline?<p role="status">El ingreso no está en el listado cargado. Conéctate para buscar en el registro completo.</p>:null}
    {rows.length>1?<p>Hay más de un ingreso abierto. Confirma el que corresponde.</p>:null}
    {rows.map(visit=><article key={visit.id}>
      <strong>{visit.givenNames} {visit.familyNames}</strong>
      <p>Ingreso: {time(visit.enteredAt)}{visit.plate?` · Patente: ${visit.plate}`:''}</p>
      {visit.originCompany?<p>Empresa: {visit.originCompany}</p>:null}
      {visit.destination?<p>Destino: {visit.destination}</p>:null}
      <button type="button" className="primary-button" disabled={busy} onClick={()=>void onExit(visit).then(ok=>{
        if(ok){setRun('');setResult(undefined);setExitError('');}
        else setExitError('No se pudo registrar esta salida. Vuelve a intentarlo.');
      })}>Confirmar salida</button>
    </article>)}
  </details>;
}

export function VehicleResult({check}:{check:VehicleCheck}) {
  const stolen:Record<string,string>={sin_encargo:'Sin encargo informado por la fuente',con_encargo:'Con encargo informado por la fuente',recuperado:'Recuperado según la fuente',encargo_parcial:'Encargo parcial informado por la fuente',placas_con_encargo:'Placas con encargo según la fuente',no_consultado:'No consultado'};
  const hasEncargo=['con_encargo','encargo_parcial','placas_con_encargo'].includes(check.stolenStatus);
  return <div className="visits-vehicle-result">
    <p>Marca: {check.make??check.community?.make??'No disponible'}</p>
    <p>Modelo: {check.model??check.community?.model??'No disponible'}</p>
    {check.year?<p>Año: {check.year}</p>:null}
    <p>Color: {check.color??check.community?.color??'No disponible'}</p>
    <p>Propietario registral: {check.ownerName??'No disponible'}</p>
    <p className={hasEncargo?'visits-theft-alert':undefined} role={hasEncargo?'alert':undefined}>
      {hasEncargo?<strong>ALERTA DE ENCARGO · </strong>:null}
      Robo (registro oficial): {check.officialCheck?.status==='pendiente'?'Consultando…':stolen[check.stolenStatus]??'No consultado'}
    </p>
    {check.officialCheck?.status==='consultado'&&check.officialCheck.checkedAt?<p>Fuente del encargo: {check.officialCheck.source} · {time(check.officialCheck.checkedAt)}.</p>:null}
    <p>Multas: {check.finesStatus==='consultado'?`${check.finesCount??'Cantidad no disponible'} informadas${check.finesTotal===null?'':` · $${check.finesTotal.toLocaleString('es-CL')}`}`:'No consultadas'}</p>
    {check.source?<p>Fuente de la ficha: {check.source} · {time(check.checkedAt)}. Puede contener desfases.</p>:null}
    {check.inspection?<p>Última revisión técnica: {check.inspection.date??'Fecha no disponible'} · resultado {check.inspection.result??'no disponible'} · vencimiento {check.inspection.expiresAt??'no disponible'}. Fuente: {check.inspection.source}.</p>:null}
    {check.community?<><p>Reporte comunitario: {{reportado:'Vehículo reportado como robado',sin_reporte:'Sin reporte de robo en esta fuente',sin_registro:'Vehículo sin registros en esta fuente',no_disponible:'No disponible'}[check.community.status]}</p>
      <p>Fuente: {check.community.source} · {time(check.community.checkedAt)}. No reemplaza la consulta del registro oficial.</p></>:null}
  </div>;
}

function VisitList({visits,exit,disabled,siteNames}:{visits:Visit[];exit?:(visit:Visit)=>void;disabled?:boolean;siteNames?:ReadonlyMap<string,string>}) {
  return visits.length?<ul className="visits-list">{visits.map(visit=><li key={visit.id}>
    <strong>{visit.givenNames} {visit.familyNames}</strong><span>{visit.run}{visit.plate?` · ${visit.plate}`:''}</span>
    {visit.siteId&&siteNames?.get(visit.siteId)?<span>{siteNames.get(visit.siteId)}</span>:null}
    <span>Ingreso: {time(visit.enteredAt)}</span><span>{visit.exitedAt?`Salida: ${time(visit.exitedAt)}`:'En el recinto'}</span>
    {visit.vehicleCheck?<details><summary>Informe del vehículo{visit.vehicleCheck.lookupPending?' · En consulta':''}</summary><VehicleResult check={visit.vehicleCheck}/></details>:null}
    {exit&&!visit.exitedAt?<button className="secondary-button" disabled={disabled} onClick={()=>exit(visit)}>Registrar salida</button>:null}
  </li>)}</ul>:<p>No hay visitas sincronizadas para mostrar.</p>;
}

export function VisitsManagement({apiUrl,initialSiteId,scopeInHeader=false}:{
  apiUrl:string;initialSiteId?:string|undefined;scopeInHeader?:boolean;
}) {
  const [context,setContext]=useState<VisitsContext>();
  const [localSite,setLocalSite]=useState(initialSiteId??'');
  const [contextError,setContextError]=useState(false);
  const [result,setResult]=useState<{url:string;visits:Visit[];error?:string}>();
  const siteId=scopeInHeader ? initialSiteId??'' : localSite;
  const site=context?.sites.find(item=>item.id===siteId);
  const unavailable=Boolean(context && siteId && !site);
  const base=`${apiUrl}/visits/management`;
  const url=siteId ? `${base}/sites/${encodeURIComponent(siteId)}` : base;
  const current=result?.url===url ? result : undefined;
  const siteNames=new Map(context?.sites.map(item=>[item.id,item.name]));

  useEffect(()=>{
    const controller=new AbortController();
    void json<VisitsContext>(`${base}/context`,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setContext(value);})
      .catch(()=>{if(!controller.signal.aborted)setContextError(true);});
    return ()=>controller.abort();
  },[base]);
  useEffect(()=>{
    if(!context?.sites.length || unavailable)return;
    const controller=new AbortController();
    void json<Visit[]>(url,{signal:controller.signal})
      .then(visits=>{if(!controller.signal.aborted)setResult({url,visits});})
      .catch(()=>{if(!controller.signal.aborted)setResult({url,visits:[],error:'No se pudieron cargar las visitas de esta selección.'});});
    return ()=>controller.abort();
  },[context,url,unavailable]);

  return <section className="management-card visits-panel visits-management" aria-labelledby="visits-management-title">
    <div className="card-heading"><h2 id="visits-management-title">Visitas recientes</h2></div>
    {!scopeInHeader&&context?.sites.length?<label>Recinto
      <select value={siteId} onChange={e=>setLocalSite(e.target.value)}>
        <option value="">Todos los recintos de esta empresa</option>
        {context.sites.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>:null}
    {context?.sites.length&&!unavailable?<p className="section-explanation">
      {site ? `Recinto: ${site.name}.` : 'Todos los recintos autorizados de esta empresa.'} Se muestran hasta 100 visitas, de la más reciente a la más antigua.
    </p>:null}
    {contextError?<p role="alert">No se pudo cargar el registro de visitas.</p>:null}
    {unavailable?<p role="alert">El recinto seleccionado ya no está disponible. Elige otro en el selector de recintos.</p>:null}
    {context?.sites.length===0?<p>No tienes recintos habilitados para consultar visitas.</p>:null}
    {!context&&!contextError || Boolean(context?.sites.length&&!unavailable&&!current)?<p role="status">Cargando visitas…</p>:null}
    {!unavailable&&current?.error?<p role="alert">{current.error}</p>:null}
    {!unavailable&&current&&!current.error?<VisitList visits={current.visits} siteNames={siteNames}/>:null}
  </section>;
}
