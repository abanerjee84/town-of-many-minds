import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.traffic && !!window.clock, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const town = window.town;
    const clock = window.clock;
    clock.speed = 0;
    town.generate(1337);

    const first = town.stats();
    const second = town.stats();
    const cacheHit = first === second;

    // A rebuild invalidates the cache and produces a new diagnostic snapshot.
    town.rebuildStatic({ roads: false, lots: false, validate: false });
    const afterMutation = town.stats();
    const invalidated = afterMutation !== second;

    clock.speed = 100;
    town.traffic.runShared(1.6, clock);
    const perf = town.traffic.performanceStats();
    const updated = town.stats({ force: true });
    const pricing = town.economy.pricingSignals();
    const pricingMatches = ['treasury', 'operatingReserve', 'projectedDailyBurn']
      .every(key => pricing[key] === updated.economy[key]);
    const liveRows = town.governance.staffNeed().civic.rows;
    const reportRows = updated.governance.staff.civic.rows;
    const staffingBoundary = liveRows.length > 0 &&
      liveRows.every(row => town.buildings.includes(row.building)) &&
      reportRows.every((row, index) => !('building' in row) &&
        row.buildingId === liveRows[index].building.id && row.have === liveRows[index].have && row.need === liveRows[index].need);
    const grownRenderMode = window.sceneMgr.setPerformanceMode({ speed: 50, population: 170, staticVersion: town.staticVersion() });

    return {
      cacheHit,
      invalidated,
      pricingMatches,
      staffingBoundary,
      grownRenderMode,
      perf,
      snapshotPerformance: updated.performance,
      trees: town.forest?.stats?.().trees || 0,
    };
  });

  const failures = [];
  if (!result.cacheHit) failures.push('Town.stats() did not reuse the same-version snapshot');
  if (!result.invalidated) failures.push('Town.stats() cache was not invalidated after a rebuild');
  if (!result.pricingMatches) failures.push('lean pricing signals differ from the full fiscal report');
  if (!result.staffingBoundary) failures.push('staffing report must retain counts and IDs while operations retain live buildings');
  if (result.grownRenderMode !== 'high-speed') failures.push('grown-town rendering optimization did not activate below 240 residents');
  if (!(result.perf.budgetSeconds > 0.8)) failures.push('adaptive agent budget did not increase at 100x');
  if (result.perf.lagRatio > 0.05) failures.push(`unexpected founding agent lag ratio ${result.perf.lagRatio}`);
  failures.push(...pageErrors.map((message) => `page error: ${message}`));
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
