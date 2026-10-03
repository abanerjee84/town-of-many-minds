import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.town?.growth?.landNeeded, null, { timeout: 60000 });
await page.waitForTimeout(250);

const result = await page.evaluate(() => {
  const t = window.town;
  const originalVacant = t.growth.vacantAcquiredPlots;
  const before = {
    vacant: t.growth.vacantAcquiredPlots(99),
    needed: t.growth.landNeeded(),
    expansions: t.perimeter.stats().expansions,
    acquired: t.perimeter.stats().acquired
  };
  // The founding envelope now starts acquired and has serviced frontage. A
  // first request must therefore be rejected. Temporarily exhaust the live
  // serviced-plot probe to exercise the next gate without constructing dozens
  // of buildings in a geometry test.
  const forcedBounds = t.perimeter.stats().bounds;
  t.growth.vacantAcquiredPlots = () => 0;
  // Land purchase is instantaneous and must remain available even while the
  // two construction slots are occupied by unrelated work.
  t.growth.projects = [{ plan: { type: 'house' } }, { plan: { type: 'upgrade' } }];
  const acquiredBefore = new Set(t.perimeter.acquired);
  const first = window.forceCouncilRequest('INTENT: ACQUIRE_LAND');
  t.growth.vacantAcquiredPlots = originalVacant;
  const added = [...t.perimeter.acquired]
    .filter((key) => !acquiredBefore.has(key))
    .map((key) => key.split(',').map(Number));
  const afterFirst = {
    vacant: t.growth.vacantAcquiredPlots(99),
    needed: t.growth.landNeeded(),
    expansions: t.perimeter.stats().expansions,
    acquired: t.perimeter.stats().acquired
  };
  const second = window.forceCouncilRequest('INTENT: ACQUIRE_LAND');
  const afterSecond = {
    vacant: t.growth.vacantAcquiredPlots(99),
    expansions: t.perimeter.stats().expansions,
    acquired: t.perimeter.stats().acquired
  };
  return { before, first, afterFirst, second, afterSecond, added, forcedBounds };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (result.before.vacant < 1 || result.before.needed) {
  throw new Error(`seed 1337 should begin with acquired serviced land for the gate probe: ${JSON.stringify(result)}`);
}
if (result.first.status !== 'done' || !result.added.length || result.added.some(([x, y]) =>
  x >= result.forcedBounds.minX && x <= result.forcedBounds.maxX && y >= result.forcedBounds.minY && y <= result.forcedBounds.maxY
)) {
  throw new Error(`exhausted acquisition did not stay on frontier land: ${JSON.stringify(result)}`);
}
if (result.second.status !== 'rejected' || result.second.detail !== 'acquired land still has usable serviced plots') {
  throw new Error(`ACQUIRE_LAND bypassed the exhaustion gate: ${JSON.stringify(result)}`);
}
if (result.afterSecond.expansions !== result.afterFirst.expansions || result.afterSecond.acquired !== result.afterFirst.acquired) {
  throw new Error(`rejected acquisition changed the perimeter: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
