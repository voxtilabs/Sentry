'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { SupervisionDirectory } from '@sentrycore/shared';
import { operationError, operationRequest } from './operations-client';
import styles from './portfolio.module.css';

interface Group {
  id: string;
  name: string;
  companyIds: string[];
}

interface Directory extends SupervisionDirectory {
  groups: Group[];
  organizations: Array<{ id: string; name: string; slug: string; status: string }>;
}

export function CompanyGroups({ apiUrl }: { apiUrl: string }) {
  const url = `${apiUrl}/platform/company-groups`;
  const [data, setData] = useState<Directory | null>(null);
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [supervisorId, setSupervisorId] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [access, setAccess] = useState<'all' | 'sites'>('sites');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const group = data?.groups.find(item => item.id === groupId);
  const companies = data?.companies.filter(company => group?.companyIds.includes(company.id)) ?? [];

  function selectGroup(next: Group | undefined) {
    setGroupId(next?.id ?? '');
    setName(next?.name ?? '');
    setCompanyIds(next?.companyIds ?? []);
    setSupervisorId('');
    setSiteIds([]);
    setAccess('sites');
    setNotice('');
    setError('');
  }

  useEffect(() => {
    const controller = new AbortController();
    void operationRequest<Directory>(url, 'GET', undefined, controller.signal).then(directory => {
      if (controller.signal.aborted) return;
      setData(directory);
      selectGroup(directory.groups[0]);
    }).catch(cause => { if (!controller.signal.aborted) setError(operationError(cause)); });
    return () => controller.abort();
  }, [url]);

  function selectSupervisor(id: string) {
    setSupervisorId(id);
    setAccess('sites');
    setNotice('');
    setError('');
    const memberships = data?.supervisors.find(supervisor => supervisor.id === id)?.memberships ?? [];
    setSiteIds(companies.flatMap(company => {
      const assigned = memberships.find(item => item.tenantId === company.id)?.siteIds ?? [];
      return company.sites.filter(site => assigned.includes(site.id)).map(site => site.id);
    }));
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await operationRequest<{ id: string }>(groupId ? `${url}/${groupId}` : url,
        groupId ? 'PUT' : 'POST', { name: name.trim(), companyIds });
      const directory = await operationRequest<Directory>(url, 'GET');
      setData(directory);
      selectGroup(directory.groups.find(item => item.id === saved.id));
      setNotice('Grupo guardado.');
    } catch (cause) { setError(operationError(cause)); }
    finally { setBusy(false); }
  }

  async function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupId || !supervisorId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operationRequest(`${url}/${groupId}/supervisors/${supervisorId}`, 'PUT',
        { allSites: access === 'all', siteIds: access === 'all' ? [] : siteIds });
      setData(await operationRequest<Directory>(url, 'GET'));
      if (access === 'all') setSiteIds(companies.flatMap(company => company.sites.map(site => site.id)));
      setNotice('Acceso del supervisor actualizado.');
    } catch (cause) { setError(operationError(cause)); }
    finally { setBusy(false); }
  }

  if (!data) return <p role={error ? 'alert' : 'status'}>{error || 'Cargando grupos empresariales…'}</p>;

  const elsewhere = new Set(data.groups.filter(item => item.id !== groupId).flatMap(item => item.companyIds));

  return (
    <div className={styles.groupManagement}>
      <div className={styles.groupToolbar}>
        {data.groups.length > 0 && <label>Grupo empresarial
          <select aria-label="Grupo empresarial" value={groupId} disabled={busy}
            onChange={event => selectGroup(data.groups.find(item => item.id === event.target.value))}>
            {!groupId && <option value="">Nuevo grupo</option>}
            {data.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <button type="button" className="secondary-button" disabled={busy || !groupId} onClick={() => selectGroup(undefined)}>Nuevo grupo</button>
      </div>
      <section className="management-card">
        <h2>{groupId ? 'Empresas del grupo' : 'Crear grupo'}</h2>
        <form onSubmit={saveGroup} className={styles.managementForm}>
          <label>Nombre del grupo
            <input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required disabled={busy} />
          </label>
          <fieldset disabled={busy} className={styles.checkboxList}>
            <legend>Empresas</legend>
            {data.organizations.map(company => <label key={company.id}>
              <input type="checkbox" disabled={elsewhere.has(company.id)} checked={companyIds.includes(company.id)}
                onChange={event => setCompanyIds(current => event.target.checked
                  ? [...current, company.id] : current.filter(id => id !== company.id))} />
              <span>{company.name}<small>{company.slug}{elsewhere.has(company.id) ? ' · En otro grupo' : company.status === 'suspended' ? ' · Suspendida' : ''}</small></span>
            </label>)}
          </fieldset>
          <button type="submit" className="primary-button" disabled={busy}>{groupId ? 'Guardar grupo' : 'Crear grupo'}</button>
        </form>
      </section>
      {group && <section className="management-card">
        <h2>Acceso de supervisores</h2>
        <form onSubmit={saveAccess} className={styles.managementForm}>
          <label>Supervisor
            <select aria-label="Supervisor" value={supervisorId} disabled={busy} onChange={event => selectSupervisor(event.target.value)}>
              <option value="">Selecciona un supervisor</option>
              {data.supervisors.map(supervisor => <option key={supervisor.id} value={supervisor.id}>
                {supervisor.name}{supervisor.email ? ` · ${supervisor.email}` : ''}
              </option>)}
            </select>
          </label>
          {supervisorId && <>
            <fieldset disabled={busy} className={styles.checkboxList}>
              <legend>Alcance en {group.name}</legend>
              <label><input type="radio" name="access" checked={access === 'all'} onChange={() => setAccess('all')} />Todos los recintos activos</label>
              <label><input type="radio" name="access" checked={access === 'sites'} onChange={() => setAccess('sites')} />Solo recintos seleccionados</label>
            </fieldset>
            {access === 'sites' && companies.map(company => <fieldset key={company.id} disabled={busy} className={styles.checkboxList}>
              <legend>{company.name}</legend>
              {company.sites.map(site => <label key={site.id}>
                <input type="checkbox" checked={siteIds.includes(site.id)} onChange={event => setSiteIds(current =>
                  event.target.checked ? [...current, site.id] : current.filter(id => id !== site.id))} />{site.name}
              </label>)}
              {!company.sites.length && <p>Sin recintos activos</p>}
            </fieldset>)}
            <button type="submit" className="primary-button" disabled={busy || !companies.length}>Guardar acceso</button>
          </>}
        </form>
      </section>}
      {notice && <p role="status" className={styles.groupMessage}>{notice}</p>}
      {error && <p role="alert" className={styles.groupMessage}>{error}</p>}
    </div>
  );
}
