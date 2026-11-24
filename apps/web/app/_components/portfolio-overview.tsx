'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { StaffCompany } from '@sentrycore/shared';
import { operationError, operationRequest } from './operations-client';
import { staffCompanyLabel, staffSiteLabel } from './staff-site-labels';
import { SummaryStats } from './summary-stats';
import { formatearPorcentaje } from './stats-charts-data';
import styles from './portfolio.module.css';

interface Metrics {
  patrols: number;
  scheduled: number;
  voluntary: number;
  completed: number;
  incomplete: number;
  expired: number;
  active: number;
  waiting: number;
  compliancePct: number | null;
  scans: number;
  scansNfc: number;
  scansFlagged: number;
  scansWithGps: number;
  scanGpsPct: number | null;
  avgAccuracyM: number | null;
  tasksExpected: number;
  tasksDone: number;
  tasksFailed: number;
  legacyResponses: number;
  taskPct: number | null;
}

type Scope = 'all' | 'group' | 'company' | 'site';
type Selection = { scope: Scope; scopeId?: string };
type MetricKey = 'compliancePct' | 'taskPct' | 'scanGpsPct';

interface Overview {
  range: { desde: string; hasta: string };
  selected: Selection;
  groups: Array<{ id: string; name: string }>;
  companies: StaffCompany[];
  totals: Metrics;
  companyMetrics: Array<Metrics & { tenantId: string }>;
  sites: Array<Metrics & { siteId: string; tenantId: string }>;
  days: Array<Metrics & { day: string }>;
}

const metricChoices: Record<MetricKey, string> = {
  compliancePct: 'Cumplimiento de rondas',
  taskPct: 'Ejecución de tareas',
  scanGpsPct: 'Escaneos con ubicación',
};

const displayScope = (scope: Selection) => scope.scopeId ? `${scope.scope}:${scope.scopeId}` : scope.scope;
const review = (row: Metrics) => row.incomplete + row.expired;
const shortDate = (date: string) => date.split('-').reverse().join('/');
const meters = (value: number | null) => value === null ? '—' : `± ${new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 1,
}).format(value)} m`;

function selectedRange(days: number) {
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(new Date());
  const start = new Date(Date.parse(end) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from: start, to: end };
}

