'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  IconActivity, IconAdjustments, IconBuilding, IconBuildingCommunity, IconCalendar,
  IconChartBar, IconClipboardCheck, IconDashboard, IconDeviceMobile, IconFingerprint,
  IconMail, IconMapPin, IconMenu2, IconPalette, IconRoute, IconScale, IconUsers, IconX,
} from '@tabler/icons-react';

import { PANEL_NAVIGATION, type PanelRole } from './panel-navigation';
import styles from './panel-shell.module.css';

const icons = {
  resumen: IconDashboard, visitas: IconClipboardCheck, informes: IconChartBar,
  envios: IconMail, personas: IconUsers, recintos: IconBuilding,
  reglas: IconAdjustments, marca: IconPalette, cumplimiento: IconScale,
  diagnostico: IconActivity, sesiones: IconDeviceMobile, planificacion: IconCalendar,
  'ronda-patron': IconRoute, terreno: IconFingerprint, monitoreo: IconActivity,
  consentimiento: IconMapPin,
};

export function PanelLinks({ role, activeView, onNavigate }: {
  role: PanelRole; activeView: string; onNavigate?: () => void;
}) {
  return <nav aria-label="Navegación principal" className={styles.navigation}>
    {PANEL_NAVIGATION[role].map(group => <div className={styles.navGroup} key={group.label}>
      <span className={styles.groupLabel}>{group.label}</span>
      {group.items.map(item => {
        const Icon = role === 'SUPERADMIN' && item.view === 'resumen'
          ? IconBuildingCommunity : icons[item.view as keyof typeof icons] ?? IconDashboard;
        return <a key={item.view} href={`?vista=${item.view}`}
          aria-current={item.view === activeView ? 'page' : undefined}
          className={styles.navLink} onClick={onNavigate}>
          <Icon size={19} stroke={1.6} aria-hidden="true" />
          <span>{item.label}</span>
        </a>;
      })}
    </div>)}
  </nav>;
}

/** Native dialog supplies focus trapping, Escape and focus return on mobile. */
export function PanelMenu({ role, activeView, name }: {
  role: PanelRole; activeView: string; name: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close(); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  return <>
    <button ref={trigger} type="button" className={styles.menuButton}
      aria-controls={id} aria-expanded={open} aria-label="Abrir menú de navegación"
      onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
      <IconMenu2 size={20} stroke={1.7} aria-hidden="true" /> Menú
    </button>
    <dialog ref={dialog} id={id} className={styles.drawer} aria-labelledby={`${id}-heading`}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current?.close();
      }}>
      <div className={styles.drawerHeading}>
        <strong id={`${id}-heading`}>{name}</strong>
        <button type="button" aria-label="Cerrar menú de navegación" onClick={() => dialog.current?.close()}>
          <IconX size={23} stroke={1.7} aria-hidden="true" />
        </button>
      </div>
      <PanelLinks role={role} activeView={activeView} onNavigate={() => dialog.current?.close()} />
    </dialog>
  </>;
}
