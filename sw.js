// サービスワーカー：アプリのファイルを端末に保存し、圏外でも開けるようにする。
// ファイルを直したら CACHE_NAME の数字を上げる（古い保存分が入れ替わる）。
const CACHE_NAME = 'habit-tracker-v4';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './habits.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 保存してあるファイルを先に使う。無ければネットから取る。
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => {
        // 圏外で画面そのものを開こうとしたときは、トップ画面を返す
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});
