const PASSWORD_KEY = "syncSpend.password";
const CLIENT_CONFIG_KEY = "syncSpend.clientConfig";

export function getSavedPassword() {
  return localStorage.getItem(PASSWORD_KEY) || "";
}

export function savePassword(password) {
  localStorage.setItem(PASSWORD_KEY, password);
}

export async function loadClientConfig() {
  try {
    const res = await fetch(new URL("../../data/config.json", import.meta.url), { cache: "no-store" });
    if (!res.ok) throw new Error(`config.json HTTP ${res.status}`);
    const config = await res.json();
    const cloudflare = config.cloudflare || {};
    const clientConfig = {
      apiBaseUrl: normalizeBaseUrl(cloudflare.apiBaseUrl || cloudflare.workerUrl || cloudflare.url || ""),
      accessPassword: String(cloudflare.accessPassword || cloudflare.appPassword || "")
    };
    localStorage.setItem(CLIENT_CONFIG_KEY, JSON.stringify(clientConfig));
    return clientConfig;
  } catch {
    try {
      return JSON.parse(localStorage.getItem(CLIENT_CONFIG_KEY) || "{}");
    } catch {
      return {};
    }
  }
}

export class ApiClient {
  constructor() {
    this.password = getSavedPassword();
    this.apiBaseUrl = "";
  }

  applyClientConfig(config = {}) {
    this.apiBaseUrl = normalizeBaseUrl(config.apiBaseUrl || "");
    if (!this.password && config.accessPassword) {
      this.setPassword(String(config.accessPassword));
    }
  }

  setPassword(password) {
    this.password = password;
    savePassword(password);
  }

  async bootstrap() {
    return this.request("/api/bootstrap");
  }

  async refreshRates() {
    return this.request("/api/rates");
  }

  async saveData(data, sha) {
    return this.request("/api/save-data", { method: "POST", body: { data, sha } });
  }

  async saveConfig(config, sha) {
    return this.request("/api/save-config", { method: "POST", body: { config, sha } });
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    const headers = {
      "accept": "application/json",
      "x-app-password": this.password
    };
    let body;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const requestUrl = withCacheBust(resolveApiUrl(this.apiBaseUrl, path), method);
    const res = await fetch(requestUrl, { method, headers, body, cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      const error = new Error(payload.message || res.statusText || "Request failed");
      error.status = res.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveApiUrl(baseUrl, path) {
  if (!baseUrl) return path;
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function withCacheBust(url, method) {
  if (method !== "GET") return url;
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.set("_ts", String(Date.now()));
  return parsed.toString();
}
