import test from "node:test";
import assert from "node:assert/strict";

import { migrateDataIntegrity } from "../src/js/migration.js";

const FIXED_TIME = "2026-08-16T20:00:00.000Z";

function dirtyData() {
  return {
    schemaVersion: 1,
    ledgers: [
      {
        id: "ledger_same",
        participantIds: ["a", "b"],
        records: [
          {
            id: "record_same",
            type: "expense",
            consumerId: "a",
            amountCny: 100,
            deleted: true,
            history: [{ action: "deleted", at: "2026-08-16T10:00:00.000Z", summary: "old" }]
          },
          {
            id: "record_same",
            type: "expense",
            consumerId: "a",
            amountCny: 100,
            deleted: false,
            createdAt: "2026-08-16T11:00:00.000Z",
            updatedAt: "2026-08-16T11:30:00.000Z",
            history: []
          }
        ]
      }
    ]
  };
}

test("duplicate record ids are repaired without deleting either active or historical records", () => {
  const source = dirtyData();
  const result = migrateDataIntegrity(source, { at: FIXED_TIME });
  const records = result.data.ledgers[0].records;

  assert.equal(result.changed, true);
  assert.equal(result.repairs.length, 1);
  assert.equal(records.length, 2);
  assert.equal(records[0].id, "record_same");
  assert.equal(records[0].deleted, true);
  assert.equal(records[1].id, "record_same__repair2");
  assert.equal(records[1].deleted, false);
  assert.equal(records[1].createdAt, "2026-08-16T11:00:00.000Z");
  assert.equal(records[1].updatedAt, "2026-08-16T11:30:00.000Z");
  assert.deepEqual(records[1].history.at(-1), {
    action: "id_repaired",
    at: FIXED_TIME,
    summary: "自动修复重复记录 ID: record_same → record_same__repair2"
  });

  // Migration must not mutate the remote/source object before a save succeeds.
  assert.equal(source.ledgers[0].records[1].id, "record_same");
});

test("repair ids are deterministic and avoid ids that already exist in the ledger", () => {
  const source = dirtyData();
  source.ledgers[0].records.push({ id: "record_same__repair2", type: "expense" });

  const first = migrateDataIntegrity(source, { at: FIXED_TIME });
  const second = migrateDataIntegrity(source, { at: "2026-08-17T00:00:00.000Z" });

  assert.deepEqual(first.data.ledgers[0].records.map((item) => item.id), [
    "record_same",
    "record_same__repair3",
    "record_same__repair2"
  ]);
  assert.deepEqual(second.data.ledgers[0].records.map((item) => item.id), first.data.ledgers[0].records.map((item) => item.id));
});

test("missing record ids and duplicate ledger ids are repaired instead of blocking all future saves", () => {
  const source = {
    ledgers: [
      { id: "ledger_x", participantIds: [], records: [{ id: "", type: "expense" }] },
      { id: "ledger_x", participantIds: [], records: [] }
    ]
  };

  const result = migrateDataIntegrity(source, { at: FIXED_TIME });
  const [firstLedger, secondLedger] = result.data.ledgers;

  assert.equal(firstLedger.id, "ledger_x");
  assert.equal(secondLedger.id, "ledger_x__repair2");
  assert.equal(firstLedger.records[0].id, "record_repaired__repair2");
  assert.equal(result.repairs.length, 2);
});

test("clean data remains byte-meaningfully unchanged and produces no repair history", () => {
  const source = {
    schemaVersion: 1,
    updatedAt: "2026-08-16T00:00:00.000Z",
    ledgers: [
      {
        id: "ledger_clean",
        participantIds: ["a"],
        records: [{ id: "record_clean", type: "expense", history: [] }]
      }
    ]
  };

  const result = migrateDataIntegrity(source, { at: FIXED_TIME });
  assert.equal(result.changed, false);
  assert.deepEqual(result.repairs, []);
  assert.deepEqual(result.data, source);
});
