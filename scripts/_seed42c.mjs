import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';

// Find anchors with the real search predicates, then call the REAL
// town.placeBuilding at the best one and report the outcome.
const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const comps = window.roadComponents(g);
  const profile = window.urbanProfile(g);
  const cands = [];
  g.forEach((x, y, grid) => {
    const k = grid.kindAt(x, y);
    if (k !== 0 && k !== 2) return;
    if (t.buildingAt(x, y)) return;
    if (t.resources?.ownsCell(x, y)) return;
    if (window.edgeScore(profile, x, y) < window.INDUSTRIAL_MIN_EDGE) return;
    const parcel = t.parcels?.at(x, y);
    if (!parcel || !parcel.buildable) return;
    const bc = t.parcels.buildableCell(parcel);
    if (!bc || bc[0] !== x || bc[1] !== y) return;
    if (!window.hasNetworkAccess(g, x, y, comps)) return;
    cands.push([x, y]);
  });
  if (!cands.length) return { cands: 0 };
  const [bx, by] = cands[0];
  const before = t.buildings.length;
  let rec = null;
  let err = null;
  try {
    rec = t.placeBuilding(bx, by, 'industrial', {
      factory: 'sawmill',
      footprint: { cols: 2, rows: 2 },
      acquire: true
    });
  } catch (e) {
    err = e.message;
  }
  return {
    cands: cands.length,
    tried: [bx, by],
    before,
    after: t.buildings.length,
    rec: rec ? { name: rec.name, kind: rec.kind, lot: (rec.footprint || [rec.cell]).length } : null,
    err
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
console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
console.log('PAGEERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
