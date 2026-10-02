import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5174';
const SEEDS = ['42', '1337', '9001'];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.economy);

const results = [];
for (const seed of SEEDS) {
  const result = await page.evaluate(async (seed) => {
    const t = window.town;
    t.generate(seed);
    t.governance.auto = false;
    const first = t.buildings[0];
    const treasuryBeforeRollback = t.economy.treasury;
    const buildingsBeforeRollback = t.buildings.length;
    const rollbackPlan = {
      type: 'clear',
      label: 'rollback probe',
      target: first,
      cells: first?.footprint || [first?.cell],
      cost: 1500,
      run: () => false
    };
    const rollbackResult = t.growth.apply(rollbackPlan);
    const rollback = {
      rejected: rollbackResult === false,
      treasuryRestored: Math.abs(t.economy.treasury - treasuryBeforeRollback) < 0.01,
      buildingsRestored: t.buildings.length === buildingsBeforeRollback,
      tracked: [...t.growth.projectStates.values()].some((p) => p.state === 'FAILED_ROLLED_BACK')
    };

    const dayDt = 24 * 60 * 0.18;
    let minTreasury = t.economy.treasury;
    let maxPopulation = t.pedestrians.citizens.length;
    let auditFailures = 0;
    let inventoryFailures = 0;
    for (let day = 2; day <= 301; day++) {
      const clock = { day, hour: 0, daylight: 0, speed: 1 };
      t.clockDay = day;
      t.lifecycle.update(dayDt, clock);
      t.economy.update(1, clock);
      t.industry.update(1, clock);
      if (day % 3 === 0) {
        const plan = t.growth.evaluate({ amenities: false });
        if (plan) t.growth.apply(plan);
      }
      t.growth.update(dayDt);
      minTreasury = Math.min(minTreasury, t.economy.treasury);
      maxPopulation = Math.max(maxPopulation, t.pedestrians.citizens.length);
      if (!t.economy.audit().ok) auditFailures++;
      const stock = t.industry.stats().commodities;
      if (Object.values(stock).some((row) => !Number.isFinite(row.stock) || row.stock < -0.001)) inventoryFailures++;
    }
    const stats = t.economy.stats();
    return {
      seed,
      rollback,
      minTreasury: Math.round(minTreasury),
      finalTreasury: Math.round(t.economy.treasury),
      maxPopulation,
      projectedDailyBurn: stats.projectedDailyBurn,
      auditFailures,
      inventoryFailures,
      finalAudit: t.economy.audit().ok,
      fiscalBand: stats.fiscalBand
    };
  }, seed);
  results.push(result);
  console.log(JSON.stringify(result));
}

await browser.close();
const failed = results.filter((r) =>
  !r.rollback.rejected || !r.rollback.treasuryRestored || !r.rollback.buildingsRestored || !r.rollback.tracked ||
  r.minTreasury < 0 || r.auditFailures || r.inventoryFailures || !r.finalAudit
);
console.log(JSON.stringify({ pageErrors, failed: failed.length }));
if (pageErrors.length || failed.length) process.exit(1);
