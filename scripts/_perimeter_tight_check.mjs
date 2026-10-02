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
  const acquiredBounds = t.perimeter.acquiredBounds();
  const g = t.grid;
  const acquiredBefore = t.perimeter.acquired.size;
  const frontierBefore = t.perimeter.frontierCells(6);
  const groundBefore = {
    width: window.sceneMgr.ground.geometry.parameters.width,
    height: window.sceneMgr.ground.geometry.parameters.height
  };
  const allAssets = [];
  for (const building of t.buildings) allAssets.push(...(building.footprint?.length ? building.footprint : [building.cell]));
  for (const site of t.resources.sites) allAssets.push(...(site.cells || []));
  g.forEach((x, y) => {
    if (g.isRoad(x, y) || g.kindAt(x, y) === 3 || g.kindAt(x, y) === 5) allAssets.push([x, y]);
  });
  const acquiredAssets = allAssets.filter(([x, y]) => !g.isWater(x, y));
  const xs = allAssets.map(([x]) => x);
  const ys = allAssets.map(([, y]) => y);
  const assetBounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const boundsMatch = bounds && Object.entries(assetBounds).every(([key, value]) => bounds[key] === value);
  const acquiredKeys = [...t.perimeter.acquired];
  const envelopeLedger = acquiredKeys.every((key) => {
    const [x, y] = key.split(',').map(Number);
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY && !g.isWater(x, y);
  });
  const resourcesOwned = acquiredAssets.every(([x, y]) => t.perimeter.isAcquired(x, y));
  const expansionCell = t.perimeter.frontierCells(64).find(([x, y]) =>
    x === bounds.minX - 1 || x === bounds.maxX + 1 || y === bounds.minY - 1 || y === bounds.maxY + 1
  );
  const expansion = expansionCell
    ? t.perimeter.acquire([expansionCell], { charge: false, reason: 'perimeter regression' })
    : { ok: false, reason: 'no outer frontier cell' };
  const groundAfter = {
    width: window.sceneMgr.ground.geometry.parameters.width,
    height: window.sceneMgr.ground.geometry.parameters.height
  };
  return {
    bounds,
    acquiredBounds,
    assetBounds,
    boundsMatch,
    acquired: acquiredBefore,
    resourcesOwned,
    envelopeLedger,
    frontier: frontierBefore,
    groundBefore,
    groundAfter,
    expansion
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.boundsMatch) throw new Error(`founding perimeter is not asset-tight: ${JSON.stringify(result)}`);
if (!result.resourcesOwned || !result.envelopeLedger) {
  throw new Error(`founding asset ownership was lost: ${JSON.stringify(result)}`);
}
if (!result.acquiredBounds || Object.entries(result.acquiredBounds).some(([key, value]) => value !== result.bounds[key])) {
  throw new Error(`acquired-cell bounds are not exposed consistently: ${JSON.stringify(result)}`);
}
if (!result.expansion.ok || (result.groundAfter.width <= result.groundBefore.width && result.groundAfter.height <= result.groundBefore.height)) {
  throw new Error(`playable ground did not expand with acquired land: ${JSON.stringify(result)}`);
}
if (!result.frontier.length || result.frontier.some(([x, y]) => x < result.bounds.minX - 1 || x > result.bounds.maxX + 1 || y < result.bounds.minY - 1 || y > result.bounds.maxY + 1)) {
  throw new Error(`frontier did not grow from the asset envelope: ${JSON.stringify(result)}`);
}
if (result.frontier.some(([x, y]) => x >= result.bounds.minX && x <= result.bounds.maxX && y >= result.bounds.minY && y <= result.bounds.maxY)) {
  throw new Error(`frontier leaked into already acquired founding envelope: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
