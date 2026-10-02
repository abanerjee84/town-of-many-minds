import { CELL, CELL_KIND, ZONE } from '../core/config.js';
import { classAt } from '../kits/roads/components.js';

export const PARCEL_TYPE = {
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  CIVIC: 'civic',
  INDUSTRIAL: 'industrial',
  PARK: 'park',
  PUBLIC: 'public',
  VACANT: 'vacant'
};

export const PARCEL_TYPE_LABEL = {
  residential: 'Residential parcel',
  commercial: 'Commercial parcel',
  civic: 'Civic parcel',
  industrial: 'Industrial plot',
  park: 'Park parcel',
  public: 'Public space',
  vacant: 'Vacant parcel'
};

export const PARCEL_USE = {
  BUILDING: 'building',
  DRIVEWAY: 'driveway',
  PARKING: 'parking',
  COURTYARD: 'courtyard',
  GARDEN: 'garden',
  PUBLIC: 'public space',
  OPEN: 'open'
};

const SETBACK = {
  commercial: 0.25,
  civic: 0.55,
  residential: 0.2,
  // Works set back from the footway like a civic plot: a sawmill hard against
  // the pavement is the tell that a cell was mistyped as VACANT (0.3) and
  // never recognised as industry at all.
  industrial: 0.5,
  park: 0,
  public: 0,
  vacant: 0.3
};

/**
 * Phase 13 (C4) — the road-class term: public ground a frontage gives the
 * street beyond its own type setback. Derived from what the neighbour's
 * cross-section renders — its walk width — plus a band for the traffic the
 * class runs past the lot line (alley 1 lane … boulevard 3 lanes + median +
 * cycle). Monotonic up the ladder, so every rung climbed pushes the building
 * a little further back and the clearance only ever grows.
 */
const CLASS_VERGE = { alley: 0.42, local: 0.46, street: 0.5, avenue: 0.56, boulevard: 0.62 };

/** How much extra setback a ladder class demands (0 off-ladder/special). */
export function classVerge(cls) {
  return CLASS_VERGE[cls] || 0;
}

const FRONT_DIRS = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 4],
  [-1, 0, 8]
];

const keyOf = (x, y) => `${x},${y}`;

/**
 * The class term for one parcel: the biggest ladder verge among its ROAD
 * frontage cells (paths and off-ladder junctions contribute nothing). The
 * class comes from `classAt` — the stored ladder code, else the same
 * composeCrossSection the renderer will use — so it works at seed time,
 * before the Road kit stage has run, and again after an upgrade rewrites
 * the cells.
 *
 * Biggest across the whole direction, not the first road neighbour found:
 * the old `break` sampled whichever cell the subdivision happened to emit
 * first, so a plot fronting a boulevard AND an alley took the alley's verge
 * whenever the alley's cell came first in the array. Order-dependent setbacks
 * are the bug; the docstring always promised the biggest.
 */
function frontageVerge(cells, frontage, g) {
  let term = 0;
  for (const f of frontage) {
    for (const [x, y] of cells) {
      const nx = x + f.dx;
      const ny = y + f.dy;
      if (!g.isRoad(nx, ny)) continue;
      const v = classVerge(classAt(g, nx, ny));
      if (v > term) term = v;
    }
  }
  return term;
}

function zoneTypeOf(g, x, y) {
  if (!g.inBounds(x, y)) return null;
  if (g.kindAt(x, y) === CELL_KIND.PLAZA) return PARCEL_TYPE.PUBLIC;
  if (g.kindAt(x, y) === CELL_KIND.PARK) return PARCEL_TYPE.PARK;
  const z = g.zone[g.idx(x, y)];
  if (z === ZONE.CIVIC) return PARCEL_TYPE.CIVIC;
  if (z === ZONE.COMMERCIAL) return PARCEL_TYPE.COMMERCIAL;
  // Industry is a parcel type in its own right. Without this the branch fell
  // through to VACANT, so every works was typed as a vacant plot: it took the
  // vacant setback, `decorate` handed it a residential driveway, and it never
  // counted as served, so it got no parking.
  if (z === ZONE.INDUSTRIAL) return PARCEL_TYPE.INDUSTRIAL;
  if (z === ZONE.RESIDENTIAL) return PARCEL_TYPE.RESIDENTIAL;
  return null;
}

