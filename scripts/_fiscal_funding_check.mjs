import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://localhost:5174', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => !!window.town?.economy, null, { timeout: 60000 });
const result = await page.evaluate(() => {
  const t = window.town;
  t.generate(1337);
  t.governance.auto = false;
  const economy = t.economy;
  const before = economy.treasury;
  const decision = t.governance.enact('INTENT: UPGRADE_RESOURCE resource=fuel', 'test');
  const rows = decision?.projectId ? economy.projectTransactions(decision.projectId) : [];
  const publicAmount = rows
    .filter((row) => row.from?.sector === 'government')
    .reduce((sum, row) => sum + row.amount, 0);
  const privateAmount = rows
    .filter((row) => row.from?.sector === 'developer' || row.from?.sector === 'business' || row.from?.sector === 'household')
    .reduce((sum, row) => sum + row.amount, 0);
  return {
    before,
    after: economy.treasury,
    treasuryDelta: economy.treasury - before,
    decision: decision && {
      status: decision.status,
      cost: decision.cost,
      actualPublicSpend: decision.actualPublicSpend,
      actualPrivateSpend: decision.actualPrivateSpend,
      funding: decision.funding
    },
    cardFunding: document.querySelector('.c-cost')?.textContent || '',
    project: { publicAmount, privateAmount },
    audit: economy.audit()
  };
});
const failures = [...errors];
if (result.decision?.status !== 'started') failures.push(`resource upgrade did not start: ${result.decision?.status}`);
if (!(result.decision?.actualPrivateSpend > 0)) failures.push('private funding was not recorded');
if (result.decision?.actualPublicSpend !== 0 || result.project.publicAmount !== 0) failures.push('resource upgrade incorrectly charged public treasury');
if (result.decision?.funding?.label !== 'private capital') failures.push(`funding label was ${result.decision?.funding?.label}`);
if (!result.cardFunding.includes('private capital')) failures.push(`decision card did not show funding source: ${result.cardFunding}`);
if (!(result.treasuryDelta > 0)) failures.push('permit revenue did not reach treasury');
if (!result.audit.ok) failures.push(`economy audit failed: ${JSON.stringify(result.audit)}`);
console.log(JSON.stringify({ ok: failures.length === 0, result, errors, failures }, null, 2));
await browser.close();
process.exitCode = failures.length ? 1 : 0;
