import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';

// The headless renderer is software-GL and locks the frame rate, so FPS here
// says nothing about the simulation. This measures the sim step directly: each
// system's update, plus the per-frame work main.js does around them.
const PROBE = () => {
  const t = window.town;
  const c = window.clock;
  const time = (fn, n) => {
    const s = performance.now();
    for (let i = 0; i < n; i++) fn();
    return (performance.now() - s) / n;
  };
  const dt = 0.9; // one game minute at 50x
  return {
    advance: time(() => t.advance(dt, c), 40),
    lifecycle: time(() => t.lifecycle.update(dt, c), 40),
    economy: time(() => t.economy.update(dt, c), 40),
    industry: time(() => t.industry.update(dt, c), 40),
    growth: time(() => t.growth.update(dt), 40),
    governance: time(() => t.governance.update(dt, c), 40),
    utilities: time(() => t.utilities.update(c), 40),
    resources: time(() => t.resources.update(c, 0.016), 40),
    stats: time(() => t.stats(), 40),
    growthEvaluate: time(() => t.growth.evaluate(), 5)
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(1000);
const r = await page.evaluate(PROBE);
const perFrame = r.advance + r.lifecycle + r.economy + r.industry + r.growth + r.governance + r.utilities + r.resources + r.stats;
for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(16)} ${v.toFixed(4)} ms`);
console.log(`  ${'-- sim/frame --'.padEnd(16)} ${perFrame.toFixed(4)} ms  (${((perFrame / 16.67) * 100).toFixed(1)}% of a 60 fps budget)`);
console.log(`  growth.evaluate() runs only on its 30-60s cooldown, but is the one place a plan does many full-grid scans: ${r.growthEvaluate.toFixed(3)} ms`);
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
