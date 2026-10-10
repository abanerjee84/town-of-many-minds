import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.resources);
  const result = await page.evaluate(async () => {
    window.clock.speed = 0;
    const t = window.town, e = t.economy;
    const { setJob } = await import('/src/kits/citizens/citizenProfile.js');
    const setup = () => {
      t.generate(1337); window.clock.speed = 0; t.governance.auto = false; t.clockDay = 955;
      for (const c of t.pedestrians.citizens) if (c.p?.job?.work === 'power') {
        c.work = null; setJob(c.p, 'assembler', e.rng); c.p.employmentStatus = 'unemployed';
      }
      e.transfer({ from: 'government', to: 'contractor', amount: e.treasury - 3634, category: 'transfer' });
      t.resources.levels.energy = 0; t.utilities.networks.power.expanded = 1; t.resources.syncProduction();
    };
    setup();
    const before = t.resources.stats().types.energy;
    const emergency = t.growth.resourceEmergency('energy');
    const report = t.governance.report();
    const treasuryBefore = e.treasury, populationBefore = t.pedestrians.citizens.length, sitesBefore = t.resources.sites.length;
    const decisions = ['UPGRADE_RESOURCE resource=energy', 'EXPAND_POWER', 'HIRE_WORKERS'].map(code => {
      const d = t.governance.enact(`INTENT: ${code}`, 'llm');
      return { intent: d.intent, status: d.status, detail: d.detail };
    });
    const after = t.resources.stats().types.energy;
    const staffing = [...t.resources.activeSiteWorkers()].filter(([s]) => s.work === 'power').map(([s, have]) => ({ have, need: t.resources.siteCrew(s) }));
    const workers = t.pedestrians.citizens.filter(c => c.work?.site?.work === 'power');
    const ledgerStart = e.ledger.length;
    for (const c of workers) e.payWage(c, c.p.income / 365, { sector: 'business', id: 'contractor' });
    const wages = e.ledger.slice(ledgerStart).filter(row => row.category === 'wage');
    t.resources.syncProduction(); t.resources.lastDay=955; t.resources.update({ day:956, speed:0 },0);
    const resumedStore = t.resources.levels.energy;
    const cleared = t.growth.resourceEmergency('energy');
    const firstPowerDoor = workers[0].work;
    for (const c of workers) c.work = firstPowerDoor;
    const legacyOutput = t.resources.stats().types.energy.production;
    e.assignEmployees();
    const repairedLegacyOutput = t.resources.stats().types.energy.production;
    const funded = { beforeOutput: before.production, afterOutput: after.production, rated: t.resources.ratedProduction().energy,
      emergency, decisions, reportHasRemedy: report.includes('INTENT: HIRE_WORKERS resource=energy'),
      publicHiringBlocked: !e.publicPayrollCanExpand(), populationDelta: t.pedestrians.citizens.length - populationBefore,
      sitesDelta: t.resources.sites.length - sitesBefore, treasuryBefore, treasuryAfter: e.treasury,
      staffing, operatorPaidWages: wages.length, wagePayers: wages.map(row => row.from.id), resumedStore, cleared,
      legacyOutput, repairedLegacyOutput, audit: e.audit().ok };
    setup();
    let providerCalls = 0;
    t.governance.setProvider({ id:'energy-recovery-regression', complete: async ({ department }) => {
      providerCalls++;
      return { text: JSON.stringify(department === 'council' ? { selected:[{ id:'motion-1', priority:1 }] }
        : { motions:[{ department, intent:department === 'treasury' ? 'HIRE_WORKERS' : 'NO_ACTION', priority:1, reason:'restore measured power crew' }] }) };
    } });
    await t.governance.ask();
    const cabinet = { providerCalls, output:t.resources.stats().types.energy.production,
      executions:t.governance.cabinet.lastExecution.map(row => ({ intent:row.intent, status:row.status })), pending:t.governance.pending };
    setup();
    e.transfer({ from: 'contractor', to: 'external', amount: e.accounts.contractor.cash, category: 'transfer' });
    const unfundedNeed = t.resources.staffingRecovery('energy');
    const unfundedDecision = t.governance.enact('INTENT: HIRE_WORKERS', 'llm');
    const unfunded = { need: unfundedNeed, output: t.resources.stats().types.energy.production,
      status: unfundedDecision.status, detail: unfundedDecision.detail, operatorCash: e.accounts.contractor.cash,
      emergency: t.growth.resourceEmergency('energy'), audit: e.audit().ok };
    setup();
    for (const c of t.pedestrians.citizens) if (!c.work) c.p.education.level = 'primary';
    const inaccessible = { need: t.resources.staffingRecovery('energy'), emergency: t.growth.resourceEmergency('energy') };
    // A controlled spare-housing fixture exercises the explicit newcomer path,
    // with no qualified locals and the ordinary three-person action limit.
    t.buildings.find(b => b.kind === 'house').capacity += 3;
    const arrivalsBefore = t.pedestrians.citizens.length;
    const recruited = t.governance.enact('INTENT: HIRE_WORKERS', 'llm');
    const newcomers = { status:recruited.status, detail:recruited.detail,
      arrivals:t.pedestrians.citizens.length-arrivalsBefore, output:t.resources.stats().types.energy.production, audit:e.audit().ok };
    // Fit only one extra power wage in the actual operator account. Subsequent
    // candidates must reserve against the first hire, not the same initial cash.
    setup();
    const lift = 1 + (e.policyStaffPay || 0);
    const base = t.pedestrians.citizens.filter(c => c.work?.site?.connected).reduce((sum, c) => sum + c.p.income / 365 * lift, 0);
    const budget = base + Math.ceil(43000 * 1.15) / 365 * lift;
    e.transfer({ from: 'contractor', to: 'external', amount: e.accounts.contractor.cash - budget, category: 'transfer' });
    t.pedestrians.staffWorkforce();
    const limited = { power: t.resources.staffCounts().power, payrollCanExpand: e.resourcePayrollCanExpand('powerworker'), audit: e.audit().ok };
    return { funded, cabinet, unfunded, inaccessible, newcomers, limited };
  });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  assert.equal(result.funded.beforeOutput, 0);
  assert.equal(result.funded.emergency?.intent, 'HIRE_WORKERS');
  assert.ok(result.funded.reportHasRemedy);
  assert.equal(result.funded.decisions[2].status, 'done');
  assert.equal(result.funded.afterOutput, result.funded.rated);
  assert.equal(result.funded.populationDelta, 0);
  assert.equal(result.funded.sitesDelta, 0);
  assert.ok(result.funded.publicHiringBlocked);
  assert.ok(result.funded.staffing.every(row => row.have === row.need));
  assert.equal(result.funded.operatorPaidWages, 3);
  assert.ok(result.funded.wagePayers.every(id => id === 'contractor'));
  assert.ok(result.funded.resumedStore > 0);
  assert.equal(result.funded.cleared, null);
  assert.ok(result.funded.legacyOutput < result.funded.rated);
  assert.equal(result.funded.repairedLegacyOutput, result.funded.rated);
  assert.equal(result.cabinet.providerCalls, 6);
  assert.equal(result.cabinet.output, result.funded.rated);
  assert.ok(result.cabinet.executions.some(row => row.intent === 'HIRE_WORKERS' && row.status === 'done'));
  assert.equal(result.cabinet.pending, false);
  assert.equal(result.unfunded.output, 0);
  assert.match(result.unfunded.detail, /operator.*payroll.*unfunded/);
  assert.equal(result.unfunded.operatorCash, 0);
  assert.equal(result.unfunded.emergency, null);
  assert.equal(result.inaccessible.need.locals, 0);
  assert.equal(result.inaccessible.need.spareBeds, 0);
  assert.equal(result.inaccessible.emergency, null);
  assert.equal(result.newcomers.status, 'done');
  assert.equal(result.newcomers.arrivals, 3);
  assert.equal(result.newcomers.output, result.funded.rated);
  assert.ok(result.newcomers.audit);
  assert.equal(result.limited.power, 1);
  assert.equal(result.limited.payrollCanExpand, false);
  assert.ok(result.funded.audit && result.unfunded.audit && result.limited.audit);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
