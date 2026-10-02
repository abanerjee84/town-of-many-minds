import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7'];

// The long horizon. Population is the ONLY input to the private vehicle
// entitlement, so the rule "the number of vehicles follows the population" can
// only be tested by actually growing the town. This drives growth and the
// economy together for 300 days and watches the stock track the people.
const PROBE = () => {
  const t = window.town;
  const ec = t.economy;
  const reg = t.vehicles;
  const growth = t.growth;

  const timeline = [];
  let worstOver = -Infinity;
  let auditEverRed = false;
  let maxGap = 0;
  let deliveryFailures = 0;

  for (let day = 0; day < 300; day++) {
    // Let the town build for a while, then settle the economy for a day.
    if (day % 3 === 0) {
      const plan = growth.evaluate();
      if (plan) growth.apply(plan);
    }
    ec.daily();
    // Run traffic for a step so vehicles actually move and get re-homed.
    t.traffic.runShared(0.4, { hour: 9, daylight: 1, day: ec.lastDay, speed: 1 });

    const s = reg.stats();
    const over = s.privateStock - reg.privateCeiling();
    worstOver = Math.max(worstOver, over);
    const a = ec.audit();
    if (!a.ok) auditEverRed = true;
    maxGap = Math.max(maxGap, Math.abs(a.unexpectedMoneyCreation || 0));

    if (day % 40 === 0 || day === 299) {
      timeline.push({
        day,
        pop: s.population,
        priv: s.privateStock,
        target: s.target,
        fleet: s.stateStock,
        road: t.traffic.vehicles.length,
        market: s.onMarket,
        leased: s.leased,
        bldg: t.buildings.length,
        turnover: s.turnover,
        householdSpend: s.householdSpend,
        treasurySpend: s.treasurySpend,
        treasury: Math.round(ec.treasury)
      });
    }
  }

  const s = reg.stats();
  return {
    timeline,
    worstOver,
    auditEverRed,
    maxGap: Math.round(maxGap * 100) / 100,
    deliveryFailures,
    final: {
      pop: s.population, priv: s.privateStock, target: s.target, fleet: s.stateStock,
      road: t.traffic.vehicles.length, market: s.onMarket, leased: s.leased,
      perCapita: s.privateStock / Math.max(1, s.population),
      turnover: s.turnover,
      maxSalesOnOneVehicle: Math.max(0, ...reg.slots.map((x) => x.purchases || 0))
    },
    log: reg.log.slice(-6).map((l) => l.text)
  };
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
  if (r.auditEverRed) problems.push('audit went red');
  if (r.maxGap > 1) problems.push(`money gap ${r.maxGap}`);
  if (r.worstOver > 0) problems.push(`stock over ceiling by ${r.worstOver}`);
  if (r.final.maxSalesOnOneVehicle > 60) problems.push(`resale runaway (${r.final.maxSalesOnOneVehicle} sales on one vehicle)`);
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  if (problems.length) console.log('   ', JSON.stringify(r, null, 1).slice(0, 2000));
  console.log('        ' + r.timeline.map((x) => `d${x.day} pop${x.pop} priv${x.priv}/${x.target} fleet${x.fleet} road${x.road} bldg${x.bldg}`).join('\n        '));
  console.log(`        final: ${r.final.perCapita.toFixed(3)} private/cap · turnover ${r.final.turnover} · max sales on one vehicle ${r.final.maxSalesOnOneVehicle} · audit ever red: ${r.auditEverRed} · maxGap ${r.maxGap}`);
  console.log(`        recent: ${r.log.join(' | ')}`);
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
