import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/?seed=1337', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.economy, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate('1337');
  const treasuryBefore = t.economy.treasury;
  const building = {
    id: 'staffing-public-factory',
    kind: 'factory', purpose: 'industrial',
    owner: 'state', ownerType: 'government', ownerId: 'government',
    factoryType: 'steelworks', floors: 4, capacity: 400,
    size: { w: 12, d: 10 },
    house: { spec: { factoryType: 'steelworks', floors: 4, capacity: 400, w: 12, d: 10 } }
  };
  t.buildings.push(building);
  t.economy.syncEntities();
  t.economy.assignEmployees();
  const firm = t.economy.businessesById.get(building.businessId);
  const workers = t.pedestrians.citizens.filter((citizen) => citizen.work === building);
  return {
    owner: building.owner,
    ownerType: building.ownerType,
    operator: firm?.operatorSector,
    employees: firm?.employees || 0,
    vacancies: firm?.vacancies || 0,
    workers: workers.length,
    treasuryUnchanged: Math.abs(treasuryBefore - t.economy.treasury) < 0.01,
    workerJobs: workers.map((citizen) => citizen.p.job?.work)
  };
});

const failures = [
  ...errors.map((message) => `page error: ${message}`),
  result.owner !== 'state' ? 'public factory ownership was rewritten' : null,
  result.ownerType !== 'government' ? 'public factory owner type was rewritten' : null,
  result.operator !== 'government' ? 'public factory operator was not government' : null,
  result.employees <= 0 || result.workers <= 0 ? 'public factory remained unstaffed' : null,
  result.workerJobs.some((work) => work !== 'industry') ? 'a public factory worker has a non-industry trade' : null,
  !result.treasuryUnchanged ? 'registering the public factory drained treasury startup capital' : null
].filter(Boolean);

console.log(JSON.stringify({ ok: failures.length === 0, result, failures }));
await browser.close();
if (failures.length) process.exit(1);
