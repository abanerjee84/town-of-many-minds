import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const PROBE = () => {
  const t = window.town;
  return t.resources.sites
    .filter((s) => ['farm', 'husbandry', 'poultry'].includes(s.kind))
    .map((s) => ({ kind: s.kind, cells: s.cells }));
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', '1337');
await page.click('#regen');
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(PROBE)));
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
