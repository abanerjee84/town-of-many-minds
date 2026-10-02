import * as THREE from 'three';
import { CELL, CELL_KIND, ZONE, PALETTE, HOUSEHOLD, MAX_FLOORS, FOUNDING_POPULATION, FOUNDING_CORE, FOUNDING_MAX_FLOORS } from '../core/config.js';
import { ROAD_FEATURE } from '../core/grid.js';
import { makeRng } from '../core/rng.js';
import { buildHouse } from '../kits/houses/houseKit.js';
import { jitterColor, merge } from '../kits/geometry.js';
import { sharedLampGlow } from '../kits/glow.js';
import { straightAxis } from '../kits/roads/components.js';
import {
  buildTree, buildPine, buildBush, buildLamp, buildFence, buildMailbox,
  buildBench, buildHydrant, buildTrashBin, buildFountain, buildSwingSet,
  buildPlayStructure
} from '../kits/props/propKit.js';
import { CIVIC_ORDER, civicParams, civicFacility, CIVIC_CAPACITY_KIND, CIVIC_CATALOGUE } from '../kits/civic/civicKit.js';
import { constructionBlock } from '../kits/constructionBlocks.js';
import { planPublicSpaces, renderPublicSpaces } from '../kits/publicspace/publicKit.js';
import { runTownPipeline, pipelineSummary } from './pipeline.js';
import { events } from '../core/events.js';
import { FACTORY_TYPES } from '../simulation/industry.js';
import { ParkingRegistry, PARKING_KIND } from './parking.js';
import { validateTown, BASIC_CIVIC } from './validator.js';
import {
  planCore, layoutStreets, zoneBlocks, ensureRoadConnectivity, isAdjacentToRoad,
  roadComponents, hasNetworkAccess
} from './placementController.js';

export const LOT_PAD_H = 0.14;
const MAX_BUILDINGS = 96;

const SHOP_NAMES = [
  'Linden Bakery', 'Corner Market', 'Cafe Meridian', 'The Iron Kettle', 'Blue Door Books',
  'Nakamura Noodles', 'Petal & Stem', 'Second Hand Sam', 'Copper Kettle Deli', 'Volt Repairs',
  'Sunrise Diner', 'Maple Grocers', 'Tiny Anvils', 'The Wandering Spoon', 'Harbour Fish Co.',
  'Gryphon Games', 'Paper Moon', 'Fern & Fig', 'Red Cycle Works', 'Hollow Lantern'
];

/** Phase 20 (C3b) — the office block's tenants, named like the shops. */
const OFFICE_NAMES = [
  'Hollis & Vane', 'Meridian Assurance', 'The Counting House', 'Ashgrove Partners',
  'Saltmarsh & Co.', 'Blackwell Registry', 'Wren Legal', 'The Drafting Office',
  'Corvid Analytics', 'Thistle & Thorn', 'Lamplight Chambers', 'Orchard Row',
  'Sable Consulting', 'Fairweather & Sons', 'The Vestry', 'Kestrel Data'
];


/**
 * A per-cell RNG whose key is POSITIONAL, so a cell's result depends on nothing
 * but its coordinates and the seed — not on iteration order, and not on how many
 * times the town has been rebuilt. That property is what lets the whole lot layer
 * survive a re-lay.
 *
 * It is also why the parent stream can be cached: `town.seed` is fixed for the
 * town's lifetime, so `(x, y, salt)` can only ever name one stream. Without the
 * cache, every cell of every rebuild built a template, hashed it, and allocated
 * an object carrying twelve closures — about 23 k closures per `layoutLots`
 * across 1,920 cells, to produce values that were then discarded.
 *
 * The cache holds the PARENT, which is never itself consumed; callers get a
 * fresh `fork()` of it. Forking from an unconsumed parent is stable, so the
 * same cell yields the same values on every rebuild — which is the whole point.
 */
const cellRngCache = { seed: null, map: new Map() };
function cellRng(town, x, y, salt = 0) {
  if (cellRngCache.seed !== town.seed) {
    cellRngCache.seed = town.seed;
    cellRngCache.map = new Map();
  }
  const key = `${x}|${y}|${salt}`;
  let parent = cellRngCache.map.get(key);
  if (!parent) {
    parent = makeRng(`${town.seed}|${x}|${y}|${salt}`);
    cellRngCache.map.set(key, parent);
  }
  return parent.fork();
}

function facingToRoad(g, x, y, cells = null) {
  // Multi-cell footprints face the road side with the most frontage; ties keep
  // the original per-direction preference so single-cell builds are unchanged.
  if (cells && cells.length > 1) {
    const tally = new Map();
    for (const [cx, cy] of cells) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (g.isRoad(cx + dx, cy + dy)) tally.set(`${dx},${dy}`, (tally.get(`${dx},${dy}`) || 0) + 1);
      }
    }
    if (tally.size) {
      let best = null;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const n = tally.get(`${dx},${dy}`) || 0;
        if (n && (!best || n > best.n)) best = { x: dx, z: dy, n };
      }
      if (best) return { x: best.x, z: best.z };
    }
    return { x: 0, z: 1 };
  }
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (g.isRoad(x + dx, y + dy)) return { x: dx, z: dy };
  }
  return { x: 0, z: 1 };
}

function roadRowInfo(g, y) {
  let road = 0;
  let vertical = 0;
  for (let x = 1; x <= g.w - 2; x++) {
    if (!g.isRoad(x, y)) continue;
    road++;
    if (g.isRoad(x, y - 1) && g.isRoad(x, y + 1)) vertical++;
  }
  return { road, vertical };
}

function pickRiverRow(g) {
  let best = -1;
  let bestScore = Infinity;
  const mid = g.h * 0.45;
  for (let y = 3; y <= g.h - 4; y++) {
    const { road, vertical } = roadRowInfo(g, y);
    if (road < 2 || vertical !== road) continue;
    if (road > Math.max(4, g.w / 6)) continue;
    const score = Math.abs(y - mid) + (road > 5 ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = y;
    }
  }
  return best;
}

function isStraightCell(g, x, y, axis) {
  if (!g.isRoad(x, y)) return false;
  if (g.roadDegree(x, y) !== 2) return false;
  return straightAxis(g.roadAt(x, y)) === axis;
}

function pickRoundabout(g, reserved) {
  const cx = g.w / 2;
  const cy = g.h / 2;
  let best = null;
  let bestD = Infinity;
  g.forEach((x, y) => {
    if (reserved.has(y * g.w + x)) return;
    if (!g.isRoad(x, y)) return;
    if (g.roadDegree(x, y) !== 4) return;
    if (straightAxis(g.roadAt(x, y))) return;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) {
      bestD = d;
      best = [x, y];
    }
  });
  return best;
}

function pickTunnel(g, riverRow, reserved) {
  const cx = g.w / 2;
  const cy = g.h / 2;
  let best = null;
  let bestD = Infinity;
  g.forEach((x, y) => {
    if (!g.isRoad(x, y)) return;
    if (g.roadDegree(x, y) !== 2) return;
    const axis = straightAxis(g.roadAt(x, y));
    if (!axis) return;
    const [dx, dy] = axis === 'z' ? [0, 1] : [1, 0];
    const seq = [[x, y], [x + dx, y + dy], [x + 2 * dx, y + 2 * dy], [x - dx, y - dy]];
    for (const [ax, ay] of seq) {
      if (ax < 2 || ay < 2 || ax > g.w - 3 || ay > g.h - 3) return;
      if (riverRow >= 0 && Math.abs(ay - riverRow) <= 1) return;
      if (reserved.has(ay * g.w + ax)) return;
      if (!isStraightCell(g, ax, ay, axis)) return;
    }
    const mx = x + dx * 0.5;
    const my = y + dy * 0.5;
    const d = Math.hypot(mx - cx, my - cy);
    if (d < bestD) {
      bestD = d;
      best = { cells: [[x, y], [x + dx, y + dy]] };
    }
  });
  return best;
}

function pickDeadEnd(g, riverRow, reserved) {
  const cands = [];
  g.forEach((x, y) => {
    if (reserved.has(y * g.w + x)) return;
    if (riverRow >= 0 && Math.abs(y - riverRow) <= 1) return;
    if (!g.isRoad(x, y)) return;
    if (g.roadDegree(x, y) !== 2) return;
    const axis = straightAxis(g.roadAt(x, y));
    if (!axis) return;
    const lats = axis === 'z' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dy] of lats) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 2 || ny < 2 || nx > g.w - 3 || ny > g.h - 3) continue;
      if (g.kindAt(nx, ny) !== CELL_KIND.EMPTY) continue;
      let free = true;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (ax === -dx && ay === -dy) continue;
        if (g.isRoad(nx + ax, ny + ay)) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      if (Math.hypot(nx - g.w / 2, ny - g.h / 2) < 5) continue;
      cands.push([nx, ny]);
    }
  });
  if (!cands.length) return null;
  return cands[Math.floor(cands.length / 2)];
}

