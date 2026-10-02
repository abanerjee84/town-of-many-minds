import * as THREE from 'three';
import { CELL, CELL_KIND, SIM } from '../../core/config.js';
import { findLinkPath } from '../../core/pathfinding.js';
import { box, boxEuler, cyl, cone, merge, buildMesh } from '../geometry.js';
import { events } from '../../core/events.js';

/**
 * Resource Kit: the town's three primary resources — water, energy and food —
 * plus the sites that produce them (lake, wind turbine, solar farm, farm) and
 * the buildings that store them (reservoir, silo).
 *
 * Placement is procedural end to end: the town core is measured from the road
 * cells that already exist, candidates are scored from constraints (outside
 * that core, clear of other sites, inside the map margin) and ties are broken
 * by the seeded rng. No coordinate in here is a literal.
 */

export const RESOURCE = { WATER: 'water', ENERGY: 'energy', FOOD: 'food', FUEL: 'fuel' };
/**
 * Phase 14 (C5) — the canonical resource order. Everything that used to
 * hand-write `{ water, energy, food }` (stores, levels, shortage flags, site
 * levels, production, stress) is built from this list, so adding a resource
 * is one row here plus its table entries.
 */
export const ORDER = [RESOURCE.WATER, RESOURCE.ENERGY, RESOURCE.FOOD, RESOURCE.FUEL];

/** A zeroed/seeded map over ORDER — the shape every per-resource field takes. */
const blank = (make) => Object.fromEntries(ORDER.map((k) => [k, make(k)]));

export const RESOURCE_LABEL = {
  water: 'Water',
  energy: 'Energy',
  food: 'Food',
  fuel: 'Fuel'
};

export const RESOURCE_UNIT = { water: 'm³', energy: 'kWh', food: 't', fuel: 'L' };
export const RESOURCE_FLOW_UNIT = { water: 'm³/day', energy: 'kW', food: 't/day', fuel: 'L/day' };

export const SITE_LABEL = {
  lake: 'Lake',
  windmill: 'Wind turbine',
  solar: 'Solar farm',
  farm: 'Farm',
  husbandry: 'Animal husbandry',
  poultry: 'Poultry farm',
  silo: 'Grain silo',
  reservoir: 'Reservoir',
  gas: 'Gas station',
  battery: 'Battery storage'
};

const SITE_RESOURCE = {
  lake: RESOURCE.WATER,
  reservoir: RESOURCE.WATER,
  windmill: RESOURCE.ENERGY,
  solar: RESOURCE.ENERGY,
  farm: RESOURCE.FOOD,
  husbandry: RESOURCE.FOOD,
  poultry: RESOURCE.FOOD,
  silo: RESOURCE.FOOD,
  gas: RESOURCE.FUEL,
  battery: RESOURCE.ENERGY
};

/** Which workforce a site takes: farms farm, mills run the grid, pumps sell fuel. */
const SITE_WORK = {
  farm: 'farm',
  husbandry: 'farm',
  poultry: 'farm',
  windmill: 'power',
  solar: 'power',
  gas: 'fuel'
};

/**
 * Crew each workforce should hold and the job that fills it. One table, read by
 * `pedestrians.staffWorkforce` (day-to-day staffing), `governance.staffNeed`
 * (the HIRE_WORKERS gap) and the report's Staff line — so a new site kind
 * cannot be half-wired. Agriculture tiers override the farm rate per site
 * (see siteCrew): the table stays as the default and the non-ag rates.
 */
/**
 * Site crew, in STAFFING PRIORITY order — `staffWorkforce` walks this table and
 * hires against it, so the order decides which site gets a body when the town's
 * pool of qualifying locals runs out.
 *
 * The order was tried with fuel ahead of power (primary supply first) and made
 * things worse — 1 seed in 15 opened with an unmanned pump before, 3 after —
 * because the founding town cannot fall back on immigration (it has no spare
 * beds by design), so the last role in this table simply goes unstaffed and
 * reordering only changes WHICH one it is. The real constraint is headroom, not
 * priority; fuel is left where it was rather than moved on a false theory.
 */
export const SITE_CREW = {
  farm: { work: 'farm', job: 'farmer', crew: 2, label: 'farm' },
  power: { work: 'power', job: 'powerworker', crew: 1, label: 'power' },
  fuel: { work: 'fuel', job: 'attendant', crew: 1, label: 'fuel' }
};

/** The workforce roles, in report order. */
export const CREW_ROLES = Object.keys(SITE_CREW);

/** Cells each site claims. Agriculture yards are intentionally horizontal: a
 * real field, paddock, or poultry run needs room for circulation, not just a
 * tiny vertical prop. The tier rectangles below keep the area and orientation
 * inspectable instead of letting a blob accidentally become the farm plan. */
const SITE_FOOT = { windmill: 4, solar: 4, farm: 28, husbandry: 28, poultry: 28, silo: 4, gas: 4, reservoir: 2, battery: 4 };

/** Rated output per site. The lake yields per water cell. */
const OUTPUT = { lake: 12, windmill: 220, solar: 150, farm: 90, husbandry: 70, poultry: 55, gas: 110 };

/**
 * The agriculture ladder: three tiers per husbandry kind, shaped like the
 * shops' SHOP_TIERS ({ label, cells, output, crew }) so the same "rung buys
 * headroom" reasoning applies. A tier is intensification AND extensification
 * at once — the yard grows (cells) and the working of it improves (output per
 * site, crew to work it) — which is why `upgrade()` both claims land and
 * re-rates the site, instead of only multiplying like the old level did.
 *
 * Tier-1 rows keep the old output and crew contract but give agriculture a
 * credible 7x4 yard. Later rungs expand the same parcel to 8x5 and 9x6,
 * making extensification visible as well as the output/crew change.
 */
export const AG_TIERS = {
  farm: [
    { level: 1, label: 'Smallholding', cells: 28, output: 90, crew: 2 },
    { level: 2, label: 'Farm', cells: 40, output: 150, crew: 3 },
    { level: 3, label: 'Estate farm', cells: 54, output: 220, crew: 4 }
  ],
  husbandry: [
    { level: 1, label: 'Paddock', cells: 28, output: 70, crew: 2 },
    { level: 2, label: 'Ranch', cells: 40, output: 120, crew: 3 },
    { level: 3, label: 'Stockyard', cells: 54, output: 180, crew: 4 }
  ],
  poultry: [
    { level: 1, label: 'Coop run', cells: 28, output: 55, crew: 2 },
    { level: 2, label: 'Poultry farm', cells: 40, output: 95, crew: 3 },
    { level: 3, label: 'Hatchery', cells: 54, output: 140, crew: 3 }
  ]
};

/** Yard rectangles per tier, as [cols, rows] — every tier is an exact rectangle. */
const TIER_RECT = { 28: [7, 4], 40: [8, 5], 54: [9, 6], 4: [2, 2], 6: [3, 2], 9: [3, 3] };

/** The tier row a site works at (agriculture only — everything else is tierless). */
export function agTierOf(site) {
  const ladder = site && AG_TIERS[site.kind];
  if (!ladder) return null;
  const lvl = Math.max(1, Math.min(MAX_SITE_LEVEL, site.level || 1));
  return ladder[lvl - 1];
}
/** Rated storage per site. A gas station's tanks are why fuel is never fully dry. */
const STORAGE = { reservoir: 750, silo: 1400, gas: 400, battery: 1200 };
/** Sites that ONLY store — they hold stock but produce none. */
const STOREHOUSE = { reservoir: true, silo: true, battery: true };
/** Buffer the town carries without any storage building (grid, pipes, sacks, drums). */
const BASE_STORAGE = { water: 150, energy: 4500, food: 160, fuel: 250 };

const SURPLUS = 1.25; // production is aimed at 125% of planned demand
const BUFFER_DAYS = 1.6; // storage is aimed at 1.6 days of demand
const INITIAL_FILL = 0.55;
const SITE_GAP = 6; // minimum Chebyshev distance between resource sites
const SITE_GAP_TIGHT = 3; // fallback spacing when the outskirts run out
/**
 * A wind farm is a ROW of turbines, not a scatter of them. Two changes make the
 * turbines read as one installation: the founding order places them
 * consecutively rather than alternating with solar, and each one after the first
 * steers towards the others instead of towards the far edge of the map.
 *
 * `WIND_FARM_GAP` is the spacing between turbine yards. It is far tighter than
 * SITE_GAP on purpose — SITE_GAP is scenery spread for a whole resource belt,
 * and applying it to turbines spaced them 24 m apart, which is a field of
 * lonely masts rather than a farm.
 */
const WIND_FARM = Object.freeze({ of: 'windmill', gap: 1 });
/** Score bonus that outweighs the far-outskirts pull, so clustering wins. */
const CLUSTER_PULL = 100;

function chebyshev(x, y, a) {
  return Math.max(Math.abs(x - a.x), Math.abs(y - a.y));
}
/**
 * Spacing ladder, widest first. The founding plan asks for SITE_GAP; a town
 * that has spent its outskirts steps down this rather than stalling a
 * resource it is visibly short of. Gap 1 still forbids overlapping yards —
 * it only allows them to sit flush against each other.
 */
const GAP_LADDER = [SITE_GAP_TIGHT, 2, 1];
const MAX_SPUR = 8; // longest access road from a site to the network
/** Phase 18 — the same ceiling for any off-network build's access road. */
export const MAX_SPUR_LENGTH = 8;
const EDGE_MARGIN = 1; // keep sites off the raw map edge
const LAKE_MAX = 20;
const LAKE_MIN = 4;
const LAKE_REACH = 4; // lake grows no further than this from its seed
const MAX_ENERGY_SITES = 7;
/**
 * Energy sites a founding town always gets, demand notwithstanding: the
 * guaranteed turbine/solar/turbine mix.
 *
 * It is deliberately NOT more. A four-turbine founding farm was tried and it
 * costs two power workers the town does not have: the extra turbines take the
 * last two job placements, the fuel pump loses its attendant, and the town runs
 * on no fuel at all (measured — production.fuel 110 on every seed at three
 * sites, 0 on most seeds at five). A wind farm is scenery and a fuel pump is
 * survival, so the farm waits: `growSites` adds turbines as the town gains the
 * people to crew them, and because those additions cluster too, the farm
 * assembles itself as the town grows.
 */
const MIN_ENERGY_SITES = 3;
const MAX_FARMS = 4;
/** Phase 14 — one pump covers the founding fleet; a third covers a big one. */
const MAX_FUEL_SITES = 3;
const MAX_SITE_LEVEL = 3;
/** Treasury cost to raise a resource's site level — level × this. */
const UPGRADE_COST = { water: 90000, energy: 70000, food: 60000, fuel: 50000 };
/** Litres a single vehicle burns a day. Fuel is the one resource the fleet eats. */
const FUEL_PER_VEHICLE = 7;
/**
 * The town refines nothing — there is no oil refinery anywhere in it, so every
 * litre comes from a staffed, connected gas station. When those cannot cover
 * the fleet, buying a shipment in is the only honest alternative to inventing
 * fuel: it is paid for out of the treasury, capped by storage, and never
 * attempted while local stations can already hold the day.
 */
const FUEL_IMPORT_PRICE = 12;
/** Never buy more than this in one day, whatever the deficit. */
const FUEL_IMPORT_MAX = 400;
/** A lake is finite, so the public water service can buy a capped shipment. */
const WATER_IMPORT_PRICE = 10;
const WATER_IMPORT_MAX = 600;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

const key = (x, y) => `${x},${y}`;

function townCounts(town, pop) {
  let shops = 0;
  let civic = 0;
  let industry = 0;
  for (const b of town.buildings) {
    if (b.purpose === 'commercial') shops++;
    else if (b.purpose === 'civic') civic++;
    else if (b.purpose === 'industrial') industry++;
  }
  // Phase 14 — the fleet is the one consumer traffic already tracks; fuel is
  // the only resource it feeds, so its demand is read straight off it.
  const vehicles = town.traffic?.vehicles?.length || 0;
  return { pop, shops, civic, industry, vehicles };
}

/** Population the placed housing can hold — what the founding town plans for. */
function plannedPopulation(town) {
  let n = 0;
  for (const b of town.buildings) {
    if (b.purpose === 'residential') n += b.capacity || 0;
  }
  return Math.min(Math.round(n), SIM.maxCitizens);
}

