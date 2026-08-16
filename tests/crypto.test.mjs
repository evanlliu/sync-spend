import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { decryptDotNetDesBase64 } from "../src/js/crypto.js";

test("decryptDotNetDesBase64 matches .NET-compatible DES CBC PKCS7 UTF-16LE vector", () => {
  const encrypted = "UV1r9kmYUdcBiPPGpu7XLMhI8IRMRYwfQmnVu2ZgME4=";
  assert.equal(decryptDotNetDesBase64(encrypted, "ELIU", "ELIU"), "hello-token-123");
});

test("release config stores only encrypted GitHub token and decrypts to a PAT-shaped value", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
  assert.equal(typeof config.github.token, "object");
  assert.equal(typeof config.github.token.encrypted, "string");
  assert.equal("github_pat_" === config.github.token.encrypted.slice(0, 11), false);
  const token = decryptDotNetDesBase64(config.github.token.encrypted, config.github.token.key, config.github.token.iv);
  assert.match(token, /^github_pat_[A-Za-z0-9_]+$/);
});

test("decryptDotNetDesBase64 rejects wrong DES key or malformed padding", () => {
  assert.throws(
    () => decryptDotNetDesBase64("UV1r9kmYUdcBiPPGpu7XLMhI8IRMRYwfQmnVu2ZgME4=", "FAIL", "FAIL"),
    /padding|UTF-16LE/
  );
});
