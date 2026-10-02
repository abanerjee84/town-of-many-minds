import * as THREE from 'three';
import { CELL, PALETTE, ROAD } from '../../core/config.js';
import { N, E, S, W, DIRS, ROAD_FEATURE } from '../../core/grid.js';
import { box, boxEuler, cyl, sphere, jitterColor } from '../geometry.js';
import { makeSign } from '../sign.js';
import { edgeOffset, kerbOffset, composeCrossSection, classFromCode } from './crossSection.js';

const HALF = CELL / 2;
const RP = PALETTE.road;
const MARK_Y = ROAD.asphaltH + 0.015;

export const SEG = {
  ISOLATED: 'isolated',
  DEAD_END: 'deadend',
  STRAIGHT: 'straight',
  CURVE: 'curve',
  T: 'tjunction',
  CROSS: 'cross',
  ROUNDABOUT: 'roundabout',
  BRIDGE: 'bridge',
  RAMP: 'ramp',
  TUNNEL: 'tunnel'
};

export const SEG_LABEL = {
  isolated: 'Road segment · isolated',
  deadend: 'Road segment · dead end',
  straight: 'Road segment · straight',
  curve: 'Road segment · curve',
  tjunction: 'Road segment · T-junction',
  cross: 'Road segment · four-way junction',
  roundabout: 'Road segment · roundabout',
  bridge: 'Road segment · bridge',
  ramp: 'Road segment · bridge approach',
  tunnel: 'Road segment · tunnel'
};

export const SEG_SHORT = {
  isolated: 'Isolated',
  deadend: 'Dead End',
  straight: 'Straight',
  curve: 'Curve',
  tjunction: 'T-Junction',
  cross: 'Four-Way Junction',
  roundabout: 'Roundabout',
  bridge: 'Bridge',
  ramp: 'Bridge Ramp',
  tunnel: 'Tunnel'
};

const STREET_NAMES = [
  'Market Street', 'Linden Way', 'Harbour Road', 'Mill Lane',
  'Station Road', 'Church Street', 'Orchard Row', 'Kiln Avenue'
];

export function streetNameFor(x, y) {
  const h = hash2(x, y);
  return STREET_NAMES[h % STREET_NAMES.length];
}

export function edgeInfo(mask) {
  const out = [];
  if (mask & N) out.push({ bit: N, ox: 0, oz: -HALF, nx: 0, nz: 1 });
  if (mask & E) out.push({ bit: E, ox: HALF, oz: 0, nx: -1, nz: 0 });
  if (mask & S) out.push({ bit: S, ox: 0, oz: HALF, nx: 0, nz: -1 });
  if (mask & W) out.push({ bit: W, ox: -HALF, oz: 0, nx: 1, nz: 0 });
  return out;
}

export function straightAxis(mask) {
  if ((mask & (N | S)) === (N | S) && !(mask & (E | W))) return 'z';
  if ((mask & (E | W)) === (E | W) && !(mask & (N | S))) return 'x';
  return null;
}

export function hash2(x, y) {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

export function straightRun(grid, x, y, axis) {
  const dx = axis === 'x' ? 1 : 0;
  const dy = axis === 'z' ? 1 : 0;
  let sx = x;
  let sy = y;
  let back = 0;
  for (;;) {
    const px = sx - dx;
    const py = sy - dy;
    if (!grid.isRoad(px, py) || straightAxis(grid.roadAt(px, py)) !== axis) break;
    sx = px;
    sy = py;
    back++;
  }
  let total = 1;
  let cx = sx;
  let cy = sy;
  for (;;) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (!grid.isRoad(nx, ny) || straightAxis(grid.roadAt(nx, ny)) !== axis) break;
    cx = nx;
    cy = ny;
    total++;
  }
  return { start: back, total, sx, sy, dx, dy, hash: hash2(sx, sy) };
}

export function bridgeNeighbor(grid, x, y) {
  for (const d of DIRS) {
    if (grid.featureAt(x + d.dx, y + d.dy) === ROAD_FEATURE.BRIDGE) return [d.dx, d.dy];
  }
  return null;
}

