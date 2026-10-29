// Modo sin señal: guarda la app en el teléfono la primera vez y después la abre desde ahí.
// Cuando hay señal, baja en segundo plano la versión nueva, que se ve la próxima vez que se abre.
// Al cambiar archivos de la app, subir VERSION para que el teléfono descarte lo viejo.
const VERSION = 'aspersia-v1';
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/estilos.css',
  'app/calculo.js',
  'app/pantalla.js',
  'datos/hunter-2026.js',
  'datos/czerweny.js',
  'app/iconos/icono-180.png',
  'app/iconos/icono-192.png',
  'app/iconos/icono-512.png',
  'app/iconos/icono-maskable-512.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Responde con lo guardado (rápido y sin señal) y, si hay señal, actualiza la copia guardada.
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET' || new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(caches.open(VERSION).then(async cache => {
    const guardada = await cache.match(ev.request, { ignoreSearch: true });
    const deRed = fetch(ev.request)
      .then(resp => { if (resp.ok) cache.put(ev.request, resp.clone()); return resp; })
      .catch(() => null);
    if (guardada) { ev.waitUntil(deRed); return guardada; }
    return (await deRed) || new Response('Sin señal y sin copia guardada de este archivo.', { status: 503 });
  }));
});
