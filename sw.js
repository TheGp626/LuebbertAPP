const CACHE = 'stundenzettel-v117-exp';
const ASSETS = ['./index.html', './manifest.json'];

// Offline start needs every script/stylesheet of index.html (own files + CDN libs): the install step reads
// index.html and caches whatever it references, so this list never has to be kept in sync by hand.
// Own files are required (install fails → old SW stays); CDN files are best effort (opaque no-cors responses are fine for <script>).
function assetUrlsOf(html) {
  const urls = [];
  const add = u => { if (u && !/^(data|blob):/.test(u) && !urls.includes(u)) urls.push(u); };
  (html.match(/<script[^>]*>/gi) || []).forEach(t => add((/src\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]));
  (html.match(/<link[^>]*>/gi) || []).forEach(t => {
    if (/rel\s*=\s*["']stylesheet["']/i.test(t)) add((/href\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]);
  });
  return urls.map(u => new URL(u, self.registration.scope).href);
}

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS);
  const res = await fetch(new Request('./index.html', { cache: 'no-cache' }));
  const urls = assetUrlsOf(await res.text());
  const own = urls.filter(u => u.startsWith(self.location.origin));
  const cdn = urls.filter(u => !u.startsWith(self.location.origin));
  await Promise.all(own.map(u => fetch(new Request(u, { cache: 'no-cache' })).then(r => {
    if (!r.ok) throw new Error('precache failed: ' + u);
    return cache.put(u, r);
  })));
  await Promise.all(cdn.map(u => fetch(new Request(u, { mode: 'no-cors' })).then(r => cache.put(u, r)).catch(() => {})));
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
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
          // Only a real page replaces the offline copy (not a 404 / captive-portal redirect)
          if (res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', clone));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      const url = e.request.url;
      // CDN scripts (supabase-js, jsPDF, …) are cached on first load; no-cache stays for own files only
      if (!url.startsWith(self.location.origin)) {
        return fetch(e.request).then(res => {
          if ((res.ok || res.type === 'opaque') && e.request.method === 'GET' && /\.(js|css|woff2?)(\?|$)|\/npm\//.test(url)) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      }
      // Use no-cache to bypass browser HTTP cache — SW cache is our offline layer
      return fetch(new Request(e.request, { cache: 'no-cache' })).then(res => {
        const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|json)(\?|$)/.test(url);
        if (res.ok && isStaticAsset) {
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
