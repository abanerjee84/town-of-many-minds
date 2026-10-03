import chart from '../data/priceChart.json' with { type: 'json' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function rowFor(path) {
  const [group, key] = String(path || '').split('.');
  return chart[group]?.[key] || chart[group] || null;
}

function townSignals(town) {
  const economy = town?.economy;
  const industry = town?.industry;
  const stats = economy?.stats?.() || {};
  const pressure = num(town?.growth?.inputs?.()?.pressure, 0);
  const evidence = town?.governance?.congestionEvidence?.();
  const congestion = num(evidence?.average, num(town?.traffic?.mobilityStats?.()?.congestion, 0));
  const treasury = num(stats.treasury, num(economy?.treasury, 0));
  const reserve = num(stats.operatingReserve, num(economy?.requiredPublicReserve?.() || 0, 0));
  const burn = Math.max(1, num(stats.projectedDailyBurn, num(stats.dailyBudget, 1)));
  const fiscalPressure = clamp((reserve + burn * 14 - treasury) / Math.max(1, reserve + burn * 14), 0, 1);
  return { pressure: clamp(pressure, 0, 1), congestion: clamp(congestion, 0, 1), fiscalPressure, industry };
}

function commodityScarcity(town, key) {
  const industry = town?.industry;
  if (!industry || !key) return 0.5;
  const capacity = num(chart.commodity?.[key]?.capacity, 0);
  const stock = num(industry.totalStock?.(key), num(industry.stocks?.[key], 0));
  if (capacity <= 0) return 0.5;
  return clamp(1 - stock / capacity, 0, 1);
}

/** Return the immutable chart, useful for UI/settings and deterministic tests. */
export function priceChart() { return chart; }

export function basePrice(path, fallback = 0) {
  const row = rowFor(path);
  return Math.max(0, Math.round(num(row?.base, fallback)));
}

/**
 * Quote a price from the chart and live town pressure. The adjustment is
 * deliberately bounded and deterministic: stock scarcity raises commodity
 * prices, housing/industrial pressure raises construction prices, congestion
 * raises roads, and a short treasury runway raises the price of scarce public
 * capital. Callers may pass `dynamic:false` for historical/accounting values.
 */
export function quotePrice(path, town, options = {}) {
  const row = rowFor(path) || {};
  const fallback = num(options.fallback, 0);
  const base = Math.max(0, num(row.base, fallback));
  if (!base) return 0;
  if (options.dynamic === false || !town) return Math.round(base * Math.max(1, num(options.quantity, 1)));
  const signals = townSignals(town);
  let adjustment = 0;
  const group = String(path).split('.')[0];
  if (group === 'commodity') {
    adjustment += (commodityScarcity(town, String(path).split('.')[1]) - 0.5) * num(row.elasticity, 0.35);
  } else {
    adjustment += (signals.pressure - 0.35) * num(row.pressure, row.elasticity || chart.defaults.elasticity);
    adjustment += (signals.congestion - 0.35) * num(row.congestion, 0);
    adjustment += signals.fiscalPressure * num(row.fiscal, 0.10);
  }
  const factor = clamp(1 + adjustment, num(chart.defaults.minFactor, 0.72), num(chart.defaults.maxFactor, 1.85));
  return Math.max(1, Math.round(base * factor * Math.max(1, num(options.quantity, 1))));
}

export function commodityPrice(town, key, side = 'local') {
  const base = quotePrice(`commodity.${key}`, town, { fallback: 1 });
  if (side === 'buy' || side === 'import') return Math.round(base * 1.18);
  if (side === 'sell' || side === 'export') return Math.round(base * 0.84);
  return base;
}

export function priceIndex(town) {
  const construction = quotePrice('construction.house', town, { fallback: 9000 }) / basePrice('construction.house', 9000);
  const land = quotePrice('land', town, { fallback: 650 }) / basePrice('land', 650);
  const commodities = Object.keys(chart.commodity).map((key) => commodityPrice(town, key) / basePrice(`commodity.${key}`, 1));
  return {
    construction: Math.round(construction * 100) / 100,
    land: Math.round(land * 100) / 100,
    commodities: Math.round((commodities.reduce((a, b) => a + b, 0) / Math.max(1, commodities.length)) * 100) / 100,
    version: chart.version
  };
}