function planRoadFeatures(g, rng) {
  g.clearFeatures();
  const reserved = new Set();
  const key = (x, y) => y * g.w + x;
  const blocks = [];

  const riverRow = pickRiverRow(g);
  if (riverRow >= 0) {
    for (let x = 0; x < g.w; x++) {
      const idx = g.idx(x, riverRow);
      if (x >= 1 && x <= g.w - 2 && g.isRoad(x, riverRow)) {
        g.setFeature(x, riverRow, ROAD_FEATURE.BRIDGE);
        reserved.add(key(x, riverRow));
        blocks.push(`${x},${riverRow}:bridge`);
      } else {
        g.setKind(x, riverRow, CELL_KIND.WATER);
        g.zone[idx] = null;
        g.owner[idx] = null;
      }
    }
  }

  const roundabout = pickRoundabout(g, reserved);
  if (roundabout) {
    g.setFeature(roundabout[0], roundabout[1], ROAD_FEATURE.ROUNDABOUT);
    reserved.add(key(roundabout[0], roundabout[1]));
    blocks.push(`${roundabout[0]},${roundabout[1]}:roundabout`);
  }

  const tunnel = pickTunnel(g, riverRow, reserved);
  if (tunnel) {
    for (const [x, y] of tunnel.cells) {
      g.setFeature(x, y, ROAD_FEATURE.TUNNEL);
      reserved.add(key(x, y));
      blocks.push(`${x},${y}:tunnel`);
    }
  }

  const deadEnd = pickDeadEnd(g, riverRow, reserved);
  if (deadEnd) {
    g.setKind(deadEnd[0], deadEnd[1], CELL_KIND.ROAD);
    g.setFeature(deadEnd[0], deadEnd[1], ROAD_FEATURE.DEAD_END);
    reserved.add(key(deadEnd[0], deadEnd[1]));
    blocks.push(`${deadEnd[0]},${deadEnd[1]}:deadend`);
  }

  return { riverRow, blocks };
}

function placeCivic(town, rng) {
  const g = town.grid;
  town.civicNames = new Map();
  town.civicIndex = new Map();

  const cands = [];
  g.forEach((x, y, grid) => {
    if (grid.kindAt(x, y) !== CELL_KIND.EMPTY) return;
    if (grid.zone[grid.idx(x, y)] !== ZONE.CIVIC) return;
    if (!isAdjacentToRoad(grid, x, y)) return;
    cands.push([x, y]);
  });
  cands.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const taken = [];
  for (const id of BASIC_CIVIC) {
    const facility = civicFacility(id);
    let best = null;
    for (const c of cands) {
      if (taken.some((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) < 3)) continue;
      best = c;
      break;
    }
    if (!best) continue;
    taken.push(best);
    g.zone[g.idx(best[0], best[1])] = ZONE.CIVIC;
    town.civicNames.set(g.idx(best[0], best[1]), facility.label);
    town.civicIndex.set(g.idx(best[0], best[1]), id);
  }

  const anchor = taken[0];
  if (anchor) {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nx = anchor[0] + dx;
      const ny = anchor[1] + dy;
      if (g.inBounds(nx, ny) && g.kindAt(nx, ny) === CELL_KIND.EMPTY && !g.isRoad(nx, ny)) {
        g.setKind(nx, ny, CELL_KIND.PLAZA);
        break;
      }
    }
  }
}

/**
 * Off-street bay for a house.
 *
 * Side drive: the house is hugged against one edge of its lot, leaving a strip
 * the width of a car along the other edge, reached straight from the kerb.
 * Garage forecourt: the house is set back far enough that the strip in front of
 * the garage door holds a car parked parallel to the street.
 *
 * Returns cell-local offsets (world X/Z) so the lot renderer can draw pads and
 * the parking registry can hand the space to a vehicle.
 */
function planDriveway(town, x, y, face, size, setback, garage, r) {
  const p = town.grid.cellToWorld(x, y);
  const lat = { x: -face.z, z: face.x };
  const alongX = Math.abs(face.x) === 1;
  const front = CELL / 2 - setback;
  const w = size.w;
  let padFace, padLat, faceCenter, latCenter, bayFace, bayLat, yaw, houseLat;

  if (garage) {
    padFace = CELL / 2 - front - 0.05;
    faceCenter = front + padFace / 2;
    padLat = Math.min(3.6, CELL - 0.5);
    latCenter = 0;
    bayFace = faceCenter;
    bayLat = 0;
    yaw = Math.atan2(lat.x, lat.z);
    houseLat = 0;
  } else {
    const side = r.chance(0.5) ? 1 : -1;
    padFace = CELL - 0.1;
    faceCenter = 0;
    padLat = 3.94 - w;
    latCenter = side * (0.06 + w) / 2;
    houseLat = -side * (1.94 - w / 2);
    bayFace = 0;
    bayLat = latCenter;
    yaw = Math.atan2(-face.x, -face.z);
  }

  const entryFace = CELL / 2 - 0.1;
  const entryLat = garage ? -1.15 : latCenter;
  const padW = alongX ? padFace : padLat;
  const padD = alongX ? padLat : padFace;
  const cx = p.x + face.x * faceCenter + lat.x * latCenter;
  const cz = p.z + face.z * faceCenter + lat.z * latCenter;
  const bayX = p.x + face.x * bayFace + lat.x * bayLat;
  const bayZ = p.z + face.z * bayFace + lat.z * bayLat;

  return {
    kind: garage ? 'garage' : 'driveway',
    side: garage ? 0 : Math.sign(latCenter),
    lat,
    face,
    houseOffset: { x: lat.x * houseLat, z: lat.z * houseLat },
    pad: { x: cx, z: cz, w: padW, d: padD },
    bay: { x: bayX, z: bayZ, yaw },
    entry: {
      x: p.x + face.x * entryFace + lat.x * entryLat,
      z: p.z + face.z * entryFace + lat.z * entryLat
    },
    cell: [x, y],
    key: `${x},${y}`,
    dir: garage ? { x: lat.x, z: lat.z } : { x: -face.x, z: -face.z },
    length: garage ? padLat : padFace,
    width: garage ? padFace : padLat
  };
}

