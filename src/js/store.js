import { migrateDataIntegrity } from "./migration.js";
import { normalizeConfig, normalizeData } from "./utils.js";

const LEGACY_CACHE_KEY = "syncSpend.cache";

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
  remoteReady: false
};

export function clearLegacyDataCache() {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // localStorage 可能被浏览器策略禁用；业务数据本身不依赖它。
  }
}

export function setBootstrap(payload) {
  const migration = migrateDataIntegrity(payload.data);
  state.ready = true;
  state.remoteReady = true;
  state.error = null;
  state.data = normalizeData(migration.data);
  state.config = normalizeConfig(payload.config);
  state.rates = payload.rates || state.rates;
  state.dataSha = payload.dataSha || null;
  state.configSha = payload.configSha || null;
  state.lastSync = new Date().toISOString();
}

export function getLedger(id) {
  return state.data.ledgers.find((ledger) => ledger.id === id);
}

export function activeConsumers() {
  return (state.config.consumers || []).filter((consumer) => consumer.active !== false);
}
