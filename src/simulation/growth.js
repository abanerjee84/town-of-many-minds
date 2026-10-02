import * as THREE from 'three';
import { events } from '../core/events.js';
import { ZONE, CELL_KIND, CELL, SIM, MAX_FLOORS } from '../core/config.js';
import { MATERIALS, FACTORY_TYPES, FACTORY_SIZES } from './industry.js';
import { ASSESS, SHOP_TIERS } from './economy.js';
import { ECON } from './economicConfig.js';
import { stageOf } from '../kits/citizens/citizenProfile.js';
import { roadComponents, hasNetworkAccess, urbanProfile, edgeScore, onIndustrialGround, planConnectedRoad, planFootway, MAX_LINK } from '../placement/placementController.js';
import { straightAxis, straightRun, classify } from '../kits/roads/components.js';
import { XS_CLASS_ORDER, XS_CLASS_LABEL, classIndex } from '../kits/roads/crossSection.js';
import { ORDER as RESOURCE_ORDER, SITE_LABEL, spurPath, MAX_SPUR_LENGTH } from '../kits/resources/resourceKit.js';
import { snapshotProjectWorld, restoreProjectWorld } from './projectSnapshot.js';
import { DIRS } from '../core/grid.js';
import { chooseRoadExtension } from './roadExtensionPlanner.js';
import { constructionBlock, constructionBlockQuote } from '../kits/constructionBlocks.js';
import { civicVerticalCap } from '../kits/civic/civicKit.js';
import { agriculturalSetbackConflict } from '../placement/siteRules.js';
const COST = {
  house: 9000, shop: 11000, civic: 30000, park: 3000, road: 2000, utility: 0,
  footway: 600,
  'prop-tree': 100, 'prop-lamp': 350, upgrade: 6000, archetype: 12000, factory: 26000,
  renovate: 4500, tierup: 9000, wing: 7000,
  // Phase 8 — surface works are flat, the land-use family is priced PER CELL
  // of the brush it repaints (clear is one building, so it is flat).
  plaza: 4000, parking: 1200, rezone: 250, upzone: 900, clear: 1500, annex: 400,
  // Phase 9 — a bridge is priced PER WATER CELL it spans (steel rides along
  // as materials, see MATERIALS.bridge).
  bridge: 3500,
  // Phase 20 (C3b) — an office block is a shell plus its storeys, so the
  // extra height is priced separately from the plot.
  office: 2400
};

/**
 * Phase 18 (A5) — the district blueprint, DERIVED from the town's own gaps.
 *
 * The queue is an ordered list of *existing* plan types, and its order is the
 * order a district needs its parts in: the network reaches the land first,
 * then houses, then the things that serve houses, then the works that employ
 * them. How many of each comes from live pressure — housing pressure, the
 * strained resources, the worst-loaded facility, the staff gap and the
 * shortfall in works — so a housing-heavy town and a strain-heavy town get
 * visibly different districts, from the same code.
 */
export function districtQueue(town, opts = {}) {
  const s = town.growth ? town.growth.inputs() : {};
  const rs = town.resources && town.resources.stats ? town.resources.stats() : null;
  const strains = (rs && rs.strained) || [];
  const loads = civicLoads(town);
  const worstLoad = loads.reduce((a, l) => Math.max(a, l.load || 0), 0);
  const need = opts.need != null ? opts.need : (s.pressure || 0);
  const scale = Math.max(1, Math.min(4, Math.round(need * 4) || 1));
  const q = [];

  // 1. Reach. Every district starts with the network, because nothing else can
  //    be sited without it — and the access spur is priced per step.
  q.push({ what: 'road', kind: 'road', count: scale, cost: COST.road * scale, need });

  // 2. House. Sized by housing pressure, the thing the prompt already calls
  //    the first priority: at full pressure a district carries the
  //    HOUSE_SPARE_BEDS the gate is measured against, and a slack town gets
  //    fewer.
  const houses = Math.max(1, Math.min(6, Math.round(need * 6)));
  q.push({
    what: `${houses} homes`,
    kind: 'house',
    count: houses,
    cost: COST.house * houses,
    need
  });

  // 3. Serve. One shop and one civic building per stretch of housing, more if
  //    the worst facility is already over its design load.
  const shops = Math.max(1, Math.round(houses / 3));
  q.push({ what: `${shops} shops`, kind: 'shop', count: shops, cost: COST.shop * shops, need });
  const civic = worstLoad > 0.85 ? 2 : 1;
  q.push({
    what: civic > 1 ? `${civic} civic buildings` : 'a civic building',
    kind: 'civic',
    count: civic,
    cost: COST.civic * civic,
    need
  });

  // 4. Make work, only where the town is short of it: a strained resource
  //    brings its works, otherwise a bare crew gap brings a single one.
  const staff = town.governance && town.governance.staffNeed ? town.governance.staffNeed() : null;
  if (strains.length) {
    const r = strains[0];
    const siteCount = Math.min(2, scale);
    q.push({
      what: `${siteCount} ${r} works`,
      kind: 'factory',
      count: siteCount,
      cost: COST.factory * siteCount,
      need,
      resource: r
    });
  } else if (staff && staff.biz && staff.biz.need > staff.biz.have) {
    q.push({ what: 'a works', kind: 'factory', count: 1, cost: COST.factory, need });
  }

  return q;
}

/**
 * How long a district step may go unsited before it is dropped, in GAME seconds.
 *
 * This replaces a bare attempt counter. The queue is walked once per render
 * frame, so "12 tries" meant twelve frames — about 0.2 s of real time and two
 * sim-seconds at 10x — which is not a grace period at all.
 */
export const DISTRICT_STEP_PATIENCE_SECONDS = 180;

/** Phase 9 — the widest river gap a bridge may span, in water cells. */
export const MAX_BRIDGE_GAP = 3;
const BRIDGE_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Phase 7 — road class upgrade, priced PER CELL to climb FROM that rung
 * (boulevard is the top of XS_CLASS_ORDER, so it has no price). A plan's
 * cost is the sum over the cells it will actually change of every rung it
 * climbs: cost follows the class delta, not a flat fee.
 */
export const ROAD_UPGRADE_RUNG = { alley: 700, local: 1400, street: 2600, avenue: 4200 };
/**
 * EXTEND_STREET lays a RUN of this many tiles per order instead of a single
 * stub: a street order either closes a gap between two roads or extends the
 * network by 3–4 tiles, so the work is visible in the town plan.
 */
export const EXTEND_STREET_TILES = 4;
export const UTILITY_RESERVE = 47000;
/** Council work pauses while this many sites are already under construction. */
export const MAX_ACTIVE = 2;

/* ---------------------------------------------------- Phase 8 · land brushes
 * The land-use family (REZONE / UPZONE / ANNEX_EDGE) repaints a 3×3 brush of
 * LAND. Green space, the network and the water keep their use, and a resource
 * yard is never rezoned out from under its own site — every caller (site
 * search, brush builder, and the town's own painter) agrees on this one test.
 */
export function brushLand(g, x, y, town) {
  const k = g.kindAt(x, y);
  if (k === CELL_KIND.ROAD || k === CELL_KIND.WATER || k === CELL_KIND.PATH) return false;
  if (k === CELL_KIND.PARK || k === CELL_KIND.PLAZA) return false;
  if (town?.resources?.ownsCell && town.resources.ownsCell(x, y)) return false;
  return true;
}

/** How many cells in from the map border a cell sits (0 = on the border). */
export function edgeDistance(g, x, y) {
  return Math.min(x, y, g.w - 1 - x, g.h - 1 - y);
}

/** ANNEX_EDGE only ever touches the outer ring of the map. */
export const EDGE_RING = 2;
/**
 * Phase 17 — how much of `COST.annex` a surveyed cell saves. Not the whole
 * price: a survey is worth knowing the ground, not worth annexing it for
 * nothing. It lives here because it is a PRICE, and because growth.js is the
 * module innovation.js already imports — a discount constant in the other
 * direction would make the pair circular.
 */
export const ANNEX_SURVEY_DISCOUNT = 0.4;
export function edgeCell(g, x, y) {
  return edgeDistance(g, x, y) < EDGE_RING;
}

/**
 * Bounding box of the built road network, measured not assumed — the same
 * discipline as `urbanProfile` and ResourceKit's `coreBounds`. Returns null on
 * an unroaded grid, which callers read as "nothing to expand from".
 */