export function createBuilding(town, x, y, zone = null, opts = {}) {
  const g = town.grid;
  if (!g.inBounds(x, y) || g.isRoad(x, y)) return null;

  // Multi-cell footprint: the building covers a block of cells (a mall or
  // multiplex buys up several plots). Single-cell builds run the original
  // path untouched.
  const cols = Math.max(1, Math.round(opts.footprint?.cols || 1));
  const rows = Math.max(1, Math.round(opts.footprint?.rows || 1));
  const cells = [];
  for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < cols; dx++) cells.push([x + dx, y + dy]);
  const isBig = cells.length > 1;

  for (const [cx, cy] of cells) {
    if (!g.inBounds(cx, cy)) return null;
    if (g.isRoad(cx, cy) || g.isWater(cx, cy)) return null;
    // Large builds never wipe parks/plazas; single-cell behaviour is as before.
    if (isBig) {
      const k = g.kindAt(cx, cy);
      if (k === CELL_KIND.PARK || k === CELL_KIND.PLAZA) return null;
    }
  }

  // Occupants: a single-cell build keeps the old "return the existing
  // building" contract; footprints acquire (the caller has already paid the
  // owner) or bail out.
  const occupants = [...new Set(cells.map(([cx, cy]) => town.buildingAt(cx, cy)).filter(Boolean))];
  if (occupants.length) {
    if (!opts.acquire) {
      if (!isBig) return occupants[0];
      return null;
    }
    for (const occ of occupants) town.removeBuilding(occ, false);
  }

  const face = facingToRoad(g, x, y, cells);
  const r = opts.rng || cellRng(town, x, y, 7);
  const idx = g.idx(x, y);
  const z = zone || g.zone[idx] || ZONE.RESIDENTIAL;
  const center = isBig
    ? g.cellToWorld(x + (cols - 1) / 2, y + (rows - 1) / 2)
    : g.cellToWorld(x, y);

  let params;
  let kind;

  if (z === ZONE.COMMERCIAL) {
    // Phase 20 (C3b) — an office is commercial land, but it is NOT a shop: the
    // kind, the kit branch and the economy's revenue rule all differ. The
    // planner asks for one with `office` (or the seed does); a plain commercial
    // plot is still a shop.
    const wantOffice = opts.kind === 'office' || (opts.office && z === ZONE.COMMERCIAL);
    kind = wantOffice ? 'office' : 'shop';
    const w = wantOffice ? r.float(3.4, 4.0) : r.float(2.9, 3.5);
    const d = wantOffice ? r.float(3.0, 3.5) : r.float(2.4, 2.9);
    params = {
      rng: r,
      style: 'shop',
      kind,
      w,
      d,
      // An office is a storey-count building first: it reads tall, and its
      // capacity is desks, which is what the floors are for.
      floors: wantOffice ? r.pick([2, 3, 3, 4, 5, 6, 8]) : r.chance(0.3) ? 2 : 1,
      wall: jitterColor(r.pick(PALETTE.wall), r, 0.07),
      trim: r.pick(PALETTE.trim),
      roofColor: r.pick(PALETTE.roof),
      doorColor: r.pick(PALETTE.door),
      roofType: wantOffice ? 'flat' : r.pick(['flat', 'gable', 'hip']),
      awningColor: r.pick(PALETTE.vehicle),
      signText: opts.name || (wantOffice ? r.pick(OFFICE_NAMES) : r.pick(SHOP_NAMES)),
      signBg: ['#2f3b47', '#6b2f2f', '#2f5a3a', '#4a3a6b', '#7a4a1f'][r.int(0, 4)],
      chimney: wantOffice ? false : r.chance(0.3),
      porch: false,
      accessible: r.chance(0.14),
      balcony: wantOffice && r.chance(0.35),
      solar: r.chance(0.18),
      greenRoof: r.chance(0.12)
    };
  } else if (z === ZONE.INDUSTRIAL) {
    kind = 'factory';
    const def = FACTORY_TYPES.find((t) => t.id === opts.factory) || FACTORY_TYPES[0];
    // Works occupy their whole industrial lot. The previous fixed 3.5m shell
    // left most of a 3x3/4x4 footprint visually empty, so a larger factory
    // now reads as a campus with a real horizontal and vertical mass.
    const w = Math.max(3.5, cols * CELL - 0.7 + r.float(-0.25, 0.25));
    const d = Math.max(3.4, rows * CELL - 0.7 + r.float(-0.25, 0.25));
    const index = town.buildings.filter((b) => b.kind === 'factory').length + 1;
    params = {
      rng: r,
      style: 'factory',
      w,
      d,
      floors: def.floors || 2,
      factoryType: def.id,
      factoryModules: def.modules || [],
      wall: jitterColor(r.pick(PALETTE.wall), r, 0.07),
      trim: r.pick(PALETTE.trim),
      roofColor: r.pick(PALETTE.roof),
      doorColor: r.pick(PALETTE.door),
      roofType: 'flat',
      signText: opts.name || `${def.label} ${index}`,
      signBg: ['#2f3b47', '#2f5a3a', '#7a4a1f'][r.int(0, 2)],
      chimney: false,
      porch: false,
      garage: false,
      accessible: r.chance(0.12),
      solar: r.chance(0.22),
      greenRoof: r.chance(0.18)
    };
  } else if (z === ZONE.CIVIC) {
    kind = 'civic';
    // A council-specified facility (archetype facility=) wins the slot and
    // claims it; otherwise the cell's registered facility or the next
    // unbuilt one from the placement order.
    const asked = opts.facility && CIVIC_CATALOGUE[opts.facility] ? opts.facility : null;
    let facilityId = asked || town.civicIndex?.get(idx);
    if (!facilityId) {
      const built = town.civicIndex ? new Set(town.civicIndex.values()) : new Set();
      facilityId = CIVIC_ORDER.find((id) => !built.has(id)) || 'townhall';
    }
    if (!town.civicIndex) town.civicIndex = new Map();
    if (!town.civicNames) town.civicNames = new Map();
    town.civicIndex.set(idx, facilityId);
    town.civicNames.set(idx, civicFacility(facilityId).label);
    const civicBlock = constructionBlock(`civic.${facilityId}`);
    const baseArea = civicBlock ? civicBlock.footprint[0] * civicBlock.footprint[1] : 1;
    params = civicParams(facilityId, r, {
      footprintArea: cells.length,
      baseFootprintArea: baseArea
    });
    params.signText = opts.name || town.civicNames.get(idx) || civicFacility(facilityId).label;
    params.capacityKind = CIVIC_CAPACITY_KIND[facilityId] || 'visitors';
  } else {
    kind = 'house';
    const near = 1 - Math.min(1, Math.hypot(x - g.w / 2, y - g.h / 2) / Math.hypot(g.w / 2, g.h / 2));
    const style = r.weighted([
      { id: 'suburban', weight: 5 },
      { id: 'cottage', weight: 3 },
      { id: 'townhouse', weight: near > 0.6 ? 4 : 1 }
    ]).id;
    const porch = style !== 'townhouse' && r.chance(0.45);
    const d = porch ? r.float(2.3, 2.6) : r.float(2.6, 3.2);
    const w = r.float(2.7, 3.5);
    let floors = r.chance(near > 0.65 ? 0.4 : 0.16) ? 2 : 1;
    if (near > 0.75 && r.chance(0.12)) floors = 3;
    // Phase 8 — upzoned land builds taller: three floors from the first plan.
    if (g.densityAt && g.densityAt(x, y)) floors = Math.max(3, floors);
    params = {
      rng: r,
      style,
      w,
      d,
      floors,
      wall: jitterColor(r.pick(PALETTE.wall), r, 0.07),
      trim: r.pick(PALETTE.trim),
      roofColor: r.pick(PALETTE.roof),
      doorColor: r.pick(PALETTE.door),
      roofType: r.pick(['gable', 'gable', 'gable', 'hip', 'flat']),
      porch,
      chimney: r.chance(0.55),
      garage: style === 'suburban' && w > 2.9 && r.chance(0.5),
      accessible: r.chance(0.08),
      balcony: floors > 1 && r.chance(0.45),
      solar: r.chance(0.16),
      greenRoof: r.chance(0.12)
    };
  }

  // Footprint sizing: the building fills its block minus a margin, with its
  // depth axis along the road-facing direction — horizontal AND vertical mass
  // for any large build, not a fixed mall special case.
  let along = 1;
  let lateral = 1;
  if (isBig) {
    along = face.x !== 0 ? cols : rows;
    lateral = face.x !== 0 ? rows : cols;
    params.w = Math.max(2.5, lateral * CELL - 0.6);
    params.d = Math.max(2.5, along * CELL - 0.6);
    params.garage = false;
    params.porch = false;
  }
  // A caller-pinned floor count (landmark row, archetype spec) wins on any
  // footprint, not just multi-cell ones — clamped to the one shared ceiling.
  if (opts.floors) params.floors = Math.max(1, Math.min(MAX_FLOORS, Math.round(opts.floors)));

  const isHouse = kind === 'house';
  // Council-composed archetypes: let the caller override kit parameters
  // (style, floors, porch, garage, …) while the zone still fixes purpose.
  if (opts.overrides) {
    const { zone: _z, purpose: _p, capacity: _c, ...safe } = opts.overrides;
    params = { ...params, ...safe };
  }
  // The founding floor ceiling, applied AFTER every other route into a height so
  // it catches all of them at once: the caller's `floors`, the per-zone rolls (an
  // office drawing up to eight, a house occasionally three, upzoned land forcing
  // three), the civic catalogue's own counts, and a council `overrides.floors`.
  // One rule, in one place, so no new building type can slip past it.
  //
  // Omitted by ordinary growth, so a town can grow as tall as it likes once it
  // has earned it — a landmark should be a milestone, not a starting condition.
  if (opts.maxFloors) params.floors = Math.max(1, Math.min(Math.round(params.floors) || 1, opts.maxFloors));
  // A garage house keeps its width and is set back for a forecourt it can nose
  // into; every other house gives up a slice of width so the car has a strip to
  // sit in beside the building instead of on the street.
  const willGarage = isHouse && !isBig && !!params.garage && params.floors === 1;
  if (isHouse && !isBig) {
    if (willGarage) {
      params.porch = false;
      params.d = Math.min(params.d, 2.4);
    } else {
      params.w = Math.min(params.w, 2.5);
    }
  }

  const parcel = town.parcels?.at(x, y) || null;
  params.parcel = parcel ? parcel.id : null;
  params.purpose =
    z === ZONE.COMMERCIAL
      ? 'commercial'
      : z === ZONE.CIVIC
        ? 'civic'
        : z === ZONE.INDUSTRIAL
          ? 'industrial'
          : 'residential';
  // Parcel quality sets the default budget tier (1–2); an explicit council
  // budget (overrides.budget, 1–3) wins — rudimentary to advanced.
  if (params.budget == null) {
    params.budget = 1 + (parcel && parcel.buildable ? Math.min(1, Math.round(parcel.setback * 2)) : 0);
  }
  // A caller-pinned capacity (a commerce rung, a district step) wins over every
  // formula below — the chooser priced the lot against this number.
  if (params.capacity == null && opts.capacity != null) params.capacity = opts.capacity;
  if (opts.capacity == null && params.capacity == null && params.purpose !== 'residential') {
    // Commercial and industrial occupancy is floor-area based. Residential
    // capacity stays unset here so houseKit can apply its beds-per-area rule;
    // founding houses pass an explicit five-bed capacity above.
    params.capacity = kind === 'office'
      // An office seats DESKS: a share of its floor area per storey, not the
      // shop's stock formula.
      ? Math.max(4, Math.round((params.w || 3.6) * (params.d || 3.2) * (params.floors || 1) * 0.9))
      : Math.max(1, Math.round((params.w || 3.2) * (params.d || 2.8) * (params.floors || 1) * 1.8));
  }
  if (opts.capacityKind != null) params.capacityKind = opts.capacityKind;
  if (opts.blockId != null) params.blockId = opts.blockId;
  // Residential occupancy is a family-per-tile contract. Preserve the
  // logical tile count in the kit spec so floor expansion and rebuilds do not
  // have to infer it from the building's inset physical dimensions.
  if (isHouse) params.footprintTiles = cells.length;

  // The council's name= lands on every zone (houses record it without a
  // street sign; shop/civic already show it as signText).
  if (opts.name && params.name == null) params.name = opts.name;

  const house = buildHouse(params);
  let setback = parcel && parcel.buildable ? parcel.setback : 0.2;
  if (willGarage) setback = 1.45;
  const porchExt = params.porch ? 1.0 : 0.0;
  const frontHalf = (along * CELL) / 2;
  const frontBody = frontHalf - setback - porchExt;
  const centerZ = frontBody - house.size.d / 2;
  const rotY = Math.atan2(face.x, face.z);
  const driveway = isHouse && !isBig ? planDriveway(town, x, y, face, house.size, setback, willGarage, r) : null;
  const latShift = driveway ? driveway.houseOffset : { x: 0, z: 0 };
  const pos = new THREE.Vector3(
    center.x + face.x * centerZ + latShift.x,
    LOT_PAD_H,
    center.z + face.z * centerZ + latShift.z
  );
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  const matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  const doorWorld = house.doorLocal.clone().applyMatrix4(matrix);

  const record = {
    id: town.nextEntityId ? town.nextEntityId('building') : `building-${x}-${y}`,
    cell: [x, y],
    footprint: isBig ? cells : null,
    subtype: opts.subtype || null,
    blockId: opts.blockId || house.spec.blockId || null,
    constructionFlags: {
      accessible: !!house.spec.accessible,
      balcony: !!house.spec.balcony,
      solar: !!house.spec.solar,
      greenRoof: !!house.spec.greenRoof
    },
    owner: opts.owner || (house.purpose === 'civic' ? 'state' : 'private'),
    ownerType: opts.ownerType || ((opts.owner || (house.purpose === 'civic' ? 'state' : 'private')) === 'state' ? 'government' : 'developer'),
    ownerId: opts.ownerId || ((opts.owner || (house.purpose === 'civic' ? 'state' : 'private')) === 'state' ? 'government' : 'developer'),
    zone: z,
    kind,
    // Phase 29 (S19a) — `params.name` is the council's `name=` for a house (set
    // just above, and the comment there says houses record it without a street
    // sign), but this line read only `house.name` / `params.signText`, so a
    // house's council-given name was dropped on the floor. `house.name` is not
    // set by `buildHouse` at all; the name reaches a record only through here.
    name: house.name || params.name || params.signText || null,
    house,
    matrix,
    doorWorld,
    size: house.size,
    floors: house.floors,
    style: house.style,
    height: house.height,
    face,
    purpose: house.purpose,
    facility: house.spec.facility || null,
    capacityKind: house.spec.capacityKind || null,
    capacity: house.capacity,
    budget: house.budget,
    modules: house.modules,
    parcelId: parcel ? parcel.id : null,
    setback,
    driveway
  };

  for (const [cx, cy] of cells) {
    g.setKind(cx, cy, CELL_KIND.LOT);
    g.zone[g.idx(cx, cy)] = z;
    g.owner[g.idx(cx, cy)] = record;
  }
  // The build establishes its zone on the footprint; the parcels it covers
  // were typed from the seed zoning, so re-derive them where they disagree —
  // otherwise a works on a residential parcel keeps a house's setback and a
  // suburban driveway.
  if (town.parcels?.retypeCells) town.parcels.retypeCells(town, cells);
  town.buildings.push(record);
  return record;
}

