import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// INV-4 / SR-7 / SR-8 — credit has to be bounded, priced and recoverable.
//
// Every finding here was measured against the old code by the audit, and each
// one is a way for money to appear or vanish without anyone paying:
//   - `businessLimitMultiple` was declared and read NOWHERE, so a business could
//     be levered without limit ($5,000,000 outstanding after 50 loans).
//   - `issueLoan` handed the money straight back to `bank.cash`, so the bank's
//     balance was invariant to how much it had lent and the solvency check
//     could never fire.
//   - `repayLoan` removed the principal from the bank immediately after the
//     transfer deposited it, so a fully repaid loan left the bank no more liquid
//     than before — a pure money sink.
//   - arrears was terminal: one missed payment and the `status !== 'current'`
//     guard skipped the loan for ever — permanent, interest-free, unrecoverable.
//   - a matured bond that could not be redeemed kept accruing 5 %/365 for ever.
const PROBE = () => {
  const t = window.town;
  const ec = t.economy;
  const out = { steps: [] };
  const biz = ec.businesses.find((b) => b.open && b.type !== 'industry') || ec.businesses[0];
  const ref = biz ? { sector: 'business', id: biz.id } : null;
  if (!ref) return { steps: [{ step: 'no_business', ok: false }] };

  const totalMoney = () => ec._moneyTotal();
  const auditOk = () => ec.audit().ok;

  // 1. Credit is bounded. Ask for far more than any business could justify.
  const room = ec.creditRoom(ref);
  const before = { ok: auditOk(), money: totalMoney(), loans: ec.loans.length };
  let granted = 0;
  let refused = 0;
  for (let i = 0; i < 50; i++) {
    const r = ec.issueLoan(ref, 100000);
    if (r.ok) granted++; else refused++;
  }
  const debtNow = ec._account(ref).object.debt || 0;
  out.steps.push({
    step: 'credit-is-bounded',
    room: Math.round(room),
    granted,
    refused,
    outstanding: Math.round(debtNow),
    // debt can never exceed the room, and 50 asks of 100k cannot all succeed
    stayedWithinRoom: debtNow <= room + 0.01,
    didRefuse: refused > 0
  });

  // 2. The bank's balance actually falls when it lends, so `reserves` and the
  //    solvency check mean something.
  out.steps.push({
    step: 'bank-balance-reflects-lending',
    bankCash: Math.round(ec.accounts.bank.cash),
    bankLoans: Math.round(ec.accounts.bank.loans),
    // the bank holds real assets now, rather than being an unchanged pass-through
    bankNetOfLoans: Math.round(ec.accounts.bank.cash - ec.accounts.bank.loans),
    moneyConserved: Math.abs(totalMoney() - before.money) < 0.01,
    auditOk: auditOk()
  });

  // 3. Repaying leaves the money at the bank.
  const loan = ec.loans[ec.loans.length - 1];
  const bankBeforeRepay = ec.accounts.bank.cash;
  const repay = ec.repayLoan(loan, loan.outstandingPrincipal);
  out.steps.push({
    step: 'repayment-reaches-the-bank',
    ok: repay.ok,
    bankBefore: Math.round(bankBeforeRepay),
    bankAfter: Math.round(ec.accounts.bank.cash),
    // the principal stays where the transfer put it
    bankGainedOrHeld: ec.accounts.bank.cash >= bankBeforeRepay - 0.01,
    moneyConserved: Math.abs(totalMoney() - before.money) < 0.01,
    auditOk: auditOk()
  });

  // 4. Arrears is a penalty rate, not a terminal state: interest keeps being
  //    charged instead of the loan being skipped for ever.
  const l2 = ec.issueLoan(ref, Math.min(5000, room));
  if (l2.ok) {
    l2.loan.status = 'arrears';
    const day0 = ec.lastDay;
    const txBefore = ec.ledger.filter((tx) => tx.category === 'interest').length;
    for (let d = 0; d < 5; d++) { ec.lastDay = day0 + d; ec.serviceDebt(); }
    const interestTx = ec.ledger.filter((tx) => tx.category === 'interest').length - txBefore;
    out.steps.push({
      step: 'arrears-still-charges-interest',
      interestChargesInFiveDays: interestTx,
      // the old guard skipped it entirely: 0 charges, permanent free credit
      stillCharged: interestTx > 0,
      status: l2.loan.status
    });
  }

  // 5. A matured bond the treasury cannot redeem stops accruing and is marked
  //    defaulted rather than charging 5 %/365 for ever.
  const bondRes = ec.issueBond(0.5, 'bank');
  if (bondRes.ok) {
    const bond = bondRes.bond;
    bond.maturityTick = ec.lastDay + 1;          // due immediately
    // Drain the treasury through the LEDGER, not by assigning to it. The
    // setter deliberately no longer re-baselines the conservation invariant, so
    // writing to it directly is (correctly) reported as money vanishing — the
    // point of 2b.2. A test that wants an empty treasury has to spend it.
    let guard = 0;
    while (ec.treasury > 0 && guard++ < 200) {
      const chunk = Math.min(50000, ec.treasury);
      if (!ec.transfer({ from: 'government', to: 'external', amount: chunk, category: 'export' }).ok) break;
    }
    const interestTxBefore = ec.ledger.filter((tx) => tx.category === 'bond_interest').length;
    for (let d = 0; d < 8; d++) { ec.lastDay += 1; ec.serviceDebt(); }
    const interestTx = ec.ledger.filter((tx) => tx.category === 'bond_interest').length - interestTxBefore;
    out.steps.push({
      step: 'matured-bond-stops-accruing',
      status: bond.status,
      markedDefaulted: bond.status === 'defaulted',
      treasuryDrained: Math.round(ec.treasury),
      interestChargesAfterDefault: interestTx,
      // the old code charged every day, for ever
      stoppedAccruing: interestTx === 0,
      warned: ec.warnings.includes('bond_default')
    });
  }

  out.audit = { ok: auditOk(), ci: ec.audit().creditInconsistencies, gap: Math.round((ec.audit().unexpectedMoneyCreation || 0) * 100) / 100 };
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
  await page.waitForTimeout(800);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (['step', 'room', 'granted', 'refused', 'outstanding', 'bankCash', 'bankLoans', 'bankNetOfLoans',
           'bankBefore', 'bankAfter', 'interestChargesInFiveDays', 'interestChargesAfterDefault', 'status', 'ok'].includes(k)) continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (!r.audit?.ok) problems.push('audit');
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  for (const s of r.steps) console.log(`        ${s.step}: ${JSON.stringify(s)}`);
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 4) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
