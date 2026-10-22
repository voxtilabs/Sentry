'use client';

import { useEffect, useState, type FormEvent } from 'react';

export function CompanyCardSettings({ apiUrl, role, tenantId }: {
  apiUrl: string; role: 'admin' | 'supervisor' | 'superadmin'; tenantId?: string;
}) {
  const [uid, setUid] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const endpoint = role === 'superadmin' ? `${apiUrl}/platform/tenants/${tenantId}/company-card` : `${apiUrl}/${role}/company-card`;
  useEffect(() => {
    let active = true;
    void fetch(endpoint, { credentials: 'include', cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error();
      const value = await response.json() as { cardUid: string | null };
      if (active) setUid(value.cardUid ?? '');
    }).catch(() => { if (active) setMessage('No pudimos consultar la tarjeta de empresa.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [endpoint]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardUid: uid }) });
      const result = await response.json() as { message?: string; cardUid?: string | null };
      if (!response.ok) throw new Error(result.message ?? 'No pudimos guardar la tarjeta.');
      setUid(result.cardUid ?? '');
      setMessage(uid ? 'Tarjeta de empresa guardada.' : 'Tarjeta de empresa retirada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pudimos guardar la tarjeta.');
    } finally { setBusy(false); }
  }
  return <section className="management-card management-wide">
    <div className="card-heading"><h3>Tarjeta de acceso de la empresa</h3></div>
    <p>Al acercar esta tarjeta, el teléfono muestra los guardias activos de la empresa para elegir quién inicia su ronda.</p>
    <form className="management-form" onSubmit={(event) => void save(event)}>
      <label>UID de la tarjeta NFC<input value={uid} maxLength={64} onChange={(event) => setUid(event.target.value)}
        placeholder="UID hexadecimal de la tarjeta" autoComplete="off" /></label>
      <p className="form-note">Deja el campo vacío para retirar este acceso.</p>
      <button className="primary-button" disabled={busy}>Guardar tarjeta de empresa</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
