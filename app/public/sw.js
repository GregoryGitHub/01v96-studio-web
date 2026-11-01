// Service worker: keeps the app shell available when the local server is down,
// so the page can open and report "servidor offline" instead of a browser error.
// Network first (so updates show up immediately), cache as fallback.
const CACHE = '01v96-shell-v2';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/main.js', '/js/store.js', '/js/controls.js', '/js/format.js', '/js/model.js',
  '/js/views/mixer.js', '/js/views/channel.js', '/js/views/effects.js', '/js/views/scenes.js',
  '/data/tables.json', '/data/effects.json', '/data/elements.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname === '/ws' || url.pathname === '/health') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(url.pathname === '/' ? '/' : e.request, copy));
      }
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' && await caches.match('/'));
      return hit || new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
