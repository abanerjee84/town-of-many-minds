import assert from 'node:assert/strict';
import { basePrice, quotePrice, commodityPrice, priceIndex } from '../src/simulation/priceChart.js';
import { BASE_BUILD_HOURS, buildHoursFor, BUILD_TIME_CHART } from '../src/simulation/buildTime.js';

const calm = {
  economy: { stats: () => ({ treasury: 1_000_000, operatingReserve: 250_000, projectedDailyBurn: 1_000 }) },
  growth: { inputs: () => ({ pressure: 0.2 }) },
  traffic: { mobilityStats: () => ({ congestion: 0.1 }) },
  industry: { stocks: { steel: 800 }, totalStock: (key) => key === 'steel' ? 800 : 500 }
};
const stressed = {
  economy: { stats: () => ({ treasury: 1_000, operatingReserve: 250_000, projectedDailyBurn: 30_000 }) },
  growth: { inputs: () => ({ pressure: 0.95 }) },
  governance: { congestionEvidence: () => ({ average: 0.9 }) },
  traffic: { mobilityStats: () => ({ congestion: 0.9 }) },
  industry: { stocks: { steel: 10 }, totalStock: (key) => key === 'steel' ? 10 : 500 }
};

const houseCalm = quotePrice('construction.house', calm);
const houseStress = quotePrice('construction.house', stressed);
const steelCalm = commodityPrice(calm, 'steel');
const steelStress = commodityPrice(stressed, 'steel');
assert.equal(basePrice('construction.house'), 9000);
assert(houseStress > houseCalm, 'construction prices should respond to live pressure');
assert(steelStress > steelCalm, 'commodity prices should respond to scarcity');
assert(priceIndex(stressed).version === 1);
assert(BASE_BUILD_HOURS.house === 16 && BUILD_TIME_CHART.version === 1);
const hoursCalm = buildHoursFor('factory', calm, { area: 9, floors: 2 });
const hoursStress = buildHoursFor('factory', stressed, { area: 9, floors: 2 });
assert(hoursStress > hoursCalm, 'build duration should respond to live pressure');
assert(hoursStress < 100, 'build duration must stay bounded');
console.log(JSON.stringify({ ok: true, houseCalm, houseStress, steelCalm, steelStress, hoursCalm, hoursStress }));
