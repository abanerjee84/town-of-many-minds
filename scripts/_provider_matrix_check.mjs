import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const days = Number(process.env.MATRIX_DAYS || 1200);
const step = Math.max(1, Math.floor(days / 20));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5179', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.governance && !!window.runCouncilBenchmark);
  const result = await page.evaluate(async ({ days, step }) => {
    const providers = [
      { id: 'matrix-no-action', complete: async () => ({ model: 'matrix-no-action', text: 'INTENT: NO_ACTION' }) },
      { id: 'matrix-study', complete: async () => ({ model: 'matrix-study', text: 'INTENT: STUDY_ECONOMY' }) }
    ];
    const scenarios = [{ id: `${days}-day-matrix`, seed: 'matrix-1337', sittings: Math.ceil(days / step) }];
    const advance = async (town, scenario, sitting) => {
      const start = Math.min(days, sitting * step);
      const end = Math.min(days, start + step);
      const dt = 24 * 60 * 60;
      const raw = 1;
      for (let day = start; day < end; day++) {
        const clock = { day: day + 1, hour: 12, speed: 1 };
        town.advance(dt, clock);
        town.lifecycle.update(dt, clock);
        town.economy.update(dt, clock);
        town.industry.update(dt, clock);
        town.growth.update(dt);
        town.utilities.update(clock);
        town.resources.update(clock, raw);
      }
    };
    const rows = await window.runCouncilBenchmark(window.town, providers, { scenarios, advance });
    return rows.map((row) => {
      const after = row.scenarios[0].after;
      return {
        provider: row.provider,
        score: row.scenarios[0].score,
        priceSamples: window.town.priceHistory?.length || 0,
        treasury: after.treasury,
        population: after.population,
        decisions: row.scenarios[0].decisions.length
      };
    });
  }, { days, step });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.length, 2, JSON.stringify(result));
  assert.ok(result.every((row) => row.decisions > 0 && Number.isFinite(row.treasury)));
  console.log(JSON.stringify({ days, step, result }));
} finally {
  await browser.close();
}
