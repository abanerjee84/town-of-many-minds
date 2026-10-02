import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';

const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const profile = window.urbanProfile(g);
  const ff = window.edgeScore;
  let eligible = 0;
  let withParcel = 0;
  let frontOk = 0;
  let netOk = 0;
  let fit22 = 0;
  const blockedBy = {};
  t.grid.forEach((x, y, grid) => {
    const k = grid.kindAt(x, y);
    if (k !== 0 && k !== 2) return; // EMPTY or LOT
    if (t.buildingAt(x, y)) return;
    if (t.resources?.ownsCell(x, y)) return;
    const edge = ff(profile, x, y);
    if (edge < window.INDUSTRIAL_MIN_EDGE) return;
    eligible++;
    const parcel = t.parcels?.at(x, y);
    if (!parcel || !parcel.buildable) { blockedBy.noParcel = (blockedBy.noParcel || 0) + 1; return; }
    withParcel++;
    const bc = t.parcels.buildableCell(parcel);
    if (!bc || bc[0] !== x || bc[1] !== y) { blockedBy.notFront = (blockedBy.notFront || 0) + 1; return; }
    frontOk++;
    // network access (same import path as planner)
    let access = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (grid.isRoad(nx, ny)) { access = true; break; }
    }
    if (!access) { blockedBy.noNet = (blockedBy.noNet || 0) + 1; return; }
    netOk++;
    // 2x2 block fit from this anchor
    let fit = true;
    for (let dy = 0; dy < 2 && fit; dy++) {
      for (let dx = 0; dx < 2 && fit; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!grid.inBounds(cx, cy)) { fit = false; break; }
        const kk = grid.kindAt(cx, cy);
        if (kk === 1 || kk === 4) { fit = false; break; } // road/water
        if (t.buildingAt(cx, cy)) { fit = false; break; }
        if (t.resources?.ownsCell(cx, cy)) { fit = false; break; }
      }
    }
    if (fit) fit22++;
    else blockedBy.noFit = (blockedBy.noFit || 0) + 1;
  });
  return {
    profile: { cx: +profile.cx.toFixed(2), cy: +profile.cy.toFixed(2), r: +profile.r.toFixed(2) },
    eligible, withParcel, frontOk, netOk, fit22, blockedBy,
    buildings: t.buildings.length,
    kinds: t.buildings.map((b) => b.kind).join(',')
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', '42');
await page.click('#regen');
await page.waitForTimeout(1200);
// NOTE: probe runs against the LIVE town; factories already placed consume
// anchors, so this measures *remaining* capacity, not seed-time capacity.
console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
