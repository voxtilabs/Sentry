import { pedirApi } from './guard-outbox';

/** Confirm first, then replace the document so an offline router cache cannot retain the closed round. */
export async function confirmarTerminoDeRonda(apiUrl: string, patrolId: string,
  navegar: (path: string) => void, pedir: typeof pedirApi = pedirApi): Promise<void> {
  const response = await pedir(apiUrl, `/guard/patrols/${patrolId}/confirm-flow`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : 'No pudimos confirmar el cierre. Intenta nuevamente.');
  }
  navegar('/app/guardia');
}
