import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.resources?.sites?.length, null, { timeout: 60000 });
await page.waitForTimeout(500);

const result = await page.evaluate(() => {
  window.town.generate(1337);
  const site = window.town.resources.sites.find((entry) => entry.kind === 'farm');
  if (!site) return { ok: false, reason: 'founding farm missing' };
  const firstDecision = window.town.governance.enact('INTENT: UPDATE_RESOURCE resource=food', 'test');
  const repeatedDecision = window.town.governance.enact('INTENT: UPDATE_RESOURCE resource=food', 'test');
  const upgraded = window.town.resources.upgrade('food', site);
  const feedback = document.getElementById('resource-feedback');
  return {
    firstDecision: { status: firstDecision.status, detail: firstDecision.detail },
    repeatedDecision: { status: repeatedDecision.status, detail: repeatedDecision.detail },
    upgraded,
    level: site.level,
    cells: site.cells.length,
    pulses: window.town.resources.feedbackPulses?.length || 0,
    eventVisible: !!feedback && !feedback.hidden,
    eventText: feedback?.textContent || '',
    evidencePanel: !!document.getElementById('council-feedback'),
    thought: document.getElementById('council-thought')?.textContent || '',
    learning: document.getElementById('council-learning')?.textContent || ''
  };
});

const failures = [
  ...(result.reason ? [result.reason] : []),
  ...(result.firstDecision?.status !== 'started' ? ['UPDATE_RESOURCE did not reach the resource procedure'] : []),
  ...(result.repeatedDecision?.detail?.includes('no procedure') ? ['repeated resource upgrade still reports no procedure'] : []),
  ...(result.upgraded !== true ? ['resource upgrade did not complete'] : []),
  ...(result.level !== 2 ? ['resource upgrade did not advance to tier 2'] : []),
  ...(result.cells !== 40 ? [`tier-2 farm yard is ${result.cells} cells, expected 40`] : []),
  ...(result.pulses < 1 ? ['resource upgrade did not create a world feedback pulse'] : []),
  ...(!result.eventVisible || !result.eventText.includes('UPDATE_RESOURCE') ? ['resource update HUD feedback is missing'] : []),
  ...(!result.evidencePanel ? ['Council evidence panel is missing'] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
