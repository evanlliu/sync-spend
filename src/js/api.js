import { decryptDotNetDesBase64 } from "./crypto.js";

const LEGACY_CLIENT_CONFIG_KEYS = ["syncSpend.githubConfig.v1", "syncSpend.githubConfig.v2"];

export async function loadClientConfig() {
  clearLegacyClientConfigCache();
  const config = await fetchStaticConfig();
  return normalizeClientConfig(config);
}

function clearLegacyClientConfigCache() {
  try {
    for (const key of LEGACY_CLIENT_CONFIG_KEYS) localStorage.removeItem(key);
  } catch {
    // 连接配置始终从当前发布版本读取，不依赖 localStorage。
  }
}

async function fetchStaticConfig() {
  const url = new URL("../../data/config.json", import.meta.url);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json HTTP ${res.status}`);
  return await res.json();
}

function normalizeClientConfig(config) {
  const github = config?.github || config || {};
  const clientConfig = {
    owner: String(github.owner || "").trim(),
    repo: String(github.repo || "").trim(),
    branch: String(github.branch || "").trim(),
    dataPath: normalizeRepoPath(github.dataPath),
    configPath: normalizeRepoPath(github.configPath),
    token: normalizeEncryptedToken(github.token)
  };
  assertClientConfig(clientConfig);
  return clientConfig;
}

function normalizeEncryptedToken(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      throw new Error("data/config.json 中 github.token 必须使用 DES 加密对象，禁止保存明文 Token");
    }
    return {
      encrypted: "",
      algorithm: "DES-CBC-PKCS7",
      encoding: "UTF-16LE",
      key: "",
      iv: ""
    };
  }

  const key = String(value.key || "").trim();
  return {
    encrypted: String(value.encrypted || "").replace(/\s+/g, ""),
    algorithm: String(value.algorithm || "DES-CBC-PKCS7").trim().toUpperCase(),
    encoding: String(value.encoding || "UTF-16LE").trim().toUpperCase(),
    key,
    iv: String(value.iv || key).trim()
  };
}

function assertClientConfig(config) {
  const required = ["owner", "repo", "branch", "dataPath", "configPath"];
  const missing = required.filter((key) => !String(config?.[key] || "").trim());
  if (missing.length) {
    throw new Error(`data/config.json 缺少 GitHub 配置: ${missing.join(", ")}`);
  }

  const token = config?.token || {};
  const tokenMissing = ["encrypted", "key", "iv"].filter((key) => !String(token[key] || "").trim());
  if (tokenMissing.length) {
    throw new Error(`data/config.json 缺少 GitHub Token 加密配置: ${tokenMissing.join(", ")}`);
  }
  if (token.algorithm !== "DES-CBC-PKCS7") {
    throw new Error(`不支持的 GitHub Token 加密算法: ${token.algorithm}`);
  }
  if (token.encoding !== "UTF-16LE") {
    throw new Error(`不支持的 GitHub Token 文本编码: ${token.encoding}`);
  }
}

function resolveGithubToken(tokenConfig) {
  const token = decryptDotNetDesBase64(tokenConfig.encrypted, tokenConfig.key, tokenConfig.iv).trim();
  if (!token) throw new Error("GitHub Token 解密结果为空");
  if (/^(?:PUT_|REPLACE_|YOUR_|<)/i.test(token)) throw new Error("GitHub Token 解密后仍是占位值");
  return token;
}

export class ApiClient {
  constructor() {
    this.github = null;
  }

  applyClientConfig(config = {}) {
    const normalized = normalizeClientConfig(config);
    this.github = {
      owner: normalized.owner,
      repo: normalized.repo,
      branch: normalized.branch,
      dataPath: normalized.dataPath,
      configPath: normalized.configPath,
      token: resolveGithubToken(normalized.token),
      tokenProtection: `${normalized.token.algorithm} / ${normalized.token.encoding}`
    };
  }

  getConnectionInfo() {
    const github = this.requireGithub();
    return {
      owner: github.owner,
      repo: github.repo,
      branch: github.branch,
      dataPath: github.dataPath,
      configPath: github.configPath,
      hasToken: Boolean(github.token),
      tokenProtection: github.tokenProtection
    };
  }

  async bootstrap() {
    const github = this.requireGithub();
    const [dataFile, configFile] = await Promise.all([
      this.readJsonFile(github.dataPath),
      this.readJsonFile(github.configPath)
    ]);
    const rates = await getRates(configFile.data);

    return {
      ok: true,
      data: dataFile.data,
      dataSha: dataFile.sha,
      config: configFile.data,
      configSha: configFile.sha,
      rates
    };
  }

  async refreshRates() {
    const github = this.requireGithub();
    const configFile = await this.readJsonFile(github.configPath);
    return { ok: true, rates: await getRates(configFile.data) };
  }

  async saveData(data, sha) {
    const github = this.requireGithub();
    const nextData = prepareDataForSave(data);
    const result = await this.writeJsonFile(github.dataPath, nextData, sha, "sync-spend: update data.json");
    return { ok: true, sha: result.sha, updatedAt: nextData.updatedAt, data: nextData };
  }

  async saveConfig(config, sha) {
    const github = this.requireGithub();
    const nextConfig = prepareConfigForSave(config);
    const result = await this.writeJsonFile(github.configPath, nextConfig, sha, "sync-spend: update config.json");
    return { ok: true, sha: result.sha, updatedAt: new Date().toISOString() };
  }

  mediaUrl(filePath) {
    const github = this.requireGithub();
    const encodedPath = normalizeRepoPath(filePath).split("/").map(encodeURIComponent).join("/");
    return `https://raw.githubusercontent.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/${encodeURIComponent(github.branch)}/${encodedPath}`;
  }

  async uploadMediaFile(filePath, blob, message = "sync-spend: add media") {
    const github = this.requireGithub();
    const path = assertMediaPath(filePath);
    if (!(blob instanceof Blob)) throw apiError(400, "INVALID_MEDIA", "media must be a Blob");
    if (!blob.size) throw apiError(400, "INVALID_MEDIA", "media file must not be empty");
    if (blob.size > 1024 * 1024) throw apiError(400, "MEDIA_TOO_LARGE", "media file must be 1 MB or smaller after compression");

    const content = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const res = await fetch(this.githubContentUrl(path), {
      method: "PUT",
      headers: {
        ...this.githubHeaders(),
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        message,
        content,
        branch: github.branch
      }),
      cache: "no-store"
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 409 || res.status === 422 ? "MEDIA_CONFLICT" : "MEDIA_UPLOAD_FAILED";
      throw apiError(res.status, code, payload.message || `Cannot upload ${path}`);
    }

    return {
      path,
      sha: payload?.content?.sha || null,
      commit: payload?.commit?.sha || null
    };
  }

  async deleteMediaFile(filePath, expectedSha = null, message = "sync-spend: delete media") {
    const github = this.requireGithub();
    const path = assertMediaPath(filePath);
    let sha = String(expectedSha || "").trim();

    if (!sha) {
      const metadata = await this.readContentMetadata(path);
      if (!metadata) return { ok: true, deleted: false, missing: true };
      sha = metadata.sha;
    }

    const res = await fetch(this.githubContentUrl(path), {
      method: "DELETE",
      headers: {
        ...this.githubHeaders(),
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ message, sha, branch: github.branch }),
      cache: "no-store"
    });

    if (res.status === 404) return { ok: true, deleted: false, missing: true };
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 409 ? "MEDIA_CONFLICT" : "MEDIA_DELETE_FAILED";
      throw apiError(res.status, code, payload.message || `Cannot delete ${path}`);
    }
    return { ok: true, deleted: true, commit: payload?.commit?.sha || null };
  }

  async readContentMetadata(filePath) {
    const github = this.requireGithub();
    const url = new URL(this.githubContentUrl(filePath));
    url.searchParams.set("ref", github.branch);
    const res = await fetch(url, { headers: this.githubHeaders(), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await safeReadText(res);
      throw apiError(res.status, "GITHUB_READ_FAILED", `Cannot read ${filePath} metadata: ${body}`);
    }
    const payload = await res.json();
    if (payload.type !== "file" || !payload.sha) throw apiError(500, "GITHUB_INVALID_FILE", `${filePath} is not a GitHub file`);
    return { sha: payload.sha, size: Number(payload.size || 0) };
  }

  requireGithub() {
    if (!this.github) throw new Error("GitHub API 尚未初始化");
    return this.github;
  }

  githubContentUrl(filePath) {
    const github = this.requireGithub();
    const encodedPath = normalizeRepoPath(filePath).split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/contents/${encodedPath}`;
  }

  githubHeaders(accept = "application/vnd.github+json") {
    const github = this.requireGithub();
    return {
      accept,
      authorization: `Bearer ${github.token}`
    };
  }

  async readJsonFile(filePath) {
    const github = this.requireGithub();
    const url = new URL(this.githubContentUrl(filePath));
    url.searchParams.set("ref", github.branch);
    const res = await fetch(url, {
      headers: this.githubHeaders(),
      cache: "no-store"
    });

    if (!res.ok) {
      const body = await safeReadText(res);
      throw apiError(res.status, "GITHUB_READ_FAILED", `Cannot read ${filePath} from GitHub branch ${github.branch}: ${body}`);
    }

    const payload = await res.json();
    if (payload.type !== "file") {
      throw apiError(500, "GITHUB_INVALID_FILE", `${filePath} is not a file on GitHub branch ${github.branch}. Actual type: ${payload.type || "unknown"}`);
    }

    let rawJson = "";
    if (payload.content && payload.encoding === "base64") {
      rawJson = base64ToUtf8(payload.content);
    } else {
      rawJson = await this.readRawGithubFile(filePath);
    }

    if (!rawJson || !rawJson.trim()) {
      throw apiError(500, "GITHUB_EMPTY_FILE", `${filePath} on branch ${github.branch} is empty. Please restore a valid JSON file.`);
    }

    try {
      return { data: JSON.parse(rawJson), sha: payload.sha };
    } catch (error) {
      throw apiError(500, "GITHUB_INVALID_JSON", `${filePath} on branch ${github.branch} is not valid JSON: ${error.message}`);
    }
  }

  async readRawGithubFile(filePath) {
    const github = this.requireGithub();
    const url = new URL(this.githubContentUrl(filePath));
    url.searchParams.set("ref", github.branch);
    const res = await fetch(url, {
      headers: this.githubHeaders("application/vnd.github.raw+json"),
      cache: "no-store"
    });

    if (!res.ok) {
      const body = await safeReadText(res);
      throw apiError(res.status, "GITHUB_RAW_READ_FAILED", `Cannot read raw ${filePath} from GitHub branch ${github.branch}: ${body}`);
    }
    return await res.text();
  }

  async writeJsonFile(filePath, value, expectedSha, message) {
    const github = this.requireGithub();
    let sha = expectedSha;
    if (!sha) {
      const current = await this.readJsonFile(filePath);
      sha = current.sha;
    }

    const content = utf8ToBase64(`${JSON.stringify(value, null, 2)}\n`);
    const res = await fetch(this.githubContentUrl(filePath), {
      method: "PUT",
      headers: {
        ...this.githubHeaders(),
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        message,
        content,
        sha,
        branch: github.branch
      }),
      cache: "no-store"
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 409 ? "GITHUB_CONFLICT" : "GITHUB_WRITE_FAILED";
      throw apiError(res.status, code, payload.message || `Cannot write ${filePath}`);
    }

    return {
      sha: payload?.content?.sha,
      commit: payload?.commit?.sha
    };
  }
}

async function getRates(config) {
  const exchange = config?.exchange || {};
  const base = normalizeCurrencyCode(exchange.base || "CNY");
  const quotes = uniqueCurrencies(Array.isArray(exchange.quotes) ? exchange.quotes : ["MXN", "TRY"]);
  const endpoint = exchange.endpoint || "https://api.frankfurter.dev/v2/rates";
  const toCny = { CNY: 1 };

  try {
    const url = new URL(endpoint);
    url.searchParams.set("base", base);
    if (quotes.length) url.searchParams.set("quotes", quotes.join(","));

    // Frankfurter v2 会严格校验 query 参数，未知参数会返回 422。
    // 禁用浏览器缓存已经由 fetch cache:no-store 完成，不能再追加 _ts 等自定义参数。
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const detail = extractApiMessage(await safeReadText(res));
      throw new Error(`Frankfurter HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await res.json();
    const parsed = parseFrankfurterRates(payload, base, quotes);
    Object.assign(toCny, parsed.toCny);

    const missing = quotes.filter((quote) => quote !== "CNY" && !toCny[quote]);
    if (missing.length) throw new Error(`Frankfurter missing rates: ${missing.join(", ")}`);

    return {
      provider: "frankfurter",
      sourceBase: base,
      sourceUrl: url.toString(),
      date: parsed.date,
      toCny,
      fetchedAt: new Date().toISOString(),
      fallback: false
    };
  } catch (error) {
    return {
      provider: "frankfurter",
      sourceBase: base,
      date: null,
      toCny,
      fetchedAt: new Date().toISOString(),
      fallback: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseFrankfurterRates(payload, base, quotes) {
  const toCny = {};
  let date = null;

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const rowBase = normalizeCurrencyCode(row.base || base);
      const quote = normalizeCurrencyCode(row.quote);
      const rate = Number(row.rate);
      if (!date && row.date) date = row.date;
      if (!quote || !Number.isFinite(rate) || rate <= 0) continue;

      if (quote === "CNY") {
        toCny[rowBase] = roundRate(rate);
      } else if (rowBase === "CNY") {
        toCny[quote] = roundRate(1 / rate);
      }
    }
    return { toCny, date };
  }

  const objectRates = payload?.rates || {};
  date = payload?.date || null;
  for (const quote of quotes) {
    const code = normalizeCurrencyCode(quote);
    const rate = Number(objectRates[code]);
    if (code !== "CNY" && Number.isFinite(rate) && rate > 0) {
      toCny[code] = roundRate(1 / rate);
    }
  }
  return { toCny, date };
}

function prepareDataForSave(data) {
  if (!data || typeof data !== "object") throw apiError(400, "INVALID_DATA", "data must be an object");
  if (!Array.isArray(data.ledgers)) throw apiError(400, "INVALID_DATA", "data.ledgers must be an array");

  const next = cloneJson(data);
  assertUniqueIds(next.ledgers, "ledger", "INVALID_DATA");
  const mediaPaths = new Set();

  for (const ledger of next.ledgers) {
    if (!ledger || typeof ledger !== "object") throw apiError(400, "INVALID_DATA", "every ledger must be an object");
    if (!Array.isArray(ledger.participantIds)) throw apiError(400, "INVALID_DATA", `ledger ${ledger.id} participantIds must be an array`);
    if (!Array.isArray(ledger.records)) throw apiError(400, "INVALID_DATA", `ledger ${ledger.id} records must be an array`);
    assertUniqueIds(ledger.records, `record in ledger ${ledger.id}`, "INVALID_DATA");

    for (const record of ledger.records) {
      // v0.9.6 起不允许图片本体继续进入 data.json。旧 photo 字段直接丢弃。
      delete record.photo;
      record.attachments = normalizeAttachmentsForSave(record.attachments, mediaPaths);
    }
  }

  next.schemaVersion = 2;
  next.updatedAt = new Date().toISOString();
  return next;
}

function prepareConfigForSave(config) {
  if (!config || typeof config !== "object") throw apiError(400, "INVALID_CONFIG", "config must be an object");
  if (!Array.isArray(config.consumers)) throw apiError(400, "INVALID_CONFIG", "config.consumers must be an array");
  if (!Array.isArray(config.currencies)) throw apiError(400, "INVALID_CONFIG", "config.currencies must be an array");

  assertUniqueIds(config.consumers, "consumer", "INVALID_CONFIG");
  const currencyCodes = config.currencies.map((item) => String(item?.code || "").trim().toUpperCase());
  if (currencyCodes.some((code) => !code) || new Set(currencyCodes).size !== currencyCodes.length) {
    throw apiError(400, "INVALID_CONFIG", "config.currencies must contain unique non-empty codes");
  }

  const next = cloneJson(config);
  delete next.cloudflare;
  delete next.github;
  next.schemaVersion = next.schemaVersion || 1;
  return next;
}



function normalizeAttachmentsForSave(value, mediaPaths) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw apiError(400, "INVALID_DATA", "record.attachments must be an array");

  const ids = new Set();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw apiError(400, "INVALID_DATA", "every attachment must be an object");
    const id = String(item.id || "").trim();
    const path = assertMediaPath(item.path);
    const mime = String(item.mime || "").trim().toLowerCase();
    const size = Number(item.size || 0);
    const width = Number(item.width || 0);
    const height = Number(item.height || 0);
    const sha = String(item.sha || "").trim();
    const createdAt = String(item.createdAt || "").trim();

    if (!id) throw apiError(400, "INVALID_DATA", "attachment id must not be empty");
    if (ids.has(id)) throw apiError(400, "INVALID_DATA", `duplicate attachment id: ${id}`);
    if (mediaPaths.has(path)) throw apiError(400, "INVALID_DATA", `duplicate attachment path: ${path}`);
    if (!/^image\/(?:webp|jpeg|png)$/.test(mime)) throw apiError(400, "INVALID_DATA", `unsupported attachment mime: ${mime || "empty"}`);
    if (!Number.isFinite(size) || size <= 0 || size > 1024 * 1024) throw apiError(400, "INVALID_DATA", `invalid attachment size: ${size}`);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw apiError(400, "INVALID_DATA", "attachment width/height must be positive");

    ids.add(id);
    mediaPaths.add(path);
    return { id, path, mime, size: Math.round(size), width: Math.round(width), height: Math.round(height), sha: sha || undefined, createdAt: createdAt || undefined };
  });
}

