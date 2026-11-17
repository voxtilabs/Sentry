'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PATROL_RULE_CATALOG } from '@sentrycore/shared';
import { operationRequest, operationError, type OperationSite } from './operations-client';

type Frequency = 'daily' | 'weekly' | 'monthly';
export interface MailSettings {
  recipients: string[]; onlyBelowThreshold: boolean; threshold: number; hour: number;
  dailyEnabled: boolean; weeklyEnabled: boolean; monthlyEnabled: boolean;
  dailyIncludePhotos: boolean; dailyIncludeGuardNames: boolean;
  weeklyIncludePhotos: boolean; weeklyIncludeGuardNames: boolean;
  monthlyIncludePhotos: boolean; monthlyIncludeGuardNames: boolean;
  dailyRecipients: string[]; weeklyRecipients: string[]; monthlyRecipients: string[];
}
const FREQUENCIES: {key:Frequency;label:string;period:string}[] = [
  {key:'daily',label:'Diario',period:'Día anterior'},
  {key:'weekly',label:'Semanal',period:'Semana anterior, de lunes a domingo'},
  {key:'monthly',label:'Mensual',period:'Mes anterior, organizado por semanas'},
];
function EmailList({label,values,onChange,disabled}:{label:string;values:string[];onChange:(values:string[])=>void;disabled:boolean}) {
  const [email,setEmail] = useState(''), [error,setError] = useState('');
  const max = PATROL_RULE_CATALOG.reportRecipients.maxItems!;
  function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const next = email.trim().toLowerCase();
    if (values.includes(next)) {setError('Este correo ya está en la lista.');return;}
    if (values.length>=max) {setError(`Puedes agregar hasta ${max} destinatarios.`);return;}
    onChange([...values,next]);setEmail('');setError('');
  }
  return <div className="mail-addresses"><form className="operations-inline" onSubmit={add}>
    <label>{label}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={disabled} placeholder="correo@empresa.cl"/></label>
    <button className="secondary-button" disabled={disabled}>Agregar correo</button></form>
    <ul className="operations-recipients">{values.map(value=><li key={value}><span>{value}</span><button type="button" className="text-button" disabled={disabled} onClick={()=>onChange(values.filter(v=>v!==value))} aria-label={`Quitar ${value}`}>Quitar</button></li>)}</ul>
    {!values.length&&<p className="form-note">Lista vacía.</p>}{error&&<p role="alert">{error}</p>}
  </div>;
}
export function ReportRecipients({apiUrl}:{apiUrl:string}) {
  const [sites,setSites]=useState<OperationSite[]>([]),[site,setSite]=useState('');
  const [settings,setSettings]=useState<MailSettings|null>(null),[custom,setCustom]=useState<Record<Frequency,boolean>>({daily:false,weekly:false,monthly:false});
  const [message,setMessage]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{const c=new AbortController();void operationRequest<OperationSite[]>(`${apiUrl}/operations/sites`,'GET',undefined,c.signal).then(s=>{setSites(s);if(s.length===1)setSite(s[0]!.id);}).catch(e=>{if(!c.signal.aborted)setMessage(operationError(e));});return()=>c.abort();},[apiUrl]);
  useEffect(()=>{
    setMessage('');setSettings(null);if(!site)return;
    const c=new AbortController();setLoading(true);
    void operationRequest<MailSettings>(`${apiUrl}/operations/sites/${site}/recipients`,'GET',undefined,c.signal).then(d=>{
      setSettings(d);setCustom({daily:!!d.dailyRecipients.length,weekly:!!d.weeklyRecipients.length,monthly:!!d.monthlyRecipients.length});
    }).catch(e=>{if(!c.signal.aborted)setMessage(operationError(e));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[apiUrl,site]);
  function patch(value:Partial<MailSettings>) {setSettings(s=>s?{...s,...value}:s);setMessage('');}
  async function save() {
    if(!settings)return;
    for(const {key,label} of FREQUENCIES) {
      if(settings[`${key}Enabled`] && !(custom[key]?settings[`${key}Recipients`]:settings.recipients).length) {
        setMessage(`Agrega al menos un destinatario para el resumen ${label.toLowerCase()}.`);return;
      }
    }
    setSaving(true);setMessage('');
    try {
      const payload = Object.fromEntries(Object.entries(settings).filter(([key])=>key!=='siteId'));
      const d=await operationRequest<MailSettings>(`${apiUrl}/operations/sites/${site}/recipients`,'PUT',payload);
      setSettings(d);setMessage('Configuración guardada. Se aplicará a los próximos envíos.');
    } catch(e) {setMessage(operationError(e));} finally {setSaving(false);}
  }
  return <section className="management-card management-wide operations-contacts">
    <div className="card-heading"><h2>Correos e informes</h2></div>
    <p className="section-explanation">Elige cuándo avisar y quién recibe cada resumen. La lista común se puede usar en todas las frecuencias; un cliente puede recibir solo el mensual con su propia lista.</p>
    <label>Recinto<select aria-label="Recinto" value={site} onChange={e=>setSite(e.target.value)} disabled={saving}><option value="">Selecciona un recinto</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name} · {s.branchName}</option>)}</select></label>
    {settings&&<div className="mail-settings" key={site}>
      <fieldset disabled={saving} className="mail-settings-section"><legend>Avisos al terminar una ronda</legend>
        <label className="mail-toggle"><input type="checkbox" checked={settings.onlyBelowThreshold} onChange={e=>patch({onlyBelowThreshold:e.target.checked})}/>Enviar solo si el cumplimiento baja del mínimo</label>
        <label>Mínimo de cumplimiento (%)<input type="number" min={PATROL_RULE_CATALOG.complianceThreshold.min} max={PATROL_RULE_CATALOG.complianceThreshold.max} value={settings.threshold} onChange={e=>patch({threshold:Number(e.target.value)})}/></label>
        <p className="form-note">{settings.onlyBelowThreshold?`Un solo aviso con el informe si el cumplimiento es menor al ${settings.threshold}%. Con ${settings.threshold}% o más, no se envía correo de ronda.`:'Se utiliza el envío habitual de informes de ronda y alertas.'} Los informes completos permanecen disponibles en la web.</p>
      </fieldset>
      <div className="mail-settings-section"><h3>Lista común</h3><p className="form-note">Destinatarios de los avisos y de los resúmenes que usen esta lista. Los administradores también reciben las alertas; en los resúmenes solo se escribe a la lista seleccionada.</p>
        <EmailList label="Correo para la lista común" values={settings.recipients} onChange={recipients=>patch({recipients})} disabled={saving}/>
      </div>
      <div className="mail-settings-section"><h3>Resúmenes programados</h3>
        <label>Hora local de envío<select aria-label="Hora local de envío" value={settings.hour} onChange={e=>patch({hour:Number(e.target.value)})} disabled={saving}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,'0')}:00</option>)}</select></label>
        <p className="form-note">Se procesa el último período completo desde la hora elegida, con un margen de hasta 15 minutos. Al activar una frecuencia, puede enviarse el último período cerrado. Cada destinatario recibe un correo por empresa, frecuencia, zona horaria y período.</p>
        <p className="form-note">Elige el contenido de cada frecuencia. Sin marcar las casillas se envían solo cifras; el detalle opcional viaja en PDF. Los nombres incluyen nombre y apellido del guardia.</p>
        {FREQUENCIES.map(({key,label,period})=><fieldset key={key} disabled={saving} className="mail-frequency">
          <legend>{label}</legend><p className="form-note">{period}</p>
          <label className="mail-toggle"><input type="checkbox" checked={settings[`${key}Enabled`]} onChange={e=>patch({[`${key}Enabled`]:e.target.checked})}/>Activar resumen {label.toLowerCase()}</label>
          <label className="mail-toggle"><input type="checkbox" checked={settings[`${key}IncludePhotos`] ?? false} onChange={e=>patch({[`${key}IncludePhotos`]:e.target.checked})}/>Incluir fotos en el PDF</label>
          <label className="mail-toggle"><input type="checkbox" checked={settings[`${key}IncludeGuardNames`] ?? false} onChange={e=>patch({[`${key}IncludeGuardNames`]:e.target.checked})}/>Incluir nombre y apellido de los guardias</label>
          <p className="form-note">Las fotos se comprimen. Si el anexo supera el límite de envío, el correo conserva el resumen e indica consultar el panel con una cuenta autorizada.</p>
          <label className="mail-toggle"><input type="checkbox" checked={!custom[key]} onChange={e=>{const common=e.target.checked;setCustom(c=>({...c,[key]:!common}));if(common)patch({[`${key}Recipients`]:[]});}}/>Usar lista común</label>
          {custom[key]?<EmailList label={`Correo para resumen ${label.toLowerCase()}`} values={settings[`${key}Recipients`]} onChange={values=>patch({[`${key}Recipients`]:values})} disabled={saving}/>:<p className="form-note">{settings.recipients.length} destinatarios de la lista común.</p>}
        </fieldset>)}
      </div>
      <button className="primary-button" type="button" onClick={()=>void save()} disabled={saving}>{saving?'Guardando…':'Guardar configuración de correos'}</button>
    </div>}
    {loading&&<p role="status">Cargando configuración…</p>}{message&&<p role="status" className="management-message">{message}</p>}
  </section>;
}
