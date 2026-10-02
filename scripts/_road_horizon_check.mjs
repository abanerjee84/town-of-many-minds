import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const DAYS = Number(process.env.ROAD_HORIZON_DAYS || 800);
const SEEDS = (process.env.ROAD_HORIZON_SEEDS || '42,1337,9001').split(',').map((s) => s.trim()).filter(Boolean);
const SNAPSHOT_EVERY = Number(process.env.ROAD_HORIZON_SNAPSHOT_EVERY || 100);
// Opt-in deterministic request mode. It replaces the daily planner sweep with
// one synchronous request every N days, using the same enact/finance/ledger
// boundary and never contacting an LLM provider.
const FORCE_REQUESTS = process.argv.includes('--fast') || /^(1|true|yes)$/i.test(process.env.ROAD_HORIZON_FORCE_REQUESTS || process.env.HORIZON_FORCE_REQUESTS || '');
const REQUEST_EVERY = Math.max(1, Number(process.env.ROAD_HORIZON_REQUEST_EVERY || process.env.HORIZON_REQUEST_EVERY || 8));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth && !!window.town?.traffic);

const results = [];
for (const seed of SEEDS) {
  const result = await page.evaluate(({ seed, days, snapshotEvery, forceRequests, requestEvery }) => {
    const t = window.town;
    const c = window.clock;
    const roadGate = Number(window.getSettings?.().averageCongestionThreshold) || 0.5;
    t.generate(seed);
    c.speed = 50;
    t.governance.auto = false;
    t.growth.auto = false;
    const raw = 24 * 60 * 0.9 / c.speed;
    const dt = 1296;
    const initialRoads = t.grid.roadCells().length;
    const snapshots = [];
    let minRoads = initialRoads;
    let maxOffRoadDriving = 0;
    let maxOffRoadRoute = 0;
    let maxOffRoadDocking = 0;
    let maxOffRoadUnmarked = 0;
    let offRoadUnmarkedExample = null;
    let maxOffRoadDistance = 0;
    let offRoadExample = null;
    let daysWithRoadNeed = 0;
    let daysWithRoadPlan = 0;
    let totalRoadPlanChecks = 0;
    let roadDecisions = 0;
    let roadDecisionStarted = 0;
    let forcedRequests = 0;
    let maxCongestion = 0;
    let maxOffNetwork = 0;
    let maxUnacquiredRoads = 0;
    let lastUnacquiredRoadCells = [];
    let maxVehicles = 0;
    let maxTrips = 0;
    const decisionRows = [];
    const snap = (day) => {
      const mobility = t.traffic.mobilityStats();
      const connectivity = t.growth.connectivity();
      const activeDriving = t.traffic.vehicles.filter((v) => v.trip && v.parkTimer <= 0);
      const offRoadDriving = activeDriving.filter((v) => {
        const p = v.group?.position;
        if (!p) return false;
        const cell = t.grid.worldToCell(p.x, p.z);
        return !t.grid.isRoad(cell.x, cell.y);
      }).length;
      const offRoadRoute = activeDriving.filter((v) => {
        const p = v.group?.position;
        if (!p) return false;
        const cell = t.grid.worldToCell(p.x, p.z);
        return !t.grid.isRoad(cell.x, cell.y) && !v.docking;
      }).length;
      const offRoadDocking = activeDriving.filter((v) => {
        const p = v.group?.position;
        if (!p) return false;
        const cell = t.grid.worldToCell(p.x, p.z);
        return !t.grid.isRoad(cell.x, cell.y) && !!v.docking;
      }).length;
      const offRoadUnmarked = activeDriving.filter((v) => {
        const p = v.group?.position;
        if (!p) return false;
        const c = t.grid.worldToCell(p.x, p.z);
        return !t.grid.isRoad(c.x, c.y) && !v.docking && !(t.parking?.at?.(c.x, c.y) || []).length;
      }).length;
      if (offRoadUnmarked && !offRoadUnmarkedExample) {
        const v = activeDriving.find((agent) => {
          const p = agent.group?.position;
          if (!p) return false;
          const c = t.grid.worldToCell(p.x, p.z);
          return !t.grid.isRoad(c.x, c.y) && !agent.docking && !(t.parking?.at?.(c.x, c.y) || []).length;
        });
        if (v) {
          const c = t.grid.worldToCell(v.group.position.x, v.group.position.z);
          offRoadUnmarkedExample = {
            cell: [c.x, c.y],
            position: [Number(v.group.position.x.toFixed(2)), Number(v.group.position.z.toFixed(2))],
            uid: v.uid,
            backing: !!v.backing,
            sceneT: v.sceneT,
            parkTimer: v.parkTimer,
            trip: !!v.trip,
            awaitingBay: !!v.awaitingBay,
            points: v.points?.slice(Math.max(0, v.idx - 1), v.idx + 2).map((p) => [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))]) || [],
            routeCells: v.routeCells?.slice(-4) || []
          };
        }
      }
      for (const v of activeDriving) {
        const p = v.group?.position;
        if (!p) continue;
        const cell = t.grid.worldToCell(p.x, p.z);
        if (t.grid.isRoad(cell.x, cell.y)) continue;
        const road = t.nearestRoadCell(cell.x, cell.y);
        const distance = road ? Math.abs(road[0] - cell.x) + Math.abs(road[1] - cell.y) : 999;
        if (distance > maxOffRoadDistance) {
          maxOffRoadDistance = distance;
          offRoadExample = { distance, parkingCells: t.parking?.at?.(cell.x, cell.y)?.length || 0, docking: !!v.docking, fuelStop: !!v.fuelStop, awaitingBay: !!v.awaitingBay, errandKind: v.errandKind, routeCells: v.routeCells?.slice(-3) || [] };
        }
      }
      const congestion = Number(mobility.congestion) || 0;
      const unacquiredRoads = t.perimeter
        ? t.grid.roadCells().filter(([x, y]) => !t.perimeter.isAcquired(x, y)).length
        : 0;
      if (unacquiredRoads) {
        lastUnacquiredRoadCells = t.grid.roadCells()
          .filter(([x, y]) => !t.perimeter.isAcquired(x, y));
      }
      // The planner evaluates every legal four-cell run and, once four trips
      // exist, virtual Dijkstra detours. Do not pay that cost on calm days.
      const plan = congestion > roadGate && (day % snapshotEvery === 0 || day === days - 1)
        ? t.growth.selectRoadExtension()
        : null;
      const roads = t.grid.roadCells().length;
      maxOffRoadDriving = Math.max(maxOffRoadDriving, offRoadDriving);
      maxOffRoadRoute = Math.max(maxOffRoadRoute, offRoadRoute);
      maxOffRoadDocking = Math.max(maxOffRoadDocking, offRoadDocking);
      maxOffRoadUnmarked = Math.max(maxOffRoadUnmarked, offRoadUnmarked);
      maxCongestion = Math.max(maxCongestion, congestion);
      maxOffNetwork = Math.max(maxOffNetwork, connectivity.offNetwork || 0);
      maxUnacquiredRoads = Math.max(maxUnacquiredRoads, unacquiredRoads);
      maxVehicles = Math.max(maxVehicles, t.traffic.vehicles.length);
      maxTrips = Math.max(maxTrips, Number(mobility.vehicleTripsCompleted) || 0);
      if (congestion > roadGate) {
        daysWithRoadNeed++;
        totalRoadPlanChecks++;
        if (plan) daysWithRoadPlan++;
      }
      minRoads = Math.min(minRoads, roads);
      if (day % snapshotEvery === 0 || day === days - 1) {
        snapshots.push({
          day,
          roads,
          roadsAdded: roads - initialRoads,
          buildings: t.buildings.length,
          population: t.pedestrians.citizens.length,
          vehicles: t.traffic.vehicles.length,
          activeDriving: activeDriving.length,
          offRoadDriving,
          offRoadRoute,
          offRoadDocking,
          offRoadUnmarked,
          congestion: Number(congestion.toFixed(3)),
          trips: t.traffic.roadDemandSnapshot().trips.length,
          plan: plan ? { cells: plan.cells.length, reason: plan.reason, benefit: plan.benefit ?? null } : null,
          components: connectivity.components,
          offNetwork: connectivity.offNetwork,
          unacquiredRoads,
          linked: connectivity.linked,
          priority: t.growth.ranked().slice(0, 4).map((x) => x.type),
          projects: t.growth.projects.map((p) => p.plan.type)
        });
      }
    };
    for (let day = 0; day < days; day++) {
      c.update(raw);
      t.advance(dt, c);
      t.lifecycle.update(dt, c);
      t.economy.update(dt, c);
      t.industry.update(dt, c);
      t.growth.update(dt);
      t.utilities.update(c);
      t.resources.update(c, raw);
      let d = null;
      if (forceRequests && day % requestEvery === 0) {
        // Keep the road audit request-driven: when congestion has a legal
        // extension, force that motion; otherwise let the normal demand plan
        // choose the next build. This avoids a full ranked/evaluate pass every
        // day while still exercising the real request path.
        const before = t.grid.roadCells().length;
        const mobility = t.traffic.mobilityStats();
        const roadPlan = mobility.congestion > roadGate ? t.growth.selectRoadExtension() : null;
        const plan = roadPlan ? null : t.growth.evaluate({ amenities: false });
        const code = roadPlan ? 'EXTEND_STREET' : window.planCode(plan);
        d = t.governance.forceRequest(`INTENT: ${code}`);
        if (d) forcedRequests++;
        const after = t.grid.roadCells().length;
        if (d?.intent === 'EXTEND_STREET') {
          roadDecisions++;
          if (['started', 'queued', 'done'].includes(d.status)) roadDecisionStarted++;
          decisionRows.push({ day, status: d.status, detail: d.detail, added: after - before });
        }
      } else if (!forceRequests && t.growth.projects.length === 0) {
        const before = t.grid.roadCells().length;
        d = t.governance.replan();
        const after = t.grid.roadCells().length;
        if (d?.intent === 'EXTEND_STREET') {
          roadDecisions++;
          if (['started', 'queued', 'done'].includes(d.status)) roadDecisionStarted++;
          decisionRows.push({ day, status: d.status, detail: d.detail, added: after - before });
        }
      }
      snap(day);
    }
    const finalMobility = t.traffic.mobilityStats();
    const finalConnectivity = t.growth.connectivity();
    return {
      seed,
      days,
      initialRoads,
      finalRoads: t.grid.roadCells().length,
      roadsAdded: t.grid.roadCells().length - initialRoads,
      finalBuildings: t.buildings.length,
      finalPopulation: t.pedestrians.citizens.length,
      finalVehicles: t.traffic.vehicles.length,
      finalCongestion: Number((finalMobility.congestion || 0).toFixed(3)),
      maxCongestion: Number(maxCongestion.toFixed(3)),
      finalTrips: t.traffic.roadDemandSnapshot().trips.length,
      maxTrips,
      maxOffRoadDriving,
      maxOffRoadRoute,
      maxOffRoadDocking,
      maxOffRoadUnmarked,
      offRoadUnmarkedExample,
      maxOffRoadDistance,
      offRoadExample,
      maxOffNetwork,
      maxUnacquiredRoads,
      lastUnacquiredRoadCells,
      finalConnectivity,
      daysWithRoadNeed,
      daysWithRoadPlan,
      totalRoadPlanChecks,
      roadDecisions,
      roadDecisionStarted,
      forcedRequests,
      decisionRows,
      snapshots,
      audit: t.economy.audit()
    };
  }, { seed, days: DAYS, snapshotEvery: SNAPSHOT_EVERY, forceRequests: FORCE_REQUESTS, requestEvery: REQUEST_EVERY });
  results.push(result);
  console.log(JSON.stringify(result));
}

