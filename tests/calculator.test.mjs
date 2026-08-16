import test from "node:test";
import assert from "node:assert/strict";

import {
  consumerUsage,
  equalShareMap,
  ledgerSummary,
  recordShareMap,
  sanitizeSplitParticipants
} from "../src/js/calculator.js";

const config = {
  consumers: [
    { id: "a", name: { "zh-CN": "A", "en-US": "A" }, active: true },
    { id: "b", name: { "zh-CN": "B", "en-US": "B" }, active: true },
    { id: "c", name: { "zh-CN": "C", "en-US": "C" }, active: false }
  ]
};

test("equalShareMap keeps cent-level total exact", () => {
  assert.deepEqual(equalShareMap(100, ["a", "b", "c"]), {
    a: 33.34,
    b: 33.33,
    c: 33.33
  });
});

test("explicit historical split participants are not filtered by current ledger participants", () => {
  const record = {
    type: "expense",
    amountCny: 90,
    splitMode: "equal",
    splitParticipantIds: ["a", "b", "c"]
  };

  assert.deepEqual(sanitizeSplitParticipants(record, ["a", "b"]), ["a", "b", "c"]);
  assert.deepEqual(recordShareMap(record, ["a", "b"]), { a: 30, b: 30, c: 30 });
});

test("legacy amount split uses stored amount keys before current ledger participants", () => {
  const record = {
    type: "expense",
    amountCny: 100,
    splitMode: "amount",
    splitAmountsCny: { a: 40, legacy_user: 60 }
  };

  assert.deepEqual(sanitizeSplitParticipants(record, ["a", "b"]), ["a", "legacy_user"]);
  assert.deepEqual(recordShareMap(record, ["a", "b"]), { a: 40, legacy_user: 60 });

  const summary = ledgerSummary({
    id: "ledger_legacy_amount",
    participantIds: ["a", "b"],
    records: [{ ...record, id: "r1", consumerId: "a", amount: 100, currency: "CNY" }]
  }, config);

  assert.ok(summary.participants.some((item) => item.id === "legacy_user"));
  assert.equal(summary.balances.find((item) => item.consumerId === "legacy_user").balance, -60);
});

test("removed current participant remains in historical balances when records reference them", () => {
  const ledger = {
    id: "ledger_1",
    participantIds: ["a", "b"],
    records: [
      {
        id: "r1",
        type: "expense",
        consumerId: "a",
        amount: 90,
        currency: "CNY",
        amountCny: 90,
        splitMode: "equal",
        splitParticipantIds: ["a", "b", "c"]
      }
    ]
  };

  const summary = ledgerSummary(ledger, config);
  assert.deepEqual(summary.participants.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(summary.balances.map((item) => [item.consumerId, item.balance]), [
    ["a", 60],
    ["b", -30],
    ["c", -30]
  ]);
  assert.equal(summary.settlements.reduce((sum, item) => sum + item.amount, 0), 60);
});

test("historical consumer missing from config still remains in balance calculation", () => {
  const ledger = {
    id: "ledger_2",
    participantIds: ["a"],
    records: [
      {
        id: "r1",
        type: "expense",
        consumerId: "a",
        amount: 20,
        currency: "CNY",
        amountCny: 20,
        splitMode: "equal",
        splitParticipantIds: ["a", "legacy_user"]
      }
    ]
  };

  const summary = ledgerSummary(ledger, config);
  const legacy = summary.balances.find((item) => item.consumerId === "legacy_user");
  assert.ok(legacy);
  assert.equal(legacy.balance, -10);
});

test("consumerUsage keeps deleted historical references so consumers are not physically deletable", () => {
  const data = {
    ledgers: [
      {
        id: "ledger_usage",
        participantIds: ["a"],
        records: [
          { id: "deleted_expense", type: "expense", consumerId: "legacy_user", splitParticipantIds: ["a"], deleted: true },
          { id: "deleted_settlement", type: "settlement", fromConsumerId: "b", toConsumerId: "legacy_user", deleted: true }
        ]
      }
    ]
  };

  assert.deepEqual(consumerUsage(data, "legacy_user"), { ledgerCount: 1, recordCount: 2 });
  assert.deepEqual(consumerUsage(data, "a"), { ledgerCount: 1, recordCount: 1 });
  assert.deepEqual(consumerUsage(data, "missing"), { ledgerCount: 0, recordCount: 0 });
});

test("soft-deleted expense and settlement records have no accounting effect", () => {
  const ledger = {
    id: "ledger_3",
    participantIds: ["a", "b"],
    records: [
      {
        id: "active_expense",
        type: "expense",
        consumerId: "a",
        amount: 100,
        currency: "CNY",
        amountCny: 100,
        splitMode: "equal",
        splitParticipantIds: ["a", "b"]
      },
      {
        id: "deleted_expense",
        type: "expense",
        consumerId: "b",
        amount: 80,
        currency: "CNY",
        amountCny: 80,
        splitMode: "equal",
        splitParticipantIds: ["a", "b"],
        deleted: true
      },
      {
        id: "deleted_settlement",
        type: "settlement",
        fromConsumerId: "b",
        toConsumerId: "a",
        amount: 50,
        amountCny: 50,
        deleted: true
      }
    ]
  };

  const summary = ledgerSummary(ledger, config);
  assert.equal(summary.totalCny, 100);
  assert.equal(summary.settledCny, 0);
  assert.deepEqual(summary.balances.map((item) => [item.consumerId, item.balance]), [
    ["a", 50],
    ["b", -50]
  ]);
});

test("active settlement offsets balances and does not increase expense total", () => {
  const ledger = {
    id: "ledger_4",
    participantIds: ["a", "b"],
    records: [
      {
        id: "expense",
        type: "expense",
        consumerId: "a",
        amount: 100,
        currency: "CNY",
        amountCny: 100,
        splitMode: "equal",
        splitParticipantIds: ["a", "b"]
      },
      {
        id: "settlement",
        type: "settlement",
        fromConsumerId: "b",
        toConsumerId: "a",
        amount: 50,
        amountCny: 50
      }
    ]
  };

  const summary = ledgerSummary(ledger, config);
  assert.equal(summary.totalCny, 100);
  assert.equal(summary.settledCny, 50);
  assert.deepEqual(summary.balances.map((item) => [item.consumerId, item.balance]), [
    ["a", 0],
    ["b", 0]
  ]);
  assert.deepEqual(summary.settlements, []);
});