function demandOf(kind, { pop, shops, civic, industry = 0, vehicles = 0 }) {
  if (kind === RESOURCE.WATER) return Math.round(pop * 1.4 + shops * 5 + industry * 6);
  if (kind === RESOURCE.ENERGY) return Math.round(pop * 2.2 + shops * 15 + civic * 18 + industry * 20);
  if (kind === RESOURCE.FUEL) return Math.round(vehicles * FUEL_PER_VEHICLE);
  return Math.round(pop * 1.0 + shops * 4 + industry * 4);
}

/** Auditable solid-waste flow. It is intentionally kept beside resources so
 * the report can show what is generated, recovered and sent to landfill
 * before a future material market turns recovered waste into a new commodity. */
function wasteFlow(town) {
  const pop = town?.pedestrians?.citizens?.length || 0;
  const shops = town?.buildings?.filter((b) => b.kind === 'shop' || b.kind === 'office').length || 0;
  const industry = town?.buildings?.filter((b) => b.kind === 'factory').length || 0;
  const generated = Math.max(0, Math.round(pop * 0.8 + shops * 3 + industry * 5));
  const capacity = (town?.buildings || [])
    .filter((b) => b.kind === 'civic' && b.capacityKind === 'waste')
    .reduce((n, b) => n + (b.capacity || 0), 0);
  const processed = Math.min(generated, capacity);
  const compost = Math.round(processed * 0.35);
  return {
    generated,
    processingCapacity: capacity,
    processed,
    recycled: Math.max(0, processed - compost),
    compost,
    landfill: Math.max(0, generated - processed),
    diversion: generated ? Math.round((processed / generated) * 100) : 100
  };
}

/** Bounding box of the road network: the town core, measured not assumed. */
function coreBounds(g) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let n = 0;
  g.forEach((x, y, grid) => {
    if (!grid.isRoad(x, y)) return;
    n++;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  });
  return n ? { x0, y0, x1, y1 } : null;
}

function isOutskirts(g, x, y, b) {
  if (x < EDGE_MARGIN || y < EDGE_MARGIN) return false;
  if (x >= g.w - EDGE_MARGIN || y >= g.h - EDGE_MARGIN) return false;
  return x < b.x0 - 1 || x > b.x1 + 1 || y < b.y0 - 1 || y > b.y1 + 1;
}

// A fuel station is public-facing street infrastructure, not a remote
// extraction works. Keep its pump and forecourt in a shallow civic belt around
// the measured town core so residents can reach it without a long industrial
// spur. It still obeys the normal empty-cell, spacing and access checks.
function isFuelGround(g, x, y, b) {
  if (x < EDGE_MARGIN || y < EDGE_MARGIN || x >= g.w - EDGE_MARGIN || y >= g.h - EDGE_MARGIN) return false;
  return x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3;
}

/** How far outside the core a cell sits — the outskirts score. */
function depthOf(x, y, b) {
  return Math.max(b.x0 - x, x - b.x1, b.y0 - y, y - b.y1);
}

/**
 * Outskirts depth, SATURATED at the distance an access spur can actually reach.
 *
 * Scoring sites by raw `depthOf` quietly assumes a small map. On the old 34x28
 * grid the founding core filled most of it, so "as far out as possible" was
 * always still within spur range. On a 48x40 extent the founding core is a
 * small rectangle in the middle, the corners sit ~14 cells outside the road
 * bounds, and an uncapped score puts every candidate there — where the spur
 * test then fails and the site is silently discarded. The town ends up with no
 * water supply at all, and no error to say why.
 *
 * Clamping at the spur's own reach keeps the "put it as far out as we can
 * service it" intent while making the far side of a big map no more attractive
 * than a reachable one. Past the reach the extra distance buys nothing, so
 * `rng` decides, which is what we want.
 */
function reachOf(x, y, b, reach) {
  return Math.min(depthOf(x, y, b), reach);
}

/**
 * Shortest access road from any source cell to the road network, through
 * empty land only (so it never cuts a lake, a site or a park). Returns the
 * cells to paint, excluding both the source and the road it joins.
 *
 * Exported (Phase 18): every off-network build — the archetype queue, an
 * annex, an office, a resource site — reaches the network through THIS, so
 * there are no hand-placed access stubs anywhere in the town.
 */
export function spurPath(g, sources, maxDepth = MAX_SPUR) {
  const starts = new Set(sources.map(([x, y]) => g.idx(x, y)));
  return findLinkPath(g, sources, (x, y) => g.isRoad(x, y), {
    maxLen: maxDepth,
    passable: (x, y) => g.inBounds(x, y) && g.kindAt(x, y) === CELL_KIND.EMPTY,
    stopAt: (cell) => starts.has(cell)
  });
}

function carveRoad(g, cells) {
  for (const [x, y] of cells) {
    if (!g.inBounds(x, y)) continue;
    g.setKind(x, y, CELL_KIND.ROAD);
    const i = g.idx(x, y);
    g.zone[i] = null;
    g.owner[i] = null;
  }
}

/**
 * Grow a RECTANGULAR yard of `n` free outskirts cells around a seed, so barns
 * sit on ground the site owns instead of floating over holes. Exact
 * tier rectangles (including agriculture's 7x4, 8x5, and 9x6 yards) are tried
 * at every anchor that keeps the seed inside; only when no rectangle fits does
 * compact-blob growth run as a fallback. Deterministic: anchors nearest the
 * seed first, wider before taller.
 */
function growFootprint(g, sx, sy, n, bounds, ground = isOutskirts) {
  const rect = TIER_RECT[n];
  if (rect) {
    const cands = [];
    for (const [w, h] of [rect, [rect[1], rect[0]]]) {
      for (let ay = sy - h + 1; ay <= sy; ay++) {
        for (let ax = sx - w + 1; ax <= sx; ax++) {
          const cells = [];
          let ok = true;
          for (let dy = 0; dy < h && ok; dy++) {
            for (let dx = 0; dx < w && ok; dx++) {
              const x = ax + dx;
              const y = ay + dy;
              if (
                !g.inBounds(x, y) ||
                !ground(g, x, y, bounds) ||
                g.kindAt(x, y) !== CELL_KIND.EMPTY
              ) {
                ok = false;
                break;
              }
              cells.push([x, y]);
            }
          }
          if (!ok) continue;
          const dist = Math.abs(ax + (w - 1) / 2 - sx) + Math.abs(ay + (h - 1) / 2 - sy);
          cands.push({ cells, dist, wide: w >= h ? 0 : 1 });
        }
      }
    }
    // De-dupe orientations that coincide (squares), then nearest first.
    const seen = new Set();
    const uniq = cands.filter((c) => {
      const k = c.cells.map(([x, y]) => `${x},${y}`).sort().join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    uniq.sort((a, b) => a.dist - b.dist || a.wide - b.wide);
    if (uniq.length) return uniq[0].cells;
  }
  return growBlob(g, sx, sy, n, bounds, ground);
}

/**
 * Grow a compact block of `n` free outskirts cells from a seed. Candidates
 * with more claimed neighbours win. The rectangle path above covers every
 * declared tier size; this stays as the fallback for odd counts and cramped
 * ground.
 */
function growBlob(g, sx, sy, n, bounds, ground = isOutskirts) {
  const cells = [[sx, sy]];
  const have = new Set([key(sx, sy)]);
  const free = (x, y) =>
    g.inBounds(x, y) &&
    ground(g, x, y, bounds) &&
    g.kindAt(x, y) === CELL_KIND.EMPTY &&
    !have.has(key(x, y));

  while (cells.length < n) {
    const cands = [];
    for (const [cx, cy] of cells) {
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!free(nx, ny)) continue;
        if (cands.some((c) => c[0] === nx && c[1] === ny)) continue;
        let touch = 0;
        for (const [ax, ay] of DIRS) if (have.has(key(nx + ax, ny + ay))) touch++;
        cands.push([nx, ny, touch]);
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b[2] - a[2]);
    const [bx, by] = cands[0];
    have.add(key(bx, by));
    cells.push([bx, by]);
  }
  return cells;
}

/** The direction from a site to the road it was connected to. */
function faceToRoad(g, cells) {
  for (const [x, y] of cells) {
    for (const [dx, dy] of DIRS) {
      if (g.isRoad(x + dx, y + dy)) return { x: dx, z: dy };
    }
  }
  return { x: 0, z: 1 };
}

/** Reachable empty outskirts cells from a seed, used to size a lake site. */
function freeRegion(g, x, y, b) {
  const seen = new Set([key(x, y)]);
  const out = [];
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    out.push([cx, cy]);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (!g.inBounds(nx, ny)) continue;
      if (!isOutskirts(g, nx, ny, b)) continue;
      if (g.kindAt(nx, ny) !== CELL_KIND.EMPTY) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return { cells: out, seen };
}

/**
 * Every connected empty-outskirts region, flooded ONCE, and a lookup from cell
 * to its region.
 *
 * `carveLake` used to call `freeRegion` once per candidate cell, and every cell
 * of a region recomputed the identical flood — O(outskirts²) for one lake. The
 * enlargement of the map made that visibly worse (measured on an empty grid:
 * 49 ms at 34×28, 543 ms at 48×40, 1,858 ms at 64×48). One pass labels the
 * whole outskirts, so the cost is linear and every cell still gets exactly the
 * region it got before.
 *
 * Determinism is preserved deliberately: the candidate scan still walks the grid
 * in the same order and draws the same one `rng.float` per surviving candidate,
 * so a seed produces the same lake it always did.
 */
function labelFreeRegions(g, b) {
  const regionOf = new Map();
  const regions = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (regionOf.has(key(x, y))) continue;
      if (g.kindAt(x, y) !== CELL_KIND.EMPTY) continue;
      if (!isOutskirts(g, x, y, b)) continue;
      const region = freeRegion(g, x, y, b);
      regions.push(region);
      for (const [cx, cy] of region.cells) regionOf.set(key(cx, cy), region);
    }
  }
  return { regionOf, regions };
}

/**
 * Pick a lake site and grow a compact blob of `target` cells around the best
 * seed. Growth prefers cells already touching the lake, so the result reads as
 * a pond rather than a snake, and never leaves the free region it started in.
 */
function carveLake(g, rng, b, target, compact = false) {
  // One pass labels every connected empty-outskirts region; the candidate scan
  // then looks its region up instead of re-flooding it. Same cells, same scores,
  // same rng draws — linear instead of quadratic.
  const { regionOf } = labelFreeRegions(g, b);
  const cands = [];
  g.forEach((x, y, grid) => {
    if (!isOutskirts(grid, x, y, b)) return;
    if (grid.kindAt(x, y) !== CELL_KIND.EMPTY) return;
    const region = regionOf.get(key(x, y));
    if (!region || region.cells.length < LAKE_MIN) return;
    const reach = reachOf(x, y, b, MAX_SPUR + 4);
    cands.push({ x, y, region, score: (compact ? -reach : reach) * 1.6 + rng.float(0, 6) });
  });
  if (!cands.length) return null;
  cands.sort((a, c) => c.score - a.score);

  const want = Math.min(target, LAKE_MAX);
  for (let n = 0; n < Math.min(cands.length, LAKE_TRIES); n++) {
    const lake = growLake(rng, cands[n], want);
    if (lake.length < LAKE_MIN) continue;
    // Reachability is decided HERE, not by the caller. The old shape grew a
    // lake from the single best-scoring seed and let the caller discover the
    // spur did not fit — which discarded the entire water supply with no
    // fallback. On a large extent the best-scoring seed is often unreachable,
    // so "best" has to mean "best that we can actually service".
    const spur = spurPath(g, lake, MAX_SPUR + 4);
    if (!spur) continue;
    return { lake, spur };
  }
  return null;
}

/** How many lake seeds to try before giving up on a water supply. */
const LAKE_TRIES = 12;

