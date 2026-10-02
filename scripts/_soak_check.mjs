import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// The scripted checks drive `economy.daily()` directly. This runs the REAL loop
// — the clock, growth, traffic, pedestrians, council — at 50x, and watches for
// the things that only break in motion: money leaking, the fleet drifting away
// from its entitlement, an audit that goes red, and vehicles piling up.
const PROBE = () =>
  new Promise((resolve) => {
    const t = window.town;
    const ec = t.economy;
    const reg = t.vehicles;
    const samples = [];
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (frames % 60 === 0) {
        const a = ec.audit();
        const s = reg.stats();
        samples.push({
          day: ec.lastDay,
          pop: t.pedestrians.citizens.length,
          priv: s.privateStock,
          target: s.target,
          fleet: s.stateStock,
          road: t.traffic.vehicles.length,
          stock: s.stock,
          onMarket: s.onMarket,
          leased: s.leased,
          treasury: Math.round(ec.treasury),
          cash: Math.round(ec.stats().householdCash),
          dep: Math.round(ec.stats().householdDeposits),
          auditOk: a.ok,
          gap: Math.round((a.unexpectedMoneyCreation || 0) * 100) / 100,
          ci: (a.creditInconsistencies || []).length,
          valid: t.validation?.ok !== false
        });
      }
      if (performance.now() - t0 < 45000) return requestAnimationFrame(tick);
      resolve({ samples, log: reg.log.slice(-8) });
    };
    requestAnimationFrame(tick);
  });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  await page.evaluate(() => { window.clock.speed = 50; });
  const r = await page.evaluate(PROBE);
  const s = r.samples;
  const auditEverRed = s.some((x) => !x.auditOk);
  const gap = Math.max(...s.map((x) => Math.abs(x.gap)));
  const overTarget = Math.max(...s.map((x) => x.priv - x.target - x.road));
  const last = s[s.length - 1];
  const problems = [];
  if (auditEverRed) problems.push('audit went red');
  if (gap > 1) problems.push(`money gap ${gap}`);
  if (s.some((x) => x.ci > 0)) problems.push('credit inconsistency');
  if (s.some((x) => !x.valid)) problems.push('town invalid');
  if (overTarget > 0) problems.push(`private stock over entitlement by ${overTarget}`);
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        day ${s[0].day}->${last.day}  pop ${s[0].pop}->${last.pop}  private stock ${last.priv}/${last.target}  fleet ${last.fleet}  on road ${last.road}  market ${last.onMarket}  leased ${last.leased}`);
  console.log(`        treasury $${s[0].treasury}->$${last.treasury}  wallet $${s[0].cash}->$${last.cash}  banked $${s[0].dep}->$${last.dep}  audit always ok: ${!auditEverRed}  maxGap ${gap}`);
  if (problems.length) console.log('   ', JSON.stringify(s.filter((x, i) => i % 6 === 0).slice(0, 10), null, 1).slice(0, 1500));
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 6) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
