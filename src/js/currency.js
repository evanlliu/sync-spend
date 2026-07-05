const RATE_DECIMALS = 4;
const RATE_FACTOR = 10 ** RATE_DECIMALS;

export function getToCnyRate(currency, rates) {
  if (currency === "CNY") return 1;
  const live = normalizeRate(rates?.toCny?.[currency]);
  return live || null;
}

export function toCny(amount, currency, rates, config, overrideRate = null) {
  const rate = normalizeRate(overrideRate) || getToCnyRate(currency, rates);
  return convertWithRate(amount, rate);
}

export function convertWithRate(amount, rate) {
  const normalizedRate = normalizeRate(rate);
  if (!normalizedRate) return { amountCny: null, rateToCny: null };
  return {
    amountCny: roundMoney(Number(amount || 0) * normalizedRate),
    rateToCny: normalizedRate
  };
}

export function normalizeRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? roundRate(rate) : null;
}

export function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function roundRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(rate * RATE_FACTOR) / RATE_FACTOR;
}

export function formatRate(value) {
  const rate = normalizeRate(value);
  return rate ? rate.toFixed(RATE_DECIMALS) : "";
}
