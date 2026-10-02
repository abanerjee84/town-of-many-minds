import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.fill('#seed-input', '1337');
await page.click('#regen');
await page.waitForTimeout(500);

const result = await page.evaluate(() => {
  const t = window.town;
  const g = t.grid;
  const plan = window.planFor(t, 'factory', { factory: 'sawmill' });
  const surveyPlan = {
    type: 'factory', factory: 'sawmill', acquire: false, need: 1,
    footprintCandidates: [[6, 6]], matPerCell: { lumber: 1, cement: 1, steel: 1 }
  };
  const surveyRoadsBefore = g.roadCells().length;
  const survey = t.growth.expandPreview(surveyPlan);
  const surveyRoadsAfter = g.roadCells().length;
  const beforeRoads = g.roadCells().length;
  const beforeBuildings = t.buildings.length;
  const needCash = (plan.cost || 0) + 100000;
  if (t.economy && t.economy.treasury < needCash) t.economy.treasury += needCash - t.economy.treasury;
  for (const [key, value] of Object.entries(plan.materials || {})) {
    if ((t.industry.stocks[key] || 0) < value) t.industry.stocks[key] = value;
  }
  const applied = !!t.growth.apply(plan);
  return {
    applied,
    beforeRoads,
    afterRoads: g.roadCells().length,
    beforeBuildings,
    afterBuildings: t.buildings.length,
    footprint: plan.footprint,
    footprintArea: plan.footprint ? plan.footprint.cols * plan.footprint.rows : 0,
    expansion: plan.expansion || null,
    surveyFound: !!survey,
    surveyRoadsUnchanged: surveyRoadsBefore === surveyRoadsAfter,
    lastBlock: t.growth.lastBlock,
    queued: t.growth.projects.length
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.surveyRoadsUnchanged) {
  throw new Error(`factory survey paved roads during preview: ${JSON.stringify(result)}`);
}
if (!result.applied || result.footprintArea < 9 || result.lastBlock) {
  throw new Error(`factory site regression failed: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
