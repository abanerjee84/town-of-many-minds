import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.lifecycle && !!window.town?.policy, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate('1337');
  const citizen = t.pedestrians.citizens.find((candidate) => candidate.p.age >= 22 && candidate.p.age < 66);
  if (!citizen) throw new Error('no adult candidate for workforce training check');
  citizen.work = null;
  citizen.p.education = { level: 'none', field: '—', years: 0 };
  citizen.p.job = { id: 'student', label: 'Student', work: 'civic' };
  citizen.p.employmentStatus = 'unemployed';
  // The scheme precondition reads the economy's measured rate; this isolated
  // probe supplies the observed jobless signal without running a full day.
  t.economy.unemployment = 0.2;
  const enacted = t.policy.enactScheme('workforce_training', 1);
  for (let day = 0; day < 7; day++) t.lifecycle.runTraining();
  const stats = t.lifecycle.stats();
  return {
    enacted: enacted.ok,
    capacity: stats.training.capacity,
    completed: stats.training.completed,
    education: citizen.p.education.level,
    history: (citizen.p.history || []).some((entry) => String(entry?.text || entry).includes('government workforce training')),
    historyTail: (citizen.p.history || []).slice(-3)
  };
});

const failures = [
  ...errors.map((message) => `page error: ${message}`),
  !result.enacted ? 'workforce training scheme was not enacted' : null,
  result.capacity !== 2 ? 'training capacity modifier was not applied' : null,
  result.education !== 'primary' || result.completed < 1 ? 'unemployed adult did not complete the training rung' : null,
  !result.history ? 'training completion was not recorded in citizen history' : null
].filter(Boolean);

console.log(JSON.stringify({ ok: failures.length === 0, result, failures }));
await browser.close();
if (failures.length) process.exit(1);