class Batch {
  constructor() {
    this.pads = [];
    this.props = [];
    this.glow = [];
  }

  add(obj) {
    if (!obj) return;
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (o.material.userData && o.material.userData.baseEmissive !== undefined) this.glow.push(geo);
      else this.props.push(geo);
      o.geometry.dispose();
    });
  }

  /**
   * Merge the batch into two meshes on `group` and release the intermediates.
   *
   * The merge COPIES vertex data, so every geometry in `pads`, `props` and
   * `glow` becomes garbage the moment it is merged — and nothing released it.
   * `layoutLots` runs on every `rebuildStatic` and allocates thousands of these
   * (one pad per occupied cell, plus every tree, lamp and prop), so a busy town
   * was churning hundreds of thousands of short-lived typed arrays per rebuild.
   *
   * They never reach the GPU — only the two merged meshes are attached — which is
   * exactly why this hid: it does not show in `renderer.info`, it just makes the
   * collector work.
   */
  addTo(group) {
    const padGeo = merge(this.pads.concat(this.props));
    const glowGeo = merge(this.glow);
    // Merged, so the inputs are dead. Release them before anything else so a
    // throw in mesh construction cannot strand them.
    for (const g of this.pads) g.dispose();
    for (const g of this.props) g.dispose();
    for (const g of this.glow) g.dispose();
    this.pads.length = 0;
    this.props.length = 0;
    this.glow.length = 0;
    if (padGeo) {
      const mesh = new THREE.Mesh(
        padGeo,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'lot-static';
      group.add(mesh);
    }
    if (glowGeo) {
      const mesh = new THREE.Mesh(glowGeo, sharedLampGlow);
      mesh.castShadow = false;
      mesh.name = 'lot-glow';
      group.add(mesh);
    }
  }
}

function padGeo(w, d, color, x, z, y = 0.06, h = 0.12) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function layoutParkCell(batch, g, x, y, rng, town) {
  const p = g.cellToWorld(x, y);
  batch.pads.push(padGeo(CELL - 0.1, CELL - 0.1, 0x639a51, p.x, p.z, 0.05, 0.1));
  const roll = rng.next();
  if (roll < 0.16 && !town.parkFeature) {
    town.parkFeature = true;
    const f = buildFountain(rng);
    f.position.set(p.x, 0.1, p.z);
    batch.add(f);
    return;
  }
  if (roll < 0.14 && (town.playCount = (town.playCount || 0) + 1) <= 3) {
    const s = buildSwingSet();
    s.position.set(p.x, 0.1, p.z);
    s.rotation.y = rng.float(0, Math.PI);
    batch.add(s);
    return;
  }
  if (roll < 0.22 && (town.playCount = (town.playCount || 0) + 1) <= 5) {
    const s = buildPlayStructure();
    s.position.set(p.x, 0.1, p.z);
    s.rotation.y = rng.float(0, Math.PI);
    batch.add(s);
    return;
  }
  const trees = rng.chance(0.72) ? 1 : 0;
  for (let i = 0; i < trees; i++) {
    const t = rng.chance(0.35)
      ? buildPine(rng, rng.float(0.8, 1.1))
      : buildTree(rng, rng.float(0.8, 1.2));
    t.position.set(p.x + rng.float(-1.3, 1.3), 0.1, p.z + rng.float(-1.3, 1.3));
    batch.add(t);
  }
  if (rng.chance(0.35)) {
    const b = buildBench();
    b.position.set(p.x + rng.float(-1, 1), 0.1, p.z + rng.float(-1, 1));
    b.rotation.y = rng.float(0, Math.PI * 2);
    batch.add(b);
  }
  if (rng.chance(0.25)) {
    const b = buildBush(rng, rng.float(0.8, 1.2));
    b.position.set(p.x + rng.float(-1.4, 1.4), 0.1, p.z + rng.float(-1.4, 1.4));
    batch.add(b);
  }
}

