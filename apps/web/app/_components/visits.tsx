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
}
interface Visit {
  id:string;clientVisitId:string;givenNames:string;familyNames:string;run:string;
  enteredAt:string;exitedAt:string|null;plate:string|null;vehicleCheck?:VehicleCheck;
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
  const [make,setMake]=useState('');
  const [model,setModel]=useState('');
  const [color,setColor]=useState('');
  const [candidates,setCandidates]=useState<readonly string[]>([]);
  const [check,setCheck]=useState<VehicleCheck>();
  const [visits,setVisits]=useState<Visit[]>([]);
  const [busy,setBusy]=useState(false);
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
        await sincronizarCola();
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
        setCandidates(result.plates??[]);setPlate(result.plates?.[0]??'');setCheck(undefined);
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

  async function lookup() {
    setBusy(true);setError('');setCheck(undefined);
    try {
      const result=await json<VehicleCheck>(`${apiUrl}/visits/guard/vehicle`,post({siteId,plate}));
      setCheck(result);setPlate(result.plate);
      setMake(result.make??'');setModel(result.model??'');setColor(result.color??'');
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo consultar el vehículo. Puedes registrar la patente y completar lo observado.');}
    finally {setBusy(false);}
  }

  async function publicLookup() {
    const normalized=normalizarPatente(plate);
    if(!normalized) {setError('Revisa la patente antes de consultar.');return;}
    if(!bridge.soportaVisitas) {setError('Actualiza la app para usar la consulta asistida dentro de SentryCore.');return;}
    setBusy(true);setError('');
    try {
      const publicResult=await bridge.consultarVehiculoPublico(normalized);
      const result=await json<VehicleCheck>(`${apiUrl}/visits/guard/public-check`,post({siteId,...publicResult,...(check?{previousCheckId:check.lookupId}:{})}));
      setCheck(result);setPlate(normalized);
    } catch(e) {setError(e instanceof Error?e.message:'La consulta pública no se completó');}
    finally {setBusy(false);}
  }

  async function save(vehicle:boolean) {
    if(vehicle&&!normalizarPatente(plate)) {setError('Revisa la patente antes de registrar.');return;}
    if(!context) {setError('Carga el registro con conexión antes de guardar visitas.');return;}
    setBusy(true);setError('');
    clientId.current ||= crypto.randomUUID();enteredAt.current ||= new Date().toISOString();
    const body={clientVisitId:clientId.current,siteId,expectedActorId:context.actorId,expectedTenantId:context.tenantId,
      givenNames,familyNames,run,enteredAt:enteredAt.current,arrivesInVehicle:vehicle,visitorInformed:true,
      originCompany,destination,...(vehicle?{plate,vehicleMake:make,vehicleModel:model,vehicleColor:color,
        ...(check?.plate===plate?{vehicleCheckId:check.lookupId}:{})}:{})};
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

  async function exit(visit:Visit) {
    if(!context)return;
    setBusy(true);setError('');
    const body={visitId:visit.id,expectedActorId:context.actorId,expectedTenantId:context.tenantId,exitedAt:new Date().toISOString()};
    try {
      try {await json(`${apiUrl}/visits/guard/exit`,post(body));await load();setNotice('Salida registrada.');}
      catch(e) {
        const status=(e as {status?:number}).status;
        if(status&&status<500)throw e;
        if(!bridge.soportaVisitas)throw new Error('Necesitas conexión para registrar esta salida.');
        await bridge.encolarSync({apiUrl:new URL(apiUrl,window.location.origin).href.replace(/\/$/,''),portalOrigin:window.location.origin,
          operation:{type:'visit-exit',clientId:crypto.randomUUID(),payload:body,queuedAt:new Date().toISOString()}});
        setPendingSync({kind:'exit',visitId:visit.id});
        setNotice('Salida guardada en la cola cifrada. Pendiente de sincronizar.');
      }
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo registrar la salida');}
    finally {setBusy(false);}
  }

  function reset() {
    clientId.current='';enteredAt.current='';setGivenNames('');setFamilyNames('');setRun('');setPlate('');
    setMake('');setModel('');setColor('');setCheck(undefined);setCandidates([]);setOriginCompany('');setDestination('');
    setInformed(false);setStep('identity');setNotice('');setError('');
  }

  return <section className="visits-panel">
    <div className="visits-heading"><h2>Registro de visitas</h2><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Volver</button></div>
    {context?<>
      <label>Recinto<select value={siteId} disabled={step!=='identity'||busy} onChange={e=>setSiteId(e.target.value)}>
        <option value="">Selecciona un recinto</option>{context.sites.map(s=><option key={s.id} value={s.id}>{s.branchName?`${s.branchName} · `:''}{s.name}</option>)}
      </select></label>
      {!bridge.conexion.enLinea?<p role="status">Sin conexión. Los registros se guardarán cifrados en este teléfono.</p>:null}
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
        <button className="primary-button" disabled={busy} onClick={()=>{setStep('vehicle');void read('plate');}}>Sí, leer patente</button>
        <button className="secondary-button" disabled={busy} onClick={()=>void save(false)}>No, registrar visita</button>
        <button className="text-button" disabled={busy} onClick={()=>setStep('identity')}>Corregir datos</button></div>:null}
      {step==='vehicle'?<div className="visits-step"><h3>Vehículo de la visita</h3>
        <button className="secondary-button" disabled={busy} onClick={()=>void read('plate')}>Leer patente con la cámara</button>
        <label>Patente<input autoComplete="off" required maxLength={10} value={plate} onChange={e=>{setPlate(e.target.value.toUpperCase());setCheck(undefined);setMake('');setModel('');setColor('');}}/></label>
        {candidates.length>1?<label>Patentes reconocidas<select value={plate} onChange={e=>{setPlate(e.target.value);setCheck(undefined);}}>{candidates.map(p=><option key={p}>{p}</option>)}</select></label>:null}
        <button className="secondary-button" disabled={busy||!plate||!bridge.conexion.enLinea} onClick={()=>void lookup()}>{busy?'Procesando…':'Confirmar patente y consultar'}</button>
        <button className="secondary-button" disabled={busy||!plate||!bridge.conexion.enLinea} onClick={()=>void publicLookup()}>Consultar robo gratis en Auto Seguro</button>
        {check?<VehicleResult check={check}/>:<p>La consulta necesita conexión. Puedes registrar la patente y completar las características observadas.</p>}
        <label>Marca (observada si no hay consulta)<input maxLength={80} value={make} onChange={e=>setMake(e.target.value)}/></label>
        <label>Modelo<input maxLength={120} value={model} onChange={e=>setModel(e.target.value)}/></label>
        <label>Color<input maxLength={80} value={color} onChange={e=>setColor(e.target.value)}/></label>
        <button className="primary-button" disabled={busy||!plate} onClick={()=>void save(true)}>Registrar visita con vehículo</button>
        <button className="text-button" disabled={busy} onClick={()=>setStep('vehicle-question')}>Volver a la pregunta</button>
      </div>:null}
      {step==='done'?<button className="primary-button" onClick={reset}>Registrar otra visita</button>:null}
      {notice?<p className="visits-notice" role="status">{notice}</p>:null}
      {error?<p className="visits-error" role="alert">{error}</p>:null}
      <div className="visits-heading"><h3>Últimas visitas del recinto</h3><button type="button" className="text-button" disabled={busy||!bridge.conexion.enLinea} onClick={()=>void load().catch(()=>setError('No se pudo actualizar el listado'))}>Actualizar</button></div>
      <VisitList visits={visits} exit={visit=>void exit(visit)} disabled={busy}/>
    </>:<p role="alert">No se pudo cargar el registro. Vuelve a abrirlo cuando tengas conexión.</p>}
  </section>;
}

function VehicleResult({check}:{check:VehicleCheck}) {
  const stolen:Record<string,string>={sin_encargo:'Sin encargo informado por la fuente',con_encargo:'Con encargo informado por la fuente',recuperado:'Recuperado según la fuente',encargo_parcial:'Encargo parcial informado por la fuente',placas_con_encargo:'Placas con encargo según la fuente',no_consultado:'No consultado'};
  return <div className="visits-vehicle-result">
    <p>Propietario registral: {check.ownerName??'No disponible'}</p>
    <p>Encargo por robo: {stolen[check.stolenStatus]??'No consultado'}</p>
    <p>Multas: {check.finesStatus==='consultado'?`${check.finesCount??'Cantidad no disponible'} informadas${check.finesTotal===null?'':` · $${check.finesTotal.toLocaleString('es-CL')}`}`:'No consultadas'}</p>
    {check.source?<p>Fuente: {check.source} · {time(check.checkedAt)}. Puede contener desfases.</p>:<p>Consulta automática no disponible. Puedes verificar en los portales públicos.</p>}
    <p><a href="https://www.autoseguro.gob.cl/" target="_blank" rel="noreferrer">Consultar robo en Auto Seguro</a></p>
    <p><a href="https://www.prt.cl/Paginas/RevisionTecnica.aspx" target="_blank" rel="noreferrer">Consultar revisión técnica en PRT</a></p>
    <p><a href="https://www.chileatiende.gob.cl/fichas/3370" target="_blank" rel="noreferrer">Consultar certificado del Registro Civil</a></p>
  </div>;
}

function VisitList({visits,exit,disabled}:{visits:Visit[];exit?:(visit:Visit)=>void;disabled?:boolean}) {
  return visits.length?<ul className="visits-list">{visits.map(visit=><li key={visit.id}>
    <strong>{visit.givenNames} {visit.familyNames}</strong><span>{visit.run}{visit.plate?` · ${visit.plate}`:''}</span>
    <span>Ingreso: {time(visit.enteredAt)}</span><span>{visit.exitedAt?`Salida: ${time(visit.exitedAt)}`:'En el recinto'}</span>
    {exit&&!visit.exitedAt?<button className="secondary-button" disabled={disabled} onClick={()=>exit(visit)}>Registrar salida</button>:null}
  </li>)}</ul>:<p>No hay visitas sincronizadas para mostrar.</p>;
}

export function VisitsManagement({apiUrl}:{apiUrl:string}) {
  const [context,setContext]=useState<VisitsContext>();
  const [siteId,setSiteId]=useState('');
  const [visits,setVisits]=useState<Visit[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{void json<VisitsContext>(`${apiUrl}/visits/management/context`).then(c=>{setContext(c);setSiteId(c.sites[0]?.id??'');}).catch(()=>setError('No se pudo cargar el registro de visitas'));},[apiUrl]);
  useEffect(()=>{if(!siteId)return;setVisits([]);void json<Visit[]>(`${apiUrl}/visits/management/sites/${siteId}`).then(setVisits).catch(()=>setError('No se pudieron cargar las visitas del recinto'));},[apiUrl,siteId]);
  return <section className="visits-panel"><h2>Registro de visitas</h2>
    <label>Recinto<select value={siteId} onChange={e=>setSiteId(e.target.value)}>{context?.sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {context?<p>Conservación de datos: {context.retentionDays} días. Se muestran los últimos 100 registros del recinto.</p>:null}
    {error?<p role="alert">{error}</p>:null}<VisitList visits={visits}/>
  </section>;
}
