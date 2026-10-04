import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.economy, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate('1337');
  const building = t.buildings.find((candidate) => candidate.kind === 'office') || {
    id: 'mobility-office', kind: 'office', purpose: 'commercial', owner: 'private',
    ownerType: 'developer', ownerId: 'developer', floors: 8, size: { w: 20, d: 20 }, cell: [14, 14]
  };
  if (!t.buildings.includes(building)) t.buildings.push(building);
  building.floors = Math.max(8, building.floors || 1);
  building.size = { w: 20, d: 20 };
  const candidate = t.pedestrians.citizens.find((citizen) =>
    citizen.p.age >= 18 && citizen.p.age < 66 && citizen.p.job?.id !== 'retired'
  );
  if (!candidate) throw new Error('no adult candidate for mobility check');
  candidate.work = null;
  candidate.p.education.level = 'secondary';
  candidate.p.job = { id: 'shopkeeper', label: 'Shopkeeper', work: 'shop' };
  candidate.p.employmentStatus = 'unemployed';
  t.economy.syncEntities();
  // This probe isolates private vacancy matching; civic staffing has its own
  // public-channel pass and is covered by the horizon evidence.
  t.economy.staffPublicCivic = () => 0;
  const adults = t.pedestrians.citizens.filter((citizen) => citizen.p.age >= 18 && citizen.p.age < 66);
  const before = { unemployment: adults.filter((citizen) => citizen.p.employmentStatus === 'unemployed').length / Math.max(1, adults.length) * 100 };
  t.economy.assignEmployees();
  const after = t.economy.stats();
  const office = t.economy.businesses.find((business) => business.building === building);
  return {
    beforeUnemployment: before.unemployment,
    afterUnemployment: after.unemployment,
    workerJob: candidate.p.job?.id,
    workerWork: candidate.work?.kind || null,
    officeEmployees: office?.employees || 0,
    officeVacancies: office?.vacancies || 0,
    retrained: after.employmentChannels?.retrained || 0,
    local: after.employmentChannels?.local || 0
  };
});

const failures = [
  ...errors.map((message) => `page error: ${message}`),
  !['officeclerk', 'accountant', 'designer'].includes(result.workerJob) ? 'unemployed resident was not retrained into a legal office role' : null,
  result.workerWork !== 'office' ? 'retrained resident was not posted to the office' : null,
  result.officeEmployees < 1 ? 'office vacancy remained unfilled' : null,
  result.retrained < 1 ? 'retraining channel was not recorded' : null,
  result.afterUnemployment >= result.beforeUnemployment ? 'local mobility did not reduce unemployment' : null
].filter(Boolean);

console.log(JSON.stringify({ ok: failures.length === 0, result, failures }));
await browser.close();
if (failures.length) process.exit(1);