/** Grow a compact blob of water from one seed cell, inside its free region. */
function growLake(rng, seed, want) {
  const lake = [[seed.x, seed.y]];
  const inLake = new Set([key(seed.x, seed.y)]);
  const allowed = seed.region.seen;

  const neighbours = (cx, cy) => {
    const out = [];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (inLake.has(k) || !allowed.has(k)) continue;
      if (Math.max(Math.abs(nx - seed.x), Math.abs(ny - seed.y)) > LAKE_REACH) continue;
      out.push([nx, ny]);
    }
    return out;
  };

  let frontier = neighbours(seed.x, seed.y);
  while (lake.length < want && frontier.length) {
    let best = null;
    let bestScore = -Infinity;
    for (const [nx, ny] of frontier) {
      let touch = 0;
      for (const [dx, dy] of DIRS) if (inLake.has(key(nx + dx, ny + dy))) touch++;
      const score = touch * 2 + rng.float(0, 2.5);
      if (score > bestScore) {
        bestScore = score;
        best = [nx, ny];
      }
    }
    const [bx, by] = best;
    inLake.add(key(bx, by));
    lake.push([bx, by]);
    frontier = [...frontier.filter(([fx, fy]) => !inLake.has(key(fx, fy))), ...neighbours(bx, by)];
    frontier = [...new Map(frontier.map((c) => [key(c[0], c[1]), c])).values()];
  }
  return lake;
}

