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
  // A single vacant industrial frontage cell must not make BUILD_FACTORY look
  // feasible when its full campus is unavailable. Simulate that frontier case
  // without destroying the seeded geometry and verify that the board carries
  // ACQUIRE_LAND as the prerequisite instead.
  const originalFactoryRoom = t.growth.factoryRoom;
  const originalFactorySiteAvailable = t.growth.factorySiteAvailable;
  const originalMissingConstructionProduct = t.industry.missingConstructionProduct;
  t.growth.factoryRoom = () => true;
  t.growth.factorySiteAvailable = () => false;
  t.industry.missingConstructionProduct = () => 'steel';
  const frontierRanked = t.growth.ranked().slice(0, 12).map((row) => row.type);
  const frontierLand = window.planFor(t, 'land');
  const frontierQuote = frontierLand ? t.growth.quote(frontierLand) : null;
  t.growth.factoryRoom = originalFactoryRoom;
  t.growth.factorySiteAvailable = originalFactorySiteAvailable;
  t.industry.missingConstructionProduct = originalMissingConstructionProduct;
  // Also exercise the live governance boundary: if a model repeats a blocked
  // factory order, the rules fallback must enact ACQUIRE_LAND directly.
  const originalQuote = t.growth.quote;
  const originalFactoryLandNeeded = t.growth.factoryLandNeeded;
  const originalLandNeeded = t.growth.landNeeded;
  t.growth.factoryLandNeeded = () => true;
  t.growth.landNeeded = () => true;
  t.growth.quote = (candidate) => candidate?.type === 'factory'
    ? { ok: false, reason: 'no acquired industrial campus — ACQUIRE_LAND first' }
    : originalQuote.call(t.growth, candidate);
  const blockedFactoryFallback = t.governance.enact('INTENT: BUILD_FACTORY type=sawmill', 'test');
  t.growth.quote = originalQuote;
  t.growth.factoryLandNeeded = originalFactoryLandNeeded;
  t.growth.landNeeded = originalLandNeeded;
  const beforeRoads = g.roadCells().length;
  const beforeBuildings = t.buildings.length;
  const needCash = (plan.cost || 0) + 100000;
  if (t.economy && t.economy.treasury < needCash) t.economy.treasury += needCash - t.economy.treasury;
  for (const [key, value] of Object.entries(plan.materials || {})) {
    if ((t.industry.stocks[key] || 0) < value) t.industry.stocks[key] = value;
  }
  // This regression is about factory geometry after a land decision. Service a
  // real progression patch through the perimeter ledger before commissioning;
  // the production path must never bypass acquisition by paving a hidden road.
  const acquired = t.growth.landAcquisitionCells(plan);
  if (acquired?.length) t.perimeter.acquire(acquired, { charge: false, reason: 'factory-site regression land' });
  const applied = !!t.growth.apply(plan);
  // A factory must survive the full executor path, not merely enter the
  // project ledger. Run the clock past its build hours so a frontage anchor
  // cannot silently shift the reserved multi-cell campus at completion.
  if (applied) t.growth.update(1e7);
  const projectStates = [...t.growth.projectStates.values()]
    .filter((entry) => entry.projectId === plan.projectId)
    .map((entry) => entry.state);
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
    frontierRanked,
    frontierLandType: frontierLand?.type || null,
    frontierLandQuote: frontierQuote?.ok || false,
    blockedFactoryFallback: {
      intent: blockedFactoryFallback?.intent || null,
      status: blockedFactoryFallback?.status || null,
      substituted: blockedFactoryFallback?.substituted?.intent || null
    },
    completedFactories: t.buildings.filter((b) => b.kind === 'factory').length,
    projectStates,
    lastBlock: t.growth.lastBlock,
    queued: t.growth.projects.length
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
if (!result.surveyRoadsUnchanged) {
  throw new Error(`factory survey paved roads during preview: ${JSON.stringify(result)}`);
}
if (!result.applied || result.completedFactories < 1 || result.projectStates.includes('FAILED_ROLLED_BACK') || result.footprintArea < 9 || result.lastBlock) {
  throw new Error(`factory site regression failed: ${JSON.stringify(result)}`);
}
const landIndex = result.frontierRanked.indexOf('land');
if (result.frontierLandType !== 'land' || !result.frontierLandQuote || landIndex < 0 || result.frontierRanked.includes('factory')) {
  throw new Error(`frontier factory was offered before land acquisition: ${JSON.stringify(result)}`);
}
if (result.blockedFactoryFallback.intent !== 'ACQUIRE_LAND' || result.blockedFactoryFallback.status !== 'done' || result.blockedFactoryFallback.substituted !== 'BUILD_FACTORY') {
  throw new Error(`blocked factory did not redirect to land acquisition: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
