import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5179', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.transport);
  const result = await page.evaluate(() => {
    const town = window.town;
    town.generate('transit-stop-1337');
    const protectedKeys = town.transport.stationApproachKeys();
    const cell = town.grid.roadCells().find(([x, y]) =>
      town.grid.roadDegree(x, y) === 2 && !protectedKeys.has(`${x},${y}`)
    );
    const placed = town.placeTransitStop(...cell);
    const saved = town.exportIntegrityState();
    if (!saved.ok) return { placed, save: saved, errors: ['save refused'] };
    town.generate('transit-stop-1337');
    const restored = town.importIntegrityState(saved);
    return {
      placed,
      restored,
      manual: [...town.transport.manualStops],
      marked: town.roadKit.cellInfo.get(`${cell[0]},${cell[1]}`)?.names?.includes('Bus Stop') || false,
      stats: town.transport.stats()
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  const detail = JSON.stringify({ placed: result.placed, restored: result.restored?.ok, manual: result.manual, marked: result.marked, stats: result.stats });
  assert.equal(result.placed.ok, true, detail);
  assert.equal(result.restored.ok, true, detail);
  assert.equal(result.manual.length, 1, detail);
  assert.equal(result.marked, true, detail);
  console.log(JSON.stringify({ placed: result.placed, restored: result.restored?.ok, manual: result.manual, marked: result.marked, stats: result.stats }));
} finally {
  await browser.close();
}
