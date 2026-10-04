import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const SEEDS = (process.env.HORIZON_SEEDS || '42,1337,9001').split(',').map((s) => s.trim()).filter(Boolean);
const DAYS = Number(process.env.HORIZON_DAYS || 1200);
const SNAPSHOT_EVERY = Number(process.env.HORIZON_SNAPSHOT_EVERY || 200);
// Long horizons can use the synchronous request hook to avoid running the
// planner every day. The hook still parses and enacts a real council motion;
// it only removes scheduler/provider waiting from the probe. Set
// HORIZON_FORCE_REQUESTS=1 and tune HORIZON_REQUEST_EVERY (default 8).
const FORCE_REQUESTS = process.argv.includes('--fast') || /^(1|true|yes)$/i.test(process.env.HORIZON_FORCE_REQUESTS || '');
const REQUEST_EVERY = Math.max(1, Number(process.env.HORIZON_REQUEST_EVERY || 8));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth);

function stageFor(population, buildingCount, urbanizedArea = buildingCount) {
  // A metropolis may be vertical or campus-like.  Counting only structure
  // records made a ten-storey 3×3 works plus a university look like a town,
  // even though its occupied floor area exceeded a seventy-lot low-rise city.
  if (population >= 320 && urbanizedArea >= 70) return 'metropolis';
  if (population >= 160 && buildingCount >= 35) return 'city';
  if (population >= 60 && buildingCount >= 12) return 'town';
  return 'hamlet';
}

