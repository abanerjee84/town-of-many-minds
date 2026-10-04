import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.foreignInvestment?.stats && !!window.town?.governance?.enact);

const result = await page.evaluate(() => {
  const town = window.town;
  town.generate(1337);
  town.clockDay = 1;
  town.governance.auto = false;
  town.governance.enabled = true;
  const fdi = town.foreignInvestment;
  // Force the offer gate only for this deterministic mechanism probe. The
  // production gate remains population/treasury/approval based.
  fdi.rules.triggers.minPopulation = 0;
  fdi.rules.triggers.minTreasury = 0;
  fdi.rules.triggers.minApproval = 0;
  fdi.refresh(1, { force: true });
  const before = fdi.stats();
  const solicitation = town.governance.enact('INTENT: SOLICIT_FDI', 'test');
  const offerId = solicitation.offerId;
  const approval = town.governance.enact(`INTENT: APPROVE_CONCESSION offer=${offerId}`, 'test');
  const started = fdi.stats();
  if (town.growth.projects.length) town.growth.update(1e7);
  town.clockDay = 2;
  fdi.update(0, { day: 2, hour: 12 });
  const after = fdi.stats();
  const saved = town.exportIntegrityState();
  const restored = saved.ok ? town.importIntegrityState(saved) : saved;
  const afterRestore = fdi.stats();
  const audit = town.economy.audit?.() || { ok: true };
  return {
    beforeOffers: before.offers.length,
    solicitation: { status: solicitation.status, offerId: solicitation.offerId || null },
    approval: { status: approval.status, detail: approval.detail },
    active: started.activeProjects,
    committed: after.capitalCommitted,
    jobs: after.jobsCreated,
    infrastructure: after.infrastructure,
    taxRevenue: after.taxRevenue,
    projectStatuses: fdi.projects.map((project) => project.status),
    saveRestore: { ok: restored.ok, capital: afterRestore.capitalCommitted, projects: afterRestore.activeProjects },
    auditOk: audit.ok,
    parser: window.parseIntent('APPROVE_CONCESSION offer=fdi-offer-1-1').intent,
    actionRegistered: town.governance.enact('INTENT: SOLICIT_FDI', 'test')?.intent === 'SOLICIT_FDI'
  };
});

console.log(JSON.stringify({ result, pageErrors }));
const failures = [
  ...pageErrors.map((message) => `page error: ${message}`),
  result.beforeOffers < 1 ? 'FDI did not produce an offer' : null,
  result.solicitation.status !== 'done' || !result.solicitation.offerId ? 'SOLICIT_FDI did not expose an offer id' : null,
  !['started', 'done'].includes(result.approval.status) ? `APPROVE_CONCESSION failed: ${result.approval.detail}` : null,
  result.committed <= 0 ? 'foreign capital was not committed' : null,
  result.jobs <= 0 ? 'foreign project did not add jobs' : null,
  !result.auditOk ? 'economy audit failed after FDI transfers' : null,
  !result.saveRestore.ok || result.saveRestore.capital <= 0 ? 'FDI state did not survive integrity save/restore' : null,
  result.parser !== 'APPROVE_CONCESSION' || !result.actionRegistered ? 'FDI intent is not registered/parser-visible' : null
].filter(Boolean);
await browser.close();
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }));
  process.exit(1);
}
