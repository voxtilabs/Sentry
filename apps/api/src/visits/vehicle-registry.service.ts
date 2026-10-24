import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizarPatente } from './identity';

export interface CommunityVehicleReport {
  source:'CIPAT / Mi Barrio (reporte comunitario)';
  status:'reportado'|'sin_reporte'|'sin_registro'|'no_disponible';
  checkedAt:string;
  make:string|null;model:string|null;color:string|null;
}

export interface VehicleCheckResult {
  source: string | null;
  checkedAt: string;
  detailsStatus: 'consultado' | 'no_disponible' | 'sin_resultado';
  make: string | null;
  model: string | null;
  color: string | null;
  ownerName: string | null;
  stolenStatus: 'sin_encargo' | 'con_encargo' | 'recuperado' | 'placas_con_encargo' | 'encargo_parcial' | 'no_consultado';
  finesStatus: 'consultado' | 'no_consultado';
  finesCount: number | null;
  finesTotal: number | null;
  community?:CommunityVehicleReport;
  year?:number|null;
  inspection?:{source:string;date:string|null;expiresAt:string|null;result:string|null};
  lookupPending?:boolean;
  lookupResultId?:string;
  officialCheck?:{source:string;status:'pendiente'|'consultado'|'no_disponible';checkedAt:string|null};
}

export const emptyVehicleCheck = ():VehicleCheckResult => ({
  source:null,checkedAt:new Date().toISOString(),detailsStatus:'no_disponible',
  make:null,model:null,color:null,ownerName:null,stolenStatus:'no_consultado',
  finesStatus:'no_consultado',finesCount:null,finesTotal:null,
});

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 160): string | null => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Formulario público gratuito, misma sesión y CSRF que una consulta manual. */
@Injectable()
export class VehicleRegistryService {
  private restartGate:Promise<void>=Promise.resolve();
  private restartNext=0;
  constructor(@Optional() private readonly config?:ConfigService) {}

  async lookup(plate: string, progress?:(result:VehicleCheckResult)=>Promise<void>): Promise<VehicleCheckResult> {
    const official=this.official(plate);
    const [details,community,revisions]=await Promise.all([this.details(plate),this.community(plate),this.revisions(plate)]);
    let basic:VehicleCheckResult={...details,community,
      ...(revisions?{make:details.make??revisions.make,model:details.model??revisions.model,
        year:revisions.year,inspection:revisions.inspection,detailsStatus:'consultado',
        source:[details.source,revisions.source].filter(Boolean).join(' + ')}:{})};
    if(!basic.make||!basic.model||!basic.color||!basic.year) {
      const fallback=await this.venpu(plate);
      if(fallback)basic={...basic,make:basic.make??fallback.make,model:basic.model??fallback.model,
        color:basic.color??fallback.color,year:basic.year??fallback.year,detailsStatus:'consultado',
        source:[basic.source,fallback.source].filter(Boolean).join(' + ')};
    }
    if(progress) await progress({...basic,lookupPending:true,
      officialCheck:{source:'Auto Seguro',status:this.config?.get('VEHICLE_LOOKUP_WORKER_URL')?'pendiente':'no_disponible',checkedAt:null}});
    return {...basic,...await official,lookupPending:false};
  }