export function classify(grid, x, y) {
  const feature = grid.featureAt(x, y);
  if (feature === ROAD_FEATURE.ROUNDABOUT) return SEG.ROUNDABOUT;
  if (feature === ROAD_FEATURE.DEAD_END) return SEG.DEAD_END;
  if (feature === ROAD_FEATURE.BRIDGE) return SEG.BRIDGE;
  if (feature === ROAD_FEATURE.TUNNEL) return SEG.TUNNEL;
  const mask = grid.roadAt(x, y);
  const degree = grid.roadDegree(x, y);
  const axis = straightAxis(mask);
  if (degree === 0) return SEG.ISOLATED;
  if (degree === 1) return SEG.DEAD_END;
  if (axis) return bridgeNeighbor(grid, x, y) ? SEG.RAMP : SEG.STRAIGHT;
  if (degree === 2) return SEG.CURVE;
  if (degree === 3) return SEG.T;
  return SEG.CROSS;
}

/**
 * Phase 13 — the ladder class of one road cell WITHOUT a RoadKit rebuild:
 * the stored code wins, otherwise the very same composeCrossSection the
 * renderer uses derives it from the run. Callers that run before the Road
 * kit stage (parcel build) get the identical answer the render will show.
 */
export function classAt(grid, x, y) {
  if (!grid.isRoad(x, y)) return null;
  const code = grid.roadClassCode ? grid.roadClassCode(x, y) : 0;
  if (code) return classFromCode(code);
  const seg = classify(grid, x, y);
  const axis = straightAxis(grid.roadAt(x, y));
  const run = axis ? straightRun(grid, x, y, axis) : null;
  return composeCrossSection({ seg, axis, run, clsOverride: 0 }).cls;
}

export function featureLabel(feature, seg) {
  if (feature === ROAD_FEATURE.BRIDGE) return 'Bridge';
  if (feature === ROAD_FEATURE.TUNNEL) return 'Tunnel';
  if (feature === ROAD_FEATURE.ROUNDABOUT) return 'Roundabout';
  if (feature === ROAD_FEATURE.DEAD_END) return 'Dead end';
  return SEG_LABEL[seg] || 'Road segment';
}

function paint(b, geo) {
  b.add('marks', geo);
}

function struct(b, geo) {
  b.add('structs', geo);
}

function glow(b, bucket, geo) {
  b.add(bucket, geo);
}

function asphaltColor(c) {
  return jitterColor(PALETTE.asphalt, c.rng, 0.035);
}

function hasWalk(g, x, y, dx, dz) {
  const nx = x + dx;
  const ny = y + dz;
  if (!g.inBounds(nx, ny)) return true;
  return !g.isRoad(nx, ny);
}

function lateralDirs(axis) {
  return axis === 'z' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
}

function alongDirs(axis) {
  return axis === 'z' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
}

function rampRotation(ramp) {
  const angle = Math.atan2(ROAD.deckH - ROAD.asphaltH, CELL);
  if (ramp[1] !== 0) return [-angle * ramp[1], 0, 0];
  return [0, 0, angle * ramp[0]];
}

