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
  const before = {
    vacant: t.growth.vacantAcquiredPlots(99),
    needed: t.growth.landNeeded(),
    expansions: t.perimeter.stats().expansions,
    acquired: t.perimeter.stats().acquired
  };
  const first = window.forceCouncilRequest('INTENT: ACQUIRE_LAND');
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
  return { before, first, afterFirst, second, afterSecond };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (result.before.vacant !== 0 || !result.before.needed) {
  throw new Error(`seed 1337 should begin exhausted for the gate probe: ${JSON.stringify(result)}`);
}
if (result.first.status !== 'done' || result.afterFirst.vacant < 1) {
  throw new Error(`initial acquisition did not open serviced land: ${JSON.stringify(result)}`);
}
if (result.second.status !== 'rejected' || result.second.detail !== 'acquired serviced land is not exhausted, or no unacquired frontier tiles remain, or the reserve is too low') {
  throw new Error(`ACQUIRE_LAND bypassed the exhaustion gate: ${JSON.stringify(result)}`);
}
if (result.afterSecond.expansions !== result.afterFirst.expansions || result.afterSecond.acquired !== result.afterFirst.acquired) {
  throw new Error(`rejected acquisition changed the perimeter: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
