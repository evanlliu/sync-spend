/**
 * Sync Spend - single-file Cloudflare Worker API
 *
 * Cloudflare 只需要发布这一个文件：worker.js
 * 其他前端文件、data.json、config.json 全部提交到 GitHub 仓库即可。
 *
 * Required Cloudflare variables/secrets:
 * - APP_PASSWORD  Secret，访问密码，例如 1123
 * - GH_TOKEN      Secret，GitHub fine-grained token，Contents: Read and write
 * - GH_BRANCH     Plaintext，默认 main
 * - GH_OWNER      Plaintext，默认 evanlliu
 * - GH_REPO       Plaintext，默认 sync-spend
 * - GH_DATA       Plaintext，默认 data/data.json
 * - GH_CONFIG     Plaintext，默认 data/config.json
 *
 * V0.6: 汇率统一保留 4 位小数；新增记录金额输入/货币切换实时刷新最新汇率。
 * V0.6.2: 页面刷新后默认打开上一次打开的账本。
 * V0.6.6: 版本号从 config.json 移除，避免覆盖用户自定义配置。
 * V0.6.8: 新增/编辑弹窗标题栏和底部保存区固定，表单内容独立滚动。
 * V0.7.0: 增加记录创建/修改历史、账本结算记录和新的页面信息布局。
 * V0.7.3: 移动端界面优化，前端样式更新。
 * V0.7.4: 移动端隐藏应收/应付卡片，新增记账改为悬浮图片按钮。
 * V0.7.5: 移动端增加悬浮更多菜单，结算建议改为弹窗并显示历史结算。
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request, env, ctx) {
    return handleApiRequest({ request, env, ctx });
  }
};

async function handleApiRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/?/, "") || "bootstrap";

    if (route === "health") {
      return json({
        ok: true,
        app: "sync-spend",
        version: "0.7.5",
        mode: "single-file-worker",
        hasPassword: Boolean(env.APP_PASSWORD),
        hasGithubToken: Boolean(env.GH_TOKEN),
        repo: repoInfo(env)
      });
    }

    assertConfigured(env);
    assertAuthorized(request, env);

    if (request.method === "GET" && route === "bootstrap") {
      return await handleBootstrap(env);
    }

    if (request.method === "GET" && route === "rates") {
      const configFile = await readJsonFile(env, pathConfig(env));
      const rates = await getRates(configFile.data);
      return json({ ok: true, rates });
    }

    if (request.method === "POST" && route === "save-data") {
      const payload = await readRequestJson(request);
      validateData(payload.data);
      const result = await writeJsonFile(env, pathData(env), payload.data, payload.sha, "sync-spend: update data.json");
      return json({ ok: true, sha: result.sha, updatedAt: new Date().toISOString() });
    }

    if (request.method === "POST" && route === "save-config") {
      const payload = await readRequestJson(request);
      validateConfig(payload.config);
      const result = await writeJsonFile(env, pathConfig(env), payload.config, payload.sha, "sync-spend: update config.json");
      return json({ ok: true, sha: result.sha, updatedAt: new Date().toISOString() });
    }

    return json({ ok: false, error: "API_NOT_FOUND", message: `Unsupported route: ${request.method} ${route}` }, 404);
  } catch (error) {
    const status = error.status || 500;
    return json({
      ok: false,
      error: error.code || "SERVER_ERROR",
      message: error.message || "Unknown error"
    }, status);
  }
}

function corsHeaders() {
  return {
    ...JSON_HEADERS,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-app-password,authorization"
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: corsHeaders()
  });
}

function appError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertConfigured(env) {
  const missing = ["APP_PASSWORD", "GH_TOKEN"].filter((key) => !env[key]);
  if (missing.length) {
    throw appError(500, "MISSING_ENV", `Missing Cloudflare environment variables: ${missing.join(", ")}`);
  }
}

function assertAuthorized(request, env) {
  const headerPassword = request.headers.get("x-app-password") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const password = headerPassword || bearer;
  if (!password || password !== env.APP_PASSWORD) {
    throw appError(401, "UNAUTHORIZED", "Invalid APP_PASSWORD");
  }
}

function repoInfo(env) {
  return {
    owner: env.GH_OWNER || "evanlliu",
    repo: env.GH_REPO || "sync-spend",
    branch: env.GH_BRANCH || "main",
    dataPath: env.GH_DATA || "data/data.json",
    configPath: env.GH_CONFIG || "data/config.json"
  };
}

function pathData(env) {
  return repoInfo(env).dataPath;
}

function pathConfig(env) {
  return repoInfo(env).configPath;
}

async function handleBootstrap(env) {
  const [dataFile, configFile] = await Promise.all([
    readJsonFile(env, pathData(env)),
    readJsonFile(env, pathConfig(env))
  ]);

  const rates = await getRates(configFile.data);

  return json({
    ok: true,
    data: dataFile.data,
    dataSha: dataFile.sha,
    config: configFile.data,
    configSha: configFile.sha,
    rates
  });
}

function githubContentUrl(env, filePath) {
  const repo = repoInfo(env);
  const encodedPath = String(filePath).split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${encodedPath}`;
}

function githubHeaders(env) {
  return {
    "accept": "application/vnd.github+json",
    "authorization": `Bearer ${env.GH_TOKEN}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "sync-spend-cloudflare-worker",
    "cache-control": "no-cache"
  };
}

async function readJsonFile(env, filePath) {
  const repo = repoInfo(env);
  const url = `${githubContentUrl(env, filePath)}?ref=${encodeURIComponent(repo.branch)}`;
  const res = await fetch(url, {
    headers: githubHeaders(env),
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw appError(res.status, "GITHUB_READ_FAILED", `Cannot read ${filePath} from GitHub: ${body}`);
  }

  const payload = await res.json();
  if (!payload.content || payload.type !== "file") {
    throw appError(500, "GITHUB_INVALID_FILE", `${filePath} is not a GitHub file response`);
  }

  return {
    data: JSON.parse(base64ToUtf8(payload.content)),
    sha: payload.sha
  };
}

async function writeJsonFile(env, filePath, value, expectedSha, message) {
  if (!expectedSha) {
    const current = await readJsonFile(env, filePath);
    expectedSha = current.sha;
  }

  const repo = repoInfo(env);
  const content = utf8ToBase64(`${JSON.stringify(value, null, 2)}\n`);
  const res = await fetch(githubContentUrl(env, filePath), {
    method: "PUT",
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      message,
      content,
      sha: expectedSha,
      branch: repo.branch
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = res.status === 409 ? "GITHUB_CONFLICT" : "GITHUB_WRITE_FAILED";
    throw appError(res.status, code, payload.message || `Cannot write ${filePath}`);
  }

  return {
    sha: payload?.content?.sha,
    commit: payload?.commit?.sha
  };
}

async function getRates(config) {
  const exchange = config.exchange || {};
  const base = exchange.base || "CNY";
  const quotes = uniqueCurrencies(Array.isArray(exchange.quotes) ? exchange.quotes : ["MXN", "TRY"]);
  const endpoint = exchange.endpoint || "https://api.frankfurter.dev/v2/rates";
  const toCny = { CNY: 1 };

  try {
    const url = new URL(endpoint);
    url.searchParams.set("base", base);
    if (quotes.length) url.searchParams.set("quotes", quotes.join(","));

    const res = await fetch(url.toString(), {
      headers: {
        "accept": "application/json",
        "cache-control": "no-cache"
      },
      cf: { cacheTtl: 0, cacheEverything: false }
    });

    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const payload = await res.json();
    const parsed = parseFrankfurterRates(payload, base, quotes);

    Object.assign(toCny, parsed.toCny);

    const missing = quotes.filter((quote) => quote !== "CNY" && !toCny[quote]);
    if (missing.length) {
      throw new Error(`Frankfurter missing rates: ${missing.join(", ")}`);
    }

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
      error: error.message
    };
  }
}

function parseFrankfurterRates(payload, base, quotes) {
  const toCny = {};
  let date = null;

  // Frankfurter v2 /rates returns an array:
  // [{ date, base: "CNY", quote: "MXN", rate: 2.55 }, ...]
  // Code must not read payload.rates for v2.
  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const rowBase = normalizeCurrencyCode(row.base || base);
      const quote = normalizeCurrencyCode(row.quote);
      const rate = Number(row.rate);
      if (!date && row.date) date = row.date;
      if (!quote || !Number.isFinite(rate) || rate <= 0) continue;

      if (quote === "CNY") {
        // 1 rowBase = rate CNY
        toCny[rowBase] = roundRate(rate);
      } else if (rowBase === "CNY") {
        // 1 CNY = rate quote; convert to: 1 quote = 1/rate CNY
        toCny[quote] = roundRate(1 / rate);
      }
    }
    return { toCny, date };
  }

  // Compatibility with object-style APIs such as Frankfurter v1:
  // { base: "CNY", date: "...", rates: { MXN: 2.55, TRY: 5.8 } }
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

function uniqueCurrencies(currencies) {
  return Array.from(new Set(currencies.map(normalizeCurrencyCode).filter(Boolean)));
}

function normalizeCurrencyCode(value) {
  return String(value || "").trim().toUpperCase();
}

function validateData(data) {
  if (!data || typeof data !== "object") throw appError(400, "INVALID_DATA", "data must be an object");
  if (!Array.isArray(data.ledgers)) throw appError(400, "INVALID_DATA", "data.ledgers must be an array");
  data.schemaVersion = data.schemaVersion || 1;
  data.updatedAt = new Date().toISOString();
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw appError(400, "INVALID_CONFIG", "config must be an object");
  if (!Array.isArray(config.consumers)) throw appError(400, "INVALID_CONFIG", "config.consumers must be an array");
  if (!Array.isArray(config.currencies)) throw appError(400, "INVALID_CONFIG", "config.currencies must be an array");
  config.schemaVersion = config.schemaVersion || 1;
}

async function readRequestJson(request) {
  try {
    return await request.json();
  } catch {
    throw appError(400, "INVALID_JSON", "Request body must be JSON");
  }
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
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function roundRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(rate * 10000) / 10000;
}
