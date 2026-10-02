import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const counts = { empty: 0, road: 0, lot: 0, park: 0, water: 0, plaza: 0, path: 0 };
  g.forEach((x, y, grid) => {
    const k = grid.kindAt(x, y);
    const name = ['empty', 'road', 'lot', 'park', 'water', 'plaza', 'path'][k];
    if (name) counts[name]++;
  });
  const core = t.core;
  const coreCells = (core.x1 - core.x0 + 1) * (core.y1 - core.y0 + 1);
  const lake = t.resources.sites.find((s) => s.kind === 'lake');
  return {
    grid: { w: g.w, h: g.h, cells: g.w * g.h },
    core: { ...core, w: core.x1 - core.x0 + 1, h: core.y1 - core.y0 + 1, cells: coreCells },
    corePctOfMap: +((coreCells / (g.w * g.h)) * 100).toFixed(1),
    counts,
    buildings: t.buildings.length,
    population: t.pedestrians.citizens.length,
    vehicles: t.traffic.vehicles.length,
    hasLake: !!lake,
    lakeCells: lake ? lake.cells.length : 0,
    resourceKinds: t.resources.sites.map((s) => s.kind).sort(),
    validation: {
      ok: t.validation?.ok,
      errors: (t.validation?.errors || []).slice(0, 4),
      warnings: (t.validation?.warnings || []).slice(0, 4)
    },
    // Can the town still grow outward? Count cells the expansion rule allows.
    expandCandidates: g.forEach ? undefined : 0,
    roadCount: g.roadCells().length
  };
};

// Can growth actually pave beyond the founding core, repeatedly?
const GROW = () => {
  const t = window.town;
  const g = t.grid;
  const before = g.roadCells().length;
  const reach = () => {
    let maxD = 0;
    for (const [x, y] of g.roadCells()) {
      maxD = Math.max(maxD, Math.abs(x - g.w / 2) + Math.abs(y - g.h / 2));
    }
    return Math.round(maxD);
  };
  const startReach = reach();
  // Drive the expansion planner directly: try to pave, repeatedly.
  const paved = [];
  for (let i = 0; i < 40; i++) {
    const cells = t.growth.expandFor(null);
    if (!cells) break;
    paved.push(cells.anchor);
  }
  return {
    roadsBefore: before,
    roadsAfter: g.roadCells().length,
    expansions: paved.length,
    reachBefore: startReach,
    reachAfter: reach(),
    // Furthest paved cell from the map centre, in cells
    maxExtent: reach()
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(900);
  const r = await page.evaluate(PROBE);
  const grow = await page.evaluate(GROW);
  const ok =
    r.grid.w === 100 && r.grid.h === 100 && r.grid.cells === 10000 &&
    r.hasLake && r.lakeCells >= 4 &&
    r.buildings > 0 && r.population > 0 &&
    r.core.w >= 22 && r.core.w <= 24 && r.core.h >= 19 && r.core.h <= 21 &&
    r.validation.ok && grow.expansions > 0;
  if (!ok) fail++;
  console.log(
    `seed ${seed.padEnd(5)} ${ok ? 'OK  ' : 'FAIL'} ` +
    `map ${r.grid.w}x${r.grid.h}  core ${r.core.w}x${r.core.h} (${r.corePctOfMap}% of map)  ` +
    `free ${r.counts.empty}  road ${r.roadCount}  bldg ${r.buildings}  pop ${r.population}  veh ${r.vehicles}  ` +
    `lake ${r.lakeCells}  res[${r.resourceKinds.join(',')}]  ` +
    `expand +${grow.expansions} roads reach ${grow.reachBefore}->${grow.reachAfter}  ` +
    `valid ${r.validation.ok}`
  );
  if (!r.validation.ok && r.validation.errors.length) console.log('        errors:', r.validation.errors);
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} SEEDS FAILED` : `\nALL ${SEEDS.length} SEEDS OK`);
await browser.close();
process.exit(fail ? 1 : 0);