  /** Mismo GET público que usa Venpu; no solicita informes, cuentas ni claves. */
  private async venpu(plate:string) {
    try {
      const response=await fetch(`https://venpu-backend-production-b8c4.up.railway.app/v1/public/patente/${encodeURIComponent(plate)}`,{
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000),redirect:'error',
      });
      if(!response.ok)return null;
      const value=object(await response.json());const car=object(value.data);
      if(value.type!=='success'||normalizarPatente(typeof car.patent==='string'?car.patent:'')!==plate)return null;
      const make=string(car.brand,80),model=string(car.model,120),color=string(car.color,80);
      const year=Number(car.year);
      const validYear=Number.isInteger(year)&&year>=1900&&year<=new Date().getUTCFullYear()+1?year:null;
      if(!make&&!model&&!color&&!validYear)return null;
      // No inferir titularidad, multas, revisión técnica o encargo de esta ficha.
      return {source:'Venpu (consulta pública de patente)',make,model,color,year:validYear};
    }catch{return null;}
  }

  private async revisions(plate:string) {
    // El proveedor documenta 5 solicitudes cada 10 segundos por IP, sin clave.
    this.restartGate=this.restartGate.then(async()=>{
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,this.restartNext-Date.now())));
      this.restartNext=Date.now()+2200;
    });
    await this.restartGate;
    try {
      const response=await fetch(`https://api.restart.cl/v1/vehiculos-revisiones/${encodeURIComponent(plate)}`,{
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000),redirect:'error',
      });
      if(!response.ok)return null;
      const data=object(await response.json());
      const rows=(Array.isArray(data.data)?data.data:[]).map(value=>object(object(value).attributes))
        .filter(value=>normalizarPatente(typeof value.ppu==='string'?value.ppu:'')===plate
          && typeof value.fecha_revision==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value.fecha_revision)
          && Number.isFinite(Date.parse(value.fecha_revision)))
        .sort((a,b)=>String(b.fecha_revision).localeCompare(String(a.fecha_revision)));
      const car=rows[0];
      if(!car)return null;
      const year=Number(car.ano_fabricacion);
      return {source:'Restart / PRT (historial de revisiones técnicas)',
        make:string(car.marca,80),model:string(car.modelo,120),
        year:Number.isInteger(year)&&year>=1900&&year<=new Date().getUTCFullYear()+1?year:null,
        inspection:{source:'Restart / PRT',date:string(car.fecha_revision,10),
          expiresAt:typeof car.fecha_vencimiento==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(car.fecha_vencimiento)?car.fecha_vencimiento:null,
          result:string(car.resultado,30)}};
    }catch{return null;}
  }

  private async official(plate:string):Promise<Pick<VehicleCheckResult,'stolenStatus'|'officialCheck'>> {
    const unavailable:Pick<VehicleCheckResult,'stolenStatus'|'officialCheck'>={stolenStatus:'no_consultado',
      officialCheck:{source:'Auto Seguro',status:'no_disponible',checkedAt:null}};
    const base=this.config?.get<string>('VEHICLE_LOOKUP_WORKER_URL')?.replace(/\/$/,'');
    const token=this.config?.get<string>('VEHICLE_LOOKUP_WORKER_TOKEN');
    if(!base||!token)return unavailable;
    try {
      const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'};
      let response=await fetch(`${base}/lookups`,{method:'POST',headers,body:JSON.stringify({plate}),
        signal:AbortSignal.timeout(5000),redirect:'error'});
      const until=Date.now()+180_000;
      while(response.ok) {
        const data=object(await response.json());
        if(data.plate!==plate)return unavailable;
        if(data.state==='completed') {
          const result=object(data.result);
          const date=typeof result.checkedAt==='string'?Date.parse(result.checkedAt):NaN;
          if(result.plate!==plate||result.officialResponseValidated!==true||result.tokenIssued!==true
            ||result.formSubmitted!==true||!['sin_encargo','con_encargo','encargo_parcial'].includes(String(result.stolenStatus))
            ||!Number.isFinite(date)||Math.abs(Date.now()-date)>10*60_000)return unavailable;
          return {stolenStatus:result.stolenStatus as VehicleCheckResult['stolenStatus'],
            officialCheck:{source:'Auto Seguro (consulta pública automática)',status:'consultado',checkedAt:new Date(date).toISOString()}};
        }
        if(!['queued','running'].includes(String(data.state))||Date.now()>until)return unavailable;
        await new Promise(resolve=>setTimeout(resolve,2000));
        response=await fetch(`${base}/lookups/${encodeURIComponent(plate)}`,{headers,signal:AbortSignal.timeout(5000),redirect:'error'});
      }
    }catch { /* El servicio no disponible no certifica ausencia de encargo. */ }
    return unavailable;
  }

  private async community(plate:string):Promise<CommunityVehicleReport> {
    const report:CommunityVehicleReport={source:'CIPAT / Mi Barrio (reporte comunitario)',
      status:'no_disponible',checkedAt:new Date().toISOString(),make:null,model:null,color:null};
    // CIPAT documenta seis caracteres. No transformar una patente de moto en otra.
    if(plate.length!==6)return report;
    try {
      const response=await fetch(`https://www.cipat.cl/api/lookup?patente=${encodeURIComponent(plate)}`,{
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000),redirect:'error',
      });
      if(!response.ok)return report;
      const data=object(await response.json());
      if(data.found===false) {report.status='sin_registro';return report;}
      const vehicle=object(data.vehicle);
      if(data.found!==true||normalizarPatente(typeof vehicle.patente==='string'?vehicle.patente:'')!==plate
        ||typeof vehicle.is_stolen!=='boolean')return report;
      report.status=vehicle.is_stolen?'reportado':'sin_reporte';
      report.make=string(vehicle.marca,80);report.model=string(vehicle.modelo,120);report.color=string(vehicle.color,80);
    }catch { /* No disponible nunca equivale a ausencia de denuncias. */ }
    return report;
  }

  private async details(plate:string):Promise<VehicleCheckResult> {
    const result: VehicleCheckResult = {
      source: null, checkedAt: new Date().toISOString(), detailsStatus: 'no_disponible',
      make: null, model: null, color: null, ownerName: null, stolenStatus: 'no_consultado',
      finesStatus: 'no_consultado', finesCount: null, finesTotal: null,
    };
    try {
      const page = await fetch('https://autosign.cl/fact/', {
        signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
      if (!page.ok) return result;
      const html = await page.text();
      const token = /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/.exec(html)?.[1];
      if (!token) return result;
      const cookies = page.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
      const response = await fetch('https://autosign.cl/api/check_car/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json', 'X-CSRFToken': token, Cookie: cookies,
          Origin: 'https://autosign.cl', Referer: 'https://autosign.cl/fact/' },
        body: new URLSearchParams({ license_no: plate }),
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
      if (!response.ok) return result;
      const data = object(await response.json());
      const car = object(data.car);
      if (data.status !== 'success' || car.license_no !== plate) return result;
      result.source = 'AutoSign (consulta pública)';
      result.detailsStatus = 'consultado';
      result.make = string(car.brand, 80);
      result.model = string(car.model, 120);
      result.color = string(car.color, 80);
      result.ownerName = string(object(car.owner).fullname ?? car.owner_name);
      // Esta fuente no respalda multas ni encargos. Permanecen sin consultar.
    } catch { /* Fuente caída, CAPTCHA o formato cambiado: no equivale a sin antecedentes. */ }
    return result;
  }
}
