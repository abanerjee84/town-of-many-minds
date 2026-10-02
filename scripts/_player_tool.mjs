import { chromium } from 'playwright';

// Calls the REAL Interaction.placeWorks at a downtown cell (must refuse) and
// a rim cell (must place a 2x2 works), verifying the player path enforces the
// same outskirts rule as the planner.
const URL = process.env.APP_URL || 'http://localhost:5173';

const PROBE = () => {
  const t = window.town;
  const ix = window.interaction;
  const g = t.grid;
  const p = window.urbanProfile(g);
  const edge = (x, y) => window.edgeScore(p, x, y);
  // downtown: lowest-edge free cell; rim: highest-edge free cell with a parcel
  let down = null, rim = null;
  let downEdge = Infinity, rimEdge = -Infinity;
  g.forEach((x, y, grid) => {
    const k = grid.kindAt(x, y);
    if (k !== 0 && k !== 2) return;
    if (t.buildingAt(x, y)) return;
    if (t.resources?.ownsCell(x, y)) return;
    const e = edge(x, y);
    if (e < downEdge) { downEdge = e; down = [x, y]; }
    const parcel = t.parcels?.at(x, y);
    if (!parcel || !parcel.buildable) return;
    const bc = t.parcels.buildableCell(parcel);
    if (!bc || bc[0] !== x || bc[1] !== y) return;
    if (e > rimEdge) { rimEdge = e; rim = [x, y]; }
  });
  const n0 = t.buildings.length;
  const rDown = ix.placeWorks(down[0], down[1], 'sawmill');
  const n1 = t.buildings.length;
  const rRim = ix.placeWorks(rim[0], rim[1], 'sawmill');
  const n2 = t.buildings.length;
  return {
    downtown: { at: down, edge: +downEdge.toFixed(3), placed: !!rDown, countDelta: n1 - n0 },
    rim: {
      at: rim,
      edge: +rimEdge.toFixed(3),
      placed: !!rRim,
      lot: rRim ? (rRim.footprint || [rRim.cell]).length : null,
      zone: rRim?.zone,
      countDelta: n2 - n1
    },
    hint: document.getElementById('tool-hint')?.textContent
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', '1337');
await page.click('#regen');
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