export function addSidewalks(b, c) {
  const { g, x, y, p, seg } = c;
  if (seg === SEG.BRIDGE || seg === SEG.RAMP) return;
  for (const [dx, dz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
    if (!hasWalk(g, x, y, dx, dz)) continue;
    const sideSign = dx !== 0 ? dx : dz;
    const narrow =
      (c.hasCycle && c.cycleSide === sideSign) || (c.hasParking && c.parkingSide === sideSign);
    const width = narrow ? ROAD.narrowSidewalk : ROAD.sidewalkW;
    const inner = HALF - width;
    const sw = jitterColor(PALETTE.sidewalk, c.rng, 0.03);
    const px = p.x + dx * (HALF - width / 2);
    const pz = p.z + dz * (HALF - width / 2);
    const w = dx === 0 ? CELL : width;
    const d = dz === 0 ? CELL : width;
    b.add('walks', box(w, ROAD.walkH, d, sw, px, ROAD.walkH / 2, pz));
    const cx = p.x + dx * (inner - 0.05);
    const cz = p.z + dz * (inner - 0.05);
    const cw = dx === 0 ? CELL : 0.1;
    const cd = dz === 0 ? CELL : 0.1;
    b.add('walks', box(cw, ROAD.walkH + 0.03, cd, PALETTE.curb, cx, (ROAD.walkH + 0.03) / 2, cz));
  }
}

export function addSurface(b, c) {
  const { p, seg } = c;
  if (seg === SEG.BRIDGE) {
    b.add('asphalt', box(CELL, 0.4, CELL, asphaltColor(c), p.x, ROAD.deckH - 0.2, p.z));
    return;
  }
  if (seg === SEG.RAMP && c.ramp) {
    const rot = rampRotation(c.ramp);
    b.add(
      'asphalt',
      boxEuler(
        CELL,
        0.4,
        CELL,
        asphaltColor(c),
        [p.x, (ROAD.deckH + ROAD.asphaltH) / 2 - 0.2, p.z],
        rot
      )
    );
    return;
  }
  b.add('asphalt', box(CELL, ROAD.asphaltH, CELL, asphaltColor(c), p.x, ROAD.asphaltH / 2, p.z));
}

export function addLaneMarkings(b, c) {
  const { p, seg, mask } = c;
  if (seg === SEG.RAMP || seg === SEG.TUNNEL || seg === SEG.ROUNDABOUT) return;
  if (seg === SEG.CURVE) {
    // A corner immediately beside a T/cross junction already inherits the
    // junction's zebra treatment. Its quarter-arc bars otherwise spill into
    // the crossing and read as stray diagonal arrows (the visual artifact
    // seen after a tight street extension). Keep curve markings on standalone
    // bends, where they describe the lane, and suppress the overlap here.
    if (touchesJunction(c.g, c.x, c.y)) return;
    return curveMarkings(b, c);
  }
  if (seg === SEG.T || seg === SEG.CROSS) return junctionMarkings(b, c);
  if (seg !== SEG.STRAIGHT && seg !== SEG.BRIDGE) return;

  const axis = straightAxis(mask);
  if (!axis) return;
  const onX = axis === 'x';
  const y = seg === SEG.BRIDGE ? ROAD.deckH + 0.015 : MARK_Y;
  const laneSign = c.hasCycle ? c.cycleSide : c.hasParking ? c.parkingSide : 0;
  const edge = (s) => (laneSign !== 0 && s === laneSign ? 0.88 : edgeOffset(c.xs, s));

  for (const s of [-1, 1]) {
    const off = edge(s) * s;
    if (onX) paint(b, box(CELL, 0.03, 0.14, PALETTE.line, p.x, y, p.z + off));
    else paint(b, box(0.14, 0.03, CELL, PALETTE.line, p.x + off, y, p.z));
  }

  if (!c.hasMedian) {
    for (const off of [-1.0, 1.0]) {
      if (onX) paint(b, box(1.4, 0.03, 0.14, PALETTE.line, p.x + off, y, p.z));
      else paint(b, box(0.14, 0.03, 1.4, PALETTE.line, p.x, y, p.z + off));
    }
  }
}

function touchesJunction(g, x, y) {
  for (const d of DIRS) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (g.isRoad(nx, ny) && g.roadDegree(nx, ny) >= 3) return true;
  }
  return false;
}

function curveMarkings(b, c) {
  const { p, mask } = c;
  const dirs = edgeInfo(mask);
  if (dirs.length !== 2) return;
  const sx = dirs.some((d) => d.ox > 0) ? 1 : -1;
  const sz = dirs.some((d) => d.oz > 0) ? 1 : -1;
  const cx = p.x + sx * HALF;
  const cz = p.z + sz * HALF;
  const a0 = Math.atan2(-sz, 0);
  const a1 = Math.atan2(0, -sx);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const r = HALF * 0.95;
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const a = a0 + delta * t;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    paint(
      b,
      box(1.0, 0.03, 0.16, PALETTE.line, cx + dx * r, MARK_Y, cz + dz * r, -Math.atan2(dz, dx))
    );
  }
}

function junctionMarkings(b, c) {
  const { p, mask, g, x, y } = c;
  for (const d of DIRS) {
    if (!(mask & d.bit)) continue;
    // A tight staircase of junction cells can otherwise paint two full zebra
    // sets into the same short approach, producing the stacked white block
    // seen in the initial layout and after a bad one-cell branch. One clean
    // crossing owns an approach; a neighbouring junction leaves that approach
    // to its own marking pass.
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (g.isRoad(nx, ny) && g.roadDegree(nx, ny) >= 3) continue;
    const onX = d.dx !== 0;
    const outer = hasWalk(g, x, y, -d.dx, -d.dy) && hasWalk(g, x, y, d.dx, d.dy) ? 3.0 : 3.7;
    paint(
      b,
      onX
        ? box(0.16, 0.03, outer, PALETTE.line, p.x + d.dx * 1.02, MARK_Y, p.z)
        : box(outer, 0.03, 0.16, PALETTE.line, p.x, MARK_Y, p.z + d.dy * 1.02)
    );
    for (let i = 0; i < 5; i++) {
      const dist = 1.28 + i * 0.3;
      const px = p.x + d.dx * dist;
      const pz = p.z + d.dy * dist;
      paint(
        b,
        onX
          ? box(0.22, 0.03, outer, PALETTE.line, px, MARK_Y, pz)
          : box(outer, 0.03, 0.22, PALETTE.line, px, MARK_Y, pz)
      );
    }
  }
}

