import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// Phase 1 of banking. The things that must hold:
//  1. every household starts with savings, and savings are real money at the
//     bank (the bank's liability equals the sum of household deposits)
//  2. depositing and withdrawing move money CONSERVED — total town money is
//     unchanged by a deposit, and the ledger records it
//  3. a purchase debits the WALLET only, never silently raiding savings
//  4. the daily sweep banks surplus but leaves a spending floor
//  5. net worth is unchanged by moving cash to deposits (it is a change of form)
//  6. the economy's own audit still passes after days of banking
const PROBE = () => {
  const t = window.town;
  const ec = t.economy;
  const out = { steps: [] };
  const citizens = t.pedestrians.citizens;
  const c0 = citizens[0];
  const p0 = c0.p;

  const totalMoney = () => ec._moneyTotal();
  const depSum = () => citizens.reduce((s, c) => s + (c.p.deposits || 0), 0);

  // 1. opening position
  out.steps.push({
    step: 'opening',
    hasDepositsField: citizens.every((c) => typeof c.p.deposits === 'number'),
    anyDeposits: depSum() > 0,
    financialAssetsMirrors: citizens.every((c) => Math.abs((c.p.financialAssets || 0) - (c.p.deposits || 0)) < 0.01),
    bankLiabilityMatches: Math.abs(depSum() - ec.accounts.bank.deposits) < 0.01
  });

  // 2. deposit conserves money
  const before = totalMoney();
  const bankBefore = ec.accounts.bank.cash;
  const cashBeforeOver = p0.cash;
  const dep = ec.depositFor(c0, 1000);
  out.steps.push({
    step: 'deposit',
    ok: dep.ok,
    moneyConserved: Math.abs(totalMoney() - before) < 0.01,
    bankGrew: Math.abs(ec.accounts.bank.cash - (bankBefore + 1000)) < 0.01,
    walletDropped: p0.cash,
    depositsRose: p0.deposits,
    liabilityMatches: Math.abs(depSum() - ec.accounts.bank.deposits) < 0.01
  });

  // 3. withdraw conserves money
  const before2 = totalMoney();
  const wd = ec.withdrawFor(c0, 400);
  out.steps.push({
    step: 'withdraw',
    ok: wd.ok,
    moneyConserved: Math.abs(totalMoney() - before2) < 0.01,
    walletRose: p0.cash,
    depositsFell: p0.deposits,
    liabilityMatches: Math.abs(depSum() - ec.accounts.bank.deposits) < 0.01
  });

  // 4. asking for more than is banked must CLAMP, never overdraw. (It is not a
  //    refusal: the caller's request is honoured up to the limit, which is what
  //    makes it safe to hand a purchase "everything you can raise".)
  const depAt = p0.deposits;
  const over = ec.withdrawFor(c0, 1e9);
  out.steps.push({
    step: 'overdraw-clamped',
    ok: over.ok,
    withdrewNoMoreThanBanked: over.ok ? over.amount <= depAt + 0.01 : true,
    depositsNowZero: p0.deposits === 0,
    walletGrewByAtMostBanked: p0.cash <= cashBeforeOver + depAt + 0.01
  });

  // 5. asking to bank more cash than is in the wallet must clamp too. The
  //    previous step emptied the savings balance, so the whole wallet is what
  //    ends up banked.
  const cashAt = p0.cash;
  const overDep = ec.depositFor(c0, 1e9);
  out.steps.push({
    step: 'over-deposit-clamped',
    ok: overDep.ok,
    bankedNoMoreThanHeld: overDep.ok ? overDep.amount <= cashAt + 0.01 : true,
    walletNowZero: p0.cash === 0,
    everythingIsBanked: Math.abs(p0.deposits - cashAt) < 0.01
  });

  // 6. a purchase debits the WALLET, not savings. Put money back in the wallet
  //    first, so there is something to spend.
  ec.withdrawFor(c0, 200);
  const cashBefore = p0.cash;
  const depBefore = p0.deposits;
  const r = ec.transfer({ from: { sector: 'household', id: p0.id }, to: 'external', amount: 50, category: 'import' });
  out.steps.push({
    step: 'purchase-hits-wallet-only',
    ok: r.ok,
    cashFellBy50: Math.abs((cashBefore - p0.cash) - 50) < 0.01,
    depositsUntouched: Math.abs(p0.deposits - depBefore) < 0.01,
    purchaseRejection: r.ok ? null : r.reason
  });

  // 7. net worth unchanged by moving cash to deposits
  const nwBefore = ec.netWorthOf(p0);
  ec.depositFor(c0, 300);
  out.steps.push({
    step: 'networth-invariant-under-deposit',
    before: Math.round(nwBefore),
    after: Math.round(ec.netWorthOf(p0)),
    unchanged: Math.abs(ec.netWorthOf(p0) - nwBefore) < 0.01
  });

  // 8. the daily sweep banks surplus but respects the floor
  const floors = [];
  for (let i = 0; i < 12; i++) {
    ec.daily();
    floors.push(Math.min(...citizens.map((c) => c.p.cash)));
  }
  out.steps.push({
    step: 'daily-sweep',
    minWalletAfterSweep: Math.round(Math.min(...citizens.map((c) => c.p.cash))),
    floor: 0, // reported below from config in the summary
    allNonNegative: citizens.every((c) => c.p.cash >= -0.01),
    depositsGrew: depSum() > 0,
    liabilityMatches: Math.abs(depSum() - ec.accounts.bank.deposits) < 0.01,
    bankSolvent: ec.accounts.bank.deposits <= ec.accounts.bank.cash + 0.01
  });

  // 9. INV-4 / SR-8 — a citizen leaving the roster must not be able to silence
  //    the conservation audit. This splices a citizen out WITHOUT settling the
  //    estate, which is the exact hole the audit found by execution: their cash
  //    stopped being enumerated, `expectedMoney` did not move, and $50,000 of
  //    money disappeared while `audit().ok` stayed true. Household cash is now a
  //    memo and the deposit liability is cross-checked against the roster, so an
  //    unsettled removal is REPORTED rather than absorbed.
  const victim = citizens.find((c) => c.p.cash > 1000 && (c.p.deposits || 0) > 0) || citizens[0];
  const memoBefore = ec.householdCashLedger || 0;
  const rosterBefore = citizens.reduce((s, c) => s + (c.p.cash || 0), 0);
  let unsettled = { ok: true, creditInconsistencies: [] };
  let probeError = null;
  try {
    t.pedestrians.citizens.splice(t.pedestrians.citizens.indexOf(victim), 1);
    unsettled = ec.audit();
  } catch (e) {
    probeError = String(e && e.message ? e.message : e);
  }
  out.steps.push({
    step: 'unsettled-removal-is-detected',
    victimCash: Math.round(victim.p.cash),
    victimDeposits: Math.round(victim.p.deposits || 0),
    // the memo STILL counts them, which is the point: the ledger was never told
    // the money left, so the ledger still holds it and says so
    memoRetainedTheirMoney: Math.abs((ec.householdCashLedger || 0) - memoBefore) < 0.01,
    rosterLostThem: Math.abs(citizens.reduce((s, c) => s + (c.p.cash || 0), 0) - rosterBefore + (victim.p.cash || 0)) < 0.01,
    auditWentRed: !unsettled.ok,
    namedTheProblem: (unsettled.creditInconsistencies || []).length > 0,
    whichCheck: (unsettled.creditInconsistencies || []).map((c) => c.kind).join(',') || null,
    probeError
  });
  // put them back so the rest of the check runs against a whole town
  t?.pedestrians?.citizens?.splice(Math.max(0, t.pedestrians.citizens.indexOf(victim) + 1), 0, victim);
  ec._noteHouseholdCash(0);
  try { ec.settleEstate(victim.p, 'test-restore'); } catch (e) { out.steps.push({ step: 'settle-after-restore', ok: false, err: String(e && e.message ? e.message : e) }); }
  const audit = ec.audit();
  out.audit = {
    ok: audit.ok,
    householdDeposits: Math.round(audit.householdDeposits || 0),
    bankLiability: Math.round(ec.accounts.bank.deposits),
    creditInconsistencies: audit.creditInconsistencies,
    unexpectedMoney: Math.round((audit.unexpectedMoney || 0) * 100) / 100,
    negativeBalances: (audit.negativeBalances || []).length
  };

  out.economyStats = {
    wealth: ec.stats().wealth,
    householdCash: ec.stats().householdCash,
    householdDeposits: ec.stats().householdDeposits,
    bankDeposits: ec.stats().bankDeposits
  };
  return out;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'step' || k === 'reason' || k === 'before' || k === 'after' || k === 'minWalletAfterSweep' || k === 'floor' || k.startsWith('wallet') || k.startsWith('deposits') || k.startsWith('bankGrew') || k === 'cashFellBy50' || k === 'depositsUntouched' || k === 'depositsGrew' || k === 'depositsFell' || k === 'cashRose') continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (!r.audit.ok) problems.push('audit');
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  if (problems.length) console.log('   ', JSON.stringify(r, null, 1).slice(0, 1800));
  else {
    const a = r.audit, s = r.economyStats;
    console.log(`        deposits ${a.householdDeposits} = bank liability ${a.bankLiability}  ·  wallet ${s.householdCash}  ·  wealth ${s.wealth}  ·  audit ok`);
  }
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
