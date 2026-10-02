import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.governance);

const result = await page.evaluate(async () => {
  const t = window.town;
  const g = t.governance;
  g.auto = false;
  t.generate('governor-regression');
  g.auto = false;

  for (let i = 0; i < 40; i++) g.enact('INTENT: SET_ASIDE_RESERVE', 'test');
  const fiscal = {
    treasury: t.economy.treasury,
    reserve: t.economy.reserve,
    target: t.economy.reserveTarget,
    floor: 250000
  };
  t.economy.treasury = fiscal.floor - 5000;
  const releaseResult = t.economy.releaseReserveIfNeeded();
  const release = {
    ok: releaseResult.ok,
    treasury: t.economy.treasury,
    reserve: t.economy.reserve,
    floor: fiscal.floor
  };

  let calls = 0;
  window.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { ok: true, json: async () => ({ model: 'fake', choices: [{ message: { content: 'INTENT: NO_ACTION' } }] }) };
  };
  const old = g.ask();
  t.generate('governor-regression-fresh');
  g.auto = false;
  const fresh = g.ask();
  const [oldResult, freshResult] = await Promise.all([old, fresh]);
  g.fallback = false;
  g.endpoint = '/timeout';
  window.fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
  const timeoutResult = await g.ask();
  g.reset();
  g.auto = true;
  let cadenceCalls = 0;
  g.askQuietly = () => { cadenceCalls++; };
  for (let day = 1; day <= 3; day++) {
    for (const hour of [0, 6, 12, 18]) g.update(0, { day, hour });
  }
  return {
    fiscal,
    release,
    oldStatus: oldResult.status,
    freshStatus: freshResult.status,
    timeoutStatus: timeoutResult.status,
    timeoutPending: g.pending,
    cadenceCalls,
    pending: g.pending,
    calls,
    staleReplies: g.stats().staleReplies
  };
});

await browser.close();
const checks = [
  ['reserve target', result.fiscal.reserve <= result.fiscal.target],
  ['operating floor', result.fiscal.treasury >= result.fiscal.floor],
  ['automatic reserve release', result.release.ok && result.release.treasury >= result.release.floor && result.release.reserve < result.fiscal.reserve],
  ['stale reply discarded', result.oldStatus === 'stale'],
  ['fresh reply enacted', result.freshStatus === 'noop'],
  ['pending released', result.pending === false],
  ['timeout returns error', result.timeoutStatus === 'error' && result.timeoutPending === false],
  ['request cadence bounded', result.cadenceCalls > 0 && result.cadenceCalls <= 3],
  ['page errors', pageErrors.length === 0]
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log(JSON.stringify({ result, pageErrors }));
if (checks.some(([, ok]) => !ok)) process.exit(1);