export function addMedian(b, c) {
  if (!c.hasMedian || !c.axis) return;
  const { p, axis } = c;
  const onX = axis === 'x';
  const w = onX ? CELL : ROAD.medianHalf * 2;
  const d = onX ? ROAD.medianHalf * 2 : CELL;
  struct(b, box(w, ROAD.medianH, d, PALETTE.curb, p.x, ROAD.medianH / 2, p.z));
  const inset = 0.08;
  struct(
    b,
    box(
      onX ? CELL - 0.1 : ROAD.medianHalf * 2 - inset,
      ROAD.medianH + 0.02,
      onX ? ROAD.medianHalf * 2 - inset : CELL - 0.1,
      jitterColor(RP.medianBed, c.rng, 0.05),
      p.x,
      ROAD.medianH / 2 + 0.02,
      p.z
    )
  );
  if (c.run && c.run.start % 2 === 0) {
    struct(
      b,
      sphere(
        0.18,
        jitterColor(RP.medianDry, c.rng, 0.06),
        p.x,
        ROAD.medianH + 0.17,
        p.z,
        7,
        5
      )
    );
  }
}

export function addCycleLane(b, c) {
  if (!c.hasCycle || !c.axis) return;
  const s = c.cycleSide;
  const { p, axis } = c;
  const onX = axis === 'x';
  const mid = (ROAD.cycleInner + ROAD.cycleOuter) / 2;
  const width = ROAD.cycleOuter - ROAD.cycleInner;
  const lat = s * mid;
  const px = onX ? p.x : p.x + lat;
  const pz = onX ? p.z + lat : p.z;
  paint(b, box(onX ? CELL : width, 0.03, onX ? width : CELL, RP.cycleLane, px, ROAD.asphaltH + 0.012, pz));

  const sep = s * (ROAD.cycleInner - 0.07);
  for (const off of [-1.0, 1.0]) {
    paint(
      b,
      onX
        ? box(1.4, 0.03, 0.1, PALETTE.line, p.x + off, MARK_Y, p.z + sep)
        : box(0.1, 0.03, 1.4, PALETTE.line, p.x + sep, MARK_Y, p.z + off)
    );
  }

  const gy = ROAD.asphaltH + 0.032;
  for (const off of [-0.34, 0.34]) {
    const gx = onX ? p.x + off : p.x + lat;
    const gz = onX ? p.z + lat : p.z + off;
    paint(b, box(onX ? 0.5 : 0.09, 0.02, onX ? 0.09 : 0.5, RP.cycleGlyph, gx, gy, gz));
  }
  paint(
    b,
    box(onX ? 0.1 : 0.36, 0.02, onX ? 0.36 : 0.1, RP.cycleGlyph, px, gy, pz)
  );
}

export function addParkingLane(b, c) {
  if (!c.hasParking || !c.axis) return;
  const s = c.parkingSide;
  const { p, axis } = c;
  const onX = axis === 'x';
  const mid = (ROAD.parkingInner + ROAD.parkingOuter) / 2;
  const width = ROAD.parkingOuter - ROAD.parkingInner;
  const lat = s * mid;
  const px = onX ? p.x : p.x + lat;
  const pz = onX ? p.z + lat : p.z;
  paint(b, box(onX ? CELL : width, 0.028, onX ? width : CELL, RP.parkingBay, px, ROAD.asphaltH + 0.01, pz));

  const lineLat = s * (ROAD.parkingInner - 0.05);
  paint(
    b,
    onX
      ? box(CELL, 0.03, 0.12, PALETTE.line, p.x, MARK_Y, p.z + lineLat)
      : box(0.12, 0.03, CELL, PALETTE.line, p.x + lineLat, MARK_Y, p.z)
  );

  for (const off of [-1.0, 1.0]) {
    paint(
      b,
      onX
        ? box(0.1, 0.03, width, PALETTE.line, p.x + off, MARK_Y, pz)
        : box(width, 0.03, 0.1, PALETTE.line, px, MARK_Y, p.z + off)
    );
  }
}

