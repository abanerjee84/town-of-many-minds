import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth?.quote && !!window.planFor, null, { timeout: 60000 });
await page.evaluate(() => window.town.generate(42));

const result = await page.evaluate(() => {
  const town = window.town;
  const growth = town.growth;
  const before = {
    roads: town.grid.roadCells().length,
    acquired: town.perimeter.stats().acquired,
    expansions: town.perimeter.stats().expansions,
    vacant: growth.vacantAcquiredPlots(99),
    landNeeded: growth.landNeeded()
  };
  if (before.vacant < 1 || before.landNeeded) {
    throw new Error(`seed 42 should have a serviced plot and no land order: ${JSON.stringify(before)}`);
  }

  // Simulate a full acquired frontage without changing the world. The house
  // must price a connected street and use the frontage that street unlocks;
  // it must not silently turn the one-cell build into ACQUIRE_LAND.
  const originalFindCell = growth.findCell.bind(growth);
  growth.vacantAcquiredPlots = () => 0;
  growth.findCell = (type, zone, opts = {}) => {
    if (type === 'house' && !opts.allowUnacquired) return null;
    return originalFindCell(type, zone, opts);
  };

  const plan = window.planFor(town, 'house', { need: 0.5 });
  const quote = growth.quote(plan);
  const quotedExpansion = quote.plan?.expansion || [];
  if (!quote.ok || !quotedExpansion.length) {
    throw new Error(`housing did not quote a connected street expansion: ${JSON.stringify({ quote, quotedExpansion })}`);
  }
  const applied = growth.apply(quote.plan);
  const after = {
    roads: town.grid.roadCells().length,
    acquired: town.perimeter.stats().acquired,
    expansions: town.perimeter.stats().expansions,
    projectCount: growth.projects.length
  };
  return { before, quote: { ok: quote.ok, expansion: quotedExpansion, cost: quote.quote?.finalCost }, applied, after };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (result.applied?.status !== 'started') {
  throw new Error(`one-cell housing did not start after street expansion: ${JSON.stringify(result)}`);
}
if (result.after.roads <= result.before.roads) {
  throw new Error(`housing expansion did not add a street: ${JSON.stringify(result)}`);
}
if (result.after.acquired !== result.before.acquired) {
  throw new Error(`one-cell housing bought frontier land instead of using the acquired envelope: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
