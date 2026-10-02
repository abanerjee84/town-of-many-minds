import * as THREE from 'three';
import { PALETTE, MAX_FLOORS, CELL } from '../../core/config.js';
import { getSettings } from '../../core/settings.js';
import { box, cyl, sphere, boxEuler, jitterColor } from '../geometry.js';

const FLOOR_H = 2.35;
const BASE_H = 0.3;
// Residential occupancy is a family contract, not a commercial floor-area
// ratio: one tiled footprint houses one three-person family on every floor.
// A three-storey one-tile home therefore holds 9 residents. Multi-cell
// residential archetypes pass `footprintTiles` explicitly from placement;
// direct kit callers can still derive one tile from the physical dimensions.
export const RESIDENTS_PER_TILE_PER_FLOOR = 3;

export function residentialFootprintTiles(params = {}) {
  if (params.footprintTiles != null) {
    return Math.max(1, Math.round(Number(params.footprintTiles) || 1));
  }
  const w = Number(params.w) || CELL;
  const d = Number(params.d) || CELL;
  return Math.max(1, Math.round((w * d) / (CELL * CELL)));
}

export function residentialCapacityPerFloor(params = {}) {
  const density = getSettings().residentsPerTilePerFloor ?? RESIDENTS_PER_TILE_PER_FLOOR;
  return residentialFootprintTiles(params) * density;
}

function gableEnd(d, rise, thickness, color, x, flip) {
  const shape = new THREE.Shape();
  const half = d / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  const offset = flip ? -x + thickness : x;
  geo.translate(offset, 0, 0);
  geo.computeVertexNormals();
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return geo;
}

function windowUnit(out, glassOut, cx, cy, cz, ww, wh, axis, outward, trim) {
  const depth = 0.1;
  if (axis === 'z') {
    out.push(box(ww + 0.18, wh + 0.18, depth, trim, cx, cy, cz + outward * 0.02));
    out.push(box(ww + 0.34, 0.1, 0.26, trim, cx, cy - wh / 2 - 0.13, cz + outward * 0.06));
    glassOut.push(box(ww, wh, 0.08, 0x9fc7e8, cx, cy, cz + outward * 0.06));
    out.push(box(ww, 0.05, 0.1, trim, cx, cy, cz + outward * 0.1));
    out.push(box(0.05, wh, 0.1, trim, cx, cy, cz + outward * 0.1));
  } else {
    out.push(box(depth, wh + 0.18, ww + 0.18, trim, cx + outward * 0.02, cy, cz));
    out.push(box(0.26, 0.1, ww + 0.34, trim, cx + outward * 0.06, cy - wh / 2 - 0.13, cz));
    glassOut.push(box(0.08, wh, ww, 0x9fc7e8, cx + outward * 0.06, cy, cz));
    out.push(box(0.1, wh, 0.05, trim, cx + outward * 0.1, cy, cz));
    out.push(box(0.1, 0.05, ww, trim, cx + outward * 0.1, cy, cz));
  }
}

function doorUnit(out, glassOut, cx, cz, wide, outward, doorColor, trim) {
  const h = 1.85;
  const y = h / 2;
  const wall = 0.14;
  if (outward !== 0) {
    out.push(box(wide + 0.2, h + 0.14, wall, trim, cx, y, cz + outward * 0.03));
    out.push(box(wide, h, 0.1, doorColor, cx, y, cz + outward * 0.08));
    out.push(box(wide * 0.42, h * 0.34, 0.05, 0x9fc7e8, cx, y + h * 0.2, cz + outward * 0.12));
    out.push(sphere(0.06, 0xd9b45a, cx + wide * 0.32, y - 0.1, cz + outward * 0.14, 8, 6));
  } else {
    out.push(box(wall, h + 0.14, wide + 0.2, trim, cx + outward * 0.03, y, cz));
    out.push(box(0.1, h, wide, doorColor, cx + outward * 0.08, y, cz));
    glassOut.push(box(0.05, h * 0.34, wide * 0.42, 0x9fc7e8, cx + outward * 0.12, y + h * 0.2, cz));
    out.push(sphere(0.06, 0xd9b45a, cx + outward * 0.14, y - 0.1, cz + wide * 0.32, 8, 6));
  }
}

function garageDoor(out, cx, cz, wide, outward) {
  const h = 1.9;
  out.push(box(wide + 0.22, h + 0.16, 0.16, 0xe8e4dc, cx, h / 2, cz + outward * 0.04));
  for (let i = 0; i < 4; i++) {
    out.push(
      box(wide, 0.06, 0.08, 0xc9c4bb, cx, 0.3 + i * 0.45, cz + outward * 0.12)
    );
  }
  out.push(box(wide, 0.1, 0.1, 0xb8b2a8, cx, h - 0.1, cz + outward * 0.12));
}

