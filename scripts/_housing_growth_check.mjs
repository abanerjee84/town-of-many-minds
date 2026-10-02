import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.evaluate(() => window.town.generate(42));

const result = await page.evaluate(() => {
  const t = window.town;
  const g = t.growth;
  const before = {
    beds: g.inputs().capacity,
    population: g.inputs().pop,
    pressure: g.inputs().pressure,
    housingWanted: g.wanted('house'),
    landNeeded: g.landNeeded(),
    top: g.ranked()[0]?.type || null,
    acquired: t.perimeter.stats().acquired
  };
  if (before.population !== before.beds || !before.housingWanted || before.landNeeded || before.top !== 'house') {
    throw new Error(`full-bed founding town did not expose housing on acquired land: ${JSON.stringify(before)}`);
  }
  const housing = t.governance.forceRequest('DEVELOP_HOUSING');
  return { before, housing };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (result.housing.status !== 'started') throw new Error(`housing request did not start: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result));
await browser.close();