export function addDrainage(b, c) {
  const { p, axis, g, x, y } = c;
  if (!axis) return;
  if (c.seg === SEG.BRIDGE || c.seg === SEG.RAMP || c.seg === SEG.TUNNEL) return;
  const onX = axis === 'x';
  for (const [dx, dz] of lateralDirs(axis)) {
    if (!hasWalk(g, x, y, dx, dz)) continue;
    const s = dx !== 0 ? dx : dz;
    if ((c.hasCycle && c.cycleSide === s) || (c.hasParking && c.parkingSide === s)) continue;
    const lat = s * kerbOffset(c.xs, s);
    const gx = onX ? p.x : p.x + lat;
    const gz = onX ? p.z + lat : p.z;
    paint(b, box(onX ? CELL : 0.16, 0.028, onX ? 0.16 : CELL, RP.gutter, gx, ROAD.asphaltH + 0.008, gz));
    if (c.run && c.run.start % 2 === 0) {
      paint(
        b,
        box(
          onX ? 0.5 : 0.3,
          0.034,
          onX ? 0.3 : 0.5,
          RP.grate,
          onX ? p.x : p.x + lat,
          ROAD.asphaltH + 0.014,
          onX ? p.z + lat : p.z
        )
      );
    }
  }
}

export function addBridgeStructure(b, c) {
  const { p, axis } = c;
  const crossX = axis === 'z';
  const deckTop = ROAD.deckH;
  for (const sign of [-1, 1]) {
    const lat = sign * (HALF - 0.13);
    const px = crossX ? p.x + lat : p.x;
    const pz = crossX ? p.z : p.z + lat;
    struct(b, box(crossX ? 0.26 : CELL, 0.72, crossX ? CELL : 0.26, RP.concrete, px, deckTop + 0.36, pz));
    struct(
      b,
      box(crossX ? 0.34 : CELL, 0.1, crossX ? CELL : 0.34, RP.concreteLight, px, deckTop + 0.77, pz)
    );
  }

  const pierTop = deckTop - 0.4;
  for (const off of [-0.95, 0.95]) {
    const px = crossX ? p.x : p.x + off;
    const pz = crossX ? p.z + off : p.z;
    const h = pierTop + 0.55;
    struct(b, box(crossX ? 0.9 : 0.7, h, crossX ? 0.7 : 0.9, RP.pier, px, pierTop - h / 2, pz));
  }
}

export function addRampStructure(b, c) {
  const { p, ramp, axis } = c;
  if (!ramp) return;
  const crossX = axis === 'z';
  const rot = rampRotation(ramp);
  for (const sign of [-1, 1]) {
    const lat = sign * (HALF - 0.13);
    const px = crossX ? p.x + lat : p.x;
    const pz = crossX ? p.z : p.z + lat;
    struct(
      b,
      boxEuler(
        crossX ? 0.26 : CELL,
        0.72,
        crossX ? CELL : 0.26,
        RP.concrete,
        [px, (ROAD.deckH + ROAD.asphaltH) / 2 + 0.36, pz],
        rot
      )
    );
  }
}

export function addRoundabout(b, c) {
  const { p, mask } = c;
  const R = ROAD.roundaboutR;
  struct(b, cyl(R + 0.1, R + 0.14, 0.34, RP.islandBed, p.x, 0.17, p.z, 26));
  struct(b, cyl(R, R, 0.36, RP.island, p.x, 0.19, p.z, 26));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + c.rng.float(0, 0.6);
    const rr = R * c.rng.float(0.3, 0.72);
    struct(
      b,
      sphere(
        c.rng.float(0.13, 0.22),
        jitterColor(RP.mound, c.rng, 0.06),
        p.x + Math.cos(a) * rr,
        0.45,
        p.z + Math.sin(a) * rr,
        7,
        5
      )
    );
  }

  const ringR = 1.35;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    paint(
      b,
      box(
        0.5,
        0.03,
        0.13,
        PALETTE.line,
        p.x + Math.cos(a) * ringR,
        ROAD.deckH > 0 ? MARK_Y : MARK_Y,
        p.z + Math.sin(a) * ringR,
        -a
      )
    );
  }

  for (const d of DIRS) {
    if (!(mask & d.bit)) continue;
    const onX = d.dx !== 0;
    for (const o of [-0.5, 0.5]) {
      const px = p.x + d.dx * 1.7 + (onX ? 0 : o);
      const pz = p.z + d.dy * 1.7 + (onX ? o : 0);
      paint(b, box(onX ? 0.14 : 0.66, 0.03, onX ? 0.66 : 0.14, PALETTE.line, px, MARK_Y, pz));
    }
  }
}

