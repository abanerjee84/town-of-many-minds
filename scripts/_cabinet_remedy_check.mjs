import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176');
  await page.waitForFunction(() => window.town?.governance?.cabinet);
  const result = await page.evaluate(async () => {
    const t = window.town, clock = window.clock, g = t.governance;
    const demandNow = t.resources.demandNow;
    const reset = (emergency = false) => {
      t.generate(1337); clock.reset(); clock.speed = 0;
      g.auto = false; t.growth.auto = false;
      t.resources.demandNow = emergency
        ? () => ({ water: 42, energy: 180, food: 500, fuel: 70 }) : demandNow;
      if (emergency) t.resources.levels.food = 0;
      t.resources._prodSig = null;
    };
    const calls = [];
    let refuseCorrection = false;
    const provider = {
      id: 'remedy-regression',
      complete: async ({ department, messages }) => {
        const prompt = messages.map(message => message.content).join('\n');
        const correction = prompt.includes('CORRECTION:');
        calls.push({ department, correction, prompt });
        if (department === 'council') return { text: JSON.stringify({ selected: [
          { id: 'motion-1', priority: 1 }, { id: 'motion-3', priority: 0.8 }
        ] }) };
        const directive = prompt.match(/MANDATORY COUNCIL REMEDY: choose INTENT: ([A-Z_]+)(?: resource=([a-z]+))?/);
        const intent = correction && !refuseCorrection ? directive?.[1] || 'UPGRADE_RESOURCE'
          : department === 'treasury' ? 'SLASH_SPENDING'
          : department === 'infrastructure' ? 'STUDY_TRAFFIC' : 'NO_ACTION';
        return { text: JSON.stringify({ motions: [{ department, intent, priority: 1,
          params: intent === 'UPGRADE_RESOURCE' ? { resource: 'food' } : {},
          reason: 'regression fixture evidence' }] }) };
      }
    };
    const sitting = async () => {
      calls.length = 0;
      g.setProvider(provider);
      const decision = await g.ask();
      return { calls: calls.length, corrections: calls.filter(call => call.correction).length,
        executions: g.cabinet.lastExecution.map(row => ({ intent: row.intent, status: row.status })),
        required: g.requiredAction, pending: g.pending, status: decision.status };
    };

    reset();
    g.requiredAction = { intent: 'UPGRADE_RESOURCE', resource: 'food', kind: 'upgrade', attempts: 4 };
    const stale = await sitting();
    if (stale.required || stale.calls !== 6 || !stale.executions.some(row => row.intent === 'SLASH_SPENDING' && row.status === 'done'))
      throw Error('Resolved resource directive still vetoed a healthy-town sitting');

    reset(true);
    const blocked = g.enact('INTENT: DEVELOP_HOUSING', 'llm');
    if (blocked.status !== 'blocked') throw Error('Fixture did not reproduce resource sequencing');
    const emergency = await sitting();
    const allReports = calls.every(call => call.prompt.includes('MANDATORY COUNCIL REMEDY:') && call.prompt.includes('resource=food'));
    const fullContextTokens = Math.max(...calls.map(call => Math.ceil(call.prompt.length / 4)));
    if (!allReports) throw Error('Compacting dropped the mandatory resource directive');
    if (emergency.corrections !== 1 || emergency.calls !== 7 || emergency.required)
      throw Error('All-deferred sitting did not repair the missing remedy in the same sitting');
    if (!emergency.executions.some(row => row.intent === 'UPGRADE_RESOURCE' && row.status === 'started'))
      throw Error('Corrected resource motion did not start real construction');
    if (!emergency.executions.some(row => row.intent === 'SLASH_SPENDING' && row.status === 'done'))
      throw Error('Original Council-selected motion was not resumed after the remedy started');
    const pendingProject = t.growth.projects.find(project => project.plan?.type === 'resource');
    if (!pendingProject) throw Error('No actual resource project exists');
    const target = pendingProject.plan.target, levelBefore = target.level;
    const underway = await sitting();
    if (underway.required || underway.calls !== 6 || underway.corrections)
      throw Error('In-flight resource remedy still held the Mayor');
    t.growth.update(1e7);
    if (target.level <= levelBefore) throw Error('Started resource remedy did not complete');

    reset(true);
    const report = g.report;
    // Oversized catalogue/feasibility rows must not crowd out the Mayor's rule.
    g.report = function() {
      return report.call(this).replace(/^Feasible now.*$/m, row => row + ' optional-detail'.repeat(300));
    };
    let crowded;
    try { crowded = await sitting(); } finally { g.report = report; }
    if (!calls.every(call => call.prompt.includes('MANDATORY COUNCIL REMEDY:')) ||
      !crowded.executions.some(row => row.intent === 'UPGRADE_RESOURCE' && row.status === 'started'))
      throw Error('Large report displaced the sequencing directive');

    reset(true);
    g.cabinet.motionsPerSitting = 1;
    const capped = await sitting();
    if (capped.executions.length !== 1 || capped.executions[0].intent !== 'UPGRADE_RESOURCE')
      throw Error('Same-turn continuation exceeded configured approval cap');
    g.cabinet.motionsPerSitting = 5;

    reset(true);
    refuseCorrection = true;
    const refused = await sitting();
    if (refused.calls !== 7 || refused.executions.length || !refused.required || refused.pending || t.growth.projects.length)
      throw Error('Invalid correction bypassed Council authority or left the simulation pending');

    const wrongResource = g.cabinet.mayor.review([{ id: 'wrong', department: 'services',
      intent: 'UPGRADE_RESOURCE', params: { resource: 'energy' } }], { requiredAction: g.requiredAction });
    if (wrongResource.approved.length || wrongResource.deferred.length !== 1)
      throw Error('A different resource incorrectly satisfied the mandatory remedy');

    reset(true);
    for (const site of t.resources.sites) if (site.kind === 'farm') site.level = 3;
    // Raising an agricultural tier also raises crew demand. Restore its crew
    // before testing the separate capacity/land funding bridge.
    t.economy.assignEmployees();
    t.resources._prodSig = null;
    const quote = t.growth.quote;
    let fundingBlocked = true;
    t.growth.quote = function(plan) {
      return fundingBlocked && plan.type === 'land'
        ? { ok: false, reason: 'over budget — government needs 271208 on hand' } : quote.call(this, plan);
    };
    g.enact('INTENT: ACQUIRE_LAND', 'llm');
    const financeBefore = g.refreshRequiredAction()?.intent;
    fundingBlocked = false;
    const financeAfter = g.refreshRequiredAction()?.intent;
    t.growth.quote = quote;
    if (financeBefore !== 'BOND_ISSUE' || financeAfter !== 'ACQUIRE_LAND')
      throw Error('Funding bridge did not expire when the physical remedy became affordable');

    reset(true);
    refuseCorrection = false;
    let maxEmptyStreak = 0, emptyStreak = 0;
    const progression = [];
    for (let day = 1; day <= 12; day++) {
      t.clockDay = day;
      const turn = await sitting();
      const progress = turn.executions.filter(row => ['started', 'done', 'queued'].includes(row.status) &&
        ['UPGRADE_RESOURCE', 'ACQUIRE_LAND', 'BOND_ISSUE', 'HIRE_WORKERS'].includes(row.intent));
      if (g.requiredAction && !progress.length) emptyStreak++; else emptyStreak = 0;
      maxEmptyStreak = Math.max(maxEmptyStreak, emptyStreak);
      progression.push({ day, remedy: progress, calls: turn.calls });
      t.growth.update(1296);
    }
    const remedyCount = progression.reduce((sum, day) => sum + day.remedy.length, 0);
    if (remedyCount < 3 || maxEmptyStreak > 1)
      throw Error(`Multi-day remedy chain stalled: ${JSON.stringify(progression)}`);
    return { stale, emergency, underway, crowded, capped, refused, allReports, fullContextTokens,
      financeBefore, financeAfter, finishedLevel: target.level, progression, maxEmptyStreak,
      auditOk: t.economy.audit().ok };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert(result.fullContextTokens <= 4000, 'Cabinet context exceeded budget');
  assert.equal(result.auditOk, true);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally { await browser.close(); }