export class ResourceSystem {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'resources';
    this.feedbackGroup = new THREE.Group();
    this.feedbackGroup.name = 'resource-update-feedback';
    this.group.add(this.feedbackGroup);
    this.feedbackPulses = [];
    this.sites = [];
    this.owned = new Set();
    this.rotors = [];
    this.rr = { farm: 0, power: 0, fuel: 0 };
    this.production = blank(() => 0);
    this.capacity = { ...BASE_STORAGE };
    this.levels = blank(() => 0);
    this.shortage = blank(() => false);
    // Fuel leaves at the pump, not at the day boundary, so its real appetite is
    // measured here rather than modelled (see `dispenseFuel` / `demandNow`).
    this.fuelIssued = 0;
    this.fuelDemand = 0;
    this.fuelImported = 0;
    this.fuelImportCost = 0;
    this.waterImported = 0;
    this.waterImportCost = 0;
    this.waterImportedToday = 0;
    // Site level per resource (1..3): every rated output of that resource is
    // multiplied by it — the UPGRADE_RESOURCE lever when demand outgrows the
    // founding sites.
    this.siteLevel = blank(() => 1);
    this.lastDay = null;
    this.townRef = null;
    this.mesh = null;
    this.core = null;
    // Phase 15 — written only by PolicySystem (a `resourceBuffer` scheme).
    this.bufferBonus = 0;
    // Phase 17 — written only by the innovation ladder's `yield` lever.
    this.yieldBonus = 0;
  }

  clear() {
    if (this.group) {
      for (const c of [...this.group.children]) {
        this.group.remove(c);
        c.traverse?.((node) => {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) material.dispose?.();
          }
        });
      }
    }
    this.feedbackGroup = new THREE.Group();
    this.feedbackGroup.name = 'resource-update-feedback';
    this.group.add(this.feedbackGroup);
    this.feedbackPulses = [];
    this.sites = [];
    this.owned = new Set();
    this.rotors = [];
    this.production = blank(() => 0);
    this.capacity = { ...BASE_STORAGE };
    this.levels = blank(() => 0);
    this.shortage = blank(() => false);
    this.siteLevel = blank(() => 1);
    this.fuelIssued = 0;
    this.fuelDemand = 0;
    this.fuelImported = 0;
    this.fuelImportCost = 0;
    this.waterImported = 0;
    this.waterImportCost = 0;
    this.waterImportedToday = 0;
    this.lastDay = null;
    this.mesh = null;
    this.core = null;
    this.bufferBonus = 0;
    this.yieldBonus = 0;
  }

  ownsCell(x, y) {
    return this.owned.has(key(x, y));
  }

  /**
   * The site a citizen with a farm or power job reports to, round-robin over
   * the sites so the crews spread out. Shaped like a building record because
   * the citizen state machine walks to `doorWorld` and steps inside it.
   */
  workplace(kind) {
    const pool = this.sites.filter((s) => s.work === kind && s.connected);
    if (!pool.length) return null;
    const i = this.rr[kind] % pool.length;
    this.rr[kind] = i + 1;
    const site = pool[i];
    if (!site.door) site.door = this.makeDoor(site);
    return site.door;
  }

  makeDoor(site) {
    const g = this.townRef.grid;
    const face = site.face || faceToRoad(g, site.cells);
    const cell =
      site.cells.find(([cx, cy]) => g.isRoad(cx + face.x, cy + face.z)) || site.cells[0];
    const p = g.cellToWorld(cell[0], cell[1]);
    const y0 = g.heightAtWorld(p.x, p.z);
    return {
      site,
      cell,
      face,
      kind: 'site',
      purpose: 'resource',
      name: SITE_LABEL[site.kind],
      doorWorld: new THREE.Vector3(
        p.x + face.x * (CELL / 2 - 0.4),
        y0,
        p.z + face.z * (CELL / 2 - 0.4)
      )
    };
  }

  /** Citizens employed at the sited workplaces, by workforce. */
  activeSiteWorkers() {
    const counts = new Map(this.sites.map((s) => [s, 0]));
    for (const c of this.townRef?.pedestrians?.citizens || []) {
      const site = this.sites.find((s) => s.door && s.door === c.work && s.connected && s.work === c.p?.job?.work);
      if (site && c.p?.employmentStatus === 'employed' && c.p.age >= 18 && c.p.age < 66)
        counts.set(site, counts.get(site) + 1);
    }
    return counts;
  }
  staffCounts() {
    const out = Object.fromEntries(CREW_ROLES.map((r) => [r, 0]));
    for (const [site, count] of this.activeSiteWorkers()) if (site.work in out) out[site.work] += count;
    return out;
  }

  /* ---------------------------------------------------------------- planning */

  plan(town, rng) {
    this.clear();
    this.townRef = town;
    const g = town.grid;
    const bounds = coreBounds(g);
    const counts = townCounts(town, plannedPopulation(town));
    const demand = {};
    for (const k of ORDER) demand[k] = demandOf(k, counts);

    if (bounds) {
      this.core = bounds;
      const lakeTarget = Math.ceil((demand.water * SURPLUS) / OUTPUT.lake);
      // A water body the network cannot reach is not sited: no access, no lake.
      // carveLake already rejected unreachable seeds, so whatever comes back
      // here has a spur that fits.
      const carved = carveLake(g, rng, bounds, Math.max(LAKE_MIN, Math.min(LAKE_MAX, lakeTarget)), true);
      if (carved) {
        const { lake, spur: lakeSpur } = carved;
        for (const [x, y] of lake) {
          g.setKind(x, y, CELL_KIND.WATER);
          g.zone[g.idx(x, y)] = null;
          g.owner[g.idx(x, y)] = null;
        }
        this.claim(lake);
        carveRoad(g, lakeSpur);
        this.sites.push({
          id: town.nextEntityId ? town.nextEntityId('resource') : `resource-lake-${this.sites.length + 1}`,
          kind: 'lake', cells: lake, spur: lakeSpur, work: null, face: faceToRoad(g, lake),
          ownerType: 'government', ownerId: 'government', fixedCapital: 0
        });
      }

      // The energy order. The first three are the guaranteed founding mix —
      // turbine, solar, turbine — unchanged, so a town always opens with both
      // sources and the same rated output as before. After that the turbines
      // come CONSECUTIVELY rather than alternating, because a wind farm is a
      // group: interleaving them with solar meant no two turbines were ever
      // placed near each other.
      const order = ['reservoir', 'silo'];
      const energyTarget = demand.energy * SURPLUS;
      const pattern = ['windmill', 'solar', 'windmill', 'windmill', 'windmill', 'solar', 'windmill'];
      let energyRated = 0;
      for (let i = 0; i < Math.min(pattern.length, MAX_ENERGY_SITES); i++) {
        // A founding town always gets MIN_ENERGY_SITES of them, whatever the
        // demand works out at. The demand test used to stop at three, which
        // meant the founding town opened with two turbines and one solar panel —
        // two turbines cannot read as a wind farm no matter how close together
        // they are, so the spacing work was invisible. Five sites is four
        // turbines and a panel: a farm, and enough generation that the store
        // starts above half rather than scraping along.
        if (i >= MIN_ENERGY_SITES && energyRated >= energyTarget) break;
        order.push(pattern[i]);
        energyRated += OUTPUT[pattern[i]];
      }
      const farms = Math.max(1, Math.min(MAX_FARMS, Math.ceil((demand.food * SURPLUS) / OUTPUT.farm)));
      // First site is always the staple farm; the rest rotate through
      // livestock and poultry so the food chain reads as mixed husbandry.
      const foodKinds = ['farm', 'husbandry', 'poultry'];
      for (let i = 0; i < farms; i++) order.push(foodKinds[i % foodKinds.length]);
      // Phase 14 — the founding fleet always needs one pump; keep adding
      // while rated throughput sits under planned demand, up to the cap.
      // Sited BEFORE the optional third farm because a pump is a primary
      // resource the town cannot run without, and the outskirts run out.
      let fuelRated = 0;
      for (let i = 0; i < MAX_FUEL_SITES; i++) {
        if (i >= 1 && fuelRated >= demand.fuel * SURPLUS) break;
        order.push('gas');
        fuelRated += OUTPUT.gas;
      }

      // SITE_GAP is the founding plan's scenery spread, but a boot town's
      // outskirts do not stretch forever: a site that cannot be sited at the
      // full gap is retried on compact land rather than silently dropped —
      // a missing primary resource is a much worse town than a tight one.
      for (const kind of order) {
        // Turbs are clustered: the first takes the ordinary far-outskirts site,
        // and each later one steers in beside the ones already up, so the
        // founding plan lays out a wind farm rather than a scatter of masts.
        const cluster = kind === 'windmill' ? WIND_FARM : null;
        if (this.placeSite(g, rng, bounds, kind, cluster ? { cluster, compact: true, gap: 1 } : { compact: true, gap: 1 })) continue;
        for (const gap of GAP_LADDER) {
          if (this.placeSite(g, rng, bounds, kind, cluster ? { cluster, gap: Math.min(1, gap), compact: true } : { gap: Math.min(1, gap), compact: true })) break;
        }
      }
    }

    g.computeRoadMask();
    this.build(town, rng);
    // Fresh town: start the stores part full so the gauges have somewhere to go.
    for (const k of ORDER) this.levels[k] = this.capacity[k] * INITIAL_FILL;
    this.shortage = blank(() => false);
    return this;
  }

  claim(cells) {
    for (const [x, y] of cells) this.owned.add(key(x, y));
  }

  /**
   * Find the best free outskirts cell for a site, claim its yard, road-connect
   * it. `opts.gap` relaxes the SITE_GAP scenery spacing — deficit growth takes
   * what land it can (SITE_GAP is the founding plan's spread, and a town short
   * on output cannot insist on it).
   *
   * `opts.cluster` turns the siting inside out: instead of scoring land by how
   * far it is from town, it scores it by how close it is to the existing sites
   * of the same kind. That is what makes a wind farm — otherwise every turbine
   * competes for the furthest corner of the outskirts and they end up strung out
   * along the map edge, a dozen turbines no two of them near each other.
   */
  placeSite(g, rng, bounds, kind, opts = {}) {
    const cluster = opts.cluster || null;
    const gap = opts.gap ?? (cluster ? cluster.gap : SITE_GAP);
    // Agriculture sites at their tier-1 yard (every new site starts at level
    // 1 and grows through upgrades); everything else keeps its flat rate.
    const tierCells = AG_TIERS[kind] ? AG_TIERS[kind][0].cells : null;
    const need = opts.cells ?? tierCells ?? SITE_FOOT[kind] ?? 1;
    const ground = kind === 'gas' ? isFuelGround : isOutskirts;
    // Where the cluster already is — the middle of its existing members. Null
    // for the first of a kind, which then sits by the ordinary far-outskirts
    // rule and becomes the seed the rest gather around.
    const anchor = cluster ? this.clusterAnchor(cluster.of) : null;
    const cands = [];
    g.forEach((x, y, grid) => {
      if (!ground(grid, x, y, bounds)) return;
      if (grid.kindAt(x, y) !== CELL_KIND.EMPTY) return;
      if (this.tooClose(x, y, gap)) return;
      const score = anchor
        ? CLUSTER_PULL - chebyshev(x, y, anchor) + rng.float(0, 3)
        : kind === 'gas'
          ? -Math.max(0, depthOf(x, y, bounds)) * 2 + rng.float(0, 6)
          : (opts.compact ? -reachOf(x, y, bounds, MAX_SPUR) * 2 : reachOf(x, y, bounds, MAX_SPUR) * 2) + rng.float(0, 6);
      cands.push([x, y, score]);
    });
    cands.sort((a, b) => b[2] - a[2]);
    for (const [x, y] of cands) {
      const cells = growFootprint(g, x, y, need, bounds, ground);
      if (!cells) continue;
      if (cells.some(([cx, cy]) => this.tooClose(cx, cy, gap))) continue;
      const spur = spurPath(g, cells);
      if (!spur) continue;
      this.claim(cells);
      carveRoad(g, spur);
      for (const [cx, cy] of cells) {
        g.setKind(cx, cy, CELL_KIND.LOT);
        g.zone[g.idx(cx, cy)] = null;
      }
      this.sites.push({
        id: this.townRef?.nextEntityId ? this.townRef.nextEntityId('resource') : `resource-${kind}-${this.sites.length + 1}`,
        kind,
        cells,
        spur,
        work: SITE_WORK[kind] || null,
        // Pumps are public-facing civic infrastructure in the land-use
        // model. They remain resource producers for fuel accounting, but are
        // never classified as industrial works or pushed to the remote rim.
        planningClass: kind === 'gas' ? 'civic' : 'resource',
        publicFacing: kind === 'gas',
        facility: kind === 'gas' ? 'fuel-station' : null,
        face: faceToRoad(g, cells),
        ownerType: 'government',
        ownerId: 'government',
        fixedCapital: opts.fixedCapital || 0
      });
      return true;
    }
    return false;
  }

  /**
   * The middle of the sites of a given kind, or null if there are none yet.
   * This is what a clustered site steers towards.
   */
  clusterAnchor(kind) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const s of this.sites) {
      if (s.kind !== kind) continue;
      for (const [cx, cy] of s.cells) {
        sx += cx;
        sy += cy;
        n++;
      }
    }
    return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
  }

  tooClose(x, y, gap = SITE_GAP) {
    for (const s of this.sites) {
      for (const [sx, sy] of s.cells) {
        if (Math.max(Math.abs(sx - x), Math.abs(sy - y)) <= gap) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ build */

  /** Validate the sited cells against the live grid, then render + rate them. */
  build(town, rng) {
    this.townRef = town;
    const g = town.grid;
    const group = this.group;

    const before = this.sites;
    // A facility is one yard: lose any cell of it (bulldozed, built over) and
    // the site goes with it, rather than shrinking into a shape the geometry
    // was never laid out for.
    this.sites = before.filter((s) =>
      s.cells.every(
        ([x, y]) =>
          g.inBounds(x, y) &&
          (s.kind === 'lake' ? g.isWater(x, y) : g.kindAt(x, y) === CELL_KIND.LOT)
      )
    );
    // Drop cells whose site has gone (bulldozed) so the lot renderer takes
    // them back over.
    this.owned = new Set();
    for (const s of this.sites) for (const [x, y] of s.cells) this.owned.add(key(x, y));

    // A site that no longer exists cannot keep staff: they fall back to home
    // until the next assignment.
    const gone = before.filter((s) => !this.sites.includes(s));
    if (gone.length) {
      const doors = new Set(gone.map((s) => s.door).filter(Boolean));
      if (doors.size) {
        for (const c of town.pedestrians?.citizens || []) {
          if (c.work && doors.has(c.work)) c.work = null;
        }
      }
    }

    const reachable = reachableRoads(g);
    for (const s of this.sites) {
      s.connected = s.cells.some(([x, y]) =>
        DIRS.some(([dx, dy]) => reachable.has(key(x + dx, y + dy)))
      );
      if (!s.connected && s.door) {
        for (const c of town.pedestrians?.citizens || []) if (c.work === s.door) c.work = null;
      }
    }

    this.capacity = this.computeCapacity();
    this.production = this.computeProduction();
    for (const k of ORDER) this.levels[k] = Math.min(this.levels[k], this.capacity[k]);

    for (const c of [...group.children]) {
      if (c === this.feedbackGroup) continue;
      group.remove(c);
      c.traverse?.((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) material.dispose?.();
        }
      });
    }
    this.mesh = null;
    this.rotors = [];

    const geos = [];
    let mills = 0;
    for (const s of this.sites) {
      if (s.kind === 'lake') continue; // rendered as water tiles by the Road Kit
      const parts = siteParts(s.kind, g, s.cells, s.level || 1);
      geos.push(...parts.static);
      if (parts.rotor) {
        const rotor = buildMesh([parts.rotor.geo], { roughness: 0.55 });
        if (rotor) {
          rotor.name = 'rotor';
          rotor.position.set(parts.rotor.at[0], parts.rotor.at[1], parts.rotor.at[2]);
          group.add(rotor);
          this.rotors.push({ mesh: rotor, speed: 0.75 + (mills % 3) * 0.12 });
          mills++;
        }
      }
    }
    const mesh = buildMesh(geos, { roughness: 0.86 });
    if (mesh) {
      mesh.name = 'resources';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      this.mesh = mesh;
    }
    return this;
  }

  /** Cost to raise `resource` one site level; 0 when capped or unknown. */
  upgradeTarget(resource, kind = null) {
    const pending = this.townRef?.growth?.pendingTargets;
    const cands = this.sites.filter(
      (s) =>
        SITE_RESOURCE[s.kind] === resource &&
        // A pure storehouse has no rated output and no level-scaled storage,
        // so raising it burns treasury for literally nothing. The old `.find`
        // happily picked reservoirs and silos as upgrade targets.
        !STOREHOUSE[s.kind] &&
        (s.level || 1) < MAX_SITE_LEVEL &&
        !(pending && pending.has(s))
    );
    if (kind) return cands.find((s) => s.kind === kind) || null;
    // Cheapest first: a level-1 raise buys the same absolute output as a
    // level-2 raise for half the money, so the lowest tier always goes first.
    // (The old first-found order filled the oldest site to cap before touching
    // the next — same total spend, worse spread of output.)
    cands.sort((a, b) => (a.level || 1) - (b.level || 1));
    return cands[0] || null;
  }
  upgradeCost(resource, kind = null) {
    if (!ORDER.includes(resource)) return 0;
    const site = this.upgradeTarget(resource, kind);
    if (!site) return 0;
    const lvl = site.level || 1;
    return lvl >= MAX_SITE_LEVEL ? 0 : UPGRADE_COST[resource] * lvl;
  }

  /**
   * Raise one resource's site level (UPGRADE_RESOURCE); rates recompute.
   * Agriculture tiers also claim the land the new tier works: the yard grows
   * toward the tier's rectangle (see expandSite). A level whose yard cannot
   * grow still rises — better breeds and equipment, same fence line — and is
   * marked `crowded` so the inspector says why the yard did not follow.
   */
  upgrade(resource, site = this.upgradeTarget(resource)) {
    if (!site || SITE_RESOURCE[site.kind] !== resource || (site.level || 1) >= MAX_SITE_LEVEL || !this.sites.includes(site)) return false;
    const fromLevel = site.level || 1;
    site.level = (site.level || 1) + 1;
    this.siteLevel[resource] = Math.max(this.siteLevel[resource] || 1, site.level);
    const tier = agTierOf(site);
    if (tier) {
      const grown = this.expandSite(site, tier.cells);
      site.crowded = !grown;
      // New ground, new geometry: re-render the yards (the door stays — the
      // old cells are all retained, so citizen work refs keep pointing at a
      // door that still exists on ground the site still owns).
      if (grown && this.townRef) this.build(this.townRef);
    }
    this.production = this.computeProduction();
    const feedback = {
      resource,
      resourceLabel: RESOURCE_LABEL[resource] || resource,
      kind: site.kind,
      siteLabel: SITE_LABEL[site.kind] || site.kind,
      fromLevel,
      toLevel: site.level,
      cells: site.cells.length,
      crowded: !!site.crowded,
      siteId: site.id || null
    };
    this.showUpgradeFeedback(site, feedback);
    events.emit('resource-update', feedback);
    return true;
  }

  /** Add a short-lived world-space pulse at the upgraded yard. */
  showUpgradeFeedback(site, feedback) {
    const g = this.townRef?.grid;
    if (!g || !site || !this.feedbackGroup) return;
    const frame = siteFrame(g, site.cells);
    const y = g.heightAtWorld(frame.x, frame.z) + 0.18;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.72, 36),
      new THREE.MeshBasicMaterial({
        color: feedback.crowded ? 0xe3b341 : 0x7ee787,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(frame.x, y, frame.z);
    ring.userData.resourceUpdate = feedback;
    this.feedbackGroup.add(ring);
    this.feedbackPulses.push({ mesh: ring, age: 0, duration: 2.8 });
  }

  updateUpgradeFeedback(dt) {
    if (!this.feedbackPulses?.length) return;
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    for (let i = this.feedbackPulses.length - 1; i >= 0; i--) {
      const pulse = this.feedbackPulses[i];
      pulse.age += step;
      const t = Math.min(1, pulse.age / pulse.duration);
      pulse.mesh.scale.setScalar(1 + t * 2.8);
      if (pulse.mesh.material) pulse.mesh.material.opacity = (1 - t) * 0.95;
      if (t >= 1) {
        this.feedbackGroup.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        pulse.mesh.material.dispose();
        this.feedbackPulses.splice(i, 1);
      }
    }
  }

  /**
   * Grow a site's yard toward `target` cells, keeping every cell it already
   * holds and filling an exact rectangle around them. Tries every placement of
   * the target rectangle that contains the current yard, deepest-outskirts
   * first so growth pushes away from town, and claims the first that fits on
   * free, unowned, outskirts ground flush against (but never overlapping)
   * other yards. Returns true when the yard grew.
   */
  expandSite(site, target) {
    const g = this.townRef?.grid;
    if (!g || !site || site.cells.length >= target) return site?.cells.length > 0;
    const rect = TIER_RECT[target];
    if (!rect) return false;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of site.cells) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const bounds = coreBounds(g);
    const own = new Set(site.cells.map(([x, y]) => key(x, y)));
    const freeForYard = (x, y) => {
      if (!g.inBounds(x, y) || own.has(key(x, y))) return true;
      if (g.kindAt(x, y) !== CELL_KIND.EMPTY) return false;
      // No outskirts test here, deliberately: siting a NEW yard requires
      // outskirts, but growing one does not — the access spur this very site
      // carved extends the measured road bounds, so re-testing would refuse
      // the site its own surroundings. Growth still prefers outward ground
      // (placements sort by depth below); it just does not forbid infill.
      if (this.owned.has(key(x, y))) return false;
      // Other yards may sit flush, never overlap: only claimed cells refuse.
      for (const s of this.sites) {
        if (s === site) continue;
        for (const [sx, sy] of s.cells) {
          if (sx === x && sy === y) return false;
        }
      }
      return true;
    };
    const placements = [];
    for (const [w, h] of [rect, [rect[1], rect[0]]]) {
      for (let ay = y1 - h + 1; ay <= y0; ay++) {
        for (let ax = x1 - w + 1; ax <= x0; ax++) {
          const fresh = [];
          let ok = true;
          for (let dy = 0; dy < h && ok; dy++) {
            for (let dx = 0; dx < w && ok; dx++) {
              const x = ax + dx;
              const y = ay + dy;
              if (!freeForYard(x, y)) { ok = false; break; }
              if (!own.has(key(x, y))) fresh.push([x, y]);
            }
          }
          if (!ok || !fresh.length) continue;
          let depth = 0;
          if (bounds) for (const [x, y] of fresh) depth += depthOf(x, y, bounds);
          placements.push({ fresh, depth });
        }
      }
    }
    if (!placements.length) return false;
    placements.sort((a, b) => b.depth - a.depth);
    const win = placements[0];
    this.claim(win.fresh.map(([x, y]) => [x, y]));
    for (const [x, y] of win.fresh) {
      g.setKind(x, y, CELL_KIND.LOT);
      g.zone[g.idx(x, y)] = null;
    }
    site.cells = [...site.cells, ...win.fresh].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    site.face = faceToRoad(g, site.cells);
    return true;
  }

  /** Hands a site needs: the tier crew for agriculture, the flat rate otherwise. */
  siteCrew(site) {
    const tier = agTierOf(site);
    if (tier) return tier.crew;
    return SITE_CREW[site?.work]?.crew || 0;
  }

  /** The resource a site kind serves (validates a council `kind=` pin). */
  kindOfResource(kind) {
    return SITE_RESOURCE[kind] || null;
  }

  /**
   * Human label for the tier an upgrade would take this site to.
   *
   * States the EFFECTIVE output at that tier, not the rated one, because an
   * upgrade can raise the crew requirement as well as the yield — the level-3
   * farm needs four hands where level 2 needed three, so a town with two farmers
   * buys an "Estate farm (220 t/day)" and gets 110. The delivered figure is
   * `tier.output × min(1, crew / tier.crew)`, and that is what a label promising
   * a return on $120,000 has to show.
   */
  nextTierLabel(site) {
    const ladder = site && AG_TIERS[site.kind];
    if (!ladder) return `site level ${(site?.level || 1) + 1}`;
    const idx = Math.min(ladder.length - 1, site.level || 1);
    const next = ladder[idx];
    const need = next.crew ?? 1;
    const have = this.activeSiteWorkers().get(site) || 0;
    const staffing = need > 0 ? Math.min(1, have / need) : 1;
    const effective = Math.round(next.output * staffing * (1 + (this.yieldBonus || 0)));
    const unit = RESOURCE_FLOW_UNIT[SITE_RESOURCE[site.kind]];
    if (effective < next.output) {
      return `${next.label} (${effective} ${unit} with ${have}/${need} crew)`;
    }
    return `${next.label} (${next.output} ${unit})`;
  }

  /**
   * What the installed sites WOULD produce if they were fully crewed.
   *
   * `computeProduction` divides by crew, so it collapses when the town has no
   * workers — and `growSites` read that collapse as "not enough turbines",
   * buying land against a labour shortage. With the whole workforce retired it
   * bought 6 sites for −$292,277 that produced nothing, then made 1,392 further
   * placement attempts that all failed, with no backoff and nothing logged
   * (measured). The population is the binding constraint there, and the
   * mechanism was spending against land.
   *
   * This is the capacity question, asked of capacity.
   */
  ratedProduction() {
    const out = blank(() => 0);
    for (const s of this.sites) {
      if (!s.connected) continue;
      const res = SITE_RESOURCE[s.kind];
      if (s.kind === 'lake') out[res] += s.cells.length * OUTPUT.lake * (s.level || 1);
      else if (OUTPUT[s.kind]) {
        const tier = agTierOf(s);
        out[res] += tier ? tier.output : OUTPUT[s.kind] * (s.level || 1);
      }
    }
    for (const k of ORDER) out[k] = Math.round(out[k] * (1 + (this.yieldBonus || 0)));
    return out;
  }

  /**
   * A resource is short for one of two reasons, and they need different
   * answers: the town has too little CAPACITY, or it has capacity nobody is
   * working. Only the first is a reason to buy land.
   */
  shortfallCause(res, demand) {
    const rated = this.ratedProduction()[res] || 0;
    const actual = this.production[res] || 0;
    if (rated >= demand * SURPLUS) return 'understaffed';
    return 'capacity';
  }

  computeProduction() {
    const out = blank(() => 0);
    const staff = this.activeSiteWorkers();
    for (const s of this.sites) {
      if (!s.connected) continue;
      const res = SITE_RESOURCE[s.kind];
      if (s.kind === 'lake') out[res] += s.cells.length * OUTPUT.lake * (s.level || 1);
      else if (OUTPUT[s.kind]) {
        const required = this.siteCrew(s);
        const staffing = s.work && required
          ? Math.min(1, (staff.get(s) || 0) / required)
          : 1;
        // Agriculture rates from its tier row — the tier IS the level, so no
        // further (s.level || 1) multiplier here or every upgrade pays twice.
        const tier = agTierOf(s);
        const rated = tier ? tier.output : OUTPUT[s.kind] * (s.level || 1);
        out[res] += rated * staffing;
        // Remember what this site is actually producing, so `describe` and the
        // upgrade label can report the effective figure rather than the rated
        // one. A level-3 farm needs 4 crew and the town has 2 farmers: it is
        // advertised at 220 t/day and delivers 110, and the upgrade that raises
        // the crew requirement is sold on the promise of the 220.
        s.effectiveOutput = rated * staffing;
        s.ratedOutput = rated;
        s.staffing = staffing;
      }
    }
    // Site level scales every producer of that resource (better pumps,
    // turbines, yield) — the water lake included, since its cells count
    // against OUTPUT.lake. Phase 17's `yieldBonus` is the innovation ladder's
    // lever on this same multiplier, so a research gain lands exactly where an
    // upgrade would.
    for (const k of ORDER) {
      out[k] = Math.round(out[k] * (1 + (this.yieldBonus || 0)));
    }
    return out;
  }

  computeCapacity() {
    const out = { ...BASE_STORAGE };
    for (const s of this.sites) {
      if (!STORAGE[s.kind]) continue;
      out[SITE_RESOURCE[s.kind]] += STORAGE[s.kind];
    }
    // Phase 15 — a scheme with `resourceBuffer` widens every store by that
    // fraction of its base, which is the same BUFFER_DAYS the founding plan
    // sized for, so a winter can be weathered.
    const bonus = this.bufferBonus || 0;
    if (bonus) {
      for (const k of ORDER) out[k] = Math.round(out[k] * (1 + bonus));
    }
    return out;
  }

  /**
   * Phase 15 — storage is a capacity, not a rate, so a `resourceBuffer` scheme
   * has to be pushed through the same recompute `build()` uses, or the gauges
   * would keep quoting the pre-scheme figure. Levels are clamped, never raised.
   */
  refreshPolicy() {
    if (!this.townRef) return;
    const cap = this.computeCapacity();
    for (const k of ORDER) {
      if (cap[k] === this.capacity[k]) continue;
      this.capacity[k] = cap[k];
      this.levels[k] = Math.min(this.levels[k] || 0, cap[k]);
    }
  }

  /**
   * Phase 36 (S19g) — production is a function of STAFFING as well as of
   * sites, and nothing recomputed it when the staffing changed.
   *
   * `build()` computes production, and so does `upgrade()` — but `build()` runs
   * during seeding, *before* any citizen has been assigned work, so
   * `staffCounts()` is all zeros and every crewed site scores
   * `min(1, 0/required) = 0`. The founding town therefore sat at
   * **energy 0/303, food 0/75, fuel 0/77 for the whole of day 1**, with the
   * water lake the only producer (it has no crew) — and the HUD, the council's
   * report and every gauge read that as a town in permanent deficit until the
   * first day boundary recomputed it.
   *
   * Rather than add another call site that someone has to remember (the failure
   * mode of the two that exist), production is now **recomputed when its inputs
   * change**, keyed on a signature of exactly those inputs — the same
   * signature-cached idiom `PolicySystem.stats()` already uses. Cheap: one short
   * string per read, and a recompute only when a site, a level, a crew count or
   * the research bonus actually moved.
   */
  productionSignature() {
    const workers = this.activeSiteWorkers();
    const sites = this.sites.map((s) => `${s.kind}:${s.connected ? 1 : 0}:${s.level || 1}:${workers.get(s) || 0}`).join(',');
    return `${sites}|${(this.yieldBonus || 0).toFixed(3)}`;
  }

  /** Recompute production if any of its inputs moved since the last call. */
  syncProduction() {
    const sig = this.productionSignature();
    if (sig === this._prodSig) return this.production;
    this._prodSig = sig;
    this.production = this.computeProduction();
    return this.production;
  }

  /* -------------------------------------------------------------- simulation */

  demandNow(town) {
    const counts = townCounts(town, town.pedestrians?.citizens?.length || 0);
    const out = {};
    for (const k of ORDER) out[k] = demandOf(k, counts);
    // Fuel is drawn at the PUMP, not at the day boundary, so `FUEL_PER_VEHICLE`
    // is a MODEL of the fleet's appetite and the pumps' issue is the TRUTH.
    //
    // The measurement has to be able to REPLACE the model, not merely raise it.
    // `Math.max(model, measured)` made the model a floor the truth could never
    // lower, so the ~44 L/day by which the model over-estimated a 12-vehicle
    // fleet was permanently charged, while the store was never debited for it at
    // all — a phantom demand that gates imports and buys pumps.
    const measured = Math.round(this.fuelDemand || 0);
    out[RESOURCE.FUEL] = measured > 0 ? measured : out[RESOURCE.FUEL];
    return out;
  }

  operatingGasSites() {
    const workers = this.activeSiteWorkers();
    return this.sites.filter((site) => site.kind === 'gas' && site.connected && (workers.get(site) || 0) > 0);
  }

  dispenseFuel(site, requested) {
    if (!this.operatingGasSites().includes(site)) return 0;
    const amount = Math.max(0, Math.min(Number(requested) || 0, this.levels.fuel || 0));
    this.levels.fuel -= amount;
    // Measured, not modelled: this is the only place fuel ever leaves.
    this.fuelIssued = (this.fuelIssued || 0) + amount;
    return amount;
  }

  /**
   * `dt` is real time: rotors turn at a steady rate whatever the sim speed,
   * and stop when the clock is paused.
   */
  update(clock, dt) {
    this.updateUpgradeFeedback(dt);
    if (this.rotors.length && dt > 0 && (!clock || clock.speed !== 0)) {
      const step = Math.min(dt, 0.1);
      for (const r of this.rotors) r.mesh.rotation.z += r.speed * step;
    }
    // Phase 36 (S19g) — the day-boundary work below (store drain, `growSites`)
    // reads `this.production`, so it must be current before any of it runs.
    this.syncProduction();
    if (!clock) return;
    if (this.lastDay === null || this.lastDay === undefined) {
      this.lastDay = clock.day;
      return;
    }
    if (clock.day === this.lastDay) return;
    this.lastDay = clock.day;
    if (!this.townRef) return;
    this.waterImportedToday = 0;

    // Fold yesterday's pump receipts into the demand every consumer below
    // (store drain, shortage flags, `growSites`, the report) reads.
    this.fuelDemand = Math.round(this.fuelIssued || 0);
    this.fuelIssued = 0;
    const demand = this.demandNow(this.townRef);
    for (const k of ORDER) {
      const cap = this.capacity[k] || 0;
      // Motor fuel leaves storage when a vehicle actually fills its tank.
      const d = k === RESOURCE.FUEL ? 0 : demand[k];
      const p = this.production[k];
      this.levels[k] = Math.min(cap, Math.max(0, (this.levels[k] || 0) + p - d));
      const dry = demand[k] > p && this.levels[k] <= 0;
      if (dry !== this.shortage[k]) {
        this.shortage[k] = dry;
        events.emit('log', {
          text: dry
            ? `${RESOURCE_LABEL[k]} reserves run dry — rationing in effect.`
            : `${RESOURCE_LABEL[k]} reserves recover.`
        });
      }
    }
    this.importWater(demand);
    this.importFuel(demand);
    this.growSites(demand);
  }

  /**
   * Water source capacity is intentionally finite (the lake ladder tops out at
   * level three). A capped shipment keeps a larger town alive without lying to
   * the planner that another local pumping upgrade exists. The contractor
   * account pays the external supplier, so an operating-floor reserve is not
   * consumed by an essential but private-capital service contract.
   */
  importWater(demand) {
    const town = this.townRef;
    const economy = town?.economy;
    if (!economy) return 0;
    const need = Math.max(0, demand[RESOURCE.WATER] || 0);
    const local = Math.max(0, this.production[RESOURCE.WATER] || 0);
    const cap = this.capacity[RESOURCE.WATER] || 0;
    const have = this.levels[RESOURCE.WATER] || 0;
    if (need <= local || have >= need) return 0;
    const qty = Math.min(Math.ceil(need - have), Math.max(0, cap - have), WATER_IMPORT_MAX);
    if (qty <= 0) return 0;
    const cost = Math.round(qty * WATER_IMPORT_PRICE);
    const paid = economy.transfer({
      from: 'developer', to: 'external', amount: cost, category: 'import',
      metadata: { physicalTrade: true, commodity: 'water', quantity: qty, source: 'water-market' }
    });
    if (!paid?.ok) return 0;
    this.levels[RESOURCE.WATER] = Math.min(cap, have + qty);
    this.waterImported = (this.waterImported || 0) + qty;
    this.waterImportCost = (this.waterImportCost || 0) + cost;
    this.waterImportedToday = (this.waterImportedToday || 0) + qty;
    this.shortage[RESOURCE.WATER] = false;
    events.emit('council', {
      source: 'town', actor: 'Town', action: 'WATER_IMPORT', status: 'done', cost,
      detail: `local water covers ${Math.round(local)} m³/day vs ${Math.round(need)} demanded — bought ${qty} m³`
    });
    return qty;
  }

  /**
   * The town refines no crude of its own: a gas station is a pump and a tank,
   * never a refinery, so when local stations cannot cover the fleet the
   * storehouse BUYS a shipment in (caveat: "if there is no refinery, import
   * oil"). It is charged to the treasury, capped by storage and by
   * FUEL_IMPORT_MAX, and never attempted while the town can already hold a day.
   */
  importFuel(demand) {
    const town = this.townRef;
    const economy = town && town.economy;
    if (!economy) return 0;
    const burn = Math.max(0, demand[RESOURCE.FUEL] || 0);
    const local = Math.max(0, this.production[RESOURCE.FUEL] || 0);
    if (burn <= 0 || local >= burn) return 0; // the stations can hold the day
    const cap = this.capacity[RESOURCE.FUEL] || 0;
    const have = this.levels[RESOURCE.FUEL] || 0;
    if (have >= burn) return 0; // a day's reserve is already in the tanks
    const qty = Math.min(Math.ceil(burn - have), cap - have, FUEL_IMPORT_MAX);
    if (qty <= 0) return 0;
    const cost = Math.round(qty * FUEL_IMPORT_PRICE);
    const paid = economy.transfer({
      from: 'government',
      to: 'external',
      amount: cost,
      category: 'import',
      metadata: { physicalTrade: true, commodity: 'fuel', quantity: qty }
    });
    if (!paid || !paid.ok) return 0; // a broke town feels the shortage
    this.levels[RESOURCE.FUEL] = Math.min(cap, have + qty);
    this.fuelImported = (this.fuelImported || 0) + qty;
    this.fuelImportCost = (this.fuelImportCost || 0) + cost;
    events.emit('log', {
      text: `With no refinery of its own the town imports ${qty} L of motor fuel for $${cost.toLocaleString('en-US')}.`
    });
    events.emit('council', {
      source: 'town',
      actor: 'Town',
      action: 'FUEL_IMPORT',
      status: 'done',
      detail: `local stations cover ${local} L/day vs ${burn} L/day burned — bought ${qty} L to hold a day's reserve`,
      cost
    });
    return qty;
  }

  /**
   * Deficit-driven site growth: the founding plan sized sites for the START
   * population only, so a town whose rated output falls under SURPLUS×demand
   * adds one energy or food site per day while caps allow (water's headroom
   * is the site-level upgrade — its lake is init-only). Mirrors plan()'s
   * alternating kind order so new sites read as the same family.
   */
  growSites(demand) {
    const g = this.townRef.grid;
    const bounds = coreBounds(g);
    if (!bounds) return;
    const rng = this.growRng || (this.growRng = this.townRef.rng.fork(9007));
    // A producing site for `res` — pure storehouses (reservoir, silo) hold
    // stock but make none, so they never count toward the growth cap. The gas
    // station is pump AND tank, and is deliberately counted.
    const prod = (res) =>
      this.sites.filter((s) => SITE_RESOURCE[s.kind] === res && !STOREHOUSE[s.kind]);
    // The founding plan's spread was the last of the free outskirts; a town
    // that has outgrown it takes progressively tighter land rather than
    // stalling a resource short.
    const sited = (kind) => {
      const economy = this.townRef.economy;
      const plan = {
        type: 'resource', projectId: economy?.nextId('project'), cost: 30000,
        // Resource capacity is a public service, but its capital leg may be
        // supplied by the developer. Otherwise a town that has correctly
        // protected its operating floor can never add the water/food/energy
        // capacity needed to grow beyond the founding belt.
        financingSector: 'developer', ownerType: 'government', ownerId: 'government'
      };
      if (economy && !economy.canFinanceProject(plan, 5000).ok) return false;
      // Turbines cluster here as well as at founding, so a town that outgrows
      // its founding two gains a third and a fourth BESIDE the ones it already
      // has. The farm is therefore assembled by growth — which is also when the
      // town finally has the workers to crew it — rather than bought all at once
      // on day one.
      const opts = kind === 'windmill' ? { cluster: WIND_FARM } : {};
      for (const gap of GAP_LADDER) {
        if (this.placeSite(g, rng, bounds, kind, { ...opts, gap })) {
          if (economy) economy.fundProject(plan);
          const site = this.sites[this.sites.length - 1];
          if (site) { site.id = site.id || `resource-${plan.projectId}`; site.ownerType = 'government'; site.ownerId = 'government'; site.fixedCapital = plan.cost; }
          return true;
        }
      }
      return false;
    };
    const announceSite = (kind, res) => {
      events.emit('council', {
        source: 'town',
        actor: 'Town',
        action: 'BUILD_SITE',
        status: 'done',
        detail: `output ${Math.round(this.production[res] || 0)}/${Math.round(demand[res] || 0)} — auto-sited a ${kind} to cover the deficit`,
        cost: 30000
      });
    };
    // Only a CAPACITY shortfall is a reason to buy more land. A shortfall caused
    // by nobody working the sites it already has is fixed by people, not by
    // turbines: with the whole workforce retired these branches used to buy six
    // sites for −$292,277 that produced nothing, then make 1,392 further
    // placement attempts that all failed, every day, with nothing logged.
    const rated = this.ratedProduction();
    const shortOn = (res) => (rated[res] || 0) < demand[res] * SURPLUS;

    // Generation and storage are separate constraints. Once the energy store
    // is smaller than the town's daily buffer, add a battery yard instead of
    // buying another turbine that cannot solve an overnight deficit.
    const energyCapacity = this.capacity.energy || 0;
    if (
      energyCapacity < Math.max(900, demand.energy * BUFFER_DAYS) &&
      this.sites.filter((s) => s.kind === 'battery').length < 3 &&
      sited('battery')
    ) {
      this.townRef.rebuildStatic();
      events.emit('council', {
        source: 'town', actor: 'Town', action: 'BUILD_BATTERY', status: 'done', cost: 30000,
        detail: `energy storage ${Math.round(energyCapacity)} is below ${Math.round(demand.energy * BUFFER_DAYS)} kWh of daily buffer`
      });
      return;
    }

    if (shortOn('energy')) {
      const sites = prod('energy');
      if (sites.length < MAX_ENERGY_SITES) {
        const next = sites.length % 2 === 0 ? 'windmill' : 'solar';
        if (sited(next)) {
          // The spur and yard changed roads and lots: rebuildStatic refreshes
          // the road graph, lots, zones and site meshes (and recomputes
          // production) — the same path growth.js uses after road edits.
          this.townRef.rebuildStatic();
          announceSite(next, 'energy');
          return;
        }
      }
    }
    if (shortOn('food')) {
      const sites = prod('food');
      if (sites.length < MAX_FARMS) {
        const cycle = ['farm', 'husbandry', 'poultry'];
        const next = cycle[sites.length % cycle.length];
        if (sited(next)) {
          this.townRef.rebuildStatic();
          announceSite(next, 'food');
        }
      }
    }
    // Phase 14 — a gas station is both pump AND tank, so it is not excluded
    // from the producing set the way the pure storehouses are.
    if (shortOn('fuel')) {
      const sites = prod('fuel');
      if (sites.length < MAX_FUEL_SITES && sited('gas')) {
        this.townRef.rebuildStatic();
        announceSite('gas', 'fuel');
      }
    } else if (this.production.fuel < demand.fuel * SURPLUS) {
      // Capacity is fine and output is still short: the town simply has nobody
      // on the pumps. Say so instead of quietly trying to buy another one.
      this.noteUnderstaffed('fuel');
    }
  }

  noteUnderstaffed(res) {
    if (this.lastUnderstaffed === res) return;
    this.lastUnderstaffed = res;
    events.emit('council', {
      source: 'town',
      actor: 'Town',
      action: 'RESOURCE_SHORT',
      status: 'warn',
      detail: `${res} output is short because its sites are understaffed, not short of capacity — the town needs workers, not another site.`,
      cost: 0
    });
  }

  /* ------------------------------------------------------------------ report */

  stats() {
    const town = this.townRef;
    const demand = town ? this.demandNow(town) : blank(() => 0);
    // Phase 36 (S19g) — production is read here by the HUD, the council report
    // and the inspector, and it depends on staffing, which moves without ever
    // going through `build()`. Sync first (see `syncProduction`).
    const production = this.computeProduction();
    const connected = this.sites.filter((s) => s.connected).length;
    const out = {
      sites: this.sites.length,
      connected,
      disconnected: this.sites.length - connected,
      core: this.core,
      lakeCells: this.sites.filter((s) => s.kind === 'lake').reduce((n, s) => n + s.cells.length, 0),
      types: {}
    };
    for (const k of ORDER) {
      const capacity = this.capacity[k] || 0;
      const level = Math.min(this.levels[k] || 0, capacity);
      const d = demand[k];
      const p = k === RESOURCE.WATER
        ? ((this.waterImportedToday || 0) > 0 ? Math.max(d, production[k] + this.waterImportedToday) : production[k])
        : production[k];
      out.types[k] = {
        label: RESOURCE_LABEL[k],
        unit: RESOURCE_UNIT[k],
        flowUnit: RESOURCE_FLOW_UNIT[k],
        production: p,
        demand: d,
        capacity,
        siteLevel: this.siteLevel[k] || 1,
        upgradeCost: this.upgradeCost(k),
        level: Math.round(level),
        percent: capacity ? Math.round((level / capacity) * 100) : 0,
        storage: this.sites.filter((s) => STORAGE[s.kind] && SITE_RESOURCE[s.kind] === k).length,
        sites: this.sites.filter((s) => SITE_RESOURCE[s.kind] === k).length,
        remedy: k === 'water' ? (this.upgradeCost(k) > 0 ? 'upgrade existing water treatment/pumping site' : 'source limit reached') : undefined,
        shortage: !!this.shortage[k],
        deficit: p < d
      };
    }
    out.strained = ORDER.filter((k) => out.types[k].shortage || out.types[k].deficit);
    out.storageScarcity = (out.types.energy.capacity || 0) < Math.max(900, (demand.energy || 0) * BUFFER_DAYS);
    out.waste = wasteFlow(town);
    // The town refines nothing: this is the fuel it has had to buy in so far.
    out.fuelImported = { litres: this.fuelImported || 0, cost: this.fuelImportCost || 0 };
    out.waterImported = { cubicMetres: this.waterImported || 0, cost: this.waterImportCost || 0 };
    out.staff = this.staffCounts();
    out.staffTotal = CREW_ROLES.reduce((n, k) => n + (out.staff[k] || 0), 0);
    return out;
  }

  describe(x, y) {
    const site = this.sites.find((s) => s.cells.some(([cx, cy]) => cx === x && cy === y));
    if (!site) return null;
    const res = SITE_RESOURCE[site.kind];
    const storage = STORAGE[site.kind];
    const crew = this.activeSiteWorkers().get(site) || 0;
    const tier = agTierOf(site);
    // `level` used to report the storehouse fill percent — the site's own
    // tier was never surfaced anywhere, so an upgraded farm was invisible.
    // The fill moves to `percent`; `level` is the tier, like everywhere else.
    const typeStats = this.stats().types[res];
    return {
      kind: site.kind,
      label: tier ? `${tier.label} · ${SITE_LABEL[site.kind].toLowerCase()}` : SITE_LABEL[site.kind],
      tier: tier ? tier.label : null,
      resource: RESOURCE_LABEL[res],
      connected: !!site.connected,
      // The EFFECTIVE figure, not the rated one. `computeProduction` scales every
      // site by `min(1, crew/required)`, and a tier can RAISE the crew
      // requirement: a level-3 farm needs 4 hands where the level-2 needed 3. A
      // town with 2 farmers was told the upgrade takes it from 110 to 220 t/day,
      // paid $120,000 for it, and got 110 — a $120,000 purchase sold on a
      // promise that is arithmetically impossible while the crew is short.
      output: site.effectiveOutput != null
        ? Math.round(site.effectiveOutput)
        : Math.round(tier ? tier.output : (site.kind === 'lake' ? site.cells.length * OUTPUT.lake : OUTPUT[site.kind] || 0) * (site.level || 1)),
      ratedOutput: site.ratedOutput != null
        ? Math.round(site.ratedOutput)
        : Math.round(tier ? tier.output : (site.kind === 'lake' ? site.cells.length * OUTPUT.lake : OUTPUT[site.kind] || 0) * (site.level || 1)),
      // How much of the promise the crew can actually deliver, so the inspector
      // can say why the two figures differ instead of showing only the flattering
      // one.
      staffing: site.staffing != null ? Math.round(site.staffing * 100) / 100 : 1,
      crew: this.siteCrew(site),
      crewEmployed: this.activeSiteWorkers().get(site) || 0,
      outputUnit: RESOURCE_FLOW_UNIT[res],
      storage: storage || 0,
      storageUnit: RESOURCE_UNIT[res],
      percent: typeStats ? typeStats.percent : 0,
      yard: site.cells.length,
      crowded: !!site.crowded,
      crew,
      crewNeed: this.siteCrew(site),
      crewLabel:
        site.work === 'farm'
          ? 'farmer'
          : site.work === 'power'
            ? 'power worker'
            : site.work === 'fuel'
              ? 'pump attendant'
              : null,
      level: site.level || 1
    };
  }
}