export function roadBounds(g) {
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

/**
 * How far outside the built area a cell sits, in cells. 0 inside it, 1 on its
 * rim, more beyond.
 *
 * This is the honest measure of "outward" for expansion, and the reason the
 * town can grow across a large extent: the old score used distance from the
 * centre of the MAP, which only tracked the built edge while the town filled
 * the grid, and pointed at unreachable open country the moment it did not.
 */
export function frontierDepth(x, y, b) {
  if (!b) return 0;
  return Math.max(b.x0 - x, x - b.x1, b.y0 - y, y - b.y1);
}

/** Plan types whose site is chosen up front — apply() never re-searches one. */
const NO_SITE = new Set([
  'utility', 'upgrade', 'resource', 'renovate', 'tierup', 'wing', 'roadup',
  'rezone', 'upzone', 'clear', 'annex', 'bridge', 'restructure', 'land'
]);

/**
 * Plan types that must never justify themselves by paving a new street: the
 * chain/kerb/brush sites are their own, and "no site" is a real answer for
 * them rather than a reason to expand the network.
 */
const NO_EXPAND = new Set([
  'road', 'footway', 'plaza', 'parking', 'rezone', 'upzone', 'clear', 'annex', 'bridge', 'land', 'restructure'
]);

/**
 * CIVIC LOAD — demand per capacity kind, derived from the town (population
 * and age mix), measured against the building's civic capacity (kit capacity
 * × floors). Load > 1 means the kind is running over its designed capacity:
 * the council then raises the strained facility a floor on NEED, instead of
 * waiting for housing pressure to justify filler work.
 */
/** Per-capacity-kind demand. Exported so the catalogue probe can assert every
 *  CIVIC_CAPACITY_KIND value has a row (no silent pop×0.5 fallback). */
export const CIVIC_DEMAND = {
  students: (s) => s.students, // children + teens of school age
  'patients/day': (s) => Math.round(s.pop * 0.4),
  beds: (s) => Math.round(s.pop * 0.02),
  visitors: (s) => Math.round(s.pop * 0.6),
  officers: (s) => Math.max(1, Math.round(s.pop * 0.03)),
  firefighters: (s) => Math.max(1, Math.round(s.pop * 0.015)),
  staff: (s) => Math.round(s.pop * 0.05),
  mail: (s) => Math.round(s.pop * 1.2), // parcels/day through the post office
  children: (s) => Math.max(2, Math.round(s.pop * 0.06)), // daycare places
  pupils: (s) => Math.max(1, Math.round(s.students * 0.5)), // conservatory pupils
  riders: (s) => Math.round(s.pop * 0.9), // daily bus passengers
  tertiary: (s) => Math.max(1, Math.round(s.pop * 0.12)),
  waste: (s) => Math.max(1, Math.round(s.pop * 0.8))
};

/** Aggregate load per capacity kind: one kind's demand is shared over every
 *  facility of that kind (two clinics split the same patients), so a town
 *  reads overloaded only when TOTAL capacity falls short. Exported for the
 *  inspector and the upgrade chooser. */
export function civicLoads(town) {
  const pop = town.pedestrians.citizens.length;
  let students = 0;
  for (const c of town.pedestrians.citizens) {
    const st = stageOf(c.p.age);
    if (st === 'child' || st === 'teen') students++;
  }
  const agg = new Map();
  for (const b of town.buildings) {
    if (b.kind !== 'civic' || !b.capacityKind || !b.capacity) continue;
    const a = agg.get(b.capacityKind) || { cap: 0, bs: [] };
    // Phase 17 — `serviceBonus` is the innovation ladder's `service` lever: a
    // facility serves more people, which is a research answer to an overloaded
    // clinic rather than another storey.
    a.cap += b.capacity * (1 + (town.growth?.serviceBonus || 0));
    a.bs.push(b);
    agg.set(b.capacityKind, a);
  }
  const out = [];
  for (const [kind, a] of agg) {
    const demand = (CIVIC_DEMAND[kind] || (() => Math.round(pop * 0.5)))({ pop, students });
    out.push({ kind, demand, capacity: a.cap, load: a.cap ? demand / a.cap : 1, buildings: a.bs });
  }
  return out;
}

// When a service kind is genuinely over capacity, add another facility of the
// same kind if a wing/floor cannot absorb it. This keeps progression tied to
// measured load rather than the raw count of civic buildings (a 4x2 university
// should count for more service than a one-cell kiosk).
const CIVIC_FACILITY_FOR_KIND = {
  students: 'school',
  // A hospital's catalogue capacity is inpatient beds. Outpatient load is
  // the clinic's `patients/day` contract; mapping it to hospitals silently
  // built expensive bed capacity while the clinic stayed overloaded.
  'patients/day': 'clinic',
  beds: 'hospital',
  // Town hall, library, community and museum all share `visitors`; the
  // library is the expandable public-facing service for this aggregate kind.
  visitors: 'library',
  officers: 'police',
  firefighters: 'fire',
  staff: 'government',
  mail: 'postoffice',
  children: 'daycare',
  pupils: 'conservatory',
  riders: 'transit',
  tertiary: 'college',
  waste: 'recycling'
};

export function civicExpansionNeed(town) {
  return civicLoads(town)
    .filter((row) => row.load > 1)
    .sort((a, b) => b.load - a.load)[0] || null;
}

/** Worst facility-kind load (0..1+; 0 when no civic capacity exists). */
export function worstCivicLoad(town) {
  let w = 0;
  for (const l of civicLoads(town)) w = Math.max(w, l.load);
  return w;
}

/** Load for ONE building — its kind's aggregate load. */
export function buildingLoad(town, b) {
  if (!b || !b.capacityKind) return 0;
  const l = civicLoads(town).find((x) => x.kind === b.capacityKind);
  return l ? l.load : 0;
}

/** A civic building may only be raised while its authored facility has room. */
export function civicHasVerticalHeadroom(building) {
  return !!building?.house && (building.floors || 1) < civicVerticalCap(building);
}

/** The most strained civic record that can still absorb one more floor. */
export function civicUpgradeTarget(town, threshold = 0.85, pending = null) {
  return (town?.buildings || [])
    .filter((b) => b.kind === 'civic' && civicHasVerticalHeadroom(b) && (!pending || !pending.has(b)) && buildingLoad(town, b) > threshold)
    .sort((a, b) => buildingLoad(town, b) - buildingLoad(town, a))[0] || null;
}
/** Filler work (floor upgrades, design commissions) needs savings above this. */
export const BUILD_FLOOR = 250000;

/**
 * Every need gate ranked()/wanted()/situationKey() tests, exported because the
 * council prompt QUOTES these numbers — one source, so the prompt can never
 * drift from the planner (Phase 4 C2 asserts this pair stays in agreement).
 */
export const HOUSE_PRESSURE_GATE = 0.8;
export const HOUSE_SPARE_BEDS = 14;
/** Keep a proportional construction buffer as the town gets large. */
export function housingSpareGate(population = 0) {
  return Math.max(HOUSE_SPARE_BEDS, Math.ceil(Math.max(0, population) * 0.12));
}
/**
 * Housing pressure needs a little hysteresis. The 90% population band leaves
 * roughly 11% spare beds, while the proportional construction gate asks for
 * 12%; integer rounding can therefore leave a town one or two beds short of
 * the next progression milestone with no house ranked at all. Keep the
 * measured 12% buffer and allow a two-bed rounding/progression cushion.
 */
export function housingNeedsBuild(population = 0, capacity = 0, pressure = 0) {
  return pressure > HOUSE_PRESSURE_GATE &&
    capacity - population <= housingSpareGate(population) + 2;
}
export const FILLER_PRESSURE_GATE = 0.6;
/**
 * Population-earned vertical ladder. A town can add floors before it is a
 * metropolis, but the desired cap rises in measured stages so early buildings
 * do not jump straight to towers and a long run does not remain permanently
 * one-storey. Ten floors is the user-visible skyscraper milestone.
 */
export const SKYSCRAPER_FLOORS = 10;
export function desiredFloorsForPopulation(population = 0) {
  if (population >= 800) return 20;
  if (population >= 600) return 16;
  if (population >= 320) return 12;
  if (population >= 200) return 9;
  if (population >= 120) return 6;
  if (population >= 60) return 4;
  return 2;
}
/**
 * Unemployment gate — a FRACTION, because `EconomySystem.unemployment` is
 * `unemployed / labourForce` and never a percentage. It was `10`, compared
 * against a 0..1 value, so every test below it (shop demand, tierup demand,
 * `wanted('shop')`, `wanted('office')`, the council's `situationKey` jobs flag)
 * was permanently false: the jobs feedback loop was dead code. `UNEMPLOYMENT_PCT`
 * is the same number for the prompt, which quotes it in percent.
 */
export const UNEMPLOYMENT_GATE = 0.1;
export const UNEMPLOYMENT_PCT = 10;

/**
 * The town's unemployment as a FRACTION, always read from the one field that
 * holds it. `inputs().economy` is `EconomySystem.stats()`, whose `unemployment`
 * is a PERCENT for display — so the planner's own queue was comparing a display
 * figure against a rate. Everything that gates on jobs reads this, never
 * `stats()`.
 */
export function unemploymentRate(town) {
  return town?.economy?.unemployment ?? 0;
}

// The private developer's own brief: residents per unlet customer seat before
// it will put up a shop, and the balance it refuses to commit.
const ECON_DEVELOPER_PER_SEAT = ECON.business.developerDemandPerSeat;
const ECON_DEVELOPER_RESERVE = ECON.business.developerReserve;
/**
 * Phase 20 (C3b) — office demand. One office per OFFICE_PER_POP citizens, and
 * none at all below OFFICE_MIN_POP: a hamlet's accountant is its shopkeeper,
 * and an office block with four desks earns nothing.
 */
export const OFFICE_PER_POP = 90;
export const OFFICE_MIN_POP = 55;
/**
 * Phase 18 — the treasury floor a district commission needs. A district is
 * many buildings, so it is committed to when the council can plainly afford the
 * whole queue, not just the first step.
 */
export const DISTRICT_FLOOR = 60000;
export const CIVIC_PER_POP = 12;
export const PARKS_PER_POP = 0.6;
export const CONGESTION_GATE = 0.34;
// At this level congestion is an immediate network-capacity problem. A legal
// street run or corridor widening outranks lower-band infill so the council
// does not spend a sitting on a shop while vehicles remain queued.
export const ROAD_EMERGENCY_GATE = 0.65;
export const CIVIC_LOAD_GATE = 0.85;
// A founding town has no spare beds, so a resource that remains strained can
// otherwise outrank housing forever and leave the settlement unable to admit
// its first new household. Once occupancy reaches this level, one feasible
// housing build is the bootstrap that creates room for the other systems to
// catch up; the normal 0.8 pressure gate still applies after that.
export const HOUSING_BOOTSTRAP_PRESSURE = 0.95;

// Priority bands for ranked(): a band + need01 (≤1, inactive never listed)
// makes lower tiers strictly outrank higher ones — utility 10 > housing 9 >
// shops 8 > civic 7 > parks 6 > streets 5 > landmarks ~5 > factories 4 >
// upgrades 3 > archetypes 2 — while need still orders candidates inside a band.
// Near full occupancy, ranked() temporarily raises housing to a bootstrap
// band so a persistent resource strain cannot starve the town of spare beds.
const BAND = {
  power: 10, water: 10, sewage: 10, resource: 10, land: 9.5, house: 9, shop: 8, civic: 7,
  // Phase 20 — an office shares the civic band: it is the same sort of answer
  // (a building the town needs people to work in), ranked just after a shop.
  office: 7,
  road: 5, roadup: 5, bridge: 5, parking: 5, tierup: 6, park: 4, plaza: 4, factory: 4,
  upgrade: 3, renovate: 3, wing: 3, archetype: 2
  // Land acquisition sits just below hard utility/resource work and above
  // housing polish, but appears only when the measured local-shortage gate is
  // true. Landmarks take their band from LANDMARKS[].band (ranked()'s add()).
  // park sits at 4 — BELOW road — so a congested town widens a street instead
  // of laying turf. Park/archetype/upgrades-as-filler/renovate/wing are also
  // tagged amenity in ranked(), which keeps them out of Priority and out of
  // replan(); tierup sits above park so a jobless town lifts a shop before it
  // lays turf, but below shop — a new lot still outranks polishing an old one.
  // roadup shares road's band and is demand, not amenity: widening an existing
  // corridor answers the same congestion the extension answers, and is listed
  // after it (equal scores keep insertion order), so a town still extends the
  // network first and widens what it cannot extend.
  // parking shares the street band as demand above its own pressure gate —
  // bays answer the same drive the congestion number reports — while plaza
  // joins park at 4 as amenity: a square is never the answer a town defaults
  // to. The land-use family (rezone/upzone/clear/annex) is not ranked at all:
  // those are council discretion, ordered by phrase, never invented by the
  // planner and never shown as a Priority. bridge shares the street band as
  // demand too, but only when it would reconnect two road ends across the
  // water (a redundant crossing is orderable, never offered).
};

/**
 * Amenity work: real work the council may still order, but never the answer a
 * healthy town defaults to. Ranked separately so planBoard() can report
 * "Priority: none outstanding" (→ NO_ACTION) while Feasible now still offers
 * the park to a model that deliberately wants one.
 */
export function isAmenity(plan) {
  return !!plan && plan.amenity === true;
}

/**
 * Phase 5 — the commerce rung a shop would climb to next (capacity ladder,
 * ascending: stall → kiosk → shop → store). Null means it already tops out.
 */
export function nextRungFor(capacity = 0) {
  for (const rg of Object.values(SHOP_TIERS)) if (rg.capacity > capacity) return rg;
  return null;
}

/* ------------------------------------------------ site marker dimensions */
/** Vortex height ≈ three storeys (houseKit FLOOR_H 2.35 × 3 + margin). */
const SITE_H = 7.05;
const BAR_W = CELL * 0.92;
const BAR_H = 0.42;
const BAR_GAP = 0.75;
const SPARKS = 16;

/**
 * Tapered spiral strip from ground to SITE_H — the body of the fiery-blue
 * upward vortex. Two copies (counter-rotating) read as a twisting column.
 */
function buildHelixGeo(turns = 1.7, taper = 0.5) {
  const R = CELL * 0.46;
  const seg = 96;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * turns * Math.PI * 2;
    const r = R * (1 - taper * t);
    const y = 0.15 + t * (SITE_H - 0.3);
    const w = 0.42 * (1 - 0.35 * t);
    const ri = Math.max(0.05, r - w * 0.5);
    const ro = r + w * 0.5;
    pos.push(Math.cos(a) * ri, y, Math.sin(a) * ri);
    pos.push(Math.cos(a) * ro, y, Math.sin(a) * ro);
    if (i < seg) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** Per-site rising sparks; positions are rewritten every frame in animate. */
function buildSparkGeo() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  return geo;
}

/** Progress-bar sprite texture: dark trough with a glowing red frame, or the
 *  hot red fill. `toneMapped: false` on the sprites keeps both vivid under
 *  the renderer's ACES tone mapping. */
function makeBarTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 20;
  const x = c.getContext('2d');
  if (kind === 'bg') {
    x.fillStyle = 'rgba(12, 8, 10, 0.88)';
    x.beginPath();
    x.roundRect(2, 2, 156, 16, 6);
    x.fill();
    x.shadowColor = 'rgba(255, 86, 68, 0.95)';
    x.shadowBlur = 12;
    x.strokeStyle = 'rgba(255, 120, 100, 0.98)';
    x.lineWidth = 3;
    x.beginPath();
    x.roundRect(2.5, 2.5, 155, 15, 5);
    x.stroke();
    x.shadowBlur = 0;
    x.strokeStyle = 'rgba(255, 214, 205, 0.6)';
    x.lineWidth = 1;
    x.beginPath();
    x.roundRect(3, 3, 154, 14, 5);
    x.stroke();
  } else {
    x.shadowColor = 'rgba(255, 70, 55, 0.9)';
    x.shadowBlur = 7;
    const g = x.createLinearGradient(0, 0, 0, 20);
    g.addColorStop(0, '#ffe8e1');
    g.addColorStop(0.3, '#ff9a86');
    g.addColorStop(0.68, '#ff5b45');
    g.addColorStop(1, '#e5382b');
    x.fillStyle = g;
    x.fillRect(3, 3, 154, 14);
    x.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Game-hours each construction type takes. 0 lays down instantly.
 *  Exported: the council prompt lists build times from this table. */
export const BUILD_HOURS = {
  house: 16, shop: 20, civic: 32, park: 8, road: 0, roadup: 0, utility: 12, footway: 0,
  // Phase 20 — an office block is a shell plus storeys, so it takes longer than
  // a shop and not as long as a civic hall.
  office: 26,
  'prop-tree': 3, 'prop-lamp': 4, upgrade: 12, archetype: 24, factory: 18,
  resource: 12, renovate: 6, tierup: 10, wing: 14,
  // Phase 8 — a square and a bay are crew work; the land-use family is a
  // stroke of the pen (0h, so it never queues behind a construction).
  plaza: 6, parking: 2, rezone: 0, upzone: 0, clear: 0, annex: 0,
  // Phase 9 — steel and deck take the crews a day and a half.
  bridge: 12,
  // Phase 18 — commissioning a district IS instant; the queue it leaves behind
  // is the work, and each step carries its own build time. 0h so it never
  // queues behind a construction, and so it stays out of the hours table.
  district: 0
};

/** Materials scale with footprint area (single-cell plans stay identical). */
const scaleMats = (mats, n) =>
  n <= 1 ? mats : Object.fromEntries(Object.entries(mats).map(([k, v]) => [k, Math.round(v * n)]));

/**
 * LARGE MULTI-PLOT BUILDS — pure data, no code branches anywhere else.
 * Every row is a landmark the council can commission: adding an entry here
 * automatically gives it a plan, site+size chooser candidates, ranked()/wanted()
 * gates, the BUILD_LANDMARK intent phrases, cost/materials by size, and the
 * acquire-a-block flow. A stadium, a hospital, a market hall — table rows.
 *
 *   sizes      candidate lot sizes (cols×rows); the CHOOSER picks among them
 *              on site quality, budget headroom and need — never hardcoded
 *   cellCost   $ per lot cell (cost = cellCost × chosen area)
 *   matPerCell materials per lot cell (scaled by chosen area)
 *   pop/treasury  ranked()/wanted() gate: the town must want it
 *   owner      default ownership ('state' civic landmarks, 'private' commerce)
 */
export const LANDMARKS = {
  mall: {
    id: 'mall', label: 'A shopping mall rises on the acquired block',
    zone: ZONE.COMMERCIAL, floors: 3, cellCost: 25000,
    matPerCell: { lumber: 9, cement: 11, steel: 6 },
    sizes: [[4, 3], [3, 3], [4, 2], [3, 2], [2, 3], [2, 2]],
    hours: 60, band: 5, owner: 'private', pop: 90, treasury: 400000, shops: 4,
    phrases: ['BUILD MALL', 'SHOPPING MALL', 'THE MALL', 'NEW MALL', 'MALL']
  },
  multiplex: {
    id: 'multiplex', label: 'A multiplex opens on the cleared block',
    zone: ZONE.COMMERCIAL, floors: 2, cellCost: 26000,
    matPerCell: { lumber: 10, cement: 11, steel: 7 },
    sizes: [[3, 3], [3, 2], [2, 3], [2, 2]],
    hours: 44, band: 4.5, owner: 'private', pop: 150, treasury: 300000,
    phrases: ['BUILD MULTIPLEX', 'CINEMA', 'MULTIPLEX', 'MOVIE THEATER', 'MOVIE THEATRE']
  },
  market: {
    id: 'market', label: 'A market hall opens its arcades',
    zone: ZONE.COMMERCIAL, floors: 2, cellCost: 18000,
    matPerCell: { lumber: 12, cement: 10, steel: 6 },
    sizes: [[3, 2], [2, 2], [2, 1]],
    hours: 36, band: 4.8, owner: 'state', pop: 110, treasury: 250000,
    phrases: ['BUILD MARKET', 'MARKET HALL', 'INDOOR MARKET', 'FLEA MARKET', 'BAZAAR', 'MARKET']
  },
  stadium: {
    id: 'stadium', label: 'A stadium breaks ground on the acquired block',
    zone: ZONE.CIVIC, floors: 2, cellCost: 28000,
    matPerCell: { lumber: 8, cement: 18, steel: 16 },
    sizes: [[4, 4], [4, 3], [3, 4], [3, 3]],
    hours: 80, band: 5, owner: 'state', pop: 260, treasury: 800000,
    phrases: ['BUILD STADIUM', 'STADIUM', 'SPORTS ARENA', 'ARENA']
  },
  hospital: {
    id: 'hospital', label: 'A hospital complex rises on the acquired block',
    zone: ZONE.CIVIC, floors: 4, cellCost: 32000,
    matPerCell: { lumber: 12, cement: 20, steel: 14 },
    sizes: [[3, 3], [3, 2], [2, 3], [2, 2]],
    hours: 72, band: 5.5, owner: 'state', pop: 180, treasury: 600000,
    phrases: ['BUILD HOSPITAL', 'NEW HOSPITAL', 'HOSPITAL', 'MEDICAL CENTER']
  },
  campus: {
    id: 'campus', label: 'A university campus spreads across the block',
    zone: ZONE.CIVIC, floors: 3, cellCost: 30000,
    matPerCell: { lumber: 14, cement: 16, steel: 12 },
    sizes: [[4, 3], [3, 3], [3, 2]],
    hours: 90, band: 4.6, owner: 'state', pop: 300, treasury: 900000,
    capacity: 520, capacityKind: 'tertiary',
    phrases: ['BUILD UNIVERSITY', 'UNIVERSITY', 'COLLEGE', 'CAMPUS']
  },
  estate: {
    id: 'estate', label: 'An industrial estate clears its plots',
    zone: ZONE.INDUSTRIAL, floors: 1, cellCost: 22000,
    matPerCell: { lumber: 8, cement: 14, steel: 12 },
    sizes: [[3, 3], [3, 2], [2, 3], [2, 2]],
    hours: 54, band: 4.2, owner: 'private', pop: 130, treasury: 350000,
    phrases: ['BUILD INDUSTRIAL PARK', 'INDUSTRIAL ESTATE', 'BUSINESS PARK', 'INDUSTRIAL PARK']
  },
  tower: {
    id: 'tower', label: 'An office tower rises on the acquired block',
    zone: ZONE.COMMERCIAL, floors: 14, cellCost: 34000,
    matPerCell: { lumber: 10, cement: 22, steel: 24 },
    sizes: [[3, 3], [3, 2], [2, 3], [2, 2]],
    hours: 96, band: 5.4, owner: 'private', pop: 180, treasury: 650000,
    phrases: ['OFFICE TOWER', 'SKYSCRAPER', 'TOWER BLOCK', 'TOWER']
  },
  hotel: {
    id: 'hotel', label: 'A hotel opens its doors on the acquired block',
    zone: ZONE.COMMERCIAL, floors: 6, cellCost: 26000,
    matPerCell: { lumber: 11, cement: 15, steel: 12 },
    sizes: [[3, 3], [3, 2], [2, 3], [2, 2]],
    hours: 56, band: 4.6, owner: 'private', pop: 130, treasury: 380000,
    phrases: ['BUILD HOTEL', 'GRAND HOTEL', 'HOTEL']
  },
  station: {
    id: 'station', label: 'A train station links the town to the line',
    zone: ZONE.CIVIC, floors: 2, cellCost: 30000,
    matPerCell: { lumber: 12, cement: 18, steel: 16 },
    sizes: [[4, 3], [4, 2], [3, 2]],
    hours: 70, band: 4.8, owner: 'state', pop: 170, treasury: 500000,
    phrases: ['TRAIN STATION', 'RAILWAY STATION', 'STATION']
  },
  zoo: {
    id: 'zoo', label: 'A zoo opens beyond the parade ground',
    zone: ZONE.CIVIC, floors: 1, cellCost: 24000,
    matPerCell: { lumber: 10, cement: 12, steel: 8 },
    sizes: [[4, 4], [4, 3], [3, 4], [3, 3]],
    hours: 64, band: 4.4, owner: 'state', pop: 200, treasury: 550000,
    phrases: ['BUILD ZOO', 'ZOO', 'ANIMAL PARK']
  },
  amphitheatre: {
    id: 'amphitheatre', label: 'An amphitheatre is carved into the slope',
    zone: ZONE.CIVIC, floors: 1, cellCost: 22000,
    matPerCell: { lumber: 14, cement: 13, steel: 9 },
    sizes: [[4, 3], [3, 3], [3, 2]],
    hours: 50, band: 4.5, owner: 'state', pop: 150, treasury: 420000,
    phrases: ['AMPHITHEATRE', 'AMPHITHEATER', 'OPEN AIR THEATER', 'CONCERT BOWL']
  }
};

/** A landmark plan: costs/materials by the CHOSEN size (see siteForFootprint). */
function landmarkPlan(town, lm, opts = {}) {
  const minSize = lm.sizes.reduce((a, b) => (a[0] * a[1] <= b[0] * b[1] ? a : b));
  const minArea = minSize[0] * minSize[1];
  // An industrial landmark has to name its works. Without this the runner
  // passed no `factory`, and createBuilding's `|| FACTORY_TYPES[0]` fallback
  // made EVERY industrial estate a sawmill — an estate of eleven lots came out
  // as eleven lumber mills and never consulted what the storehouse needed.
  const factory =
    lm.zone === ZONE.INDUSTRIAL
      ? FACTORY_TYPES.find((f) => f.id === opts.factory) ||
        FACTORY_TYPES.find((f) => f.product === (town.industry?.commissionProduct?.() || 'lumber')) ||
        FACTORY_TYPES[0]
      : null;
  const plan = {
    type: lm.id,
    landmark: lm.id,
    wantZone: lm.zone,
    footprintCandidates: lm.sizes,
    acquire: true,
    cellCost: lm.cellCost,
    matPerCell: lm.matPerCell,
    need: opts.need ?? 0.5,
    hours: lm.hours,
    label: lm.label,
    owner: opts.owner || lm.owner || 'private',
    factory: factory ? factory.id : null,
    cost: lm.cellCost * minArea,
    materials: scaleMats(lm.matPerCell, minArea)
  };
  plan.run = (c) =>
    !!c &&
    town.placeBuilding(c[0], c[1], lm.zone, {
      footprint: plan.footprint || { cols: minSize[0], rows: minSize[1] },
      acquire: true,
      floors: lm.floors,
      subtype: lm.id,
      capacity: lm.capacity || undefined,
      capacityKind: lm.capacityKind || undefined,
      factory: plan.factory || undefined,
      owner: plan.owner,
      name: opts.name || (factory ? factory.label : opts.name) || null
    });
  return plan;
}

export function planFor(town, type, opts = {}) {
  // Any LANDMARKS catalogue id plans generically — the council can order
  // every large block-acquire in the table with no per-type branches.
  // `type: 'landmark', opts.landmark: id` is the intent-parsed route to
  // the same plan.
  const lm = LANDMARKS[type] || (type === 'landmark' ? LANDMARKS[opts.landmark] : null);
  if (lm) return landmarkPlan(town, lm, opts);
  switch (type) {
    case 'house':
      const plan = {
        type: 'house',
        label: 'A new family needs a home',
        cost: COST.house,
        materials: MATERIALS.house,
        run: (c) => !!c && !town.buildingAt(c[0], c[1]) && town.placeBuilding(c[0], c[1], ZONE.RESIDENTIAL)
      };
      return plan;
    case 'office': {
      // Phase 20 (C3b) — an OFFICE BLOCK: commercial land, but a building that
      // earns from desks rather than footfall. It is sited like a shop and
      // priced like one (same shell, more storeys), and it is a distinct plan
      // type so `wanted`/`ranked` can gate it separately.
      const fp = opts.footprint || null;
      const cells = fp ? fp.cols * fp.rows : 1;
      const floors = Math.max(2, Math.min(MAX_FLOORS, Math.round(opts.floors || 3)));
      return {
        type: 'office',
        footprint: fp,
        acquire: !!opts.acquire,
        name: opts.name || null,
        floors,
        label: opts.name ? `An office block opens — "${opts.name}"` : 'An office block opens for the town’s business',
        cost: Math.round(COST.shop * cells + COST.office * floors),
        materials: scaleMats(MATERIALS.shop, cells),
        run: (c) =>
          !!c &&
          !!town.placeBuilding(c[0], c[1], ZONE.COMMERCIAL, {
            footprint: fp,
            acquire: !!opts.acquire,
            kind: 'office',
            floors,
            name: opts.name || null
          })
      };
    }
    case 'shop': {
      const fp = opts.footprint || null;
      if (fp) {
        // Explicit footprint (player/grammar): priced by cells, as before.
        const cells = fp.cols * fp.rows;
        return {
          type: 'shop',
          footprint: fp,
          acquire: !!opts.acquire,
          label: 'A shop opens to serve the town',
          cost: Math.round(COST.shop * cells),
          materials: scaleMats(MATERIALS.shop, cells),
          run: (c) =>
            !!c &&
            town.placeBuilding(c[0], c[1], ZONE.COMMERCIAL, {
              footprint: fp,
              acquire: !!opts.acquire,
              name: opts.name || null
            })
        };
      }
      // THE COMMERCE LADDER: rung + lot chosen by the council's chooser from
      // site, budget and need (pin one rung with opts.tier). Upfront cost/
      // materials are the cheapest rung's — apply() reprices after the size
      // decision. The chosen rung's capacity drives the customer split.
      const existingSeats = town.buildings.filter((b) => b.purpose === 'commercial' && b.kind !== 'office')
        .reduce((n, b) => n + (b.capacity || 0), 0);
      const unmet = opts.unmet ?? Math.max(0, (town.pedestrians?.citizens?.length || 0) - existingSeats);
      const targetCapacity = Math.max(1, Math.ceil(unmet * 1.2));
      const orderedRungs = Object.values(SHOP_TIERS);
      const selected = orderedRungs.find((r) => r.capacity >= targetCapacity) || orderedRungs.at(-1);
      const rungs = opts.tier && SHOP_TIERS[opts.tier] ? [SHOP_TIERS[opts.tier]] : [selected];
      const cands = [];
      for (const rg of rungs) {
        // A commerce rung describes a canonical capacity for its smallest
        // lot.  Larger lots in the same rung buy proportionally more customer
        // space; otherwise a 4x2 department store and a 3x1 store would have
        // identical occupancy despite twice the footprint.
        const baseArea = Math.min(...rg.sizes.map(([cols, rows]) => cols * rows));
        for (const [cols, rows] of rg.sizes) {
          const area = cols * rows;
          cands.push({
            cols,
            rows,
            tier: rg.id,
            cellCost: rg.cellCost,
            capacity: Math.max(1, Math.round(rg.capacity * area / Math.max(1, baseArea)))
          });
        }
      }
      const minCost = Math.min(...cands.map((c) => c.cellCost * c.cols * c.rows));
      const minCells = Math.min(...cands.map((c) => c.cols * c.rows));
      const plan = {
        type: 'shop',
        footprintCandidates: cands,
        tier: opts.tier && SHOP_TIERS[opts.tier] ? opts.tier : null,
        need: opts.need ?? 0.5,
        acquire: !!opts.acquire,
        label: 'A shop opens to serve the town',
        cost: minCost,
        materials: scaleMats(MATERIALS.shop, minCells),
        matPerCell: MATERIALS.shop,
        run: (c) =>
          !!c &&
          town.placeBuilding(c[0], c[1], ZONE.COMMERCIAL, {
            footprint: plan.footprint || undefined,
            acquire: !!opts.acquire,
            capacityPerFloor: plan.capacity || undefined,
            name: opts.name || null
          })
      };
      return plan;
    }
    case 'civic': {
      const fp = opts.footprint || null;
      const facility = opts.facility || null;
      // A named civic facility carries a minimum horizontal site from the
      // shared catalogue. The old plan defaulted every BUILD_CIVIC to 1x1 and
      // only increased floors, so a school, hospital, or college could never
      // acquire the land needed for classrooms, wards, labs, and courtyards.
      const facilityBlock = facility ? constructionBlock(`civic.${facility}`) : null;
      const minFootprint = facilityBlock
        ? { cols: facilityBlock.footprint[0], rows: facilityBlock.footprint[1] }
        : null;
      const requestedFootprint = fp
        ? {
            cols: Math.max(1, Math.round(fp.cols || 1)),
            rows: Math.max(1, Math.round(fp.rows || 1))
          }
        : null;
      // An explicit size may be larger, but never smaller, than the facility's
      // credible campus. This keeps creative/model-authored specs honest while
      // still allowing a richer town to commission a bigger block.
      const enforcedFootprint = requestedFootprint && minFootprint
        ? {
            cols: Math.max(requestedFootprint.cols, minFootprint.cols),
            rows: Math.max(requestedFootprint.rows, minFootprint.rows)
          }
        : requestedFootprint || minFootprint;
      const cells = enforcedFootprint ? enforcedFootprint.cols * enforcedFootprint.rows : 1;
      // Tertiary education is a public service with a private capital leg. A
      // small town should not have to choose between a 30-day operating
      // runway and its first college: the state owns the facility and sets the
      // outcome, while the developer account finances the shell. This keeps
      // progression possible at the protected treasury floor and records the
      // capital source in the project ledger.
      // Civic capacity is state-owned and publicly operated. Progression
      // facilities always use the developer capital leg; an ordinary civic
      // shell uses it only when the treasury cannot meet its own protected
      // public reserve. That keeps the PPP a backstop rather than allowing the
      // council to spend the developer's whole wallet on routine facilities.
      const publicReserve = town.economy?.requiredPublicReserve?.(47000) || 0;
      const governmentAffordable = !town.economy || town.economy.treasury >= publicReserve + COST.civic * cells;
      const financingSector = facility || !governmentAffordable ? 'developer' : undefined;
      const bill = facilityBlock
        ? constructionBlockQuote(facilityBlock.id, { area: cells })
        : null;
      const plan = {
        type: 'civic',
        zone: 'civic',
        owner: financingSector ? 'state' : undefined,
        // Which facility the council ordered (BUILD_CIVIC facility=…);
        // absent the placer picks one from the catalogue as it always did.
        facility,
        forceNeed: facility === 'transit',
        blockId: facilityBlock?.id || null,
        footprint: enforcedFootprint,
        footprintCandidates: enforcedFootprint ? [enforcedFootprint] : null,
        acquire: !!opts.acquire,
        label: 'The council funds a new civic building',
        cost: bill?.cost || Math.round(COST.civic * cells),
        materials: bill?.materials || scaleMats(MATERIALS.civic, cells),
        financingSector,
        // Named progression facilities (college, university, recycling, and
        // similar service campuses) may import the small missing construction
        // bill through the developer leg.  Otherwise a healthy cash position
        // plus a temporary local-stock dip makes the progression row appear
        // feasible but never start.
        allowMaterialImports: !!facility,
        run: (c) =>
          !!c &&
          town.placeBuilding(c[0], c[1], ZONE.CIVIC, {
            footprint: plan.footprint || undefined,
            acquire: !!opts.acquire,
            facility: facility || undefined,
            blockId: facilityBlock?.id || undefined,
            name: opts.name || null
          })
      };
      return plan;
    }
    case 'factory': {
      // Phase 12 — a pinned type wins; a bare BUILD_FACTORY derives its works
      // from live signals (strained commodity, else the balanced pick).
      const derived =
        (town.industry && town.industry.commissionProduct && town.industry.commissionProduct()) ||
        'lumber';
      const def =
        FACTORY_TYPES.find((f) => f.id === opts.factory) ||
        FACTORY_TYPES.find((f) => f.product === derived) ||
        FACTORY_TYPES[0];
      // A pinned footprint (the player tool, a council spec) is honoured as
      // given; otherwise the works carries a candidate LOT SIZES list and the
      // chooser in apply() picks on site quality, budget headroom and need.
      const fp = opts.footprint || null;
      const candidates = fp ? null : FACTORY_SIZES;
      // Cost and materials follow the area actually chosen, not a guess: with
      // no pinned footprint the smallest rung is the floor, since siteForFootprint
      // re-prices the winner from its own area before anything is charged.
      const cells = fp ? fp.cols * fp.rows : Math.min(...FACTORY_SIZES.map((s) => s[0] * s[1]));
      const plan = {
        type: 'factory',
        factory: def.id,
        footprint: fp,
        footprintCandidates: candidates,
        acquire: !!opts.acquire,
        label: `A new ${def.label.toLowerCase()} breaks ground`,
        cellCost: COST.factory,
        // matPerCell, not a fixed bag: apply() re-prices BOTH from the chosen
        // area once siteForFootprint has picked a lot, so a 3x3 works is
        // charged for nine cells' worth of steel instead of the floor rung's
        // four — the `materials` below is only the upfront affordability check.
        matPerCell: MATERIALS.factory,
        cost: Math.round(COST.factory * cells),
        materials: scaleMats(MATERIALS.factory, cells),
        // The first works may seed its construction bill through the
        // contractor account. This is a one-time industrial bootstrap; after
        // the first factory exists, every build must use local stock or an
        // explicit trade order.
        bootstrapMaterials: true,
        bootstrapProduct: def.product,
        // The lot runs through `plan`, not the closed-over `fp`: apply()
        // writes the chooser's pick onto plan.footprint, and reading the
        // closure here would silently build every council-planned works 1x1.
        run: (c) =>
          !!c &&
          town.placeBuilding(c[0], c[1], ZONE.INDUSTRIAL, {
            footprint: plan.footprint || undefined,
            acquire: !!opts.acquire,
            factory: def.id,
            factoryModules: def.modules || [],
            name: opts.name || null
          })
      };
      return plan;
    }
    case 'park':
      return {
        type: 'park',
        label: 'A patch of green is set aside for the town',
        cost: COST.park,
        run: (c) => !!c && !town.buildingAt(c[0], c[1]) && town.setPark(c[0], c[1])
      };
    // Phase 8 — surface works: single-cell site searches, like park/road.
    case 'plaza':
      return {
        type: 'plaza',
        label: 'A civic square is paved for the town',
        cost: COST.plaza,
        run: (c) => !!c && town.paintPlaza(c[0], c[1])
      };
    case 'parking':
      return {
        type: 'parking',
        label: 'A kerbside parking bay is reserved',
        cost: COST.parking,
        run: (c) => !!c && town.paintParking(c[0], c[1])
      };
    // Phase 8 — land use: each order carries its OWN brush (found in planFor,
    // applied by run), so apply() never re-searches a site it already priced.
    case 'rezone': {
      // The spec always carries zone=; without one there is nothing to paint.
      const g = town.growth;
      const zone = opts.zone;
      if (!g || !zone || !g.landUseCells) return null;
      const cells = g.landUseCells('rezone', zone);
      if (!cells.length) return null;
      return {
        type: 'rezone',
        zone,
        cells,
        label: `The land is rezoned ${zone}`,
        cost: Math.round(COST.rezone * cells.length),
        run: () => town.rezone(cells, zone) > 0
      };
    }
    case 'upzone': {
      const g = town.growth;
      if (!g || !g.landUseCells) return null;
      const cells = g.landUseCells('upzone');
      if (!cells.length) return null;
      return {
        type: 'upzone',
        cells,
        label: `Density is raised on ${cells.length} cell${cells.length === 1 ? '' : 's'}`,
        cost: Math.round(COST.upzone * cells.length),
        run: () => town.upzone(cells).cells > 0
      };
    }
    case 'clear': {
      const g = town.growth;
      const cell = g && g.findCell ? g.findCell('clear') : null;
      const target = cell ? town.buildingAt(cell[0], cell[1]) : null;
      if (!target) return null;
      const cells = target.footprint || [target.cell];
      return {
        type: 'clear',
        target,
        cells,
        label: `${target.name || 'A building'} is cleared from its lot`,
        cost: COST.clear,
        // Idempotent: a lot that is already clear has answered the order.
        run: () => !town.buildings.includes(target) || town.clearLot(target)
      };
    }
    case 'restructure': {
      const target = town.buildings
        .filter((b) => b.house && b.facility !== 'townhall' && (b.kind === 'civic' ? civicHasVerticalHeadroom(b) : b.floors < MAX_FLOORS))
        .sort((a, b) => (a.floors || 1) - (b.floors || 1))[0];
      if (!target) return null;
      return {
        type: 'restructure',
        target,
        cells: target.footprint || [target.cell],
        label: `${target.name || 'A building'} is restructured for another floor`,
        cost: Math.round(COST.clear * 0.7),
        run: () => !!town.restructureBuilding(target)
      };
    }
    case 'land': {
      const growth = town.growth;
      let target = null;
      const population = town.pedestrians?.citizens?.length || 0;
      if (population >= 80 && !town.buildings.some((b) => b.purpose === 'industrial')) {
        target = planFor(town, 'factory');
      } else if (population >= 45 && !town.buildings.some((b) => b.facility === 'college' || b.facility === 'university')) {
        target = planFor(town, 'civic', { facility: 'college' });
      } else if (population >= 150 && town.buildings.some((b) => b.facility === 'college') &&
        !town.buildings.some((b) => b.facility === 'university' || b.subtype === 'campus')) {
        target = planFor(town, 'civic', { facility: 'university' });
      }
      const cells = growth?.landAcquisitionCells?.(target) || town.perimeter?.frontierCells(6) || [];
      if (!cells.length) return null;
      const cost = town.perimeter.quote(cells).cost;
      return {
        type: 'land',
        cells,
        label: `The town acquires ${cells.length} frontier tiles`,
        cost,
        // Growth funds the quoted land bill through the normal project ledger;
        // do not debit the perimeter a second time when the executor records
        // the acquired cells.
        run: () => !!town.perimeter.acquire(cells, { reason: 'council land acquisition', charge: false })
      };
    }
    case 'annex': {
      const g = town.growth;
      if (!g || !g.landUseCells) return null;
      // No zone= means "bring the edge in on the town's own terms".
      const zone = opts.zone || g.dominantZone();
      const cells = g.landUseCells('annex', zone);
      if (!cells.length) return null;
      // Phase 17 — the exploration bucket's surveys make annexing surer and
      // cheaper: a cell the town has already mapped is a known quantity, so it
      // costs a discount, and a mapped cell is preferred over an unknown one.
      // A fully mapped brush still costs the discounted rate — a survey is
      // never worth annexing the ground for nothing.
      const res = town.research;
      let discounted = 0;
      if (res && res.surveyed && res.surveyed.size) {
        for (const [x, y] of cells) if (res.isSurveyed(x, y)) discounted++;
      }
      const full = cells.length - discounted;
      const price = Math.round(COST.annex * (full + discounted * (1 - ANNEX_SURVEY_DISCOUNT)));
      return {
        type: 'annex',
        zone,
        cells,
        label: `The edge of town is annexed as ${zone}` +
          (discounted ? ` (${discounted} of ${cells.length} cells already surveyed)` : ''),
        cost: price,
        surveyDiscount: discounted,
        run: () => town.rezone(cells, zone) > 0
      };
    }
    case 'road':
      return {
        type: 'road',
        label: 'Road crews extend a street',
        cost: COST.road,
        // The anchor is laid first (it is what makes the order legal), then the
        // rest of the selected run. `self.cells` is attached by
        // apply(), which also re-prices the order against those cells.
        run: (c, _target, self) => {
          if (!town.paintRoad(c[0], c[1])) return false;
          const run = self?.cells?.length ? self.cells : [c];
          for (const [rx, ry] of run) {
            if (rx === c[0] && ry === c[1]) continue;
            if (!town.paintRoad(rx, ry)) return false;
          }
          return true;
        }
      };
    case 'roadup': {
      // Phase 7 — raise a whole corridor one rung (or to `class=`) in one
      // order. No site search: the plan carries its own cells, priced by the
      // rungs it climbs (see ROAD_UPGRADE_RUNG).
      const g = town.growth;
      if (!g || !g.roadUpgradeTarget) return null;
      const target = g.roadUpgradeTarget(opts);
      if (!target) return null;
      return {
        type: 'roadup',
        cells: target.cells,
        from: target.from,
        to: target.to,
        // Only a council that named a rung replays one (planCode).
        pinned: !!opts.to,
        label: `Corridor upgraded to ${XS_CLASS_LABEL[target.to]}`,
        cost: target.cost,
        run: () => {
          const r = town.upgradeRoadRun(target.cells, target.to);
          return !!(r && r.ok);
        }
      };
    }
    case 'bridge': {
      // Phase 9 — the plan carries its own gap: every cell is still water
      // when the order is placed, and the painter refuses the whole thing
      // if any of them dried up or drifted past the width limit.
      const g = town.growth;
      if (!g || !g.bridgeTarget) return null;
      const target = g.bridgeTarget();
      if (!target) return null;
      const n = target.cells.length;
      return {
        type: 'bridge',
        cells: target.cells,
        label: 'A bridge is thrown across the river',
        cost: Math.round(COST.bridge * n),
        materials: scaleMats(MATERIALS.bridge, n),
        run: () => town.buildBridge(target.cells)
      };
    }
    case 'footway':
      // One project = one chain: from the anchor beside a landlocked lot,
      // the shortest path through free land to the street (or an existing
      // footway). Painting it gives the parcel frontage, so the inland lot
      // becomes buildable as soon as the crews finish.
      return {
        type: 'footway',
        label: 'Volunteers lay a footway to the back lots',
        cost: COST.footway,
        run: (c) => !!c && town.paintFootway(c[0], c[1])
      };
    case 'prop-tree':
      return {
        type: 'prop-tree',
        label: 'Volunteers plant trees along the verges',
        cost: COST['prop-tree'],
        run: (c) => !!c && !town.buildingAt(c[0], c[1]) && town.addProp(c[0], c[1], 'tree')
      };
    case 'prop-lamp':
      return {
        type: 'prop-lamp',
        label: 'Crews install a street lamp',
        cost: COST['prop-lamp'],
        run: (c) => !!c && !town.buildingAt(c[0], c[1]) && town.addProp(c[0], c[1], 'lamp')
      };
    case 'upgrade': {
      // Need-driven target: a facility over its designed load first (the
      // most strained one with headroom), else the shortest building with
      // headroom — never a target another pending project is raising.
      const g = town.growth;
      const head = (b) => b.house && (b.kind === 'civic' ? civicHasVerticalHeadroom(b) : (b.floors || 1) < MAX_FLOORS) && (!g || !g.pendingTargets.has(b));
      const strained = town.buildings
        .filter((b) => b.kind === 'civic' && head(b) && buildingLoad(town, b) > 0.85)
        .sort((a, b) => buildingLoad(town, b) - buildingLoad(town, a));
      const target =
        strained[0] ||
        g.progressionTarget?.() ||
        town.buildings.filter((b) => b.kind !== 'civic' && head(b)).sort((a, b) => (a.floors || 1) - (b.floors || 1))[0] ||
        null;
      if (!target) return null;
      const kindCost = target.kind === 'shop' ? 7000 : target.kind === 'civic' ? 14000 : 5000;
      const plan = {
        type: 'upgrade',
        target,
        label: `${target.name || 'A building'} gains a floor`,
        cost: kindCost,
        materials: MATERIALS.upgrade,
        run: (_c, rec) => {
          const r = town.expandBuilding(rec, { floors: 1 });
          return !!(r && r.floorsDelta > 0);
        }
      };
      // A civic floor is capacity infrastructure. Once the operating reserve
      // is protected, the state can be unable to add a clinic, school or
      // recycling floor even while the private capital pool is idle. Treat
      // the capacity outcome like other public-private partnerships so an
      // overloaded service cannot hold population pull at zero forever.
      if (target.kind === 'civic') {
        plan.owner = 'state';
        plan.financingSector = 'developer';
      }
      // Height is a capacity/progression action.  Let the contractor import a
      // small missing bill when local industry has not caught up yet; without
      // this, every town with healthy cash but no cement/steel producer gets
      // trapped at its founding height and can never reach the population
      // earned floor rungs.
      plan.allowMaterialImports = true;
      plan.financingSector = 'developer';
      return plan;
    }
    case 'renovate': {
      // In-place polish: the plainest building under the budget ladder's top
      // rung, climbed to `budget` (default 3). No site needed — the work
      // happens on the building that is already there.
      const g = town.growth;
      const target = g && g.renovateTarget ? g.renovateTarget(opts) : null;
      if (!target) return null;
      const cur = target.budget ?? target.house?.spec?.budget ?? 1;
      const want = Math.max(cur + 1, Math.min(3, Math.round(opts.budget || 3)));
      const steps = want - cur;
      if (steps <= 0) return null;
      return {
        type: 'renovate',
        target,
        budget: want,
        label: `${target.name || 'A building'} is renovated to budget tier ${want}`,
        cost: COST.renovate * steps,
        materials: scaleMats(MATERIALS.renovate, steps),
        run: (_c, rec) => {
          const r = town.renovateBuilding(rec, { budget: want });
          return !!(r && r.budgetDelta > 0);
        }
      };
    }
    case 'tierup': {
      // Commerce ladder: a shop climbs one rung (capacity), no new lot.
      // tier=<id> pins the rung the council wants to reach.
      const g = town.growth;
      const pinned = opts.tier && SHOP_TIERS[opts.tier] ? SHOP_TIERS[opts.tier] : null;
      const target = g && g.tierupTarget ? g.tierupTarget(pinned) : null;
      const next =
        target && pinned && (target.capacity || 0) < pinned.capacity
          ? pinned
          : target
            ? nextRungFor(target.capacity || 0)
            : null;
      if (!target || !next) return null;
      return {
        type: 'tierup',
        target,
        tier: next.id,
        label: `${target.name || 'A shop'} moves up to the ${next.label}`,
        cost: COST.tierup,
        materials: MATERIALS.tierup,
        financingSector: 'developer',
        // Commerce progression is a capacity investment.  A young town may
        // need one small import before its first factory is online.
        allowMaterialImports: true,
        run: (_c, rec) => {
          const r = town.tierupBuilding(rec, next);
          return !!(r && r.tierDelta);
        }
      };
    }
    case 'wing': {
      // Phase 6 — a wing: grow an existing building into a full strip of
      // free cells on its OWN parcel (no new lot, no street). `opts.landmark`
      // switches the same machinery into landmark expansion, which may buy
      // out an occupied neighbour (the LANDMARKS acquire flow, re-used).
      const g = town.growth;
      if (!g || !g.wingTarget) return null;
      const lmId = opts.landmark || null;
      const acquire = lmId ? opts.acquire !== false : !!opts.acquire;
      const target = opts.target || g.wingTarget({
        landmark: lmId,
        acquire,
        civicOnly: !!opts.civicOnly
      });
      if (!target) return null;
      const strip = g.wingStrip(target, { acquire });
      if (!strip || !strip.length) return null;
      const occupied = strip.some(([cx, cy]) => !!town.buildingAt(cx, cy));
      const acq = occupied && acquire ? g.estimateAcquire(strip) : 0;
      const lm = lmId ? LANDMARKS[lmId] : null;
      return {
        type: 'wing',
        target,
        cells: strip,
        expand: lmId || null,
        acquire: !!occupied,
        label: lm
          ? `${lm.label} gains an annex wing`
          : `${target.name || 'A building'} gains a wing`,
        cost: COST.wing + acq,
        materials: MATERIALS.wing,
        financingSector: 'developer',
        // A wing is the horizontal counterpart to a floor and must not be
        // permanently blocked by a missing local input during early growth.
        allowMaterialImports: true,
        run: (_c, rec) => {
          // Neighbours out first (their price is already in plan.cost), then
          // the strip is claimed and the footprint re-derived.
          if (occupied) town.growth.demolishFor(strip);
          const r = town.wingBuilding(rec, strip);
          return !!(r && r.wing && r.wing.length);
        }
      };
    }
    case 'archetype': {
      // A council-composed design: pick a kit zone, style, floors, roof,
      // budget tier and extras. The LOT SIZE defaults to the chooser's
      // candidate table (scored by site/budget/need) but the council may pin
      // one explicitly with size= — either way it is never a hardcoded
      // number hidden in this file.
      const block = opts.blockId ? constructionBlock(opts.blockId) : null;
      const inferredZone = block?.id?.startsWith('civic.')
        ? 'civic'
        : block && ['mixed.use', 'office.lobby'].includes(block.id)
          ? 'shop'
          : block?.id?.startsWith('house.')
            ? 'house'
            : null;
      const zone = ['house', 'shop', 'civic'].includes(opts.zone) ? opts.zone : (inferredZone || 'house');
      const zoneZ = { house: ZONE.RESIDENTIAL, shop: ZONE.COMMERCIAL, civic: ZONE.CIVIC }[zone];
      const facility = zone === 'civic' && (opts.facility || block?.facility) ? (opts.facility || block.facility) : null;
      const overrides = {};
      if (opts.style) overrides.style = opts.style;
      if (opts.floors) overrides.floors = Math.max(1, Math.min(MAX_FLOORS, Math.round(opts.floors)));
      if (opts.garage != null) overrides.garage = !!opts.garage;
      if (opts.porch != null) overrides.porch = !!opts.porch;
      if (opts.chimney != null) overrides.chimney = !!opts.chimney;
      if (opts.accessible != null) overrides.accessible = !!opts.accessible;
      if (opts.balcony != null) overrides.balcony = !!opts.balcony;
      if (opts.solar != null) overrides.solar = !!opts.solar;
      if (opts.greenRoof != null) overrides.greenRoof = !!opts.greenRoof;
      if (block) {
        for (const module of block.modules || []) {
          if (module === 'ramp') overrides.accessible = true;
          if (module === 'balcony') overrides.balcony = true;
          if (module === 'solar-roof') overrides.solar = true;
          if (module === 'green-roof') overrides.greenRoof = true;
        }
      }
      if (opts.roofType) overrides.roofType = opts.roofType;
      if (opts.budget) overrides.budget = Math.max(1, Math.min(3, Math.round(opts.budget)));
      const bits = [block?.label || opts.style || 'bespoke', zone];
      if (block) bits.push(`[${block.id}]`);
      if (facility) bits.push(facility);
      if (overrides.floors) bits.push(`${overrides.floors} floors`);
      if (overrides.roofType) bits.push(`${overrides.roofType} roof`);
      if (overrides.budget) bits.push(`tier ${overrides.budget}`);
      const extras = ['porch', 'garage', 'chimney', 'accessible', 'balcony', 'solar', 'greenRoof'].filter((k) => overrides[k]);
      if (extras.length) bits.push(extras.join('+'));
      const cellCost = COST[zone] ?? COST.house;
      const sizes = opts.size
        ? [[opts.size.cols, opts.size.rows]]
        : block
          ? [block.footprint]
        : zone === 'house'
          ? [[1, 1], [2, 1], [2, 2]]
          : [[1, 1], [2, 1], [2, 2], [3, 2]];
      if (opts.size) bits.push(`${opts.size.cols}x${opts.size.rows}`);
      const area = sizes[0][0] * sizes[0][1];
      const bill = block ? constructionBlockQuote(block.id, { area }) : null;
      const plan = {
        type: 'archetype',
        blockId: block?.id || null,
        zone,
        footprintCandidates: sizes,
        cellCost,
        flatFee: 1500,
        matPerCell: MATERIALS.archetype,
        need: opts.need ?? 0.4,
        label: `A new ${bits.join(' ')} design breaks ground${opts.name ? ` ("${opts.name}")` : ''}`,
        cost: bill ? bill.cost : cellCost + 1500,
        materials: bill ? bill.materials : MATERIALS.archetype,
        labourHours: bill?.labourHours || null,
        modules: block?.modules || []
      };
      plan.run = (c) =>
        !!c &&
        town.placeBuilding(c[0], c[1], zoneZ, {
          footprint: plan.footprint && plan.footprint.cols * plan.footprint.rows > 1 ? plan.footprint : undefined,
          overrides,
          facility,
          kind: block?.id === 'office.lobby' ? 'office' : undefined,
          blockId: block?.id || undefined,
          name: opts.name || null
        });
      return plan;
    }
    case 'district': {
      // Phase 18 (A5) — a DISTRICT, not a building. The order expands into an
      // ordered queue of the plan types this file already understands, sized
      // from the town's own gaps. Nothing here is an authored layout: the
      // ORDER of the queue is the order a new district needs its parts in
      // (reach the network, then house, then serve, then make work), and the
      // SIZES come from live pressure.
      const q = districtQueue(town, opts);
      if (!q.length) return null;
      const cost = q.reduce((n, step) => n + (step.cost || 0), 0);
      return {
        type: 'district',
        zone: opts.zone || 'house',
        queue: q,
        steps: q.length,
        label: `A district is laid out — ${q.length} works: ${q.map((s) => s.what).join(', ')}`,
        cost,
        // The commission itself is instant and cheap; the queue is the work.
        run: () => true
      };
    }
    case 'resource': {
      // UPGRADE_RESOURCE: raise one resource's site level. Ranked fires it
      // only while something is strained; an explicit spec (resource=water)
      // orders a specific one, otherwise the hardest-strained goes first.
      // A `kind` pins the yard (kind=husbandry raises the ranch, not the
      // first food site the rotation happens to list) — otherwise the
      // cheapest tier goes first.
      const rs = town.resources;
      if (!rs || !rs.upgradeCost) return null;
      const strained = rs.stats ? rs.stats().strained : [];
      const r = RESOURCE_ORDER.includes(opts.resource) ? opts.resource : strained[0] || RESOURCE_ORDER[0];
      const kind =
        typeof opts.kind === 'string' && rs.kindOfResource?.(opts.kind) === r ? opts.kind : null;
      const cost = rs.upgradeCost(r, kind);
      if (cost <= 0) return null;
      const target = rs.upgradeTarget(r, kind);
      if (!target) return null;
      const tier = rs.nextTierLabel?.(target) || `site level ${(target.level || 1) + 1}`;
      return {
        type: 'resource',
        resource: r,
        kind,
        target,
        // Capacity upgrades are public outcomes, but their capital can come
        // from the developer account so a protected operating runway does not
        // strand a growing town with dry water/food stores.
        financingSector: 'developer',
        allowMaterialImports: true,
        label: kind
          ? `Crews raise the ${SITE_LABEL[kind].toLowerCase()} to ${tier}`
          : `Crews raise one ${r} works to ${tier}`,
        cost,
        materials: MATERIALS.upgrade,
        run: () => rs.upgrade(r, target)
      };
    }
    case 'power':
    case 'water':
    case 'sewage':
      return {
        type: 'utility',
        kind: type,
        // Utilities remain state-owned infrastructure, but their expansion
        // uses the developer capital leg. Otherwise a protected government
        // operating floor makes the first strained network permanently
        // unbuildable and population stalls even while private capital sits
        // idle.
        owner: 'state',
        financingSector: 'developer',
        allowMaterialImports: true,
        label: `Crews extend ${type} capacity and road-network coverage`,
        cost: town.utilities.expansionCost(type),
        materials: MATERIALS.upgrade,
        run: () => town.utilities.expand(type)
      };
    default:
      return null;
  }
}

/**
 * Phase 5 — kit-driven town growth. Reads population pressure, land value,
 * treasury, jobs, congestion and utility headroom, then spends the treasury on
 * one procedural expansion at a time: homes, shops, civic buildings, parks,
 * road extensions and utility mains.
 */
export class GrowthSystem {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(9111);
    this.enabled = true;
    this.auto = false;
    // The private developer runs on its own capital, independently of the
    // council's auto-planner: `auto` is the council's switch, this is the
    // market's. Set false to model a town with no private developers at all.
    this.developer = true;
    this.developerCooldown = 0;
    this.developerBuilt = 0;
    this.history = [];
    this.built = { house: 0, shop: 0, civic: 0, park: 0, road: 0, utility: 0, factory: 0, mall: 0, multiplex: 0 };
    this.metrics = { tierUps: 0, floorUpgrades: 0, wings: 0 };
    this.cooldown = 6;
    // In-flight construction: queued projects, the cells they have claimed
    // (so a second project cannot claim the same lot), and upgrade targets.
    this.projects = [];
    this.projectStates = new Map();
    this.claims = new Set();
    this.pendingTargets = new Set();
    // Glowing blue site markers — one group per active project (ring, vortex,
    // sparks, progress bar), removed on completion/failure. Created lazily so
    // headless/idle runs stay cheap.
    this.siteGroup = null;
    this.siteObjs = new Map();
    this.ringGeo = null;
    this.ringMat = null;
    this.glowT = 0;
    // Why the last apply() refused — surfaced through the council's detail.
    this.lastBlock = '';
    // Road planning evaluates many virtual candidates. Cache a result for the
    // current graph/demand slice so ranked(), quote(), and the council do not
    // repeat the same Dijkstra work within one simulation slice.
    this.roadSelectionCacheKey = null;
    this.roadSelectionCache = null;
  }

  reset() {
    this.history = [];
    this.built = { house: 0, shop: 0, civic: 0, park: 0, road: 0, utility: 0, factory: 0, mall: 0, multiplex: 0, district: 0 };
    this.metrics = { tierUps: 0, floorUpgrades: 0, wings: 0 };
    this.cooldown = 6;
    this.projects = [];
    this.projectStates = new Map();
    this.claims = new Set();
    this.pendingTargets = new Set();
    this.clearSites();
    // Phase 18 — the district the crews are working through, if any.
    this.districtQueue = null;
    this.lastDistrict = null;
    // Phase 15 — written only by PolicySystem; zero here because a new town
    // carries no statutes.
    this.policyCost = 0;
    this.policyHours = 0;
    // Phase 17 — written only by the innovation ladder's `service` lever.
    this.serviceBonus = 0;
    this.roadSelectionCacheKey = null;
    this.roadSelectionCache = null;
  }

  ensureSites() {
    if (this.siteGroup) return;
    this.siteGroup = new THREE.Group();
    this.siteGroup.name = 'construction-sites';
    this.siteGroup.raycast = () => {};
    this.town.root.add(this.siteGroup);
    this.ringGeo = new THREE.RingGeometry(CELL * 0.34, CELL * 0.46, 40);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x45b4ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    });
    this.helixGeo = buildHelixGeo();
    // toneMapped:false on all site materials: the renderer's ACES curve
    // (and its dimmer night exposure) would otherwise swallow the glow.
    this.vortexMat = new THREE.MeshBasicMaterial({
      color: 0x54b3ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0x9fdcff,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.sparkMat = new THREE.PointsMaterial({
      color: 0xd8f4ff,
      size: 0.32,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    this.barBgMat = new THREE.SpriteMaterial({
      map: makeBarTexture('bg'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    });
    this.barFillMat = new THREE.SpriteMaterial({
      map: makeBarTexture('fill'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    });
  }

  /**
   * One construction site: ground ring, three-storey fiery-blue vortex
   * (two counter-rotating spiral ribbons + rising sparks), and a floating
   * progress bar billboarded above the column.
   */
  showSite(x, y) {
    this.ensureSites();
    const key = `${x},${y}`;
    if (this.siteObjs.has(key)) return;
    const p = this.town.grid.cellToWorld(x, y);
    const site = new THREE.Group();
    site.name = `site:${key}`;
    site.raycast = () => {};
    site.position.set(p.x, this.town.grid.heightAtWorld(p.x, p.z), p.z);

    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.renderOrder = 5;
    site.add(ring);

    const vortex = new THREE.Group();
    const hA = new THREE.Mesh(this.helixGeo, this.vortexMat);
    const hB = new THREE.Mesh(this.helixGeo, this.vortexMat);
    hB.rotation.y = Math.PI;
    hA.renderOrder = 6;
    hB.renderOrder = 6;
    // Additive outer shell — the bloom-y glow around the ribbons.
    const halo = new THREE.Mesh(this.helixGeo, this.haloMat);
    halo.scale.set(1.1, 1.03, 1.1);
    halo.renderOrder = 7;
    vortex.add(hA, hB, halo);
    site.add(vortex);

    const sparkGeo = buildSparkGeo();
    const sparks = new THREE.Points(sparkGeo, this.sparkMat);
    sparks.frustumCulled = false;
    sparks.renderOrder = 6;
    site.add(sparks);

    const barY = SITE_H + BAR_GAP;
    const bg = new THREE.Sprite(this.barBgMat);
    bg.scale.set(BAR_W, BAR_H, 1);
    bg.position.y = barY;
    bg.renderOrder = 9;
    const fill = new THREE.Sprite(this.barFillMat);
    fill.center.set(0, 0.5);
    fill.scale.set(0.001, BAR_H * 0.6, 1);
    fill.position.set(-BAR_W / 2, barY, 0.02);
    fill.renderOrder = 10;
    site.add(bg, fill);

    // Deterministic per-site phase offsets — no RNG, so seeded runs and
    // RNG-sensitive probes are untouched.
    const phases = new Float32Array(SPARKS);
    const angles = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) {
      phases[i] = i / SPARKS;
      angles[i] = i * 2.399963;
    }
    site.userData = {
      spin: (((x * 13 + y * 7) % 37) / 37) * Math.PI * 2,
      vortex,
      helixB: hB,
      sparkGeo,
      fill,
      phases,
      angles
    };
    this.siteGroup.add(site);
    this.siteObjs.set(key, site);
  }

  hideSite(x, y) {
    if (x === null || x === undefined || !this.siteObjs) return;
    const key = `${x},${y}`;
    const site = this.siteObjs.get(key);
    if (!site) return;
    site.userData?.sparkGeo?.dispose?.();
    this.siteGroup.remove(site);
    this.siteObjs.delete(key);
  }

  clearSites() {
    if (!this.siteGroup) return;
    for (const site of [...this.siteGroup.children]) {
      site.userData?.sparkGeo?.dispose?.();
      this.siteGroup.remove(site);
    }
    this.siteObjs.clear();
  }

  /** Spin the vortex, lift the sparks, advance the progress bar (one site). */
  animateSite(p, dt) {
    const site = p.site ? this.siteObjs.get(`${p.site[0]},${p.site[1]}`) : null;
    if (!site) return;
    const ud = site.userData;
    ud.spin += dt;
    ud.vortex.rotation.y = ud.spin * 2.1;
    ud.helixB.rotation.y = Math.PI - ud.spin * 3.4;
    const pos = ud.sparkGeo.attributes.position.array;
    for (let i = 0; i < ud.phases.length; i++) {
      const t01 = (ud.phases[i] + ud.spin * 0.5) % 1;
      const a = ud.angles[i] + t01 * 4.2;
      const r = CELL * 0.44 * (1 - 0.55 * t01);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.1 + t01 * SITE_H;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    ud.sparkGeo.attributes.position.needsUpdate = true;
    const total = (p.hours ?? 0) * 60 * SIM.secondsPerGameMinute;
    const prog = total > 0 ? Math.max(0, Math.min(1, 1 - p.remaining / total)) : 1;
    ud.fill.scale.x = Math.max(0.001, BAR_W * prog);
  }

  inputs() {
    const t = this.town;
    const homes = t.buildings.filter((b) => b.kind === 'house');
    const capacity = homes.reduce((s, b) => s + (b.capacity || 2), 0);
    this.officeCount = () => t.buildings.filter((b) => b.kind === 'office').length;
    const pop = t.pedestrians.citizens.length;
    const civicCount = t.buildings.filter((b) => b.kind === 'civic').length;
    const parkCells = t.grid.countOf(CELL_KIND.PARK);
    const shops = t.buildings.filter((b) => b.purpose === 'commercial').length;
    const utilityStats = t.utilities ? t.utilities.stats() : null;
    if (utilityStats?.types) {
      // A network can be below rated capacity while still failing to serve
      // most of its connected demand. Saturation-only reporting hid a zero
      // coverage factor, so factories stopped and the council saw no utility
      // order. Once demand is a meaningful share of the network, coverage
      // below 90% is a real expansion need.
      const coverageStrain = Object.entries(utilityStats.types)
        .filter(([, row]) => row.saturated || (row.coverage < 90 && row.demand > 100))
        .map(([kind]) => kind);
      utilityStats.strained = [...new Set([...(utilityStats.strained || []), ...coverageStrain])];
    }
    return {
      capacity,
      pop,
      homes: homes.length,
      shops,
      civicCount,
      parks: parkCells,
      pressure: capacity ? pop / capacity : 0,
      economy: t.economy ? t.economy.stats() : null,
      mobility: t.traffic ? t.traffic.mobilityStats() : null,
      utilities: utilityStats
    };
  }

  /** Count genuinely usable empty plots inside the land the town already owns. */
  vacantAcquiredPlots(limit = Infinity) {
    const t = this.town;
    const g = t.grid;
    const perimeter = t.perimeter;
    if (!perimeter) return Infinity;
    const comps = t.roadComponents ? t.roadComponents() : roadComponents(g);
    let count = 0;
    for (const parcel of t.parcels?.parcels || []) {
      if (!parcel?.buildable || parcel.type === 'park' || parcel.type === 'public') continue;
      const front = t.parcels.buildableCell(parcel);
      if (!front || !perimeter.isAcquired(front[0], front[1])) continue;
      const [x, y] = front;
      if (!g.inBounds(x, y) || (g.kindAt(x, y) !== CELL_KIND.EMPTY && g.kindAt(x, y) !== CELL_KIND.LOT)) continue;
      if (t.buildingAt(x, y) || t.resources?.ownsCell(x, y) || this.claims.has(`${x},${y}`)) continue;
      if (!hasNetworkAccess(g, x, y, comps)) continue;
      count++;
      if (count >= limit) return count;
    }
    return count;
  }

  /**
   * Choose a contiguous patch for a named progression order. Buying a handful
   * of unrelated frontage cells is enough for houses, but it can never unlock
   * a 3x3 works or a 3x2 college. The patch is anchored on the current
   * frontier, contains only empty ground, and is quoted by the normal land
   * project so the council still records a visible ACQUIRE_LAND decision.
   */
  landAcquisitionCells(targetPlan) {
    const perimeter = this.town.perimeter;
    const g = this.town.grid;
    if (!perimeter || !targetPlan) return null;
    const entries = targetPlan.footprintCandidates || (targetPlan.footprint ? [targetPlan.footprint] : []);
    if (!entries.length) return null;
    const dims = entries.map((entry) => Array.isArray(entry)
      ? { cols: entry[0], rows: entry[1] }
      : { cols: entry.cols, rows: entry.rows })
      .filter((entry) => entry.cols > 0 && entry.rows > 0)
      .sort((a, b) => a.cols * a.rows - b.cols * b.rows)[0];
    if (!dims) return null;
    const industrial = targetPlan.type === 'factory' ? this.industryProfile(g) : null;
    const frontier = perimeter.frontierCells(240);
    const blocked = (x, y) => !g.inBounds(x, y) ||
      (g.kindAt(x, y) !== CELL_KIND.EMPTY && g.kindAt(x, y) !== CELL_KIND.LOT) ||
      g.isWater(x, y) || this.town.buildingAt(x, y) || this.town.resources?.ownsCell(x, y);
    for (const [fx, fy] of frontier) {
      for (let oy = 0; oy < dims.rows; oy++) {
        for (let ox = 0; ox < dims.cols; ox++) {
          const x0 = fx - ox;
          const y0 = fy - oy;
          if (industrial && !this.industryEligible(industrial,
            x0 + (dims.cols - 1) / 2, y0 + (dims.rows - 1) / 2)) continue;
          const cells = [];
          let ok = true;
          for (let y = y0; y < y0 + dims.rows && ok; y++) {
            for (let x = x0; x < x0 + dims.cols; x++) {
              if (blocked(x, y)) { ok = false; break; }
              cells.push([x, y]);
            }
          }
          if (ok && cells.length === dims.cols * dims.rows) {
            // Verify the actual construction survey against the temporary
            // purchase. This catches blocks that are empty but landlocked or
            // split across parcels with no legal frontage.
            const original = perimeter.acquired;
            const projected = new Set(original);
            for (const [x, y] of cells) projected.add(perimeter.key(x, y));
            perimeter.acquired = projected;
            const site = this.siteForFootprint(targetPlan);
            perimeter.acquired = original;
            if (site) return cells;
          }
        }
      }
    }
    return null;
  }

  /** Land is acquired as a response to a local shortage, not as decoration. */
  landNeeded() {
    const perimeter = this.town.perimeter;
    if (!perimeter?.frontierCells(1).length) return false;
    const s = this.inputs();
    const housingPressure = (s.pressure || 0) >= 0.9;
    const strainedProduct = this.town.industry?.missingConstructionProduct?.();
    const firstWorksDeficit = !this.town.industry?.factories?.().length && this.town.industry?.deficitProduct?.();
    const civicDemand = s.pop > s.civicCount * CIVIC_PER_POP || !!civicExpansionNeed(this.town) ||
      (!!this.town.resources?.stats?.().waste && !this.town.buildings.some((b) => b.facility === 'recycling'));
    // A few empty one-cell plots do not satisfy a campus or works order. Keep
    // acquiring a contiguous frontier until a progression footprint can
    // actually be placed, otherwise the council can spend the whole horizon
    // upgrading the core while colleges and factories remain impossible to
    // site. The request is still explicit ACQUIRE_LAND; this is only the
    // feasibility gate that decides when that request is needed.
    const hasSitedFootprint = (type, opts) => {
      const plan = planFor(this.town, type, opts);
      return !!plan && !!this.siteForFootprint(plan);
    };
    const educationNeed = (s.pop >= 45 && !this.town.buildings.some((b) => b.facility === 'college' || b.facility === 'university') &&
      !hasSitedFootprint('civic', { facility: 'college' })) ||
      (s.pop >= 150 && this.town.buildings.some((b) => b.facility === 'college') &&
        !this.town.buildings.some((b) => b.facility === 'university' || b.subtype === 'campus') &&
        !hasSitedFootprint('civic', { facility: 'university' }));
    const worksNeed = s.pop >= 80 && !this.town.buildings.some((b) => b.purpose === 'industrial') &&
      this.factoryRoom() && !hasSitedFootprint('factory');
    const vacant = this.vacantAcquiredPlots(2);
    return vacant < 2 && (housingPressure || !!strainedProduct || !!firstWorksDeficit || civicDemand || educationNeed || worksNeed) ||
      (educationNeed || worksNeed);
  }

  /**
   * Whether the town may commission another works: at most one per three
   * citizens, floor two. Without this the deficit gate loops forever — each
   * new works adds water/energy demand (resourceKit demandOf: industry ×6
   * water, ×20 energy) the seeded sites cannot cover (Day-81: 26 works for
   * 32 people, water store dry, mood Restless, deaths outpacing births).
   */
  factoryRoom() {
    const works = this.town.buildings.filter((b) => b.purpose === 'industrial').length;
    const pop = this.town.pedestrians.citizens.length;
    return works < Math.max(2, Math.ceil(pop / 3));
  }

  /**
   * A private developer, deciding on its own capital whether to put up a shop.
   *
   * Before this, every private building in the town was commissioned by the
   * council's own planner and paid for out of one anonymous `developer` pot
   * that never had an opinion, never ran out of appetite, and could not fail.
   * A developer here is a counterparty: it keeps a reserve back, it wants
   * unmet demand (residents per unlet customer seat) before it commits, and it
   * simply does nothing when the books do not support a build. The council may
   * still order a shop — that is a *public* backstop for a town with no
   * private capital, not the normal route.
   */
  developerPlan() {
    const eco = this.town.economy;
    if (!eco) return null;
    const cash = eco.accounts?.developer?.cash ?? 0;
    if (cash < ECON_DEVELOPER_RESERVE) return null;
    const s = this.inputs();
    const retail = this.town.buildings.filter((b) => b.purpose === 'commercial' && b.kind !== 'office');
    const seats = retail.reduce((n, b) => n + (b.capacity || 0), 0);
    const demand = s.pop - seats;
    // Any shortfall is demand: more people than customer seats. The seat ratio
    // only sizes the build (a bigger lot for a bigger gap), it does not gate.
    if (demand < 1) return null;
    // Profitable, staffed trade is the developer's brief: it will not open a
    // shop in a town that cannot staff the one it already has.
    if (eco.unemployment > 0.25) return null;
    const plan = planFor(this.town, 'shop', { need: Math.min(1, demand / ECON_DEVELOPER_PER_SEAT) });
    if (!plan) return null;
    plan.owner = 'private';
    plan.commissionedBy = 'developer';
    return plan;
  }

  /** The developer's own pass — private work, driven by private capital. */
  developerPass() {
    if (!this.developer) return null;
    if (this.projects.length >= MAX_ACTIVE) return null;
    if (this.developerCooldown > 0) return null;
    const plan = this.developerPlan();
    if (!plan) return null;
    const result = this.apply(plan);
    if (!result) return null;
    this.developerCooldown = 2;
    this.developerBuilt = (this.developerBuilt || 0) + 1;
    events.emit('log', { text: `A private developer commissions ${plan.label.toLowerCase()}.` });
    events.emit('council', {
      source: 'developer',
      actor: 'Developer',
      action: `BUILD_${String(plan.type || 'project').toUpperCase()}`,
      status: 'started',
      detail: `private capital — ${plan.label} to meet demand`,
      cost: plan.cost || 0
    });
    return result;
  }

  update(dt) {
    if (!this.enabled || dt <= 0) return;
    // Projects advance on sim time whether or not auto-growth is on — council
    // construction keeps building while the town stands still.
    this.tickProjects(dt);
    // `walkDistrictQueue` has no dt of its own, so the district's patience is
    // told what game time has passed. See the note there.
    this.lastDistrictDt = dt;
    this.walkDistrictQueue();
    if (this.developer) {
      this.developerCooldown = Math.max(0, (this.developerCooldown || 0) - dt);
      this.developerPass();
    }
    if (!this.auto) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 30 + this.rng.float(0, 30);
    const plan = this.evaluate();
    if (plan) this.apply(plan);
  }

  /**
   * Phase 18 (A5) — the crew half of a district. A district is commissioned as
   * ONE order; the work is a QUEUE that the crews walk, taking the next step
   * whenever a slot frees. Steps are plain `planFor` calls, so a district
   * builds with exactly the same machinery as a one-off order — nothing here
   * knows what a house is.
   *
   * A step that cannot be sited (no land, no materials, no cash) is not lost:
   * it is retried on the next pass, and a step that has failed many times in a
   * row is dropped so one impossible step cannot stall the whole district.
   */
  walkDistrictQueue() {
    const queue = this.districtQueue;
    if (!queue || !queue.steps.length) return null;
    if (this.projects.length >= MAX_ACTIVE) return null;
    // `districtQueue` is walked once per RENDER FRAME (this method takes no dt),
    // and the queue is advanced from `update`, which the loop calls with `simDt`.
    // Patience is therefore accumulated in GAME time, not frames. It used to be a
    // bare `tries` counter, so a step that failed for any non-instantaneous
    // reason — treasury short, lumber short, crew contention — was retried 12
    // times and dropped inside ~0.2 s of real time and ~2 sim-seconds. A
    // `BUILD_DISTRICT` that ran the treasury down mid-queue silently discarded the
    // rest of its own housing plan and reported "K dropped", with the town never
    // having had a chance to free up. Measured: dropped at frame 11, 2.0
    // sim-seconds elapsed.
    queue.ageSeconds = (queue.ageSeconds || 0) + (this.lastDistrictDt || 0);
    const step = queue.steps[0];
    const plan = planFor(this.town, step.kind, { ...step, need: step.need });
    if (!plan) {
      this.failStep(queue, step, 'no site');
      return null;
    }
    // The step's own access road is part of its price, not a free extra.
    plan.districtQueue = queue;
    const r = this.apply(plan);
    if (!r) {
      this.failStep(queue, step, this.lastBlock || 'no site');
      return null;
    }
    step.tries = 0;
    queue.steps.shift();
    if (r.status === 'started') queue.pending = (queue.pending || 0) + 1;
    else {
      queue.built = (queue.built || 0) + 1;
      queue.actualSpend = (queue.actualSpend || 0) + (plan.cost || 0);
    }
    const text = `District step complete: ${plan.label}`;
    this.history.push(text);
    if (this.history.length > 8) this.history.shift();
    events.emit('log', { text });
    this.retireQueue(queue);
    return r;
  }

  /**
   * A step that could not be placed. It is retried — the town may free up — but
   * not for ever: past `DISTRICT_STEP_PATIENCE_SECONDS` of GAME time it is
   * dropped, so one impossible step cannot stall the rest of the district.
   *
   * The measure is game seconds, not attempts. The queue is walked once per
   * render frame, so counting tries meant patience was consumed by the frame rate
   * rather than by the town: at 60 fps and 10x sim speed a step had ~0.2 s of real
   * time and ~2 sim-seconds to get itself placed, and a district whose treasury
   * ran out mid-queue simply dropped the rest of its own housing plan.
   */
  failStep(queue, step, why) {
    step.tries = (step.tries || 0) + 1;
    if (queue.ageSeconds < DISTRICT_STEP_PATIENCE_SECONDS) return;
    queue.steps.shift();
    // The clock restarts for the next step, so patience is per-step and not spent
    // by whichever step happened to fail first.
    queue.ageSeconds = 0;
    queue.dropped = (queue.dropped || 0) + 1;
    (queue.droppedSteps ||= []).push({ kind: step.kind, reason: why, quantity: 1 });
    events.emit('log', { kind: 'event', text: `A district step is dropped after ${DISTRICT_STEP_PATIENCE_SECONDS}s without a site — ${step.what}: ${why}.` });
    this.retireQueue(queue);
  }

  /**
   * The last step empties the queue, so the town stops reporting a district in
   * progress — otherwise a finished district would sit on the report for ever,
   * telling the council there was work still queued.
   */
  retireQueue(queue) {
    if (!queue.steps.length && !(queue.pending || 0)) {
      this.lastDistrict = { ...queue, steps: [], status: queue.dropped ? 'partial' : 'complete' };
      this.districtQueue = null;
    }
  }

  /** Advance queued construction; complete or stall each finished project. */
  tickProjects(dt) {
    if (!this.projects.length) return;
    // Pulse the glowing site markers while anything is under construction.
    if (this.ringMat) {
      this.glowT += dt;
      const wave = Math.sin(this.glowT * 4.4);
      this.ringMat.opacity = 0.58 + 0.3 * wave;
      if (this.vortexMat) this.vortexMat.opacity = 0.85 + 0.15 * wave;
      if (this.haloMat) this.haloMat.opacity = 0.24 + 0.16 * wave;
      if (this.sparkMat) this.sparkMat.opacity = 0.85 + 0.15 * wave;
      if (this.barFillMat) this.barFillMat.opacity = 0.9 + 0.1 * wave;
    }
    const finished = [];
    for (const p of this.projects) {
      p.remaining -= dt;
      if (p.remaining <= 0) finished.push(p);
    }
    for (const p of this.projects) {
      if (!finished.includes(p)) this.animateSite(p, dt);
    }
    for (const p of finished) {
      this.projects.splice(this.projects.indexOf(p), 1);
      for (const [cx, cy] of [...(p.plan.cells || (p.cell ? [p.cell] : [])), ...(p.plan.accessSpur || [])]) {
        this.claims.delete(`${cx},${cy}`);
      }
      if (p.target) this.pendingTargets.delete(p.target);
      if (p.site) this.hideSite(p.site[0], p.site[1]);
      const worldBeforeRun = snapshotProjectWorld(this.town);
      let ok = false;
      try {
        ok = !!p.plan.run(p.cell, p.target, p.plan);
      } catch (error) {
        // The two sibling executor sites (apply's own paths) both record WHY the
        // executor threw. This one swallowed it, so a construction failure was
        // rolled back and reported to the player and the council as "Construction
        // halted" with no record of the cause — the one place a real bug in a
        // builder could have been diagnosed from.
        ok = false;
        this.lastBlock = error?.message || 'project_execution_failed';
      }
      const place = p.cell ? ` at ${p.cell[0]}, ${p.cell[1]}` : '';
      if (ok) {
        this.trackProject(p.plan, 'COMPLETED');
        if (p.plan.type === 'tierup') this.metrics.tierUps++;
        if (p.plan.type === 'upgrade') this.metrics.floorUpgrades++;
        if (p.plan.type === 'wing') this.metrics.wings++;
        if (p.plan.districtQueue) {
          const q = p.plan.districtQueue;
          q.pending = Math.max(0, (q.pending || 0) - 1);
          q.built = (q.built || 0) + 1;
          q.actualSpend = (q.actualSpend || 0) + (p.plan.cost || 0);
          this.retireQueue(q);
        }
        const text = `Construction complete: ${p.plan.label}${place}.`;
        this.history.push(text);
        if (this.history.length > 8) this.history.shift();
        events.emit('log', { text });
      } else {
        restoreProjectWorld(this.town, worldBeforeRun);
        this.trackProject(p.plan, 'FAILED_ROLLED_BACK', 'executor_failed');
        if (p.plan.districtQueue) {
          const q = p.plan.districtQueue;
          q.pending = Math.max(0, (q.pending || 0) - 1);
          q.dropped = (q.dropped || 0) + 1;
          (q.droppedSteps ||= []).push({ kind: p.plan.type, reason: 'construction_failed', quantity: 1 });
          this.retireQueue(q);
        }
        this.rollbackSpur(p.plan);
        // The site changed under us (player built/demolished) — undo the
        // reservation and hand the money back.
        if (p.plan.cost && p.plan.charge !== false && this.town.economy) {
          this.town.economy.refundProject(p.plan);
        }
        this.town.governance?.projectRolledBack?.(p.plan.projectId);
        if (p.plan.materials && this.town.industry) this.town.industry.refund(p.plan.materials);
        this.built[p.plan.type] = Math.max(0, (this.built[p.plan.type] ?? 0) - 1);
        // The claim is gone: re-render so planned parking can claim the cell.
        if (p.cell) this.town.rebuildStatic();
        events.emit('log', { kind: 'event', text: `Construction halted: ${p.plan.label}.` });
      }
    }
  }

  /**
   * Every build the town currently WANTS, strongest need first — but never
   * feasibility: want is a signal. Site and budget checks happen in
   * evaluate()/planBoard() so blocked work can be reported, not silently swapped.
   */
  ranked() {
    const s = this.inputs();
    const eco = s.economy;
    if (!eco) return [];
    // `eco` is stats() — a PERCENT. The jobs gates read the fraction instead,
    // so the planner and the warning thresholds in EconomySystem compare like
    // with like.
    const unemployment = unemploymentRate(this.town);
    const out = [];
    const add = (type, need, opts, amenity = false) => {
      if (need > 0) {
        // Near full occupancy, housing must be able to beat a persistent
        // resource strain once. Without this tie-break, a dry storehouse can
        // keep the council in a resource loop while the population has no
        // spare beds and therefore no path to grow.
        const band = type === 'house' && s.pressure >= HOUSING_BOOTSTRAP_PRESSURE
          ? 12
          : (BAND[type] ?? (LANDMARKS[type] ? LANDMARKS[type].band : 1));
        const earnedProgression = s.pop >= 60 && (type === 'upgrade' || type === 'wing' || type === 'tierup');
        // Once the first town cohort is established, the next population
        // height rung is a capacity deadline.  Give that specific upgrade a
        // stronger tie-break than commerce polish so a long run cannot spend
        // every sitting on shop tiers while all buildings remain low-rise.
        const heightPriority = type === 'upgrade' && s.pop >= 60 && !!this.progressionTarget();
        const roadEmergency = (type === 'road' || type === 'roadup') && (s.mobility?.congestion || 0) >= ROAD_EMERGENCY_GATE;
        out.push({
          type,
          need,
          // Once the first town cohort exists, earned progression competes
          // with ordinary civic infill. This keeps long runs from repeatedly
          // selecting new one-storey shells while floors/wings wait forever.
          score: band + Math.min(1, need) + (earnedProgression ? 4 : 0) + (heightPriority ? 6 : 0) + (roadEmergency ? 20 : 0),
          opts,
          amenity
        });
      }
    };

    const strained = (s.utilities && s.utilities.strained) || [];
    for (const kind of strained) {
      if (this.town.utilities && this.town.utilities.networks[kind]) add(kind, 1);
    }
    // Primary resources: stores dry or output trailing demand — raise a site
    // level (the ranked twin of the report's "Primary resources" line, so the
    // council sees the need in Feasible now instead of answering NO_ACTION).
    const rs = this.town.resources && this.town.resources.stats
      ? this.town.resources.stats()
      : null;
    if (rs && rs.strained && rs.strained.length) add('resource', 1, { resource: rs.strained[0] });
    if (housingNeedsBuild(s.pop, s.capacity, s.pressure) && this.findCell('house'))
      add('house', (s.pressure - HOUSE_PRESSURE_GATE) / (1 - HOUSE_PRESSURE_GATE));
    if (unemployment > UNEMPLOYMENT_GATE) {
      const need = (unemployment - UNEMPLOYMENT_GATE) / (1 - UNEMPLOYMENT_GATE);
      if (this.findCell('shop')) add('shop', need, { need }); // need rides the commerce-ladder chooser
      // Phase 20 — an office block is DEMAND work on the same gate, ranked
      // BELOW the shop so a town that needs trade gets trade first, and scored
      // down as its office count catches up with its population.
      //
      // The offer must be the SAME test as `wanted('office')`. It used to be
      // looser on two counts — no `OFFICE_MIN_POP` floor, and a cap written
      // `OFFICE_PER_POP * s.pop` (one office per 90 CITIZENS squared) that
      // never closed — so the board offered a block the council would then
      // bounce as "the town does not need this right now", over and over.
      if (
        this.officeCount &&
        s.pop >= OFFICE_MIN_POP &&
        this.officeCount() < s.pop / OFFICE_PER_POP &&
        this.findCell('office')
      ) {
        add('office', need * 0.8, { need: Math.min(0.8, need) });
      }
    }
    const civicOverload = civicExpansionNeed(this.town);
    const genericCivicNeed = s.pop > s.civicCount * CIVIC_PER_POP;
    if ((genericCivicNeed || civicOverload) && this.findCell('civic')) {
      const countNeed = s.pop / Math.max(1, s.civicCount * CIVIC_PER_POP) - 1;
      const loadNeed = civicOverload ? Math.min(1, civicOverload.load - 1) : 0;
      add('civic', Math.max(countNeed, loadNeed), civicOverload
        ? { facility: CIVIC_FACILITY_FOR_KIND[civicOverload.kind] }
        : undefined);
    }
    // Higher education is a progression gate, so it is demand work rather
    // than an ornamental landmark. A college opens once a town has enough
    // adults to fill a cohort; the university landmark remains the metropolis
    // milestone at pop 300.
    const tertiary = this.town.buildings.filter((b) => b.capacityKind === 'tertiary');
    const hasCollege = tertiary.some((b) => b.facility === 'college');
    const hasUniversity = tertiary.some((b) => b.facility === 'university' || b.subtype === 'campus');
    const waste = rs?.waste;
    const hasRecycling = this.town.buildings.some((b) => b.facility === 'recycling');
    if (waste && !hasRecycling && waste.landfill > Math.max(60, waste.generated * 0.35) && this.findCell('civic')) {
      const need = Math.min(1, waste.landfill / Math.max(1, waste.generated));
      // Recycling is a civic progression rung, financed through the same
      // public-outcome/private-capital leg as tertiary education so the
      // operating reserve does not prevent waste capacity from arriving.
      out.push({ type: 'civic', need, score: 13 + need, opts: { facility: 'recycling' }, amenity: false });
    }
    if (s.pop >= 45 && !hasCollege && !hasUniversity && this.findCell('civic')) {
      const need = Math.min(1, (s.pop - 44) / 80);
      // Tertiary education is a deliberate growth gate.  Keep it above the
      // height/commerce polish rows so a town can actually unlock the next
      // labour and research cohort instead of endlessly repeating upgrades.
      out.push({ type: 'civic', need, score: 16 + need, opts: { facility: 'college' }, amenity: false });
    } else if (s.pop >= 150 && hasCollege && !hasUniversity && this.findCell('civic')) {
      // University is a second civic rung, rather than an unreachable
      // landmark-only feature.  A town can establish an affordable university
      // facility before it can afford the later multi-plot campus milestone.
      const need = Math.min(1, (s.pop - 149) / 180);
      out.push({ type: 'civic', need, score: 16 + need, opts: { facility: 'university' }, amenity: false });
    }
    // A first works campus is an economic progression rung once the settlement
    // has enough people to staff it.  The explicit default keeps this path
    // alive even while the initial stockpile is still above a shortage gate;
    // the quote still enforces the real lot, cash, utility and material rules.
    const industrialCount = this.town.buildings.filter((b) => b.purpose === 'industrial').length;
    if (s.pop >= 80 && industrialCount === 0 && this.factoryRoom() && this.findCell('factory')) {
      const starter = this.town.industry?.missingConstructionProduct?.() ||
        this.town.industry?.deficitProduct?.() || this.town.industry?.strainedProduct?.() || 'lumber';
      const def = FACTORY_TYPES.find((f) => f.product === starter) || FACTORY_TYPES[0];
      out.push({ type: 'factory', need: 1, score: 15, opts: { factory: def.id }, amenity: false });
    }
    // Park is AMENITY work: a real need, but never the fallback answer — a
    // settled town holds rather than inventing turf (see isAmenity).
    if (s.parks < s.pop * PARKS_PER_POP && this.findCell('park'))
      add('park', (s.pop * PARKS_PER_POP - s.parks) / Math.max(1, s.pop * PARKS_PER_POP), undefined, true);
    if (s.mobility && s.mobility.congestion > CONGESTION_GATE) {
      // Congestion alone is not a site plan. A street is ranked only when the
      // road planner has a measured trip benefit or a disconnected component
      // to repair; otherwise the council must study or wait for evidence.
      const roadPlan = this.selectRoadExtension();
      if (roadPlan) add('road', (s.mobility.congestion - CONGESTION_GATE) / 0.3);
      // Phase 7 — widening an existing corridor answers the same congestion.
      // Listed after road so equal scores keep the extension first; when the
      // town has no room left to extend, this is what Feasible now offers.
      if (this.roadUpgradeTarget()) add('roadup', (s.mobility.congestion - CONGESTION_GATE) / 0.3);
    }
    // Phase 9 — a bridge is street-band DEMAND, but only the kind that would
    // RECONNECT two road ends the water keeps apart: a redundant crossing of
    // an already-linked bank is cosmetic, never invented by the planner.
    {
      const gap = this.bridgeTarget();
      if (gap && gap.joins) add('bridge', gap.cells.length / MAX_BRIDGE_GAP);
    }
    // Materials run short: commission the works that produces the weakest
    // commodity — but only while the works count stays proportional to the
    // population (Day-81: 26 works for 32 citizens tripled primary-resource
    // demand and ran the town dry — see factoryRoom()). Phase 12: the weakest
    // row is sought across EVERY commodity, ties → most understocked.
    if (this.town.industry && this.factoryRoom()) {
      const starter = this.town.industry.missingConstructionProduct?.();
      const strained = starter || (this.town.industry.factories().length === 0
        ? this.town.industry.deficitProduct?.() || this.town.industry.strainedProduct()
        : null);
      const def = strained && FACTORY_TYPES.find((f) => f.product === strained);
      if (def) add('factory', 0.9, { factory: def.id });
    }
    // Landmark builds (LANDMARKS catalogue): every large block-acquire the
    // town currently wants, each firing at most once — see hasBuilding().
    // `need` rides into planFor so the lot-size chooser scales the build to it.
    for (const lm of Object.values(LANDMARKS)) {
      if (this.landmarkWanted(lm, s, eco)) {
        const need = Math.min(1, (eco.treasury - lm.treasury) / lm.treasury);
        add(lm.id, need, { need });
      }
    }
    // Filler work: only for a comfortable town with spare housing AND free
    // crews — a town mid-build or with tight beds gets neither a floor nor a
    // new design, no matter how fat the treasury is.
    const crewsFree = this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
    const filler = s.pressure > FILLER_PRESSURE_GATE && crewsFree;
    // Frontier acquisition and in-place renewal are discretionary projects:
    // expose them in Feasible now so a Council can choose them deliberately,
    // while keeping them out of the demand fallback that drives essentials.
    if (crewsFree && this.landNeeded()) add('land', 0.42, undefined, false);
    if (crewsFree && this.town.buildings.some((b) => b.house && b.facility !== 'townhall' && (b.kind === 'civic' ? civicHasVerticalHeadroom(b) : b.floors < MAX_FLOORS))) {
      add('restructure', 0.16, undefined, true);
    }
    // A facility over its designed load gets horizontal capacity before a
    // floor when its own parcel has room. Real schools, colleges, and clinics
    // often add classrooms or wards sideways; the vertical upgrade remains the
    // fallback when no same-parcel strip is available.
    const overload = crewsFree ? worstCivicLoad(this.town) : 0;
    const civicWing = overload > CIVIC_LOAD_GATE ? this.wingTarget({ civicOnly: true }) : null;
    const civicWingPlan = civicWing ? planFor(this.town, 'wing', { civicOnly: true }) : null;
    if (civicWingPlan) add('wing', Math.min(1, overload), { civicOnly: true });
    // A wing answers the immediate service-load problem, while the separate
    // upgrade row keeps population-earned height moving.  Previously the wing
    // branch suppressed the floor row entirely, so a valid wing candidate
    // could starve vertical progression for hundreds of days.
    if (overload > CIVIC_LOAD_GATE && this.civicUpgradeTarget()) add('upgrade', Math.min(1, overload));
    else if (this.progressionTarget()) {
      // Height is earned by population, so it remains offered even when beds
      // are comfortable. This is what turns a long run into visible tier-ups
      // instead of a flat carpet of one-storey shells.
      const rung = desiredFloorsForPopulation(s.pop);
      // Population-earned floors are core capacity/progression, so the
      // amenities:false horizon mode must still consider them. Only voluntary
      // polish (renovation, decorative archetypes, parks) is skipped there.
      add('upgrade', Math.min(1, Math.max(0.25, (rung - 2) / 10)));
    } else if (filler) add('upgrade', 0.5, undefined, true);
    if (filler && this.rng.next() < 0.6) {
      add('archetype', 0.4, { zone: s.pressure > 0.75 ? 'house' : 'shop', need: 0.4 }, true);
    }
    // In-place quality work (Phase 5): renovate the plainest building and
    // lift a shop one commerce rung. Amenity while jobs are fine — polish,
    // never the fallback answer; above the unemployment gate a tierup is real
    // demand, because it grows retail capacity without taking a new lot.
    if (crewsFree && this.renovateTarget()) add('renovate', 0.4, undefined, true);
    if (crewsFree && this.tierupTarget()) {
      if (unemployment > UNEMPLOYMENT_GATE) {
        add('tierup', Math.min(1, (unemployment - UNEMPLOYMENT_GATE) / (1 - UNEMPLOYMENT_GATE)));
      } else {
        // Commerce tier-ups are earned capacity progression once the town has
        // its first cohort; keep them available to the fast deterministic
        // horizon as well as the live council. Tiny hamlets still treat the
        // same polish as optional.
        add('tierup', 0.35, undefined, s.pop < 60);
      }
    }
    // Footprint growth (Phase 6): grow a building into its own parcel, never
    // a new lot — amenity like renovate, so a settled town still reads
    // "none outstanding". A built landmark with annex room offers its own
    // expansion row (opts.landmark → planCode EXPAND_LANDMARK type=…).
    const horizontalProgression = crewsFree && s.pop >= 90 ? this.wingTarget() : null;
    if (horizontalProgression) {
      // Once a town has a real resident base, a same-parcel wing is capacity
      // progression rather than optional landscaping. Fast horizon checks and
      // provider councils should both be able to choose it.
      add('wing', 0.35);
    } else if (crewsFree && this.wingTarget()) add('wing', 0.35, undefined, true);
    // Phase 8 — surface works. A square is AMENITY and only offered while the
    // town has none; a bay is street-band DEMAND above its own pressure gate,
    // listed after road so an equal score still widens the network first.
    // Zone brushes remain unranked council discretion. Perimeter acquisition
    // and renewal are exposed separately as low-priority rows so the Council
    // can see those mechanisms without making them the fallback.
    if (crewsFree && !this.hasPlaza()) add('plaza', 0.3, undefined, true);
    // Footways are an explicit pedestrian-access order. They do not belong in
    // the filler queue: a path is useful only when a named inland parcel is
    // actually being opened, and an automatic path otherwise becomes a stray
    // pale strip that never carries vehicles. Keep EXTEND_FOOTWAY available to
    // the council/player through planFor(), but never invent one as growth
    // decoration.
    if (s.mobility && (s.mobility.parkingPressure || 0) > 1 && this.findCell('parking')) {
      add('parking', Math.min(1, (s.mobility.parkingPressure - 1) / 0.5));
    }
    if (crewsFree) {
      for (const lm of Object.values(LANDMARKS)) {
        if (this.hasBuilding(lm.id) && planFor(this.town, 'wing', { landmark: lm.id })) {
          add('wing', 0.5, { landmark: lm.id }, true);
        }
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * Deterministic need test for a single build type — ranked()'s gates
   * without the rng rolls. The council may only order what passes here
   * (props are always allowed: they cost pocket change and cap nothing).
   */
  wanted(type) {
    if (type === 'prop-tree' || type === 'prop-lamp') return true;
    const s = this.inputs();
    const eco = s.economy;
    if (!eco) return false;
    const unemployment = unemploymentRate(this.town);
    const strained = (s.utilities && s.utilities.strained) || [];
    switch (type) {
      case 'power':
      case 'water':
      case 'sewage':
        return strained.includes(type);
      case 'house':
        return housingNeedsBuild(s.pop, s.capacity, s.pressure) && !!this.findCell('house');
      case 'shop':
        return unemployment > UNEMPLOYMENT_GATE && !!this.findCell('shop');
      case 'office':
        // Phase 20 — wanted on the same unemployment gate a shop is, but only
        // while the town has no office to put the white-collar trades in, and
        // only while it is big enough to need one (a hamlet's accountant is its
        // shopkeeper).
        //
        // The size floor used to sit in the `else` of a `this.officeCount ?`
        // test, and `officeCount` always exists — so `OFFICE_MIN_POP` was
        // unreachable and a 39-person hamlet wanted an office block. It is a
        // conjunction now, not an alternative.
        return (
          s.pop >= OFFICE_MIN_POP &&
          unemployment > UNEMPLOYMENT_GATE &&
          this.officeCount() < s.pop / OFFICE_PER_POP &&
          !!this.findCell('office')
        );
      case 'district':
        // Phase 18 — a district is a big, expensive answer: the council only
        // reaches for one when housing pressure is real and there is a crew to
        // walk its queue, and never when a district is already in progress.
        return (
          s.pressure > HOUSE_PRESSURE_GATE &&
          !this.districtQueue &&
          this.projects.length < MAX_ACTIVE &&
          eco.treasury >= DISTRICT_FLOOR
        );
      case 'civic': {
        const need = s.pop > s.civicCount * CIVIC_PER_POP ||
          !!civicExpansionNeed(this.town) ||
          (!!this.town.resources?.stats?.().waste && !this.town.buildings.some((b) => b.facility === 'recycling') && this.town.resources.stats().waste.landfill > Math.max(60, this.town.resources.stats().waste.generated * 0.35)) ||
          (s.pop >= 45 && !this.town.buildings.some((b) => b.facility === 'college' || b.facility === 'university')) ||
          (s.pop >= 150 && this.town.buildings.some((b) => b.facility === 'college') &&
            !this.town.buildings.some((b) => b.facility === 'university' || b.subtype === 'campus'));
        return need && !!this.findCell('civic');
      }
      case 'park':
        return s.parks < s.pop * PARKS_PER_POP && !!this.findCell('park');
      case 'plaza':
        // Always orderable, like a prop: the council may want a second square.
        // ranked() only OFFERS one while the town has none (see hasPlaza()).
        return true;
      case 'parking':
        return !!(s.mobility && (s.mobility.parkingPressure || 0) > 1);
      case 'rezone':
      case 'upzone':
      case 'clear':
      case 'annex':
        // Land use is council discretion: always orderable, never invented.
        return true;
      case 'land':
        return this.landNeeded() && this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
      case 'restructure':
        return this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR && !!this.town.buildings.some((b) => b.house && b.facility !== 'townhall' && (b.kind === 'civic' ? civicHasVerticalHeadroom(b) : b.floors < MAX_FLOORS));
      case 'road':
        return !!(s.mobility && s.mobility.congestion > CONGESTION_GATE && this.selectRoadExtension());
      case 'bridge':
        // Orderable whenever a bank-to-bank gap of up to MAX_BRIDGE_GAP
        // exists — ranked() only OFFERS one when it would reconnect the road
        // ends (see bridgeTarget().joins).
        return !!this.bridgeTarget();
      case 'roadup':
        // Same gate as the extension — widening is congestion work, not polish —
        // and there has to be a run of straight corridor left to raise.
        return !!(
          s.mobility &&
          s.mobility.congestion > CONGESTION_GATE &&
          this.roadUpgradeTarget()
        );
      case 'footway':
        // Wanted only for a real private/civic inland parcel. The cheap probe
        // is intentional: report()/planBoard() may ask this on every sitting;
        // the exact shortest-route check happens once, when an explicit order
        // actually chooses its cell.
        return !!this.footwayTarget({ verifyRoute: false });
      case 'factory': {
        // Wanted while room exists AND some commodity is actually strained —
        // a healthy storehouse never invents a works (Phase 12: any row).
        const starter = this.town.industry?.missingConstructionProduct?.();
        const strained = this.town.industry && (starter || (this.town.industry.factories().length === 0
          ? this.town.industry.deficitProduct?.() || this.town.industry.strainedProduct()
          : null));
        return this.factoryRoom() && !!strained && !!this.findCell('factory');
      }
      case 'resource': {
        const rs = this.town.resources;
        if (!rs || !rs.stats) return false;
        // Wanted while any primary resource is strained AND still upgradeable.
        return rs
          .stats()
          .strained.some((k) => rs.upgradeCost(k) > 0);
      }
      case 'upgrade': {
        // Either filler timing (comfortable town, spare crews) or a facility
        // running over its designed load — the need gate, not the housing one.
        const crews = this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
        if (!crews) return false;
        return !!this.progressionTarget() || !!this.civicUpgradeTarget() || s.pressure > FILLER_PRESSURE_GATE;
      }
      case 'renovate': {
        // Quality work: wanted whenever a spare crew and savings exist and
        // some building still sits below the top budget rung.
        const crews = this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
        return crews && !!this.renovateTarget();
      }
      case 'tierup': {
        // A shop can still climb the commerce ladder (capacity rung).
        const crews = this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
        return crews && !!this.tierupTarget();
      }
      case 'wing': {
        // Footprint growth on a building that already exists: a spare crew,
        // savings above the floor, and either a plain wing site or a built
        // landmark with room to annex (EXPAND_LANDMARK shares this gate).
        const crews = this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
        return crews && (!!this.wingTarget() || !!this.landmarkWingTarget());
      }
      case 'archetype':
        return s.pressure > FILLER_PRESSURE_GATE && this.projects.length < MAX_ACTIVE && eco.treasury >= BUILD_FLOOR;
      default:
        return !!LANDMARKS[type] && this.landmarkWanted(LANDMARKS[type], s, eco);
    }
  }

  /**
   * The mirror of wanted(): when a council order is refused as unneeded, say
   * WHICH gate failed, with the numbers, so a "blocked" row reads as feedback
   * ("congestion 12% is below the 34% gate") rather than a shrug ("the town
   * does not need this right now"). One short line per type; null when the
   * town actually wants it.
   */
  unwantedWhy(type) {
    if (this.wanted(type)) return null;
    const s = this.inputs();
    const eco = s.economy;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const crewsFree = this.projects.length < MAX_ACTIVE && eco && eco.treasury >= BUILD_FLOOR;
    switch (type) {
      case 'power':
      case 'water':
      case 'sewage':
        return `${type} grid has headroom — not over capacity`;
      case 'house':
        if (!(s.pressure > HOUSE_PRESSURE_GATE)) return `housing pressure ${s.pressure.toFixed(2)} is below the ${HOUSE_PRESSURE_GATE} gate`;
        return `${Math.max(0, Math.round(s.capacity - s.pop))} spare beds — no shortage`;
      case 'shop': {
        const u = unemploymentRate(this.town);
        return `unemployment ${pct(u)} is below the ${pct(UNEMPLOYMENT_GATE)} gate — shops have staff`;
      }
      case 'office': {
        const u = unemploymentRate(this.town);
        if (!(s.pop >= OFFICE_MIN_POP)) return `population ${s.pop} is below the ${OFFICE_MIN_POP} an office needs`;
        if (!(u > UNEMPLOYMENT_GATE)) return `unemployment ${pct(u)} is below the ${pct(UNEMPLOYMENT_GATE)} gate`;
        return `${this.officeCount()} offices already cover ${s.pop} people`;
      }
      case 'district':
        if (!(s.pressure > HOUSE_PRESSURE_GATE)) return `housing pressure ${s.pressure.toFixed(2)} is below the ${HOUSE_PRESSURE_GATE} gate`;
        if (this.districtQueue) return 'a district is already being built';
        if (!(this.projects.length < MAX_ACTIVE)) return 'all crews are busy';
        return `treasury $${Math.round(eco.treasury).toLocaleString('en-US')} is below the $${DISTRICT_FLOOR.toLocaleString('en-US')} floor`;
      case 'civic':
        {
          const overload = civicExpansionNeed(this.town);
          return overload
            ? `${overload.kind} service is ${Math.round(overload.load * 100)}% loaded — add capacity before pulling more residents`
            : `${s.pop} people across ${s.civicCount} facilities — below one per ${CIVIC_PER_POP}`;
        }
      case 'park':
        return `${s.parks} park cells for ${s.pop} people — need ${Math.ceil(s.pop * PARKS_PER_POP)}`;
      case 'parking':
        return 'no parking pressure — bays are meeting demand';
      case 'road': {
        const c = s.mobility ? s.mobility.congestion : 0;
        if (!(c > CONGESTION_GATE)) return `congestion ${pct(c)} is below the ${pct(CONGESTION_GATE)} gate`;
        return 'no measured trip benefit or disconnected road component needs an extension yet';
      }
      case 'bridge':
        return 'no bank-to-bank river gap left to span';
      case 'roadup': {
        const c = s.mobility ? s.mobility.congestion : 0;
        if (!(s.mobility && c > CONGESTION_GATE)) return `congestion ${pct(c)} is below the ${pct(CONGESTION_GATE)} gate — nothing to widen for`;
        return 'no straight corridor left to raise';
      }
      case 'footway':
        return 'no landlocked parcel needs a path';
      case 'land':
        if (this.vacantAcquiredPlots(2) >= 2) return 'acquired land still has usable serviced plots';
        if ((s.pressure || 0) < 0.9 && !this.town.industry?.missingConstructionProduct?.()) return 'housing and material pressure are below the land-shortage gate';
        return 'the town has no unacquired frontier tiles or the reserve is too low';
      case 'restructure':
        return 'no occupied building has a safe higher floor to add';
      case 'factory': {
        const starter = this.town.industry?.missingConstructionProduct?.();
        const strained = this.town.industry && (starter || (this.town.industry.factories().length === 0
          ? this.town.industry.deficitProduct?.() || this.town.industry.strainedProduct()
          : null));
        if (!this.factoryRoom()) return 'no room — works already outnumber the workforce';
        return `storehouse is healthy${strained ? '' : ' — no strained commodity'}`;
      }
      case 'resource':
        return 'no strained resource left to upgrade';
      case 'upgrade':
        if (!crewsFree) return 'no spare crew or savings for filler work';
        if (this.progressionTarget()) return `height rung is ${desiredFloorsForPopulation(s.pop)} floors for this population`;
        if (worstCivicLoad(this.town) > CIVIC_LOAD_GATE && !this.civicUpgradeTarget()) return 'civic load is high but its facilities have reached their authored vertical caps; add a wing or a new facility';
        return `no facility over ${pct(CIVIC_LOAD_GATE)} load and pressure ${s.pressure.toFixed(2)} is comfortable`;
      case 'renovate':
        if (!crewsFree) return 'no spare crew or savings for quality work';
        return 'every building is already at the top budget tier';
      case 'tierup':
        if (!crewsFree) return 'no spare crew or savings for shop growth';
        return 'no shop has another rung to climb';
      case 'wing':
        if (!crewsFree) return 'no spare crew or savings for extensions';
        return 'no building has room for a wing';
      case 'archetype':
        if (!(s.pressure > FILLER_PRESSURE_GATE)) return `pressure ${s.pressure.toFixed(2)} is below the ${FILLER_PRESSURE_GATE} design gate`;
        if (!crewsFree) return 'no spare crew or savings for a custom design';
        return 'design work is already underway';
      default:
        return LANDMARKS[type] ? 'its site and funding requirements are not met yet' : 'the town does not need this right now';
    }
  }

  /**
   * Phase 5 — the plainest building still below the budget ladder's top rung
   * (budget 1 → 2 → 3). `opts.budget` pins how far the climb should go, so a
   * council order of `RENOVATE budget=2` only ever reaches for budget-1 lots.
   * Buildings claimed by another project are skipped, same as upgrade's head.
   */
  renovateTarget(opts = {}) {
    const top = Math.max(1, Math.min(3, Math.round(opts.budget || 3)));
    const pending = this.pendingTargets;
    const cands = this.town.buildings.filter((b) => {
      if (!b.house) return false;
      const cur = b.budget ?? b.house.spec?.budget ?? 1;
      if (cur >= top) return false;
      if (pending && pending.has(b)) return false;
      if (this.claims && b.cell && this.claims.has(`${b.cell[0]},${b.cell[1]}`)) return false;
      return true;
    });
    if (!cands.length) return null;
    cands.sort(
      (a, b) =>
        (a.budget ?? a.house.spec?.budget ?? 1) - (b.budget ?? b.house.spec?.budget ?? 1) ||
        (a.name ? 0 : 1) - (b.name ? 0 : 1)
    );
    return cands[0];
  }

  /** The shortest building still below the population-earned height rung. */
  progressionTarget() {
    const pop = this.inputs()?.pop || 0;
    const cap = desiredFloorsForPopulation(pop);
    const pending = this.pendingTargets;
    const cands = this.town.buildings.filter((b) =>
      b.house && b.kind !== 'civic' && (b.floors || 1) < cap && (!pending || !pending.has(b))
    );
    cands.sort((a, b) =>
      (a.floors || 1) - (b.floors || 1) ||
      (b.footprint?.length || 1) - (a.footprint?.length || 1) ||
      a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]
    );
    return cands[0] || null;
  }

  civicUpgradeTarget() {
    return civicUpgradeTarget(this.town, CIVIC_LOAD_GATE, this.pendingTargets);
  }

  /**
   * Phase 5 — the shop furthest down the commerce ladder: the one whose next
   * rung buys the most headroom (smallest capacity first). Pin `toRung` to
   * aim at one specific rung instead of the next one up.
   */
  tierupTarget(toRung = null) {
    const pending = this.pendingTargets;
    const shops = this.town.buildings.filter((b) => {
      if (b.kind !== 'shop' || (pending && pending.has(b))) return false;
      const cap = b.capacity || 0;
      return toRung ? cap < toRung.capacity : !!nextRungFor(cap);
    });
    if (!shops.length) return null;
    shops.sort((a, b) => (a.capacity || 0) - (b.capacity || 0));
    return shops[0];
  }

  /**
   * Phase 9 — the river gap the town could bridge right now: a straight run
   * of 1..MAX_BRIDGE_GAP water cells with a road on each bank. Returns
   * { cells, joins, from, to } — `joins` is true when the two banks are
   * separate road components, i.e. the crossing would RECONNECT the network
   * rather than add a second way across — or null when no gap fits. Claimed
   * cells are skipped, so a queued project never loses its site.
   *
   * A gap that only adds a redundant crossing is still returned (the council
   * may order one plainly), but ranked() only offers the joining kind.
   */
  bridgeTarget() {
    const t = this.town;
    const g = t.grid;
    if (!g) return null;
    const comps = roadComponents(g);
    const claimed = (x, y) => this.claims.has(`${x},${y}`);
    let any = null;
    let join = null;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!g.isRoad(x, y)) continue;
        for (const [dx, dy] of BRIDGE_DIRS) {
          let nx = x + dx;
          let ny = y + dy;
          if (!g.inBounds(nx, ny) || !g.isWater(nx, ny)) continue;
          const cells = [];
          let ok = true;
          while (g.inBounds(nx, ny) && g.isWater(nx, ny)) {
            if (cells.length >= MAX_BRIDGE_GAP || claimed(nx, ny)) { ok = false; break; }
            cells.push([nx, ny]);
            nx += dx;
            ny += dy;
          }
          if (!ok || !cells.length) continue;
          if (!g.inBounds(nx, ny) || !g.isRoad(nx, ny)) continue;
          const hit = { cells, joins: comps.label[g.idx(x, y)] !== comps.label[g.idx(nx, ny)], from: [x, y], to: [nx, ny] };
          if (hit.joins) {
            if (!join) join = hit;
          } else if (!any) {
            any = hit;
          }
        }
      }
    }
    return join || any;
  }

  /**
   * Phase 7 — the corridor the town could still raise: the longest run of
   * straight road cells whose ladder class sits below the target. `opts.to`
   * (the council's `class=` spec) pins the rung to reach; without it the
   * plan climbs exactly one rung.
   *
   * Structured cells — junctions, bridges, ramps, tunnels, dead ends — keep
   * their own class and simply stay out of the run, so an upgrade never
   * touches the geometry of a structure. Cost is summed per cell over the
   * rungs that cell actually climbs (cost follows the class delta).
   */
  roadUpgradeTarget(opts = {}) {
    const t = this.town;
    const g = t.grid;
    if (!g) return null;
    const pin = opts.to || null;
    const pinIdx = pin ? XS_CLASS_ORDER.indexOf(pin) : -1;
    if (pin && pinIdx < 0) return null;

    const seen = new Set();
    let best = null;
    g.forEach((x, y, grid) => {
      if (!grid.isRoad(x, y)) return;
      const axis = straightAxis(grid.roadAt(x, y));
      if (!axis || classify(grid, x, y) !== 'straight') return;
      // Only the run's first cell seeds it — every other cell of the same run
      // is found here in O(1), so a congested town never walks its corridors
      // once per cell on every tick.
      const px = x - (axis === 'x' ? 1 : 0);
      const py = y - (axis === 'z' ? 1 : 0);
      if (grid.isRoad(px, py) && straightAxis(grid.roadAt(px, py)) === axis) return;
      const run = straightRun(grid, x, y, axis);
      const key = `${run.sx},${run.sy},${axis}`;
      if (seen.has(key)) return;
      seen.add(key);

      const runCells = [];
      for (let i = 0; i < run.total; i++) {
        const cx = run.sx + run.dx * i;
        const cy = run.sy + run.dy * i;
        if (!grid.isRoad(cx, cy) || classify(grid, cx, cy) !== 'straight') continue;
        const cls = t.roadClassAt(cx, cy);
        const ci = classIndex(cls);
        if (ci < 0) continue; // not on the ladder (should not happen here)
        runCells.push({ x: cx, y: cy, i: ci });
      }
      if (!runCells.length) return;

      const fromIdx = Math.min(...runCells.map((c) => c.i));
      const toIdx = pinIdx >= 0 ? pinIdx : fromIdx + 1;
      if (toIdx > XS_CLASS_ORDER.length - 1) return;
      const work = runCells.filter((c) => c.i < toIdx);
      if (!work.length) return;

      let cost = 0;
      for (const c of work) {
        for (let i = c.i; i < toIdx; i++) cost += ROAD_UPGRADE_RUNG[XS_CLASS_ORDER[i]] || 0;
      }
      const cand = {
        cells: work.map((c) => [c.x, c.y]),
        from: XS_CLASS_ORDER[fromIdx],
        to: XS_CLASS_ORDER[toIdx],
        fromIdx,
        toIdx,
        cost,
        axis,
        cellsUpgraded: work.length
      };
      // Longest corridor first; on a tie the lower class (the bigger lift) wins.
      if (
        !best ||
        cand.cellsUpgraded > best.cellsUpgraded ||
        (cand.cellsUpgraded === best.cellsUpgraded && cand.fromIdx < best.fromIdx)
      ) {
        best = cand;
      }
    });
    return best;
  }

  /**
   * Phase 6 — the strip of cells a building could claim to grow a wing: one
   * FULL side of its footprint, every cell on the same parcel as the building
   * itself (so a wing can never jump a road or a neighbour's lot).
   *
   * Preference order: the road-parallel side first (a wing reads as width
   * from the street), then the back, then the road side. `opts.acquire`
   * (landmark expansion) lets an occupied cell join the strip — the caller
   * prices those with estimateAcquire() and clears them in plan.run().
   */
  wingStrip(rec, opts = {}) {
    const t = this.town;
    const g = t.grid;
    if (!rec || !rec.cell || !Number.isInteger(rec.cell[0])) return null;
    const cells0 = rec.footprint && rec.footprint.length ? rec.footprint : [rec.cell];
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (const [cx, cy] of cells0) {
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return null;
      ax = Math.min(ax, cx); ay = Math.min(ay, cy);
      bx = Math.max(bx, cx); by = Math.max(by, cy);
    }
    const home = t.parcels?.at(rec.cell[0], rec.cell[1]) || null;
    const claimed = (x, y) => this.claims.has(`${x},${y}`);
    const okCell = (x, y) => {
      if (!g.inBounds(x, y)) return false;
      const k = g.kindAt(x, y);
      if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return false;
      if (t.resources?.ownsCell(x, y) || claimed(x, y)) return false;
      const occ = t.buildingAt(x, y);
      if (occ && occ !== rec) {
        if (!opts.acquire) return false;
        if ((occ.owner || 'private') !== 'private') return false;
      }
      const p = t.parcels?.at(x, y);
      if (home ? p !== home : !p) return false;
      return true;
    };
    const f = rec.face || { x: 0, z: 1 };
    const lateral = f.x !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const depth = f.x !== 0 || f.z !== 0 ? [[-f.x, -f.z], [f.x, f.z]] : [];
    for (const [dx, dy] of [...lateral, ...depth]) {
      if (!dx && !dy) continue;
      const strip = [];
      if (dx) {
        const sx = dx > 0 ? bx + 1 : ax - 1;
        for (let y = ay; y <= by; y++) strip.push([sx, y]);
      } else {
        const sy = dy > 0 ? by + 1 : ay - 1;
        for (let x = ax; x <= bx; x++) strip.push([x, sy]);
      }
      if (strip.every(([x, y]) => okCell(x, y))) return strip;
    }
    return null;
  }

  /**
   * Phase 6 — a building that still has wing room. Plain wings only ever
   * grow into FREE cells; `{ landmark: id, acquire: true }` looks for that
   * built landmark instead and may buy out the neighbour.
   */
  wingTarget(opts = {}) {
    const pending = this.pendingTargets;
    const cands = this.town.buildings.filter((b) => {
      if (!b.house || !b.cell) return false;
      if (opts.landmark && b.subtype !== opts.landmark) return false;
      if (opts.civicOnly && b.kind !== 'civic') return false;
      if (pending && pending.has(b)) return false;
      if (this.claims && b.cell && this.claims.has(`${b.cell[0]},${b.cell[1]}`)) return false;
      return !!this.wingStrip(b, opts);
    });
    if (!cands.length) return null;
    const area = (b) => (b.footprint && b.footprint.length ? b.footprint.length : 1);
    cands.sort((a, b) => area(a) - area(b) || a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
    return cands[0];
  }

  /** A built LANDMARKS entry that still has wing room (acquire allowed). */
  landmarkWingTarget() {
    for (const lm of Object.values(LANDMARKS)) {
      if (!this.hasBuilding(lm.id)) continue;
      const b = this.wingTarget({ landmark: lm.id, acquire: true });
      if (b) return b;
    }
    return null;
  }

  /**
   * Shared rank/need gate for a LANDMARKS row: not built yet, the town is
   * big enough and rich enough (plus any optional extra gate such as shops).
   */
  landmarkWanted(lm, s, eco) {
    const funds = lm.owner === 'private' && this.town.economy
      ? this.town.economy.accounts.developer.cash
      : eco.treasury;
    return (
      !this.hasBuilding(lm.id) &&
      s.pop > lm.pop &&
      funds > lm.treasury &&
      (!lm.shops || s.shops >= lm.shops)
    );
  }

  /** True when a landmark of this subtype is already standing. */
  hasBuilding(subtype) {
    return this.town.buildings.some((b) => b.subtype === subtype);
  }

  /**
   * Why this plan cannot start right now — '' when it can. Budget and
   * materials only; the cell search stays in apply() so a single site probe
   * per apply is preserved.
   */
  check(plan) {
    if (!plan) return 'no such plan';
    const reserve = plan.type === 'utility' ? 5000 : UTILITY_RESERVE;
    const finance = this.town.economy?.resolveProjectFinance(plan, reserve);
    if (plan.type !== 'district' && plan.cost && finance && !finance.affordable)
      return `over budget — ${finance.financierSector} needs ${finance.requiredCash} on hand`;
    const inventoryReady = (materials) => {
      if (!materials || !this.town.industry) return true;
      if (this.town.industry.canAfford(materials)) return true;
      return (plan.type === 'factory' && plan.bootstrapMaterials && this.town.industry.canBootstrapMaterials(materials, plan.bootstrapProduct)) ||
        (plan.allowMaterialImports && this.town.industry.canImportMaterials(materials));
    };
    if (plan.materials && this.town.industry && !inventoryReady(plan.materials)) {
      return `short on ${this.town.industry.shortfall(plan.materials)}`;
    }
    // The nine "stale plan" rules this used to carry — upgrade/renovate/tierup/
    // wing/roadup/bridge/clear/rezone/upzone/annex each testing for a missing
    // target or an empty cell brush — were UNREACHABLE. `planFor` already
    // returns `null` for every one of those types when there is nothing to do
    // (e.g. `if (!target) return null` for upgrade), so no plan of those types
    // ever reached `check`, let alone with the target missing. Measured: 40
    // `planFor` calls per type, with and without `zone=` options, and not one of
    // the ten conditions fired.
    //
    // They read as a safety net and were not one. `check`'s real remaining job
    // is money and materials, which are above; the one genuine staleness case in
    // this file is `road`, and it is handled where the road is actually chosen —
    // in `apply`, not here. Deleted rather than left as a false assurance; see
    // SRS INV-5.
    return '';
  }

  /**
   * The best plan that is both wanted AND feasible, or null.
   * `amenities: false` skips amenity work (park, archetype, filler floors) —
   * used by the council's planner fallback so a healthy town answers
   * NO_ACTION instead of inventing a park (Phase 4 C3).
   */
  evaluate(opts = {}) {
    const amenities = opts.amenities !== false;
    for (const c of this.ranked()) {
      if (!amenities && c.amenity) continue;
      const plan = planFor(this.town, c.type, c.opts);
      if (!plan) continue;
      const quoted = this.quote(plan);
      if (!quoted.ok) continue;
      return plan.type === 'road' ? quoted.plan : plan;
    }
    return null;
  }

  /**
   * The outskirts rule, in the one place every industrial siting path reads it.
   *
   * Two halves, and both are needed. `siteEligible` is the hard half: a
   * candidate inside the town core is refused outright, so no amount of land
   * value or rng noise can drop a sawmill on the civic square. `siteScore` is
   * the soft half: among the eligible rim land it pulls the pick outward, and
   * it deliberately counts for more than the land-value term — land value peaks
   * downtown (civic, parks and shops all push it up near the centre), so
   * without this the planner would still prefer the innermost legal plot.
   *
   * `profile` is measured from the road network, so this keeps meaning "the
   * rim" as the town grows outward rather than referring to the rectangle
   * `planCore` drew at seed time.
   */
  industryProfile(g) {
    return urbanProfile(g);
  }

  industryEligible(profile, x, y) {
    return onIndustrialGround(profile, x, y);
  }

  industryScore(profile, x, y) {
    return Math.min(1.4, edgeScore(profile, x, y)) * 1.2;
  }

  /**
   * Best site for a multi-cell footprint: a block whose cells are free (or
   * occupied by buyable buildings when the plan acquires), at least one cell
   * fronting the main network, scoring land value, frontage and zonal fit.
   * Returns { cell, cells } with `cell` as the block anchor, or null.
   */
  findFootprintSite(plan) {
    const fp = plan.footprint;
    if (!fp) return null;
    const cols = Math.max(1, Math.round(fp.cols || 1));
    const rows = Math.max(1, Math.round(fp.rows || 1));
    const t = this.town;
    const g = t.grid;
    const acquire = !!plan.acquire;
    const want =
      plan.wantZone ||
      { shop: ZONE.COMMERCIAL, civic: ZONE.CIVIC, factory: ZONE.INDUSTRIAL }[plan.type] ||
      { house: ZONE.RESIDENTIAL, shop: ZONE.COMMERCIAL, civic: ZONE.CIVIC }[plan.zone] ||
      null;
    // Measured once per search, and only when the plan is actually industrial.
    const industrial = want === ZONE.INDUSTRIAL;
    const profile = industrial ? this.industryProfile(g) : null;
    const comps = roadComponents(g);
    const claimed = (cx, cy) => this.claims.has(`${cx},${cy}`);
    let best = null;
    let bestScore = -1;
    for (let y = 0; y <= g.h - rows; y++) {
      for (let x = 0; x <= g.w - cols; x++) {
        if (industrial) {
          // A works must sit wholly on the rim: test the block's own centre,
          // so a 3x2 lot cannot straddle the line and take the core with it.
          const mx = x + (cols - 1) / 2;
          const my = y + (rows - 1) / 2;
          if (!this.industryEligible(profile, mx, my)) continue;
        }
        const cells = [];
        let ok = true;
        for (let dy = 0; dy < rows && ok; dy++) {
          for (let dx = 0; dx < cols && ok; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            const k = g.kindAt(cx, cy);
            if (k === CELL_KIND.ROAD || k === CELL_KIND.WATER || k === CELL_KIND.PARK) { ok = false; break; }
            if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) { ok = false; break; }
            if (t.resources?.ownsCell(cx, cy) || claimed(cx, cy)) { ok = false; break; }
            if (!plan.projection && t.perimeter && !t.perimeter.isAcquired(cx, cy)) { ok = false; break; }
            const occ = t.buildingAt(cx, cy);
            if (occ && !acquire) { ok = false; break; }
            cells.push([cx, cy]);
          }
        }
        if (!ok || cells.length !== cols * rows) continue;
        // Farms, paddocks and poultry runs are working yards. Leave a real
        // buffer around their full footprint so a large civic, commercial or
        // industrial block cannot be dropped against the fence just because
        // its anchor cell happens to look attractive.
        if (!plan.allowAgriculturalAdjacency && agriculturalSetbackConflict(t.resources, cells)) continue;
        // Parcels: the block must contain at least one parcel's street-facing
        // cell (so it sits on the street, like findCell's front-cell rule).
        // Vacancy is checked per footprint cell above. A parcel can contain
        // two cells, one already occupied and one still free; rejecting the
        // whole parcel here made a 3x3 factory campus impossible whenever it
        // crossed a normal 1–2-cell subdivision. Acquisition remains the only
        // path allowed to clear an occupied footprint cell.
        const blockSet = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
        const parcelSet = new Set();
        for (const [cx, cy] of cells) {
          const p = t.parcels?.at(cx, cy);
          if (p) parcelSet.add(p);
        }
        let frontIn = parcelSet.size === 0;
        for (const p of parcelSet) {
          const bc = t.parcels.buildableCell(p);
          if (bc && blockSet.has(`${bc[0]},${bc[1]}`)) frontIn = true;
        // A large campus may legitimately span the interior of a vacant
        // block. `buildable` is parcel-level metadata and is false for a
        // landlocked parcel even when another cell in this footprint fronts
        // the road. The access check below is the real network requirement;
        // only protected park/public parcels must remain off limits.
        if (p.type === 'park' || p.type === 'public') { frontIn = false; break; }
        }
        if (!frontIn) continue;
        let frontage = 0;
        let access = false;
        let landSum = 0;
        let zoneFit = 0;
        for (const [cx, cy] of cells) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (g.isRoad(cx + dx, cy + dy) || g.isPath(cx + dx, cy + dy)) { frontage++; break; }
          }
          if (hasNetworkAccess(g, cx, cy, comps)) access = true;
          landSum += t.economy ? t.economy.landValueAt(cx, cy) : 0.5;
          if (want && g.zone[g.idx(cx, cy)] === want) zoneFit++;
        }
        if (!access) continue;
        const land = landSum / cells.length;
        const zoneBonus = want ? (zoneFit / cells.length) * 0.6 : 0;
        // Industry inverts the weighting: outskirts beats land value.
        const landTerm = industrial ? land * 0.35 : land;
        const rim = industrial
          ? this.industryScore(profile, x + (cols - 1) / 2, y + (rows - 1) / 2)
          : 0;
        const acquiredArea = cells.reduce((n, [cx, cy]) => n + (t.perimeter?.isAcquired(cx, cy) ? 1 : 0), 0);
        const acquiredBonus = (acquiredArea / Math.max(1, cells.length)) * 1.2 -
          (1 - acquiredArea / Math.max(1, cells.length)) * 0.2;
        const score =
          landTerm + zoneBonus + rim + acquiredBonus + Math.min(3, frontage) * 0.15 + this.rng.next() * 0.3;
        if (score > bestScore) {
          bestScore = score;
          // The anchor must be the parcel's FRONTAGE cell, not the block's
          // top-left corner. `createBuilding` reads the parcel at the anchor to
          // take its budget tier and its setback, and records it as
          // `parcelId` — so an anchor on the wrong parcel gave a civic building
          // an industrial plot's dimensions and then retyped that parcel, so
          // the validator's plot census lost ground that was still standing as
          // industry. `findCell` already enforces the equivalent rule at
          // 3139 (`bc[0] === x && bc[1] === y`); this is the same constraint
          // applied to the winning block.
          const anchor = this.frontageAnchorInBlock(cells, blockSet) || [x, y];
          best = { cell: anchor, cells, score };
        }
      }
    }
    return best;
  }

  /**
   * The cell inside a footprint block that is a parcel's buildable (street-
   * facing) cell, or null if the block contains none.
   *
   * The block already contains such a cell — `findFootprintSite` requires one —
   * so this only has to find it. Used to pick the anchor, because the anchor is
   * what `createBuilding` looks up to take a parcel's setback and budget tier
   * and to record as `parcelId`.
   */
  frontageAnchorInBlock(cells, blockSet) {
    const t = this.town;
    for (const [x, y] of cells) {
      const parcel = t.parcels?.at(x, y);
      if (!parcel) continue;
      const bc = t.parcels.buildableCell(parcel);
      if (bc && blockSet.has(`${bc[0]},${bc[1]}`)) return [x, y];
    }
    return null;
  }

  /**
   * The council's LOT-SIZE decision — no hardcoded dimensions. Every
   * candidate footprint is searched for its best site, then the trio is
   * scored: site quality (land, frontage, zonal fit), budget headroom (a
   * richer treasury comfortably funds a bigger block) and need-fit (a strong
   * need justifies a larger lot; a mild one keeps it modest). Returns
   * { cell, cells, footprint, score } or null.
   */
  siteForFootprint(plan) {
    const cands = plan.footprintCandidates || (plan.footprint ? [plan.footprint] : null);
    if (!cands || !cands.length) return null;
    const need = Math.max(0, Math.min(1, plan.need ?? 0.5));
    const rich = (e) => !Array.isArray(e);
    const maxArea = Math.max(...cands.map((e) => (rich(e) ? e.cols * e.rows : e[0] * e[1])));
    const financier = this.town.economy?.canFinanceProject(plan)?.account;
    const treasury = financier ? financier.balance : 0;
    let best = null;
    for (const entry of cands) {
      const [cols, rows] = rich(entry) ? [entry.cols, entry.rows] : entry;
      const area = cols * rows;
      const site = this.findFootprintSite({ ...plan, footprint: { cols, rows } });
      if (!site) continue;
      // Per-candidate price (commerce rungs differ) falls back to the plan's.
      const cc = (rich(entry) && entry.cellCost != null ? entry.cellCost : plan.cellCost) || 0;
      const cost = cc * area + (plan.flatFee || 0);
      const reserve = this.town.economy?.classifyProject(plan) === 'government' ? UTILITY_RESERVE : 0;
      const headroom = cost > 0 ? (treasury - reserve) / cost : 1;
      const budgetFit = Math.max(0, Math.min(1, headroom));
      const desired = 1 + need * (maxArea - 1);
      const needFit = 1 - Math.abs(area - desired) / Math.max(1, maxArea - 1);
      const score = site.score + budgetFit + needFit * 1.2;
      if (!best || score > best.score) {
        best = {
          cell: site.cell,
          cells: site.cells,
          footprint: { cols, rows },
          score,
          tier: rich(entry) ? entry.tier : undefined,
          cellCost: rich(entry) ? entry.cellCost : undefined,
          capacity: rich(entry) ? entry.capacity : undefined
        };
      }
    }
    return best;
  }

  /** What buying out the occupants of a block costs; state property is free. */
  estimateAcquire(cells) {
    const buildings = [...new Set(cells.map(([x, y]) => this.town.buildingAt(x, y)).filter(Boolean))];
    const quote = this.town.economy?.acquisitionQuote(buildings, { type: 'acquisition', financingSector: 'developer' });
    return quote?.ok ? Math.round(quote.total) : Infinity;
  }

  /** Clear a paid-for block: occupants out, props salvaged to the storehouse. */
  demolishFor(cells) {
    const seen = new Set();
    for (const [x, y] of cells) {
      const b = this.town.buildingAt(x, y);
      if (b && !seen.has(b)) {
        seen.add(b);
        this.town.removeBuilding(b, false);
      }
      this.town.clearProps(x, y);
    }
    this.town.rebuildStatic();
  }

  /**
   * Phase 8 — the town's most-used zone: what ANNEX_EDGE paints when the
   * council does not name one. Ties go to the first zone met in grid order,
   * so the same town always answers the same way.
   */
  dominantZone() {
    const g = this.town.grid;
    const counts = new Map();
    g.forEach((x, y, grid) => {
      const z = grid.zone[grid.idx(x, y)];
      if (z) counts.set(z, (counts.get(z) || 0) + 1);
    });
    let best = ZONE.RESIDENTIAL;
    let n = 0;
    for (const [z, c] of counts) {
      if (c > n) {
        best = z;
        n = c;
      }
    }
    return best;
  }

  /** True when any cell of the town is a paved square (Phase 8). */
  hasPlaza() {
    const g = this.town.grid;
    let found = false;
    g.forEach((x, y, grid) => {
      if (grid.kindAt(x, y) === CELL_KIND.PLAZA) found = true;
    });
    return found;
  }

  /** The 3×3 brush around an anchor, filtered by `ok` (Phase 8). */
  zoneBrush(anchor, ok) {
    if (!anchor) return [];
    const g = this.town.grid;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = anchor[0] + dx;
        const y = anchor[1] + dy;
        if (!g.inBounds(x, y)) continue;
        if (ok && !ok(x, y)) continue;
        out.push([x, y]);
      }
    }
    return out;
  }

  /**
   * Phase 8 — the cells one land-use order will repaint: findCell picks the
   * anchor, zoneBrush expands it, and each intent's own condition filters it
   * (CLEAR_LOT takes the building's whole footprint instead of a brush).
   */
  landUseCells(type, zone) {
    const t = this.town;
    const g = t.grid;
    const anchor = this.findCell(type, zone);
    if (!anchor) return [];
    if (type === 'clear') {
      const b = t.buildingAt(anchor[0], anchor[1]);
      return b ? b.footprint || [b.cell] : [];
    }
    const brush = this.zoneBrush(anchor, (x, y) => {
      if (!brushLand(g, x, y, t)) return false;
      const idx = g.idx(x, y);
      if (type === 'rezone' || type === 'annex') {
        if (g.zone[idx] === zone) return false;
        // The annex only ever takes the outer ring of the map.
        if (type === 'annex' && !edgeCell(g, x, y)) return false;
        // Phase 17 — prefer ground the exploration bucket has already mapped.
        if (type === 'annex' && t.research && t.research.surveyed.size) {
          if (!t.research.isSurveyed(x, y) && t.research.isSurveyed(anchor[0], anchor[1])) return false;
        }
        return true;
      }
      if (type === 'upzone') return !g.densityAt(x, y);
      return false;
    });
    return brush;
  }
  /**
   * Phase 18 (A6) — the town's connectivity, read from the grid: how many
   * separate road networks it has, how much of it is in the main one, and how
   * much built land is off-network entirely. Joined into `stats()` and the
   * report, and used below to bias the site search toward connected land.
   */
  connectivity() {
    const t = this.town;
    const g = t.grid;
    // The Town's version-stamped cache, not placementController's uncached
    // `roadComponents(g)`. This runs from `stats()`, which the render loop calls
    // every frame — re-labelling the whole grid at 60 Hz for a number the HUD
    // only redraws four times a second.
    const comps = t.roadComponents();
    const roads = g.roadCount;
    // `roadComponents` already measures the main network as the largest
    // component and reports its id — this reads that rather than re-deriving it.
    const mainRoads = comps.main >= 0 ? comps.sizes[comps.main] : 0;
    let offNetwork = 0;
    for (const b of t.buildings) {
      const fp = b.footprint && b.footprint.length ? b.footprint : [b.cell];
      if (!fp.some(([x, y]) => hasNetworkAccess(g, x, y, comps))) offNetwork++;
    }
    return {
      components: comps.count,
      roads,
      mainRoads,
      orphanRoads: Math.max(0, roads - mainRoads),
      coverage: roads ? Math.round((mainRoads / roads) * 100) / 100 : 0,
      buildings: t.buildings.length,
      offNetwork,
      // The one number a planner reads: 1 is fully connected.
      linked: t.buildings.length
        ? Math.round(((t.buildings.length - offNetwork) / t.buildings.length) * 100) / 100
        : 1
    };
  }

  /**
   * Phase 18 (A6) — is this cell on the MAIN network, or on an orphan? A
   * planner pick that lands on an orphan is legal but worse, so `findCell`
   * scores it below its main-network twin instead of refusing it.
   */
  onMainNetwork(g, x, y) {
    // The cached, version-stamped labelling from the Town. This used to call
    // placementController's `roadComponents(g)`, which allocates a fresh
    // w*h Int32Array and re-labels every road component on EVERY call — and
    // this runs once per candidate cell, so on a large grid a single
    // findExpandCells was relabelling the whole map thousands of times.
    const comps = this.town.roadComponents();
    if (comps.size.length <= 1) return true;
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!g.isRoad(x + dx, y + dy)) continue;
          const label = comps.comp[g.idx(x + dx, y + dy)];
          return label < 0 || label === comps.main;
        }
      }
    }
    return true;
  }

  /**
   * Phase 18 (A6) — the access road a set of cells needs to join the network,
   * through the same `spurPath` the resource sites use. Returns the cells to
   * paint and what they cost, or null when the cells already reach a road (the
   * common case) or cannot be reached at all.
   */
  planConnectedRoad(cells) {
    const t = this.town;
    const g = t.grid;
    if (!cells || !cells.length) return { spur: [], cost: 0, needed: false };
    const comps = roadComponents(g);
    if (cells.some(([x, y]) => hasNetworkAccess(g, x, y, comps))) {
      return { spur: [], cost: 0, needed: false };
    }
    const spur = spurPath(g, cells, MAX_SPUR_LENGTH);
    if (!spur || !spur.length) return { spur: null, cost: 0, needed: true };
    return { spur, cost: spur.length * COST.road, needed: true };
  }

  /**
   * Paint an access spur, refreshing the road graph the same way every other
   * road edit does. Called from `apply()` and from the district queue.
   */
  laySpur(spur) {
    if (!spur || !spur.length) return false;
    const g = this.town.grid;
    for (const [x, y] of spur) {
      if (!g.inBounds(x, y)) continue;
      if (g.isRoad(x, y)) continue;
      g.setKind(x, y, CELL_KIND.ROAD);
      g.zone[g.idx(x, y)] = null;
      g.owner[g.idx(x, y)] = null;
    }
    this.town.rebuildStatic();
    return true;
  }

  commitSpur(plan) {
    if (!plan.accessSpur?.length) return;
    const g = this.town.grid;
    plan.accessSpurBefore = plan.accessSpur.map(([x, y]) => ({ x, y, kind: g.kindAt(x, y), zone: g.zone[g.idx(x, y)], owner: g.owner[g.idx(x, y)] }));
    this.laySpur(plan.accessSpur);
  }

  rollbackSpur(plan) {
    if (!plan.accessSpurBefore?.length) return;
    const g = this.town.grid;
    for (const { x, y, kind, zone, owner } of plan.accessSpurBefore) {
      g.setKind(x, y, kind);
      g.zone[g.idx(x, y)] = zone;
      g.owner[g.idx(x, y)] = owner;
    }
    plan.accessSpurBefore = null;
    this.town.rebuildStatic();
  }

  /**
   * EXTEND_STREET's shape. Given an EMPTY anchor beside the network, walk each
   * straight axis and return the cells one order will pave, capped at
   * EXTEND_STREET_TILES. Two answers matter to the planner:
   *
   *   `joins`  — the run lands on a road, or the anchor itself sits between two
   *              road cells, so paving CONNECTS two roads;
   *   `cells`  — the run. A single tile is only worth ordering when it joins
   *              something; otherwise an order lays 3–4 tiles of new street.
   */
  roadRuns(anchor) {
    if (!anchor) return [];
    const t = this.town;
    const g = t.grid;
    const free = (x, y) =>
      g.inBounds(x, y) &&
      g.kindAt(x, y) === CELL_KIND.EMPTY &&
      !t.buildingAt(x, y) &&
      !t.resources?.ownsCell(x, y) &&
      !this.claims.has(`${x},${y}`);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nbrs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const opposing = dirs.filter(([dx, dy]) => g.isRoad(anchor[0] + dx, anchor[1] + dy));
    const wasRoad = (x, y) => g.inBounds(x, y) && g.isRoad(x, y);
    const roadDegree = (x, y) => {
      let d = 0;
      for (const [dx, dy] of nbrs) if (wasRoad(x + dx, y + dy)) d++;
      return d;
    };

    /**
     * How many cells this run turns into a junction. A junction is not
     * intrinsically wrong — towns need crossings — but an order that lands on
     * an existing street converts cells that were a straight run into
     * intersections, and scoring those orders as the BEST ones is what turned
     * a road network into a lattice of zebra crossings. Paving is judged on
     * what it leaves behind, not just on what it adds.
     */
    const junctionDelta = (cells) => {
      const add = new Set(cells.map(([x, y]) => `${x},${y}`));
      const touched = new Set(add);
      for (const k of add) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of nbrs) touched.add(`${x + dx},${y + dy}`);
      }
      const degree = (x, y, isRoad) => {
        let d = 0;
        for (const [dx, dy] of nbrs) if (isRoad(x + dx, y + dy)) d++;
        return d;
      };
      const isRoad = (x, y) => wasRoad(x, y) || add.has(`${x},${y}`);
      let before = 0;
      let now = 0;
      for (const k of touched) {
        const [x, y] = k.split(',').map(Number);
        if (!g.inBounds(x, y)) continue;
        if (wasRoad(x, y) && degree(x, y, wasRoad) >= 3) before++;
        if (isRoad(x, y) && degree(x, y, isRoad) >= 3) now++;
      }
      return now - before;
    };

    const runs = [];
    for (const [dx, dy] of dirs) {
      const cells = [anchor];
      // A one-cell gap is a bridge only when this run points along the two
      // opposing road ends. The old global `bridges` flag marked a
      // perpendicular branch as a join whenever the anchor happened to sit
      // beside an intersection.
      const axisBridge =
        opposing.some(([ox, oy]) => ox === dx && oy === dy) &&
        opposing.some(([ox, oy]) => ox === -dx && oy === -dy);
      let joins = axisBridge;
      while (cells.length < EXTEND_STREET_TILES) {
        const [px, py] = cells[cells.length - 1];
        const nx = px + dx;
        const ny = py + dy;
        if (g.isRoad(nx, ny)) {
          if (cells.length > 1) joins = true;
          break;
        }
        if (!free(nx, ny)) break;
        cells.push([nx, ny]);
      }
      if (cells.length === 1 && !joins) continue;
      // Street extensions are corridor work. A normal spur starts at one
      // road-end cell and runs straight away from it; a join has one road at
      // each end. Starting beside a junction or touching a side road halfway
      // through the run creates the invalid checkerboard/grid pattern seen in
      // long runs, so reject those shapes before traffic scoring.
      const added = new Set(cells.map(([x, y]) => `${x},${y}`));
      const contacts = [];
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = cells[i];
        let count = 0;
        for (const [ox, oy] of nbrs) {
          const nx = x + ox;
          const ny = y + oy;
          if (added.has(`${nx},${ny}`)) continue;
          if (g.isRoad(nx, ny)) count++;
        }
        if (count) contacts.push({ i, count });
      }
      const firstRoads = contacts.filter((c) => c.i === 0).reduce((n, c) => n + c.count, 0);
      const lastRoads = contacts.filter((c) => c.i === cells.length - 1).reduce((n, c) => n + c.count, 0);
      const sideTouch = contacts.some((c) => c.i > 0 && c.i < cells.length - 1);
      const backRoad = g.isRoad(anchor[0] - dx, anchor[1] - dy);
      const end = cells[cells.length - 1];
      const forwardRoad = g.isRoad(end[0] + dx, end[1] + dy);
      const startOk = cells.length === 1 && joins
        ? firstRoads === 2 && backRoad && forwardRoad
        : firstRoads === 1 && backRoad;
      const endOk = !joins ? lastRoads === 0 : lastRoads >= 1 && forwardRoad;
      // A corridor that closes onto two already-busy junctions creates a
      // compact lattice of crossings rather than a useful street. Keep
      // EXTEND_STREET for open road ends and single-junction continuations;
      // a planned intersection can still be authored explicitly when the
      // town has a reason to spend a whole project on it.
      const endpointTouchesBusyJunction = (i) => {
        const [ex, ey] = cells[i];
        for (const [ox, oy] of nbrs) {
          const nx = ex + ox;
          const ny = ey + oy;
          if (added.has(`${nx},${ny}`) || !g.isRoad(nx, ny)) continue;
          if (roadDegree(nx, ny) >= 3) return true;
        }
        return false;
      };
      const busyEndpoint = endpointTouchesBusyJunction(0) || endpointTouchesBusyJunction(cells.length - 1);
      // A one-cell closure between two already-busy junctions makes a tiny
      // square of asphalt rather than a useful street. Leave that geometry to
      // a planned intersection/upgrade; gap closures between open road ends
      // remain valid.
      const bridgeEndsOpen = cells.length !== 1 || !joins || opposing.every(([ox, oy]) =>
        roadDegree(anchor[0] + ox, anchor[1] + oy) < 3
      );
      const shapeOk = !sideTouch && startOk && endOk;
      // More than one newly-created junction is the visual signature of the
      // checkerboard failure: repeated four-tile orders turn every block into
      // a zebra crossing. One is enough for a normal continuation; reject the
      // multi-junction shortcut before demand scoring can reward it.
      if (!shapeOk || !bridgeEndsOpen || busyEndpoint) continue;
      const delta = junctionDelta(cells);
      if (delta > 1) continue;
      // Length is the point of the order, a join is worth a nudge (EXTEND_STREET
      // may either connect two roads or add a run), but every junction it lays
      // costs more than the tile that caused it.
      const score = cells.length * 2 - delta * 6 + (joins ? 4 : 0);
      runs.push({ cells, joins, junctionDelta: delta, score });
    }
    return runs;
  }

  roadSelectionValid(selection) {
    if (!selection?.cells?.length || selection.version !== this.town.roadGraphVersion) return false;
    if (selection.cells.length > EXTEND_STREET_TILES) return false;
    const g = this.town.grid;
    const comps = roadComponents(g);
    const [ax, ay] = selection.cells[0];
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const x = ax + dx;
      const y = ay + dy;
      return g.isRoad(x, y) && comps.label[g.idx(x, y)] === comps.main;
    })) return false;
    if (!selection.cells.every(([x, y]) =>
      g.inBounds(x, y) && g.kindAt(x, y) === CELL_KIND.EMPTY &&
      !this.town.buildingAt(x, y) && !this.town.resources?.ownsCell(x, y) &&
      !this.claims.has(`${x},${y}`))) return false;
    return this.roadRuns([ax, ay]).some((run) =>
      (run.joins || run.cells.length >= EXTEND_STREET_TILES - 1) &&
      run.cells.length === selection.cells.length &&
      run.cells.every(([x, y], i) => x === selection.cells[i][0] && y === selection.cells[i][1]));
  }

  selectRoadExtension() {
    const t = this.town;
    const g = t.grid;
    const demand = t.traffic?.roadDemandSnapshot?.() || { cells: new Map(), trips: [] };
    // A same-day decision may see a changed queue without a new trip or road
    // tile. Include a small pressure signature so the memoized planner cannot
    // reuse a stale hotspot choice after live vehicle pressure moves.
    let demandSignal = 0;
    for (const value of demand.cells?.values?.() || []) {
      demandSignal += Math.round((Number(value.visits) || 0) + (Number(value.delay) || 0) * 10);
    }
    const lastTrip = demand.trips?.[demand.trips.length - 1];
    const lastTripKey = lastTrip
      ? `${lastTrip.from?.join(',') || ''}>${lastTrip.to?.join(',') || ''}`
      : '';
    const key = [
      t.roadGraphVersion || 0,
      t.clockDay || 0,
      t.buildings?.length || 0,
      this.projects?.length || 0,
      this.claims?.size || 0,
      Math.round((t.traffic?.congestion || 0) * 100),
      demand.cells?.size || 0,
      demand.trips?.length || 0,
      demandSignal,
      lastTrip?.at || 0,
      lastTripKey
    ].join('|');
    if (key === this.roadSelectionCacheKey) return this.roadSelectionCache;
    const runs = [];
    g.forEach((x, y, grid) => {
      if (grid.kindAt(x, y) !== CELL_KIND.EMPTY) return;
      if (t.buildingAt(x, y) || this.claims.has(`${x},${y}`) || t.resources?.ownsCell(x, y)) return;
      let roads = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (grid.isRoad(x + dx, y + dy)) roads++;
      }
      if (roads < 1 || roads > 3) return;
      for (const run of this.roadRuns([x, y])) {
        if (!run.joins && run.cells.length < EXTEND_STREET_TILES - 1) continue;
        runs.push(run);
      }
    });
    const chosen = chooseRoadExtension(g, runs, demand, roadComponents(g));
    this.roadSelectionCacheKey = key;
    this.roadSelectionCache = chosen ? { ...chosen, version: t.roadGraphVersion } : null;
    return this.roadSelectionCache;
  }

  footwayTarget({ minLength = 1, verifyRoute = true } = {}) {
    const t = this.town;
    const g = t.grid;
    const claimed = (x, y) => this.claims.has(`${x},${y}`);
    let best = null;
    const parcels = t.parcels?.parcels || [];
    for (const parcel of parcels) {
      // A path opens private/civic land that has no frontage. Parks and public
      // reservations are deliberately excluded: they are not latent
      // development sites and used to make the council pave aimless paths.
      if (!parcel || parcel.buildable || parcel.frontage?.length || parcel.publicSpace) continue;
      if (parcel.type === 'park' || parcel.type === 'public') continue;
      for (const [px, py] of parcel.cells || []) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const x = px + dx;
          const y = py + dy;
          if (!g.inBounds(x, y) || g.kindAt(x, y) !== CELL_KIND.EMPTY) continue;
          if (t.buildingAt(x, y) || claimed(x, y) || t.resources?.ownsCell(x, y)) continue;
          const cells = verifyRoute ? planFootway(g, x, y) : [[x, y]];
          if (!cells || (verifyRoute && cells.length < minLength)) continue;
          // Prefer the shortest useful link, then the parcel nearest the
          // measured town core. This keeps a footway as a deliberate access
          // connection instead of a random-looking diagonal.
          const cx = ((t.core?.x0 ?? 0) + (t.core?.x1 ?? g.w - 1)) / 2;
          const cy = ((t.core?.y0 ?? 0) + (t.core?.y1 ?? g.h - 1)) / 2;
          const distance = Math.hypot(px - cx, py - cy);
          const score = cells.length * 1000 + distance;
          if (!best || score < best.score || (score === best.score && (y < best.cell[1] || (y === best.cell[1] && x < best.cell[0])))) {
            best = { cell: [x, y], cells, parcel, score };
          }
        }
      }
    }
    return best;
  }

  findCell(type, zone, { allowUnacquired = false, allowAgriculturalAdjacency = false } = {}) {
    const t = this.town;
    const g = t.grid;
    const claimed = (x, y) => this.claims.has(`${x},${y}`);

    if (type === 'road') return this.selectRoadExtension()?.cells[0] || null;

    if (type === 'footway') {
      return this.footwayTarget()?.cell || null;
    }

    // ---- Phase 8: surface works and the land-use anchors. Each returns an
    // ANCHOR (the land-use four expand it with zoneBrush/landUseCells) under
    // its own site rule — never the free-plot rule below, because none of
    // these builds on a parcel.
    if (type === 'plaza' || type === 'parking') {
      const planned = t.parkingPlanned;
      let best = null;
      let bestScore = -Infinity;
      g.forEach((x, y, grid) => {
        const k = grid.kindAt(x, y);
        if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return;
        if (!allowUnacquired && t.perimeter && !t.perimeter.isAcquired(x, y)) return;
        if (t.buildingAt(x, y) || claimed(x, y)) return;
        if (t.resources?.ownsCell(x, y)) return;
        // A bay never displaces an owner: paintParking() refuses an owned cell.
        if (type === 'parking' && g.owner[g.idx(x, y)]) return;
        if (type === 'parking' && planned && planned.has(`${x},${y}`)) return;
        let streets = 0;
        let roads = 0;
        let squares = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = grid.kindAt(nx, ny);
          if (grid.isRoad(nx, ny)) {
            streets++;
            roads++;
          } else if (nk === CELL_KIND.PATH) streets++;
          else if (nk === CELL_KIND.PLAZA) squares++;
        }
        // A square wants a street (or a square to grow onto); a bay is kerbside
        // — paintParking() checks isAdjacentToRoad, so a path alone never counts.
        if (type === 'plaza' && streets + squares === 0) return;
        if (type === 'parking' && roads === 0) return;
        const land = t.economy ? t.economy.landValueAt(x, y) : 0.5;
        const score =
          land + streets * 0.1 + squares * 0.2 + this.rng.next() * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      });
      return best;
    }

    if (type === 'rezone' || type === 'upzone' || type === 'annex') {
      // Anchor of a zoning brush: land that is NOT already in the target
      // state (rezone/annex) or not yet upzoned, scored by how much of its
      // own 3×3 the brush would actually change.
      const target = type === 'upzone' ? null : zone;
      if (type !== 'upzone' && !target) return null;
      let best = null;
      let bestScore = -Infinity;
      g.forEach((x, y, grid) => {
        if (type === 'annex' && !edgeCell(grid, x, y)) return;
        if (!allowUnacquired && t.perimeter && !t.perimeter.isAcquired(x, y)) return;
        if (type === 'annex' && (t.buildingAt(x, y) || claimed(x, y))) return;
        if (!brushLand(grid, x, y, t)) return;
        const idx = grid.idx(x, y);
        if (target && grid.zone[idx] === target) return;
        if (!target && grid.densityAt(x, y)) return;
        let fit = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!grid.inBounds(nx, ny)) continue;
            if (!brushLand(grid, nx, ny, t)) continue;
            if (target ? grid.zone[grid.idx(nx, ny)] !== target : !grid.densityAt(nx, ny)) fit++;
          }
        }
        const score = fit + (target && !grid.zone[idx] ? 0.5 : 0) + this.rng.next() * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      });
      return best;
    }

    if (type === 'clear') {
      // CLEAR_LOT targets a building the town can spare: never a civic
      // facility (the capacity is load-bearing) and never a landmark.
      const pending = this.pendingTargets;
      let best = null;
      let bestScore = -Infinity;
      g.forEach((x, y) => {
        const b = t.buildingAt(x, y);
        if (!b) return;
        if (b.kind === 'civic') return;
        if (LANDMARKS[b.subtype]) return;
        if (pending && pending.has(b)) return;
        if (claimed(x, y)) return;
        const land = t.economy ? t.economy.landValueAt(x, y) : 0.5;
        // Shortest and plainest first — a landmark-block teardown is never
        // what "clear the lot" means.
        const score = -(b.floors || 1) * 0.2 - land * 0.1 + this.rng.next() * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      });
      return best;
    }

    // Everything else — buildings, parks, trees, lamps — builds on a FREE
    // PLOT: a buildable parcel with no building anywhere on its cells,
    // sitting on the parcel's road-facing cell. Props may also decorate the
    // rear cells of an occupied plot; construction always clears props off
    // the cell it takes.
    const isProp = type === 'prop-tree' || type === 'prop-lamp';
    const WANT = { house: ZONE.RESIDENTIAL, shop: ZONE.COMMERCIAL, office: ZONE.COMMERCIAL, civic: ZONE.CIVIC, factory: ZONE.INDUSTRIAL };
    const want = WANT[type] || (type === 'archetype' ? WANT[zone] : undefined);
    const industrial = want === ZONE.INDUSTRIAL;
    const profile = industrial ? this.industryProfile(g) : null;
    const comps = roadComponents(g);
    let best = null;
    let bestScore = -1;
    g.forEach((x, y, grid) => {
      const k = grid.kindAt(x, y);
      if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return;
      if (!allowUnacquired && t.perimeter && !t.perimeter.isAcquired(x, y)) return;
      if (t.buildingAt(x, y) || claimed(x, y)) return;
      if (t.resources?.ownsCell(x, y)) return;
      // Keep every new building type away from agricultural yards. Props and
      // public-space branches returned above do not pass through this path.
      if (!isProp && !allowAgriculturalAdjacency && agriculturalSetbackConflict(t.resources, [[x, y]])) return;
      // Industry is refused the middle of town outright (see industryEligible).
      if (industrial && !this.industryEligible(profile, x, y)) return;
      const parcel = t.parcels?.at(x, y);
      if (!parcel || !parcel.buildable) return;
      const bc = t.parcels.buildableCell(parcel);
      const front = !!bc && bc[0] === x && bc[1] === y;
      if (isProp && type === 'prop-lamp') {
        // Lamps hug the street: the front cell of the plot only.
        if (!front || !hasNetworkAccess(grid, x, y, comps)) return;
      } else if (isProp) {
        // Trees: the street-facing cell (network-checked) or a rear cell.
        if (front && !hasNetworkAccess(grid, x, y, comps)) return;
      } else {
        // Construction: the road-facing cell of a free plot only.
        if (!front || this.plotBusy(parcel) || !hasNetworkAccess(grid, x, y, comps)) return;
      }
      const land = t.economy ? t.economy.landValueAt(x, y) : 0.5;
      const zoneBonus = want && grid.zone[grid.idx(x, y)] === want ? 0.6 : 0;
      // Phase 18 (A6) — bias toward the MAIN network. A plot fronting an
      // orphan road is legal but worse, so it scores below its main-network
      // twin; this is what stops the town from sprawling onto a component it
      // will later have to bridge back to the main network.
      const mainBonus = this.onMainNetwork(g, x, y) ? 0.25 : 0;
      // Industry inverts the weighting: outskirts beats land value.
      const landTerm = industrial ? land * 0.35 : land;
      const rim = industrial ? this.industryScore(profile, x, y) : 0;
        const acquiredBonus = t.perimeter?.isAcquired(x, y) ? 1.2 : -0.2;
        const score =
          landTerm + zoneBonus + mainBonus + rim + acquiredBonus + this.rng.next() * (isProp ? 0.5 : 0.3);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    });
    return best;
  }

  /** True when any cell of this parcel already holds a building. */
  plotBusy(parcel) {
    for (const [x, y] of parcel.cells) {
      if (this.town.buildingAt(x, y)) return true;
    }
    return false;
  }

  /**
   * An EMPTY interior cell that can become a logical street anchor. Paving it
   * gives neighbouring land a new frontage after `parcels.build` runs. One
   * test, so the ranked picker and the cheap "is there room?" probe agree.
   */
  expandCandidate(x, y) {
    const t = this.town;
    const g = t.grid;
    if (g.kindAt(x, y) !== CELL_KIND.EMPTY) return false;
    if (t.buildingAt(x, y) || t.resources?.ownsCell(x, y) || this.claims.has(`${x},${y}`)) return false;
    const parcel = t.parcels?.at(x, y);
    if (!parcel || parcel.type === 'park' || parcel.type === 'public') return false;
    // A parcel's frontage is an aggregate property. An outer block can have
    // one road-facing cell and hundreds of interior cells; treating all of it
    // as "already fronted" made the planner report no room while a whole
    // vacant hinterland remained. Keep the actual frontage cell for buildings
    // and allow a deeper free cell to be surveyed as a logical street anchor.
    const bc = t.parcels.buildableCell(parcel);
    return !bc || bc[0] !== x || bc[1] !== y;
  }

  /**
   * Whether ANY open cell could still take a new street — the feasibility
   * answer to "is there room to expand?". Early exit, no ranking: this runs
   * once per plan probe on a grid that is mostly empty land.
   */
  expandRoom() {
    const g = this.town.grid;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (this.expandCandidate(x, y)) return true;
      }
    }
    return false;
  }

  /**
   * Every EMPTY cell a new street could actually be laid to: open land within
   * `limit` steps of the existing network, through open land only.
   *
   * This exists because ranking candidates first and only then discovering the
   * link does not fit was how the town used to stop growing — and it stopped
   * for the wrong reason. The old score pushed toward the middle of the MAP,
   * which on a small grid happened to double as "just outside the built area",
   * but on a large extent it points at open country stranded past the link
   * limit where paving is impossible. All six ranked candidates failed, and the
   * town reported "no free plot and no room to expand" while sitting on
   * thousands of perfectly good cells.
   *
   * Flooding outward from the network instead makes the candidate set exactly
   * the set of cells that CAN be paved, so the ranking only ever chooses among
   * cells that work. One bounded BFS replaces a full-grid scan per candidate.
   */
  paveableCells(limit = MAX_LINK) {
    const t = this.town;
    const g = t.grid;
    const seen = new Set();
    const out = [];
    const queue = [];
    for (const [x, y] of g.roadCells()) {
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!g.inBounds(nx, ny) || g.kindAt(nx, ny) !== CELL_KIND.EMPTY) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, ny, 1]);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const [x, y, d] = queue[head];
      out.push([x, y]);
      if (d >= limit) continue;
      for (const dd of DIRS) {
        const nx = x + dd.dx;
        const ny = y + dd.dy;
        if (!g.inBounds(nx, ny) || g.kindAt(nx, ny) !== CELL_KIND.EMPTY) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, ny, d + 1]);
      }
    }
    return out;
  }

  /**
   * Expansion candidates: EMPTY interior cells in vacant land — paving one
   * of them gives the neighbouring cells a street, which turns them into
   * useful plots after `parcels.build` runs. Ranked by how far they push the
   * built area outward, so the town grows from its own edge rather than
   * towards an arbitrary point in the middle of the map.
   */
  findExpandCells(zone, limit = 6) {
    const t = this.town;
    const g = t.grid;
    const want = {
      house: ZONE.RESIDENTIAL,
      shop: ZONE.COMMERCIAL,
      civic: ZONE.CIVIC,
      factory: ZONE.INDUSTRIAL
    }[zone] || null;
    const reach = this.paveableCells();
    if (!reach.length) return [];

    // Outwardness is measured from the bounding box of the built network, not
    // from the middle of the grid: "far from downtown" and "far from anywhere
    // built" are the same thing only while the town fills the map.
    const built = roadBounds(g);
    const span = Math.max(1, Math.max(g.w, g.h));
    const out = [];
    for (const [x, y] of reach) {
      if (!this.expandCandidate(x, y)) continue;
      let score = 1;
      if (want && g.zone[g.idx(x, y)] === want) score += 0.5;
      // Phase 18 (A6) — a new street is worth more where it can reach the
      // MAIN network, so expansion does not itself create a second component.
      if (this.onMainNetwork(g, x, y)) score += 0.4;
      score += Math.min(frontierDepth(x, y, built), MAX_LINK) / span;
      score += this.rng.next() * 0.25;
      out.push({ x, y, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, Math.max(1, limit));
  }

  /**
   * Project a road link on the in-memory grid and ask the real footprint
   * survey whether it unlocks the requested plan. This is deliberately a
   * grid/parcels overlay rather than `town.expandTown()`: no renderer,
   * resource rebuild, treasury charge, or permanent road is touched while the
   * council is surveying alternatives.
   */
  projectExpansion(plan, cells) {
    if (!plan || !cells?.length) return null;
    const t = this.town;
    const g = t.grid;
    const kind = g.kind.slice();
    const zone = g.zone.slice();
    const owner = g.owner.slice();
    const rngState = this.rng.getState();
    try {
      for (const [x, y] of cells) {
        if (!g.inBounds(x, y) || g.kindAt(x, y) !== CELL_KIND.EMPTY ||
            t.buildingAt(x, y) || t.resources?.ownsCell(x, y) || this.claims.has(`${x},${y}`)) return null;
        g.setKind(x, y, CELL_KIND.ROAD);
        g.zone[g.idx(x, y)] = null;
        g.owner[g.idx(x, y)] = null;
      }
      // ParcelKit is the source of truth for multi-cell frontage and vacant
      // interior land. Rebuild only that derived map for the projection.
      t.parcels.build(t, t.rng.fork(2027));
      this.rng.setState(rngState);
      const block = this.siteForFootprint({ ...plan, projection: true });
      return block ? { block } : null;
    } finally {
      g.kind.set(kind);
      g.zone.splice(0, g.zone.length, ...zone);
      g.owner.splice(0, g.owner.length, ...owner);
      g.recountKinds?.();
      t.parcels.build(t, t.rng.fork(2027));
      this.rng.setState(rngState);
    }
  }

  /**
   * The street an order with no free plot would pave: the ranked anchor plus
   * the link `planConnectedRoad` draws from it to the network. Pure — it
   * touches nothing, so a quote can price the tiles it would take.
   */
  expandPreview(zoneOrPlan) {
    const g = this.town.grid;
    const plan = zoneOrPlan && typeof zoneOrPlan === 'object' ? zoneOrPlan : null;
    const zone = plan ? (plan.zone || plan.type) : zoneOrPlan;
    const hasFootprint = !!(plan?.footprintCandidates || plan?.footprint);
    const candidates = this.findExpandCells(zone, hasFootprint ? 24 : 6);
    for (const c of candidates) {
      const cells = planConnectedRoad(g, c.x, c.y);
      if (!cells || !cells.length) continue;
      if (plan?.footprintCandidates || plan?.footprint) {
        const projected = this.projectExpansion(plan, cells);
        if (!projected) continue;
        return { anchor: [c.x, c.y], cells, block: projected.block, land: this.town.perimeter?.quote(cells) || { cells: [], cost: 0 } };
      }
      return { anchor: [c.x, c.y], cells, land: this.town.perimeter?.quote(cells) || { cells: [], cost: 0 } };
    }
    return null;
  }

  /**
   * No free plot left: paint a street into vacant land (which re-numbers
   * parcels and creates fresh frontage). Returns the anchor plus every tile
   * just paved — priced by apply() — or null when the town cannot grow here.
   * The caller re-runs its own site search afterwards, so the expansion and
   * the search it unlocks are one decision.
   */
  expandFor(zoneOrPlan) {
    const t = this.town;
    const plan = zoneOrPlan && typeof zoneOrPlan === 'object' ? zoneOrPlan : null;
    const zone = plan ? (plan.zone || plan.type) : zoneOrPlan;
    const preview = this.expandPreview(zoneOrPlan);
    if (preview) {
      const paved = t.expandTown(preview.anchor[0], preview.anchor[1], { reason: `${plan?.type || 'growth'} expansion`, chargeLand: false });
      if (paved) {
        const text = 'The town expands: a new street opens.';
        this.history.push(text);
        if (this.history.length > 8) this.history.shift();
        events.emit('log', { text });
        return { anchor: preview.anchor, cells: paved, block: preview.block || null, land: preview.land || { cells: [], cost: 0 } };
      }
    }
    // A stale preview can fail if the player or another project claimed a
    // cell between survey and execution. Re-scan the remaining candidates,
    // but only accept a route that still unlocks the requested footprint.
    const hasFootprint = !!(plan?.footprintCandidates || plan?.footprint);
    for (const c of this.findExpandCells(zone, hasFootprint ? 24 : 6)) {
      const cells = planConnectedRoad(t.grid, c.x, c.y);
      if (!cells || !cells.length) continue;
      const projected = plan ? this.projectExpansion(plan, cells) : null;
      if (plan && !projected) continue;
      const paved = t.expandTown(c.x, c.y, { reason: `${plan?.type || 'growth'} expansion`, chargeLand: false });
      if (!paved) continue;
      const text = 'The town expands: a new street opens.';
      this.history.push(text);
      if (this.history.length > 8) this.history.shift();
      events.emit('log', { text });
      return { anchor: [c.x, c.y], cells: paved, block: projected?.block || null, land: this.town.perimeter?.quote(paved) || { cells: [], cost: 0 } };
    }
    return null;
  }

  quote(plan) {
    if (this.projects.length >= MAX_ACTIVE) return { ok: false, reason: 'crew cap reached' };
    const rngState = this.rng.getState();
    const previousBlock = this.lastBlock;
    try {
      const draft = { ...plan };
      const result = this.apply(draft, true);
      return result ? { ok: true, ...result, plan: draft } : { ok: false, reason: this.lastBlock || 'no eligible site' };
    } finally {
      this.rng.setState(rngState);
      this.lastBlock = previousBlock;
    }
  }

  reserveSiteLand(plan) {
    const cells = plan?.siteLand?.cells || [];
    if (!cells.length || !this.town.perimeter) return true;
    const acquired = this.town.perimeter.acquire(cells, {
      reason: `${plan.type || 'project'} site`,
      charge: false
    });
    if (!acquired.ok) {
      this.lastBlock = acquired.reason || 'site land acquisition failed';
      return false;
    }
    plan.siteLandAdded = acquired.cells;
    return true;
  }

  releaseSiteLand(plan) {
    if (!plan?.siteLandAdded?.length) return;
    this.town.perimeter?.release(plan.siteLandAdded);
    plan.siteLandAdded = null;
  }

  projectState(projectId) { return this.projectStates.get(projectId) || null; }
  trackProject(plan, state, reason = '') {
    if (!plan?.projectId) return;
    const { account: _account, ...finance } = plan.finance || this.town.economy?.resolveProjectFinance(plan, 0) || {};
    this.projectStates.set(plan.projectId, {
      projectId: plan.projectId, state, quote: plan.quote || null,
      finance,
      reservedCells: [...(plan.cells || []), ...(plan.accessSpur || [])],
      reservedMaterials: plan.materials || {}, reason
    });
  }

  apply(plan, dryRun = false) {
    this.lastBlock = '';
    // A quoted road carries its selected cells and policy-adjusted price.
    // Rebuild the base price before check()/policy so it is adjusted once.
    if (plan?.type === 'road' && plan.roadSelection) {
      plan.cost = COST.road * plan.roadSelection.cells.length;
    }
    // Nothing gets built from an empty storehouse: construction waits on the
    // industry that produces its materials (same for an empty treasury).
    const why = this.check(plan);
    if (why) {
      this.lastBlock = why;
      return false;
    }

    const needsCell = !NO_SITE.has(plan.type);
    // Named civic facilities have a non-negotiable campus minimum. They may
    // expand the street once to reach a new parcel, but they must never fall
    // back to a one-cell shell when the horizontal lot is unavailable: that
    // silently defeated the catalogue footprint and left clinics/colleges
    // undersized in long runs.
    const strictCivicFootprint = plan.type === 'civic' && !!plan.facility &&
      !!plan.footprint && plan.footprint.cols * plan.footprint.rows > 1;
    // Factories are industrial campuses. Once the candidate list has been
    // upgraded to 3x3+, silently falling back to a one-cell shell would undo
    // both the visual contract and the area/floor occupancy model.
    const strictFactoryFootprint = plan.type === 'factory' &&
      ((plan.footprint && plan.footprint.cols * plan.footprint.rows > 1) ||
        (plan.footprintCandidates && plan.footprintCandidates.some((e) => {
          const [cols, rows] = Array.isArray(e) ? e : [e.cols, e.rows];
          return cols * rows > 1;
        })));
    const strictFootprint = strictCivicFootprint || strictFactoryFootprint;
    let cell = null;
    let block = null;
    if (needsCell && (plan.footprintCandidates || plan.footprint)) {
      // The chooser decides the lot size AND the site together.
      block = this.siteForFootprint(plan);
      if (block) cell = block.cell;
      if (!strictFootprint && !block && plan.footprintCandidates && plan.footprintCandidates.some((e) => {
        // Candidates are EITHER [cols, rows] or a rich {cols, rows, tier}
        // object (shops, growth:681). Destructuring an object as an array gives
        // undefined/undefined, so the old `([c, r]) => c * r === 1` test could
        // never be true for a rich candidate — which silently disabled this
        // fallback for shops, the most common footprint plan in the game. Read
        // the area the same polymorphic way siteForFootprint does.
        const [c, r] = Array.isArray(e) ? e : [e.cols, e.rows];
        return c * r === 1;
      })) {
        // No block worked: fall back to the classic single-cell search (with
        // street expansion), which only 1x1 candidates can use.
        cell = this.findCell(plan.type, plan.zone, { allowUnacquired: true });
        if (cell) plan.footprint = null;
      }
    } else if (plan.type === 'road') {
      const selected = plan.roadSelection || this.selectRoadExtension();
      if (selected && this.roadSelectionValid(selected)) {
        plan.roadSelection = selected;
        cell = selected.cells[0];
      } else if (plan.roadSelection) {
        this.lastBlock = 'selected street is no longer available';
        return false;
      }
    } else if (needsCell) {
      cell = this.findCell(plan.type, plan.zone);
      // No free plot: the town expands with a new street, then we retry once.
      // Footways never trigger street expansion — they have their own chain.
    }
    if (needsCell && !cell) {
      // Surface works have their own refusal wording — "no free plot to
      // expand" is not what a missing kerb or square says.
      const refuse = () => {
        this.lastBlock =
          plan.type === 'plaza'
            ? 'no free cell left to pave a civic square'
            : plan.type === 'parking'
              ? 'no kerbside cell left to mark for parking'
              : plan.type === 'road'
                ? 'no eligible street extension'
                : 'no free plot and no room to expand';
        return false;
      };
      // The expansion the note above promises, for every order that is not
      // its own surface work (NO_EXPAND): pave a street into open land —
      // which turns the tiles it passes into free plots — then search again.
      // A dry run cannot pave, so it only prices the tiles the real run will
      // take; both passes rank the candidates from the same RNG state, so
      // the quote and the charge agree.
      // With a perimeter ledger, a missing serviced lot is a land decision,
      // not permission to pave an arbitrary street as a side effect of a
      // house/factory order. EXTEND_STREET is its own measured-demand action;
      // only a caller that explicitly opts into a coupled street may use the
      // legacy expansion path.
      if (NO_EXPAND.has(plan.type) || (this.town.perimeter && !plan.allowStreetExpansion)) return refuse();
      let paved = null;
      if (dryRun) {
        const preview = this.expandPreview(plan);
        if (!preview) return refuse();
        paved = preview.cells;
        plan.landCost = preview.land?.cost || 0;
        if (preview.block) {
          block = preview.block;
          cell = block.cell;
        }
      } else {
        const expanded = this.expandFor(plan);
        if (!expanded) return refuse();
        paved = expanded.cells;
        plan.landCost = expanded.land?.cost || 0;
        if (expanded.block) {
          block = expanded.block;
          cell = block.cell;
        }
        if (plan.footprintCandidates || plan.footprint) {
          block ||= this.siteForFootprint({ ...plan, projection: true });
          if (block) cell = block.cell;
        }
        if (strictFootprint && !cell) return refuse();
        if (!cell) {
          cell = this.findCell(plan.type, plan.zone, { allowUnacquired: true });
          if (cell) plan.footprint = null;
        }
        if (!cell) return refuse();
      }
      plan.expansion = paved;
      plan.cost = (plan.cost || 0) + COST.road * paved.length + (plan.landCost || 0);
    }

    // EXTEND_STREET prices the exact selected cells. The anchor touches the
    // main network, so paintRoad cannot add an unquoted auto-link.
    if (plan.type === 'road' && cell) {
      const run = plan.roadSelection;
      plan.cells = run.cells.map((c) => c.slice());
      plan.roadTiles = run.cells.length;
      plan.roadJoins = !!run.joins;
      plan.roadReason = run.reason;
      plan.cost = COST.road * run.cells.length;
    }

    // Phase 18 (A5) — a district is commissioned here and BUILT by the crews
    // in walkDistrictQueue. The commission itself costs only the first step's
    // survey money; the queue carries the rest, and each step is charged
    // exactly as a one-off order would be.
    if (plan.type === 'district') {
      if (dryRun) return { status: 'quoted', quote: { finalCost: plan.cost || 0, buildHours: 0 }, estimatedScope: true };
      this.districtQueue = {
        id: `district-${(this.built.district || 0) + 1}`,
        steps: (plan.queue || []).flatMap((s) => Array.from({ length: s.count || 1 }, () => ({ ...s, count: 1, cost: (s.cost || 0) / (s.count || 1) }))),
        commissioned: plan.label,
        estimatedCost: plan.cost,
        actualSpend: 0,
        built: 0,
        dropped: 0
      };
      this.built.district = (this.built.district || 0) + 1;
      const text = `${plan.label}. The crews will work through it.`;
      this.history.push(text);
      if (this.history.length > 8) this.history.shift();
      events.emit('log', { text });
      return { status: 'queued', steps: this.districtQueue.steps.length, estimatedCost: plan.cost, actualSpend: 0 };
    }

    // Size decided → real cost + materials follow it (the upfront check used
    // the smallest candidate), then re-verify before charging anything.
    if (block) {
      plan.cells = block.cells;
      plan.footprint = block.footprint;
      // Commerce rung chosen with the lot: carry its identity, price and draw.
      if (block.tier) {
        plan.tier = block.tier;
        if (block.capacity) plan.capacity = block.capacity;
        const rg = SHOP_TIERS[block.tier];
        if (rg) plan.label = `A ${rg.label} opens to serve the town`;
      }
      const area = block.footprint.cols * block.footprint.rows;
      const cc = block.cellCost != null ? block.cellCost : plan.cellCost;
      // A shared construction block carries a frozen bill of quantities. The
      // generic archetype fallback is still repriced from its chosen lot, but
      // an explicit block must keep the same quote through project start.
      if (!plan.blockId && cc) plan.cost = Math.round(cc * area) + (plan.flatFee || 0);
      if (!plan.blockId && plan.matPerCell) plan.materials = scaleMats(plan.matPerCell, area);
      const blockMaterialsReady = !plan.materials || !this.town.industry ||
        this.town.industry.canAfford(plan.materials) ||
        (plan.type === 'factory' && plan.bootstrapMaterials && this.town.industry.canBootstrapMaterials(plan.materials, plan.bootstrapProduct)) ||
        (plan.allowMaterialImports && this.town.industry.canImportMaterials(plan.materials));
      if (plan.materials && this.town.industry && !blockMaterialsReady) {
        this.lastBlock = `short on ${this.town.industry.shortfall(plan.materials)}`;
        return false;
      }
    }

    // Multi-plot acquisition: price the occupants, re-check the budget with
    // the block included, then buy + clear it before construction starts.
    if (block && plan.acquire) {
      const occupants = [...new Set(block.cells.map(([x, y]) => this.town.buildingAt(x, y)).filter(Boolean))];
      const quote = this.town.economy?.acquisitionQuote(occupants, plan);
      if (quote && !quote.ok) {
        this.lastBlock = quote.reason;
        return false;
      }
      const acq = quote?.total || 0;
      const total = plan.cost + acq;
      plan.cost = total;
      plan.acquisitionQuote = quote;
    }

    // A build site is land too. Only exact acquired cells may be commissioned;
    // a new frontier lot is quoted here and reserved immediately before the
    // project runs, so land purchase appears as a charged Council decision.
    if (needsCell && plan.type !== 'road' && !NO_SITE.has(plan.type) && this.town.perimeter) {
      const siteCells = plan.cells?.length ? plan.cells : (cell ? [cell] : []);
      const siteLand = this.town.perimeter.quote(siteCells);
      plan.siteLand = siteLand;
      plan.cost = (plan.cost || 0) + siteLand.cost;
    }

    // Phase 18 (A6) — the access road, priced into the plan and laid before
    // the work starts. Every off-network BUILD reaches the network through the
    // same `spurPath` the resource sites use, so there are no hand-placed
    // access stubs left in the town.
    //
    // Only for plans that actually SITE a building. A no-site plan carries its
    // cells for another reason — a wing's strip is ANNEXED to the building, a
    // rezone's brush is painted, a plaza's cells are paved — and running a road
    // through those would take the very land the order was about.
    // EXTEND_STREET is the mirror image: it PAVES roads, and paintRoad() links
    // them to the network itself, so a spur here would be paid for twice.
    //
    // `NO_EXPAND` applies here too, not just on the street-expansion path. It
    // used to guard only the branch that paves a new street, so a FOOTWAY order
    // whose anchor had no frontage still bought an access spur priced at
    // `COST.road` per tile: quoted at 2,600 for a 600 footway, with 2,000 of it
    // being one road tile, and one order charged 12,600 for a footway because it
    // bought six. Worse than the price, `commitSpur` lays that road BEFORE the
    // footway is painted, so `planFootway` then finds the anchor already fronting
    // a carriageway and degenerates to a one-cell stub — the council pays for a
    // footway, gets a stub, and the street it was meant to reach is tarmac.
    if (needsCell && plan.type !== 'road' && !NO_EXPAND.has(plan.type)) {
      const landCells = plan.cells || (cell ? [cell] : []);
      const access = this.planConnectedRoad(landCells);
      if (access.needed && access.spur) {
        plan.accessSpur = access.spur;
        plan.cost = (plan.cost || 0) + access.cost;
        plan.access = access.spur.length;
      } else if (access.needed && !access.spur) {
        // No route to the network at all: refuse rather than build something
        // the town cannot reach.
        this.lastBlock = 'no route to the road network';
        return false;
      }
    }

    // Phase 17 — a law or scheme with `buildCost` / `buildHours` is a discount
    // or a surcharge on every commission, applied ONCE here, after the lot is
    // priced and the acquire priced, so the budget re-check above and the
    // charge below both see the same figure.
    const costLift = 1 + (this.policyCost || 0);
    const hourLift = 1 + (this.policyHours || 0);
    const prePolicyCost = plan.cost || 0;
    if (costLift !== 1 && plan.cost && plan.charge !== false) {
      plan.cost = Math.round(plan.cost * costLift);
    }
    if (hourLift !== 1) {
      const raw = plan.hours ?? BUILD_HOURS[plan.type] ?? 0;
      plan.hours = Math.max(0, Math.round(raw * hourLift * 10) / 10);
    }

    const finalFinance = this.town.economy?.resolveProjectFinance(plan, plan.type === 'utility' ? 5000 : UTILITY_RESERVE);
    if (finalFinance && !finalFinance.affordable) {
      this.lastBlock = `over budget — ${finalFinance.financierSector} needs ${finalFinance.requiredCash} on hand`;
      return false;
    }
    plan.quote = { baseConstruction: prePolicyCost - (plan.acquisitionQuote?.total || 0) - (plan.accessSpur?.length || 0) * COST.road,
      footprintCost: block?.cellCost ? block.cellCost * block.footprint.cols * block.footprint.rows : 0,
      acquisitionCost: plan.acquisitionQuote?.total || 0, accessCost: (plan.accessSpur?.length || 0) * COST.road,
      demolitionCost: (plan.acquisitionQuote?.items || []).reduce((n, item) => n + (item.demolitionCost || 0), 0),
      relocationCost: (plan.acquisitionQuote?.items || []).reduce((n, item) => n + (item.relocationCost || 0), 0),
      policyAdjustment: (plan.cost || 0) - prePolicyCost,
      materials: plan.materials || {}, buildHours: plan.hours ?? BUILD_HOURS[plan.type] ?? 0, finalCost: plan.cost || 0 };
    plan.finance = finalFinance;
    if (dryRun) return { status: 'quoted', quote: plan.quote, finance: finalFinance, cell };

    const hours = plan.hours ?? BUILD_HOURS[plan.type] ?? 0;
    if (hours > 0) return this.startProject(plan, cell);

    plan.projectId ||= this.town.economy?.nextId('project');
    this.trackProject(plan, 'VALIDATED');
    const funded = this.town.economy?.fundProject(plan) || { ok: true };
    if (!funded.ok) { this.lastBlock = funded.reason; this.trackProject(plan, 'BLOCKED', funded.reason); return false; }
    if (plan.type === 'factory' && plan.bootstrapMaterials && this.town.industry && !this.town.industry.canAfford(plan.materials)) {
      const seeded = this.town.industry.bootstrapMaterials(plan.materials, plan.bootstrapProduct);
      if (!seeded.ok) {
        this.town.economy?.refundProject(plan);
        this.lastBlock = seeded.reason || 'factory-bootstrap-failed';
        this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
        return false;
      }
    }
    if (plan.allowMaterialImports && this.town.industry && !this.town.industry.canAfford(plan.materials)) {
      const imported = this.town.industry.importMaterials(plan.materials);
      if (!imported.ok) {
        this.town.economy?.refundProject(plan);
        this.lastBlock = imported.reason || 'construction-import-failed';
        this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
        return false;
      }
    }
    if (plan.materials && this.town.industry && !this.town.industry.take(plan.materials)) {
      this.town.economy?.refundProject(plan);
      // `take` is atomic now, so a `false` means NOTHING was drawn and there is
      // nothing to return. This call is the belt-and-braces for the case where
      // that stops being true: refunding unconditionally would be wrong, so it
      // is only reached on a failed take, which by contract has moved no
      // material. The executor-failure path at 3598 DOES refund, because by then
      // the take has succeeded.
      this.lastBlock = 'inventory_shortage';
      this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
      return false;
    }
    const worldBeforeRun = snapshotProjectWorld(this.town);
    if (!this.reserveSiteLand(plan)) {
      this.town.economy?.refundProject(plan);
      if (plan.materials && this.town.industry) this.town.industry.refund(plan.materials);
      this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
      return false;
    }
    let ok = false;
    try { this.commitSpur(plan); ok = !!plan.run(cell, plan.target, plan); }
    catch (error) { this.lastBlock = error?.message || 'project_execution_failed'; }
    if (!ok) {
      // An executor that returns falsy WITHOUT throwing is still a failure, and
      // `lastBlock` is still `''` at this point. It is the field `quote()` reads
      // for `reason` and the field `governance` falls back on when it tells the
      // player why an order failed — so leaving it empty made every
      // site-vs-executor fault read as "no free plot and no room to expand",
      // which is a land shortage and nothing of the sort. Set the reason on the
      // field itself, not just in the call below.
      this.lastBlock = this.lastBlock || 'executor_failed';
      restoreProjectWorld(this.town, worldBeforeRun);
      this.releaseSiteLand(plan);
      this.town.economy?.refundProject(plan);
      if (plan.materials && this.town.industry) this.town.industry.refund(plan.materials);
      this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
      return false;
    }
    this.trackProject(plan, 'COMPLETED');
    if (plan.type === 'tierup') this.metrics.tierUps++;
    if (plan.type === 'upgrade') this.metrics.floorUpgrades++;
    if (plan.type === 'wing') this.metrics.wings++;
    this.built[plan.type] = (this.built[plan.type] || 0) + 1;
    const place = cell ? ` at ${cell[0]}, ${cell[1]}` : '';
    const text = `${plan.label}${place}.`;
    this.history.push(text);
    if (this.history.length > 8) this.history.shift();
    events.emit('log', { text });
    return { status: 'instant' };
  }

  /** Charge for and queue a construction; it completes in tickProjects. */
  startProject(plan, cell) {
    const hours = plan.hours ?? BUILD_HOURS[plan.type] ?? 0;
    // Claim every cell of a footprint block so nothing else takes a plot
    // mid-build (single-cell plans claim their one cell, as before).
    const claimCells = [...(plan.cells || (cell ? [cell] : [])), ...(plan.accessSpur || [])];
    for (const [cx, cy] of claimCells) this.claims.add(`${cx},${cy}`);
    if (plan.target) this.pendingTargets.add(plan.target);
    plan.projectId ||= this.town.economy?.nextId('project');
    this.trackProject(plan, 'VALIDATED');
    const funded = this.town.economy?.fundProject(plan) || { ok: true };
    if (!funded.ok) {
      for (const [cx, cy] of claimCells) this.claims.delete(`${cx},${cy}`);
      if (plan.target) this.pendingTargets.delete(plan.target);
      this.lastBlock = funded.reason;
      this.trackProject(plan, 'BLOCKED', funded.reason);
      return false;
    }
    if (plan.type === 'factory' && plan.bootstrapMaterials && this.town.industry && !this.town.industry.canAfford(plan.materials)) {
      const seeded = this.town.industry.bootstrapMaterials(plan.materials, plan.bootstrapProduct);
      if (!seeded.ok) {
        this.town.economy?.refundProject(plan);
        for (const [cx, cy] of claimCells) this.claims.delete(`${cx},${cy}`);
        if (plan.target) this.pendingTargets.delete(plan.target);
        this.lastBlock = seeded.reason || 'factory-bootstrap-failed';
        this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
        return false;
      }
    }
    if (plan.allowMaterialImports && this.town.industry && !this.town.industry.canAfford(plan.materials)) {
      const imported = this.town.industry.importMaterials(plan.materials);
      if (!imported.ok) {
        this.town.economy?.refundProject(plan);
        for (const [cx, cy] of claimCells) this.claims.delete(`${cx},${cy}`);
        if (plan.target) this.pendingTargets.delete(plan.target);
        this.lastBlock = imported.reason || 'construction-import-failed';
        this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
        return false;
      }
    }
    if (plan.materials && this.town.industry && !this.town.industry.take(plan.materials)) {
      this.town.economy?.refundProject(plan);
      for (const [cx, cy] of claimCells) this.claims.delete(`${cx},${cy}`);
      if (plan.target) this.pendingTargets.delete(plan.target);
      this.lastBlock = 'inventory_shortage';
      this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
      return false;
    }
    const beforeSpur = snapshotProjectWorld(this.town);
    try {
      this.commitSpur(plan);
      if (!this.reserveSiteLand(plan)) throw new Error(this.lastBlock || 'site land acquisition failed');
    }
    catch (error) {
      restoreProjectWorld(this.town, beforeSpur);
      this.releaseSiteLand(plan);
      this.town.economy?.refundProject(plan);
      if (plan.materials && this.town.industry) this.town.industry.refund(plan.materials);
      for (const [cx, cy] of claimCells) this.claims.delete(`${cx},${cy}`);
      if (plan.target) this.pendingTargets.delete(plan.target);
      this.lastBlock = error?.message || 'access_commit_failed';
      this.trackProject(plan, 'FAILED_ROLLED_BACK', this.lastBlock);
      return false;
    }
    this.trackProject(plan, 'UNDER_CONSTRUCTION');
    this.built[plan.type] = (this.built[plan.type] || 0) + 1;
    const site = cell || (plan.target && plan.target.cell) || null;
    if (site) this.showSite(site[0], site[1]);
    // Re-render statics so planned-parking stripes clear off the claimed cell.
    if (cell) this.town.rebuildStatic();
    this.projects.push({
      plan,
      cell,
      site,
      target: plan.target || null,
      remaining: hours * 60 * SIM.secondsPerGameMinute,
      hours
    });
    const place = cell ? ` at ${cell[0]}, ${cell[1]}` : '';
    const text = `${plan.label}${place} — ${hours}h build.`;
    this.history.push(text);
    if (this.history.length > 8) this.history.shift();
    events.emit('log', { text });
    return { status: 'started', hours };
  }

  stats() {
    const s = this.inputs();
    const active = this.projects.length;
    const next = active
      ? Math.max(1, Math.ceil(Math.min(...this.projects.map((p) => p.remaining)) / (60 * SIM.secondsPerGameMinute)))
      : 0;
    const q = this.districtQueue;
    return {
      enabled: this.enabled,
      developer: this.developer,
      developerBuilt: this.developerBuilt || 0,
      built: { ...this.built },
      total: Object.values(this.built).reduce((a, b) => a + b, 0),
      active,
      next,
      pressure: Math.round(s.pressure * 100) / 100,
      capacity: s.capacity,
      pop: s.pop,
      // Phase 18 — the district in progress and the town's connectivity.
      district: q
        ? {
            stepsLeft: q.steps.length,
            built: q.built || 0,
            dropped: q.dropped || 0,
            pending: q.pending || 0,
            estimatedCost: q.estimatedCost || 0,
            actualSpend: q.actualSpend || 0,
            droppedSteps: q.droppedSteps || [],
            next: q.steps.length ? q.steps[0].what : null,
            commission: q.commissioned
          }
        : this.lastDistrict ? { ...this.lastDistrict, stepsLeft: 0, next: null } : null,
      connectivity: this.connectivity(),
      history: this.history.slice(-4)
    };
  }
}