function zoneType(g, cells) {
  for (const [x, y] of cells) {
    const t = zoneTypeOf(g, x, y);
    if (t && t !== PARCEL_TYPE.VACANT) return t;
  }
  return PARCEL_TYPE.VACANT;
}

function findBlocks(g) {
  const seen = new Uint8Array(g.w * g.h);
  const blocks = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y);
      if (seen[i] || g.kind[i] === CELL_KIND.ROAD || g.kind[i] === CELL_KIND.WATER) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[i] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!g.inBounds(nx, ny)) continue;
          const ni = g.idx(nx, ny);
          if (seen[ni]) continue;
          const nk = g.kind[ni];
          if (nk === CELL_KIND.ROAD || nk === CELL_KIND.WATER) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      blocks.push(cells);
    }
  }
  return blocks;
}

function subdivide(cells, inBlock, r) {
  const sorted = cells.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const used = new Set();
  const out = [];
  const mayPair = cells.length >= 4;
  for (const [x, y] of sorted) {
    const k = keyOf(x, y);
    if (used.has(k)) continue;
    used.add(k);
    let pair = null;
    if (mayPair && r.chance(0.62)) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nk = keyOf(x + dx, y + dy);
        if (!inBlock.has(nk) || used.has(nk)) continue;
        pair = [x + dx, y + dy];
        used.add(nk);
        break;
      }
    }
    out.push(pair ? [[x, y], pair] : [[x, y]]);
  }
  return out;
}

/**
 * Parcel Kit: road layout yields blocks, blocks subdivide into plots, and each
 * plot carries the attributes (setback / driveway / parking / courtyard /
 * garden / public space) that the building kit and lot renderer consume.
 */
export class ParcelKit {
  constructor() {
    this.parcels = [];
    this.cellIndex = new Map();
    this.blockCount = 0;
  }

  clear() {
    this.parcels = [];
    this.cellIndex = new Map();
    this.blockCount = 0;
  }

  at(x, y) {
    const i = this.cellIndex.get(keyOf(x, y));
    return i === undefined ? null : this.parcels[i];
  }

  count(type) {
    let n = 0;
    for (const p of this.parcels) if (!type || p.type === type) n++;
    return n;
  }

  stats() {
    const types = {};
    let cells = 0;
    for (const p of this.parcels) {
      types[p.type] = (types[p.type] || 0) + 1;
      cells += p.cells.length;
    }
    return {
      parcels: this.parcels.length,
      blocks: this.blockCount,
      cells,
      subdivided: this.parcels.filter((p) => p.subdivided).length,
      driveways: this.parcels.filter((p) => p.driveway).length,
      parking: this.parcels.filter((p) => p.parking).length,
      courtyards: this.parcels.filter((p) => p.courtyard).length,
      gardens: this.parcels.filter((p) => p.garden).length,
      publicSpace: this.parcels.filter((p) => p.publicSpace).length,
      types
    };
  }

  build(town, rng) {
    this.clear();
    const g = town.grid;
    const roadKit = town.roadKit;
    const blocks = findBlocks(g);
    this.blockCount = blocks.length;
    let id = 0;

    blocks.forEach((cells, blockIdx) => {
      const inBlock = new Set(cells.map(([x, y]) => keyOf(x, y)));
      const r = rng.fork(4100 + blockIdx);
      const plots = subdivide(cells, inBlock, r);

      for (const plot of plots) {
        const rr = rng.fork(((id + 1) * 2654435761) >>> 0);
        const parcel = this.makeParcel(id++, plot, plots.length > 1 && plot.length > 1, g, roadKit, rr);
        this.parcels.push(parcel);
        for (const [x, y] of plot) this.cellIndex.set(keyOf(x, y), parcel.id);
      }
    });

    for (const p of this.parcels) this.decorate(p, g, rng.fork(9173 + p.id));
    return this;
  }

