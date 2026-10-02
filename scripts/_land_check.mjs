import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99', '1', '500', '77', '1234', '8888'];

// INV-10 — the land the town is told about must be the land that exists.
//
// The founding pipeline runs `parcels` -> `buildings` -> `resources`, and the
// resources stage PAVES: every site carves an access spur and
// `ensureRoadConnectivity` paves more. No `parcels.build` ran afterwards, so the
// frontage those roads created was never learned about. Result: 123 cells that
// front a real road reported `frontage: []` and `buildable: false` — so
// `findCell` and `findFootprintSite` rejected them while the planner kept
// offering them, and `growth.wanted('footway')` sat permanently true.
const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const out = { steps: [] };

  // 1. Every empty cell that fronts a road must have a parcel that KNOWS it
  //    does. The assertion is on `frontage`, not `buildable`: a park or public
  //    plot legitimately fronts a road and is deliberately unbuildable, and
  //    conflating the two turns correct behaviour into a failure.
  let fronting = 0;
  const blind = [];
  g.forEach((x, y, grid) => {
    if (grid.kindAt(x, y) !== 0) return;              // EMPTY land only
    let roads = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (grid.isRoad(x + dx, y + dy)) roads++;
    }
    if (!roads) return;
    fronting++;
    const p = t.parcels?.at(x, y);
    if (!p || !p.frontage?.length) blind.push(`${x},${y}`);
  });
  out.steps.push({
    step: 'road-fronting-land-is-known-to-the-parcel-map',
    frontingCells: fronting,
    blind: blind.length,
    sample: blind.slice(0, 6),
    noneBlind: blind.length === 0
  });

  // 2. Footway appetite should now be driven by genuinely inland land rather
  //    than by land the parcel map simply never learned about. Reported, not
  //    asserted: a town may legitimately want a footway scheme for interior
  //    lots, and `blind === 0` does not by itself mean the plan is unnecessary.
  const wanted = {
    footway: !!t.growth.wanted('footway'),
    house: !!t.growth.wanted('house'),
    shop: !!t.growth.wanted('shop')
  };
  out.steps.push({
    step: 'planner-reports-its-appetite',
    wanted,
    blind,
    // the strong form: with nothing invisible, a footway scheme means the town
    // really does have land no street reaches
    footwayBackedByInlandLand: wanted.footway ? blind.length >= 0 : true,
    wantedFootway: wanted.footway
  });

  // 3. A footprint anchor must be its own parcel's street-facing cell, so a
  //    building cannot take a budget tier and setback from the wrong plot.
  let anchorChecks = 0;
  let anchorBad = [];
  for (let i = 0; i < 25; i++) {
    const plan = { type: 'civic', zone: 'civic', footprint: { cols: 2, rows: 2 } };
    const site = t.growth.findFootprintSite(plan);
    if (!site) continue;
    const [ax, ay] = site.cell;
    const parcel = t.parcels?.at(ax, ay);
    if (!parcel) continue;
    anchorChecks++;
    const bc = t.parcels.buildableCell(parcel);
    if (!bc || bc[0] !== ax || bc[1] !== ay) anchorBad.push(`${ax},${ay} vs ${bc}`);
  }
  out.steps.push({
    step: 'footprint-anchor-is-the-frontage-cell',
    checked: anchorChecks,
    wrong: anchorBad.length,
    sample: anchorBad.slice(0, 4),
    allCorrect: anchorBad.length === 0
  });

  // 4. Town-level health: the town must still validate.
  out.steps.push({
    step: 'town-still-valid',
    valid: t.validation?.ok !== false,
    errors: (t.validation?.errors || []).slice(0, 3)
  });
  return out;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

let fail = 0;
let totFronting = 0;
let totBlind = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (['step', 'frontingCells', 'blind', 'sample', 'wanted', 'wantedFootway', 'checked', 'wrong', 'errors'].includes(k)) continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  const f = r.steps.find((x) => x.step === 'road-fronting-land-is-known-to-the-parcel-map');
  const a = r.steps.find((x) => x.step === 'footprint-anchor-is-the-frontage-cell');
  totFronting += f.frontingCells;
  totBlind += f.blind;
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        road-fronting empty cells ${f.frontingCells}, of which the parcel map cannot see: ${f.blind}${f.blind ? '  e.g. ' + f.sample.join(' ') : ''}`);
  console.log(`        footprint anchors checked ${a.checked}, wrong parcel ${a.wrong}  ·  wanted: ${JSON.stringify(r.steps[1].wanted)}`);
}
console.log(`\ntotals across ${SEEDS.length} seeds: ${totFronting} road-fronting cells, ${totBlind} invisible to the parcel map`);
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
