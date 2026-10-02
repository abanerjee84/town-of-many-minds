import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '9001'];

const PROBE = async () => {
  const t = window.town;
  const houseKit = await import('/src/kits/houses/houseKit.js');
  const civicKit = await import('/src/kits/civic/civicKit.js');
  const growth = await import('/src/simulation/growth.js');
  const governance = await import('/src/simulation/governance.js');
  const house = houseKit.buildHouse({
    style: 'townhouse', w: 3.2, d: 3.0, floors: 2, roofType: 'flat',
    wall: 0xd8d0c4, trim: 0xf0ece2, roofColor: 0x59636d, doorColor: 0x33465c,
    accessible: true, balcony: true, solar: true, greenRoof: true
  });
  const capacityProbeStyle = {
    style: 'townhouse', wall: 0xd8d0c4, trim: 0xf0ece2,
    roofColor: 0x59636d, doorColor: 0x33465c, roofType: 'flat'
  };
  const threeStoreyTile = houseKit.buildHouse({ ...capacityProbeStyle, w: 3.2, d: 3.0, floors: 3 });
  const twoByTwoHouse = houseKit.buildHouse({ ...capacityProbeStyle, w: 7.4, d: 7.4, floors: 1, footprintTiles: 4 });
  const roles = new Set(house.parts.map((part) => part.role));
  const publicPlan = t.publicPlan || {};
  const blockAudit = window.auditConstructionBlocks();
  return {
    blockAudit,
    blockStats: window.constructionBlockStats(),
    public: {
      paths: publicPlan.paths?.length || 0,
      sports: publicPlan.sports?.length || 0,
      gardens: publicPlan.gardens?.length || 0,
      playgrounds: publicPlan.playgrounds?.length || 0,
      cells: publicPlan.cellUse?.size || 0
    },
    houseBlocks: {
      roles: ['balcony', 'ramp', 'solar', 'greenRoof'].filter((role) => roles.has(role)),
      modules: house.modules.map((module) => module.kind),
      twoFloorTileCapacity: house.capacity,
      threeFloorTileCapacity: threeStoreyTile.capacity,
      twoByTwoTileCapacity: twoByTwoHouse.capacity
    },
    civic: {
      catalogue: Object.keys(civicKit.CIVIC_CATALOGUE),
      order: civicKit.CIVIC_ORDER,
      missingOrderRows: civicKit.CIVIC_ORDER.filter((id) => !civicKit.CIVIC_CATALOGUE[id]),
      missingBlockRows: Object.keys(civicKit.CIVIC_CATALOGUE).filter((id) => !window.listConstructionBlocks({ facility: id }).length)
    },
    horizontalCivic: ['school', 'hospital', 'college', 'university'].map((facility) => {
      const plan = growth.planFor(t, 'civic', { facility });
      const fp = plan?.footprint || plan?.footprintCandidates?.[0] || [1, 1];
      const cols = Array.isArray(fp) ? fp[0] : fp.cols;
      const rows = Array.isArray(fp) ? fp[1] : fp.rows;
      return { facility, cols, rows, area: cols * rows, blockId: plan?.blockId || null };
    }),
    housePlanType: growth.planFor(t, 'house')?.type || null,
    creativeArchetype: governance.parseIntent(
      'INTENT: IMAGINE_ARCHETYPE facility=college name=River Labs accessible=true solar=true'
    ),
    errors: []
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.publicPlan && !!window.auditConstructionBlocks, null, { timeout: 60000 });
await page.waitForTimeout(800);
// This is a catalogue/geometry probe.  Keep the provider boundary quiet so a
// locally configured council endpoint cannot turn a successful kit audit into
// a page-level 400 just because the test does not need a sitting.
await page.evaluate(() => { if (window.town?.governance) window.town.governance.auto = false; });

let failures = 0;
let gardenSeen = false;
let playgroundSeen = false;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(800);
  const result = await page.evaluate(PROBE);
  const problems = [];
  if (!result.blockAudit.ok) problems.push(...result.blockAudit.errors);
  if (result.blockStats.total < 30) problems.push('construction block catalogue is too small');
  if (result.houseBlocks.roles.length !== 4) problems.push('house kit did not emit every new block');
  if (result.houseBlocks.twoFloorTileCapacity !== 6) problems.push('two-floor one-tile house is not 6 residents');
  if (result.houseBlocks.threeFloorTileCapacity !== 9) problems.push('three-floor one-tile house is not 9 residents');
  if (result.houseBlocks.twoByTwoTileCapacity !== 12) problems.push('two-by-two one-floor house is not 12 residents');
  if (result.civic.missingOrderRows.length) problems.push(...result.civic.missingOrderRows.map((id) => `missing civic row ${id}`));
  if (result.civic.missingBlockRows.length) problems.push(...result.civic.missingBlockRows.map((id) => `missing construction block ${id}`));
  for (const row of result.horizontalCivic) {
    if (row.area <= 1) problems.push(`${row.facility} still plans as a single-cell civic building`);
    if (!row.blockId) problems.push(`${row.facility} plan lost its construction block ID`);
  }
  if (result.housePlanType !== 'house') problems.push('house plan fell through to another plan type');
  if (result.creativeArchetype.params?.zone !== 'civic' || result.creativeArchetype.params?.blockId !== 'civic.college') {
    problems.push('facility-only creative archetype did not infer its civic block');
  }
  gardenSeen ||= result.public.gardens > 0;
  playgroundSeen ||= result.public.playgrounds > 0;
  if (problems.length) failures++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '} blocks=${result.blockStats.total} public=${JSON.stringify(result.public)} house=${result.houseBlocks.roles.join(',')}`);
  if (problems.length) console.log(JSON.stringify({ problems, result }, null, 2));
}

if (!gardenSeen || !playgroundSeen) {
  failures++;
  console.log('public-space variants missing across the seeded sample', { gardenSeen, playgroundSeen });
}

console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
console.log(failures ? `${failures}/${SEEDS.length} FAILED` : `ALL ${SEEDS.length} OK`);
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