function assertMediaPath(value) {
  const path = normalizeRepoPath(value);
  if (!path || !path.startsWith("media/") || path.includes("..") || /[\\\r\n]/.test(path)) {
    throw apiError(400, "INVALID_MEDIA_PATH", `invalid media path: ${path || "empty"}`);
  }
  return path;
}

function assertUniqueIds(items, label, errorCode) {
  const ids = new Set();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    if (!id) throw apiError(400, errorCode, `${label} id must not be empty`);
    if (ids.has(id)) throw apiError(400, errorCode, `duplicate ${label} id: ${id}`);
    ids.add(id);
  }
}

function apiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeRepoPath(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}


function extractApiMessage(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  try {
    const payload = JSON.parse(value);
    const message = payload?.message ?? payload?.error;
    if (message !== undefined && message !== null) return String(message).trim();
  } catch {
    // Non-JSON error body: keep a short readable excerpt below.
  }
  return value.replace(/\s+/g, " ").slice(0, 240);
}

function uniqueCurrencies(currencies) {
  return Array.from(new Set(currencies.map(normalizeCurrencyCode).filter(Boolean)));
}

function normalizeCurrencyCode(value) {
  return String(value || "").trim().toUpperCase();
}

function roundRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(rate * 10000) / 10000;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

function base64ToUtf8(base64) {
  const clean = String(base64).replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(value) {
  return bytesToBase64(new TextEncoder().encode(value));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
