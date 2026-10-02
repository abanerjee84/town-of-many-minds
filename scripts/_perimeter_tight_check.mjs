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
  const g = t.grid;
  const allAssets = [];
  for (const building of t.buildings) allAssets.push(...(building.footprint?.length ? building.footprint : [building.cell]));
  for (const site of t.resources.sites) allAssets.push(...(site.cells || []));
  g.forEach((x, y) => {
    if (g.isRoad(x, y) || g.kindAt(x, y) === 3 || g.kindAt(x, y) === 5) allAssets.push([x, y]);
  });
  const acquiredAssets = allAssets.filter(([x, y]) => !g.isWater(x, y));
  const assetKeys = new Set(acquiredAssets.map(([x, y]) => `${x},${y}`));
  const xs = allAssets.map(([x]) => x);
  const ys = allAssets.map(([, y]) => y);
  const assetBounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const boundsMatch = bounds && Object.entries(assetBounds).every(([key, value]) => bounds[key] === value);
  const acquiredKeys = [...t.perimeter.acquired];
  const exactAssetLedger = acquiredKeys.every((key) => assetKeys.has(key));
  const resourcesOwned = acquiredAssets.every(([x, y]) => t.perimeter.isAcquired(x, y));
  return {
    bounds,
    assetBounds,
    boundsMatch,
    acquired: t.perimeter.acquired.size,
    resourcesOwned,
    exactAssetLedger,
    frontier: t.perimeter.frontierCells(6)
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.boundsMatch) throw new Error(`founding perimeter is not asset-tight: ${JSON.stringify(result)}`);
if (!result.resourcesOwned || !result.exactAssetLedger) {
  throw new Error(`founding asset ownership was lost: ${JSON.stringify(result)}`);
}
if (!result.frontier.length || result.frontier.some(([x, y]) => x < result.bounds.minX - 1 || x > result.bounds.maxX + 1 || y < result.bounds.minY - 1 || y > result.bounds.maxY + 1)) {
  throw new Error(`frontier did not grow from the asset envelope: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