await browser.close();
console.log(JSON.stringify({ pageErrors, days: DAYS, summary: results.map((r) => ({
  seed: r.seed,
  initialRoads: r.initialRoads,
  finalRoads: r.finalRoads,
  roadsAdded: r.roadsAdded,
  finalPopulation: r.finalPopulation,
  finalVehicles: r.finalVehicles,
  finalCongestion: r.finalCongestion,
  maxOffRoadDriving: r.maxOffRoadDriving,
  maxOffRoadRoute: r.maxOffRoadRoute,
  maxOffRoadDocking: r.maxOffRoadDocking,
  maxOffRoadUnmarked: r.maxOffRoadUnmarked,
  offRoadUnmarkedExample: r.offRoadUnmarkedExample,
  maxOffRoadDistance: r.maxOffRoadDistance,
  maxOffNetwork: r.maxOffNetwork,
  maxUnacquiredRoads: r.maxUnacquiredRoads,
  daysWithRoadNeed: r.daysWithRoadNeed,
  daysWithRoadPlan: r.daysWithRoadPlan,
  roadDecisions: r.roadDecisions,
  roadDecisionStarted: r.roadDecisionStarted,
  forcedRequests: r.forcedRequests,
  auditOk: r.audit.ok
})) }));
if (pageErrors.length || results.some((r) => !r.audit.ok || r.maxUnacquiredRoads > 0)) process.exit(1);
