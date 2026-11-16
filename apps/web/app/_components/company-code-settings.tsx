'use client';

import { useEffect, useRef, useState } from 'react';

export function CompanyCodeSettings({ endpoint, initialCode }: { endpoint: string; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [configured, setConfigured] = useState(Boolean(initialCode));
  const [busy, setBusy] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState('');
  const action = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('No pudimos consultar el código de empresa.');
      const value = await response.json() as { configured: boolean };
      setConfigured(value.configured); setAllowed(true);
    }).catch(() => { if (!controller.signal.aborted) setMessage('No pudimos consultar el código de empresa.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [endpoint]);

  async function generate() {
    if (action.current || !allowed) return;
    if (configured && !window.confirm('El código anterior dejará de funcionar para ingresar y elegir guardias. ¿Generar uno nuevo?')) return;
    action.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include',
        signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('No pudimos generar el código. Inténtalo nuevamente.');
      const value = await response.json() as { code: string };
      if (!/^[A-Z0-9]{10}$/.test(value.code)) throw new Error('No pudimos confirmar el nuevo código. Vuelve a generarlo.');
      setCode(value.code); setConfigured(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No pudimos generar el código.'); }
    finally { action.current = false; setBusy(false); }
  }

  return <div className="company-code-settings">
    <h4>Código de acceso de la empresa</h4>
    <p>Los guardias escriben este código y eligen su nombre. Tiene 10 letras y números en mayúsculas.</p>
    {code ? <div className="company-code-generated">
      <output aria-label="Código generado" className="company-code-value">{code}</output>
      <button type="button" className="secondary-button" onClick={() => {
        if (!navigator.clipboard) { setMessage('Selecciona el código y cópialo para entregarlo a los guardias.'); return; }
        void navigator.clipboard.writeText(code).then(() => setMessage('Código copiado.'))
          .catch(() => setMessage('Selecciona el código y cópialo para entregarlo a los guardias.'));
      }}>Copiar código</button>
      <p className="form-note">Guárdalo y entrégalo a los guardias. Por seguridad solo se muestra al generarlo; después puedes crear otro.</p>
    </div> : <p className="form-note">{configured ? 'La empresa ya tiene un código activo. Puedes generar otro si necesitas reemplazarlo.' : 'Aún no se ha generado un código para esta empresa.'}</p>}
    <button type="button" className="primary-button" disabled={busy || !allowed} onClick={() => void generate()}>
      {busy ? 'Consultando…' : configured ? 'Generar nuevo código' : 'Generar código de empresa'}
    </button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
