import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99', '1', '2', '3', '500', '77', '1234', '8888', '555', '12', '31415'];

// The founding town's required services. A settlement has to be able to defend
// itself, put out a fire, school its children, and run itself, and it needs
// somewhere to buy things — a town with none of these is not a town.
const REQUIRED = ['fire', 'police', 'school', 'townhall'];
const MIN_SHOPS = 2;

// Wind farm. The founding plan used to space every resource site SITE_GAP = 6
// cells apart, which is right for a resource belt and wrong for turbines: a
// wind farm is a GROUP. This asserts the turbines sit together rather than
// being scattered across the outskirts.
const PROBE = () => {
  // Declared inside the probe because it is serialised into the page, where
  // module scope does not exist.
  const REQUIRED = ['fire', 'police', 'school', 'townhall'];
  const t = window.town;
  const civic = t.buildings.filter((b) => b.kind === 'civic').map((b) => b.facility);
  const mills = t.resources.sites.filter((s) => s.kind === 'windmill');
  const centre = (s) => {
    const xs = s.cells.map((c) => c[0]);
    const ys = s.cells.map((c) => c[1]);
    return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)];
  };
  const c = mills.map(centre);
  // Yard is 2x2, so centre-to-centre distance minus 2 is the clear gap.
  const gaps = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const d = Math.max(Math.abs(c[i][0] - c[j][0]), Math.abs(c[i][1] - c[j][1]));
      gaps.push(d - 2);
    }
  }
  const gas = t.resources.sites.find((s) => s.kind === 'gas');
  // Assert the pump is CONNECTED and STAFFED, not on `production.fuel`.
  // `production` is recomputed on a non-deterministic schedule, so it reads 0
  // or 110 across identical regenerations of the same seed — measured, on
  // identical runs, with the pump connected and manned every time. Testing the
  // readout tests a coin flip; the crew is the thing that actually decides
  // whether the town can fuel a vehicle.
  const staff = t.resources.activeSiteWorkers();
  return {
    civic,
    missing: REQUIRED.filter((f) => !civic.includes(f)),
    shops: t.buildings.filter((b) => b.kind === 'shop').length,
    mills: mills.length,
    gaps,
    maxGap: gaps.length ? Math.max(...gaps) : null,
    tightest: gaps.length ? Math.min(...gaps) : null,
    hasPump: !!gas,
    pumpConnected: gas ? gas.connected === true : false,
    pumpCrew: gas ? staff.get(gas) || 0 : 0,
    pumpCrewNeeded: gas ? t.resources.siteCrew(gas) : 0,
    pop: t.pedestrians.citizens.length,
    valid: t.validation?.ok
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

let fail = 0;
const gapMax = [];
const gapMin = [];
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(PROBE);
  const problems = [];
  if (r.missing.length) problems.push(`missing ${r.missing.join(',')}`);
  if (r.shops < MIN_SHOPS) problems.push(`only ${r.shops} shops`);
  if (!r.hasPump) problems.push('no fuel pump');
  if (!r.pumpConnected) problems.push('pump not road-connected');
  if (r.pumpCrew < r.pumpCrewNeeded) problems.push(`pump crew ${r.pumpCrew}/${r.pumpCrewNeeded}`);
  // turbines must be neighbours, not scattered: a yard-gap of 6+ is the old
  // SITE_GAP spread and does not read as a farm
  if (r.maxGap != null && r.maxGap > 3) problems.push(`turbines ${r.maxGap} cells apart`);
  if (r.pop < 25) problems.push(`pop ${r.pop}`);
  if (!r.valid) problems.push('invalid');
  if (problems.length) fail++;
  gapMax.push(r.maxGap ?? 0);
  gapMin.push(r.tightest ?? 0);
  console.log(`seed ${seed.padEnd(6)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        civic[${r.civic.join(',')}]  shops ${r.shops}  mills ${r.mills}  yard gaps ${JSON.stringify(r.gaps)}  pump crew ${r.pumpCrew}/${r.pumpCrewNeeded} connected ${r.pumpConnected}  pop ${r.pop}`);
}
console.log(`\nturbine yard gaps across seeds: min ${Math.min(...gapMin)}, max ${Math.max(...gapMax)} cells (old behaviour was 6+ apart)`);
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
