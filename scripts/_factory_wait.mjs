import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';

const PLAN = () => {
  const t = window.town;
  const plan = window.planFor(t, 'factory', {});
  const eco = t.economy;
  if (eco && eco.treasury < (plan.cost || 0) + 100000) eco.treasury += (plan.cost || 0) + 100000 - eco.treasury;
  if (t.industry && plan.materials) {
    for (const [k, v] of Object.entries(plan.materials)) {
      if ((t.industry.stocks[k] || 0) < v) t.industry.stocks[k] = v;
    }
  }
  const ok = t.growth.apply(plan);
  return { ok, lot: plan.footprint, projectId: plan.projectId, lastBlock: t.growth.lastBlock };
};

const STATE = () => {
  const t = window.town;
  const states = [...(t.growth.projectStates?.entries?.() || [])].map(([id, s]) => ({
    id: String(id).slice(0, 8),
    state: s.state,
    reason: s.reason || ''
  }));
  return {
    live: (t.growth.projects || []).map((p) => ({
      type: p.plan?.type,
      lot: p.plan?.footprint,
      remainingH: +(p.remaining / 54).toFixed(1)
    })),
    states: states.slice(-6),
    history: (t.growth.history || []).slice(-4),
    works: t.buildings
      .filter((b) => b.purpose === 'industrial' || b.kind === 'factory')
      .map((b) => ({ name: b.name, lot: (b.footprint || [b.cell]).length, at: b.cell }))
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', '1337');
await page.click('#regen');
await page.waitForTimeout(1200);
console.log('PLAN:', JSON.stringify(await page.evaluate(PLAN)));
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(15000);
  console.log(`\n--- t+${(i + 1) * 15}s ---`);
  console.log(JSON.stringify(await page.evaluate(STATE), null, 1));
}
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : 'none');
await browser.close();
