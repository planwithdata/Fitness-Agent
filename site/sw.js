const prefix = 'fitness-agent:' + self.registration.scope + ':';
const cacheName = prefix + '__DEPLOYMENT_REVISION__';
const assets = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/orbit.svg',
  './lib/coach.js', './lib/domain.js', './lib/records.js', './lib/shell.js', './lib/storage.js', './lib/views.js',
  './lib/import-model.js', './lib/imports-ui.js', './lib/health-import.js', './lib/receipt.js', './lib/pdf-receipt.js',
  './vendor/health-codecs.js', './vendor/pdf.mjs', './vendor/pdf.worker.mjs',
  './nutrition/', './nutrition/index.html', './nutrition/integration.js', './nutrition/theme.css',
  './nutrition/app.js', './nutrition/style.css', './nutrition/core.js', './nutrition/insights.js',
  './nutrition/storage.js', './nutrition/catalog.json',
];
const urls = new Set(assets.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache =>
  cache.addAll([...urls].map(url => new Request(url, { cache: 'reload' }))))));

self.addEventListener('activate', event => event.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))))
  .then(() => self.clients.claim())));

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (!urls.has(url.href)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(url.href)) ?? fetch(request)));
});
