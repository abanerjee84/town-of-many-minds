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

  const transitParsed = window.parseIntent('BUILD A BUS DEPOT');
  const landParsed = window.parseIntent('ACQUIRE FRONTIER LAND');
  const restructureParsed = window.parseIntent('RESTRUCTURE THE BUILDING');
  const landPlan = window.planFor(t, 'land');
  const landQuote = landPlan ? t.growth.quote(landPlan) : null;

  // Commission a transit hub through the normal building painter in the test
  // town, then let the route system procure/spawn its first registered bus.
  const transitPlan = window.planFor(t, 'civic', { facility: 'transit' });
  const transitSite = transitPlan ? t.growth.findFootprintSite(transitPlan) : null;
  const transitBuilding = transitSite
    ? t.placeBuilding(transitSite.cell[0], transitSite.cell[1], 'civic', {
        footprint: transitPlan.footprint, facility: 'transit', blockId: transitPlan.blockId
      })
    : null;
  if (transitBuilding) {
    t.transport.rebuild();
    t.transport.ensureFleet();
  }

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
      land: landParsed.intent,
      restructure: restructureParsed.intent
    },
    landPlan: !!landPlan, landQuoteOk: !!landQuote?.ok,
    transitBuilt: !!transitBuilding, transit: transport,
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
if (result.parser.land !== 'ACQUIRE_LAND') failures.push('ACQUIRE_LAND parser');
if (result.parser.restructure !== 'RESTRUCTURE_BUILDING') failures.push('RESTRUCTURE_BUILDING parser');
if (!result.landPlan || !result.landQuoteOk) failures.push('land plan quote');
if (!result.transitBuilt || !result.transit.ready || result.transit.fleet < 1) failures.push('transit route/fleet');
if (!result.restructure) failures.push('restructure');
if (!result.society.neighbourhoods || !Number.isFinite(result.society.mood) || !Number.isFinite(result.society.approval) || result.society.elections < 1) failures.push('society stats/election');
if (!result.validation || errors.length) failures.push('town validation/page errors');
await browser.close();
if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('society/transport/perimeter regression passed');
