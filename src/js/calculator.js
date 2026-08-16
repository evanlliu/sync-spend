import { roundMoney } from "./currency.js";

export function isSettlementRecord(record) {
  return record?.type === "settlement";
}

/**
 * 统计消费者在账本与历史记录中的引用。
 * deleted 记录也必须计入：软删除只退出账务统计，不代表可以破坏审计引用。
 */
export function consumerUsage(data, consumerId) {
  const targetId = String(consumerId || "").trim();
  if (!targetId) return { ledgerCount: 0, recordCount: 0 };

  let ledgerCount = 0;
  let recordCount = 0;
  for (const ledger of Array.isArray(data?.ledgers) ? data.ledgers : []) {
    let ledgerReferenced = Array.isArray(ledger?.participantIds) && ledger.participantIds.includes(targetId);
    for (const record of Array.isArray(ledger?.records) ? ledger.records : []) {
      let recordReferenced = false;
      if (isSettlementRecord(record)) {
        recordReferenced = record.fromConsumerId === targetId || record.toConsumerId === targetId;
      } else {
        const splitIds = Array.isArray(record?.splitParticipantIds) ? record.splitParticipantIds : [];
        const splitAmountIds = record?.splitAmountsCny && typeof record.splitAmountsCny === "object"
          ? Object.keys(record.splitAmountsCny)
          : [];
        recordReferenced = record?.consumerId === targetId
          || splitIds.includes(targetId)
          || splitAmountIds.includes(targetId);
      }
      if (recordReferenced) {
        recordCount += 1;
        ledgerReferenced = true;
      }
    }
    if (ledgerReferenced) ledgerCount += 1;
  }

  return { ledgerCount, recordCount };
}

export function ledgerSummary(ledger, config) {
  const records = Array.isArray(ledger?.records) ? ledger.records.filter((record) => !record.deleted) : [];
  const participantIds = collectLedgerConsumerIds(ledger, records);
  const consumers = config?.consumers || [];
  const participants = participantIds
    .map((id) => consumers.find((consumer) => consumer.id === id) || { id, name: { "zh-CN": id, "en-US": id }, active: false })
    .filter(Boolean);

  const paidBy = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const shareBy = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const settlementPaidBy = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const settlementReceivedBy = Object.fromEntries(participantIds.map((id) => [id, 0]));
  const expenseRecords = records.filter((record) => !isSettlementRecord(record));
  const settlementRecords = records.filter(isSettlementRecord);
  const totalByCurrency = {};
  let totalCny = 0;
  let allocatedCny = 0;
  let settledCny = 0;

  for (const record of records) {
    if (isSettlementRecord(record)) {
      const amount = roundMoney(record.amountCny || record.amount || 0);
      const fromId = record.fromConsumerId;
      const toId = record.toConsumerId;
      if (fromId) {
        if (!settlementPaidBy[fromId]) settlementPaidBy[fromId] = 0;
        settlementPaidBy[fromId] = roundMoney(settlementPaidBy[fromId] + amount);
      }
      if (toId) {
        if (!settlementReceivedBy[toId]) settlementReceivedBy[toId] = 0;
        settlementReceivedBy[toId] = roundMoney(settlementReceivedBy[toId] + amount);
      }
      settledCny = roundMoney(settledCny + amount);
      continue;
    }

    const originalCurrency = record.currency || "CNY";
    const originalAmount = roundMoney(record.amount || 0);
    totalByCurrency[originalCurrency] = roundMoney((totalByCurrency[originalCurrency] || 0) + originalAmount);

    const amount = roundMoney(record.amountCny || 0);
    totalCny = roundMoney(totalCny + amount);

    if (record.consumerId) {
      if (!paidBy[record.consumerId]) paidBy[record.consumerId] = 0;
      paidBy[record.consumerId] = roundMoney(paidBy[record.consumerId] + amount);
    }

    const shares = recordShareMap(record, ledger?.participantIds || []);
    for (const [consumerId, share] of Object.entries(shares)) {
      if (!shareBy[consumerId]) shareBy[consumerId] = 0;
      shareBy[consumerId] = roundMoney(shareBy[consumerId] + share);
      allocatedCny = roundMoney(allocatedCny + share);
    }
  }

  const perPerson = participants.length ? roundMoney(totalCny / participants.length) : 0;
  const balances = participants.map((person) => {
    const paid = roundMoney(paidBy[person.id] || 0);
    const share = roundMoney(shareBy[person.id] || 0);
    const settlementPaid = roundMoney(settlementPaidBy[person.id] || 0);
    const settlementReceived = roundMoney(settlementReceivedBy[person.id] || 0);
    const beforeSettlementBalance = roundMoney(paid - share);
    const balance = roundMoney(beforeSettlementBalance + settlementPaid - settlementReceived);
    return {
      consumerId: person.id,
      consumer: person,
      paid,
      share,
      settlementPaid,
      settlementReceived,
      settledNet: roundMoney(settlementPaid - settlementReceived),
      beforeSettlementBalance,
      balance
    };
  });

  return {
    participants,
    records,
    expenseRecords,
    settlementRecords,
    totalCny,
    totalByCurrency,
    settledCny,
    allocatedCny,
    unallocatedCny: roundMoney(totalCny - allocatedCny),
    perPerson,
    balances,
    settlements: buildSettlements(balances)
  };
}