export const BUILDING_PART = [
  'foundation',
  'wall',
  'column',
  'beam',
  'roof',
  'door',
  'window',
  'stair',
  'balcony',
  'entrance',
  'corridor',
  'storefront',
  'garage',
  'porch',
  'canopy',
  'ramp',
  'solar',
  'greenRoof',
  'chimney',
  'sign',
  'other'
];

export const BUILDING_MODULE = [
  'entrance',
  'corridor',
  'stair',
  'balcony',
  'storefront',
  'garage',
  'porch',
  'ramp',
  'solar-roof',
  'green-roof',
  'unit'
];

function sink(arr, parts, role) {
  return {
    push(geo) {
      parts.push({ role, geo });
      arr.push(geo);
      return geo;
    }
  };
}

function tagRole(parts, arr, role, geo) {
  parts.push({ role, geo });
  arr.push(geo);
  return geo;
}

export function buildHouse(params = {}) {
  const rng = params.rng;
  const style = params.style || 'suburban';
  const w = params.w ?? 3.4;
  const d = params.d ?? 3.2;
  const floors =
    params.floors ??
    (params.height != null ? Math.max(1, Math.min(MAX_FLOORS, Math.round(params.height / FLOOR_H))) : 1);
  const wall = params.wall ?? jitterColor(PALETTE.wall[0], rng, 0.08);
  const trim = params.trim ?? PALETTE.trim[0];
  const roofColor = params.roofColor ?? PALETTE.roof[0];
  const doorColor = params.doorColor ?? PALETTE.door[0];
  // TOWER RULE: past six storeys a pitched roof reads as a wedding cake, so
  // tall volumes always take the flat parapet the tower kit dresses. The
  // forced value lands in `spec`, so a rebuild of the same spec is identical.
  const roofType =
    floors > 6
      ? 'flat'
      : (params.roofType ?? (rng ? rng.pick(['gable', 'gable', 'hip', 'flat']) : 'gable'));
  const glass = [];

  const body = [];
  const parts = [];
  const modules = [];
  const P = (role, geo) => tagRole(parts, body, role, geo);
  const wallH = floors * FLOOR_H;

  const purpose =
    params.purpose ??
    (style === 'shop'
      ? 'commercial'
      : style === 'factory'
        ? 'industrial'
        : params.kind === 'office'
          ? 'commercial'
          : 'residential');
  // Civic facilities carry capacityPerFloor (civicParams) — capacity then
  // scales with floors across rebuilds/expansions; everyone else keeps the
  // explicit capacity or falls back to the footprint formula.
  // An office seats more than a shop of the same footprint (desks, not stock)
  // but far less than a civic hall, and it is the floor count that moves it.
  const capacity =
    params.capacityPerFloor != null
      ? Math.max(1, Math.round(params.capacityPerFloor * floors))
      : params.capacity ??
        (style === 'shop'
          ? Math.max(1, Math.round(w * d * floors * 2.2))
          : style === 'factory'
            ? Math.max(1, Math.round(w * d * floors * 1.6))
            : params.kind === 'office'
              ? Math.max(4, Math.round(floors * (w * d * 0.9)))
              : Math.max(1, Math.round(residentialCapacityPerFloor({ ...params, w, d }) * floors)));
  const budget = params.budget ?? 1;

  P('foundation', box(w + 0.16, BASE_H, d + 0.16, 0x8f8a80, 0, BASE_H / 2, 0));
  P('wall', box(w, wallH, d, wall, 0, BASE_H + wallH / 2, 0));

  for (let f = 1; f < floors; f++) {
    const y = BASE_H + f * FLOOR_H;
    P('beam', box(w + 0.1, 0.14, d + 0.1, trim, 0, y, 0));
  }

  const topY = BASE_H + wallH;
  const rows = floors;
  // Wide/deep footprints (multi-cell builds like a mall) get bays across the
  // whole facade; single-cell buildings keep the original 2-bay cap exactly.
  const countX = Math.max(1, Math.min(w > 4 ? 6 : 2, Math.floor((w - 0.5) / 1.15)));
  const countZ = Math.max(1, Math.min(d > 4 ? 6 : 2, Math.floor((d - 0.5) / 1.15)));

  const garageBay = params.garage && floors === 1 && w >= 2.8;
  const winIn = sink(body, parts, 'window');
  const winGlass = sink(glass, parts, 'window');
  // TOWER KIT: above six storeys punched windows read as noise, so every
  // floor over the lobby bands into continuous ribbon glazing (curtain wall).
  const curtainWall = floors > 6 && roofType === 'flat';

  for (let f = 0; f < rows && style !== 'factory'; f++) {
    const y = BASE_H + f * FLOOR_H + FLOOR_H * 0.62;

    if (curtainWall && f > 0) {
      const bh = FLOOR_H * 0.56;
      winGlass.push(box(w - 0.2, bh, 0.07, 0x8fc2e8, 0, y, d / 2 + 0.05));
      winGlass.push(box(w - 0.2, bh, 0.07, 0x8fc2e8, 0, y, -d / 2 - 0.05));
      winGlass.push(box(0.07, bh, d - 0.2, 0x8fc2e8, w / 2 + 0.05, y, 0));
      winGlass.push(box(0.07, bh, d - 0.2, 0x8fc2e8, -w / 2 - 0.05, y, 0));
      continue;
    }

    for (let i = 0; i < countX; i++) {
      const t = (i + 1) / (countX + 1);
      const x = -w / 2 + t * w;
      if (f === 0 && garageBay) {
        if (i === 0) {
          garageDoor(sink(body, parts, 'garage'), x, d / 2, Math.min(1.7, w / countX - 0.2), 1);
          continue;
        }
      }
      if (f === 0 && i === Math.floor(countX / 2) && !garageBay) continue;
      windowUnit(winIn, winGlass, x, y, d / 2, 0.72, 0.92, 'z', 1, trim);
      windowUnit(winIn, winGlass, x, y, -d / 2, 0.72, 0.92, 'z', -1, trim);
    }

    for (let i = 0; i < countZ; i++) {
      const t = (i + 1) / (countZ + 1);
      const z = -d / 2 + t * d;
      windowUnit(winIn, winGlass, w / 2, y, z, 0.7, 0.9, 'x', 1, trim);
      windowUnit(winIn, winGlass, -w / 2, y, z, 0.7, 0.9, 'x', -1, trim);
    }
  }

  if (style === 'factory') {
    // Clerestory strip instead of floor rows: high narrow windows front and
    // back, clear of the loading bay and door below.
    const n = Math.max(3, Math.floor(w / 0.95));
    const cy = topY - 0.5;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const x = -w / 2 + t * w;
      windowUnit(winIn, winGlass, x, cy, d / 2, 0.5, 0.44, 'z', 1, trim);
      windowUnit(winIn, winGlass, x, cy, -d / 2, 0.5, 0.44, 'z', -1, trim);
    }
    // Side-wall vent louvres.
    for (const s of [-1, 1]) {
      P('other', box(0.08, 0.7, 1.2, trim, (s * w) / 2 + s * 0.04, topY - 0.9, -d * 0.1));
    }
  }

  const doorX = style === 'factory' ? w * 0.3 : garageBay ? (w / 2 - 0.55) : 0;
  doorUnit(
    sink(body, parts, 'door'),
    sink(glass, parts, 'door'),
    doorX, d / 2, 0.92, 1, doorColor, trim
  );
  modules.push({ kind: 'entrance', at: [doorX, 0, d / 2], width: 0.92, face: 'front' });
  if (style === 'factory') {
    const bayW = Math.max(0.9, Math.min(1.6, w - 1.6));
    garageDoor(sink(body, parts, 'garage'), -w * 0.18, d / 2, bayW, 1);
    modules.push({ kind: 'loading-bay', at: [-w * 0.18, 0, d / 2], width: bayW, face: 'front' });
  }
  let signY = 0;

  let porchW = 0;
  if (params.porch) {
    const pw = Math.min(w * 0.8, 2.6);
    porchW = pw;
    P('porch', box(pw, 0.16, 1.0, 0xbdb4a4, doorX, 0.16, d / 2 + 0.5));
    P('porch', box(pw, 0.14, 0.34, 0xa89f90, doorX, 0.07, d / 2 + 1.14));
    for (const s of [-1, 1]) {
      P('column', cyl(0.07, 0.07, 2.1, trim, doorX + (s * pw) / 2 - s * 0.1, 1.3, d / 2 + 0.86, 8));
    }
    P('porch', box(pw + 0.2, 0.12, 1.2, roofColor, doorX, 2.4, d / 2 + 0.52));
    modules.push({ kind: 'porch', at: [doorX, 0, d / 2 + 0.5], width: pw });
  }

  // ACCESSIBILITY BLOCK: an entrance ramp and handrails are authored as part
  // of the house so civic, residential, and commercial shells can all request
  // the same inclusive frontage. The ramp stays inside the plot envelope.
  if (params.accessible) {
    const rw = Math.min(1.25, Math.max(0.9, Math.min(w * 0.45, 1.05)));
    P('ramp', box(rw, 0.1, 1.05, 0xb9b3a6, doorX, 0.08, d / 2 + 0.56));
    for (const s of [-1, 1]) {
      P('ramp', cyl(0.035, 0.035, 0.52, trim, doorX + (s * rw) / 2, 0.34, d / 2 + 0.56, 6));
      P('ramp', box(0.05, 0.05, 0.95, trim, doorX + (s * rw) / 2, 0.6, d / 2 + 0.56));
    }
    modules.push({ kind: 'ramp', at: [doorX, 0, d / 2 + 0.56], width: rw });
  }

  // BALCONY BLOCK: a repeatable upper-floor outdoor room. It deliberately
  // uses the front facade and a bounded width, so it cannot exceed a one-cell
  // parcel or collide with the side setback.
  if (params.balcony && floors > 1) {
    const bw = Math.min(w * 0.68, 2.45);
    const balconyY = BASE_H + FLOOR_H * 1 - 0.14;
    const bz = d / 2 + 0.43;
    P('balcony', box(bw, 0.12, 0.82, 0xa9a39a, doorX, balconyY, bz));
    P('canopy', box(bw + 0.12, 0.08, 0.9, roofColor, doorX, balconyY + 1.16, bz + 0.02));
    for (const s of [-1, 1]) {
      P('balcony', cyl(0.04, 0.04, 1.0, trim, doorX + (s * bw) / 2, balconyY + 0.5, bz + 0.33, 6));
      P('balcony', box(bw, 0.05, 0.05, trim, doorX, balconyY + 0.98, bz + 0.33));
    }
    modules.push({ kind: 'balcony', at: [doorX, balconyY, bz], width: bw, floor: 1 });
  }

  let ridge = 0;
  if (roofType === 'flat') {
    P('roof', box(w + 0.24, 0.22, d + 0.24, roofColor, 0, topY + 0.11, 0));
    const par = 0.26;
    P('roof', box(w + 0.3, par, 0.14, trim, 0, topY + 0.3, d / 2 + 0.1));
    P('roof', box(w + 0.3, par, 0.14, trim, 0, topY + 0.3, -d / 2 - 0.1));
    P('roof', box(0.14, par, d + 0.3, trim, w / 2 + 0.1, topY + 0.3, 0));
    P('roof', box(0.14, par, d + 0.3, trim, -w / 2 - 0.1, topY + 0.3, 0));
    P('other', box(0.7, 0.5, 0.7, 0x9aa1a9, w * 0.2, topY + 0.5, -d * 0.15));
    ridge = topY + 0.7;
  } else if (roofType === 'hip') {
    const rise = 0.55 + floors * 0.32;
    const ov = 0.2;
    const geo = new THREE.CylinderGeometry(0.42, 1, 1, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.scale(Math.SQRT2 * (w / 2 + ov), rise, Math.SQRT2 * (d / 2 + ov));
    geo.translate(0, topY + rise / 2, 0);
    const c = new THREE.Color(roofColor);
    const count = geo.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    P('roof', geo);
    ridge = topY + rise;
  } else {
    const rise = 0.75 + floors * 0.35;
    const ov = 0.22;
    const half = d / 2 + ov;
    const slope = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    P('roof',
      boxEuler(w + ov * 2, 0.16, slope, roofColor, [0, topY + rise / 2, half / 2], [ang, 0, 0])
    );
    P('roof',
      boxEuler(w + ov * 2, 0.16, slope, roofColor, [0, topY + rise / 2, -half / 2], [-ang, 0, 0])
    );
    P('roof', box(w + ov * 2 + 0.06, 0.14, 0.3, roofColor, 0, topY + rise + 0.05, 0));
    P('wall', gableEnd(d + ov * 0.4, rise, 0.12, wall, w / 2, false));
    P('wall', gableEnd(d + ov * 0.4, rise, 0.12, wall, w / 2, true));
    P('roof', box(0.3, 0.16, 0.34, roofColor, 0, topY + rise + 0.08, 0));
    ridge = topY + rise;
  }

  // CLIMATE BLOCKS: these are optional kit parts rather than a second building
  // type, so renovations and floor expansions can preserve the same shell.
  if (params.greenRoof && roofType === 'flat') {
    P('greenRoof', box(Math.max(0.8, w - 0.55), 0.09, Math.max(0.8, d - 0.55), 0x5f8d58, 0, topY + 0.28, 0));
    for (const x of [-w * 0.25, w * 0.25]) {
      P('greenRoof', box(0.42, 0.22, 0.42, 0x7ca567, x, topY + 0.45, d * 0.16));
    }
    modules.push({ kind: 'green-roof', at: [0, topY + 0.28, 0], area: Math.max(0.8, w - 0.55) * Math.max(0.8, d - 0.55) });
  }
  if (params.solar) {
    const panelW = Math.min(1.15, Math.max(0.75, w * 0.28));
    const panelD = Math.min(0.72, Math.max(0.55, d * 0.22));
    const panelY = roofType === 'flat' ? topY + 0.34 : topY + 0.2;
    for (const x of [-w * 0.2, w * 0.2]) {
      P('solar', boxEuler(panelW, 0.06, panelD, 0x1f4775, [x, panelY, -d * 0.08], [roofType === 'flat' ? 0 : 0.22, 0, 0]));
    }
    modules.push({ kind: 'solar-roof', at: [0, panelY, -d * 0.08], panels: 2 });
  }
  // TOWER KIT: above eight storeys the lift motor room breaks the parapet —
  // a plant box sitting proud of the flat roof, on the opposite corner from
  // the HVAC unit so the two never interpenetrate.
  if (floors > 8 && roofType === 'flat') {
    const ew = Math.min(1.2, Math.max(0.7, w * 0.4));
    const ed = Math.min(1.2, Math.max(0.7, d * 0.4));
    const eh = 1.15;
    const ex = -w * 0.24;
    const ez = -d * 0.18;
    P('other', box(ew, eh, ed, trim, ex, topY + 0.22 + eh / 2, ez));
    P('other', box(ew + 0.18, 0.16, ed + 0.18, roofColor, ex, topY + 0.22 + eh + 0.08, ez));
    for (const s of [-1, 1]) {
      P('other', box(ew * 0.6, 0.06, 0.08, 0x767c85, ex, topY + 0.22 + eh * 0.6, ez + (s * ed) / 2 + s * 0.04));
    }
    ridge = Math.max(ridge, topY + 0.22 + eh + 0.16);
  }
  modules.push({ kind: 'roof', type: roofType, at: [0, topY, 0], rise: ridge - topY });

  // Budget ladder (rudimentary → advanced): tier 1 is plain, tier 2 adds a
  // cornice band under the roofline, tier 3 adds corner pilasters too. The
  // parcel-derived default (1–2 from setback) sits in this ladder — a better
  // lot buys a higher tier; the council can pin budget=1..3 explicitly.
  if (budget >= 2) {
    P('beam', box(w + 0.16, 0.1, d + 0.16, trim, 0, topY - 0.06, 0));
  }
  if (budget >= 3) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        P('column', box(0.14, wallH, 0.14, trim, (sx * w) / 2, BASE_H + wallH / 2, (sz * d) / 2));
      }
    }
  }

  if (style === 'factory') {
    // Exhaust stack and roof vents — the industrial read from a distance.
    P('chimney', cyl(0.16, 0.2, 2.6, 0x8a9099, -w * 0.3, topY + 1.3, -d * 0.2, 10));
    P('chimney', cyl(0.24, 0.28, 0.2, 0x656b73, -w * 0.3, topY + 2.7, -d * 0.2, 10));
    for (const vx of [-w * 0.05, w * 0.25]) {
      P('other', box(0.5, 0.3, 0.5, 0x9aa1a9, vx, topY + 0.45, d * 0.12));
      P('other', box(0.32, 0.08, 0.32, 0x767c85, vx, topY + 0.64, d * 0.12));
    }

    // INDUSTRY ARCHETYPES: every works keeps the common shell, but its
    // production line gets a type-specific silhouette. These are deliberately
    // lightweight kit parts, recorded as roles/modules so inspectors and a
    // future specialist renderer can distinguish the plant without guessing
    // from its label.
    const factoryType = params.factoryType || 'sawmill';
    const addModule = (kind, at, extra = {}) => modules.push({ kind, at, ...extra });
    if (factoryType === 'steelworks') {
      for (const x of [-w * 0.28, w * 0.28]) {
        P('cooling-tower', cyl(0.58, 0.78, 1.85, 0xb7bdc5, x, topY + 0.92, -d * 0.22, 12));
        P('cooling-tower', cyl(0.28, 0.4, 0.12, 0x737b84, x, topY + 1.88, -d * 0.22, 12));
        addModule('cooling-tower', [x, topY + 0.92, -d * 0.22], { height: 1.85 });
      }
      P('blast-furnace', box(Math.min(1.25, w * 0.18), 2.4, Math.min(1.25, d * 0.2), 0x6f7780, w * 0.28, topY + 1.2, d * 0.13));
      addModule('blast-furnace', [w * 0.28, topY + 1.2, d * 0.13]);
      P('ore-yard', box(Math.min(2.2, w * 0.45), 0.18, Math.min(1.25, d * 0.3), 0x806d58, -w * 0.18, topY + 0.12, d * 0.26));
      addModule('ore-yard', [-w * 0.18, topY + 0.12, d * 0.26]);
    } else if (factoryType === 'cement') {
      for (const x of [-w * 0.28, 0, w * 0.28]) {
        P('silo', cyl(0.42, 0.52, 2.15, 0xd3d0c7, x, topY + 1.08, -d * 0.2, 12));
        P('silo-cap', cyl(0.5, 0.16, 0.14, 0x8a9099, x, topY + 2.2, -d * 0.2, 12));
        addModule('silo', [x, topY + 1.08, -d * 0.2]);
      }
      P('kiln-tower', box(Math.min(1.15, w * 0.2), 2.8, Math.min(1.15, d * 0.2), 0x9a866d, w * 0.25, topY + 1.4, d * 0.16));
      addModule('kiln-tower', [w * 0.25, topY + 1.4, d * 0.16]);
      P('conveyor', box(w * 0.48, 0.14, 0.22, 0x5d646b, 0, topY + 0.68, 0));
      addModule('conveyor', [0, topY + 0.68, 0]);
    } else if (factoryType === 'sawmill' || factoryType === 'furniture') {
      const bayCount = factoryType === 'sawmill' ? 3 : 2;
      for (let i = 0; i < bayCount; i++) {
        const x = -w * 0.3 + (i * w * 0.3);
        P('timber-yard', box(Math.min(1.2, w * 0.18), 0.34, Math.min(1.0, d * 0.2), 0x8b6848, x, topY + 0.23, d * 0.25));
        addModule('timber-yard', [x, topY + 0.23, d * 0.25]);
      }
      // Alternating clerestory caps give a sawmill/textile shed a roof rhythm.
      for (let i = 0; i < bayCount; i++) {
        const x = -w * 0.3 + (i * w * 0.3);
        P('sawtooth-roof', boxEuler(Math.min(1.35, w * 0.2), 0.12, Math.min(d * 0.55, 2.1), roofColor, [x, topY + 0.38, -d * 0.02], [0.22, 0, 0]));
      }
      addModule('sawtooth-roof', [0, topY + 0.38, 0], { bays: bayCount });
      if (factoryType === 'furniture') {
        P('showroom', box(Math.min(1.8, w * 0.35), 0.12, 0.22, 0x6b7580, w * 0.2, topY + 0.62, d / 2 + 0.08));
        addModule('showroom', [w * 0.2, topY + 0.62, d / 2 + 0.08]);
      }
    } else if (factoryType === 'textile') {
      for (let i = 0; i < 4; i++) {
        const x = -w * 0.36 + i * w * 0.24;
        P('sawtooth-roof', boxEuler(Math.min(1.15, w * 0.18), 0.12, Math.min(d * 0.58, 2.4), roofColor, [x, topY + 0.42, 0], [0.2, 0, 0]));
        P('dye-tank', cyl(0.28, 0.34, 0.5, 0x3d7285, x, topY + 0.34, d * 0.24, 10));
      }
      addModule('sawtooth-roof', [0, topY + 0.42, 0], { bays: 4 });
      addModule('dye-tanks', [0, topY + 0.34, d * 0.24], { count: 4 });
    } else if (factoryType === 'software') {
      P('office-tower', box(Math.min(2.1, w * 0.36), Math.min(2.2, Math.max(1.3, floors * 0.22)), Math.min(1.6, d * 0.3), 0x5b7185, -w * 0.22, topY + 0.75, -d * 0.12));
      P('data-hall', box(Math.min(2.2, w * 0.4), 0.34, Math.min(1.7, d * 0.32), 0x3b4d5d, w * 0.18, topY + 0.2, d * 0.16));
      P('cooling-units', box(0.55, 0.38, 0.55, 0x9aa1a9, w * 0.3, topY + 0.48, -d * 0.2));
      addModule('office-tower', [-w * 0.22, topY + 0.75, -d * 0.12], { floors });
      addModule('data-hall', [w * 0.18, topY + 0.2, d * 0.16]);
      addModule('cooling-units', [w * 0.3, topY + 0.48, -d * 0.2]);
    } else {
      P('assembly-hall', box(Math.min(2.4, w * 0.48), 0.22, Math.min(1.3, d * 0.28), 0x65727d, 0, topY + 0.25, 0));
      P('loading-dock', box(Math.min(2.5, w * 0.52), 0.14, 0.5, 0x4b555e, 0, 0.18, d / 2 + 0.28));
      addModule('assembly-hall', [0, topY + 0.25, 0]);
      addModule('loading-dock', [0, 0.18, d / 2 + 0.28]);
      addModule('office-block', [w * 0.3, topY + 0.4, -d * 0.18]);
    }
  }

  if (params.chimney && roofType !== 'flat') {
    P('chimney', box(0.42, 1.1, 0.42, 0xa8624a, w * 0.26, topY + 0.9, -d * 0.18));
    P('chimney', box(0.54, 0.14, 0.54, 0x6f4436, w * 0.26, topY + 1.5, -d * 0.18));
  }

  let shopAw = 0;
  // Phase 20 — an office SHARES the shop kit but not the shop front: it gets
  // the lobby below instead. Both branches read the same wall and glazing.
  if (style === 'shop' && params.kind !== 'office') {
    const aw = Math.min(w - 0.3, w > 4 ? w * 0.7 : 2.8);
    shopAw = aw;
    const shopIn = sink(body, parts, 'storefront');
    const shopGlass = sink(glass, parts, 'storefront');
    P('storefront', boxEuler(aw, 0.1, 0.85, params.awningColor ?? 0xc0392b, [0, 2.1, d / 2 + 0.4], [0.38, 0, 0]));
    P('storefront', box(aw, 0.1, 0.16, trim, 0, 2.3, d / 2 + 0.06));
    if (countX >= 2) {
      windowUnit(shopIn, shopGlass, -w / 4, 1.35, d / 2, 1.1, 1.2, 'z', 1, trim);
      if (countX >= 3) windowUnit(shopIn, shopGlass, w / 4, 1.35, d / 2, 1.1, 1.2, 'z', 1, trim);
      // Extra bays only exist on wide multi-cell facades (countX was capped
      // at 2 before), so single-cell shops render byte-identical to before.
      if (countX >= 4) {
        for (let i = 1; i <= countX - 3; i++) {
          const t = i / (countX - 2);
          windowUnit(shopIn, shopGlass, -w / 2 + w * t, 1.35, d / 2, 1.1, 1.2, 'z', 1, trim);
        }
      }
    }
    modules.push({ kind: 'storefront', at: [0, 1.35, d / 2], width: aw, face: 'front' });
  }

  // Phase 20 (C3b) — the OFFICE facade. Not a shop with a different sign: a
  // lobby band of glazing at street level (a shop has an opaque base and an
  // awning; an office is glass and a canopy), a vertical fin stack up the
  // facade so the floors read as storeys, and a plant box on the parapet. The
  // style is still the shared 'shop' style — the kind, not the kit, is what
  // makes it an office.
  if (params.kind === 'office') {
    const offIn = sink(body, parts, 'lobby');
    const offGlass = sink(glass, parts, 'lobby');
    // Street-level lobby glazing, split by a door in the middle.
    const lobbyW = Math.max(1.2, Math.min(w - 0.5, w > 4 ? w * 0.78 : 2.6));
    const lobbyH = Math.min(1.75, wallH * 0.7);
    const fz = d / 2;
    P('lobby', box(lobbyW, 0.12, 0.12, trim, 0, BASE_H + lobbyH, fz + 0.06));
    P('lobby', box(lobbyW, 0.14, 0.3, trim, 0, BASE_H + lobbyH + 0.14, fz + 0.16));
    for (const s of [-1, 1]) {
      offGlass.push(box(lobbyW / 2 - 0.22, lobbyH, 0.07, 0x8fc2e8, (s * lobbyW) / 4, BASE_H + lobbyH / 2, fz + 0.05));
      offIn.push(box(0.09, lobbyH, 0.09, trim, (s * lobbyW) / 4, BASE_H + lobbyH / 2, fz + 0.03));
    }
    // Entrance canopy on two brackets.
    P('lobby', boxEuler(lobbyW + 0.5, 0.09, 0.95, 0x44505c, [0, BASE_H + lobbyH + 0.2, fz + 0.45], [0.16, 0, 0]));
    for (const s of [-1, 1]) {
      P('lobby', boxEuler(0.07, 0.07, 0.7, trim, [(s * lobbyW) / 2, BASE_H + lobbyH - 0.1, fz + 0.3], [0.7, 0, 0]));
    }
    // One fin per floor above the lobby, centred on each glazing bay.
    for (let f = 1; f < rows; f++) {
      const y = BASE_H + f * FLOOR_H;
      for (const s of [-1, 1]) {
        P('fin', box(0.12, FLOOR_H * 0.82, 0.22, trim, (s * w) / 2 - 0.08, y + FLOOR_H * 0.5, fz + 0.12));
      }
    }
    // Roof plant, so the parapet is not a bare line.
    if (roofType === 'flat') {
      P('roofplant', box(Math.min(1.5, w * 0.4), 0.55, Math.min(1.1, d * 0.4), 0x8d959c, w * 0.16, topY + 0.28, 0));
      P('roofplant', box(0.5, 0.4, 0.5, 0x767d86, -w * 0.2, topY + 0.2, d * 0.16));
    }
    modules.push({ kind: 'lobby', at: [0, BASE_H + lobbyH / 2, fz], width: lobbyW, face: 'front' });
  }

  if (garageBay) modules.push({ kind: 'garage', at: [-w / 2 + w / (countX + 1), 0, d / 2], width: Math.min(1.7, w / countX - 0.2) });
  if (floors > 1) {
    modules.push({ kind: 'stair', at: [-w / 2 + 0.4, 0, -d / 2 + 0.4], rise: wallH, run: d - 0.8 });
  }
  modules.push({ kind: 'corridor', at: [0, 0, 0], length: d, width: Math.min(1.4, w * 0.4) });
  for (let f = 0; f < floors; f++) {
    modules.push({ kind: 'unit', floor: f, at: [0, BASE_H + f * FLOOR_H, 0], capacity: Math.round(capacity / floors) });
  }

  if (params.signText) {
    signY = Math.min(2.75, topY - 0.1);
  }

  const spec = {
    style,
    w,
    d,
    floors,
    roofType,
    wall,
    trim,
    roofColor,
    doorColor,
    awningColor: params.awningColor ?? null,
    porch: !!params.porch,
    garage: !!params.garage,
    accessible: !!params.accessible,
    balcony: !!params.balcony,
    solar: !!params.solar,
    greenRoof: !!params.greenRoof,
    chimney: !!params.chimney,
    purpose,
    capacity,
    capacityPerFloor: params.capacityPerFloor ?? null,
    footprintTiles: params.footprintTiles ?? null,
    budget,
    parcel: params.parcel ?? null,
    facility: params.facility ?? null,
    capacityKind: params.capacityKind ?? null,
    blockId: params.blockId ?? null,
    factoryType: params.factoryType ?? null,
    factoryModules: params.factoryModules ? [...params.factoryModules] : [],
    seed: params.seed ?? null,
    signText: params.signText || null,
    signBg: params.signBg || null,
    name: params.name || null
  };

  return {
    body,
    glow: glass,
    parts,
    modules,
    spec,
    signText: params.signText || null,
    signBg: params.signBg || null,
    signY,
    signW: Math.min(w - 0.4, 2.6),
    size: { w, d },
    floors,
    style,
    purpose,
    capacity,
    budget,
    parcel: spec.parcel,
    height: ridge,
    doorLocal: new THREE.Vector3(doorX, 0, d / 2 + 1.15),
    frontLocal: new THREE.Vector3(0, 0, d / 2),
    name: params.name || null,
    roofType,
    porchW,
    shopAw,
    fxFloorH: FLOOR_H,
    fxBaselineH: BASE_H
  };
}

