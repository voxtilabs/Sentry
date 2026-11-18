'use client';

import { useEffect, useState } from 'react';
import type { StaffPortfolio } from '@sentrycore/shared';
import { operationRequest, operationError } from './operations-client';
import { openStaffCompany, STAFF_COMPANY_CHANGE_KEY } from './company-navigation';
import { staffViewQuery, supervisorSiteView } from './panel-navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Company = StaffPortfolio['companies'][number];

function useStaffPortfolio(apiUrl: string) {
  const [data, setData] = useState<StaffPortfolio | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void operationRequest<StaffPortfolio>(`${apiUrl}/auth/companies`, 'GET', undefined, controller.signal)
      .then(setData)
      .catch(cause => { if (!controller.signal.aborted) setError(operationError(cause)); });
    return () => controller.abort();
  }, [apiUrl]);
  return { data, error, setError };
}

export function CompanySwitcher({ role, activeView, siteId }: {
  role: 'ADMIN' | 'SUPERVISOR'; activeView: string; siteId?: string | undefined;
}) {
  const { data, error, setError } = useStaffPortfolio(API);
  const [busy, setBusy] = useState(false);
  const supervisor = role === 'SUPERVISOR';
  const currentCompany = data?.companies.find(company => company.tenantId === data.currentTenantId);
  const selectedSite = currentCompany?.sites.find(site => site.id === siteId);
  const siteView = supervisorSiteView(activeView);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== STAFF_COMPANY_CHANGE_KEY || !event.newValue) return;
      // Staff tabs share their company session. An old site's URL no longer matches it.
      if (siteId) window.location.replace(staffViewQuery('recintos'));
      else window.location.reload();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [siteId]);

  async function change(value: string) {
    if (!data || busy) return;
    if (supervisor && !value) {
      window.location.assign(staffViewQuery(siteView));
      return;
    }
    const company = data.companies.find(candidate => supervisor
      ? candidate.sites.some(site => site.id === value)
      : candidate.tenantId === value);
    if (!company) return;

    setBusy(true);
    setError('');
    try {
      await openStaffCompany(API, company, data.currentTenantId,
        supervisor ? siteView : company.role === 'SUPERVISOR' ? 'recintos' : 'resumen',
        supervisor ? value : undefined);
    } catch (cause) {
      setError(operationError(cause));
      setBusy(false);
    }
  }

  return <div className="staff-company-switcher">
    {data && (supervisor ? (
      <label>Recinto
        <select aria-label="Cambiar recinto" value={selectedSite?.id ?? ''} onChange={event => void change(event.target.value)} disabled={busy}>
          <option value="">{siteView === 'recintos' ? 'Todos mis recintos' : `Recintos de ${currentCompany?.tenantName ?? 'la empresa'}`}</option>
          {data.companies.filter(company => company.sites.length > 0).map(company => (
            <optgroup key={company.tenantId} label={company.tenantName}>
              {company.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    ) : (
      <label>Empresa
        <select aria-label="Cambiar empresa" value={data.currentTenantId ?? ''} onChange={event => void change(event.target.value)} disabled={busy}>
          <option value="" disabled>Selecciona una empresa</option>
          {data.companies.map(company => <option key={company.tenantId} value={company.tenantId}>{company.tenantName}</option>)}
        </select>
      </label>
    ))}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function StaffSites({ apiUrl, siteId }: { apiUrl: string; siteId?: string | undefined }) {
  const { data, error, setError } = useStaffPortfolio(apiUrl);
  const [busy, setBusy] = useState('');
  const companies = siteId
    ? data?.companies.filter(company => company.tenantId === data.currentTenantId && company.sites.some(site => site.id === siteId))
    : data?.companies;

  async function open(company: Company, site: string, view: string) {
    if (!data) return;
    setBusy(site);
    setError('');
    try { await openStaffCompany(apiUrl, company, data.currentTenantId, view, site); }
    catch (cause) { setError(operationError(cause)); setBusy(''); }
  }

  return <section className="management-card management-wide staff-sites">
    <div className="card-heading"><h2>{siteId ? 'Acciones del recinto' : 'Todos mis recintos'}</h2></div>
    {!siteId && <p className="section-explanation">Las empresas y recintos que tienes asignados. Entra directamente a sus puntos, rondas e informes.</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Consultando tus recintos…</p>}
    {companies?.map(company => {
      const sites = siteId ? company.sites.filter(site => site.id === siteId) : company.sites;
      return <section className="staff-company-sites" key={company.tenantId}>
        <h3>{company.tenantName}</h3>
        {sites.length ? sites.map(site => <article className="staff-site-row" key={site.id}>
          <div><strong>{site.name}</strong><small>{site.branchName}</small></div>
          <div className="row-actions">
            <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void open(company, site.id, 'terreno')}>Puntos y etiquetas</button>
            <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void open(company, site.id, 'monitoreo')}>Seguimiento en vivo</button>
            <button type="button" className="primary-button" disabled={!!busy} onClick={() => void open(company, site.id, 'informes')}>{busy === site.id ? 'Abriendo…' : 'Informes'}</button>
          </div>
        </article>) : <p className="form-note">Sin recintos asignados en esta empresa. Solicita la asignación a administración.</p>}
      </section>;
    })}
    {companies?.length === 0 && <p>{siteId ? 'El recinto seleccionado no está disponible en esta empresa.' : 'No hay empresas activas asignadas a tu cuenta.'}</p>}
  </section>;
}
