import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(700);

const result = await page.evaluate(() => {
  const t = window.town;
  const perimeterBefore = t.perimeter.stats();
  const frontier = t.perimeter.frontierCells(3);
  const quote = t.perimeter.quote(frontier);
  const acquired = t.perimeter.acquire(frontier.slice(0, 2), { charge: false, reason: 'regression probe' });
  // The geometry probe below commissions two campus-shaped civic sites. Give
  // it a deterministic serviced frontier first, exactly as an ACQUIRE_LAND
  // decision would, so the test does not bypass the new land ledger.
  t.perimeter.acquire(t.perimeter.frontierCells(80), { charge: false, reason: 'regression serviced campus' });

  const transitParsed = window.parseIntent('BUILD A BUS DEPOT');
  const landParsed = window.parseIntent('ACQUIRE FRONTIER LAND');
  const restructureParsed = window.parseIntent('RESTRUCTURE THE BUILDING');
  const landPlan = window.planFor(t, 'land');
  const landQuote = landPlan ? t.growth.quote(landPlan) : null;
  const landGateClosed = t.growth.vacantAcquiredPlots(1) > 0 && !landPlan;

  // Commission a transit hub through the normal building painter in the test
  // town, then let the route system procure/spawn its first registered bus.
  const transitPlan = window.planFor(t, 'civic', { facility: 'transit' });
  const transitSite = transitPlan ? t.growth.findFootprintSite(transitPlan) : null;
  const transitBuilding = transitSite
    ? t.placeBuilding(transitSite.cell[0], transitSite.cell[1], 'civic', {
        footprint: transitPlan.footprint, footprintCells: transitSite.cells,
        facility: 'transit', blockId: transitPlan.blockId
      })
    : null;
  if (transitBuilding) {
    t.transport.rebuild();
    t.transport.ensureFleet();
  }

  // Service yards must scale horizontally or through a second facility once
  // their authored vertical cap is reached. A recycling centre is explicitly
  // low-rise, so neither upgrade nor restructure may select it at two floors.
  const recyclingPlan = window.planFor(t, 'civic', { facility: 'recycling' });
  const recyclingSite = recyclingPlan ? t.growth.findFootprintSite(recyclingPlan) : null;
  const recycling = recyclingSite
    ? t.placeBuilding(recyclingSite.cell[0], recyclingSite.cell[1], 'civic', {
        footprint: recyclingPlan.footprint, footprintCells: recyclingSite.cells,
        facility: 'recycling', blockId: recyclingPlan.blockId
      })
    : null;
  if (recycling) t.expandBuilding(recycling, { floors: 1 });
  const upgradeProbe = window.planFor(t, 'upgrade');
  const restructureProbe = window.planFor(t, 'restructure');

  const candidate = t.buildings.find((b) => b.house && b.floors < 20 && b.facility !== 'townhall');
  const beforeFloors = candidate?.floors || 0;
  const restructured = candidate ? t.restructureBuilding(candidate) : null;
  t.society.update(0, { day: 2, hour: 12 });
  t.society.update(0, { day: 31, hour: 12 });
  const society = t.society.stats();
  const transport = t.transport.stats();
  const perimeter = t.perimeter.stats();
  return {
    perimeterBefore, frontierCount: frontier.length, quotedTiles: quote.cells.length,
    acquired: acquired.ok && acquired.added === Math.min(2, frontier.length),
    perimeter,
    parser: {
      transit: transitParsed.intent,
      transitFacility: transitParsed.params?.facility,
      land: landParsed.intent,
      restructure: restructureParsed.intent
    },
    landPlan: !!landPlan, landQuoteOk: !!landQuote?.ok, landGateClosed,
    transitBuilt: !!transitBuilding, transit: transport,
    recyclingCap: !!recycling && recycling.floors === 2 && upgradeProbe?.target !== recycling && restructureProbe?.target !== recycling,
    restructure: !!restructured && restructured.floors > beforeFloors,
    society: {
      neighbourhoods: society.neighbourhoods.length,
      mood: society.mood,
      approval: society.approvalRate,
      crimes: society.crimes,
      laws: society.laws,
      elections: society.elections.length
    },
    validation: t.validation?.ok !== false
  };
});

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('PAGE_ERRORS', errors.slice(0, 5));
const failures = [];
if (!result.frontierCount || !result.quotedTiles) failures.push('frontier survey/quote');
if (!result.acquired) failures.push('land acquisition');
if (result.parser.transit !== 'BUILD_TRANSIT') failures.push('BUILD_TRANSIT parser');
if (result.parser.transitFacility !== 'busdepot') failures.push('BUILD_TRANSIT facility parser');
if (result.parser.land !== 'ACQUIRE_LAND') failures.push('ACQUIRE_LAND parser');
if (result.parser.restructure !== 'RESTRUCTURE_BUILDING') failures.push('RESTRUCTURE_BUILDING parser');
if (!result.landGateClosed) failures.push('land exhaustion gate');
if (!result.transitBuilt || !result.transit.ready || result.transit.fleet < 1) failures.push('transit route/fleet');
if (!result.recyclingCap) failures.push('civic vertical cap');
if (!result.restructure) failures.push('restructure');
if (!result.society.neighbourhoods || !Number.isFinite(result.society.mood) || !Number.isFinite(result.society.approval) || result.society.elections < 1) failures.push('society stats/election');
if (!result.validation || errors.length) failures.push('town validation/page errors');
await browser.close();
if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('society/transport/perimeter regression passed');
