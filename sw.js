/* Service worker de Sustituciones CEVI.
 *
 * Estrategia:
 * - APP SHELL (index.html, manifest, iconos, Leaflet/Google Fonts de CDN):
 *   stale-while-revalidate → arranque instantáneo y uso offline de la interfaz.
 * - DATOS (plazas.json e historico/*): SIEMPRE red primero. La caché es solo
 *   respaldo sin conexión y se marca con la cabecera X-Desde-Cache para que
 *   la app avise: mostrar plazas de otra semana como actuales sería un fallo
 *   grave.
 * - PUSH: NO activado, a propósito. Requeriría un servidor de push que rompe
 *   el modelo 100% estático; el canal de aviso de CEVI es el email del
 *   formulario de suscripción. Si algún día se añade, este fichero es el
 *   sitio (self.addEventListener('push', ...)).
 */
'use strict';

const VERSION = 'docentes-v8';
const CACHE_SHELL = 'shell-' + VERSION;
const CACHE_DATOS = 'datos-' + VERSION;
const PRECACHE = [
  './',
  'manifest.webmanifest',
  'marca/icono-app-192.png',
  'marca/icono-app-512.png',
  'marca/icono-app-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_SHELL)
      // cache:'reload' salta la caché HTTP del navegador: el precache debe
      // venir SIEMPRE fresco del servidor
      .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const esDato = url => url.origin === self.location.origin &&
  (/\/plazas\.json$/.test(url.pathname) || /\/historico\//.test(url.pathname));

async function redPrimero(req) {
  try {
    const r = await fetch(req);
    if (r && r.ok) {
      const copia = r.clone();
      caches.open(CACHE_DATOS).then(c => c.put(req, copia));
    }
    return r;
  } catch (err) {
    const cacheada = await caches.match(req, { ignoreSearch: false });
    if (!cacheada) throw err;
    // Señal para que la app muestre "estás viendo datos guardados"
    const cuerpo = await cacheada.blob();
    const headers = new Headers(cacheada.headers);
    headers.set('X-Desde-Cache', '1');
    return new Response(cuerpo, { status: 200, statusText: 'OK (cache)', headers });
  }
}

async function casiSiempreCache(req, clave) {
  const cacheada = await caches.match(clave || req);
  // no-cache: revalidar contra el servidor, no contra la caché HTTP heurística
  // del navegador (sin esto, el shell podría no actualizarse nunca)
  const red = fetch(req, { cache: 'no-cache' }).then(r => {
    if (r && (r.ok || r.type === 'opaque')) {
      const copia = r.clone();
      caches.open(CACHE_SHELL).then(c => c.put(clave || req, copia));
    }
    return r;
  }).catch(() => cacheada);
  return cacheada || red;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (esDato(url)) {
    e.respondWith(redPrimero(req));
    return;
  }
  if (req.mode === 'navigate') {
    // cualquier URL de la app (con o sin parámetros) sirve el mismo shell
    e.respondWith(casiSiempreCache(req, './'));
    return;
  }
  e.respondWith(casiSiempreCache(req));
});