function addCustomProp(batch, p, type, rng) {
  let obj = null;
  if (type === 'pine') obj = buildPine(rng, rng.float(0.7, 1.2));
  else if (type === 'bush') obj = buildBush(rng, rng.float(0.7, 1.1));
  else if (type === 'bench') obj = buildBench();
  else if (type === 'lamp') obj = buildLamp();
  else obj = buildTree(rng, rng.float(0.7, 1.2));
  if (!obj) return;
  obj.position.set(p.x + rng.float(-1.2, 1.2), 0.1, p.z + rng.float(-1.2, 1.2));
  obj.rotation.y = rng.float(0, Math.PI * 2);
  batch.add(obj);
}

/** Cells a fleet facility or a shop can hand a bay to: its own neighbours. */
const ANCHOR_FACILITIES = new Set(['police', 'fire', 'clinic', 'hospital', 'townhall', 'government']);

function parkingCellFree(g, x, y) {
  if (!g.inBounds(x, y)) return false;
  const kind = g.kindAt(x, y);
  if (kind === CELL_KIND.ROAD || kind === CELL_KIND.WATER) return false;
  if (kind === CELL_KIND.PARK || kind === CELL_KIND.PLAZA) return false;
  if (g.owner[g.idx(x, y)]) return false;
  return isAdjacentToRoad(g, x, y);
}

function parkingParcelOk(parcel) {
  if (!parcel || !parcel.buildable) return false;
  return !parcel.publicSpace && !parcel.courtyard && !parcel.garden;
}

/** Reserve one neighbouring cell per station / shop as its parking lot. */
function planStationLots(town) {
  const g = town.grid;
  const out = new Map();
  const take = (cell, anchor) => {
    const k = `${cell[0]},${cell[1]}`;
    if (out.has(k)) return;
    if (!parkingCellFree(g, cell[0], cell[1])) return;
    if (!parkingParcelOk(town.parcels?.at(cell[0], cell[1]) || null)) return;
    out.set(k, anchor);
  };
  const civic = town.buildings.filter((b) => b.kind === 'civic' && ANCHOR_FACILITIES.has(b.facility));
  const shops = town.buildings.filter((b) => b.kind === 'shop');
  for (const list of [civic, shops]) {
    for (const b of list) {
      const [x, y] = b.cell;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const before = out.size;
        take([x + dx, y + dy], b.cell);
        if (out.size > before) break;
      }
    }
  }
  return out;
}

function parkingLotCell(town, g, x, y, kind, parcel, stationLots) {
  if (!parkingCellFree(g, x, y)) return false;
  const k = `${x},${y}`;
  if (stationLots.has(k)) return true;
  // Phase 8 — a bay the council ordered lands here whatever the roll says.
  if (town.parkingPlanned && town.parkingPlanned.has(k)) return true;
  if (!parkingParcelOk(parcel)) return false;
  const near = parcel.type === 'commercial' || parcel.type === 'civic';
  const roll = near ? 0.4 : 0.075;
  return cellRng(town, x, y, 77).chance(roll);
}

/** Two nose-in bays abreast, or one wide bay reserved for a facility. */
function renderParkingCell(batch, town, x, y, stationLots) {
  const g = town.grid;
  const p = g.cellToWorld(x, y);
  const face = facingToRoad(g, x, y);
  const lat = { x: -face.z, z: face.x };
  const anchor = stationLots.get(`${x},${y}`);
  const cr = cellRng(town, x, y, 78);
  batch.pads.push(padGeo(CELL - 0.06, CELL - 0.06, jitterColor(0x74716b, cr, 0.04), p.x, p.z, 0.09, 0.06));

  const station = !!anchor;
  const offs = station ? [-0.95, 0.95] : [-0.95, 0.95];
  const dir = { x: -face.x, z: -face.z };
  for (const off of offs) {
    const bx = p.x + face.x * 0.1 + lat.x * off;
    const bz = p.z + face.z * 0.1 + lat.z * off;
    bayMarkings(batch, bx, bz, dir, 3.8, 1.7);
    town.parking?.add({
      kind: station ? PARKING_KIND.STATION : PARKING_KIND.LOT,
      cell: [x, y],
      key: anchor ? `${anchor[0]},${anchor[1]}` : `${x},${y}`,
      stationKey: anchor ? `${anchor[0]},${anchor[1]}` : null,
      pos: { x: bx, z: bz },
      entry: { x: p.x + face.x * 1.9 + lat.x * off, z: p.z + face.z * 1.9 + lat.z * off },
      yaw: Math.atan2(-face.x, -face.z),
      length: 3.8,
      width: 1.7
    });
  }
}

/** Two kerb lines down the length of a bay. `dir` is the way the car faces. */
function bayMarkings(batch, cx, cz, dir, length, width) {
  const perp = { x: -dir.z, z: dir.x };
  const off = width / 2 - 0.06;
  const alongX = Math.abs(dir.x) === 1;
  for (const s of [-1, 1]) {
    const x = cx + perp.x * s * off;
    const z = cz + perp.z * s * off;
    batch.pads.push(padGeo(alongX ? length : 0.08, alongX ? 0.08 : length, 0xe8e2c8, x, z, 0.17, 0.02));
  }
}

