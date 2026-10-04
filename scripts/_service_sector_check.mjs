import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.economy?.stats && !!window.town?.growth?.officeDemand, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const t = window.town;
    t.generate(1337);
    t.governance.auto = false;
    t.growth.auto = false;
    const economy = t.economy.stats();
    const types = t.economy.businesses.map((business) => business.type).sort();
    const officeAtPopulation = t.growth.officeDemand(180);
    const originalInputs = t.growth.inputs;
    const syntheticInputs = { ...originalInputs.call(t.growth), pop: 75 };
    t.growth.inputs = () => syntheticInputs;
    const governmentRow = t.growth.ranked().find((row) => row.type === 'civic' && row.opts?.facility === 'government');
    const originalDemand = t.growth.officeDemand;
    t.growth.officeDemand = () => ({ target: 2, count: 1, gap: 1, need: 0.5 });
    const officePlan = t.growth.developerPlan();
    t.growth.developerReviewRemaining = 0;
    const officeStart = t.growth.developerPass();
    t.growth.tickProjects(100000);
    const completedOfficeCount = t.buildings.filter((building) => building.kind === 'office').length;
    t.growth.officeDemand = originalDemand;
    t.growth.inputs = originalInputs;
    return {
      economy: { businesses: economy.businesses, serviceSector: economy.serviceSector, types },
      officeAtPopulation,
      governmentRow: governmentRow && { facility: governmentRow.opts.facility, serviceNeed: governmentRow.opts.serviceNeed },
      developerPlan: officePlan && { type: officePlan.type, commissionedBy: officePlan.commissionedBy, owner: officePlan.owner },
      officeStart: officeStart && { status: officeStart.status, hours: officeStart.hours },
      completedOfficeCount
    };
  });

  const failures = [...pageErrors];
  if (result.economy.types.filter((type) => type === 'retail').length !== 3) failures.push(`shops were not classified as retail: ${JSON.stringify(result.economy.types)}`);
  if (result.economy.serviceSector?.private?.offices !== 1 || result.economy.serviceSector?.state?.facilities < 1) failures.push(`state/private service census is incomplete: ${JSON.stringify(result.economy.serviceSector)}`);
  if (result.officeAtPopulation?.gap !== 1 || result.officeAtPopulation?.target !== 2) failures.push(`population-earned office target failed: ${JSON.stringify(result.officeAtPopulation)}`);
  if (result.governmentRow?.facility !== 'government') failures.push(`government service milestone is missing: ${JSON.stringify(result.governmentRow)}`);
  if (result.developerPlan?.type !== 'office' || result.developerPlan?.commissionedBy !== 'developer') failures.push(`developer did not select the office service gap: ${JSON.stringify(result.developerPlan)}`);
  if (result.officeStart?.status !== 'started' || result.completedOfficeCount !== 2) failures.push(`private office project did not complete: ${JSON.stringify(result.officeStart)} offices=${result.completedOfficeCount}`);
  console.log(JSON.stringify({ ok: failures.length === 0, result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
