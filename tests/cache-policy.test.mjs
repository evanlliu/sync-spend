import test from "node:test";
import assert from "node:assert/strict";

import { ApiClient, loadClientConfig } from "../src/js/api.js";
import { clearLegacyDataCache, setBootstrap, state } from "../src/js/store.js";

const TOKEN_CONFIG = {
  encrypted: "cNQSZox6Y8hRlh8N3km9Xdw1kmqQQnmpYtt+o6WJLvQff4RFc3PK8XFJHqfHjAxz",
  algorithm: "DES-CBC-PKCS7",
  encoding: "UTF-16LE",
  key: "ELIU",
  iv: "ELIU"
};

function clientConfig() {
  return {
    owner: "owner",
    repo: "repo",
    branch: "data",
    dataPath: "data/data.json",
    configPath: "data/config.json",
    token: TOKEN_CONFIG
  };
}

function githubFile(value, sha) {
  return new Response(JSON.stringify({
    type: "file",
    encoding: "base64",
    content: Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
    sha
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("bootstrap always reads data/config from GitHub with no-store and no cache-busting query", async () => {
  const api = new ApiClient();
  api.applyClientConfig(clientConfig());

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname === "api.github.com") {
      if (url.pathname.endsWith("/data/data.json")) {
        return githubFile({ schemaVersion: 1, ledgers: [], updatedAt: null }, "data_sha");
      }
      if (url.pathname.endsWith("/data/config.json")) {
        return githubFile({ schemaVersion: 1, consumers: [], currencies: [], exchange: { base: "CNY", quotes: [] } }, "config_sha");
      }
    }
    if (url.hostname === "api.frankfurter.dev") {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await api.bootstrap();
    assert.equal(result.dataSha, "data_sha");
    assert.equal(result.configSha, "config_sha");
    const githubCalls = calls.filter((item) => item.url.hostname === "api.github.com");
    assert.equal(githubCalls.length, 2);
    for (const call of githubCalls) {
      assert.equal(call.options.cache, "no-store");
      assert.equal(call.url.searchParams.get("ref"), "data");
      assert.equal(call.url.searchParams.has("_ts"), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("static client config never falls back to localStorage when network loading fails", async () => {
  const removed = [];
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = {
    removeItem(key) { removed.push(key); },
    getItem() { throw new Error("loadClientConfig must not read cached config"); },
    setItem() { throw new Error("loadClientConfig must not write cached config"); }
  };
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };

  try {
    await assert.rejects(() => loadClientConfig(), /network unavailable/);
    assert.deepEqual(removed.sort(), ["syncSpend.githubConfig.v1", "syncSpend.githubConfig.v2"]);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("store removes legacy business cache and bootstrap does not persist remote data locally", () => {
  const removed = [];
  let writes = 0;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    removeItem(key) { removed.push(key); },
    setItem() { writes += 1; },
    getItem() { return null; }
  };

  try {
    clearLegacyDataCache();
    setBootstrap({
      data: { schemaVersion: 1, ledgers: [], updatedAt: null },
      config: { schemaVersion: 1, consumers: [], currencies: [] },
      rates: { provider: "frankfurter", toCny: { CNY: 1 }, fallback: false },
      dataSha: "sha-data",
      configSha: "sha-config"
    });
    assert.deepEqual(removed, ["syncSpend.cache"]);
    assert.equal(writes, 0);
    assert.equal(state.remoteReady, true);
    assert.equal(state.dataSha, "sha-data");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});
