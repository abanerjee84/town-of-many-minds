import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.governance && !!window.runCouncilBenchmark);
  const result = await page.evaluate(async () => {
    const t = window.town;
    const noAction = {
      id: 'provider-no-action',
      complete: async () => ({ model: 'provider-no-action', text: 'INTENT: NO_ACTION' })
    };
    const study = {
      id: 'provider-study',
      complete: async () => ({ model: 'provider-study', text: 'INTENT: STUDY_ECONOMY' })
    };
    t.generate('provider-check');
    t.governance.auto = false;
    t.governance.setProvider(noAction);
    const first = await t.governance.ask();
    const firstProvider = t.governance.stats().providerId;
    t.governance.setProvider(study);
    const second = await t.governance.ask();
    const secondProvider = t.governance.stats().providerId;
    const benchmark = await window.runCouncilBenchmark(t, [noAction, study], { seed: 'provider-benchmark' });
    return {
      first: { status: first.status, provider: firstProvider },
      second: { status: second.status, provider: secondProvider },
      benchmark: benchmark.map((r) => ({ provider: r.provider, scenarios: r.scenarios.length, scores: r.scenarios[0].score }))
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.first.provider, 'provider-no-action');
  assert.equal(result.second.provider, 'provider-study');
  assert.equal(result.benchmark.length, 2, JSON.stringify(result));
  assert.deepEqual(result.benchmark.map((r) => r.scenarios), [1, 1]);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
