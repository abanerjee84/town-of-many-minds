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
  const fourDaily = g.llmCalls;
  const fourDailyCadenceHours = g.stats().cadenceHours;

  // The Council should receive a time-weighted congestion interval rather than
  // the one instantaneous value present on the sitting frame. Disable model
  // calls for this deterministic evidence probe and feed three one-hour
  // samples between two twice-daily sitting boundaries.
  g.reset();
  g.enabled = true;
  g.auto = false;
  g.sittingsPerDay = 2;
  const congestionSample = (value, dt, day, hour) => {
    window.town.traffic.congestion = value;
    g.update(dt, clock(day, hour));
  };
  congestionSample(0.2, 3600, 1, 7.5);
  congestionSample(0.8, 3600, 1, 8.5);
  congestionSample(0.4, 3600, 1, 12);
  const congestion = g.congestionEvidence();
  const report = g.report();
  const originalRoadSelector = window.town.growth.selectRoadExtension;
  window.town.growth.selectRoadExtension = () => ({ cells: [[1, 1], [2, 1], [3, 1]], reason: 'cadence test' });
  window.town.traffic.congestion = 0.8;
  g.lastCongestionInterval = {
    average: 0.8, instantaneous: 0.8, min: 0.2, max: 0.8,
    samples: 3, intervalHours: 3, from: null, to: null
  };
  const ranked = window.town.growth.ranked();
  const topRank = ranked[0]?.type || null;
  window.town.growth.selectRoadExtension = originalRoadSelector;
  g.enabled = false;
  return {
    twiceDaily,
    fourDaily,
    cadenceHours: fourDailyCadenceHours,
    congestion,
    reportHasAverage: /Congestion average 47% over 3h/.test(report),
    topRank
  };
});

const failures = [
  ...(result.twiceDaily !== 15 ? [`expected five minister calls across three sittings, got ${result.twiceDaily}`] : []),
  ...(result.fourDaily !== 20 ? [`expected five minister calls across four sittings, got ${result.fourDaily}`] : []),
  ...(result.cadenceHours !== 6 ? [`expected four-sitting cadence to be six hours, got ${result.cadenceHours}`] : []),
  ...(Math.abs(result.congestion?.average - 0.467) > 0.002 ? [`expected time-weighted congestion average near 0.467, got ${result.congestion?.average}`] : []),
  ...(result.congestion?.samples !== 3 ? [`expected three interval samples, got ${result.congestion?.samples}`] : []),
  ...(result.congestion?.intervalHours !== 3 ? [`expected three game hours in the interval, got ${result.congestion?.intervalHours}`] : []),
  ...(!result.reportHasAverage ? ['Council report did not present the closed congestion average'] : []),
  ...(result.topRank !== 'road' ? [`expected EXTEND_STREET to outrank other gates under congestion, got ${result.topRank}`] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
