import { Injectable } from '@nestjs/common';
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
}

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 160): string | null => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Formulario público gratuito, misma sesión y CSRF que una consulta manual. */
@Injectable()
export class VehicleRegistryService {
  async lookup(plate: string): Promise<VehicleCheckResult> {
    const [details,community]=await Promise.all([this.details(plate),this.community(plate)]);
    return {...details,community};
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
