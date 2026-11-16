import type { Metadata } from 'next';
import Link from 'next/link';

import { FeedbackForm } from '../_components/feedback-form';

export const metadata: Metadata = { title: 'Ayuda y reportes · SentryCore' };

export default function HelpPage() {
  return <main className="support-page">
    <h1>Ayuda y reportes de SentryCore</h1>
    <FeedbackForm />
    <nav aria-label="Ayuda"><Link href="/seguridad-infantil">Estándares de seguridad infantil</Link> · <Link href="/">Volver a SentryCore</Link></nav>
  </main>;
}
