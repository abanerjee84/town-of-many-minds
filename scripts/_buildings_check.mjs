import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// Two rules:
//
//  1. The founding town contains nothing taller than two storeys. A hamlet of
//     thirty people with a six-storey office in it is not a hamlet, and a
//     landmark on day one is handed over rather than earned.
//  2. Staffing scales with the SIZE of a building, not with its capacity.
//     Capacity means desks in an office, stock in a shop, beds in a house and
//     visitors in a clinic, so dividing it by one flat number produced nonsense
//     — a six-storey office with 64 desks was run by one person.
//
// Plus the constraint that keeps (1) honest: the cap is a FOUNDING ceiling, so
// growth must still be able to build tall afterwards.
const PROBE = () => {
  const t = window.town;
  const ec = t.economy;
  const out = { steps: [] };

  const floorsOf = (b) => b.floors || b.house?.spec?.floors || 1;
  const foundingFloors = t.buildings.map(floorsOf);

  // 1. nothing tall at founding
  out.steps.push({
    step: 'founding-height-capped',
    buildings: foundingFloors.length,
    maxFloors: Math.max(...foundingFloors),
    cap: 2,
    withinCap: Math.max(...foundingFloors) <= 2,
    histogram: foundingFloors.reduce((h, f) => { h[f] = (h[f] || 0) + 1; return h; }, {})
  });

  // 2. staff scales with SIZE. The claim is that the requirement is a function
  //    of floor area — so the right test is monotonicity, not a flat rule that
  //    every two-storey building clears. A genuinely tiny two-storey unit can
  //    quite reasonably be run by one person; what must not happen is a BIG
  //    building coming out as 1, or two buildings of the same size disagreeing
  //    because one of them sells a different thing.
  const commercial = t.buildings.filter((b) => b.kind !== 'house');
  const rows = commercial.map((b) => ({
    kind: b.kind,
    floors: floorsOf(b),
    area: Math.round(ec.floorAreaOf(b) * 10) / 10,
    capacity: b.capacity,
    staff: ec.staffNeeded(b)
  }));
  // Every building needs at least one person.
  const allAtLeastOne = rows.every((r) => r.staff >= 1);
  // Staff must never exceed the area model: nobody is invented.
  const consistent = rows.every((r) => r.staff === Math.max(1, Math.ceil(r.area / 15)));
  // Capacity must not be what drives it: a building's staffing has to be
  // explainable by its area alone. Compare the largest-capacity building with
  // the smallest and check the smaller one is not staffed higher.
  const byCap = rows.slice().sort((a, b) => a.capacity - b.capacity);
  const capacityNotTheDriver = byCap.length < 2 || byCap[byCap.length - 1].staff >= byCap[0].staff;
  out.steps.push({
    step: 'staff-scales-with-size',
    rows,
    allAtLeastOne,
    consistent,
    capacityNotTheDriver
  });

  // 3. monotonicity in BOTH dimensions, checked against the formula directly so
  //    it does not depend on which buildings this seed happened to produce
  const fake = (w, d, f) => ec.staffNeeded({ floors: f, house: { spec: { w, d, floors: f } } });
  const small = fake(3.2, 2.6, 1);
  const twoUp = fake(3.2, 2.6, 2);
  const tower = fake(3.7, 3.2, 8);
  const wideLow = fake(7.0, 5.0, 1);   // same storey count, much bigger
  out.steps.push({
    step: 'bigger-needs-more-staff',
    smallShop: small, twoStorey: twoUp, eightStoreyOffice: tower, wideSingleStorey: wideLow,
    // more storeys, same footprint -> more staff
    monotoneInHeight: twoUp > small && tower > twoUp,
    // bigger footprint, same storey count -> more staff
    monotoneInFootprint: wideLow > small,
    towerIsNotOne: tower > 1
  });

  // 4. the founding ceiling is a FOUNDING ceiling. Build through the RUNTIME
  //    path (town.placeBuilding, which is what growth and the council use) and
  //    confirm a tall building is still allowed.
  // `placeBuilding` requires road frontage, so the site has to be picked as one
  // rather than simply "any free cell" — otherwise this proves nothing about
  // the height cap and everything about my site finder.
  const site = (() => {
    for (let y = 1; y < t.grid.h - 1; y++) {
      for (let x = 1; x < t.grid.w - 1; x++) {
        if (t.buildingAt(x, y) || !t.grid.isFree(x, y)) continue;
        const frontage = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => t.grid.isRoad(x + dx, y + dy));
        if (frontage) return [x, y];
      }
    }
    return null;
  })();
  let tall = null;
  if (site) {
    tall = t.placeBuilding(site[0], site[1], 'commercial', { floors: 9, kind: 'office' });
  }
  const built = t.buildings.map(floorsOf);
  out.steps.push({
    step: 'growth-can-still-build-tall',
    foundSite: !!site,
    built: !!tall,
    floorsOfNew: tall ? floorsOf(tall) : null,
    maxFloorsNow: Math.max(...built),
    someBuildingTall: Math.max(...built) > 2
  });

  // 5. the labour market has not been wrecked by the staff change
  const adults = t.pedestrians.citizens.filter((c) => c.p.age >= 18 && c.p.age < 66);
  out.steps.push({
    step: 'labour-market-intact',
    adults: adults.length,
    staffNeeded: commercial.reduce((s, b) => s + ec.staffNeeded(b), 0),
    businesses: ec.businesses.length,
    openPosts: ec.businesses.reduce((s, b) => s + (b.vacancies || 0), 0),
    unemployment: Math.round(ec.unemployment * 1000) / 10
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
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (['step', 'rows', 'histogram', 'smallShop', 'twoStorey', 'eightStoreyOffice', 'wideSingleStorey', 'cap', 'maxFloors', 'maxFloorsNow', 'floorsOfNew', 'foundSite', 'adults', 'staffNeeded', 'businesses', 'openPosts', 'unemployment', 'buildings', 'area', 'capacity', 'staff', 'kind', 'floors'].includes(k)) continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (problems.length) fail++;
  const h = r.steps.find((x) => x.step === 'founding-height-capped');
  const st = r.steps.find((x) => x.step === 'staff-scales-with-size');
  const lm = r.steps.find((x) => x.step === 'labour-market-intact');
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        founding max ${h.maxFloors} floors (${JSON.stringify(h.histogram)})  ·  staff ${JSON.stringify(st.rows.map((x) => `${x.kind[0]}${x.floors}f/a${x.area}->${x.staff}`))}`);
  console.log(`        adults ${lm.adults}  staff needed ${lm.staffNeeded}  open posts ${lm.openPosts}  unemployment ${lm.unemployment}%`);
  if (problems.length) console.log('   ', JSON.stringify(r, null, 1).slice(0, 2000));
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
