import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.growth && !!window.planFor);
  const result = await page.evaluate(() => {
    const t = window.town;
    const seedRoadEvidence = () => {
      const g = t.grid;
      for (const [x, y] of g.roadCells()) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const ax = x + dx;
          const ay = y + dy;
          const bx = x + dx * 2;
          const by = y + dy * 2;
          if (!g.inBounds(bx, by) || g.kindAt(ax, ay) !== 0 || !g.isRoad(bx, by)) continue;
          for (let i = 0; i < 8; i++) t.traffic.recordRoadTrip([x, y], [bx, by]);
          return true;
        }
      }
      return false;
    };
    t.generate(42);
    t.economy.treasury = 1000000;
    seedRoadEvidence();
    const before = t.grid.roadCells().length;
    const quoted = t.growth.quote(window.planFor(t, 'road'));
    if (!quoted.ok) return { quoted };
    const cells = quoted.plan.cells.map((c) => c.slice());
    const cost = quoted.quote.finalCost;
    const built = t.growth.apply(quoted.plan);
    const direct = {
      cells, cost, built: built?.status || null,
      reason: t.growth.lastBlock,
      added: t.grid.roadCells().length - before,
      allRoad: cells.every(([x, y]) => t.grid.isRoad(x, y)),
      charged: quoted.plan.cost
    };
    t.fullReset(42);
    t.economy.treasury = 1000000;
    seedRoadEvidence();
    const councilBefore = t.grid.roadCells().length;
    const decision = t.governance.enact('INTENT: EXTEND_STREET', 'probe');
    return {
      ...direct,
      council: {
        status: decision.status, quotedCost: decision.quotedCost,
        actualSpend: decision.actualSpend, detail: decision.detail,
        added: t.grid.roadCells().length - councilBefore
      }
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.built, 'instant', JSON.stringify(result));
  assert.equal(result.added, result.cells.length, 'quote must count every paved tile');
  assert.equal(result.allRoad, true);
  assert.equal(result.cost, result.charged);
  assert.equal(result.council.status, 'done');
  assert.equal(result.council.quotedCost, result.council.actualSpend);
  assert.equal(result.council.added * 2000, result.council.actualSpend);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