/**
 * How hard the resource situation presses on citizens right now — 0..1 per
 * resource plus an `overall` mean. Rationing (shortage) = 1, running a
 * deficit = 0.6, reserves below a quarter = 0.3. Consumers: mood targets,
 * moodFrom, need decay and illness onset/recovery.
 */
export function resourceStress(stats) {
  const out = blank(() => 0);
  if (!stats || !stats.types) return out;
  let sum = 0;
  for (const k of ORDER) {
    const t = stats.types[k];
    let s = 0;
    if (t) {
      if (t.shortage) s = 1;
      else if (t.deficit) s = 0.6;
      else if (t.percent < 25) s = 0.3;
    }
    out[k] = s;
    sum += s;
  }
  out.overall = sum / ORDER.length;
  return out;
}

/* ------------------------------------------------------------------ geometry */

/** World-space centre and size of a site's yard. */
function siteFrame(g, cells) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of cells) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const a = g.cellToWorld(x0, y0);
  const b = g.cellToWorld(x1, y1);
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    w: (x1 - x0 + 1) * CELL,
    d: (y1 - y0 + 1) * CELL
  };
}

function siteParts(kind, g, cells, level = 1) {
  const f = siteFrame(g, cells);
  if (kind === 'windmill') return windmillParts(f);
  if (kind === 'solar') return { static: solarGeometry(f, level) };
  if (kind === 'farm') return { static: farmGeometry(f, level) };
  if (kind === 'husbandry') return { static: husbandryGeometry(f, level) };
  if (kind === 'poultry') return { static: poultryGeometry(f, level) };
  if (kind === 'silo') return { static: siloGeometry(f) };
  if (kind === 'reservoir') return { static: reservoirGeometry(f) };
  if (kind === 'gas') return { static: gasGeometry(f) };
  if (kind === 'battery') return { static: batteryGeometry(f) };
  return { static: [] };
}

