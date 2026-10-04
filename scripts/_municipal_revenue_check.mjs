import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.economy, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const town = window.town;
    town.generate(1337);
    const economy = town.economy;
    economy.syncEntities();
    const rider = (town.pedestrians?.citizens || []).find((citizen) => citizen.p.age >= 16);
    if (!rider) throw new Error('municipal revenue check needs an adult rider');
    rider.p.preferences = { ...(rider.p.preferences || {}), transport: 'bus' };
    // Give the test rider a bounded wallet through the real ledger rather than
    // assigning cash directly, so the conservation audit remains meaningful.
    if (rider.p.cash < 25) {
      const funded = economy.transfer({
        from: 'external', to: { sector: 'household', id: rider.p.id }, amount: 25,
        category: 'immigration_capital_inflow', metadata: { test: 'municipal-revenue' }
      });
      if (!funded.ok) throw new Error(`could not fund test rider: ${funded.reason}`);
    }
    const originalStats = town.transport?.stats?.bind(town.transport);
    if (!originalStats) throw new Error('public transport system is unavailable');
    town.transport.stats = () => ({ ...originalStats(), dailyRides: Math.max(2, originalStats().dailyRides || 0) });
    economy.lastDay = 2;
    const period = economy.runEconomicDay();
    const stats = economy.stats();
    const flow = economy.treasuryFlow(2);
    return {
      categories: {
        transit_fare: period.categories.transit_fare || 0,
        business_license: period.categories.business_license || 0,
        land_lease: period.categories.land_lease || 0,
        tourism_tax: period.categories.tourism_tax || 0,
        utility_fee: period.categories.utility_fee || 0
      },
      municipalRevenue: stats.municipalRevenue,
      breakdown: stats.revenueBreakdown,
      flow: { municipalFees: flow.municipalFees, reconciled: flow.reconciled },
      businesses: economy.businesses.length,
      audit: economy.audit()
    };
  });
  const failures = [...errors];
  for (const category of ['transit_fare', 'business_license', 'land_lease']) {
    if (!(result.categories[category] > 0)) failures.push(`${category} did not collect`);
  }
  if (!(result.categories.utility_fee > 0)) failures.push('utility_fee did not collect');
  if (!(result.municipalRevenue > 0)) failures.push('municipal revenue is not exposed in stats');
  if (result.flow.municipalFees <= 0) failures.push('treasury flow omitted municipal fees');
  if (!result.flow.reconciled) failures.push('treasury flow did not reconcile');
  if (!result.audit.ok) failures.push(`economy audit failed: ${JSON.stringify(result.audit)}`);
  console.log(JSON.stringify({ ok: failures.length === 0, result, errors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
