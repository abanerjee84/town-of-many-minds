import { chromium } from 'playwright';
import {
  RESOURCE_BUILDING_SETBACK,
  resourceSetbackConflict,
  resourceSiteBuildingConflict
} from '../src/placement/siteRules.js';

const URL = process.env.APP_URL || 'http://localhost:5173';
const fakeResources = { sites: [{ kind: 'windmill', cells: [[10, 10]] }] };
const fakeTown = { buildings: [{ kind: 'house', zone: 'residential', cell: [10, 10] }] };
if (!resourceSetbackConflict(fakeResources, [[10 + RESOURCE_BUILDING_SETBACK, 10]], { zone: 'residential' })) {
  throw new Error('resource setback did not reject a boundary tile');
}
if (resourceSetbackConflict(fakeResources, [[11 + RESOURCE_BUILDING_SETBACK, 10]], { zone: 'residential' })) {
  throw new Error('resource setback rejected a legal tile');
}
if (!resourceSiteBuildingConflict(fakeTown, [[10, 10]], 'windmill')) {
  throw new Error('resource planner did not reject a yard beside a home');
}
if (resourceSiteBuildingConflict({ buildings: [{ kind: 'factory', zone: 'industrial', cell: [10, 10] }] }, [[10, 10]], 'windmill')) {
  throw new Error('resource planner rejected a valid industrial supply adjacency');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.evaluate(() => window.town.generate(1337));

const result = await page.evaluate((buffer) => {
  const t = window.town;
  const protectedKinds = new Set(['reservoir', 'silo', 'windmill', 'solar', 'farm', 'husbandry', 'poultry', 'battery']);
  const sites = t.resources.sites.filter((s) => protectedKinds.has(s.kind));
  const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const conflicts = [];
  for (const building of t.buildings) {
    if (building.zone === 'industrial' || building.kind === 'factory') continue;
    const cells = building.footprint?.length ? building.footprint : [building.cell];
    for (const site of sites) for (const a of cells) for (const b of site.cells) {
      const d = distance(a, b);
      if (d <= buffer) conflicts.push({ building: building.kind, site: site.kind, d });
    }
  }
  const surveyed = t.growth.findFootprintSite({
    type: 'house',
    footprint: { cols: 1, rows: 1 },
    wantZone: 'residential',
    projection: true
  });
  const surveyedConflict = surveyed
    ? sites.some((site) => surveyed.cells.some((a) => site.cells.some((b) => distance(a, b) <= buffer)))
    : false;
  return {
    buildings: t.buildings.length,
    resources: sites.map((s) => ({ kind: s.kind, cells: s.cells.length })),
    conflicts,
    surveyed: surveyed?.cell || null,
    surveyedConflict
  };
}, RESOURCE_BUILDING_SETBACK);

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.resources.length) throw new Error(`seed 1337 has no protected resource site: ${JSON.stringify(result)}`);
if (result.conflicts.length) throw new Error(`founding buildings beside resource facility: ${JSON.stringify(result)}`);
if (result.surveyedConflict) throw new Error(`Council surveyed a building site inside a resource setback: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result));
await browser.close();
