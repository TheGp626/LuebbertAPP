const CACHE = 'stundenzettel-v24';
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