  makeParcel(id, cells, subdivided, g, roadKit, r) {
    const type = zoneType(g, cells);
    const frontage = [];
    const streets = new Set();

    for (const [x, y] of cells) {
      for (const [dx, dy, bit] of FRONT_DIRS) {
        // Frontage: a street OR a footway — inland plots become buildable
        // once a path reaches them.
        if (!g.isRoad(x + dx, y + dy) && !g.isPath(x + dx, y + dy)) continue;
        if (!frontage.some((f) => f.dx === dx && f.dy === dy)) frontage.push({ dx, dy, bit });
        const info = roadKit?.cellInfo?.get(keyOf(x + dx, y + dy));
        if (info?.street) streets.add(info.street);
      }
    }

    const buildable =
      frontage.length > 0 && type !== PARCEL_TYPE.PARK && type !== PARCEL_TYPE.PUBLIC;

    let setback = SETBACK[type] ?? 0.25;
    if (buildable && cells.length > 1) setback += 0.15;
    // Phase 13 — the frontage's road class pulls the lot line back too.
    const classTerm = buildable ? frontageVerge(cells, frontage, g) : 0;
    setback += classTerm;

    return {
      id,
      cells,
      type,
      subdivided,
      frontage,
      street: streets.size === 1 ? [...streets][0] : null,
      setback: Math.round(setback * 100) / 100,
      classTerm,
      buildable,
      area: cells.length * CELL * CELL,
      driveway: null,
      parking: false,
      courtyard: false,
      garden: false,
      publicSpace: type === PARCEL_TYPE.PARK || type === PARCEL_TYPE.PUBLIC,
      use: PARCEL_USE.OPEN
    };
  }

  decorate(p, g, r) {
    if (!p.buildable) {
      p.use = p.publicSpace ? PARCEL_USE.PUBLIC : PARCEL_USE.OPEN;
      if (p.type === PARCEL_TYPE.PARK) p.garden = r.chance(0.6);
      return;
    }

    const front = p.frontage[0];
    const isDriveable = p.type === PARCEL_TYPE.RESIDENTIAL || p.type === PARCEL_TYPE.VACANT;
    // Works are served like a shop: a yard where lorries can stand. They are
    // deliberately NOT driveable — a suburban driveway is the wrong read for a
    // factory plot, and `p.parking` below is what gives it hardstanding.
    const isServed =
      p.type === PARCEL_TYPE.COMMERCIAL ||
      p.type === PARCEL_TYPE.CIVIC ||
      p.type === PARCEL_TYPE.INDUSTRIAL;

    if (isDriveable && r.chance(0.62)) {
      p.driveway = { dx: front.dx, dy: front.dy };
    }
    if (isServed && r.chance(0.7)) p.parking = true;
    else if (p.driveway && p.cells.length > 1 && r.chance(0.4)) p.parking = true;

    if (p.cells.length > 1 && r.chance(0.4)) p.courtyard = true;
    if (p.type === PARCEL_TYPE.RESIDENTIAL && !p.courtyard && r.chance(0.55)) p.garden = true;
    if (p.frontage.length >= 2 && r.chance(0.22)) p.publicSpace = true;

    if (p.courtyard) p.use = PARCEL_USE.COURTYARD;
    else if (p.parking) p.use = PARCEL_USE.PARKING;
    else if (p.driveway) p.use = PARCEL_USE.DRIVEWAY;
    else if (p.garden) p.use = PARCEL_USE.GARDEN;
    else p.use = PARCEL_USE.BUILDING;
  }

