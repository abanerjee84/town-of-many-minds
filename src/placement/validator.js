import { CIVIC_ORDER } from '../kits/civic/civicKit.js';
import { FOUNDING_POPULATION } from '../core/config.js';
import { roadComponents, hasNetworkAccess, urbanProfile, edgeScore } from './placementController.js';

/**
 * The amenities a founding town must have; the council grows the rest.
 *
 * Order is meaningful, not cosmetic: the FIRST entry is what the town square is
 * anchored to (see `planCivicSites`), so it names the building the town is
 * literally centred on. A settlement with a town hall but no civic anchor reads
 * as a collection of buildings rather than a town, so the town hall leads.
 *
 * A town hall was genuinely missing: this list was school/clinic/police/fire,
 * which filled all four civic slots, and every founding seed produced exactly
 * those four and no town hall — so a settlement could begin with a clinic and a
 * school but nowhere to actually run itself.
 */
export const BASIC_CIVIC = ['townhall', 'school', 'police', 'fire', 'clinic'];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function touchingRoad(g, x, y) {
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    // Frontage: a road OR a footway — inland houses front the path that
    // links them to the street (access itself is checked via hasNetworkAccess).
    if (g.inBounds(nx, ny) && (g.isRoad(nx, ny) || g.isPath(nx, ny))) return true;
  }
  return false;
}

function isLand(g, x, y) {
  if (!g.inBounds(x, y)) return false;
  if (g.isRoad(x, y) || g.isWater(x, y)) return false;
  return true;
}

/**
 * Town Validator (Phase 2, Validation stage): structural checks over the
 * generated town. Nothing here mutates state — the pipeline records the result
 * and the UI reports it.
 *
 * status: 'ok' | 'warn' | 'error'
 */