/**
 * The turbine: a tall tapered tower on a concrete yard, with the blades split
 * out as their own mesh so `update()` can spin them.
 */
function windmillParts(f) {
  const out = [];
  const pad = Math.min(f.w, f.d) - 1.4;
  out.push(box(pad, 0.16, pad, 0xb9b3a6, f.x, 0.08, f.z));
  out.push(box(pad - 1.2, 0.1, pad - 1.2, 0xa9a49a, f.x, 0.2, f.z));
  out.push(cyl(0.5, 0.95, 7.2, 0xe8e5dc, f.x, 3.7, f.z, 18));
  out.push(box(2.2, 0.8, 1.3, 0xd6d2c8, f.x, 7.55, f.z + 0.6));
  out.push(box(1.3, 0.85, 1.0, 0x9aa1a9, f.x + pad / 2 - 0.8, 0.5, f.z + pad / 2 - 0.8));
  const hub = [f.x, 7.55, f.z + 1.4];
  out.push(box(0.55, 0.55, 0.4, 0xbfbbb2, hub[0], hub[1], hub[2]));

  const blades = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    blades.push(
      boxEuler(0.34, 3.6, 0.12, 0xf3f0e7, [Math.sin(a) * 1.9, Math.cos(a) * 1.9, 0], [0, 0, -a])
    );
  }
  return { static: out, rotor: { geo: merge(blades), at: hub } };
}