  /**
   * Phase 13 — re-derive every buildable parcel's setback from the classes
   * now running past it (after a road upgrade re-writes the cells). Done
   * in place, so driveway/parking decoration and ids never reshuffle.
   */
  reclassSetbacks(town) {
    const g = town.grid;
    for (const p of this.parcels) {
      if (!p.buildable) continue;
      const term = frontageVerge(p.cells, p.frontage, g);
      let s = (SETBACK[p.type] ?? 0.25) + term;
      if (p.cells.length > 1) s += 0.15;
      p.classTerm = term;
      p.setback = Math.round(s * 100) / 100;
    }
    return this;
  }

  /**
   * Re-derive the type (and everything that follows from it) for the parcels
   * covering `cells`, after a build has established a new zone on them.
   *
   * Parcel types are computed once at build time from the seed zoning, but a
   * later build writes its own zone onto its footprint (createBuilding does).
   * Without this the two disagree: a works raised on a residential parcel keeps
   * the residential setback AND the residential driveway, and the validator's
   * parcel census reports industry it cannot see. Only parcels whose type
   * actually changed are touched, and decoration is narrowed rather than
   * re-rolled — a driveway that is wrong for the new type is dropped, a
   * parking bay that is still valid is kept, and nothing RNG-dependent runs
   * again, so seeded replays do not reshuffle.
   */
  retypeCells(town, cells) {
    const g = town.grid;
    const seen = new Set();
    for (const [x, y] of cells) {
      const p = this.at(x, y);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      const type = zoneType(g, p.cells);
      if (!type || type === p.type) continue;
      p.type = type;
      p.buildable = p.frontage.length > 0 && type !== PARCEL_TYPE.PARK && type !== PARCEL_TYPE.PUBLIC;
      let s = (SETBACK[type] ?? 0.25) + (p.classTerm || 0);
      if (p.buildable && p.cells.length > 1) s += 0.15;
      p.setback = Math.round(s * 100) / 100;
      if (p.driveway && type !== PARCEL_TYPE.RESIDENTIAL && type !== PARCEL_TYPE.VACANT) p.driveway = null;
      if (
        p.parking &&
        type !== PARCEL_TYPE.COMMERCIAL &&
        type !== PARCEL_TYPE.CIVIC &&
        type !== PARCEL_TYPE.INDUSTRIAL
      ) {
        p.parking = false;
      }
      if (p.use === PARCEL_USE.DRIVEWAY && !p.driveway) p.use = PARCEL_USE.BUILDING;
      else if (p.use === PARCEL_USE.PARKING && !p.parking) p.use = PARCEL_USE.BUILDING;
    }
    return this;
  }

  /** The cell a building should sit on: a road-facing cell of the parcel. */
  buildableCell(p) {
    if (!p || !p.buildable) return null;
    for (const [x, y] of p.cells) {
      for (const [dx, dy] of FRONT_DIRS) {
        if (!p.frontage.some((f) => f.dx === dx && f.dy === dy)) continue;
        return [x, y];
      }
    }
    return p.cells[0];
  }

  /** The cell reserved as courtyard / garden when the parcel is subdivided. */
  rearCell(p) {
    if (!p || p.cells.length < 2) return null;
    return p.cells[p.cells.length - 1];
  }

  describe(x, y) {
    const p = this.at(x, y);
    if (!p) return null;
    return {
      id: p.id,
      type: p.type,
      label: PARCEL_TYPE_LABEL[p.type] || p.type,
      cells: p.cells.length,
      subdivided: p.subdivided,
      area: p.area,
      setback: p.setback,
      classTerm: p.classTerm || 0,
      street: p.street,
      frontage: p.frontage.length,
      driveway: !!p.driveway,
      parking: p.parking,
      courtyard: p.courtyard,
      garden: p.garden,
      publicSpace: p.publicSpace,
      use: p.use,
      buildable: p.buildable
    };
  }
}
