export function uid(prefix = "id") {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random).map((n) => n.toString(36)).join("")}`;
}

export function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeData(data) {
  return {
    schemaVersion: Number(data?.schemaVersion || 2),
    updatedAt: data?.updatedAt || null,
    ledgers: Array.isArray(data?.ledgers) ? data.ledgers : []
  };
}

export function normalizeConfig(config) {
  const fallback = {
    schemaVersion: 1,
    app: { name: { "zh-CN": "同步记账", "en-US": "Sync Spend" }, defaultLanguage: "zh-CN", baseCurrency: "CNY", imageMaxWidth: 1600, imageQuality: 0.72, imageMaxBytes: 972800 },
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

  const normalized = {
    ...fallback,
    ...config,
    app: { ...fallback.app, ...(config?.app || {}) },
    exchange,
    consumers: Array.isArray(config?.consumers) ? config.consumers : fallback.consumers,
    currencies: Array.isArray(config?.currencies) ? config.currencies : fallback.currencies
  };
  delete normalized.cloudflare;
  delete normalized.github;
  return normalized;
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

export async function compressImageFile(file, { maxDimension = 1600, quality = 0.78, maxBytes = 950 * 1024 } = {}) {
  if (!file) return null;
  if (file.type && !String(file.type).startsWith("image/")) throw new Error("Selected file is not an image");

  const source = await loadImageSource(file);
  try {
    const sourceWidth = Number(source.width || source.naturalWidth || 0);
    const sourceHeight = Number(source.height || source.naturalHeight || 0);
    if (!sourceWidth || !sourceHeight) throw new Error("Cannot read image dimensions");

    const limit = Math.max(320, Number(maxDimension) || 1600);
    const targetBytes = Math.min(1024 * 1024, Math.max(128 * 1024, Number(maxBytes) || 950 * 1024));
    const initialQuality = Math.min(0.92, Math.max(0.5, Number(quality) || 0.78));
    let scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
    let currentQuality = initialQuality;
    let lastBlob = null;
    let lastWidth = 0;
    let lastHeight = 0;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas is unavailable");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);

      const blob = await canvasToImageBlob(canvas, currentQuality);
      canvas.width = 1;
      canvas.height = 1;
      if (!blob) throw new Error("Image compression failed");

      lastBlob = blob;
      lastWidth = width;
      lastHeight = height;
      if (blob.size <= targetBytes) return imageBlobResult(blob, width, height);

      if (currentQuality > 0.58) {
        currentQuality = Math.max(0.58, currentQuality - 0.08);
      } else {
        scale *= 0.82;
        currentQuality = initialQuality;
      }
    }

    if (lastBlob && lastBlob.size <= 1024 * 1024) return imageBlobResult(lastBlob, lastWidth, lastHeight);
    throw new Error("Image remains larger than 1 MB after compression");
  } finally {
    if (typeof source.close === "function") source.close();
  }
}

function imageBlobResult(blob, width, height) {
  const mime = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  return {
    blob,
    mime,
    extension: mime === "image/webp" ? "webp" : "jpg",
    size: blob.size,
    width,
    height
  };
}

async function canvasToImageBlob(canvas, quality) {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  return await canvasToBlob(canvas, "image/jpeg", quality);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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