/** A panel array sized to the yard, plus its inverter cabinet. */
function solarGeometry(f, level = 1) {
  const out = [];
  out.push(box(f.w - 0.7, 0.12, f.d - 0.7, 0x9c968b, f.x, 0.06, f.z));
  const cols = Math.max(1, Math.round(f.w / 2.6));
  const rows = Math.max(1, Math.round(f.d / 3.0));
  const stepX = f.w / (cols + 1);
  const stepZ = f.d / (rows + 1);
  const panelW = Math.max(1.0, Math.min(2.0, stepX * 0.85));
  const panelD = Math.max(0.8, Math.min(1.5, stepZ * 0.8));
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const px = f.x - f.w / 2 + stepX * c;
      const pz = f.z - f.d / 2 + stepZ * r;
      out.push(boxEuler(panelW, 0.1, panelD, 0x1f3f6b, [px, 0.82, pz], [-0.5, 0, 0]));
      for (const s of [-1, 1]) {
        out.push(box(0.09, 0.74, 0.09, 0x6e7378, px + s * (panelW * 0.4), 0.37, pz + panelD * 0.3));
      }
    }
  }
  out.push(box(1.2, 0.95, 0.9, 0xb0aba2, f.x + f.w / 2 - 1.1, 0.55, f.z - f.d / 2 + 1.1));
  out.push(box(0.16, 1.1, 0.16, 0x6e7378, f.x + f.w / 2 - 1.9, 0.6, f.z - f.d / 2 + 1.1));
  if (level > 1) {
    // Higher solar tiers add a small battery bank beside the inverter. This
    // makes the storage upgrade legible in the same way utility plant levels
    // add visible cabinets, instead of changing only production numbers.
    for (let i = 0; i < level - 1; i++) {
      out.push(box(0.42, 0.72, 0.56, 0x5f7280, f.x - f.w / 2 + 0.65 + i * 0.5, 0.42, f.z + f.d / 2 - 0.7));
      out.push(box(0.3, 0.08, 0.44, 0x8fb6c5, f.x - f.w / 2 + 0.65 + i * 0.5, 0.82, f.z + f.d / 2 - 0.7));
    }
  }
  return out;
}

/** A first-class storage yard: inverter, cabinets and a fenced service pad. */
function batteryGeometry(f) {
  const out = [];
  out.push(box(f.w - 0.35, 0.12, f.d - 0.35, 0x7f858a, f.x, 0.06, f.z));
  const cols = Math.max(2, Math.floor(f.w / 1.4));
  const rows = Math.max(1, Math.floor(f.d / 1.8));
  const sx = f.w / (cols + 1);
  const sz = f.d / (rows + 1);
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const x = f.x - f.w / 2 + sx * c;
      const z = f.z - f.d / 2 + sz * r;
      out.push(box(0.72, 1.05, 0.62, 0x526d7b, x, 0.58, z));
      out.push(box(0.52, 0.08, 0.42, 0x9fc7d4, x, 1.13, z));
    }
  }
  out.push(box(0.9, 1.45, 0.75, 0x3b4d59, f.x + f.w / 2 - 0.8, 0.78, f.z + f.d / 2 - 0.75));
  out.push(box(0.16, 1.7, 0.16, 0xc6a85a, f.x - f.w / 2 + 0.35, 0.85, f.z - f.d / 2 + 0.35));
  return out;
}

/** Crop rows over the yard with a barn and a tractor at the far end. */
function farmGeometry(f, level = 1) {
  const out = [];
  out.push(box(f.w - 0.2, 0.12, f.d - 0.2, 0x7a5f3c, f.x, 0.06, f.z));

  const barnW = Math.min(3.2, f.w * 0.42);
  const barnD = Math.min(3.8, f.d * 0.6);
  const bcx = f.x + f.w / 2 - barnW / 2 - 0.35;
  const left = f.x - f.w / 2 + 0.35;
  const right = bcx - barnW / 2 - 0.4;
  const fw = Math.max(1.4, right - left);
  const fc = (left + right) / 2;
  const rows = Math.max(5, Math.floor((f.d - 1.2) / 0.52));
  const span = (rows - 1) * 0.52;
  for (let i = 0; i < rows; i++) {
    const z = f.z - span / 2 + i * 0.52;
    out.push(box(fw, 0.22, 0.34, i % 2 ? 0x6a9a3f : 0x86ad4c, fc, 0.18, z));
  }

  out.push(box(barnW, 1.9, barnD, 0x9c4a3a, bcx, 1.05, f.z));
  for (const s of [-1, 1]) {
    out.push(
      boxEuler(barnW * 0.64, 0.1, barnD + 0.3, 0x5a4038, [bcx + s * barnW * 0.27, 2.12, f.z], [0, 0, -s * 0.6])
    );
  }
  out.push(box(1.0, 1.3, 0.1, 0x6b4a33, bcx, 0.75, f.z + barnD / 2 + 0.01));

  const tx = left + 0.9;
  const tz = f.z + f.d / 2 - 0.9;
  out.push(box(1.1, 0.6, 1.9, 0xd9a13a, tx, 0.42, tz));
  out.push(box(0.95, 0.6, 0.9, 0xc9c4bb, tx, 0.95, tz - 0.3));
  for (const s of [-1, 1]) {
    out.push(cyl(0.34, 0.34, 0.2, 0x2b2f36, tx + s * 0.6, 0.34, tz + 0.5, 10));
    out.push(cyl(0.22, 0.22, 0.18, 0x2b2f36, tx + s * 0.55, 0.26, tz - 0.6, 10));
  }
  if (level > 1) {
    const gw = Math.min(2.4, f.w * 0.3);
    const gz = f.z - f.d / 2 + 0.8;
    out.push(box(gw, 1.1, 1.5, 0x9cc7c3, f.x + f.w * 0.24, 0.6, gz));
    for (const s of [-1, 1]) {
      out.push(box(0.06, 1.0, 1.6, 0x6f8d8a, f.x + f.w * 0.24 + s * gw / 2, 0.6, gz));
    }
    out.push(boxEuler(gw + 0.16, 0.08, 1.7, 0x7ca6a2, [f.x + f.w * 0.24, 1.2, gz], [0, 0, 0.12]));
  }
  return out;
}

