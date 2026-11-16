import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

/** Exercise the real sampler with an Android port and a controllable clock. */
const load = createRequire(__filename);
const moduleLoader = Module as unknown as { _load: (name: string, parent?: { filename?: string }, isMain?: boolean) => unknown };
const originalLoad = moduleLoader._load;
const location = {
  Accuracy: { BestForNavigation: 6 },
  getForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async (_options: unknown): Promise<Fix | null> => fix(),
  getLastKnownPositionAsync: async (_options: unknown): Promise<Fix | null> => null,
  watchPositionAsync: async (_options: unknown, _onFix: unknown) => ({ remove: () => undefined }),
};
type Fix = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number } };
const fix = (age = 0): Fix => ({ timestamp: Date.now() - age, coords: { latitude: 0, longitude: 0, accuracy: 5 } });
moduleLoader._load = (name, parent, isMain) => {
  if (name === 'expo-location') return location;
  if (name === './traza-fondo' && parent?.filename?.endsWith('/geo/traza.ts')) {
    return { iniciarTrazaEnSegundoPlano: async () => undefined, detenerTrazaEnSegundoPlano: async () => undefined };
  }
  return originalLoad(name, parent, isMain);
};
const sampler = load('./traza') as typeof import('./traza');
moduleLoader._load = originalLoad;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('mantiene el receptor activo solo durante la ronda y lo retira al terminar', async () => {
  let removed = 0;
  let watched = 0;
  location.watchPositionAsync = async (options) => {
    assert.equal((options as { accuracy: number }).accuracy, location.Accuracy.BestForNavigation);
    watched += 1;
    return { remove: () => { removed += 1; } };
  };
  const points: unknown[] = [];
  await sampler.iniciarTraza({ intervalSeconds: 30 }, (point) => points.push(point));
  await flush();
  sampler.detenerTraza();
  assert.equal(watched, 1);
  assert.equal(removed, 1);
  assert.equal(points.length, 1);
});

test('una lectura que llega después de cerrar la ronda no emite ubicación', async () => {
  let resolveFix: (value: Fix) => void = () => undefined;
  location.getCurrentPositionAsync = () => new Promise<Fix>((resolve) => { resolveFix = resolve; });
  const points: unknown[] = [];
  await sampler.iniciarTraza({ intervalSeconds: 30 }, (point) => points.push(point));
  sampler.detenerTraza();
  resolveFix(fix());
  await flush();
  assert.equal(points.length, 0);
});

test('no presenta una posición vieja como si fuera actual', async () => {
  location.getCurrentPositionAsync = async () => fix(60_000);
  const points: unknown[] = [];
  await sampler.iniciarTraza({ intervalSeconds: 30 }, (point) => points.push(point));
  await flush();
  sampler.detenerTraza();
  assert.equal(points.length, 0);
});

test('cerrar mientras Android consulta el permiso cancela también ese inicio', async () => {
  let resolvePermission: (value: { status: string }) => void = () => undefined;
  location.getForegroundPermissionsAsync = () => new Promise((resolve) => { resolvePermission = resolve; });
  let watched = false;
  location.watchPositionAsync = async () => { watched = true; return { remove: () => undefined }; };
  const pending = sampler.iniciarTraza({ intervalSeconds: 30 }, () => assert.fail('ronda cerrada'));
  sampler.detenerTraza();
  resolvePermission({ status: 'granted' });
  await pending;
  sampler.detenerTraza();
  assert.equal(watched, false);
});
