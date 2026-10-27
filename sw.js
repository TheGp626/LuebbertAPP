const CACHE = 'stundenzettel-v63-exp';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(k => k !== CACHE);
      return Promise.all(oldCaches.map(k => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          // Only notify open tabs when this is a real update (old caches existed),
          // not on a fresh first-time install.
          if (oldCaches.length > 0) {
            return self.clients.matchAll({ type: 'window' }).then(clients =>
              clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
            );
          }
        });
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(new Request(e.request, { cache: 'no-cache' }))
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      // Use no-cache to bypass browser HTTP cache — SW cache is our offline layer
      return fetch(new Request(e.request, { cache: 'no-cache' })).then(res => {
        const url = e.request.url;
        const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|json)(\?|$)/.test(url);
        if (res.ok && url.startsWith(self.location.origin) && isStaticAsset) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Web Push (AL-Erinnerungen) ──
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Lübbert App', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || './index.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './index.html', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list[0];
      // navigate() rejects for windows this SW doesn't control (e.g. after a hard reload) → open a fresh one
      if (win) return win.navigate(url).then(w => (w || win).focus()).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    })
  );
});
