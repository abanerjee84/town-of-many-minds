import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Five game hours of highlight, expressed in the simulation seconds that
// streetGlow.update(dt) counts in (see SIM.secondsPerGameMinute).
const HOLD = 5 * 60 * 0.9;
const FADE = 0.5 * 60 * 0.9;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.streetGlow && !!window.planFor);

  const result = await page.evaluate(({ HOLD, FADE }) => {
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
    t.fullReset(42);
    t.economy.treasury = 1000000;
    seedRoadEvidence();
    const idle = t.streetGlow.entries.size;
    const before = t.grid.roadCells().length;
    const decision = t.governance.enact('INTENT: EXTEND_STREET', 'probe');
    const paved = t.grid.roadCells().length - before;
    const lit = [...t.streetGlow.entries.keys()];
    const cells = lit.map((k) => k.split(',').map(Number));
    const allRoad = cells.every(([x, y]) => t.grid.isRoad(x, y));
    const opacity = lit.length
      ? t.streetGlow.entries.get(lit[0]).coreMat.opacity
      : 0;
    const group = t.streetGlow.group;

    // Five game hours in, every tile is still lit...
    t.streetGlow.update(HOLD);
    const afterHold = t.streetGlow.entries.size;
    // ...and the run-off fade clears it soon after.
    t.streetGlow.update(FADE + 1);
    const afterFade = t.streetGlow.entries.size;

    // The player's Road tool paves the same way, so it glows the same way.
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let spot = null;
    for (const [x, y] of t.grid.roadCells()) {
      const free = DIRS.find(([dx, dy]) =>
        t.grid.inBounds(x + dx, y + dy) && t.grid.kindAt(x + dx, y + dy) === 0);
      if (free) { spot = [x + free[0], y + free[1]]; break; }
    }
    t.streetGlow.clear();
    const playerMarked = spot && t.paintRoad(spot[0], spot[1])
      ? t.streetGlow.entries.size
      : -1;

    t.streetGlow.clear();
    return {
      status: decision.status, idle, paved, lit: lit.length, allRoad,
      opacity: Math.round(opacity * 100) / 100,
      inScene: t.scene.getObjectByName('street-glow') === group,
      afterHold, afterFade, playerMarked
    };
  }, { HOLD, FADE });

  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(result.idle, 0, 'no highlight before any street is extended');
  assert.ok(result.paved > 0, 'EXTEND_STREET must pave tiles');
  assert.equal(result.lit, result.paved, 'every paved tile must be lit');
  assert.equal(result.allRoad, true);
  assert.ok(result.opacity > 0 && result.opacity <= 1, 'lit tiles must be visible');
  assert.equal(result.inScene, true, 'glow group must be in the scene');
  assert.equal(result.afterHold, result.lit, 'still lit after exactly five game hours');
  assert.equal(result.afterFade, 0, 'highlight retires after the run-off fade');
  assert.ok(result.playerMarked === -1 || result.playerMarked > 0,
    'a player-paved street lights up too');

  await page.evaluate(() => {
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
    t.fullReset(42);
    t.economy.treasury = 1000000;
    seedRoadEvidence();
    t.governance.enact('INTENT: EXTEND_STREET', 'probe');
    const keys = [...t.streetGlow.entries.keys()].map((k) => k.split(',').map(Number));
    const cx = keys.reduce((s, [x]) => s + x, 0) / keys.length;
    const cy = keys.reduce((s, [, y]) => s + y, 0) / keys.length;
    const p = t.grid.cellToWorld(cx, cy);
    const s = window.sceneMgr;
    s.controls.target.set(p.x, 0, p.z);
    s.camera.position.set(p.x, 34, p.z + 14);
    s.camera.up.set(0, 1, 0);
    s.camera.lookAt(p.x, 0, p.z);
    s.controls.update();
  });
  // Opt-in: SHOT=path also captures the lit run for a human to eyeball.
  if (process.env.SHOT) {
    await page.evaluate(() => {
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
      t.fullReset(42);
      t.economy.treasury = 1000000;
      seedRoadEvidence();
      t.governance.enact('INTENT: EXTEND_STREET', 'probe');
      const keys = [...t.streetGlow.entries.keys()].map((k) => k.split(',').map(Number));
      const cx = keys.reduce((s, [x]) => s + x, 0) / keys.length;
      const cy = keys.reduce((s, [, y]) => s + y, 0) / keys.length;
      const p = t.grid.cellToWorld(cx, cy);
      const s = window.sceneMgr;
      s.controls.target.set(p.x, 0, p.z);
      s.camera.position.set(p.x, 34, p.z + 14);
      s.camera.up.set(0, 1, 0);
      s.camera.lookAt(p.x, 0, p.z);
      s.controls.update();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: process.env.SHOT });
  }

  // The frame loop, not a hand-cranked update(), has to retire the highlight:
  // five game hours at the default 50x is about six wall-clock seconds.
  const natural = await page.evaluate(() => {
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
    t.fullReset(42);
    t.economy.treasury = 1000000;
    seedRoadEvidence();
    t.growth.auto = false;
    window.clock.speed = 50;
    const d = t.governance.enact('INTENT: EXTEND_STREET', 'probe');
    return { status: d.status, lit: t.streetGlow.entries.size };
  });
  const probe = () => page.evaluate(() => ({
    size: window.town.streetGlow.entries.size,
    rem: [...window.town.streetGlow.entries.values()].map((e) => Math.round(e.remaining)),
    hour: Math.round(window.clock.hour * 100) / 100,
    speed: window.clock.speed,
    pending: !!window.town.governance?.pending
  }));
  let expired;
  try {
    await page.waitForFunction(() => window.town.streetGlow.entries.size === 0, null, { timeout: 40000 });
    expired = await probe();
  } catch {
    expired = await probe();
  }

  assert.equal(natural.status, 'done', JSON.stringify(natural));
  assert.ok(natural.lit > 0, 'EXTEND_STREET must light its tiles');
  assert.equal(expired.size, 0,
    `the live clock must retire the glow after five game hours ${JSON.stringify(expired)}`);
  assert.equal(errors.length, 0, errors.join('\n'));
  result.natural = natural.lit;
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