export function PortfolioOverview({ apiUrl }: { apiUrl: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [scope, setScope] = useState('');
  const [range, setRange] = useState(() => selectedRange(30));
  const [draftRange, setDraftRange] = useState(() => selectedRange(30));
  const [metric, setMetric] = useState<MetricKey>('compliancePct');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(range);
    const [kind, id] = scope.split(':');
    if (kind) params.set('scope', kind);
    if (id) params.set('scopeId', id);
    setLoading(true);
    setError('');
    void operationRequest<Overview>(`${apiUrl}/dashboard/portfolio?${params}`, 'GET', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(operationError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiUrl, range, scope, retry]);

  function changeRange(days: number) {
    const next = selectedRange(days);
    setDraftRange(next);
    setRange(next);
  }

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRange(draftRange);
  }

  const companies = data?.companies ?? [];
  const siteNames = new Map(companies.flatMap(company => {
    const name = staffCompanyLabel(company);
    return company.sites.map(site => [site.id, staffSiteLabel(name, site.name)] as const);
  }));
  const companyNames = new Map(companies.map(company => [company.tenantId, staffCompanyLabel(company)]));
  const sites = [...(data?.sites ?? [])].sort((a, b) =>
    review(b) - review(a) || (a.compliancePct ?? 101) - (b.compliancePct ?? 101));
  const byCompany = [...(data?.companyMetrics ?? [])].sort((a, b) =>
    review(b) - review(a) || (a.compliancePct ?? 101) - (b.compliancePct ?? 101));
  const points = (data?.days ?? []).map(day => ({
    bucket: day.day, patrols: day.patrols, completed: day.completed, sites: 0, compliancePct: day[metric],
  }));
  const measuredSites = sites.filter(site => site[metric] !== null).sort((a, b) => (a[metric] ?? 0) - (b[metric] ?? 0));
  const bars = measuredSites.slice(0, 10).map(site => ({
      key: site.siteId, label: siteNames.get(site.siteId) ?? 'Recinto',
      value: site[metric] ?? 0, display: formatearPorcentaje(site[metric]),
      attention: (metric === 'compliancePct' && review(site) > 0) || (metric === 'taskPct' && site.tasksDone < site.tasksExpected),
    }));
  const total = data?.totals;

  return (
    <div className={styles.overview} aria-busy={loading}>
      <section className={styles.filters} aria-label="Filtros del resumen">
        <label>Alcance
          <select aria-label="Alcance" value={scope || (data ? displayScope(data.selected) : 'all')}
            onChange={event => setScope(event.target.value)} disabled={!data}>
            <option value="all">Todos mis recintos</option>
            {!!data?.groups.length && <optgroup label="Grupos empresariales">
              {data.groups.map(group => <option value={`group:${group.id}`} key={group.id}>{group.name}</option>)}
            </optgroup>}
            {!!companies.length && <optgroup label="Empresas">
              {companies.map(company => <option value={`company:${company.tenantId}`} key={company.tenantId}>{companyNames.get(company.tenantId)}</option>)}
            </optgroup>}
            {siteNames.size > 0 && <optgroup label="Recintos">
              {[...siteNames].map(([id, name]) => <option value={`site:${id}`} key={id}>{name}</option>)}
            </optgroup>}
          </select>
        </label>
        <div className={styles.periodButtons} aria-label="Períodos rápidos">
          {[7, 30, 90].map(days => <button type="button" key={days} className="secondary-button"
            aria-pressed={range.from === selectedRange(days).from && range.to === selectedRange(days).to}
            onClick={() => changeRange(days)}>{days} días</button>)}
        </div>
        <form onSubmit={applyRange} className={styles.dateFilter}>
          <label>Desde<input type="date" required value={draftRange.from}
            onChange={event => setDraftRange(current => ({ ...current, from: event.target.value }))} /></label>
          <label>Hasta<input type="date" required min={draftRange.from} value={draftRange.to}
            onChange={event => setDraftRange(current => ({ ...current, to: event.target.value }))} /></label>
          <button type="submit" className="secondary-button">Aplicar</button>
        </form>
      </section>
      {loading && <p role="status" className={styles.loadMessage}>Consultando rondas…</p>}
      {error && <div role="alert" className={styles.loadMessage}>{error} <button type="button" className="text-button"
        onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
      {total && data && !error && !loading && <>
        <div className={styles.periodCaption}>
          {shortDate(data.range.desde)} – {shortDate(data.range.hasta)} · {sites.length} {sites.length === 1 ? 'recinto' : 'recintos'}
        </div>
        <SummaryStats blocks={[
          { type: 'Metrics', props: { items: [
            { label: 'Rondas', icon: 'route', value: total.patrols, detail: `${total.scheduled} programadas · ${total.voluntary} voluntarias` },
            { label: 'Completadas', icon: 'check', value: total.completed, detail: `${total.active} en curso · ${total.waiting} con inicio atrasado` },
            { label: 'Requieren revisión', icon: 'review', value: review(total), attention: review(total) > 0,
              detail: `${total.incomplete} incompletas · ${total.expired} vencidas` },
            { label: 'Cumplimiento', icon: 'target', value: formatearPorcentaje(total.compliancePct), detail: 'Promedio de rondas cerradas con medición' },
            { label: 'Escaneos con ubicación', icon: 'gps', value: formatearPorcentaje(total.scanGpsPct),
              detail: `${total.scansWithGps} de ${total.scans} escaneos${total.avgAccuracyM === null ? '' : ` · ${meters(total.avgAccuracyM)} de precisión media`}` },
            { label: 'Tareas ejecutadas', icon: 'tasks', value: formatearPorcentaje(total.taskPct),
              detail: `${total.tasksDone} de ${total.tasksExpected} · ${total.tasksFailed} con falla reportada` },
          ] } },
          { type: 'PatrolStates', props: { completed: total.completed, active: total.active, waiting: total.waiting,
            incomplete: total.incomplete, expired: total.expired,
            upcoming: Math.max(0, total.patrols - total.completed - total.active - total.waiting - review(total)) } },
        ]} />
        {!sites.length ? <p className={styles.loadMessage}>Tu cuenta aún no tiene recintos asignados.</p> : <>
          <section className={styles.analysis}>
            <div className={styles.sectionHeader}>
              <h2>Evolución y comparación</h2>
              <label>Métrica<select aria-label="Métrica" value={metric} onChange={event => setMetric(event.target.value as MetricKey)}>
                {Object.entries(metricChoices).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select></label>
            </div>
            <SummaryStats layout="charts" blocks={[
              { type: 'DailyTrend', props: { metric: metricChoices[metric], points } },
              { type: 'Ranking', props: { title: 'Comparación por recinto', scale: 100, items: bars,
                caption: `${metricChoices[metric]} · ${measuredSites.length > 10
                  ? 'Los 10 recintos con menor porcentaje' : 'De menor a mayor porcentaje'}`,
                empty: 'Sin recintos con datos para esta métrica.' } },
            ]} />
          </section>
          {byCompany.length > 1 && <section className={styles.summaryCard}>
            <h2>Por empresa</h2>
            <div className={styles.companyGrid}>{byCompany.map(company => <button type="button" className={styles.companyButton}
              key={company.tenantId} data-review={review(company)>0} onClick={() => setScope(`company:${company.tenantId}`)}>
              <strong>{companyNames.get(company.tenantId)}</strong>
              <span>Por revisar {review(company)} de {company.completed + review(company)}</span>
              <span>{formatearPorcentaje(company.compliancePct)} de cumplimiento</span>
            </button>)}</div>
          </section>}
          <section className={styles.summaryCard}>
            <h2>Detalle por recinto</h2>
            <div className={styles.tableWrapper} role="region" aria-label="Métricas por recinto" tabIndex={0}>
              <table role="table">
                <thead role="rowgroup"><tr role="row"><th scope="col">Recinto</th><th scope="col">Completadas</th><th scope="col">Incompletas</th>
                  <th scope="col">Vencidas</th><th scope="col">Cumplimiento</th><th scope="col">Escaneos</th>
                  <th scope="col">Alertas de escaneo</th><th scope="col">GPS</th><th scope="col">Tareas</th></tr></thead>
                <tbody role="rowgroup">{sites.map(site => <tr role="row" key={site.siteId}>
                  <th scope="row" role="rowheader"><button className="text-button" type="button" onClick={() => setScope(`site:${site.siteId}`)}>
                    {siteNames.get(site.siteId)}</button></th>
                  <td role="cell" data-label="Completadas">{site.completed}</td>
                  <td role="cell" data-label="Incompletas" data-review={site.incomplete>0}>{site.incomplete}</td>
                  <td role="cell" data-label="Vencidas" data-review={site.expired>0}>{site.expired}</td>
                  <td role="cell" data-label="Cumplimiento">{formatearPorcentaje(site.compliancePct)}</td>
                  <td role="cell" data-label="Escaneos">{site.scans}<small>{site.scansNfc} NFC</small></td>
                  <td role="cell" data-label="Alertas de escaneo">{site.scansFlagged}</td>
                  <td role="cell" data-label="GPS">{formatearPorcentaje(site.scanGpsPct)}<small>{meters(site.avgAccuracyM)}</small></td>
                  <td role="cell" data-label="Tareas">{site.tasksExpected > 0 ? `${site.tasksDone}/${site.tasksExpected}` : '—'}<small>{site.tasksFailed} con falla</small></td>
                </tr>)}</tbody>
              </table>
            </div>
            {total.legacyResponses > 0 && <p className="form-note">{total.legacyResponses} respuestas históricas sin una tarea esperada identificable quedan fuera del porcentaje de ejecución.</p>}
          </section>
        </>}
      </>}
    </div>
  );
}
