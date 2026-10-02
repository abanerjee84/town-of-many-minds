import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';

const PROBE = () => {
  const t = window.town;
  const rs = t.resources;
  const out = { sites: [], checks: [] };
  for (const s of rs.sites) {
    const [x, y] = s.cells[0];
    const d = rs.describe(x, y);
    // rectangle check: bbox area === cells
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
    for (const [cx, cy] of s.cells) {
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx > x1) x1 = cx;
      if (cy > y1) y1 = cy;
    }
    out.sites.push({
      kind: s.kind,
      cells: s.cells.length,
      rect: (x1 - x0 + 1) * (y1 - y0 + 1) === s.cells.length,
      level: s.level || 1,
      label: d?.label,
      tier: d?.tier,
      output: d?.output,
      yard: d?.yard,
      crew: `${d?.crew}/${d?.crewNeed}`
    });
  }
  // 1. upgradeTarget must never return a storehouse
  for (const r of ['water', 'energy', 'food', 'fuel']) {
    const tgt = rs.upgradeTarget(r);
    out.checks.push(`target[${r}]=${tgt ? tgt.kind : 'none'}`);
  }
  // 2. drive a husbandry site 1 -> 3 through the real upgrade path
  const husb = rs.sites.find((s) => s.kind === 'husbandry');
  if (husb) {
    const eco = t.economy;
    const log = [];
    for (let i = 0; i < 2; i++) {
      const cost = rs.upgradeCost('food', 'husbandry');
      if (eco && eco.treasury < cost + 1000) eco.treasury += cost + 1000 - eco.treasury;
      const ok = rs.upgrade('food', husb);
      const [hx, hy] = husb.cells[0];
      const d = rs.describe(hx, hy);
      log.push({
        ok, cost, level: husb.level, cells: husb.cells.length,
        output: d?.output, label: d?.label, crowded: !!husb.crowded, crewNeed: d?.crewNeed
      });
      if (!ok) break;
    }
    out.husbandryUpgrades = log;
    out.foodProduction = rs.production.food;
  } else {
    out.husbandryUpgrades = 'NO HUSBANDRY SITE';
  }
  // 3. kind-pinned council plan
  const plan = window.planFor(t, 'resource', { resource: 'food', kind: 'husbandry' });
  out.pinnedPlan = plan
    ? { label: plan.label, cost: plan.cost, targetKind: plan.target?.kind, targetLevel: plan.target?.level }
    : null;
  // 4. production math check: rated (staffed) vs computed
  out.production = { ...rs.production };
  return out;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
for (const seed of ['1337', '42']) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1500);
  console.log(`\n===== SEED ${seed} =====`);
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
}
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : 'none');
await browser.close();
