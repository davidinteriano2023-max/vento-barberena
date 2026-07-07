/* Service Worker — Vento Barberena PWA */
var CACHE = 'vb-cache-v1';
var CORE = ['/', '/cotizador.html', '/tabi-widget.js', '/logo-vento.svg', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Navegación (HTML): red primero, caché como respaldo (para ver siempre precios/HTML frescos)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('/'); });
      })
    );
    return;
  }

  // Mismo origen (estáticos): caché primero con actualización en segundo plano
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var fresh = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || fresh;
      })
    );
  }
  // Terceros (Firebase, Cloudinary, fuentes): pasa directo a la red
});