export function layoutLots(town, rng) {
  const g = town.grid;
  const batch = new Batch();
  town.parkFeature = false;
  town.playCount = 0;
  town.parking?.clear();
  const stationLots = planStationLots(town);

  g.forEach((x, y) => {
    const kind = g.kindAt(x, y);
    const idx = g.idx(x, y);
    const p = g.cellToWorld(x, y);
    const cr = cellRng(town, x, y, 3);

    if (kind === CELL_KIND.WATER) return;
    // Resource sites carry their own yard and geometry from the Resource Kit.
    if (town.resources?.ownsCell(x, y)) return;

    const custom = town.customProps.get(idx);
    if (custom) {
      for (const type of custom) addCustomProp(batch, p, type, cellRng(town, x, y, 91));
    }

    if (kind === CELL_KIND.ROAD) {
      if (cr.chance(0.08)) {
        const h = buildHydrant();
        h.position.set(p.x + cr.float(-1.2, 1.2), 0.24, p.z + cr.float(-1.2, 1.2));
        batch.add(h);
      }
      return;
    }

    // A footway: a pale paved strip narrower than the road, no furniture.
    if (kind === CELL_KIND.PATH) {
      batch.pads.push(padGeo(CELL - 0.5, CELL - 0.5, 0xc9c2b2, p.x, p.z, 0.06, 0.12));
      return;
    }

    if (kind === CELL_KIND.PARK) {
      layoutParkCell(batch, g, x, y, cr, town);
      return;
    }

    if (kind === CELL_KIND.PLAZA) {
      batch.pads.push(padGeo(CELL - 0.1, CELL - 0.1, 0xb9ad91, p.x, p.z, 0.06, 0.12));
      const f = buildFountain(cr);
      f.position.set(p.x, 0.12, p.z);
      batch.add(f);
      const b1 = buildBench();
      b1.position.set(p.x + 1.4, 0.12, p.z);
      b1.rotation.y = -Math.PI / 2;
      batch.add(b1);
      const b2 = buildBench();
      b2.position.set(p.x - 1.4, 0.12, p.z);
      b2.rotation.y = Math.PI / 2;
      batch.add(b2);
      return;
    }

    const building = g.owner[idx];
    const zone = g.zone[idx];
    const parcel = town.parcels?.at(x, y) || null;
    // A cell claimed by an active construction site is spoken for: no
    // planned-parking bays may render under the glow until the build lands.
    const claimed = town.growth?.claims?.has(`${x},${y}`) || false;

    if (!building && !claimed && parkingLotCell(town, g, x, y, kind, parcel, stationLots)) {
      renderParkingCell(batch, town, x, y, stationLots);
      return;
    }

    if (building || kind === CELL_KIND.LOT) {
      const paved = building && (building.kind === 'shop' || building.kind === 'civic');
      batch.pads.push(
        padGeo(
          CELL - 0.14,
          CELL - 0.14,
          paved ? 0xa8a49c : jitterColor(0x6fa357, cr, 0.05),
          p.x,
          p.z,
          0.07,
          0.14
        )
      );
      const face = building ? building.face : facingToRoad(g, x, y);
      const rot = Math.atan2(face.x, face.z);

      if (paved) {
        const apron = new THREE.BoxGeometry(2.6, 0.06, 1.0);
        apron.translate(0, 0.16, 1.4);
        const c = new THREE.Color(0x8f8b84);
        const count = apron.attributes.position.count;
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          arr[i * 3] = c.r;
          arr[i * 3 + 1] = c.g;
          arr[i * 3 + 2] = c.b;
        }
        apron.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        const m = new THREE.Mesh(apron);
        m.position.set(p.x, 0, p.z);
        m.rotation.y = rot;
        m.updateMatrix();
        apron.applyMatrix4(m.matrix);
        batch.pads.push(apron);
      } else if (!building && cr.chance(0.25)) {
        const fence = buildFence(3.6, 0.7);
        fence.position.set(p.x - face.x * 1.7, 0.14, p.z - face.z * 1.7);
        fence.rotation.y = rot + Math.PI / 2;
        batch.add(fence);
      }

      if (building?.driveway) {
        const dw = building.driveway;
        batch.pads.push(padGeo(dw.pad.w, dw.pad.d, 0x8e8a83, dw.pad.x, dw.pad.z, 0.13, 0.05));
        bayMarkings(batch, dw.bay.x, dw.bay.z, dw.dir, dw.length, dw.width);
        town.parking?.add({
          kind: dw.kind,
          cell: dw.cell,
          key: dw.key,
          pos: { x: dw.bay.x, z: dw.bay.z },
          entry: { x: dw.entry.x, z: dw.entry.z },
          yaw: dw.bay.yaw,
          length: dw.length,
          width: dw.width
        });
      }

      if (paved && parcel?.parking) {
        const w = face.z ? 2.4 : 1.1;
        const d = face.x ? 2.4 : 1.1;
        batch.pads.push(
          padGeo(w, d, 0x7e7b75, p.x + face.z * 1.15, p.z - face.x * 1.15, 0.1, 0.055)
        );
        for (const s of [-1, 1]) {
          const tw = face.z ? 0.06 : 1.0;
          const td = face.x ? 0.06 : 1.0;
          batch.pads.push(
            padGeo(
              tw,
              td,
              0xe8e2c8,
              p.x + face.z * 1.15 + (face.z ? 0 : s * 1.2),
              p.z - face.x * 1.15 + (face.x ? 0 : s * 1.2),
              0.15,
              0.02
            )
          );
        }
      }

      if (!building) {
        if (cr.chance(0.38)) {
          const t = buildTree(cr, cr.float(0.7, 1.0));
          t.position.set(p.x + cr.float(-0.9, 0.9), 0.14, p.z + cr.float(-0.9, 0.9));
          batch.add(t);
        }
        if (cr.chance(0.4)) {
          const b = buildBush(cr, cr.float(0.7, 1.0));
          b.position.set(p.x + cr.float(-1.2, 1.2), 0.14, p.z + cr.float(-1.2, 1.2));
          batch.add(b);
        }
      }

      if (parcel?.garden && building) {
        const gx = p.x - face.x * 1.4 + face.z * cr.float(-1.1, 1.1);
        const gz = p.z - face.z * 1.4 - face.x * cr.float(-1.1, 1.1);
        for (let i = 0; i < 3; i++) {
          const b = buildBush(cr, cr.float(0.5, 0.8));
          b.position.set(gx + cr.float(-0.5, 0.5), 0.14, gz + cr.float(-0.5, 0.5));
          batch.add(b);
        }
      }

      if (cr.chance(0.35) && !building?.driveway) {
        const mb = buildMailbox();
        mb.position.set(p.x + face.x * 1.6 + face.z * 0.9, 0.14, p.z + face.z * 1.6 - face.x * 0.9);
        mb.rotation.y = rot;
        batch.add(mb);
      }

      if (building && building.kind === 'shop' && cr.chance(0.5)) {
        const t = cr.chance(0.5) ? buildTrashBin() : buildHydrant();
        t.position.set(p.x + face.z * 1.4, 0.14, p.z - face.x * 1.4);
        batch.add(t);
      }
      return;
    }

    if (
      parcel && parcel.courtyard && !building &&
      kind === CELL_KIND.EMPTY && !isAdjacentToRoad(g, x, y)
    ) {
      batch.pads.push(padGeo(CELL - 0.3, CELL - 0.3, 0xb2ac9e, p.x, p.z, 0.07, 0.13));
      batch.pads.push(padGeo(2.6, 2.6, 0x9d978b, p.x, p.z, 0.13, 0.06));
      const t = buildTree(cr, cr.float(0.6, 0.9));
      t.position.set(p.x + cr.float(-0.7, 0.7), 0.14, p.z + cr.float(-0.7, 0.7));
      batch.add(t);
      const bench = buildBench();
      bench.position.set(p.x + cr.float(-0.9, 0.9), 0.14, p.z + cr.float(-0.9, 0.9));
      bench.rotation.y = cr.float(0, Math.PI * 2);
      batch.add(bench);
      for (let i = 0; i < 4; i++) {
        const b = buildBush(cr, cr.float(0.5, 0.8));
        const a = (i / 4) * Math.PI * 2 + 0.4;
        b.position.set(p.x + Math.cos(a) * 1.5, 0.14, p.z + Math.sin(a) * 1.5);
        batch.add(b);
      }
      return;
    }

    if (zone || isAdjacentToRoad(g, x, y)) {
      batch.pads.push(padGeo(CELL - 0.14, CELL - 0.14, jitterColor(0x5c8f4a, cr, 0.06), p.x, p.z, 0.05, 0.1));
      if (cr.chance(0.4)) {
        const t = buildTree(cr, cr.float(0.7, 1.1));
        t.position.set(p.x + cr.float(-1.1, 1.1), 0.1, p.z + cr.float(-1.1, 1.1));
        batch.add(t);
      }
      return;
    }

    if (cr.chance(0.17)) {
      const n = cr.int(1, 2);
      for (let i = 0; i < n; i++) {
        const t = cr.chance(0.3)
          ? buildPine(cr, cr.float(0.7, 1.2))
          : buildTree(cr, cr.float(0.7, 1.2));
        t.position.set(p.x + cr.float(-1.5, 1.5), 0, p.z + cr.float(-1.5, 1.5));
        batch.add(t);
      }
      if (cr.chance(0.3)) {
        const b = buildBush(cr, cr.float(0.8, 1.2));
        b.position.set(p.x + cr.float(-1.5, 1.5), 0, p.z + cr.float(-1.5, 1.5));
        batch.add(b);
      }
    }
  });

  // One off-road pump bay per gas site, linked to its operating resource site.
  for (const site of town.resources?.sites || []) {
    if (site.kind !== 'gas') continue;
    let access = null;
    for (const [x, y] of site.cells) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (g.isRoad(x + dx, y + dy)) { access = { x, y, dx, dy }; break; }
      }
      if (access) break;
    }
    if (!access) continue;
    const bay = g.cellToWorld(access.x, access.y);
    const road = g.cellToWorld(access.x + access.dx, access.y + access.dy);
    town.parking?.add({ kind: PARKING_KIND.PUMP, cell: [access.x, access.y],
      key: site.id, siteId: site.id,
      pos: { x: bay.x, z: bay.z }, entry: { x: road.x, z: road.z },
      yaw: Math.atan2(-access.dx, -access.dy), length: 4.4, width: 2.1 });
  }

  town.publicPlan = planPublicSpaces(town, rng.fork(7711));
  renderPublicSpaces(town, town.publicPlan, batch, rng.fork(7712));

  batch.addTo(town.lotsGroup);
  town.parking?.finalizeRebuild(town.traffic?.vehicles || []);
}

export function rebuildZone(town) {
  const g = town.grid;
  const spots = [];
  g.forEach((x, y) => {
    const k = g.kindAt(x, y);
    if (k === CELL_KIND.PARK || k === CELL_KIND.PLAZA) {
      const p = g.cellToWorld(x, y);
      spots.push(new THREE.Vector3(p.x, 0, p.z));
    }
  });
  for (const b of town.buildings) {
    if (b.kind === 'shop') spots.push(b.doorWorld.clone());
  }
  town.leisureSpots = spots;
}

