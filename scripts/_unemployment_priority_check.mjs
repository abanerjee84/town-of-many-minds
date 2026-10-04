import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.governance && !!window.town?.lifecycle, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate('1337');
  const citizen = t.pedestrians.citizens.find((candidate) => candidate.p.age >= 22 && candidate.p.age < 66);
  if (!citizen) throw new Error('no adult candidate for unemployment priority check');
  citizen.work = null;
  citizen.p.education = { level: 'none', field: '—', years: 0 };
  citizen.p.job = { id: 'student', label: 'Student', work: 'civic' };
  citizen.p.employmentStatus = 'unemployed';
  t.economy.unemployment = 0.24;
  // Isolate the contradiction shown in the UI: all existing posts are full,
  // but local unemployment is already above the remedy gate.
  t.governance.staffNeed = () => ({
    gap: 0,
    want: { farm: 3, power: 4, fuel: 1 },
    staff: { farm: 3, power: 4, fuel: 1 },
    biz: { have: 6, need: 6 },
    civic: { filled: 0, need: 0, open: 0 }
  });
  const decision = t.governance.hire({ intent: 'HIRE_WORKERS', source: 'test', status: 'started' });
  const report = t.governance.report();
  return {
    status: decision.status,
    detail: decision.detail,
    hireBlockedInReport: report.includes('HIRE_WORKERS blocked'),
    trainingShown: report.includes('WORKFORCE_TRAINING')
  };
});

const failures = [
  ...errors.map((message) => `page error: ${message}`),
  result.status !== 'rejected' ? 'high-unemployment HIRE_WORKERS was not rejected' : null,
  !String(result.detail).includes('no staffed vacancy') ? 'rejection did not explain the vacancy mismatch' : null,
  !result.hireBlockedInReport ? 'Council report did not mark HIRE_WORKERS as blocked' : null,
  !result.trainingShown ? 'Council report did not expose workforce training' : null
].filter(Boolean);

console.log(JSON.stringify({ ok: failures.length === 0, result, failures }));
await browser.close();
if (failures.length) process.exit(1);
