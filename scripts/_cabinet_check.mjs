import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5181', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.governance?.cabinet);
  const result = await page.evaluate(async () => {
    const t = window.town;
    t.generate('cabinet-1337');
    t.governance.auto = false;
    t.governance.cabinet.motionsPerSitting = 5;
    let calls = 0;
    const provider = {
      id: 'cabinet-check',
      complete: async () => ({
        model: 'cabinet-check',
        text: JSON.stringify({ motions: calls++ === 0 ? [
          { department: 'treasury', intent: 'STUDY_ECONOMY', reason: 'measure runway', priority: 0.4 },
          { department: 'land', intent: 'STUDY_DEMOGRAPHICS', reason: 'measure population', priority: 0.3 },
          { department: 'infrastructure', intent: 'STUDY_TRAFFIC', reason: 'measure movement', priority: 0.5 },
          { department: 'services', intent: 'STUDY_INCIDENTS', reason: 'measure calls', priority: 0.6 },
          { department: 'society', intent: 'NO_ACTION', reason: 'hold', priority: 0.1 }
        ] : [
          { department: 'treasury', intent: 'EXTEND_STREET', reason: 'wrong remit', priority: 0.9 },
          { department: 'treasury', intent: 'STUDY_ECONOMY', reason: 'valid', priority: 0.4 },
          { department: 'treasury', intent: 'STUDY_ECONOMY', reason: 'duplicate', priority: 0.3 }
        ] })
      })
    };
    t.governance.setProvider(provider);
    const firstReturned = await t.governance.ask();
    const firstCabinet = t.governance.stats().cabinet;
    const secondReturned = await t.governance.ask();
    const cabinet = t.governance.stats().cabinet;
    const cabinetPromptTokens = Math.ceil((window.systemPrompt(t).length + t.governance.cabinet.prompt().length) / 4);
    const wrongDepartment = t.governance.cabinet.parse(JSON.stringify({ motions: [
      { department: 'treasury', intent: 'EXTEND_STREET', reason: 'wrong remit' }
    ] }))[0];
    return {
      firstReturned: { intent: firstReturned.intent, status: firstReturned.status },
      firstMotions: firstCabinet.lastMotions.length,
      firstApproved: firstCabinet.lastReview.approved.length,
      firstExecuted: firstCabinet.lastExecution.length,
      secondReturned: { intent: secondReturned.intent, status: secondReturned.status },
      motions: cabinet.lastMotions.length,
      approved: cabinet.lastReview.approved.length,
      rejected: cabinet.lastReview.rejected.length,
      deferred: cabinet.lastReview.deferred.length,
      executed: cabinet.lastExecution.length,
      departments: cabinet.departments.length,
      max: cabinet.motionsPerSitting,
      cabinetPromptTokens,
      wrongDepartment: { valid: wrongDepartment.ownershipValid, reason: wrongDepartment.ownershipReason },
      sittingIds: [...new Set(t.governance.decisions.filter((row) => row.motionId).map((row) => row.sittingId))],
      execution: cabinet.lastExecution.map((row) => ({ intent: row.intent, status: row.status, mayor: row.mayor }))
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.departments, 5, JSON.stringify(result));
  assert.equal(result.max, 5, JSON.stringify(result));
  assert.ok(result.cabinetPromptTokens <= 4000, JSON.stringify(result));
  assert.equal(result.firstMotions, 5, JSON.stringify(result));
  assert.equal(result.firstApproved, 5, JSON.stringify(result));
  assert.equal(result.firstExecuted, 5, JSON.stringify(result));
  assert.equal(result.motions, 3, JSON.stringify(result));
  assert.equal(result.approved, 1, JSON.stringify(result));
  assert.equal(result.rejected, 2, JSON.stringify(result));
  assert.equal(result.deferred, 0, JSON.stringify(result));
  assert.equal(result.executed, 1, JSON.stringify(result));
  assert.equal(result.wrongDepartment.valid, false, JSON.stringify(result));
  assert.equal(result.sittingIds.length, 2, JSON.stringify(result));
  console.log(JSON.stringify({ ok: true, ...result, pageErrors: errors }));
} finally {
  await browser.close();
}