function placeBuildings(town, rng, opts = {}) {
  const g = town.grid;
  const houseLimit = opts.houseLimit ?? Infinity;
  // Founding rule � bedTarget replaces the house count with a bed count: keep
  // placing homes until the town holds exactly this many beds. Founding homes
  // retain their explicit five-bed contract, so pinning two floors lands on
  // six houses = 30 beds; later residential builds use three residents per
  // tiled footprint per floor.
  const bedTarget = opts.bedTarget ?? null;
  let beds = town.buildings.reduce((n, b) => n + (b.kind === 'house' ? b.capacity || 0 : 0), 0);
  const shopLimit = opts.shopLimit ?? Infinity;
  // Phase 20 (C3b) — a founding town gets at least one office block, so the
  // white-collar jobs (accountant, designer, clerk) have somewhere to work in
  // day one. Same knob family as houseLimit/shopLimit; 0 is opt-out.
  const officeLimit = opts.officeLimit ?? 1;
  const cands = [];
  const comps = roadComponents(g);
  g.forEach((x, y, grid) => {
    const z = grid.zone[grid.idx(x, y)];
    if (!z || z === ZONE.PARK) return;
    if (grid.kindAt(x, y) === CELL_KIND.ROAD) return;
    if (grid.kindAt(x, y) === CELL_KIND.WATER) return;
    if (!hasNetworkAccess(grid, x, y, comps)) return;
    cands.push([x, y, z]);
  });

  const civic = cands.filter((c) => c[2] === ZONE.CIVIC && town.civicIndex?.has(g.idx(c[0], c[1])));
  // Industry is NOT part of the founding fill. The rim blocks are zoned
  // industrial for the works to grow into, but the founding town leaves them
  // open — no factories on day one. This loop builds whatever kind the zone
  // implies, so leaving industrial in `rest` would scatter sheds across the
  // whole rim on a one-cell-per-plot basis, exactly the placement the
  // outskirts rule exists to prevent.
  const rest = cands.filter((c) => c[2] !== ZONE.CIVIC && c[2] !== ZONE.INDUSTRIAL);
  const cx = g.w / 2;
  const cy = g.h / 2;
  const byDist = (a, b) =>
    Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy) || a[1] - b[1] || a[0] - b[0];
  civic.sort(byDist);
  rest.sort(byDist);

  // Every founding build goes through one of the three `createBuilding` calls
  // below, and each of them passes the founding floor ceiling. They are listed
  // here because the cap is only as good as its coverage: the civic loop, the
  // office, and the general loop are three separate sites, and the office in
  // particular draws up to eight storeys on its own.
  for (const [x, y, z] of civic) {
    createBuilding(town, x, y, z, { rng: cellRng(town, x, y, 11), maxFloors: FOUNDING_MAX_FLOORS });
  }

  let houses = town.buildings.filter((b) => b.kind === 'house').length;
  let shops = town.buildings.filter((b) => b.kind === 'shop').length;
  let count = town.buildings.length;
  // Phase 20 — the office goes FIRST, on the commercial plot nearest the
  // centre, and the rest of the commercial ring is filled by the normal loop
  // below (shops included): the office is one building among the town's
  // commerce, not a replacement for it.
  if (officeLimit > 0) {
    const officeSpot = rest.find((c) => c[2] === ZONE.COMMERCIAL);
    if (officeSpot) {
      const [ox, oy] = officeSpot;
      const rec = createBuilding(town, ox, oy, ZONE.COMMERCIAL, {
        rng: cellRng(town, ox, oy, 7),
        // An office is the one founding building that draws its own height —
        // eight storeys on the roll — so it needs the founding ceiling as
        // explicitly as everything else.
        maxFloors: FOUNDING_MAX_FLOORS,
        kind: 'office'
      });
      if (rec && rec.kind === 'office') {
        count++;
        const at = rest.indexOf(officeSpot);
        if (at >= 0) rest.splice(at, 1);
      }
    }
  }
  for (const [x, y, z] of rest) {
    if (count >= MAX_BUILDINGS) break;
    if (z === ZONE.RESIDENTIAL) {
      if (bedTarget != null) {
        if (beds >= bedTarget) continue;
      } else if (houses >= houseLimit) continue;
    }
    if (z === ZONE.COMMERCIAL && shops >= shopLimit) continue;
    // createBuilding's single-cell path returns the EXISTING record when the
    // cell is already built (its idempotence contract) — count only what
    // actually went up. The old code incremented on every non-null return, so
    // a ghost consumed cap and the MAX_BUILDINGS break fired early.
    const n0 = town.buildings.length;
    const rec = createBuilding(town, x, y, z, {
      rng: cellRng(town, x, y, 7),
      // The founding town is a hamlet: nothing in it is taller than two storeys.
      // Applied here, on the founding path only, so the ceiling covers the
      // office roll, the house roll and the civic catalogue alike without each
      // of them having to know about it.
      maxFloors: FOUNDING_MAX_FLOORS,
      // Even floors only under a bed target: odd floors carry a 0.5-bed
      // fraction nobody can sleep in, which would read as spare that can
      // never house anyone (and once did, over-occupying the house).
      ...(z === ZONE.RESIDENTIAL && bedTarget != null ? { floors: 2 } : {}),
      ...(z === ZONE.RESIDENTIAL && bedTarget != null ? { capacity: HOUSEHOLD.avgSize * 2 } : {})
    });
    if (!rec || town.buildings.length === n0) continue;
    count++;
    if (rec.kind === 'house') {
      houses++;
      beds += rec.capacity || 0;
    }
    if (rec.kind === 'shop') shops++;
  }
}

/**
 * Founding back lanes: straight street stretches become 1-lane alleys (class
 * code 1) — quiet old-town lanes with tight setbacks, still upgradeable later
 * via UPGRADE_ROAD. A cell qualifies on a straight run (dead ends included)
 * unless a side faces heavy traffic (industrial), water or another road;
 * runs rank by house/park/civic frontage first, then length, longest two,
 * so homes overlook lanes while the works keep their wide streets. Only
 * contiguous runs of 4+ cells, so the classes read as deliberate lanes rather
 * than speckles. Runs inside zoning, before parcels and the road kit, so
 * setbacks and paint both see the codes.
 */
function tagFoundingAlleys(town) {
  const g = town.grid;
  const lines = town.streets || [];
  const core = town.core;
  if (!core || !lines.length) return 0;
  // A side facing road/water/industry disqualifies; otherwise homely or plain.
  const sideUse = (x, y) => {
    if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isWater(x, y)) return false;
    const z = g.zone[g.idx(x, y)];
    if (z === ZONE.INDUSTRIAL) return false;
    if (z === ZONE.RESIDENTIAL || z === ZONE.PARK || z === ZONE.CIVIC) return 'homely';
    return 'plain';
  };
  const runs = [];
  for (const line of lines) {
    const cells = [];
    if (line.axis === 'x') {
      for (let y = core.y0; y <= core.y1; y++) cells.push([line.at, y]);
    } else {
      for (let x = core.x0; x <= core.x1; x++) cells.push([x, line.at]);
    }
    let run = [];
    let homely = 0;
    const flush = () => {
      if (run.length >= 4) runs.push({ cells: run, homely });
      run = [];
      homely = 0;
    };
    for (const [x, y] of cells) {
      const deg = g.isRoad(x, y) ? g.roadDegree(x, y) : 0;
      let score = deg === 1 || deg === 2 ? 0 : -1;
      if (score >= 0) {
        const [ax, ay, bx, by] =
          line.axis === 'x' ? [x - 1, y, x + 1, y] : [x, y - 1, x, y + 1];
        const a = sideUse(ax, ay);
        const b = sideUse(bx, by);
        if (a === false || b === false) score = -1;
        else score = (a === 'homely' ? 1 : 0) + (b === 'homely' ? 1 : 0);
      }
      if (score < 0) flush();
      else {
        run.push([x, y]);
        homely += score;
      }
    }
    flush();
  }
  runs.sort((a, b) => b.homely - a.homely || b.cells.length - a.cells.length);
  const taken = new Set();
  let lanes = 0;
  let coded = 0;
  for (const run of runs) {
    if (lanes >= 2) break;
    const fresh = run.cells.filter(([x, y]) => !taken.has(`${x},${y}`));
    if (!fresh.length) continue;
    for (const [x, y] of fresh) {
      taken.add(`${x},${y}`);
      g.setRoadClassCode(x, y, 1); // alley = XS_CLASS_ORDER[0]
      coded++;
    }
    lanes++;
  }
  return coded;
}

