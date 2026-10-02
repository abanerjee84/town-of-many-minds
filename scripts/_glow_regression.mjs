import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.roadKit);
  const result = await page.evaluate(async () => {
    const glow = await import('/src/kits/glow.js');
    const t = window.town;
    t.fullReset(42);
    t.governance.auto = false;
    window.clock.speed = 0;
    window.clock.hour = 22;
    window.sceneMgr.updateLighting(window.clock);
    glow.setGlowLevel(window.sceneMgr.nightFactor);
    const road = t.scene.getObjectByName('road-lamps');
    const windows = t.scene.getObjectByName('buildings-glow');
    return {
      night: window.sceneMgr.nightFactor,
      roadLamps: !!road,
      roadIntensity: road?.material?.emissiveIntensity || 0,
      windowIntensity: windows?.material?.emissiveIntensity || 0,
      glowCount: glow.glowCount()
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.night, 1);
  assert.equal(result.roadLamps, true, JSON.stringify(result));
  assert.ok(result.roadIntensity > 0, JSON.stringify(result));
  assert.ok(result.windowIntensity > 0, JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