export function addDeadEnd(b, c) {
  const { p, openDir } = c;
  if (!openDir) return;
  const onX = openDir[0] !== 0;
  const perp = [-openDir[1], openDir[0]];

  paint(
    b,
    onX
      ? box(0.18, 0.03, 3.4, RP.deadEnd, p.x + openDir[0] * 1.5, MARK_Y, p.z)
      : box(3.4, 0.03, 0.18, RP.deadEnd, p.x, MARK_Y, p.z + openDir[1] * 1.5)
  );
  for (const s of [-1, 1]) {
    paint(
      b,
      onX
        ? box(0.5, 0.03, 0.5, RP.deadEnd, p.x + openDir[0] * 1.0, MARK_Y, p.z + s * 1.1)
        : box(0.5, 0.03, 0.5, RP.deadEnd, p.x + s * 1.1, MARK_Y, p.z + openDir[1] * 1.0)
    );
  }

  for (const s of [-1, 1]) {
    const bx = p.x + openDir[0] * 1.85 + perp[0] * s * 1.45;
    const bz = p.z + openDir[1] * 1.85 + perp[1] * s * 1.45;
    struct(b, cyl(0.1, 0.12, 0.7, RP.signalPole, bx, 0.35, bz, 8));
    struct(b, cyl(0.14, 0.14, 0.1, RP.signRed, bx, 0.74, bz, 8));
  }

  const sx = p.x + openDir[0] * 0.9 + perp[0] * 1.72;
  const sz = p.z + openDir[1] * 0.9 + perp[1] * 1.72;
  struct(b, cyl(0.05, 0.06, 2.2, RP.signPole, sx, 1.1, sz, 6));
  const nx = -perp[0];
  const nz = -perp[1];
  const sign = makeSign('DEAD END', { width: 1.6, height: 0.4, bg: '#a83232' });
  sign.material.side = THREE.DoubleSide;
  sign.position.set(sx + nx * 0.05, 2.0, sz + nz * 0.05);
  sign.rotation.y = Math.atan2(nx, nz);
  b.extras.push(sign);
}

export function addTunnel(b, c) {
  const { p, axis, g } = c;
  if (!axis) return;
  const crossX = axis === 'z';
  for (const sign of [-1, 1]) {
    const lat = sign * (HALF - 0.13);
    const px = crossX ? p.x + lat : p.x;
    const pz = crossX ? p.z : p.z + lat;
    struct(
      b,
      box(crossX ? 0.26 : CELL, ROAD.tunnelWallH, crossX ? CELL : 0.26, RP.tunnel, px, ROAD.tunnelWallH / 2, pz)
    );
    struct(
      b,
      box(crossX ? 0.3 : CELL, 0.14, crossX ? CELL : 0.3, RP.tunnelDark, px, ROAD.tunnelWallH + 0.07, pz)
    );
  }

  struct(b, box(CELL + 0.3, 0.45, CELL + 0.3, RP.concrete, p.x, ROAD.tunnelWallH + 0.22, p.z));
  struct(b, box(CELL, 0.7, CELL, RP.mound, p.x, ROAD.tunnelWallH + 0.78, p.z));
  struct(b, box(CELL - 1.5, 0.7, CELL - 1.5, RP.moundDark, p.x, ROAD.tunnelWallH + 1.46, p.z));

  if (c.run && c.run.start % 2 === 1) {
    struct(
      b,
      sphere(
        0.4,
        jitterColor(RP.mound, c.rng, 0.07),
        p.x + c.rng.float(-0.7, 0.7),
        ROAD.tunnelWallH + 1.95,
        p.z + c.rng.float(-0.7, 0.7),
        7,
        5
      )
    );
  }

  for (const [dx, dz] of alongDirs(axis)) {
    if (g.featureAt(c.x + dx, c.y + dz) === ROAD_FEATURE.TUNNEL) continue;
    const ex = p.x + dx * HALF;
    const ez = p.z + dz * HALF;
    for (const s of [-1, 1]) {
      const jx = crossX ? ex : p.x + s * (HALF + 0.2);
      const jz = crossX ? p.z + s * (HALF + 0.2) : ez;
      struct(b, box(0.5, 3.4, 0.5, RP.concrete, jx, 1.7, jz));
    }
    struct(
      b,
      crossX
        ? box(0.5, 0.9, CELL + 1.0, RP.concrete, ex, 3.0, ez)
        : box(CELL + 1.0, 0.9, 0.5, RP.concrete, ex, 3.0, ez)
    );
  }
}

