import { normalizeConfig, normalizeData } from "./utils.js";

export const state = {
  ready: false,
  loading: false,
  saving: false,
  error: null,
  view: "dashboard",
  selectedLedgerId: null,
  showArchived: false,
  data: normalizeData(),
  config: normalizeConfig(),
  rates: { provider: "frankfurter", toCny: { CNY: 1 }, fallback: false },
  dataSha: null,
  configSha: null,
  lastSync: null
};

export function setBootstrap(payload) {
  state.ready = true;
  state.error = null;
  state.data = normalizeData(payload.data);
  state.config = normalizeConfig(payload.config);
  state.rates = payload.rates || state.rates;
  state.dataSha = payload.dataSha;
  state.configSha = payload.configSha;
  state.lastSync = new Date().toISOString();
  localStorage.setItem("syncSpend.cache", JSON.stringify({
    data: state.data,
    config: state.config,
    lastSync: state.lastSync
  }));
}

export function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem("syncSpend.cache") || "null");
    if (!cache) return false;
    state.data = normalizeData(cache.data);
    state.config = normalizeConfig(cache.config);
    state.lastSync = cache.lastSync || null;
    state.ready = true;
    return true;
  } catch {
    return false;
  }
}

export function updateCache() {
  localStorage.setItem("syncSpend.cache", JSON.stringify({
    data: state.data,
    config: state.config,
    lastSync: state.lastSync
  }));
}

export function getLedger(id) {
  return state.data.ledgers.find((ledger) => ledger.id === id);
}

export function activeConsumers() {
  return (state.config.consumers || []).filter((consumer) => consumer.active !== false);
}