/**
 * Rebuild a house from its recorded spec, optionally overriding params.
 * Only the parts affected by the override are re-authored; everything else
 * re-derives from the spec, so an identical spec yields an identical house.
 */
export function rebuildHouse(house, overrides = {}) {
  return buildHouse({ ...house.spec, ...overrides });
}

/**
 * Grow a house by whole floors (Phase 5 construction). Returns the new house
 * plus the set of part roles that actually changed, so callers can rebuild
 * only those meshes instead of the whole building.
 */
export function expandHouse(house, { floors = 1 } = {}) {
  const next = Math.max(1, Math.min(MAX_FLOORS, house.floors + floors));
  // Residential floors add another three-person family per tile. Older
  // records may carry an explicit founding capacity, so pin the new
  // per-floor contract when a home grows instead of replaying that old flat
  // capacity on every added storey.
  const residential = house.spec?.purpose === 'residential';
  const grown = rebuildHouse(house, {
    floors: next,
    ...(residential ? { capacityPerFloor: residentialCapacityPerFloor(house.spec) } : {})
  });
  return { house: grown, changed: changedRoles(house, grown), floorsDelta: next - house.floors };
}

function geoHash(geo) {
  const a = geo.attributes.position.array;
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) {
    h ^= Math.round(a[i] * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function changedRoles(a, b) {
  const tally = (h) => {
    const hashes = {};
    const counts = {};
    for (const p of h.parts) {
      hashes[p.role] = (hashes[p.role] || 0) ^ geoHash(p.geo);
      counts[p.role] = (counts[p.role] || 0) + 1;
    }
    return { hashes, counts };
  };
  const A = tally(a);
  const B = tally(b);
  const out = new Set();
  for (const r of new Set([...Object.keys(A.hashes), ...Object.keys(B.hashes)])) {
    if (
      (A.hashes[r] || 0) !== (B.hashes[r] || 0) ||
      (A.counts[r] || 0) !== (B.counts[r] || 0)
    ) {
      out.add(r);
    }
  }
  return [...out];
}

export const HOUSE_STYLES = ['suburban', 'townhouse', 'shop', 'cottage'];

/**
 * Phase 20 (C3b) — the building KINDS the planner can commission. `office` is
 * a commercial building that earns from desks rather than footfall, so it
 * shares the 'shop' kit and differs in kind, purpose and how the economy
 * counts it.
 */
export const BUILDING_KINDS = ['house', 'shop', 'office', 'civic', 'park', 'factory', 'landmark'];
