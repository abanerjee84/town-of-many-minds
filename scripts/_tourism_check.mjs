import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town, null, { timeout: 60000 });
const result = await page.evaluate(async () => {
  const { planFor } = await import('/src/simulation/growth.js');
  const { buildHouse } = await import('/src/kits/houses/houseKit.js');
  const { constructionBlock, constructionBlockQuote } = await import('/src/kits/constructionBlocks.js');
  const town = window.town;
  town.generate(1337);
  const fail = (message) => { throw new Error(message); };
  const hotelPlan = planFor(town, 'hotel', { need: 1 });
  const hotelSite = hotelPlan && town.growth.siteForFootprint(hotelPlan);
  if (!hotelSite) fail('hotel has no legal acquired site in the initial town');
  hotelPlan.footprint = hotelSite.footprint;
  const hotel = hotelPlan.run(hotelSite.cell);
  if (!hotel || hotel.kind !== 'hotel') fail('hotel plan did not place a hotel building');
  if (!hotel.tourism || hotel.tourism.rooms !== 24) fail('hotel room metadata was not recorded');
  if (!hotel.house.modules.some((m) => m.kind === 'room-balconies')) fail('hotel kit omitted room balconies');
  town.economy.rebuild();
  const business = town.economy.businesses.find((b) => b.building === hotel);
  if (!business || business.type !== 'lodging' || business.rooms !== 24) fail('hotel did not become a lodging business');
  town.economy.assignEmployees();
  if (business.staffNeed <= 0) fail('hotel staffing did not scale with its floor area');
  const evidence = town.economy.tourismStats();
  if (evidence.roomCapacity !== 24 || evidence.demand <= 0) fail('tourism evidence did not expose hotel demand');
  town.economy.lastDay = 2;
  town.economy.runTourism();
  if (town.economy.tourism.nights <= 0 || town.economy.tourism.revenue <= 0) fail('tourism night settlement produced no visitor revenue');
  if (!(town.economy.period.categories.tourism_tax > 0)) fail('tourism occupancy tax did not reach the municipal ledger');
  const report = town.governance.report();
  if (!report.includes('Tourism:')) fail('council report omitted tourism evidence');
  const resort = buildHouse({
    style: 'resort', kind: 'resort', w: 8.2, d: 6.4, floors: 3,
    wall: 0xc9b48b, trim: 0xf1e4c4, roofColor: 0x6f7c6e, doorColor: 0x6b4a2f,
    roofType: 'flat', tourism: { rooms: 48, nightlyRate: 48, appeal: 6, tier: 'resort' }
  });
  const resortModules = new Set(resort.modules.map((m) => m.kind));
  for (const module of ['pool', 'service-wing', 'lodging-lobby']) if (!resortModules.has(module)) fail(`resort kit omitted ${module}`);
  if (constructionBlock('commerce.hotel')?.footprint.join('x') !== '3x3') fail('hotel construction block missing');
  if (constructionBlock('commerce.resort')?.footprint.join('x') !== '5x4') fail('resort construction block missing');
  if (!(constructionBlockQuote('commerce.resort')?.cost > constructionBlockQuote('commerce.hotel')?.cost)) fail('resort quote should exceed hotel quote');
  return {
    hotel: { cell: hotel.cell, rooms: hotel.tourism.rooms, businessType: business.type, staffNeed: business.staffNeed },
    tourism: { roomCapacity: evidence.roomCapacity, demand: evidence.demand, nights: town.economy.tourism.nights, revenue: town.economy.tourism.revenue, occupancyTax: town.economy.period.categories.tourism_tax || 0 },
    resort: { modules: [...resortModules] }
  };
});
console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
