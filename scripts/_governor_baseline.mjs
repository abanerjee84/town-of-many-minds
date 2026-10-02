import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://localhost:5174');
await page.waitForFunction(() => window.town?.economy);
const results = [];
for (const seed of ['42', '1337', '9001']) {
  for (const mode of ['operations', 'rules', 'reserve']) {
    results.push(await page.evaluate(({ seed, mode }) => {
      window.clock.speed = 0;
      const t = window.town;
      t.generate(seed);
      t.governance.auto = false;
      const initial = { treasury: t.economy.treasury, pop: t.pedestrians.citizens.length,
        beds: t.lifecycle.totalResidentialCapacity(), buildings: t.buildings.length,
        validation: t.validation, resources: t.resources.stats(), utilities: t.utilities.stats() };
      const timeline = [];
      for (let day = 2; day <= 31; day++) {
        const clock = { day, hour: 0, daylight: 0, speed: 1 };
        t.clockDay = day;
        t.economy.update(1, clock);
        t.industry.update(1, clock);
        if (mode === 'rules') for (let slot = 0; slot < 4; slot++) {
          t.governance.replan();
          t.growth.tickProjects(6 * 60 * 0.18);
        }
        if (mode === 'reserve') for (let slot = 0; slot < 4; slot++) t.governance.enact('INTENT: SET_ASIDE_RESERVE');
        const f = t.economy.treasuryFlow();
        if (day <= 8 || day === 31) timeline.push({ day, treasury: Math.round(t.economy.treasury), reserve: t.economy.reserve,
          inflows: Math.round(f.inflows), outflows: Math.round(f.outflows), operations: Math.round(f.operations),
          construction: Math.round(f.publicConstruction), payroll: Math.round(f.payrollServices),
          decisions: t.governance.decisions.slice(-4).map(d => `${d.intent}:${d.status}`), reconciled: f.reconciled,
          audit: t.economy.audit().ok });
      }
      return { seed, mode, initial, timeline };
    }, { seed, mode }));
  }
}
await browser.close();
const output = { errors, results };
await writeFile('BuildContracts/baseline.json', JSON.stringify(output, null, 2));
for (const r of results) console.log(JSON.stringify({ seed: r.seed, mode: r.mode, initial: { ...r.initial, resources: undefined, utilities: undefined, validation: undefined }, timeline: r.timeline }));
console.log('pageErrors', errors);