export function addStreetLight(b, c) {
  if (!c.lamp) return;
  const { p, g, x, y, lamp } = c;
  const dx = lamp.dx;
  const dz = lamp.dz;
  if (!hasWalk(g, x, y, dx, dz)) return;
  const side = dx !== 0 ? dx : dz;
  const narrow =
    (c.hasCycle && c.cycleSide === side) || (c.hasParking && c.parkingSide === side);
  const width = narrow ? ROAD.narrowSidewalk : ROAD.sidewalkW;
  const lat = HALF - width / 2;
  const lx = p.x + dx * lat;
  const lz = p.z + dz * lat;
  struct(b, box(0.34, 0.1, 0.34, RP.signalPole, lx, 0.05, lz));
  struct(b, cyl(0.06, 0.09, 2.9, RP.signalPole, lx, 1.5, lz, 8));
  const yaw = Math.atan2(dz, -dx);
  const ax = Math.cos(yaw);
  const az = -Math.sin(yaw);
  struct(b, box(0.7, 0.1, 0.16, RP.signalPole, lx + ax * 0.3, 2.95, lz + az * 0.3, yaw));
  glow(b, 'lampGlow', box(0.42, 0.2, 0.3, 0xfff2cf, lx + ax * 0.58, 2.86, lz + az * 0.58, yaw));
  glow(b, 'lampGlow', box(0.5, 0.06, 0.36, 0xffe0a0, lx + ax * 0.58, 2.76, lz + az * 0.58, yaw));
}

/** Intersections are bucketed into three phase groups so the town is not all green at once. */
export function signalPhaseGroup(x, y) {
  return hash2(x + 7, y + 29) % 3;
}

/**
 * Signal heads are bucketed `sig:<group>:<axis>:<lamp>` so each phase group can
 * light one axis at a time. Each corner head governs one axis of travel and
 * faces squarely back down that approach (NE/SW corners -> E-W, NW/SE -> N-S),
 * which is what a driver actually reads at the stop line.
 */
export function addTrafficLight(b, c) {
  if (!c.signal) return;
  const { p } = c;
  const group = signalPhaseGroup(c.x, c.y);
  const axes = new Set();
  for (const s of c.signal) {
    const cx = p.x + s.cx * 1.68;
    const cz = p.z + s.cz * 1.68;
    struct(b, box(0.42, 0.12, 0.42, RP.signalPole, cx, 0.06, cz));
    struct(b, cyl(0.07, 0.1, 3.2, RP.signalPole, cx, 1.66, cz, 8));
    const axis = s.cx * s.cz > 0 ? 'z' : 'x';
    const fx = axis === 'x' ? -s.cx : 0;
    const fz = axis === 'z' ? -s.cz : 0;
    axes.add(axis);
    const yaw = Math.atan2(fx, fz);
    struct(b, box(0.3, 1.0, 0.3, RP.signalPole, cx, 2.78, cz, yaw));
    glow(b, `sig:${group}:${axis}:r`, box(0.2, 0.2, 0.08, RP.signalRed, cx + fx * 0.17, 3.1, cz + fz * 0.17, yaw));
    glow(b, `sig:${group}:${axis}:a`, box(0.2, 0.2, 0.08, RP.signalAmber, cx + fx * 0.17, 2.78, cz + fz * 0.17, yaw));
    glow(b, `sig:${group}:${axis}:g`, box(0.2, 0.2, 0.08, RP.signalGreen, cx + fx * 0.17, 2.46, cz + fz * 0.17, yaw));
  }
  if (axes.size) b.signals.push({ x: c.x, y: c.y, group, axes: [...axes] });
}

