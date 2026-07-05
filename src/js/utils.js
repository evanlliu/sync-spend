export function uid(prefix = "id") {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random).map((n) => n.toString(36)).join("")}`;
}

export function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(document.documentElement.lang || "zh-CN");
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(document.documentElement.lang || "zh-CN");
}

export function money(value, currency = "CNY") {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function number2(value) {
  return Number(value || 0).toFixed(2);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeData(data) {
  return {
    schemaVersion: 1,
    updatedAt: data?.updatedAt || null,
    ledgers: Array.isArray(data?.ledgers) ? data.ledgers : []
  };
}

export function normalizeConfig(config) {
  const fallback = {
    schemaVersion: 1,
    app: { name: { "zh-CN": "同步记账", "en-US": "Sync Spend" }, version: "0.6.4", defaultLanguage: "zh-CN", baseCurrency: "CNY", imageMaxWidth: 1600, imageQuality: 0.72 },
    consumers: [],
    currencies: [
      { code: "CNY", name: { "zh-CN": "人民币", "en-US": "Chinese Yuan" }, symbol: "¥" },
      { code: "MXN", name: { "zh-CN": "墨西哥比索", "en-US": "Mexican Peso" }, symbol: "$" },
      { code: "TRY", name: { "zh-CN": "土耳其里拉", "en-US": "Turkish Lira" }, symbol: "₺" }
    ],
    exchange: { provider: "frankfurter", endpoint: "https://api.frankfurter.dev/v2/rates", base: "CNY", quotes: ["MXN", "TRY"], cacheSeconds: 0 }
  };
  const exchange = { ...fallback.exchange, ...(config?.exchange || {}) };
  delete exchange.manualToCny;

  return {
    ...fallback,
    ...config,
    app: { ...fallback.app, ...(config?.app || {}) },
    exchange,
    consumers: Array.isArray(config?.consumers) ? config.consumers : fallback.consumers,
    currencies: Array.isArray(config?.currencies) ? config.currencies : fallback.currencies
  };
}

export function isStandalonePwa() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function isIosSafari() {
  const ua = window.navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  return iOS && webkit && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, html, attrs, dataset, on } = options;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? "" : value);
    }
  }
  if (dataset) {
    for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  }
  if (on) {
    for (const [event, handler] of Object.entries(on)) node.addEventListener(event, handler);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export async function imageFileToDataUrl(file, maxWidth = 1600, quality = 0.72) {
  if (!file) return null;
  const source = await loadImageSource(file);
  const scale = Math.min(1, maxWidth / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  if (source.close) source.close();
  return canvas.toDataURL("image/jpeg", quality);
}

async function loadImageSource(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // iOS / Safari 个别格式可能失败，降级到 HTMLImageElement。
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
