import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth?.evaluatePrivateOpportunityNow);

const result = await page.evaluate(() => {
  const town = window.town;
  town.generate(1337);
  const growth = town.growth;
  growth.auto = false;
  const developerEvents = [];
  const offDeveloper = window.events.on('developer-opportunity', (event) => developerEvents.push(event));

  // Occupy the sole private contractor slot with a real construction-shaped
  // project. The referral must stay in the bounded queue rather than vanish.
  growth.projects = [{
    id: 'active-private',
    remaining: 99,
    plan: { projectId: 'active-private', commissionedBy: 'developer', type: 'shop', label: 'Active private project', cells: [] }
  }];
  const submitted = growth.submitPrivateOpportunity({
    intent: 'TIERUP',
    type: 'tierup',
    params: { buildingId: 'queued-tierup-test' },
    source: 'council',
    reason: 'queued referral regression'
  });
  const queued = growth.evaluatePrivateOpportunityNow(submitted.opportunity.id);
  const retainedBeforeRelease = growth.privateOpportunities.some((entry) => entry.id === submitted.opportunity.id);

  // Replace the normal planning/apply details with a deterministic accepted
  // plan so this probe isolates the queue/retry contract from site fixtures.
  growth.privateOpportunityPlan = () => ({
    opportunity: submitted.opportunity,
    plan: { projectId: 'retried-private', type: 'tierup', label: 'Queued tier-up', cost: 0, commissionedBy: 'developer' },
    viability: { reason: 'queue regression plan' }
  });
  growth.apply = () => ({ status: 'started', projectId: 'retried-private' });
  growth.developerReviewRemaining = 0;
  growth.projects[0].remaining = 0;
  growth.projects[0].plan.run = () => true;
  // Completion clears the developer review timer; update() then retries in
  // the same game-time step without a new Council sitting.
  growth.update(1);
  const retried = !growth.privateOpportunities.some((entry) => entry.id === submitted.opportunity.id);
  offDeveloper?.();
  return {
    queuedStatus: queued.status,
    queuedReason: queued.reason,
    retainedBeforeRelease,
    retried,
    privateProjectsAfterRetry: growth.activeDeveloperProjects(),
    queuedEvents: developerEvents.filter((event) => event.status === 'queued').length
  };
});

console.log(JSON.stringify({ result, pageErrors }));
const failures = [
  ...pageErrors.map((message) => `page error: ${message}`),
  result.queuedStatus !== 'queued' ? `busy referral status was ${result.queuedStatus}` : null,
  !/private contractors busy \(1\/1\)/.test(result.queuedReason || '') ? 'busy referral did not expose the active-cap reason' : null,
  !result.retainedBeforeRelease ? 'busy referral was removed instead of queued' : null,
  !result.retried ? 'queued referral was not retried after the private project completed' : null,
  result.privateProjectsAfterRetry !== 0 ? 'test retry did not preserve the isolated private lane' : null,
  result.queuedEvents !== 1 ? `expected one queued developer event, saw ${result.queuedEvents}` : null
].filter(Boolean);

await browser.close();
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }));
  process.exit(1);
}
