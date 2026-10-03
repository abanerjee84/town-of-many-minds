import chart from '../data/buildtime.json' with { type: 'json' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export const BUILD_TIME_CHART = chart;
export const BASE_BUILD_HOURS = Object.freeze(Object.fromEntries(
  Object.entries(chart.types).map(([key, row]) => [key, num(row.base)])
));

function signals(town) {
  const pressure = num(town?.growth?.inputs?.()?.pressure, 0);
  const evidence = town?.governance?.congestionEvidence?.();
  const congestion = num(evidence?.average, num(town?.traffic?.mobilityStats?.()?.congestion, 0));
  const eco = town?.economy?.stats?.() || {};
  const burn = Math.max(1, num(eco.projectedDailyBurn, 1));
  const treasury = num(eco.treasury, 0);
  const reserve = num(eco.operatingReserve, 0);
  const fiscal = clamp((reserve + burn * 14 - treasury) / Math.max(1, reserve + burn * 14), 0, 1);
  return { pressure: clamp(pressure, 0, 1), congestion: clamp(congestion, 0, 1), fiscal };
}

export function baseBuildHours(type, fallback = 0) {
  return num(chart.types?.[type]?.base, fallback);
}

/** Quote construction time from the external table plus live, bounded pressure. */
export function buildHoursFor(type, town, options = {}) {
  const row = chart.types?.[type] || {};
  const base = num(row.base, num(options.base, 0));
  if (!base) return 0;
  const area = Math.max(1, num(options.area, options.plan?.footprint?.cols * options.plan?.footprint?.rows || 1));
  const floors = Math.max(1, num(options.floors, options.plan?.floors || 1));
  const areaScale = 1 + num(row.area, 0) * (area - 1);
  const floorScale = 1 + num(row.floors, 0) * (floors - 1);
  const s = signals(town);
  const adjustment = (s.pressure - 0.35) * num(row.pressure, chart.defaults.pressure) +
    (s.congestion - 0.35) * num(row.congestion, chart.defaults.congestion) +
    s.fiscal * num(row.fiscal, chart.defaults.fiscal);
  const factor = clamp(1 + adjustment, num(chart.defaults.minFactor, 0.7), num(chart.defaults.maxFactor, 1.75));
  return Math.max(0, Math.round(base * areaScale * floorScale * factor * 10) / 10);
}
