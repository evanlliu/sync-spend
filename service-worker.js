const CACHE_NAME = "sync-spend-shell-v088";
const RELATIVE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/css/app.css",
  "./src/css/liquid.css",
  "./src/js/app.js",
  "./src/js/api.js",
  "./src/js/calculator.js",
  "./src/js/currency.js",
  "./src/js/i18n.js",
  "./src/js/store.js",
  "./src/js/utils.js",
  "./src/js/version.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon-180.png"
];

function toAbsoluteUrl(path) {
  return new URL(path, self.location.href).toString();
}

const APP_SHELL = RELATIVE_APP_SHELL.map(toAbsoluteUrl);
const INDEX_URL = toAbsoluteUrl("./index.html");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // data/config.json 要实时读取；Worker API 是跨域请求，也不要放进本地缓存。
  if (url.pathname.endsWith("/data/config.json") || url.pathname.endsWith("/data/data.json") || url.pathname.includes("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(INDEX_URL).then((cached) => {
        const fresh = fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy));
          return response;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  if (request.method !== "GET") return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }))
  );
});
