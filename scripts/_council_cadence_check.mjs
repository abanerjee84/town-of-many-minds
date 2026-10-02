import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.town?.governance, null, { timeout: 60000 });

const result = await page.evaluate(async () => {
  const g = window.town.governance;
  const clock = (day, hour) => ({ day, hour });
  g.provider = { id: 'cadence-test', label: 'Cadence test', complete: async () => ({ text: 'NO_ACTION', model: 'cadence-test' }) };
  g.enabled = true;
  g.auto = true;
  const tick = async (day, hour) => {
    // The live render loop is also running on this page. Temporarily gate it
    // out so only this deterministic clock sequence can open a sitting.
    g.enabled = true;
    g.update(0, clock(day, hour));
    g.enabled = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  g.reset();
  g.provider = { id: 'cadence-test', label: 'Cadence test', complete: async () => ({ text: 'NO_ACTION', model: 'cadence-test' }) };
  g.enabled = true;
  g.auto = true;
  g.sittingsPerDay = 2;
  for (const [day, hour] of [[1, 7.5], [1, 12], [1, 18], [2, 0], [2, 6], [2, 12]]) await tick(day, hour);
  const twiceDaily = g.llmCalls;

  g.reset();
  g.provider = { id: 'cadence-test', label: 'Cadence test', complete: async () => ({ text: 'NO_ACTION', model: 'cadence-test' }) };
  g.enabled = true;
  g.auto = true;
  g.sittingsPerDay = 4;
  for (const [day, hour] of [[1, 7.5], [1, 12], [1, 18], [2, 0], [2, 6]]) await tick(day, hour);
  return { twiceDaily, fourDaily: g.llmCalls, cadenceHours: g.stats().cadenceHours };
});

const failures = [
  ...(result.twiceDaily !== 3 ? [`expected three calls across day-1 noon and day-2's two slots, got ${result.twiceDaily}`] : []),
  ...(result.fourDaily !== 4 ? [`expected four calls with four sittings/day, got ${result.fourDaily}`] : []),
  ...(result.cadenceHours !== 6 ? [`expected four-sitting cadence to be six hours, got ${result.cadenceHours}`] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
