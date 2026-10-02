import { chromium } from 'playwright';

// Replicates seedFoundingFactories' search VERBATIM (same predicates, same
// order) with per-stage counters, against the live town right after regen.
// Factories already placed consume anchors, so run BEFORE the buildings step
// would be ideal — instead we regen and count what the search WOULD see if no
// factory had been placed: we exclude existing factories' cells from the
// buildingAt check.
const URL = process.env.APP_URL || 'http://localhost:5173';

const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const comps = window.roadComponents(g);
  const profile = window.urbanProfile(g);
  const factoryCells = new Set();
  for (const b of t.buildings) {
    if (b.purpose !== 'industrial' && b.kind !== 'factory') continue;
    const cells = b.footprint && b.footprint.length ? b.footprint : [b.cell];
    for (const [cx, cy] of cells) factoryCells.add(`${cx},${cy}`);
  }
  const isFactoryCell = (x, y) => factoryCells.has(`${x},${y}`);
  const stages = { kind: 0, noBld: 0, noRes: 0, edge: 0, parcel: 0, front: 0, net: 0, placeable: 0 };
  const edgeVals = [];
  g.forEach((x, y, grid) => {
    const k = grid.kindAt(x, y);
    if (k !== 0 && k !== 2) return;
    stages.kind++;
    if (t.buildingAt(x, y) && !isFactoryCell(x, y)) return;
    stages.noBld++;
    if (t.resources?.ownsCell(x, y)) return;
    stages.noRes++;
    // onIndustrialGround
    const edge = window.edgeScore(profile, x, y);
    if (edge < window.INDUSTRIAL_MIN_EDGE) return;
    stages.edge++;
    edgeVals.push(edge);
    const parcel = t.parcels?.at(x, y);
    if (!parcel || !parcel.buildable) return;
    stages.parcel++;
    const bc = t.parcels.buildableCell(parcel);
    if (!bc || bc[0] !== x || bc[1] !== y) return;
    stages.front++;
    if (!window.hasNetworkAccess(g, x, y, comps)) return;
    stages.net++;
    // placeBuilding 2x2 acquire:true outcome from this anchor
    let ok = true;
    for (let dy = 0; dy < 2 && ok; dy++) {
      for (let dx = 0; dx < 2 && ok; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!g.inBounds(cx, cy) || g.isRoad(cx, cy) || g.isPath(cx, cy) || g.isWater(cx, cy)) ok = false;
        else if (t.resources?.ownsCell(cx, cy)) ok = false;
        else if ((t.buildingAt(cx, cy) && !isFactoryCell(cx, cy))) {
          // acquire:true would clear this — allowed
        }
      }
    }
    if (ok) stages.placeable++;
  });
  edgeVals.sort((a, b) => a - b);
  return {
    profile: { cx: +profile.cx.toFixed(2), cy: +profile.cy.toFixed(2), r: +profile.r.toFixed(2) },
    stages,
    edgeMin: edgeVals.length ? +edgeVals[0].toFixed(3) : null,
    edgeMax: edgeVals.length ? +edgeVals[edgeVals.length - 1].toFixed(3) : null,
    works: t.buildings
      .filter((b) => b.purpose === 'industrial' || b.kind === 'factory')
      .map((b) => ({ name: b.name, at: b.cell, lot: (b.footprint || [b.cell]).length }))
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
for (const seed of ['42', '1337']) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1200);
  console.log(`\n===== SEED ${seed} =====`);
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
}
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
