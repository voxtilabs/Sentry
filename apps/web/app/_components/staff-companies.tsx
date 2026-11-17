'use client';
import {useEffect,useState} from 'react';
import type {StaffPortfolio} from '@sentrycore/shared';
import {operationRequest,operationError} from './operations-client';
import {openStaffCompany,STAFF_COMPANY_CHANGE_KEY} from './company-navigation';

const API=process.env.NEXT_PUBLIC_API_URL??'/api';
export function CompanySwitcher(){
 const [data,setData]=useState<StaffPortfolio|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===STAFF_COMPANY_CHANGE_KEY&&event.newValue)window.location.reload();};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 useEffect(()=>{const c=new AbortController();void operationRequest<StaffPortfolio>(`${API}/auth/companies`,'GET',undefined,c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(operationError(e));});return()=>c.abort();},[]);
 async function change(id:string){const company=data?.companies.find(c=>c.tenantId===id);if(!company||!data)return;setBusy(true);setError('');try{await openStaffCompany(API,company,data.currentTenantId,company.role==='SUPERVISOR'?'recintos':'resumen');}catch(e){setError(operationError(e));setBusy(false);}}
 return <div className="staff-company-switcher">{data&&<label>Empresa<select aria-label="Cambiar empresa" value={data.currentTenantId??''} onChange={e=>void change(e.target.value)} disabled={busy}><option value="" disabled>Selecciona una empresa</option>{data.companies.map(c=><option key={c.tenantId} value={c.tenantId}>{c.tenantName}</option>)}</select></label>}{error&&<p role="alert">{error}</p>}</div>;
}
export function StaffSites({apiUrl}:{apiUrl:string}){
 const [data,setData]=useState<StaffPortfolio|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void operationRequest<StaffPortfolio>(`${apiUrl}/auth/companies`,'GET',undefined,c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(operationError(e));});return()=>c.abort();},[apiUrl]);
 async function open(company:StaffPortfolio['companies'][number],siteId:string,view:string){if(!data)return;setBusy(siteId);setError('');try{await openStaffCompany(apiUrl,company,data.currentTenantId,view,siteId);}catch(e){setError(operationError(e));setBusy('');}}
 return <section className="management-card management-wide staff-sites"><div className="card-heading"><h2>Todos mis recintos</h2></div><p className="section-explanation">Las empresas y recintos que tienes asignados. Entra directamente a sus puntos, rondas e informes.</p>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Consultando tus recintos…</p>}
 {data?.companies.map(company=><section className="staff-company-sites" key={company.tenantId}><h3>{company.tenantName}</h3>{company.sites.length?company.sites.map(site=><article className="staff-site-row" key={site.id}><div><strong>{site.name}</strong><small>{site.branchName}</small></div><div className="row-actions"><button type="button" className="secondary-button" disabled={!!busy} onClick={()=>void open(company,site.id,'terreno')}>Puntos y etiquetas</button><button type="button" className="secondary-button" disabled={!!busy} onClick={()=>void open(company,site.id,'monitoreo')}>Seguimiento en vivo</button><button type="button" className="primary-button" disabled={!!busy} onClick={()=>void open(company,site.id,'informes')}>{busy===site.id?'Abriendo…':'Informes'}</button></div></article>):<p className="form-note">Sin recintos asignados en esta empresa. Solicita la asignación a administración.</p>}</section>)}{data&&!data.companies.length&&<p>No hay empresas activas asignadas a tu cuenta.</p>}
 </section>;
}
