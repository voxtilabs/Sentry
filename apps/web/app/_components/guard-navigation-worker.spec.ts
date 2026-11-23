import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(join(__dirname, '../../public/sw-tiles.js'), 'utf8');
const origin = 'https://portal.example';

function navigation(url: string, userAgent: string, cached: boolean) {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetch = jest.fn().mockResolvedValue({ ok: true });
  const respondWith = jest.fn();
  runInNewContext(source, {
    self: {
      location: { origin }, navigator: { userAgent },
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    },
    caches: { open: async () => ({ match: async () => cached }) },
    fetch, URL, Headers, AbortController, setTimeout, clearTimeout,
  });
  handlers.get('fetch')!({
    request: { method: 'GET', mode: 'navigate', url, headers: new Headers({ 'User-Agent': userAgent }) },
    respondWith,
  });
  return { fetch, response: respondWith.mock.calls[0]?.[0] };
}

describe('navegación del guardia a través del service worker', () => {
  it.each([true, false])('conserva el indicador de Android al abrir un documento (caché %s)', async cached => {
    const attempt = navigation(origin + '/app/guardia', 'Mozilla/5.0 SentryCoreAndroid/0.3.7', cached);
    await attempt.response;
    const options = attempt.fetch.mock.calls[0]?.[1];
    expect(options?.headers?.get('X-Requested-With')).toBe('com.voxtilabs.sentrycore');
    expect(options.redirect).toBe('manual');
  });

  it.each([
    [origin + '/app/guardia', 'Mozilla/5.0 Chrome/157'],
    ['https://other.example/app/guardia', 'SentryCoreAndroid/0.3.7'],
    [origin + '/api/auth/session', 'SentryCoreAndroid/0.3.7'],
  ])('deja pasar el navegador, otros orígenes y la API (%s)', (url, agent) => {
    expect(navigation(url, agent, true).response).toBeUndefined();
  });
});