export function addRoadSign(b, c) {
  if (!c.sign) return;
  const { p, sign } = c;
  const sx = p.x + sign.dx * 1.72;
  const sz = p.z + sign.dz * 1.72;
  struct(b, cyl(0.05, 0.06, 2.2, RP.signPole, sx, 1.1, sz, 6));
  const nx = -sign.dx;
  const nz = -sign.dz;
  const yaw = Math.atan2(nx, nz);

  if (sign.kind === 'street' || sign.kind === 'stop') {
    const mesh = makeSign(sign.text, {
      width: sign.kind === 'street' ? 1.7 : 0.9,
      height: sign.kind === 'street' ? 0.36 : 0.9,
      bg: sign.kind === 'street' ? '#2f6fb5' : '#b03030',
      fg: sign.kind === 'street' ? '#eaf3ff' : '#ffffff'
    });
    mesh.material.side = THREE.DoubleSide;
    mesh.position.set(sx + nx * 0.06, sign.kind === 'street' ? 2.1 : 1.85, sz + nz * 0.06);
    mesh.rotation.y = yaw;
    b.extras.push(mesh);
    return;
  }

  struct(b, box(0.62, 0.62, 0.05, RP.signRed, sx, 2.1, sz, yaw));
  struct(b, box(0.46, 0.46, 0.06, RP.signPlate, sx + nx * 0.02, 2.1, sz + nz * 0.02, yaw));
  struct(b, box(0.08, 0.26, 0.07, 0x2b2f36, sx + nx * 0.04, 2.1, sz + nz * 0.04, yaw));
}

export function addBusStop(b, c) {
  if (!c.bus || !c.axis) return;
  const { p, axis } = c;
  const busSide = c.bus.side || 1;
  const onZ = axis === 'z';
  const dx = onZ ? busSide : 0;
  const dz = onZ ? 0 : busSide;
  const yaw = Math.atan2(dz, -dx);
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const vx = Math.sin(yaw);
  const vz = Math.cos(yaw);
  const lat = HALF + 0.85;
  const bx = p.x + dx * lat;
  const bz = p.z + dz * lat;
  const at = (u, v) => ({ x: bx + ux * u + vx * v, z: bz + uz * u + vz * v });

  const floor = at(0, 0);
  struct(b, box(1.3, 0.1, 2.7, RP.concreteLight, floor.x, 0.05, floor.z, yaw));
  for (const [u, v] of [[-0.55, -1.2], [0.55, -1.2], [-0.55, 1.2], [0.55, 1.2]]) {
    const q = at(u, v);
    struct(b, box(0.09, 2.2, 0.09, RP.shelterFrame, q.x, 1.2, q.z, yaw));
  }
  const roof = at(0, 0);
  struct(b, box(1.7, 0.14, 3.0, RP.shelterRoof, roof.x, 2.35, roof.z, yaw));
  const back = at(-0.6, 0);
  struct(b, box(0.06, 1.5, 2.6, RP.shelterGlass, back.x, 1.0, back.z, yaw));
  const bench = at(-0.25, 0);
  struct(b, box(0.4, 0.08, 2.1, 0x8a6a45, bench.x, 0.56, bench.z, yaw));
  const rest = at(-0.45, 0);
  struct(b, box(0.06, 0.5, 2.1, 0x8a6a45, rest.x, 0.8, rest.z, yaw));

  const pole = at(0.4, -1.55);
  struct(b, cyl(0.05, 0.06, 2.5, RP.signPole, pole.x, 1.25, pole.z, 6));
  const mesh = makeSign('BUS', { width: 0.85, height: 0.5, bg: '#2f7d4f' });
  mesh.material.side = THREE.DoubleSide;
  mesh.position.set(pole.x + nx0(dx) * 0.06, 2.35, pole.z + nz0(dz) * 0.06);
  mesh.rotation.y = Math.atan2(-dx, -dz);
  b.extras.push(mesh);

  const latRoad = busSide * (ROAD.parkingInner - 0.3);
  const mark = (off, w, d) => {
    const gx = onZ ? p.x + latRoad : p.x + off;
    const gz = onZ ? p.z + off : p.z + latRoad;
    paint(b, box(w, 0.03, d, RP.bayLine, gx, MARK_Y, gz));
  };
  mark(0, onZ ? 0.12 : 0.7, onZ ? 0.7 : 0.12);
  for (const off of [-1.6, 1.6]) mark(off, onZ ? 0.7 : 0.12, onZ ? 0.12 : 0.7);
  for (const off of [-0.55, 0.55]) mark(off, onZ ? 0.1 : 0.36, onZ ? 0.36 : 0.1);
}

function nx0(dx) {
  return -dx;
}

function nz0(dz) {
  return -dz;
}

export function addWater(b, c) {
  const { p } = c;
  // The bed overhangs its cell so a lake tiles seamlessly — neighbours cover
  // each other's overhang and only the perimeter keeps the dark shoreline.
  b.add('water', box(CELL + 0.1, 0.18, CELL + 0.1, 0x2c6384, p.x, -0.06, p.z));
  b.add('water', box(CELL, 0.18, CELL, PALETTE.water, p.x, -0.05, p.z));
}
