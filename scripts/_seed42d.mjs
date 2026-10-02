import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
for (const seed of ['42', '1337']) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1200);
  const d = await page.evaluate(() => {
    const t = window.town;
    return {
      debug: t.debugFoundries,
      buildings: t.buildings.length,
      kinds: t.buildings.map((b) => b.kind).join(',')
    };
  });
  console.log(`\n===== SEED ${seed} =====`);
  console.log(JSON.stringify(d, null, 1));
}
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
