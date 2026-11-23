const CACHE_TILES = 'sentrycore-tiles-v1';
const CACHE_SCREEN = 'sentrycore-offline-round-v1';
const SCREEN = '/ronda-sin-conexion';
const RUTA_DE_TILE = /\/\d+\/\d+\/\d+(\.\w+)?(\?|$)/;
const staticAsset = url => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

let preparing;
self.addEventListener('message', event => {
  if (!event.source || new URL(event.source.url).origin !== self.location.origin) return;
  const data = event.data;
  if (data?.type === 'prepare-round-screen') {
    preparing ??= prepareScreen().finally(() => { preparing = undefined; });
    event.waitUntil(preparing.then(() => event.ports[0]?.postMessage(true), () => event.ports[0]?.postMessage(false)));
  } else if (data?.type === 'precache-tiles' && Array.isArray(data.urls)) {
    event.waitUntil(prepareTiles(data.urls.slice(0,240)));
  }
});

async function prepareScreen() {
  const cache = await caches.open(CACHE_SCREEN);
  // This dedicated static page contains only code. Never cache an authenticated
  // document, an API response or Next's per-session server-component payload.
  const response = await fetch(SCREEN, {credentials:'omit',cache:'no-cache'});
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) throw Error('offline-screen-unavailable');
  const html = await response.clone().text();
  const assets = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => new URL(match[1].replaceAll('&amp;', '&'),self.location.origin))
    .filter(staticAsset).map(url => url.href));
  if (!assets.size) throw Error('offline-assets-unavailable');
  assets.add(new URL('/worker-foto-v1.js',self.location.origin).href);
  for (const url of assets) {
    if (!await cache.match(url)) await cache.add(new Request(url,{credentials:'omit'}));
  }
  // Publish only when every referenced asset is available for a cold start.
  await cache.put(SCREEN,response);
  for (const request of await cache.keys()) {
    if (staticAsset(new URL(request.url)) && !assets.has(request.url)) await cache.delete(request);
  }
}

async function prepareTiles(urls) {
  const cache = await caches.open(CACHE_TILES);
  const queue = urls.filter(url => typeof url === 'string' && RUTA_DE_TILE.test(url));
  async function next() {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (await cache.match(url)) continue;
        const res = await fetch(url,{mode:'no-cors',credentials:'omit'});
        if (res.ok || res.type==='opaque') await cache.put(url,res);
      } catch { /* A missing tile must not delay the round. */ }
    }
  }
  await Promise.all([next(),next()]);
}

self.addEventListener('fetch', event => {
  const request=event.request;
  if (request.method!=='GET') return;
  const url=new URL(request.url);
  if (staticAsset(url) || (url.origin===self.location.origin && url.pathname==='/worker-foto-v1.js')) {
    event.respondWith(caches.open(CACHE_SCREEN).then(async cache => (await cache.match(request)) ?? fetch(request)));
    return;
  }
  if (request.mode==='navigate' && url.origin===self.location.origin &&
      ['/', '/app/guardia', SCREEN].includes(url.pathname) &&
      /(?:SentryCore|VoxIA)Android\//.test(request.headers.get('user-agent') || self.navigator.userAgent)) {
    event.respondWith((async () => {
      const cache=await caches.open(CACHE_SCREEN);
      if (url.pathname===SCREEN && url.search==='?reanudar=1') {
        const page=await cache.match(SCREEN);
        if (page) return page;
      }
      if (url.pathname===SCREEN || !await cache.match(SCREEN)) return fetch(request);
      // A radio may stay connected to Wi-Fi while DNS or the gateway has stopped responding.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4_000);
      try { return await fetch(request,{signal:controller.signal}); }
      catch { return Response.redirect(new URL(SCREEN+'?reanudar=1',url).href); }
      finally { clearTimeout(timer); }
    })());
  } else if (request.destination==='image' && RUTA_DE_TILE.test(url.pathname)) {
    event.respondWith(caches.open(CACHE_TILES).then(async cache => {
      const existing=await cache.match(request);
      if (existing) return existing;
      const response=await fetch(request);
      if (response.ok || response.type==='opaque') await cache.put(request,response.clone()).catch(()=>{});
      return response;
    }));
  }
});
