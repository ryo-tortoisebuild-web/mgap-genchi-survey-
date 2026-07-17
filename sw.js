/* 最小Service Worker：ネットワーク優先＋オフライン時のみキャッシュ利用。
   （cache-firstだとアプリ更新が届かなくなるためnetwork-first）
   完全オフライン対応はスコープ外。失敗しても本体機能に影響しない */
var CACHE = 'genchi-survey-v15';
var CORE = [
  './',
  './index.html',
  './css/style.css',
  './css/print.css',
  './js/config.js',
  './js/constants.js',
  './js/store.js',
  './js/ui.js',
  './js/api.js',
  './js/sync.js',
  './js/auth.js',
  './js/photo.js',
  './js/draw.js',
  './js/input.js',
  './js/editor.js',
  './js/card.js',
  './js/annotate.js',
  './js/output.js',
  './js/app.js',
  './manifest.webmanifest',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  /* 同一オリジンのアプリ資産のみキャッシュ対象。
     APIやアップロード画像（別オリジン）はネットワーク直通（古い応答を返さない） */
  var sameOrigin = e.request.url.indexOf(self.location.origin) === 0;
  if (!sameOrigin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
