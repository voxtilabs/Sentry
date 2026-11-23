'use client';

import { forgetOfflineRound } from './guard-offline-session';
import { useState } from 'react';

import { crearClientePuente } from '../_lib/bridge/web-client';
import { withSessionChange } from './use-session-refresh';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setLoading(true);
    setError('');
    try {
      const response = await withSessionChange(() => fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
          signal: AbortSignal.timeout(10_000),
        },
      ));
      if (!response.ok) throw new Error();
    } catch {
      setError('No se pudo cerrar sesión. Revisa la conexión y vuelve a intentarlo.');
      setLoading(false);
      return;
    }
    try {
      forgetOfflineRound();
      const puente = crearClientePuente();
      try {
        const estado = await puente.conectar().catch(() => undefined);
        if (estado?.clase === 'listo' && estado.info.protocolo.minor >= 1) {
          await puente.borrarRutaOffline().catch(() => undefined);
        }
      } finally {
        puente.desconectar();
      }
    } finally {
      if (typeof window !== 'undefined') {
        window.location.replace('/');
      }
    }
  }

  return (
    <>
      <button className="secondary-button" disabled={loading} onClick={logout} type="button">
        {loading ? 'Saliendo…' : 'Cerrar sesión'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
