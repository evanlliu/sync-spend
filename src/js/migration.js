/**
 * 运行期数据兼容迁移。
 *
 * 原则：
 * 1. 不删除任何历史记录；
 * 2. 第一个合法 ID 保持不变，只修复后续重复项或空 ID；
 * 3. 修复 ID 必须确定性生成，脏数据在尚未保存前重复加载也会得到同样结果；
 * 4. 不修改业务时间（createdAt / updatedAt），避免一次兼容迁移改变记录排序；
 * 5. record ID 修复写入 history，便于以后审计来源。
 */
export function migrateDataIntegrity(input, { at = new Date().toISOString() } = {}) {
  const data = cloneJson(input && typeof input === "object" ? input : {});
  data.ledgers = Array.isArray(data.ledgers) ? data.ledgers : [];

  const repairs = [];
  repairIds(data.ledgers, {
    kind: "ledger",
    fallbackPrefix: "ledger_repaired",
    repairs
  });

  for (const ledger of data.ledgers) {
    if (!ledger || typeof ledger !== "object") continue;
    ledger.records = Array.isArray(ledger.records) ? ledger.records : [];
    repairIds(ledger.records, {
      kind: "record",
      fallbackPrefix: "record_repaired",
      parentId: String(ledger.id || ""),
      repairs,
      onRepair: (record, oldId, newId, reason) => {
        record.history = Array.isArray(record.history) ? record.history : [];
        const summary = reason === "duplicate"
          ? `自动修复重复记录 ID: ${oldId} → ${newId}`
          : `自动补全缺失记录 ID: ${newId}`;
        const alreadyLogged = record.history.some((item) => (
          item?.action === "id_repaired"
          && String(item?.summary || "") === summary
        ));
        if (!alreadyLogged) record.history.push({ action: "id_repaired", at, summary });
      }
    });
  }

  return {
    data,
    changed: repairs.length > 0,
    repairs
  };
}

function repairIds(items, { kind, fallbackPrefix, parentId = "", repairs, onRepair = null }) {
  const originalIds = new Set(
    items
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean)
  );
  const assignedIds = new Set();

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const oldId = String(item.id || "").trim();
    const duplicate = Boolean(oldId) && assignedIds.has(oldId);
    const missing = !oldId;
    if (!duplicate && !missing) {
      assignedIds.add(oldId);
      return;
    }

    const base = missing ? fallbackPrefix : oldId;
    const newId = allocateRepairId(base, originalIds, assignedIds);
    item.id = newId;
    assignedIds.add(newId);
    originalIds.add(newId);

    const repair = {
      kind,
      reason: duplicate ? "duplicate" : "missing",
      parentId,
      index,
      oldId: oldId || null,
      newId
    };
    repairs.push(repair);
    if (onRepair) onRepair(item, oldId, newId, repair.reason);
  });
}

function allocateRepairId(base, originalIds, assignedIds) {
  const safeBase = String(base || "id_repaired").trim() || "id_repaired";
  let sequence = 2;
  let candidate = `${safeBase}__repair${sequence}`;
  while (originalIds.has(candidate) || assignedIds.has(candidate)) {
    sequence += 1;
    candidate = `${safeBase}__repair${sequence}`;
  }
  return candidate;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
