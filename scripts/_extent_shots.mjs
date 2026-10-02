import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEED = process.env.SEED || '1337';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', SEED);
await page.click('#regen');
await page.waitForTimeout(1200);

// 1. The default home view, as the player first sees it.
await page.screenshot({ path: `shots/extent-${SEED}-home.png` });

// 2. Top-down over the whole extent, so the ground plane == buildable grid
//    claim is visible: the town should sit small in the middle of open land.
await page.evaluate(() => {
  window.sceneMgr.camera.position.set(0.01, 260, 0.01);
  window.sceneMgr.controls.target.set(0, 0, 0);
  window.sceneMgr.camera.up.set(0, 0, -1);
  window.sceneMgr.controls.update();
});
await page.waitForTimeout(400);
await page.screenshot({ path: `shots/extent-${SEED}-top.png` });

// 3. After the town has expanded outward for real, at the same framing as (1),
//    to show the founding core is not the limit of the map.
const grown = await page.evaluate(() => {
  const t = window.town;
  for (let i = 0; i < 60; i++) if (!t.growth.expandFor(null)) break;
  t.rebuildAll();
  return { roads: t.grid.roadCount, cells: t.grid.w * t.grid.h };
});
await page.evaluate(() => {
  window.sceneMgr.resetView();
});
await page.waitForTimeout(700);
await page.screenshot({ path: `shots/extent-${SEED}-grown.png` });

console.log(`seed ${SEED}: after expansion ${grown.roads} road tiles on ${grown.cells} cells`);
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