const results = [];
for (const seed of SEEDS) {
  const result = await page.evaluate(({ seed, days, snapshotEvery, forceRequests, requestEvery }) => {
    const t = window.town;
    t.generate(seed);
    const c = window.clock;
    c.speed = 50;
    t.governance.auto = false;
    t.growth.auto = false;
    const raw = 24 * 60 * 0.9 / c.speed;
    const dt = 1296;
    const stageFor = (population, buildingCount, urbanizedArea = buildingCount) => {
      if (population >= 320 && urbanizedArea >= 70) return 'metropolis';
      if (population >= 160 && buildingCount >= 35) return 'city';
      if (population >= 60 && buildingCount >= 12) return 'town';
      return 'hamlet';
    };
    let minTreasury = t.economy.treasury;
    let minTreasuryCategory = null;
    let maxPopulation = t.pedestrians.citizens.length;
    let firstFactoryDay = null;
    let firstCollegeDay = null;
    let firstUniversityDay = null;
    let firstRecyclingDay = null;
    let firstSkyscraperDay = null;
    let metropolisDay = null;
    const snapshots = [];
    let forcedRequests = 0;

    for (let day = 0; day < days; day++) {
      c.update(raw);
      t.advance(dt, c);
      t.lifecycle.update(dt, c);
      t.economy.update(dt, c);
      t.industry.update(dt, c);
      t.growth.update(dt);
      t.utilities.update(c);
      t.resources.update(c, raw);
      if (forceRequests && day % requestEvery === 0) {
        // Prefer the same demand plan the rules council would choose. The
        // request is injected synchronously, so no LLM call or cadence wait is
        // involved. When the town has no demand, record an explicit hold.
        const plan = t.growth.evaluate({ amenities: false });
        const code = window.planCode(plan);
        const decision = t.governance.forceRequest(`INTENT: ${code}`);
        if (decision) forcedRequests++;
      } else if (!forceRequests && t.growth.projects.length === 0) {
        t.governance.replan();
      }

      const population = t.pedestrians.citizens.length;
      const buildingCount = t.buildings.length;
      const urbanizedArea = t.buildings.reduce((sum, b) =>
        sum + Math.max(1, b.footprint?.length || 1) * Math.max(1, b.floors || b.house?.floors || 1), 0);
      const factories = t.buildings.filter((b) => b.purpose === 'industrial').length;
      const offices = t.buildings.filter((b) => b.kind === 'office').length;
      const stateGovernmentOffices = t.buildings.filter((b) => b.facility === 'government').length;
      const colleges = t.buildings.filter((b) => b.facility === 'college').length;
      const universities = t.buildings.filter((b) => b.facility === 'university' || b.subtype === 'campus').length;
      const recycling = t.buildings.filter((b) => b.facility === 'recycling').length;
      const maxFloors = Math.max(0, ...t.buildings.map((b) => b.floors || b.house?.floors || 1));
      const maxFootprint = Math.max(0, ...t.buildings.map((b) => b.footprint?.length || 1));
      if (maxFloors >= 10 && firstSkyscraperDay == null) firstSkyscraperDay = day;
      if (factories && firstFactoryDay == null) firstFactoryDay = day;
      if (colleges && firstCollegeDay == null) firstCollegeDay = day;
      if (universities && firstUniversityDay == null) firstUniversityDay = day;
      if (recycling && firstRecyclingDay == null) firstRecyclingDay = day;
      if (metropolisDay == null && stageFor(population, buildingCount, urbanizedArea) === 'metropolis') metropolisDay = day;
      maxPopulation = Math.max(maxPopulation, population);
      if (t.economy.treasury < minTreasury) {
        minTreasury = t.economy.treasury;
        const rows = t.economy.ledger.filter((row) => row.from?.sector === 'government' || row.to?.sector === 'government');
        const row = rows[rows.length - 1];
        minTreasuryCategory = row?.category || null;
      }
      if (t.economy.audit().ok === false) t.__horizonAuditFailures = (t.__horizonAuditFailures || 0) + 1;
      if (day % snapshotEvery === 0 || day === days - 1) {
        const utility = t.utilities.stats?.();
        const resource = t.resources.stats?.();
        const utilityCoverage = utility?.types
          ? Math.min(...Object.values(utility.types).map((row) => row.coverage ?? 100))
          : null;
        snapshots.push({
          day,
          stage: stageFor(population, buildingCount, urbanizedArea),
          population,
          target: t.lifecycle.stability().target,
          beds: Math.round(t.lifecycle.stability().beds),
          buildings: buildingCount,
          treasury: Math.round(t.economy.treasury),
          developerCash: Math.round(t.economy.accounts.developer.cash),
          factories,
          offices,
          stateGovernmentOffices,
          colleges,
          universities,
          recycling,
          maxFloors,
          maxFootprint,
          urbanizedArea,
          utilityCoverage,
          strainedUtilities: utility?.strained || [],
          strainedResources: resource?.strained || [],
          landfill: Math.round(resource?.waste?.landfill || 0),
          waterImports: Math.round(resource?.waterImported?.cubicMetres || 0),
          pull: t.lifecycle.stability().pull,
          mood: Number((t.pedestrians.averageMood?.() || 0).toFixed(2)),
          ranked: t.growth.ranked().slice(0, 4).map((x) => x.type),
          projects: t.growth.projects.map((p) => p.plan.type)
        });
      }
    }
    const finalPopulation = t.pedestrians.citizens.length;
    const finalBuildings = t.buildings.length;
    return {
      seed, days,
      maxPopulation,
      finalPopulation,
      finalBuildings,
      finalStage: stageFor(finalPopulation, finalBuildings, t.buildings.reduce((sum, b) =>
        sum + Math.max(1, b.footprint?.length || 1) * Math.max(1, b.floors || b.house?.floors || 1), 0)),
      metropolisDay,
      minTreasury: Math.round(minTreasury),
      minTreasuryCategory,
      factories: t.buildings.filter((b) => b.purpose === 'industrial').length,
      offices: t.buildings.filter((b) => b.kind === 'office').length,
      stateGovernmentOffices: t.buildings.filter((b) => b.facility === 'government').length,
      colleges: t.buildings.filter((b) => b.facility === 'college').length,
      universities: t.buildings.filter((b) => b.facility === 'university' || b.subtype === 'campus').length,
      recycling: t.buildings.filter((b) => b.facility === 'recycling').length,
      firstFactoryDay, firstCollegeDay, firstUniversityDay, firstRecyclingDay,
      firstSkyscraperDay,
      maxFloors: Math.max(0, ...t.buildings.map((b) => b.floors || b.house?.floors || 1)),
      maxFootprint: Math.max(0, ...t.buildings.map((b) => b.footprint?.length || 1)),
      // Growth history is intentionally a short HUD tail.  Use the lifetime
      // counters for horizon evidence so completed progression is not erased
      // when the town writes its ninth log line.
      tierUps: t.growth.metrics?.tierUps ?? t.growth.history.filter((x) => /moves up to/i.test(x)).length,
      floorUpgrades: t.growth.metrics?.floorUpgrades ?? t.growth.history.filter((x) => /gains a floor|skyscraper milestone/i.test(x)).length,
      wings: t.growth.metrics?.wings ?? t.growth.history.filter((x) => /wing|annex/i.test(x)).length,
      factoryDesigns: t.buildings.filter((b) => b.kind === 'factory').map((b) => ({ type: b.house?.spec?.factoryType, floors: b.floors, footprint: b.footprint?.length || 1, modules: b.house?.spec?.factoryModules || [] })),
      forcedRequests,
      auditFailures: t.__horizonAuditFailures || 0,
      finalAudit: t.economy.audit().ok,
      snapshots
    };
  }, { seed, days: DAYS, snapshotEvery: SNAPSHOT_EVERY, forceRequests: FORCE_REQUESTS, requestEvery: REQUEST_EVERY });
  results.push(result);
  console.log(JSON.stringify(result));
}
await browser.close();
const failed = results.filter((r) => r.minTreasury < 0 || r.auditFailures || !r.finalAudit);
console.log(JSON.stringify({
  pageErrors,
  failed: failed.length,
  results: results.map((r) => ({
    seed: r.seed,
    finalStage: r.finalStage,
    maxPopulation: r.maxPopulation,
    finalPopulation: r.finalPopulation,
    factories: r.factories,
    maxFloors: r.maxFloors,
    firstSkyscraperDay: r.firstSkyscraperDay,
    tierUps: r.tierUps,
    floorUpgrades: r.floorUpgrades,
    wings: r.wings,
    colleges: r.colleges,
    universities: r.universities,
    recycling: r.recycling,
    metropolisDay: r.metropolisDay,
    minTreasury: r.minTreasury,
    forcedRequests: r.forcedRequests
  }))
}));
if (pageErrors.length || failed.length) process.exit(1);
