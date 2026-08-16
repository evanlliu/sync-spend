const CACHE_NAME = "sync-spend-shell-v095";
const RELATIVE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/css/app.css",
  "./src/css/liquid.css",
  "./src/js/app.js",
  "./src/js/api.js",
  "./src/js/calculator.js",
  "./src/js/crypto.js",
  "./src/js/currency.js",
  "./src/js/i18n.js",
  "./src/js/migration.js",
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
const APP_SHELL_SET = new Set(APP_SHELL);

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

  // GitHub / Frankfurter 等跨域 API 永远直接走网络，不进入 Cache Storage。
  if (url.origin !== self.location.origin) return;

  // 连接配置和发布包占位数据永远只走网络；失败时不回退旧缓存。
  if (url.pathname.endsWith("/data/config.json") || url.pathname.endsWith("/data/data.json")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.method !== "GET") return;

  // App Shell 在线时 network-first，避免已安装 PWA 长时间运行旧 JS/CSS；
  // 仅静态外壳在断网时允许回退缓存，业务数据本身没有离线缓存。
  if (request.mode === "navigate" || APP_SHELL_SET.has(url.toString())) {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}
