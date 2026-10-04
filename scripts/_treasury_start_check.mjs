import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];
const TARGET = 1_000_000;

// The day-one contract is deliberately checked at three points: immediately
// after generation (after founding assets and opening capitalization), after a
// day-one tick that must not settle the economy, and after a day boundary that
// proves normal economics still runs afterwards.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.economy && !!window.clock, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.clock.speed = 0;
    document.getElementById('speed-0')?.click();
  });

  const results = [];
  for (const seed of SEEDS) {
    const result = await page.evaluate((value) => {
      window.clock.speed = 0;
      window.town.generate(value);
      const economy = window.town.economy;
      const openingTransaction = economy.ledger.find((tx) => tx.category === 'opening_capitalization');
      const opening = economy.treasury;
      const dayOneBefore = economy.lastDay;
      economy.update(0.1, { day: 1, hour: 6 });
      const afterDayOneTick = economy.treasury;
      const dayOneLastDay = economy.lastDay;
      economy.update(0.1, { day: 2, hour: 0 });
      const afterBoundary = economy.treasury;
      const dayTwoLastDay = economy.lastDay;
      return {
        seed: value,
        opening,
        afterDayOneTick,
        afterBoundary,
        dayOneBefore,
        dayOneLastDay,
        dailySettled: dayTwoLastDay === 2,
        dayTwoLastDay,
        capitalization: openingTransaction ? {
          amount: openingTransaction.amount,
          from: openingTransaction.from,
          to: openingTransaction.to,
          category: openingTransaction.category
        } : null,
        auditOk: economy.audit().ok
      };
    }, seed);
    results.push(result);
  }

  const failures = [];
  for (const result of results) {
    if (Math.abs(result.opening - TARGET) > 0.01) failures.push(`${result.seed}: opening treasury ${result.opening}`);
    if (Math.abs(result.afterDayOneTick - TARGET) > 0.01) failures.push(`${result.seed}: day-one tick changed treasury to ${result.afterDayOneTick}`);
    if (!result.dailySettled || result.dayTwoLastDay !== 2) failures.push(`${result.seed}: day boundary did not settle`);
    if (!result.capitalization || result.capitalization.category !== 'opening_capitalization') failures.push(`${result.seed}: missing opening capitalization`);
    if (!result.auditOk) failures.push(`${result.seed}: economy audit failed`);
  }
  failures.push(...pageErrors.map((message) => `page error: ${message}`));

  console.log(JSON.stringify({ ok: failures.length === 0, target: TARGET, results, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
