import fs from 'node:fs';
import { chromium } from 'playwright';

// A disposable, paused fixture. Never captures the user's live browser state.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:5173');
  await page.waitForFunction(() => window.town?.growth && window.sceneMgr?.renderer);
  await page.evaluate(() => {
    town.governance.auto = false;
    town.generate(1337);
    clock.reset(); clock.speed = 0; clock.hour = 12;
    sceneMgr.fitTown(town.perimeter.acquiredBounds(), town.grid);
  });
  await page.waitForTimeout(800);
  // Let the first clock-boundary fit finish, then leave room for the outer
  // resource yards under the HUD. This is a presentation view of real state.
  await page.evaluate(() => {
    const target = sceneMgr.controls.target;
    sceneMgr.camera.position.sub(target).multiplyScalar(1.6).add(target);
    sceneMgr.controls.update();
  });
  await page.waitForTimeout(300);
  if (errors.length) throw Error(errors.join('\n'));
  fs.mkdirSync('docs/assets', { recursive: true });
  await page.screenshot({ path: 'docs/assets/town-preview.png' });
  console.log('Captured paused seed-1337 documentation preview.');
} finally { await browser.close(); }
