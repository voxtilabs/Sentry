'use client';

import { createRenderer } from '@json-render/react';
import { IconAlertCircle, IconBuilding, IconCircleCheck, IconClipboardCheck, IconCrosshair, IconMapPin,
  IconRoute, IconTarget, IconUsers } from '@tabler/icons-react';
import { summaryCatalog } from './summary-catalog';
import { formatearEntero, formatearPorcentaje } from './stats-charts-data';
import { SerieCumplimiento } from './stats-charts-svg';
import styles from './summary-stats.module.css';

const icons = { route: IconRoute, check: IconCircleCheck, review: IconAlertCircle, target: IconTarget,
  gps: IconCrosshair, tasks: IconClipboardCheck, company: IconBuilding, users: IconUsers, sites: IconMapPin };
const statuses = { completed: 'Completadas', active: 'En curso', waiting: 'Inicio atrasado', incomplete: 'Incompletas', expired: 'Vencidas', upcoming: 'Programadas por iniciar' } as const;
const dayLabel = (day: string) => day.slice(0, 10).split('-').reverse().join('/');

export default createRenderer(summaryCatalog, {
  Grid: ({ element: { props }, children }) => <div className={styles[props.layout]}>{children}</div>,
  Metrics: ({ element: { props } }) => <dl className={styles.metrics}>
    {props.items.map(item => {
      const Icon = icons[item.icon];
      return <div key={item.label} className={styles.metric} data-attention={item.attention || undefined}>
        <dt><Icon size={18} stroke={1.7} aria-hidden="true" />{item.label}</dt>
        <dd><strong>{typeof item.value === 'number' ? formatearEntero(item.value) : item.value}</strong>
          <small>{item.detail}</small></dd>
      </div>;
    })}
  </dl>,
  PatrolStates: ({ element: { props } }) => {
    const keys = Object.keys(statuses) as Array<keyof typeof statuses>;
    const total = keys.reduce((sum, key) => sum + props[key], 0);
    return <section className={styles.panel}>
      <h3>Estado de las rondas</h3>
      {total ? <>
        <div className={styles.distribution} aria-hidden="true">{keys.filter(key => props[key] > 0).map(key =>
          <span key={key} data-status={key} style={{ flexGrow: props[key] }} />)}</div>
        <dl className={styles.legend}>{keys.map(key => <div key={key}><dt><i aria-hidden="true" data-status={key} />{statuses[key]}</dt>
          <dd>{formatearEntero(props[key])}</dd></div>)}</dl>
      </> : <p>Sin rondas en el período.</p>}
    </section>;
  },
  DailyTrend: ({ element: { props: { metric, points } } }) => {
    const measured = points.filter(point => point.compliancePct !== null);
    return <section className={styles.panel}>
      <h3>Evolución diaria</h3><p>{metric}</p>
      {measured.length > 0 ? <>
        <SerieCumplimiento puntos={points} granularidad="dia" ariaLabel={`Evolución diaria de ${metric.toLowerCase()}`} />
        <details className={styles.detail}><summary>Ver valores por día</summary>
          <table><thead><tr><th scope="col">Día</th><th scope="col">{metric}</th></tr></thead>
            <tbody>{points.map(point => <tr key={point.bucket}><th scope="row">{dayLabel(point.bucket)}</th>
              <td>{formatearPorcentaje(point.compliancePct)}</td></tr>)}</tbody></table>
        </details>
      </> : <p>Sin mediciones en el período.</p>}
    </section>;
  },
  Ranking: ({ element: { props } }) => <section className={styles.panel}>
    <h3>{props.title}</h3>{props.items.length ? <><p>{props.caption}</p>
      <ol className={styles.ranking}>{props.items.map(item => <li key={item.key}>
        <div><span>{item.label}</span>{item.attention && <small>Por revisar</small>}<strong>{item.display}</strong></div>
        <div className={styles.track} aria-hidden="true"><i data-attention={item.attention || undefined}
          style={{ width: `${props.scale > 0 ? Math.min(100, 100 * item.value / props.scale) : 0}%` }} /></div>
      </li>)}</ol></> : <p>{props.empty}</p>}
  </section>,
});
