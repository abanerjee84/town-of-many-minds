import { CELL, CELL_KIND, ROAD } from './config.js';

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export const ROAD_FEATURE = {
  NONE: 0,
  BRIDGE: 1,
  TUNNEL: 2,
  ROUNDABOUT: 3,
  DEAD_END: 4
};

export const ROAD_FEATURE_LABEL = {
  [ROAD_FEATURE.NONE]: '',
  [ROAD_FEATURE.BRIDGE]: 'Bridge',
  [ROAD_FEATURE.TUNNEL]: 'Tunnel',
  [ROAD_FEATURE.ROUNDABOUT]: 'Roundabout',
  [ROAD_FEATURE.DEAD_END]: 'Dead end'
};

export const DIRS = [
  { bit: N, dx: 0, dy: -1, opposite: S },
  { bit: E, dx: 1, dy: 0, opposite: W },
  { bit: S, dx: 0, dy: 1, opposite: N },
  { bit: W, dx: -1, dy: 0, opposite: E }
];

/** Size of the kind tally — one slot per CELL_KIND, plus headroom. */
const KIND_SLOTS = 8;

export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.kind = new Uint8Array(w * h);
    this.roadMask = new Uint8Array(w * h);
    this.roadFeature = new Uint8Array(w * h);
    // Phase 7 — an upgraded road class, as an XS_CLASS_ORDER code (0 = none,
    // 1 = alley … 5 = boulevard). Cells that stop being roads drop their code.
    this.roadClass = new Uint8Array(w * h);
    // Phase 8 — an upzoned cell (0 = base density, 1 = upzoned): the land-use
    // family marks it, and housing built on it starts taller. Land only —
    // computeRoadMask drops the flag when the cell becomes road or water.
    this.density = new Uint8Array(w * h);
    this.zone = new Array(w * h).fill(null);
    this.owner = new Array(w * h).fill(null);
    this.tint = new Float32Array(w * h);
    // Running tally of cell kinds, maintained by `setKind`. "How many road
    // tiles" and "how many park cells" were both answered by walking the whole
    // grid — and the HUD asks for them every rendered frame, which on a large
    // extent meant a full grid traversal at 60 Hz for a number that changes
    // only when a tile is actually repainted. `setKind` is the only writer
    // (the one raw `kind[i] =` in placementController is a net-zero save and
    // restore), so keeping the count here cannot drift from the array.
    this.kindCounts = new Uint32Array(KIND_SLOTS);
    this.kindCounts[CELL_KIND.EMPTY] = w * h;
  }

  /** How many cells carry this kind. O(1). */
  countOf(k) {
    return k >= 0 && k < KIND_SLOTS ? this.kindCounts[k] : 0;
  }

  /**
   * Rebuild the kind tally from the array.
   *
   * `setKind` is the only thing that maintains it, so any code that writes
   * `kind` directly — a snapshot restore does exactly that — can leave the tally
   * describing a grid that no longer exists. This is the repair, and it is a
   * single linear pass, so it belongs on the rare paths that need it rather than
   * in `setKind`.
   */
  recountKinds() {
    this.kindCounts.fill(0);
    for (let i = 0; i < this.kind.length; i++) {
      const k = this.kind[i];
      if (k >= 0 && k < KIND_SLOTS) this.kindCounts[k]++;
    }
    return this;
  }

  get roadCount() {
    return this.kindCounts[CELL_KIND.ROAD];
  }

  idx(x, y) {
    return y * this.w + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  kindAt(x, y) {
    return this.inBounds(x, y) ? this.kind[this.idx(x, y)] : -1;
  }

  setKind(x, y, k) {
    if (!this.inBounds(x, y)) return;
    // Guard the WRITE, not just the read. `countOf` already range-checked, but
    // the write did not: an out-of-range kind decremented the old cell's counter
    // and then had its increment silently dropped, permanently corrupting the
    // tally with no throw and no warning. Every `kind` is a `CELL_KIND`, so this
    // should never fire — which is exactly why it must be loud rather than
    // silent when it does.
    if (k < 0 || k >= KIND_SLOTS) {
      console.error(`[tomm] setKind got out-of-range kind ${k}; grid tally left untouched`);
      return;
    }
    const i = this.idx(x, y);
    const prev = this.kind[i];
    if (prev === k) return;
    this.kind[i] = k;
    this.kindCounts[prev]--;
    this.kindCounts[k]++;
  }

  isRoad(x, y) {
    return this.kindAt(x, y) === CELL_KIND.ROAD;
  }

  isPath(x, y) {
    return this.kindAt(x, y) === CELL_KIND.PATH;
  }

  isFree(x, y) {
    return this.kindAt(x, y) === CELL_KIND.EMPTY;
  }

  roadAt(x, y) {
    return this.inBounds(x, y) ? this.roadMask[this.idx(x, y)] : 0;
  }

  connect(x, y, bit) {
    if (this.inBounds(x, y)) this.roadMask[this.idx(x, y)] |= bit;
  }

  computeRoadMask() {
    this.roadMask.fill(0);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (!this.isRoad(x, y)) {
          if (this.roadClass[i]) this.roadClass[i] = 0;
          if (this.kind[i] === CELL_KIND.WATER && this.density[i]) this.density[i] = 0;
          continue;
        }
        if (this.density[i]) this.density[i] = 0;
        for (const d of DIRS) {
          const nx = x + d.dx;
          const ny = y + d.dy;
          if (this.isRoad(nx, ny)) this.connect(x, y, d.bit);
        }
      }
    }
  }

  roadDegree(x, y) {
    const m = this.roadAt(x, y);
    let n = 0;
    if (m & N) n++;
    if (m & E) n++;
    if (m & S) n++;
    if (m & W) n++;
    return n;
  }

  /**
   * A junction, not a plain run of street: degree 3+, or a degree-2 BEND (a
   * corner turns traffic; a straight does not). The old second clause tested
   * for a mask with neither N/S nor E/W bits, which no cell this grid can
   * produce ever has — it was unreachable, and every bend read as
   * non-intersection. Degree 0/1 (isolated/stub) is not an intersection.
   */
  isIntersection(x, y) {
    const d = this.roadDegree(x, y);
    if (d !== 2) return d >= 3;
    const m = this.roadAt(x, y);
    const straightNS = (m & (N | S)) === (N | S);
    const straightEW = (m & (E | W)) === (E | W);
    return !straightNS && !straightEW;
  }

  featureAt(x, y) {
    return this.inBounds(x, y) ? this.roadFeature[this.idx(x, y)] : ROAD_FEATURE.NONE;
  }

  setFeature(x, y, f) {
    if (this.inBounds(x, y)) this.roadFeature[this.idx(x, y)] = f;
  }

  clearFeatures() {
    this.roadFeature.fill(ROAD_FEATURE.NONE);
  }

  /** Stored upgrade code for this cell (0 = derive the class from the run). */
  roadClassCode(x, y) {
    return this.inBounds(x, y) ? this.roadClass[this.idx(x, y)] : 0;
  }

  setRoadClassCode(x, y, code) {
    if (this.inBounds(x, y)) this.roadClass[this.idx(x, y)] = code | 0;
  }

  clearRoadClasses() {
    this.roadClass.fill(0);
  }

  /** Upzone flag for this cell (0 = base density, 1 = upzoned). */
  densityAt(x, y) {
    return this.inBounds(x, y) ? this.density[this.idx(x, y)] : 0;
  }

  setDensity(x, y, v) {
    if (this.inBounds(x, y)) this.density[this.idx(x, y)] = v ? 1 : 0;
  }

  clearDensity() {
    this.density.fill(0);
  }

  isWater(x, y) {
    return this.kindAt(x, y) === CELL_KIND.WATER;
  }

  cellHeight(x, y) {
    if (!this.inBounds(x, y)) return 0;
    const f = this.featureAt(x, y);
    if (f === ROAD_FEATURE.BRIDGE) return ROAD.deckH;
    if (f !== ROAD_FEATURE.NONE) return ROAD.asphaltH;
    for (const d of DIRS) {
      if (this.featureAt(x + d.dx, y + d.dy) === ROAD_FEATURE.BRIDGE) {
        return (ROAD.asphaltH + ROAD.deckH) / 2;
      }
    }
    return ROAD.asphaltH;
  }

  heightAtWorld(px, pz) {
    const { x, y } = this.worldToCell(px, pz);
    if (!this.inBounds(x, y)) return 0;
    const p = this.cellToWorld(x, y);
    const f = this.featureAt(x, y);
    if (f === ROAD_FEATURE.BRIDGE) return ROAD.deckH;
    if (f !== ROAD_FEATURE.NONE) return ROAD.asphaltH;
    for (const d of DIRS) {
      if (this.featureAt(x + d.dx, y + d.dy) !== ROAD_FEATURE.BRIDGE) continue;
      const along = d.dx !== 0 ? (px - p.x) * d.dx : (pz - p.z) * d.dy;
      const t = Math.min(1, Math.max(0, (along + CELL / 2) / CELL));
      return ROAD.asphaltH + (ROAD.deckH - ROAD.asphaltH) * t;
    }
    return ROAD.asphaltH;
  }

  /** True when a world point lies on asphalt (lane, junction box or arm mouth), not pavement. */
  isCarriageway(px, pz, half = 1.55) {
    const { x, y } = this.worldToCell(px, pz);
    if (!this.isRoad(x, y)) return false;
    const c = this.cellToWorld(x, y);
    const lx = px - c.x;
    const lz = pz - c.z;
    const ax = Math.abs(lx);
    const az = Math.abs(lz);
    if (ax < half && az < half) return true;
    const m = this.roadAt(x, y);
    if (ax < half && ((m & N && lz < 0) || (m & S && lz > 0))) return true;
    if (az < half && ((m & W && lx < 0) || (m & E && lx > 0))) return true;
    return false;
  }

  roadCells() {
    const out = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isRoad(x, y)) out.push([x, y]);
      }
    }
    return out;
  }

  neighbors4(x, y) {
    const out = [];
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (this.inBounds(nx, ny)) out.push([nx, ny, d]);
    }
    return out;
  }

  cellToWorld(x, y) {
    return {
      x: (x - this.w / 2 + 0.5) * CELL,
      z: (y - this.h / 2 + 0.5) * CELL
    };
  }

  worldToCell(px, pz) {
    return {
      x: Math.floor(px / CELL + this.w / 2),
      y: Math.floor(pz / CELL + this.h / 2)
    };
  }

  forEach(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) fn(x, y, this);
    }
  }
}
