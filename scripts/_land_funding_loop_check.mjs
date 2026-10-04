import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.governance && !!window.town?.growth, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const t = window.town;
    t.generate('land-funding-loop');
    t.governance.auto = false;
    const originalEmergency = t.growth.resourceEmergency.bind(t.growth);
    const originalQuote = t.growth.quote.bind(t.growth);
    let landBlocked = true;
    t.growth.resourceEmergency = () => ({ resource: 'food', kind: 'land', intent: 'ACQUIRE_LAND' });
    t.growth.quote = (plan) => {
      if (landBlocked && plan?.type === 'land') {
        return { ok: false, reason: 'over budget — government needs 271208 on hand' };
      }
      return originalQuote(plan);
    };

    const blocked = t.governance.enact('INTENT: ACQUIRE_LAND', 'llm');
    const afterBlock = t.governance.stats().requiredAction;
    const mayor = t.governance.cabinet.mayor.review([
      { id: 'motion-bond', index: 0, department: 'treasury', intent: 'BOND_ISSUE', priority: 1, key: 'BOND_ISSUE' },
      { id: 'motion-tier', index: 1, department: 'society', intent: 'TIERUP', priority: 0.8, key: 'TIERUP' }
    ], { requiredAction: afterBlock });
    const bond = t.governance.enact('INTENT: BOND_ISSUE', 'llm');
    const afterBond = t.governance.stats().requiredAction;
    landBlocked = false;

    t.growth.resourceEmergency = originalEmergency;
    t.growth.quote = originalQuote;
    return {
      blocked: { status: blocked.status, requiredAction: blocked.requiredAction, detail: blocked.detail },
      fundingRemedy: afterBlock,
      mayor: {
        approved: mayor.approved.map((motion) => motion.intent),
        deferred: mayor.deferred.map((motion) => ({ intent: motion.intent, reason: motion.mayorReason }))
      },
      bond: { status: bond.status, detail: bond.detail },
      afterBond,
      auditOk: t.economy.audit().ok
    };
  });

  const failures = [];
  if (result.blocked.requiredAction !== 'INTENT: BOND_ISSUE') failures.push('blocked land order did not promote BOND_ISSUE');
  if (result.fundingRemedy?.intent !== 'BOND_ISSUE' || result.fundingRemedy?.kind !== 'finance') failures.push('funding remedy state missing');
  if (!result.mayor.approved.includes('BOND_ISSUE')) failures.push('Mayor still deferred BOND_ISSUE');
  if (!result.mayor.deferred.some((motion) => motion.intent === 'TIERUP')) failures.push('Mayor did not defer non-funding motion');
  if (result.bond.status !== 'done') failures.push(`bond did not execute: ${result.bond.status}`);
  if (result.afterBond !== null) failures.push('finance directive was not cleared after bond');
  if (!result.auditOk) failures.push('economy audit failed');
  failures.push(...pageErrors.map((message) => `page error: ${message}`));

  console.log(JSON.stringify({ ok: failures.length === 0, result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
