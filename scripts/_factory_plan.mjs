import { chromium } from 'playwright';

// Exercises the council-planner factory path end-to-end WITHOUT waiting for
// the sim to want one: planFor('factory') -> siteForFootprint (industrial
// branch) -> apply reprice -> plan.run -> placeBuilding. Verifies the lot the
// chooser picks, the price it charges, the edge it lands on, and that the run
// actually builds a multi-cell works.
const URL = process.env.APP_URL || 'http://localhost:5173';

const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const out = { seeds: [] };
  // planFor is module-internal; reach it via growth's evaluate? No — call the
  // same chain the planner uses through the debug surface is unavailable, so
  // replicate via siteForFootprint + apply on a hand-built plan is also
  // internal. Instead: use the public growth.apply with a plan shaped exactly
  // like planFor('factory') makes. growth.planFor IS a method — check.
  out.hasPlanFor = typeof window.planFor === 'function';
  if (!out.hasPlanFor) return out;
  const before = t.buildings.length;
  const plan = window.planFor(t, 'factory', {});
  if (!plan) return { ...out, plan: null };
  out.plan = {
    type: plan.type,
    factory: plan.factory,
    candidates: plan.footprintCandidates,
    upfrontCost: plan.cost,
    upfrontMats: plan.materials
  };
  // Force affordability so the test measures siting, not the treasury.
  const eco = t.economy;
  const needCash = (plan.cost || 0) + 100000;
  if (eco && eco.treasury < needCash) eco.treasury += needCash - eco.treasury;
  if (t.industry && plan.materials) {
    for (const [k, v] of Object.entries(plan.materials)) {
      if ((t.industry.stocks[k] || 0) < v) t.industry.stocks[k] = v;
    }
  }
  const ok = t.growth.apply(plan);
  out.applied = !!ok;
  out.block = plan ? { footprint: plan.footprint, cost: plan.cost, mats: plan.materials } : null;
  out.lastBlock = t.growth.lastBlock;
  out.before = before;
  out.queued = (t.growth.projects || []).map((p) => ({
    type: p.plan?.type,
    factory: p.plan?.factory,
    lot: p.plan?.footprint ? `${p.plan.footprint.cols}x${p.plan.footprint.rows}` : null,
    hoursLeft: +(p.remaining / (60 * 0.9)).toFixed(1)
  }));
  return out;
};

const EDGE_OF = () => {
  const t = window.town;
  const g = t.grid;
  const p = window.urbanProfile(g);
  return t.buildings
    .filter((b) => b.purpose === 'industrial' || b.kind === 'factory')
    .map((b) => {
      const cells = b.footprint && b.footprint.length ? b.footprint : [b.cell];
      const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
      const my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
      return {
        name: b.name,
        lot: cells.length,
        edge: +((Math.hypot(mx - p.cx, my - p.cy) / p.r).toFixed(3)),
        at: b.cell
      };
    });
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
for (const seed of ['1337']) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1200);
  console.log(`\n===== SEED ${seed} (plan queued) =====`);
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
  // 18 game-hours at 20x ~ 49 real seconds; wait generously then report works.
  console.log('... waiting for construction (75s) ...');
  await page.waitForTimeout(75000);
  console.log(JSON.stringify(await page.evaluate(EDGE_OF), null, 1));
}
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : 'none');
await browser.close();
