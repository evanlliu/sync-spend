import test from "node:test";
import assert from "node:assert/strict";

import { ApiClient } from "../src/js/api.js";
import { migrateDataIntegrity } from "../src/js/migration.js";

function createClient() {
  const api = new ApiClient();
  api.applyClientConfig({
    owner: "owner",
    repo: "repo",
    branch: "data",
    dataPath: "data/data.json",
    configPath: "data/config.json",
    token: {
      encrypted: "cNQSZox6Y8hRlh8N3km9Xdw1kmqQQnmpYtt+o6WJLvQff4RFc3PK8XFJHqfHjAxz",
      algorithm: "DES-CBC-PKCS7",
      encoding: "UTF-16LE",
      key: "ELIU",
      iv: "ELIU"
    }
  });
  return api;
}

test("applyClientConfig rejects legacy plaintext GitHub token configuration", () => {
  const api = new ApiClient();
  assert.throws(() => api.applyClientConfig({
    owner: "owner",
    repo: "repo",
    branch: "data",
    dataPath: "data/data.json",
    configPath: "data/config.json",
    token: "plain-token-must-not-be-accepted"
  }), /必须使用 DES 加密对象/);
});

function validData() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    ledgers: [
      {
        id: "ledger_1",
        name: "Trip",
        archived: false,
        participantIds: ["a", "b"],
        records: [],
        createdAt: "2026-08-16T00:00:00.000Z"
      }
    ]
  };
}

function validConfig() {
  return {
    schemaVersion: 1,
    consumers: [
      { id: "a", name: { "zh-CN": "A", "en-US": "A" }, active: true },
      { id: "b", name: { "zh-CN": "B", "en-US": "B" }, active: true }
    ],
    currencies: [
      { code: "CNY", name: { "zh-CN": "人民币", "en-US": "CNY" } },
      { code: "MXN", name: { "zh-CN": "比索", "en-US": "MXN" } }
    ],
    exchange: { base: "CNY", quotes: ["MXN"] }
  };
}

test("saveData rejects duplicate ledger and record ids before any network write", async () => {
  const api = createClient();
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not run");
  };

  try {
    const duplicateLedgers = validData();
    duplicateLedgers.ledgers.push({ ...duplicateLedgers.ledgers[0] });
    await assert.rejects(() => api.saveData(duplicateLedgers, "sha"), (error) => error.code === "INVALID_DATA");

    const duplicateRecords = validData();
    duplicateRecords.ledgers[0].records = [
      { id: "r1", type: "expense" },
      { id: "r1", type: "expense" }
    ];
    await assert.rejects(() => api.saveData(duplicateRecords, "sha"), (error) => error.code === "INVALID_DATA");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saveConfig rejects duplicate consumer ids and currency codes", async () => {
  const api = createClient();

  const duplicateConsumers = validConfig();
  duplicateConsumers.consumers.push({ ...duplicateConsumers.consumers[0] });
  await assert.rejects(() => api.saveConfig(duplicateConsumers, "sha"), (error) => error.code === "INVALID_CONFIG");

  const duplicateCurrencies = validConfig();
  duplicateCurrencies.currencies.push({ code: "cny", name: {} });
  await assert.rejects(() => api.saveConfig(duplicateCurrencies, "sha"), (error) => error.code === "INVALID_CONFIG");
});

test("saveConfig strips legacy cloudflare/github business fields before writing", async () => {
  const api = createClient();
  const config = validConfig();
  config.cloudflare = { worker: "legacy" };
  config.github = { token: "must-not-be-written" };

  let writtenBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    writtenBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: { sha: "new_sha" }, commit: { sha: "commit_sha" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await api.saveConfig(config, "old_sha");
    assert.equal(result.sha, "new_sha");
    const writtenConfig = JSON.parse(Buffer.from(writtenBody.content, "base64").toString("utf8"));
    assert.equal("cloudflare" in writtenConfig, false);
    assert.equal("github" in writtenConfig, false);
    assert.equal(writtenBody.sha, "old_sha");
    assert.equal(writtenBody.branch, "data");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saveData writes a fresh updatedAt without mutating the caller object", async () => {
  const api = createClient();
  const data = validData();
  let writtenBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    writtenBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: { sha: "new_sha" }, commit: { sha: "commit_sha" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await api.saveData(data, "old_sha");
    const writtenData = JSON.parse(Buffer.from(writtenBody.content, "base64").toString("utf8"));
    assert.equal(data.updatedAt, null);
    assert.ok(writtenData.updatedAt);
    assert.equal(result.updatedAt, writtenData.updatedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("runtime migration makes legacy duplicate records savable in the same mutation", async () => {
  const api = createClient();
  const dirty = validData();
  dirty.ledgers[0].records = [
    { id: "r1", type: "expense", deleted: true, history: [] },
    { id: "r1", type: "expense", deleted: false, history: [] }
  ];

  const migrated = migrateDataIntegrity(dirty, { at: "2026-08-16T20:00:00.000Z" }).data;
  const active = migrated.ledgers[0].records.find((item) => !item.deleted);
  active.deleted = true;
  active.deletedAt = "2026-08-16T20:01:00.000Z";

  let writtenBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    writtenBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: { sha: "new_sha" }, commit: { sha: "commit_sha" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    await api.saveData(migrated, "old_sha");
    const writtenData = JSON.parse(Buffer.from(writtenBody.content, "base64").toString("utf8"));
    assert.deepEqual(writtenData.ledgers[0].records.map((item) => item.id), ["r1", "r1__repair2"]);
    assert.equal(writtenData.ledgers[0].records.every((item) => item.deleted), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function githubJsonFileResponse(value, sha = "config_sha") {
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

test("refreshRates sends only Frankfurter v2 supported query parameters", async () => {
  const api = createClient();
  const config = validConfig();
  let frankfurterUrl = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.github.com") return githubJsonFileResponse(config);
    if (url.hostname === "api.frankfurter.dev") {
      frankfurterUrl = url;
      return new Response(JSON.stringify([
        { date: "2026-08-16", base: "CNY", quote: "MXN", rate: 2.5 }
      ]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await api.refreshRates();
    assert.ok(frankfurterUrl);
    assert.equal(frankfurterUrl.searchParams.get("base"), "CNY");
    assert.equal(frankfurterUrl.searchParams.get("quotes"), "MXN");
    assert.equal(frankfurterUrl.searchParams.has("_ts"), false);
    assert.equal(result.rates.error, undefined);
    assert.equal(result.rates.toCny.MXN, 0.4);
    assert.equal(new URL(result.rates.sourceUrl).searchParams.has("_ts"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshRates exposes Frankfurter response details instead of hiding HTTP errors", async () => {
  const api = createClient();
  const config = validConfig();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.github.com") return githubJsonFileResponse(config);
    if (url.hostname === "api.frankfurter.dev") {
      return new Response(JSON.stringify({ message: "Invalid request" }), {
        status: 422,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await api.refreshRates();
    assert.equal(result.rates.toCny.CNY, 1);
    assert.match(result.rates.error, /^Frankfurter HTTP 422: Invalid request$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
