import { clone, normalizeConfig, normalizeData } from "./utils.js";

const CACHE_KEY = "syncSpend.cache";

export const state = {
  ready: false,
  loading: false,
  saving: false,
  refreshing: false,
  error: null,
  view: "dashboard",
  selectedLedgerId: null,
  showArchived: false,
  data: normalizeData(),
  config: normalizeConfig(),
  rates: { provider: "frankfurter", toCny: { CNY: 1 }, fallback: false },
  dataSha: null,
  configSha: null,
  lastSync: null,
  cacheMode: "none",
  remoteReady: false
};

export function setBootstrap(payload) {
  state.ready = true;
  state.remoteReady = true;
  state.cacheMode = "full";
  state.error = null;
  state.data = normalizeData(payload.data);
  state.config = normalizeConfig(payload.config);
  state.rates = payload.rates || state.rates;
  state.dataSha = payload.dataSha || null;
  state.configSha = payload.configSha || null;
  state.lastSync = new Date().toISOString();
  persistCache();
}

export function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cache) return false;
    state.data = normalizeData(cache.data);
    state.config = normalizeConfig(cache.config);
    state.rates = cache.rates || state.rates;
    state.dataSha = cache.dataSha || null;
    state.configSha = cache.configSha || null;
    state.lastSync = cache.lastSync || null;
    state.cacheMode = cache.mode || "full";
    state.remoteReady = false;
    state.ready = true;
    return true;
  } catch {
    return false;
  }
}

export function updateCache() {
  persistCache();
}

function persistCache() {
  const fullCache = buildCachePayload(state.data, "full");
  if (safeSetCache(fullCache)) {
    state.cacheMode = "full";
    return;
  }

  const lightCache = buildCachePayload(stripHeavyFields(state.data), "lite");
  if (safeSetCache(lightCache)) {
    state.cacheMode = "lite";
    return;
  }

  // 最小缓存：保证下一次打开 App 至少能直接进入页面结构，而不是空白 Loading。
  safeSetCache(buildCachePayload(stripRecords(state.data), "minimal"));
  state.cacheMode = "minimal";
}

function buildCachePayload(data, mode) {
  return {
    mode,
    data,
    config: state.config,
    rates: state.rates,
    dataSha: state.dataSha,
    configSha: state.configSha,
    lastSync: state.lastSync
  };
}

function safeSetCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function stripHeavyFields(data) {
  const next = clone(normalizeData(data));
  for (const ledger of next.ledgers || []) {
    for (const record of ledger.records || []) {
      if (record.photo) record.photo = "";
      if (Array.isArray(record.photos)) record.photos = [];
    }
  }
  return next;
}

function stripRecords(data) {
  const next = clone(normalizeData(data));
  for (const ledger of next.ledgers || []) {
    ledger.records = [];
  }
  return next;
}

export function getLedger(id) {
  return state.data.ledgers.find((ledger) => ledger.id === id);
}

export function activeConsumers() {
  return (state.config.consumers || []).filter((consumer) => consumer.active !== false);
}
