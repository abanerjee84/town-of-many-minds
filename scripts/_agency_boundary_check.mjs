import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.economy?.projectFinancePolicy && !!window.town?.growth?.submitPrivateOpportunity, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const t = window.town;
    t.generate(42);
    t.governance.auto = false;
    const economy = t.economy;
    const growth = t.growth;
    const beforeTreasury = economy.treasury;
    const beforeBuildings = t.buildings.length;

    const privateDecision = t.governance.enact('INTENT: DEVELOP_HOUSING', 'llm');
    const afterSignal = {
      treasury: economy.treasury,
      buildings: t.buildings.length,
      activeProjects: growth.projects.length,
      opportunities: growth.stats().developerMarket.opportunities.length
    };

    growth.developerReviewRemaining = 0;
    const developerResult = growth.developerPass();
    const privateProject = growth.projects.find((project) => project.plan?.commissionedBy === 'developer');
    const privateRows = economy.ledger.filter((row) => row.metadata?.projectId === privateProject?.plan?.projectId);
    const developerSpend = privateRows
      .filter((row) => row.from?.sector === 'developer')
      .reduce((sum, row) => sum + row.amount, 0);

    const factoryPolicy = economy.projectFinancePolicy({ type: 'factory', financingSector: 'government' });

    t.generate(42);
    t.governance.auto = false;
    const socialBefore = t.economy.treasury;
    const socialDecision = t.governance.enact('INTENT: DEVELOP_HOUSING program=social_housing', 'test');
    const socialRows = socialDecision?.projectId ? t.economy.projectTransactions(socialDecision.projectId) : [];
    const socialPublicSpend = socialRows
      .filter((row) => row.from?.sector === 'government')
      .reduce((sum, row) => sum + row.amount, 0);

    t.generate(42);
    const roadPlan = { type: 'road', cost: 100, projectId: 'agency-boundary-road' };
    const roadPolicy = t.economy.projectFinancePolicy(roadPlan);
    const roadFunding = t.economy.fundProject(roadPlan);
    const roadRows = t.economy.projectTransactions('agency-boundary-road');
    const roadPublicSpend = roadRows
      .filter((row) => row.from?.sector === 'government')
      .reduce((sum, row) => sum + row.amount, 0);

    return {
      beforeTreasury,
      beforeBuildings,
      privateDecision: privateDecision && {
        status: privateDecision.status,
        actualPublicSpend: privateDecision.actualPublicSpend,
        actualPrivateSpend: privateDecision.actualPrivateSpend,
        marketOpportunityId: privateDecision.marketOpportunityId
      },
      afterSignal,
      developer: {
      started: !!developerResult,
      projectId: privateProject?.plan?.projectId || null,
      commissionedBy: privateProject?.plan?.commissionedBy || null,
        spend: developerSpend,
        treasury: economy.treasury
      },
      factoryPolicy,
      social: {
        status: socialDecision?.status || null,
        publicSpend: socialPublicSpend,
        treasuryDelta: t.economy.treasury - socialBefore,
        financeBoundary: socialDecision?.funding?.label || null
      },
      road: {
        policy: roadPolicy,
        funded: roadFunding.ok,
        publicSpend: roadPublicSpend
      },
      audit: t.economy.audit()
    };
  });

  const failures = [...pageErrors];
  if (result.privateDecision?.status !== 'referred') failures.push(`private housing was not referred: ${JSON.stringify(result.privateDecision)}`);
  if (result.privateDecision?.actualPublicSpend !== 0 || result.privateDecision?.actualPrivateSpend !== 0) failures.push('private Council signal spent money at submission');
  if (result.afterSignal.treasury !== result.beforeTreasury) failures.push('private signal changed treasury');
  if (result.afterSignal.buildings !== result.beforeBuildings || result.afterSignal.activeProjects !== 0) failures.push('private signal started construction');
  if (!(result.afterSignal.opportunities > 0) || !result.privateDecision.marketOpportunityId) failures.push('private opportunity was not recorded');
  if (!result.developer.started || result.developer.commissionedBy !== 'developer' || !(result.developer.spend > 0)) failures.push(`developer did not accept the opportunity: ${JSON.stringify(result.developer)}`);
  if (result.factoryPolicy.financierSector !== 'developer' || !result.factoryPolicy.privateActor) failures.push(`factory private boundary failed: ${JSON.stringify(result.factoryPolicy)}`);
  if (result.social.status !== 'started' || !(result.social.publicSpend > 0) || result.social.financeBoundary !== 'public treasury') failures.push(`social housing did not use public finance: ${JSON.stringify(result.social)}`);
  if (!result.road.funded || result.road.policy.financierSector !== 'government' || !(result.road.publicSpend > 0)) failures.push(`public road did not use treasury: ${JSON.stringify(result.road)}`);
  if (!result.audit.ok) failures.push(`economy audit failed: ${JSON.stringify(result.audit)}`);
  console.log(JSON.stringify({ ok: failures.length === 0, result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
