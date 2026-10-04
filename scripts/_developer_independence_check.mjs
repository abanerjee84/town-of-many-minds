import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth?.stats && !!window.town?.governance?.stats);

const result = await page.evaluate(() => {
  const town = window.town;
  town.generate(1337);
  const growth = town.growth;
  const governance = town.governance;
  growth.auto = false;
  governance.auto = false;
  governance.enabled = false;
  const decisionsBefore = governance.decisions.length;
  const councilEvents = [];
  const developerEvents = [];
  const offCouncil = window.events.on('council', (event) => councilEvents.push(event));
  const offDeveloper = window.events.on('developer-action', (event) => developerEvents.push(event));
  let passCalls = 0;
  const originalPass = growth.developerPass.bind(growth);
  growth.developerPass = () => {
    passCalls += 1;
    return originalPass();
  };

  // The developer review is scheduled even when public Council automation is
  // disabled. A second short update must not turn the market into a frame loop.
  growth.update(1);
  growth.update(1);
  const afterReview = growth.stats();
  const scheduledPassCalls = passCalls;

  // Force one legal private commission through the real pass boundary. The
  // event must be private-market telemetry, never a Council motion.
  growth.projects = [];
  growth.developerReviewRemaining = 0;
  growth.developerPlan = () => ({ type: 'shop', label: 'Test private shop', cost: 100, projectId: 'developer-test' });
  growth.apply = () => ({ status: 'started' });
  growth.developerPass();

  // A private project occupies only the private lane. The public lane remains
  // available for a Council order, while the developer cap remains explicit.
  growth.projects = [{ plan: { commissionedBy: 'developer' } }];
  const lanes = {
    public: growth.activePublicProjects(),
    private: growth.activeDeveloperProjects(),
    privateCap: afterReview.developerMarket.maxActive
  };

  return {
    passCalls: scheduledPassCalls,
    reviews: afterReview.developerMarket.reviews,
    independent: afterReview.developerMarket.independent,
    nextReviewHours: afterReview.developerMarket.nextReviewHours,
    decisionsUnchanged: governance.decisions.length === decisionsBefore,
    councilEvents: councilEvents.length,
    developerEvents: developerEvents.length,
    lanes,
    publicActive: afterReview.publicActive
  };
});

console.log(JSON.stringify({ result, pageErrors }));
const failures = [
  ...pageErrors.map((message) => `page error: ${message}`),
  result.passCalls !== 1 ? `developer pass ran ${result.passCalls} times during two short updates` : null,
  result.reviews !== 1 ? 'developer review was not independently scheduled' : null,
  result.independent !== true ? 'developer telemetry does not declare independence' : null,
  !(result.nextReviewHours > 0) ? 'developer review did not schedule a future market tick' : null,
  !result.decisionsUnchanged ? 'developer review mutated the Council decision ledger' : null,
  result.councilEvents !== 0 ? 'developer commission leaked onto the Council event channel' : null,
  result.developerEvents !== 1 ? 'developer commission did not emit its own event' : null,
  result.lanes.public !== 0 ? 'a private project consumed the public project lane' : null,
  result.lanes.private !== 1 ? 'private project was not counted in the private lane' : null,
  result.lanes.privateCap !== 1 ? 'private project cap is not configured' : null,
  result.publicActive !== 0 ? 'public active-project telemetry is incorrect' : null
].filter(Boolean);

await browser.close();
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }));
  process.exit(1);
}
