import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// The state half of the vehicle rules: a government buys a unit whenever a
// documented shortfall requires it, and it has to be paid for. The private
// market is capped by population; the state is not — but the state cannot print
// money either, so an empty treasury means no unit.
//
// This drives population directly (the private market's whole input is
// population, and the funding rules only bite at scale) rather than waiting for
// the town to grow, which takes far longer than a check should run.
const PROBE = () => {
  const t = window.town;
  const reg = t.vehicles;
  const ec = t.economy;
  const out = { steps: [], phases: [] };

  // Grow the population by admitting citizens, so the entitlement rises and the
  // shortfall rules come into range.
  const grow = (to) => {
    let guard = 0;
    while (t.pedestrians.citizens.length < to && guard++ < 400) {
      if (!t.pedestrians.spawn(1)) break;
    }
    ec.rebuild();
    for (const c of t.pedestrians.citizens) ec.ensureCitizenFinance(c.p);
  };

  const fleetCount = (unit) => reg.slots.filter((s) => s.owner?.sector === 'government' && s.unit === unit).length;

  // 1. founding fleet exists and is funded
  out.steps.push({
    step: 'founding-fleet',
    units: reg.slots.filter((s) => s.owner?.sector === 'government').map((s) => s.unit),
    funded: reg.treasurySpend > 0,
    police: fleetCount('Police'), ambulance: fleetCount('Ambulance'), fire: fleetCount('Fire')
  });

  // 2. grow past every shortfall threshold and watch the state respond
  const trajectory = [];
  for (const target of [60, 120, 180, 240, 300]) {
    grow(target);
    const before = { police: fleetCount('Police'), amb: fleetCount('Ambulance'), fire: fleetCount('Fire'), spend: Math.round(reg.treasurySpend), treasury: Math.round(ec.treasury) };
    const shortfalls = reg.stateShortfall().map((s) => `${s.unit}:${s.reason}`);
    reg.settleMarket();
    const after = { police: fleetCount('Police'), amb: fleetCount('Ambulance'), fire: fleetCount('Fire'), spend: Math.round(reg.treasurySpend), treasury: Math.round(ec.treasury) };
    trajectory.push({
      pop: t.pedestrians.citizens.length,
      shortfalls,
      unitsBefore: `${before.police}P/${before.amb}A/${before.fire}F`,
      unitsAfter: `${after.police}P/${after.amb}A/${after.fire}F`,
      spent: after.spend - before.spend,
      treasury: after.treasury
    });
  }
  out.steps.push({ step: 'state-answers-shortfalls', trajectory, grew: trajectory.some((x) => x.unitsAfter !== x.unitsBefore) });

  // 3. every state unit was paid for out of the treasury — the fleet is a
  //    balance-sheet item, not free scenery
  const stateSlots = reg.slots.filter((s) => s.owner?.sector === 'government');
  out.steps.push({
    step: 'state-fleet-is-funded',
    units: stateSlots.length,
    allPaid: stateSlots.every((s) => (s.paid || 0) > 0),
    totalSpent: Math.round(reg.treasurySpend),
    bookValue: reg.stateAssets()
  });

  // 4. an empty treasury must stop the state buying — the rule is "whenever
  //    required", not "whenever required regardless of means".
  //    The treasury is drained THROUGH THE LEDGER, not by assigning to it: the
  //    setter deliberately no longer re-baselines the conservation invariant
  //    (2b.2), so writing to it directly is correctly reported as money
  //    appearing from nowhere. A test that wants a broke town spends the money.
  //    Each kind is then asked for directly, so this exercises the funding rule
  //    even when coverage has already been satisfied.
  let guard = 0;
  while (ec.treasury > 10 && guard++ < 400) {
    const chunk = Math.min(50000, ec.treasury - 10);
    if (chunk <= 0) break;
    if (!ec.transfer({ from: 'government', to: 'external', amount: chunk, category: 'export' }).ok) break;
  }
  const beforeCount = reg.slots.length;
  const asked = ['police', 'ambulance', 'fire', 'utility'].map((type) => {
    const res = reg.procure(type, { reason: 'forced test' });
    return `${type}:${res.ok ? 'BOUGHT' : res.reason}`;
  });
  out.steps.push({
    step: 'broke-state-cannot-buy',
    treasury: Math.round(ec.treasury),
    outcomes: asked,
    nothingBought: reg.slots.length === beforeCount,
    stockUnchanged: reg.slots.length === beforeCount
  });

  // 5. audit after all of that
  const audit = ec.audit();
  out.audit = {
    ok: audit.ok,
    unexpectedMoney: Math.round((audit.unexpectedMoneyCreation || 0) * 100) / 100,
    creditInconsistencies: audit.creditInconsistencies
  };
  return out;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (['step', 'units', 'trajectory', 'funded', 'police', 'ambulance', 'fire', 'totalSpent', 'bookValue', 'treasury', 'shortfalls', 'outcomes', 'pop'].includes(k)) continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (!r.audit.ok) problems.push('audit');
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  if (problems.length) console.log('   ', JSON.stringify(r, null, 1).slice(0, 2200));
  else {
    const tr = r.steps.find((x) => x.step === 'state-answers-shortfalls').trajectory;
    console.log(`        ${tr.map((x) => `pop${x.pop} ${x.unitsBefore}->${x.unitsAfter} (-$${x.spent})`).join('  ')}`);
    const broke = r.steps.find((x) => x.step === 'broke-state-cannot-buy');
    console.log(`        broke state: ${broke.outcomes.join(', ') || 'no shortfall outstanding'}`);
  }
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
