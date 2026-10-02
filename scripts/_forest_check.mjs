import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.APP_URL || 'http://localhost:5173/?seed=1337', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const result = await page.evaluate(() => {
  const t = window.town;
  t.generate(1337);
  const b = t.perimeter.stats().bounds;
  let insideTrees = 0;
  let insideFoliage = 0;
  for (const [x, y] of t.forest.treeCells()) {
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) insideTrees++;
  }
  for (const [idx, list] of t.customProps) {
    const y = Math.floor(idx / t.grid.w); const x = idx - y * t.grid.w;
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
      insideFoliage += list.filter((v) => v === 'tree' || v === 'pine' || v === 'bush').length;
    }
  }
  const initial = { ...t.stats().forest, grid: { w: t.grid.w, h: t.grid.h }, insideTrees, insideFoliage };
  const cell = t.forest.treeCells()[0];
  const beforeLumber = t.industry.stocks.lumber;
  const removed = t.demolish(cell[0], cell[1]);
  const afterClear = t.stats().forest;
  const lumberAfterClear = t.industry.stocks.lumber;
  const planted = t.addProp(cell[0], cell[1], 'tree');
  const afterPlant = t.stats().forest;
  t.forest.lastDay = 1;
  t.forest.fallDebt = 1;
  t.forest.update({ day: 7 });
  const afterFall = t.stats().forest;
  return { initial, removed, beforeLumber, afterClear, lumberAfterClear, planted, afterPlant, afterFall };
});
console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
if (result.initial.grid?.w !== 100 || result.initial.grid?.h !== 100) throw new Error('forest grid is not 100x100');
if (result.initial.trees < 500 || result.initial.trees > 5000) throw new Error('forest coverage outside the visual budget');
if (result.initial.decorative < 12 || result.initial.foliage < result.initial.trees) throw new Error('foliage kit layer missing');
if (result.initial.insideTrees < 45 || result.initial.insideTrees > 55 || result.initial.insideFoliage < 55) throw new Error('founding foliage allotment is not balanced');
if (result.removed !== 'prop' || result.lumberAfterClear <= result.beforeLumber) throw new Error('deforestation did not return lumber');
if (!result.planted || result.afterPlant.planted <= result.initial.planted) throw new Error('plantation not counted');
if (result.afterFall.naturalFalls < 1) throw new Error('natural fall did not occur');
