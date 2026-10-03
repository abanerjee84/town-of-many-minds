import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.resources?.producerSiteRoom);

const result = await page.evaluate(() => {
  const t = window.town;
  const resources = t.resources;
  const setup = (farmLevel = 3) => {
    t.generate(1337);
    // Hold demand constant at a larger-town level so this regression exercises
    // the food-capacity path without manufacturing hundreds of incomplete
    // citizen records. The planner still sees the real seed, perimeter and
    // placement geometry.
    resources.demandNow = () => ({ water: 42, energy: 180, food: 500, fuel: 70 });
    for (const site of resources.sites) if (site.kind === 'farm') site.level = farmLevel;
    resources._prodSig = null;
    resources.levels.food = 0;
  };

  setup(1);
  // An LLM may repeat a valid housing upgrade while the food producer is
  // capacity-short. Council-only governance must record the blocked motion
  // and wait for the Council to choose the resource remedy; no rules action is
  // allowed to consume the sitting behind the model's back.
  const upgradeGated = t.governance.enact('INTENT: DEVELOP_HOUSING', 'llm');

  setup(3);
  // Once the founding farm is already at its level cap, the same shortage
  // must move to a charged frontier purchase. This is the land branch of the
  // emergency substitution and protects against a generic UPGRADE_BUILDING
  // fallback when the measured remedy changes between sittings.
  const gated = t.governance.enact('INTENT: DEVELOP_HOUSING', 'llm');

  setup();
  const before = {
    strained: resources.stats().strained,
    room: resources.producerSiteRoom('food'),
    landNeed: t.growth.resourceLandNeed(),
    acquired: t.perimeter.acquired.size,
    sites: resources.sites.filter((site) => ['farm', 'husbandry', 'poultry'].includes(site.kind)).length
  };
  const decision = t.governance.forceRequest('INTENT: ACQUIRE_LAND');
  const afterLand = t.perimeter.acquired.size;
  const siteDecision = t.governance.forceRequest('INTENT: UPGRADE_RESOURCE resource=food');
  t.growth.update(1e7);
  const after = {
    acquired: t.perimeter.acquired.size,
    sites: resources.sites.filter((site) => ['farm', 'husbandry', 'poultry'].includes(site.kind)).length,
    kinds: resources.sites.filter((site) => ['farm', 'husbandry', 'poultry'].includes(site.kind)).map((site) => site.kind),
    room: resources.producerSiteRoom('food')
  };
  return {
    upgradeGated: upgradeGated && {
      intent: upgradeGated.intent,
      status: upgradeGated.status,
      substituted: upgradeGated.substituted?.intent || null,
      detail: upgradeGated.substituted?.detail || upgradeGated.detail
    },
    gated: gated && {
      intent: gated.intent,
      status: gated.status,
      substituted: gated.substituted?.intent || null,
      detail: gated.substituted?.detail || gated.detail
    },
    before: { ...before, room: !!before.room },
    decision: decision && { status: decision.status, intent: decision.intent, detail: decision.detail },
    siteDecision: siteDecision && { status: siteDecision.status, intent: siteDecision.intent, detail: siteDecision.detail },
    afterLand,
    after
  };
});

console.log(JSON.stringify({ result, pageErrors }));
const ok = !pageErrors.length &&
  result.upgradeGated?.intent === 'DEVELOP_HOUSING' &&
  result.upgradeGated?.status === 'blocked' &&
  result.upgradeGated?.substituted === null &&
  result.upgradeGated?.detail?.includes('food capacity emergency') &&
  result.gated?.intent === 'DEVELOP_HOUSING' &&
  result.gated?.status === 'blocked' &&
  result.gated?.substituted === null &&
  result.gated?.detail?.includes('food capacity emergency') &&
  result.before.strained.includes('food') &&
  result.before.room === false &&
  result.before.landNeed === 'food' &&
  result.decision?.status === 'done' &&
  result.siteDecision?.status === 'started' &&
  result.siteDecision?.intent === 'UPGRADE_RESOURCE' &&
  result.afterLand > result.before.acquired &&
  result.after.sites > result.before.sites;
if (!ok) process.exit(1);
await browser.close();
