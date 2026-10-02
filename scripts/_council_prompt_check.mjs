import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.governance && !!window.systemPrompt);
  const result = await page.evaluate(() => {
    const t = window.town;
    t.generate('prompt-contract');
    t.governance.auto = false;
    // A real enacted advisory decision supplies an observation without
    // bypassing the parser or the accounting boundary.
    t.governance.enact('INTENT: STUDY_ECONOMY', 'llm');
    t.clockDay = 1;
    t.governance.learning.observe(t, 1, true);
    // Fill the bounded memory to exercise the longest dynamic prompt, not just
    // the empty or one-lesson path.
    for (let i = 0; i < 24; i++) {
      t.governance.enact('INTENT: STUDY_ECONOMY', 'llm');
      t.clockDay = i + 2;
      t.governance.learning.observe(t, i + 2, true);
    }
    const prompt = window.systemPrompt(t);
    const approxTokens = Math.ceil(prompt.length / 4);
    return {
      chars: prompt.length,
      approxTokens,
      budget: window.COUNCIL_PROMPT_TOKEN_BUDGET,
      hasEthos: /controlled town-building experiment/i.test(prompt),
      rejectsTraitChecklist: /be empathetic|be clever|be prudent/i.test(prompt),
      hasLearning: /Learning record.*measured after decisions/i.test(prompt),
      hasCatalogue: /Catalogue footprints/i.test(prompt),
      lessons: t.governance.stats().learning.lessons.length,
      pending: t.governance.stats().learning.pending
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(result.hasEthos, true);
  assert.equal(result.rejectsTraitChecklist, false);
  assert.equal(result.hasLearning, true);
  assert.equal(result.hasCatalogue, true);
  assert.ok(result.lessons >= 1, JSON.stringify(result));
  assert.ok(result.lessons <= 24, JSON.stringify(result));
  assert.equal(result.pending, 0, JSON.stringify(result));
  assert.ok(result.approxTokens <= result.budget, JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
