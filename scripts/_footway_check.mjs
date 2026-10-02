import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth && !!window.forceCouncilRequest);

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate('footway-regression');
  t.governance.auto = false;
  const before = t.grid.countOf(6);
  const ranked = t.growth.ranked({ amenities: false }).map((row) => row.type);
  const target = t.growth.footwayTarget({ minLength: 1 });
  if (!target) return { before, ranked, target: null };
  const laid = t.paintFootway(...target.cell);
  const afterPath = t.grid.countOf(6);
  const asphalt = t.paintRoad(...target.cell);
  const afterAsphaltPath = t.grid.countOf(6);
  const afterRoad = t.grid.countOf(1);
  const forcedBefore = t.governance.stats().forcedRequests;
  const decision = window.forceCouncilRequest('NO_ACTION');
  const forcedAfter = t.governance.stats().forcedRequests;
  return {
    before,
    ranked,
    target: { cell: target.cell, length: target.cells.length },
    laid,
    afterPath,
    asphalt,
    afterAsphaltPath,
    afterRoad,
    forcedDelta: forcedAfter - forcedBefore,
    decision: { intent: decision?.intent, status: decision?.status, forced: !!decision?.forced },
    llmCalls: t.governance.stats().llmCalls
  };
});

await browser.close();
const failures = [];
if (result.target == null) failures.push('no explicit inland footway target');
if (result.ranked?.includes('footway')) failures.push('footway entered automatic growth ranking');
if (!result.laid || result.afterPath <= result.before) failures.push('explicit footway did not lay a path');
if (!result.asphalt || result.afterAsphaltPath !== 0 || result.afterRoad <= 0) failures.push('Road tool did not convert the path to asphalt');
if (result.forcedDelta !== 1 || result.llmCalls !== 0) failures.push('forced request used an unexpected provider path');
console.log(JSON.stringify({ ok: failures.length === 0, result, pageErrors, failures }));
process.exit(pageErrors.length || failures.length ? 1 : 0);
