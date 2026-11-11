import type { CSSProperties, ReactNode } from 'react';
import { IconChevronRight, IconCircleCheck, IconUserCircle } from '@tabler/icons-react';

import { Brand } from './brand';
import type { MarcaDelShell } from './dashboard-shell';
import { HelpButton } from './help-button';
import { LogoutButton } from './logout-button';
import { PanelLinks, PanelMenu } from './panel-menu';
import { PANEL_NAVIGATION, type PanelRole } from './panel-navigation';
import { SesionViva } from './sesion-viva';
import styles from './panel-shell.module.css';

const roleNames: Record<PanelRole, string> = {
  SUPERADMIN: 'Superadministración', ADMIN: 'Administración', SUPERVISOR: 'Supervisión',
};

/** Administrative surface only. Guard markup and styles stay in DashboardShell. */
export function PanelShell({ role, title, subtitle, children, marca, activeView }: {
  role: PanelRole; title: string; subtitle: string; children: ReactNode;
  marca?: MarcaDelShell; activeView: string;
}) {
  const group = PANEL_NAVIGATION[role].find(g => g.items.some(item => item.view === activeView));
  const item = group?.items.find(link => link.view === activeView);
  const name = marca?.commercialName ?? 'SentryCore';
  return <main className={`dashboard-shell ${styles.workspace}`} data-role={role}
    style={marca?.cssVariables as CSSProperties}>
    <SesionViva />
    <a className={styles.skipLink} href="#panel-main-content">Ir al contenido</a>
    <aside className={styles.sidebar} aria-label="Panel administrativo">
      <Brand nombre={marca?.commercialName} logoUri={marca?.logoUri} />
      <PanelLinks role={role} activeView={activeView} />
      <div className={styles.account}>
        <IconUserCircle size={27} stroke={1.5} aria-hidden="true" />
        <div><strong>{name}</strong><span>{roleNames[role]}</span></div>
      </div>
    </aside>
    <section className={styles.main}>
      <header className={styles.utility}>
        <PanelMenu role={role} activeView={activeView} name={name} />
        <div className={styles.context}><strong>{name}</strong><span>{roleNames[role]}</span></div>
        <div className={styles.actions}>
          <span className={styles.session}><IconCircleCheck size={17} stroke={1.7} aria-hidden="true" /> Sesión activa</span>
          <HelpButton />
          <LogoutButton />
        </div>
      </header>
      <div className={styles.body} id="panel-main-content" tabIndex={-1}>
        <div className={styles.heading}>
          <div className={styles.breadcrumb} aria-label="Ubicación actual">
            <span>{group?.label ?? roleNames[role]}</span>
            <IconChevronRight size={14} aria-hidden="true" />
            <span>{item?.label ?? title}</span>
          </div>
          <h1>{title}</h1><p>{subtitle}</p>
        </div>
        <div className={styles.content} key={activeView}>{children}</div>
      </div>
    </section>
  </main>;
}
