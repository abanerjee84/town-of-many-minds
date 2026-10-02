import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.traffic && !!window.planFor);
  const results = await page.evaluate(() => {
    const t = window.town;
    const clock = window.clock;
    const measure = (withExtension) => {
      t.fullReset(42);
      clock.reset();
      t.growth.auto = false;
      t.growth.developer = false;
      t.economy.treasury = 1000000;
      const g = t.grid;
      for (const [x, y] of g.roadCells()) {
        let seeded = false;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const ax = x + dx;
          const ay = y + dy;
          const bx = x + dx * 2;
          const by = y + dy * 2;
          if (!g.inBounds(bx, by) || g.kindAt(ax, ay) !== 0 || !g.isRoad(bx, by)) continue;
          for (let i = 0; i < 8; i++) t.traffic.recordRoadTrip([x, y], [bx, by]);
          seeded = true;
          break;
        }
        if (seeded) break;
      }
      const advance = (steps) => {
        for (let i = 0; i < steps; i++) {
          clock.update(0.05);
          t.advance(0.05, clock);
        }
      };
      const quote = t.growth.quote(window.planFor(t, 'road'));
      const selected = quote.ok ? {
        cells: quote.plan.cells.map((c) => c.slice()),
        reason: quote.plan.roadReason,
        cost: quote.quote.finalCost
      } : null;
      const built = withExtension && quote.ok ? t.growth.apply(quote.plan) : null;
      const tripStart = t.traffic.tripCompletions;
      advance(800);
      const mobility = t.traffic.mobilityStats();
      let junctions = 0;
      for (const [x, y] of t.grid.roadCells()) if (t.grid.roadDegree(x, y) >= 3) junctions++;
      return {
        selected, built: built?.status || null,
        trips: mobility.vehicleTripsCompleted - tripStart,
        congestion: mobility.congestion,
        delaySec: mobility.delaySec,
        avgWaitSec: mobility.avgWaitSec,
        roadTiles: t.grid.roadCells().length,
        junctions
      };
    };
    return { baseline: measure(false), extension: measure(true) };
  });
  assert.deepEqual(results.extension.selected, results.baseline.selected);
  assert.equal(results.extension.built, 'instant');
  assert.equal(results.extension.roadTiles - results.baseline.roadTiles,
    results.extension.selected.cells.length);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
