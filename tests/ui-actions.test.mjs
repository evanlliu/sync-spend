import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/js/app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/css/app.css", import.meta.url), "utf8");

test("ledger desktop refresh action is rendered before settlement action", () => {
  const refreshIndex = appSource.indexOf('className: "btn ghost ledger-refresh-btn"');
  const settlementIndex = appSource.indexOf('className: "btn settle"', refreshIndex);
  assert.ok(refreshIndex >= 0, "desktop refresh button is missing");
  assert.ok(settlementIndex > refreshIndex, "refresh button must be before settlement button");
});

test("mobile ledger exposes a dedicated refresh FAB directly before more actions", () => {
  const refreshIndex = appSource.indexOf('className: "mobile-fab mobile-refresh-fab"');
  const moreIndex = appSource.indexOf('className: "mobile-more-wrap"', refreshIndex);
  assert.ok(refreshIndex >= 0, "mobile refresh FAB is missing");
  assert.ok(moreIndex > refreshIndex, "mobile refresh FAB must be before the more-actions wrapper");
  assert.match(cssSource, /\.mobile-refresh-fab\s*\{[\s\S]*?order:\s*2;/);
  assert.match(cssSource, /\.mobile-more-wrap\s*\{[\s\S]*?order:\s*3;/);
});

test("remote mutations and refreshes use the blocking operation indicator", () => {
  assert.match(appSource, /showOperation\(busyText \|\| t\("saving"\)\)/);
  assert.match(appSource, /busyText: t\("deleting"\), deferBusyUntilMutation: true/);
  assert.match(appSource, /busyText: t\("settling"\), deferBusyUntilMutation: true/);
  assert.match(appSource, /showOperation\(t\("refreshing"\)\)/);
  assert.match(cssSource, /\.operation-overlay\.is-visible/);
  assert.match(cssSource, /\.operation-spinner/);
});