/**
 * Cozy dressing for the founding streets: lamps along the main (most central)
 * street and trees through the park. Runs inside lots, after the buildings
 * stand — lamps take road-adjacent free cells (same exposure as player-placed
 * ones), trees take park cells only, so nothing is planted where a house goes.
 */
function dressFoundingStreets(town, rng) {
  const g = town.grid;
  const core = town.core;
  if (!core) return;
  const free = (x, y) =>
    g.inBounds(x, y) &&
    !g.isRoad(x, y) &&
    !g.isWater(x, y) &&
    !g.isPath(x, y) &&
    !town.buildingAt(x, y) &&
    !town.resources?.ownsCell(x, y) &&
    (g.kindAt(x, y) === CELL_KIND.EMPTY || g.kindAt(x, y) === CELL_KIND.LOT);
  // Main street: the vertical line nearest the core centre (else horizontal).
  const vertical = (town.streets || []).filter((l) => l.axis === 'x');
  const across = (town.streets || []).filter((l) => l.axis === 'y');
  const mx = (core.x0 + core.x1) / 2;
  const my = (core.y0 + core.y1) / 2;
  const mainV = vertical.slice().sort((a, b) => Math.abs(a.at - mx) - Math.abs(b.at - mx))[0];
  const mainH = across.slice().sort((a, b) => Math.abs(a.at - my) - Math.abs(b.at - my))[0];
  const main = mainV || mainH;
  let lamps = 0;
  if (main) {
    let side = 1;
    if (main.axis === 'x') {
      for (let y = core.y0; y <= core.y1 && lamps < 4; y += 3) {
        if (!g.isRoad(main.at, y)) continue;
        const x = main.at + side;
        side = -side;
        if (free(x, y) && town.addProp(x, y, 'lamp')) lamps++;
      }
    } else {
      for (let x = core.x0; x <= core.x1 && lamps < 4; x += 3) {
        if (!g.isRoad(x, main.at)) continue;
        const y = main.at + side;
        side = -side;
        if (free(x, y) && town.addProp(x, y, 'lamp')) lamps++;
      }
    }
  }
  // Park trees: every third park cell, up to six.
  let trees = 0;
  let seen = 0;
  g.forEach((x, y, grid) => {
    if (trees >= 6) return;
    if (grid.kindAt(x, y) !== CELL_KIND.PARK) return;
    if (town.buildingAt(x, y) || town.resources?.ownsCell(x, y)) return;
    seen++;
    if (seen % 3 !== 0) return;
    if (town.addProp(x, y, 'tree')) trees++;
  });
}

export function placeInitialTown(town, rng) {
  const g = town.grid;

  const handlers = {
    seed: () => {
      town.pipelineSeed = town.seed;
    },
    mainRoads: () => {
      // A compact founding hamlet, sized in ABSOLUTE cells (19-21 x 16-18) so
      // it is the same size whatever the extent is. The subdivision below only
      // yields enough street blocks for the zoning roles (industrial/civic/
      // commercial/residential) at this size and up — smaller rects starve
      // housing and civic. The rest of the extent is free land the town has to
      // pave, zone and build its way into.
      town.core = planCore(g, rng.fork(3301), { w: FOUNDING_CORE.w, h: FOUNDING_CORE.h });
      town.streets = layoutStreets(g, rng.fork(3302), town.core, { minimal: true });
    },
    roadFeatures: () => {
      // The river, the bridge over it, the tunnel, the roundabout and the cul-de-sac.
      //
      // This stage was `g.computeRoadMask()` alone: `planRoadFeatures` and all four
      // of its pickers were written and never called. So the founding town had NO
      // river at all — only the resource lake — and the whole feature subsystem
      // was unreachable: `buildBridge`, `bridgeTarget`, `wanted('bridge')`,
      // `MAX_BRIDGE_GAP`, the roundabout arms in `roadGraph`, `routes.js`, the tile
      // inspector's feature label and `Grid.clearFeatures`. Measured across 8
      // seeds: 0 road-feature cells, 0 bridges, and `planFor('bridge')` built no
      // plans at all. Same failure shape as the `annex` map-edge rule — a
      // precondition (a carved river) that was never established.
      // This stage runs immediately after `mainRoads` and before `zoning`,
      // `parcels` and `buildings` — which is the right place for the river: those
      // three all derive their view of the land from the grid and must see the
      // water. `computeRoadMask` relinks the road network, because the river
      // replaces road cells and the cul-de-sac adds one. No `rebuildStatic` here:
      // there are no buildings yet, and every later stage derives from this grid.
      town.roadFeatures = planRoadFeatures(g, rng.fork(3304));
      g.computeRoadMask();
      if (town.roadFeatures) {
        events.emit('log', {
          kind: 'event',
          text: `Road features laid · ${town.roadFeatures.blocks?.length ?? 0} (${(town.roadFeatures.blocks || []).join(', ') || 'none'}).`
        });
      }
    },
    roadMask: () => {
      town.connectivity = ensureRoadConnectivity(g);
    },
    zoning: () => {
      town.zoning = zoneBlocks(g, rng.fork(3303), town.core, { civicSlots: BASIC_CIVIC.length, minimal: true });
      const lanes = tagFoundingAlleys(town);
      if (lanes > 0) {
        events.emit('log', {
          text: `Two back lanes are paved as alleys — quiet single-lane streets behind the houses.`
        });
      }
    },
    civic: () => {
      placeCivic(town, rng);
    },
    parcels: () => {
      town.parcels.build(town, rng);
    },
    buildings: () => {
      // Founding provisions for FOUNDING_POPULATION (30): exact beds, a lean
      // commercial row (3 shops — scaled to the smaller town), and the
      // mandated office and civic set. No factories — industry zones stay
      // open for the council to commission later. Resources size themselves
      // to the placed beds in the resources step.
      placeBuildings(town, rng, { bedTarget: FOUNDING_POPULATION, shopLimit: 3 });
      town.rebuildBuildings();
    },
    resources: () => {
      // Sited after the buildings exist (production is sized to planned
      // demand) and before the road kit runs, so the lake renders as water.
      town.resources.plan(town, rng.fork(8821));
      town.connectivity = ensureRoadConnectivity(g);
      // The resource stage PAVES. Every site carves an access spur and
      // `ensureRoadConnectivity` paves more, and those roads create frontage
      // that the parcel map has never heard of — so without this rebuild, 123
      // cells that front a real road report `frontage: []` and `buildable:
      // false`. `findCell` and `findFootprintSite` reject them outright while
      // the planner keeps offering them, which is why `growth.wanted('footway')`
      // sat permanently true and the town thought it had 1,051 landlocked
      // parcels it could never build on. Every other mutator in the codebase
      // rebuilds parcels; this stage had been the exception because it is the
      // last one to run before the road kit consumes frontage.
      town.parcels.build(town, rng.fork(2027));
      const rs = town.resources.stats();
      events.emit('log', {
        text: `Primary resources placed · ${rs.sites} sites (${rs.lakeCells} lake cells, ${rs.connected} road-connected).`
      });
    },
    roadKit: () => {
      town.roadsGroup.add(town.roadKit.build());
    },
    lots: () => {
      layoutLots(town, rng);
      dressFoundingStreets(town, rng.fork(7713));
    },
    zoneModel: () => {
      rebuildZone(town);
    },
    utilities: () => {
      town.utilities.build(town, rng.fork(4409));
    },
    agents: () => {
      town.pedestrians.spawnFamilies(FOUNDING_POPULATION);
      // Savings accounts are opened in Town.generate, AFTER economy.rebuild() —
      // not here. A brand-new citizen's cash is only reconciled against the
      // outside world (and so only counted into the economy's money baseline) by
      // `syncEntities`. Moving a household's money to the bank before that
      // happens leaves the bank holding funds the baseline has never been told
      // about, which shows up as phantom money creation in `economy.audit()`.
      //
      // The private fleet is released from the register for the same reason:
      // a household cannot be given a car before its money is real.
      town.traffic.spawnFleet();
    },
    validation: () => {
      town.validation = validateTown(town);
    }
  };

  const steps = runTownPipeline(town, rng, handlers);
  town.pipeline = steps;
  town.pipelineSummary = pipelineSummary(steps);
  return steps;
}

export { isAdjacentToRoad, facingToRoad, cellRng };



