import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuardHome } from './guard-home';
import { useRecuperarTareasGuardadas } from './guard-tareas-recuperacion';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock('./use-guard-bridge', () => ({ useGuardBridge: () => ({ divulgacionPendiente: false }) }));
jest.mock('./guard-tareas-recuperacion', () => ({ useRecuperarTareasGuardadas: jest.fn() }));

it('la portada sin ronda asignada monta la recuperación de evidencia de rondas anteriores', () => {
  const html = renderToStaticMarkup(createElement(GuardHome, { data: { hasAssignment: false,
    synchronization: { pendingItems: 0 } }, apiUrl: '/api' }));
  expect(html).toContain('No tienes una ronda asignada');
  expect(useRecuperarTareasGuardadas).toHaveBeenCalledWith('/api', undefined);
});
