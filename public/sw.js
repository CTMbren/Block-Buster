// Offline support. Pages are network-first (so new deploys show up straight away);
// everything else (hashed scripts, icons, fonts) is cache-first.
const CACHE = 'block-buster-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

// Also cache the hashed scripts and styles that index.html points to, so the first visit works offline.
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(m => m[1]);
  await c.addAll(assets);
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html', { ignoreVary: true })),
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })),
  );
});
