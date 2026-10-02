import { chromium } from 'playwright';
import { CELL_KIND } from '../src/core/config.js';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://localhost:5173/?seed=1337', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth && !!window.town?.forest, null, { timeout: 60000 });

const result = await page.evaluate((kinds) => {
  const t = window.town;
  t.generate(1337);

  const buildCell = t.growth.findCell('house', 'residential');
  if (!buildCell) throw new Error('no residential build site available for vegetation check');
  const plantedBuild = t.addProp(buildCell[0], buildCell[1], 'tree', { rebuild: false });
  const buildHadTree = t.forest.hasTreeAt(buildCell[0], buildCell[1]);
  const building = t.placeBuilding(buildCell[0], buildCell[1], 'residential');
  const buildTreeRemains = t.forest.hasTreeAt(buildCell[0], buildCell[1]);

  const expansion = t.growth.findExpandCells('house', 30)[0];
  if (!expansion) throw new Error('no expansion cell available for vegetation check');
  const plantedRoad = t.addProp(expansion.x, expansion.y, 'tree', { rebuild: false });
  const roadHadTree = t.forest.hasTreeAt(expansion.x, expansion.y);
  const paved = t.expandTown(expansion.x, expansion.y, { chargeLand: false });
  const roadTreeRemains = t.forest.hasTreeAt(expansion.x, expansion.y);

  // Simulate a specialist planner that writes a road cell directly. The
  // rebuild guard must remove the stale prop before layoutLots renders it.
  let staleRoad = null;
  t.grid.forEach((x, y) => {
    if (!staleRoad && t.grid.kindAt(x, y) === kinds.EMPTY) staleRoad = [x, y];
  });
  if (!staleRoad) throw new Error('no empty cell available for stale road check');
  const plantedStaleRoad = t.addProp(staleRoad[0], staleRoad[1], 'tree', { rebuild: false });
  t.grid.setKind(staleRoad[0], staleRoad[1], kinds.ROAD);
  t.rebuildAll();
  const staleRoadTreeRemains = t.forest.hasTreeAt(staleRoad[0], staleRoad[1]);

  return {
    buildCell, plantedBuild, buildHadTree, building: !!building, buildTreeRemains,
    expansion: [expansion.x, expansion.y], plantedRoad, roadHadTree,
    paved: Array.isArray(paved) ? paved.length : 0, roadTreeRemains,
    staleRoad, plantedStaleRoad, staleRoadTreeRemains,
    forest: t.stats().forest
  };
}, CELL_KIND);

console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
if (!result.plantedBuild || !result.buildHadTree || !result.building || result.buildTreeRemains) {
  throw new Error('BUILD_SITE left a tree on the building footprint');
}
if (!result.plantedRoad || !result.roadHadTree || !result.paved || result.roadTreeRemains) {
  throw new Error('street expansion left a tree on asphalt');
}
if (!result.plantedStaleRoad || result.staleRoadTreeRemains) {
  throw new Error('road rebuild rendered a stale tree prop');
}
