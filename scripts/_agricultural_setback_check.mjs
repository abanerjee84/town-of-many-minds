import { chromium } from 'playwright';
import { AGRICULTURAL_SETBACK, agriculturalSetbackConflict } from '../src/placement/siteRules.js';

const URL = process.env.APP_URL || 'http://localhost:5173';

// The rule itself is intentionally dependency-free and testable without a
// renderer. Keep the boundary explicit: the two-tile buffer is protected and
// the next tile is legal.
const fake = { sites: [{ kind: 'farm', cells: [[10, 10]] }] };
if (!agriculturalSetbackConflict(fake, [[10 + AGRICULTURAL_SETBACK, 10]])) {
  throw new Error('agricultural setback did not reject a boundary tile');
}
if (agriculturalSetbackConflict(fake, [[11 + AGRICULTURAL_SETBACK, 10]])) {
  throw new Error('agricultural setback rejected a legal tile');
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
  const agricultural = new Set(['farm', 'husbandry', 'poultry']);
  const sites = t.resources.sites.filter((s) => agricultural.has(s.kind));
  const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const conflicts = [];
  for (const building of t.buildings) {
    const cells = building.footprint?.length ? building.footprint : [building.cell];
    for (const site of sites) {
      for (const a of cells) for (const b of site.cells) {
        const d = distance(a, b);
        if (d <= buffer) conflicts.push({ building: building.kind, site: site.kind, d });
      }
    }
  }
  // The Council survey must also reject a footprint that touches a yard. The
  // founding seed has the yard outside the compact core, so a projection is
  // used here to survey the whole map without mutating the perimeter ledger.
  const surveyed = t.growth.findFootprintSite({
    type: 'civic',
    footprint: { cols: 1, rows: 1 },
    wantZone: 'civic',
    projection: true
  });
  return {
    buildings: t.buildings.length,
    agriculturalSites: sites.map((s) => ({ kind: s.kind, cells: s.cells.length })),
    conflicts,
    surveyed: surveyed?.cell || null,
    surveyedConflict: surveyed ? sites.some((site) => surveyed.cells.some((a) => site.cells.some((b) => distance(a, b) <= buffer))) : false
  };
}, AGRICULTURAL_SETBACK);

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.agriculturalSites.length) throw new Error(`seed 1337 has no agricultural site: ${JSON.stringify(result)}`);
if (result.conflicts.length) throw new Error(`founding buildings overlap agricultural setback: ${JSON.stringify(result)}`);
if (result.surveyedConflict) throw new Error(`Council surveyed a building site inside an agricultural setback: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result));
await browser.close();

