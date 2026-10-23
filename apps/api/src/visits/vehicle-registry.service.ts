import { Injectable } from '@nestjs/common';

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
}

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 160): string | null => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Formulario público gratuito, misma sesión y CSRF que una consulta manual. */
@Injectable()
export class VehicleRegistryService {
  async lookup(plate: string): Promise<VehicleCheckResult> {
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
