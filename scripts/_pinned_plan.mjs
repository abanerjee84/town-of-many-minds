import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
const PROBE = () => {
  const t = window.town;
  const rs = t.resources;
  const eco = t.economy;
  if (eco && eco.treasury < 500000) eco.treasury = 500000;
  const out = {};
  // kind-pinned plan on a FRESH town (nothing capped)
  const plan = window.planFor(t, 'resource', { resource: 'food', kind: 'husbandry' });
  out.pinned = plan
    ? { label: plan.label, cost: plan.cost, targetKind: plan.target?.kind, targetLevel: plan.target?.level }
    : null;
  // invalid kind falls back gracefully
  const bad = window.planFor(t, 'resource', { resource: 'food', kind: 'windmill' });
  out.badKind = bad ? { label: bad.label, targetKind: bad.target?.kind } : null;
  // unpinned still works
  const plain = window.planFor(t, 'resource', { resource: 'food' });
  out.plain = plain ? { label: plain.label, cost: plain.cost, targetKind: plain.target?.kind } : null;
  // apply the pinned plan through the real queue and watch it start
  if (plan) {
    for (const [k, v] of Object.entries(plan.materials || {})) {
      if ((t.industry.stocks[k] || 0) < v) t.industry.stocks[k] = v;
    }
    const res = t.growth.apply(plan);
    out.applied = res ? { status: res.status, hours: res.hours } : { status: false, block: t.growth.lastBlock };
  }
  // spec parser check
  return out;
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
console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
// parseIntent is exposed: verify the council grammar understands kind=
const parse = await page.evaluate(() => {
  const cases = [
    'UPGRADE_RESOURCE resource=food kind=husbandry',
    'Upgrade the ranch',
    'Raise poultry output',
    'UPGRADE_RESOURCE resource=water'
  ];
  return cases.map((c) => {
    try {
      const r = window.parseIntent(c);
      return { text: c, intent: r.intent, params: r.params };
    } catch (e) {
      return { text: c, error: e.message };
    }
  });
});
console.log(JSON.stringify(parse, null, 1));
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