/** A fenced pasture with a barn and cattle — animal husbandry. */
function husbandryGeometry(f, level = 1) {
  const out = [];
  out.push(box(f.w - 0.2, 0.12, f.d - 0.2, 0x8a7a4e, f.x, 0.06, f.z)); // trampled earth

  // Barn on the east end: red timber with a pitched roof, like the farm's.
  const barnW = Math.min(3.6, f.w * 0.42);
  const barnD = Math.min(4.4, f.d * 0.55);
  const bcx = f.x + f.w / 2 - barnW / 2 - 0.45;
  out.push(box(barnW, 2.1, barnD, 0x7a4f30, bcx, 1.15, f.z));
  for (const s of [-1, 1]) {
    out.push(
      boxEuler(barnW * 0.64, 0.1, barnD + 0.3, 0x54382a, [bcx + s * barnW * 0.27, 2.36, f.z], [0, 0, -s * 0.6])
    );
  }
  out.push(box(1.1, 1.4, 0.1, 0x4a3325, bcx, 0.8, f.z + barnD / 2 + 0.01));

  // Fence rails around three sides; the barn side stays open.
  const fl = f.x - f.w / 2 + 0.25;
  const fz0 = f.z - f.d / 2 + 0.25;
  const fz1 = f.z + f.d / 2 - 0.25;
  const fenceLen = Math.max(2, bcx - barnW / 2 - 0.3 - fl);
  const runs = [
    [fenceLen, 0.08, fl + fenceLen / 2, fz0],
    [fenceLen, 0.08, fl + fenceLen / 2, fz1],
    [0.08, f.d - 0.5, fl, f.z]
  ];
  for (const [w, d, x, z] of runs) {
    for (const h of [0.34, 0.66]) out.push(box(w, 0.09, d, 0x9a8f76, x, h, z));
    const n = Math.max(2, Math.round(Math.max(w, d) / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(box(0.1, 0.8, 0.1, 0x7d7362, x - w / 2 + t * w, 0.4, z - d / 2 + t * d));
    }
  }

  // A handful of cattle, plus the trough by the barn. The herd grows with the
  // tier — five head on a paddock, nine on a stockyard — so an upgrade reads
  // on the pasture itself, not just in the gauges.
  const herdSpots = [
    [-0.2, 0.22], [-0.08, -0.18], [-0.3, -0.05], [-0.16, 0.06], [-0.34, 0.3],
    [-0.02, 0.3], [-0.38, -0.2], [-0.24, -0.3], [0.02, -0.02]
  ];
  const herd = herdSpots.slice(0, 3 + Math.max(1, Math.min(3, level)) * 2);
  for (const [fx, fz] of herd) {
    const cx = f.x + f.w * fx;
    const cz = f.z + f.d * fz;
    const dark = (Math.abs(fx * 13 + fz * 7) % 1) > 0.5;
    out.push(box(1.0, 0.55, 0.5, dark ? 0x37302a : 0x6b4f36, cx, 0.42, cz));
    out.push(box(0.3, 0.34, 0.4, dark ? 0x2c2621 : 0x5b4230, cx + 0.62, 0.5, cz));
    if (dark) out.push(box(0.34, 0.3, 0.24, 0xd9d3c6, cx - 0.18, 0.46, cz + 0.14));
  }
  out.push(box(1.8, 0.4, 0.6, 0x6b5a3f, bcx - barnW / 2 - 1.3, 0.28, f.z + barnD / 2 - 1.0));
  return out;
}

/** Straw yard with coops and free-range birds — a poultry farm. */
function poultryGeometry(f, level = 1) {
  const out = [];
  out.push(box(f.w - 0.2, 0.12, f.d - 0.2, 0xc4b184, f.x, 0.06, f.z)); // straw yard

  const n = f.w >= f.d ? 3 : 2;
  const span = f.w * 0.56;
  const startX = f.x - span / 2;
  for (let i = 0; i < n; i++) {
    const cx = startX + (n === 1 ? 0 : (span / (n - 1)) * i);
    const cz = f.z - f.d * 0.24;
    const cw = 2.0;
    const cd = 1.5;
    out.push(box(cw, 1.1, cd, 0xe8e2d4, cx, 0.65, cz));
    for (const s of [-1, 1]) {
      out.push(boxEuler(cw * 0.62, 0.09, cd + 0.24, 0xa8452f, [cx + s * cw * 0.26, 1.3, cz], [0, 0, -s * 0.62]));
    }
    out.push(box(0.42, 0.5, 0.1, 0x8a6a4a, cx, 0.4, cz + cd / 2 + 0.01)); // pop hole
    out.push(box(0.9, 0.3, 0.5, 0x9a8f76, cx + 1.4, 0.2, cz + 0.3)); // feed tray
  }

  // Chickens scattered across the open yard — more birds per tier, like the
  // husbandry herd, so the upgrade is visible from the camera.
  const birdSpots = [
    [-0.24, 0.18], [-0.1, 0.3], [0.06, 0.14], [0.2, 0.3], [0.3, 0.08], [-0.3, 0.34], [0.12, 0.36],
    [-0.02, 0.05], [0.26, -0.02], [-0.18, 0.02]
  ];
  const birds = birdSpots.slice(0, 4 + Math.max(1, Math.min(3, level)) * 2);
  for (const [fx, fz] of birds) {
    const cx = f.x + f.w * fx;
    const cz = f.z + f.d * fz;
    out.push(box(0.3, 0.26, 0.36, 0xf0ece2, cx, 0.24, cz));
    out.push(box(0.16, 0.16, 0.14, 0xd8d2c4, cx, 0.44, cz - 0.16));
    out.push(box(0.05, 0.1, 0.05, 0xc9752f, cx, 0.52, cz - 0.2)); // comb
  }

  // Feed silo in the corner.
  const sx = f.x + f.w / 2 - 1.0;
  const sz = f.z + f.d / 2 - 1.0;
  out.push(cyl(0.55, 0.55, 2.4, 0xc9c4b7, sx, 1.32, sz, 14));
  out.push(cone(0.62, 0.5, 0x8f8a7f, sx, 2.77, sz, 14));
  return out;
}

/** Two silos and a loading shed — the tallest store in town after the mills. */
function siloGeometry(f) {
  const out = [];
  out.push(box(f.w - 0.9, 0.16, f.d - 0.9, 0xa8a294, f.x, 0.08, f.z));

  const ax = f.x - f.w * 0.22;
  const az = f.z - f.d * 0.16;
  out.push(cyl(1.3, 1.3, 5.4, 0xd2cdc0, ax, 2.86, az, 20));
  out.push(cone(1.4, 1.0, 0x8f8a7f, ax, 6.06, az, 20));
  for (const s of [-1, 1]) out.push(box(0.07, 5.2, 0.07, 0x7d848c, ax + s * 1.33, 2.7, az));

  const bx = f.x + f.w * 0.26;
  const bz = f.z + f.d * 0.2;
  out.push(cyl(0.95, 0.95, 4.0, 0xc9c4b7, bx, 2.16, bz, 18));
  out.push(cone(1.05, 0.8, 0x8f8a7f, bx, 4.56, bz, 18));

  const shedW = Math.min(3.4, f.w * 0.52);
  const shedZ = f.z + f.d * 0.34;
  out.push(box(shedW, 1.7, 2.0, 0xb5b0a4, f.x - f.w * 0.06, 0.95, shedZ));
  out.push(boxEuler(shedW + 0.24, 0.1, 2.3, 0x8f8a7f, [f.x - f.w * 0.06, 1.86, shedZ], [0, 0, 0.32]));
  out.push(box(1.0, 0.85, 1.0, 0x9aa1a9, f.x - f.w * 0.34, 0.5, f.z + f.d * 0.34));
  return out;
}

/** An open basin sized to the yard, with the pump house on the inlet side. */
function reservoirGeometry(f) {
  const out = [];
  const rw = f.w - 1.2;
  const rd = f.d - 1.2;
  const th = 0.22;
  const wallH = 1.0;
  const base = 0.07;
  out.push(box(f.w - 0.5, 0.14, f.d - 0.5, 0x9d978b, f.x, 0.07, f.z));

  const wallY = base + wallH / 2;
  out.push(box(rw, wallH, th, 0x8d959c, f.x, wallY, f.z - rd / 2 + th / 2));
  out.push(box(rw, wallH, th, 0x8d959c, f.x, wallY, f.z + rd / 2 - th / 2));
  out.push(box(th, wallH, rd - 2 * th, 0x8d959c, f.x - rw / 2 + th / 2, wallY, f.z));
  out.push(box(th, wallH, rd - 2 * th, 0x8d959c, f.x + rw / 2 - th / 2, wallY, f.z));

  const iw = rw - 2 * th;
  const id = rd - 2 * th;
  out.push(box(iw, 0.12, id, 0x77808a, f.x, base + 0.06, f.z));
  out.push(box(iw - 0.14, 0.5, id - 0.14, 0x3f7fa8, f.x, base + 0.3, f.z));

  out.push(box(1.4, 1.1, 1.2, 0xb0aba2, f.x - rw / 2 + 0.75, 0.65, f.z + rd * 0.28));
  out.push(cyl(0.12, 0.12, 1.5, 0x6e7378, f.x - rw / 2 + 1.5, 0.55, f.z + rd * 0.28, 8));
  return out;
}

/** A forecourt with a canopy on two pumps and a tank buried behind the shop. */
function gasGeometry(f) {
  const out = [];
  // Forecourt concrete, edged with a kerb.
  out.push(box(f.w - 0.3, 0.1, f.d - 0.3, 0x9c968b, f.x, 0.05, f.z));
  out.push(box(f.w - 0.3, 0.16, 0.22, 0xb6b1a6, f.x, 0.08, f.z - f.d / 2 + 0.11));
  out.push(box(f.w - 0.3, 0.16, 0.22, 0xb6b1a6, f.x, 0.08, f.z + f.d / 2 - 0.11));

  // Shop + office block on the north edge, with a glazed shopfront.
  const sw = Math.min(4.6, f.w * 0.5);
  const sd = Math.min(2.8, f.d * 0.36);
  const sz = f.z - f.d / 2 + sd / 2 + 0.35;
  out.push(box(sw, 2.5, sd, 0xe4e0d6, f.x, 1.25, sz));
  out.push(box(sw + 0.28, 0.16, sd + 0.28, 0x3f4a55, f.x, 2.58, sz));
  out.push(box(sw * 0.82, 1.0, 0.1, 0x2f4a63, f.x, 1.35, sz + sd / 2 + 0.01));
  out.push(box(1.5, 0.7, 0.1, 0xb4462f, f.x - sw * 0.22, 2.16, sz + sd / 2 + 0.02)); // fascia sign

  // Canopy over the pumps, on four posts.
  const cy = f.z + f.d * 0.18;
  const cw = Math.min(f.w * 0.62, 6.2);
  const cd = Math.min(2.6, f.d * 0.4);
  const postY = 1.7;
  for (const sx of [-1, 1]) {
    for (const sz2 of [-1, 1]) {
      out.push(box(0.2, postY, 0.2, 0x8d959c, f.x + (sx * cw) / 2 - sx * 0.35, postY / 2, cy + (sz2 * cd) / 2 - sz2 * 0.3));
    }
  }
  out.push(box(cw, 0.22, cd, 0xd8d3c8, f.x, postY + 0.11, cy));
  out.push(box(cw + 0.3, 0.1, cd + 0.3, 0xb4462f, f.x, postY + 0.27, cy));
  // Hanging price boards under the canopy.
  for (const s of [-1, 1]) {
    out.push(box(0.9, 0.55, 0.08, 0x1b1f26, f.x + s * cw * 0.26, postY - 0.42, cy));
  }

  // Two pumps under the canopy, each with a hose arch.
  for (const s of [-1, 1]) {
    const px = f.x + s * cw * 0.26;
    out.push(box(0.62, 1.25, 0.44, 0xd2cdc0, px, 0.63, cy));
    out.push(box(0.5, 0.42, 0.1, 0x2b3038, px, 1.1, cy + 0.22));
    out.push(box(0.08, 0.08, 0.5, 0x4a4f58, px + 0.2, 0.9, cy + 0.34));
  }

  // Buried tank: a low bund with its vent pipe behind the shop.
  const tx = f.x - f.w * 0.3;
  const tz = f.z - f.d * 0.3;
  out.push(box(1.9, 0.26, 1.5, 0xb5b0a4, tx, 0.13, tz));
  out.push(box(1.5, 0.1, 1.1, 0x8f8a7f, tx, 0.28, tz));
  out.push(cyl(0.1, 0.1, 0.9, 0x6e7378, tx + 0.7, 0.5, tz + 0.4, 8));
  return out;
}

/* ---------------------------------------------------------------- internals */

/** All road cells reachable from the road cell nearest the grid centre. */
function reachableRoads(g) {
  const seen = new Set();
  const cx = Math.floor(g.w / 2);
  const cy = Math.floor(g.h / 2);
  let start = null;
  let best = Infinity;
  g.forEach((x, y, grid) => {
    if (!grid.isRoad(x, y)) return;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best) {
      best = d;
      start = [x, y];
    }
  });
  if (!start) return seen;
  const stack = [start];
  seen.add(key(start[0], start[1]));
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (seen.has(k) || !g.inBounds(nx, ny)) continue;
      if (!g.isRoad(nx, ny)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}
