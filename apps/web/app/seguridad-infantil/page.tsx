import type { Metadata } from 'next';
import Link from 'next/link';

import { ChildSafetyStandards } from '../_components/child-safety-standards';

export const metadata: Metadata = {
  title: 'Seguridad infantil · SentryCore',
  description: 'Estándares de SentryCore contra la explotación y el abuso sexual infantil, reportes y contacto responsable.',
};

export default function ChildSafetyPage() {
  return <main className="support-page">
    <ChildSafetyStandards />
    <nav aria-label="Ayuda"><Link href="/ayuda">Enviar un reporte</Link> · <Link href="/">Volver a SentryCore</Link></nav>
  </main>;
}