export function validateTown(town) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  const g = town.grid;
  const roads = g.roadCount;
  add('roads.present', 'Roads laid', roads > 0 ? 'ok' : 'error', `${roads} road tiles`);

  const graph = town.roadKit?.graph || null;
  let offGraph = 0;
  let graphed = 0;
  if (graph && typeof graph.nodeAt === 'function') {
    g.forEach((x, y, grid) => {
      if (!grid.isRoad(x, y)) return;
      graphed++;
      const onNode = graph.nodeAt(x, y) !== null && graph.nodeAt(x, y) !== undefined;
      const onEdge = graph.edgeAt(x, y) !== null && graph.edgeAt(x, y) !== undefined;
      if (!onNode && !onEdge) offGraph++;
    });
  }
  add(
    'roads.connected',
    'Road graph covers every road cell',
    !graph ? 'warn' : offGraph === 0 ? 'ok' : 'error',
    !graph ? 'graph not built' : offGraph === 0 ? `${graphed} cells linked` : `${offGraph} of ${graphed} road cells off-graph`
  );

  let landCells = 0;
  g.forEach((x, y, grid) => {
    if (isLand(grid, x, y)) landCells++;
  });
  const parcelCells = town.parcels?.stats?.()?.cells || 0;
  add(
    'parcels.coverage',
    'Parcels cover every buildable cell',
    parcelCells >= landCells ? 'ok' : 'warn',
    `${parcelCells} of ${landCells} land cells`
  );

  let offGrid = 0;
  let onRoad = 0;
  let noFrontage = 0;
  let withoutParcel = 0;
  let nonFinite = 0;
  for (const b of town.buildings) {
    const [x, y] = b.cell || [];
    if (!Number.isInteger(x) || !g.inBounds(x, y)) {
      offGrid++;
      continue;
    }
    // Footprint-aware: every covered cell must be buildable, and ONE cell
    // fronting + reaching the network is enough (the building spans the rest).
    const fp = b.footprint && b.footprint.length ? b.footprint : [[x, y]];
    let cellOnRoad = false;
    let front = false;
    let access = false;
    for (const [cx, cy] of fp) {
      if (!g.inBounds(cx, cy)) { offGrid++; break; }
      if (g.isRoad(cx, cy) || g.isWater(cx, cy)) cellOnRoad = true;
      if (touchingRoad(g, cx, cy)) front = true;
    }
    if (cellOnRoad) onRoad++;
    if (!front) noFrontage++;
    if (b.parcelId === null || b.parcelId === undefined) withoutParcel++;
    const e = b.matrix?.elements;
    if (e) for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) { nonFinite++; break; }
  }
  const total = town.buildings.length;
  add('buildings.present', 'Buildings placed', total > 0 ? 'ok' : 'error', `${total} buildings`);
  add(
    'buildings.placement',
    'Buildings sit on buildable cells',
    offGrid === 0 && onRoad === 0 ? 'ok' : 'error',
    `${offGrid} off-grid, ${onRoad} on road/water`
  );
  add(
    'buildings.frontage',
    'Every building fronts a road',
    noFrontage === 0 ? 'ok' : 'error',
    `${noFrontage} of ${total} without frontage`
  );
  const comps = roadComponents(g);
  add(
    'roads.single',
    'Road network is one connected component',
    comps.count <= 1 ? 'ok' : 'error',
    `${comps.count} component${comps.count === 1 ? '' : 's'}`
  );
  const cutOff = town.buildings.filter(
    (b) =>
      b.cell &&
      !(b.footprint && b.footprint.length
        ? b.footprint.some(([cx, cy]) => hasNetworkAccess(g, cx, cy, comps))
        : hasNetworkAccess(g, b.cell[0], b.cell[1], comps))
  ).length;
  add(
    'buildings.access',
    'Every building reaches the main network',
    cutOff === 0 ? 'ok' : 'error',
    `${cutOff} of ${total} cut off`
  );
  add(
    'buildings.parcels',
    'Buildings assigned to a parcel',
    withoutParcel === 0 ? 'ok' : 'warn',
    `${withoutParcel} of ${total} unassigned`
  );
  add(
    'buildings.finite',
    'Building transforms are finite',
    nonFinite === 0 ? 'ok' : 'error',
    nonFinite === 0 ? 'all matrices finite' : `${nonFinite} malformed matrices`
  );

  // Industry: the outskirts rule, and the lot size that goes with it. Both
  // read the SAME measured profile the seed, the growth planner and the player
  // tool read, so this check reports the rule rather than a second opinion on
  // it. A warn and not an error on purpose: the network grows outward, so a
  // works placed correctly on the rim years ago ends up interior as the town
  // spreads past it. That is a real thing to see, not a broken town.
  const works = town.buildings.filter((b) => b.purpose === 'industrial' || b.kind === 'factory');
  if (works.length) {
    const profile = urbanProfile(g);
    const central = works.filter((b) => {
      const cells = b.footprint && b.footprint.length ? b.footprint : [b.cell];
      const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
      const my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
      return edgeScore(profile, mx, my) < 0.5;
    });
    add(
      'industry.outskirts',
      'Works sit on the outskirts',
      central.length === 0 ? 'ok' : 'warn',
      central.length === 0
        ? `${works.length} works on the rim`
        : `${central.length} of ${works.length} works downtown (${central
            .slice(0, 3)
            .map((b) => b.name || b.kind)
            .join(', ')})`
    );
    // A works needs land. One cell is a shed, and the council's lot ladder
    // starts at 2x2 — anything below that predates the ladder or slipped
    // through a path that bypasses it.
    const sheds = works.filter((b) => {
      const cells = b.footprint && b.footprint.length ? b.footprint : [b.cell];
      return cells.length < 4;
    });
    add(
      'industry.footprint',
      'Works occupy a full lot',
      sheds.length === 0 ? 'ok' : 'warn',
      sheds.length === 0
        ? `every works is ${works.length ? Math.min(...works.map((b) => (b.footprint?.length) || 1)) : 0}+ cells`
        : `${sheds.length} works under 4 cells`
    );
  }

  const present = town.civicIndex ? new Set([...town.civicIndex.values()]) : new Set();
  const missingBasic = BASIC_CIVIC.filter((id) => !present.has(id));
  const growable = CIVIC_ORDER.filter((id) => !present.has(id));
  add(
    'civic.complete',
    'Basic civic amenities present',
    !town.civicIndex ? 'warn' : missingBasic.length === 0 ? 'ok' : 'error',
    !town.civicIndex
      ? 'civic index missing'
      : missingBasic.length
        ? `missing: ${missingBasic.join(', ')}`
        : `${present.size} built · ${growable.length} more to grow`
  );

  const util = town.utilities?.stats?.() || null;
  const nets = util ? Object.entries(util.types) : [];
  add(
    'utilities.networks',
    'Power, water and sewage networks exist',
    util && nets.length === 3 ? 'ok' : 'error',
    util ? `${nets.length} networks, ${util.plants} plants` : 'utilities not built'
  );
  if (nets.length) {
    const dead = nets.filter(([, n]) => !n.coverage).map(([k]) => k);
    add(
      'utilities.coverage',
      'Every network reaches at least one building',
      dead.length === 0 ? 'ok' : 'warn',
      dead.length ? `no coverage: ${dead.join(', ')}` : nets.map(([k, n]) => `${k} ${n.coverage}%`).join(' · ')
    );
    const over = nets.filter(([, n]) => n.saturated).map(([k]) => k);
    add(
      'utilities.capacity',
      'Networks within capacity',
      over.length === 0 ? 'ok' : 'warn',
      over.length ? `over capacity: ${over.join(', ')}` : nets.map(([k, n]) => `${k} ${n.demand}/${n.capacity}`).join(' · ')
    );
  }

  const res = town.resources?.stats?.() || null;
  add(
    'resources.present',
    'Primary resources sited on the outskirts',
    res && res.sites > 0 ? 'ok' : 'error',
    res
      ? `${res.sites} sites · lake ${res.lakeCells} cells · ${Object.entries(res.types)
          .map(([k, t]) => `${k} ${t.production}/${t.demand}`)
          .join(' · ')}`
      : 'resources not built'
  );
  if (res && res.sites) {
    add(
      'resources.connected',
      'Every resource site is road-connected',
      res.disconnected === 0 ? 'ok' : 'warn',
      res.disconnected === 0
        ? `${res.connected} of ${res.sites} linked to the network`
        : `${res.disconnected} of ${res.sites} cut off`
    );
  }

  const pub = town.publicPlan;
  const pubCells = pub ? pub.cellUse.size : 0;
  add(
    'publicSpace.present',
    'Public spaces planned',
    pub && pubCells > 0 ? 'ok' : 'warn',
    pub
      ? `${pub.paths.length} paths, ${pub.sports.length} pitches, ${pub.gardens?.length || 0} gardens, ${pub.playgrounds?.length || 0} playgrounds, ${pubCells} cells`
      : 'no plan'
  );

  const pop = town.pedestrians?.citizens?.length || 0;
  add('agents.spawned', 'Population spawned', pop > 0 ? 'ok' : 'warn', `${pop} citizens`);
  const homes = town.buildings.filter((b) => b.kind === 'house');
  const beds = homes.reduce((sum, b) => sum + (b.capacity || 0), 0);
  add(
    'founding.population',
    'Founding population matches the settlement brief',
    pop === FOUNDING_POPULATION ? 'ok' : 'error',
    `${pop} of ${FOUNDING_POPULATION} citizens`
  );
  add(
    'founding.beds',
    'Founding homes cover the settlement population',
    beds >= pop ? 'ok' : 'error',
    `${Math.round(beds * 10) / 10} beds for ${pop} citizens`
  );

  const errors = checks.filter((c) => c.status === 'error');
  const warnings = checks.filter((c) => c.status === 'warn');
  return {
    ok: errors.length === 0,
    total: checks.length,
    passed: checks.filter((c) => c.status === 'ok').length,
    errors: errors.map((c) => `${c.label}: ${c.detail}`),
    warnings: warnings.map((c) => `${c.label}: ${c.detail}`),
    checks
  };
}

export function validationSummary(v) {
  if (!v) return 'not run';
  if (!v.ok) return `${v.errors.length} error${v.errors.length === 1 ? '' : 's'}`;
  if (v.warnings.length) return `${v.passed}/${v.total} ok · ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}`;
  return `${v.passed}/${v.total} checks passed`;
}
