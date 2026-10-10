/* Modo offline: guarda o app no aparelho para abrir sem internet.
   Para publicar uma versão nova, mude VERSION; o app mostra "Tem uma versão nova do app" para quem estiver usando. */
const VERSION = '1.3.4';
const CORE = 'lm-core-' + VERSION;
const RUNTIME = 'lm-runtime';
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.19.0/';

const FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'src/main.js',
  'src/config.js',
  'src/app.js',
  'src/escala-ui.js',
  'src/util.js',
  'src/music.js',
  'src/parse.js',
  'src/domain.js',
  'src/model.js',
  'src/chords.js',
  'src/youtube.js',
  'src/audio.js',
  'src/stretch.js',
  'src/stretch-worker.js',
  'src/icons.js',
  'src/store-local.js',
  'src/store-firebase.js'
];
const REMOTE = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => FIREBASE + f);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CORE);
    await c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
    const r = await caches.open(RUNTIME);
    await Promise.all(REMOTE.map(u => r.match(u).then(hit => hit || r.add(new Request(u, { mode: 'cors' }))).catch(() => {})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('lm-core-') && k !== CORE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    const c = await caches.open(name);
    c.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(hit => hit || fetch(req)));
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
    return;
  }
  /* Firebase (o programa, não os dados) e fontes: guarda depois da primeira vez */
  if (url.href.startsWith(FIREBASE) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, RUNTIME).catch(() => caches.match(req)));
  }
});
