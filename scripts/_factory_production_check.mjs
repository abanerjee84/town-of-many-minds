import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.industry, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate(1337);
  const make = (capacity, floors, factoryType = 'sawmill') => ({
    kind: 'factory', purpose: 'industrial', capacity, floors,
    house: { spec: { factoryType, floors, capacity } }
  });
  const small = make(400, 2);
  const double = make(800, 2);
  const tall = make(1200, 4);
  const beforeBonus = t.industry.outputBonus;
  const rows = {
    small: t.industry.describe(small),
    double: t.industry.describe(double),
    tall: t.industry.describe(tall)
  };
  t.industry.outputBonus = 0.25;
  const bonus = t.industry.describe(double);
  t.industry.outputBonus = beforeBonus;
  const labour = {
    empty: t.industry.factoryLabourFactor({ employees: 0, jobsRequired: 24, status: 'active' }),
    starter: t.industry.factoryLabourFactor({ employees: 2, jobsRequired: 24, status: 'active' }),
    full: t.industry.factoryLabourFactor({ employees: 24, jobsRequired: 24, status: 'active' }),
    arrears: t.industry.factoryLabourFactor({ employees: 24, jobsRequired: 24, status: 'payroll_arrears' })
  };
  return {
    rows,
    bonus,
    labour,
    ratios: {
      doubleToSmall: rows.double.rate / rows.small.rate,
      tallToSmall: rows.tall.rate / rows.small.rate
    }
  };
});

if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
const { rows, ratios, bonus, labour } = result;
  if (rows.small.factoryCapacity !== 400 || rows.double.factoryCapacity !== 800 || rows.tall.factoryCapacity !== 1200 ||
      Math.abs(ratios.doubleToSmall - 2) > 0.05 || Math.abs(ratios.tallToSmall - 3) > 0.05) {
  throw new Error(`factory capacity is not proportional: ${JSON.stringify(result)}`);
}
if (bonus.rate !== Math.round(rows.double.rate * 1.25)) {
  throw new Error(`factory output bonus did not scale rated output: ${JSON.stringify(result)}`);
}
if (labour.empty !== 0 || labour.starter <= 2 / 24 || labour.full !== 1 || labour.arrears !== 0) {
  throw new Error(`factory staffed minimum is not bounded: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result));
await browser.close();
