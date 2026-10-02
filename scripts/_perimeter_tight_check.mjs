import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.perimeter, null, { timeout: 60000 });
await page.evaluate(() => window.town.generate(1337));

const result = await page.evaluate(() => {
  const t = window.town;
  const bounds = t.perimeter.stats().bounds;
  const core = t.core;
  const resourceCells = t.resources.sites.flatMap((site) => site.cells || [])
    .filter(([x, y]) => !t.grid.isWater(x, y));
  const resourcesOwned = resourceCells.every(([x, y]) => t.perimeter.isAcquired(x, y));
  const coreBoundsMatch = bounds &&
    bounds.minX === core.x0 && bounds.minY === core.y0 &&
    bounds.maxX === core.x1 && bounds.maxY === core.y1;
  const remoteResourceCells = resourceCells.filter(([x, y]) =>
    x < core.x0 || x > core.x1 || y < core.y0 || y > core.y1
  );
  return {
    core,
    bounds,
    coreBoundsMatch,
    acquired: t.perimeter.acquired.size,
    resourcesOwned,
    remoteResourceCells: remoteResourceCells.length,
    frontier: t.perimeter.frontierCells(6)
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.coreBoundsMatch) throw new Error(`founding perimeter is not tight: ${JSON.stringify(result)}`);
if (!result.resourcesOwned || !result.remoteResourceCells) {
  throw new Error(`remote resource ownership was lost: ${JSON.stringify(result)}`);
}
if (!result.frontier.length || result.frontier.some(([x, y]) => x < result.bounds.minX - 1 || x > result.bounds.maxX + 1 || y < result.bounds.minY - 1 || y > result.bounds.maxY + 1)) {
  throw new Error(`frontier did not grow from the compact town envelope: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