/**
 * 汇总账本当前参与人和历史记录实际引用到的人。
 * 参与人从账本中移除、或消费者被停用后，历史支付/分摊/结算仍必须继续出现在余额里。
 */
function collectLedgerConsumerIds(ledger, records = null) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    const value = String(id || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };

  for (const id of Array.isArray(ledger?.participantIds) ? ledger.participantIds : []) add(id);

  const sourceRecords = Array.isArray(records)
    ? records
    : (Array.isArray(ledger?.records) ? ledger.records.filter((record) => !record.deleted) : []);

  for (const record of sourceRecords) {
    if (isSettlementRecord(record)) {
      add(record.fromConsumerId);
      add(record.toConsumerId);
      continue;
    }

    add(record.consumerId);
    const splitIds = sanitizeSplitParticipants(record, ledger?.participantIds || []);
    for (const id of splitIds) add(id);
  }

  return ids;
}

export function recordShareMap(record, ledgerParticipantIds = []) {
  if (isSettlementRecord(record)) return {};

  const total = roundMoney(record.amountCny || 0);
  if (total <= 0) return {};

  const participantIds = sanitizeSplitParticipants(record, ledgerParticipantIds);
  if (!participantIds.length) return {};

  if (record.splitMode === "amount") {
    const map = {};
    const source = record.splitAmountsCny || {};
    for (const id of participantIds) {
      const value = roundMoney(source[id] || 0);
      if (value > 0) map[id] = value;
    }
    return map;
  }

  return equalShareMap(total, participantIds);
}

/**
 * 显式 splitParticipantIds 是记录创建时的历史快照，不能再拿账本“当前参与人”过滤。
 * 只有老数据没有快照时，才回退到 ledgerParticipantIds。
 */
export function sanitizeSplitParticipants(record, ledgerParticipantIds = []) {
  const explicit = Array.isArray(record?.splitParticipantIds) && record.splitParticipantIds.length
    ? record.splitParticipantIds
    : null;
  const amountKeys = !explicit && record?.splitMode === "amount" && record?.splitAmountsCny && typeof record.splitAmountsCny === "object"
    ? Object.keys(record.splitAmountsCny)
    : [];
  const source = explicit || (amountKeys.length ? amountKeys : (Array.isArray(ledgerParticipantIds) ? ledgerParticipantIds : []));
  return Array.from(new Set(source.map((id) => String(id || "").trim()).filter(Boolean)));
}

export function equalShareMap(total, participantIds) {
  const ids = Array.from(new Set(participantIds || [])).filter(Boolean);
  if (!ids.length) return {};

  const cents = Math.round(Number(total || 0) * 100);
  const base = Math.floor(cents / ids.length);
  let remainder = cents - base * ids.length;
  const result = {};

  for (const id of ids) {
    const centsForPerson = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    result[id] = roundMoney(centsForPerson / 100);
  }
  return result;
}

function buildSettlements(balances) {
  const debtors = balances
    .filter((item) => item.balance < -0.01)
    .map((item) => ({ ...item, value: roundMoney(Math.abs(item.balance)) }))
    .sort((a, b) => b.value - a.value);
  const creditors = balances
    .filter((item) => item.balance > 0.01)
    .map((item) => ({ ...item, value: roundMoney(item.balance) }))
    .sort((a, b) => b.value - a.value);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = roundMoney(Math.min(debtors[i].value, creditors[j].value));
    if (amount > 0) {
      settlements.push({ fromId: debtors[i].consumerId, toId: creditors[j].consumerId, amount });
    }
    debtors[i].value = roundMoney(debtors[i].value - amount);
    creditors[j].value = roundMoney(creditors[j].value - amount);
    if (debtors[i].value <= 0.01) i += 1;
    if (creditors[j].value <= 0.01) j += 1;
  }
  return settlements;
}
