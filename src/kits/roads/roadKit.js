import * as THREE from 'three';
import { CELL, CELL_KIND, PALETTE } from '../../core/config.js';
import { N, E, S, W } from '../../core/grid.js';
import { merge } from '../geometry.js';
import {
  sharedLampGlow,
  sharedSignalRed,
  sharedSignalAmber,
  sharedSignalGreen,
  unregisterGlow
} from '../glow.js';
import { SignalController } from '../../core/signals.js';
import {
  SEG,
  SEG_LABEL,
  SEG_SHORT,
  addBridgeStructure,
  addBusStop,
  addCycleLane,
  addDeadEnd,
  addDrainage,
  addLaneMarkings,
  addMedian,
  addParkingLane,
  addRampStructure,
  addRoadSign,
  addRoundabout,
  addSidewalks,
  addStreetLight,
  addSurface,
  addTrafficLight,
  addTunnel,
  bridgeNeighbor,
  classify,
  edgeInfo,
  hash2,
  streetNameFor,
  straightAxis,
  straightRun
} from './components.js';
import { composeCrossSection, crossSectionSummary } from './crossSection.js';
import { RoadGraph } from '../../core/roadGraph.js';

const HALF = CELL / 2;

const EDGE_DIR = {
  [N]: [0, -1],
  [E]: [1, 0],
  [S]: [0, 1],
  [W]: [-1, 0]
};

const CORNERS = [
  [N | E, 1, -1],
  [E | S, 1, 1],
  [S | W, -1, 1],
  [W | N, -1, -1]
];

const COMPONENT_ORDER = [
  'Sidewalk',
  'Lane',
  'Lane markings',
  'Crosswalk',
  'Median',
  'Cycle Lane',
  'Parking Lane',
  'Drainage',
  'Street Light',
  'Traffic Light',
  'Road Sign',
  'Bus Stop',
  'Straight',
  'Curve',
  'T-Junction',
  'Four-Way Junction',
  'Isolated',
  'Bridge',
  'Bridge Ramp',
  'Tunnel',
  'Roundabout',
  'Dead End',
  'Water'
];

function cw(dir) {
  return { dx: -dir[1], dz: dir[0] };
}

function ccw(dir) {
  return { dx: dir[1], dz: -dir[0] };
}

export class RoadKit {
  constructor(grid, rng) {
    this.grid = grid;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    this.pickables = [];
    this.signMeshes = [];
    this.cellInfo = new Map();
    this.xsByCell = new Map();
    this.graph = new RoadGraph();
    this.signals = null;
    this.signalMeshes = [];
    this.waterMeshes = [];
    this.stats = { tiles: 0, components: {} };
  }

  hasSidewalk(x, y, dx, dy) {
    const nx = x + dx;
    const ny = y + dy;
    if (!this.grid.inBounds(nx, ny)) return true;
    return !this.grid.isRoad(nx, ny);
  }

  releaseSigns() {
    for (const m of this.signMeshes) {
      unregisterGlow(m.material);
      m.material.map?.dispose();
      m.material.dispose();
      m.geometry.dispose();
    }
    this.signMeshes = [];
  }

  releaseWaterMeshes() {
    for (const m of this.waterMeshes) {
      m.geometry?.dispose();
      m.material?.dispose();
    }
    this.waterMeshes = [];
  }

  build() {
    this.releaseWaterMeshes();
    this.group.clear();
    this.pickables = [];
    this.releaseSigns();
    this.cellInfo = new Map();
    this.xsByCell = new Map();

    const buckets = {
      asphalt: [],
      walks: [],
      marks: [],
      structs: [],
      water: [],
      lampGlow: []
    };
    const sigBuckets = {};
    const signalCells = [];
    const extras = [];
    const waterCells = [];
    const counts = {};
    const bump = (k, n = 1) => {
      counts[k] = (counts[k] || 0) + n;
    };

    const b = {
      extras,
      signals: signalCells,
      add(name, geo) {
        if (!geo) return;
        if (name.startsWith('sig:')) (sigBuckets[name] || (sigBuckets[name] = [])).push(geo);
        else if (buckets[name]) buckets[name].push(geo);
      }
    };

    let tiles = 0;

    this.grid.forEach((x, y, g) => {
      if (g.kindAt(x, y) === CELL_KIND.WATER) {
        waterCells.push([x, y]);
        bump('Water');
        return;
      }
      if (!g.isRoad(x, y)) return;

      tiles++;
      const c = this.makeContext(g, x, y);
      this.decorate(c);
      this.dispatch(b, c);
      const xs = c.xs;
      this.xsByCell.set(`${x},${y}`, xs);
      const names = [SEG_LABEL[c.seg] || c.seg];
      if (c.seg === SEG.STRAIGHT) names.push('Straight');
      if (c.hasSidewalks) names.push('Sidewalk');
      if (c.hasMarks) names.push('Lane markings');
      if (c.seg === SEG.T || c.seg === SEG.CROSS) names.push('Crosswalk');
      if (c.hasMedian) names.push('Median');
      if (c.hasCycle) names.push('Cycle Lane');
      if (c.hasParking) names.push('Parking Lane');
      if (c.hasDrain) names.push('Drainage');
      if (c.lamp) names.push('Street Light');
      if (c.signal) names.push('Traffic Light');
      if (c.sign) names.push('Road Sign');
      if (c.bus) names.push('Bus Stop');
      this.cellInfo.set(`${x},${y}`, {
        names: [...new Set(names)],
        street: c.seg === SEG.STRAIGHT && c.axis ? streetNameFor(x, y) : null,
        seg: c.seg,
        cls: xs.cls,
        section: crossSectionSummary(xs),
        xs
      });
      bump(SEG_SHORT[c.seg] || c.seg);
      bump('Lane', xs.lanes);
      if (c.hasMedian) bump('Median');
      if (c.hasCycle) bump('Cycle Lane');
      if (c.hasParking) bump('Parking Lane');
      if (c.signal) bump('Traffic Light');
      if (c.lamp) bump('Street Light');
      if (c.sign) bump('Road Sign');
      if (c.bus) bump('Bus Stop');
      if (c.hasDrain) bump('Drainage');
      if (c.hasSidewalks) bump('Sidewalk');
      if (c.hasMarks) bump('Lane markings');
      if (c.seg === SEG.T || c.seg === SEG.CROSS) bump('Crosswalk');
    });

    this.stats.tiles = tiles;
    this.stats.components = {};
    for (const k of COMPONENT_ORDER) if (counts[k]) this.stats.components[k] = counts[k];

    this.graph.build(this.grid, { cellInfo: this.cellInfo, xsByCell: this.xsByCell });
    this.stats.graph = this.graph.stats();

    const waterMeshes = createWaterBodyMeshes(this.grid, waterCells);
    for (const mesh of waterMeshes) {
      this.waterMeshes.push(mesh);
      this.group.add(mesh);
    }

    this.emit(buckets, extras, sigBuckets, signalCells);
    return this.group;
  }

  cellRng(x, y) {
    return this.rng.fork(((x + 1) * 73856093) ^ ((y + 1) * 19349663));
  }

  makeContext(g, x, y) {
    const mask = g.roadAt(x, y);
    const axis = straightAxis(mask);
    const seg = classify(g, x, y);
    const feature = g.featureAt(x, y);
    return {
      grid: g,
      g,
      x,
      y,
      p: g.cellToWorld(x, y),
      mask,
      axis,
      seg,
      feature,
      // Phase 7 — an upgraded corridor stores its ladder CODE on the cell
      // (0 = derive it from the run); the composer converts it once.
      clsOverride: g.roadClassCode ? g.roadClassCode(x, y) : 0,
      rng: this.cellRng(x, y),
      run: axis ? straightRun(g, x, y, axis) : null,
      hasMedian: false,
      hasCycle: false,
      cycleSide: 0,
      hasParking: false,
      parkingSide: 0,
      hasSidewalks: false,
      hasMarks: false,
      hasDrain: false,
      lamp: null,
      bus: null,
      signal: null,
      sign: null,
      openDir: null,
      ramp: seg === SEG.RAMP ? bridgeNeighbor(g, x, y) : null
    };
  }

  decorate(c) {
    const { x, y, mask, seg, axis, run } = c;

    c.xs = composeCrossSection(c);
    c.hasMedian = c.xs.median;
    c.hasCycle = !!c.xs.cycle;
    c.cycleSide = c.xs.cycle;
    c.hasParking = !!c.xs.parking;
    c.parkingSide = c.xs.parking;

    if (seg === SEG.DEAD_END && mask) c.openDir = findOpenDir(mask);

    if (seg === SEG.STRAIGHT && run) {
      const rh = run.hash;

      if (run.start % 2 === 0) {
        const side = (rh >> 7) & 1 ? 1 : -1;
        c.lamp = axis === 'z' ? { dx: side, dz: 0 } : { dx: 0, dz: side };
      }

      if (run.total >= 4 && run.start === Math.floor(run.total / 2) && rh % 4 === 3) {
        let side = (rh >> 9) & 1 ? 1 : -1;
        const lampOn = c.lamp && (axis === 'z' ? c.lamp.dx : c.lamp.dz) === side;
        if (lampOn) side = -side;
        if (c.hasCycle && c.cycleSide === side) side = -side;
        c.bus = { side };
      }

      const signRoll = (rh >>> 11) % 6;
      if (run.start === 1 && signRoll === 0) {
        c.sign = pickSignSide(c, axis, 'street', streetNameFor(x, y));
      } else if (run.start % 4 === 2 && signRoll === 1) {
        c.sign = pickSignSide(c, axis, 'speed', null);
      }
    }

    if (seg === SEG.CURVE) {
      const h = hash2(x + 91, y + 17);
      if (h % 5 < 3) {
        const open = openSides(mask);
        const s = open.length ? open[h % open.length] : [0, 1];
        c.lamp = { dx: s[0], dz: s[1] };
      }
      if (h % 7 === 0) {
        const open = openSides(mask);
        const s = open.length ? open[(h >>> 3) % open.length] : [0, 1];
        c.sign = { kind: 'speed', text: null, dx: s[0], dz: s[1] };
      }
    }

    if (seg === SEG.T || seg === SEG.CROSS) {
      const degree = popcount(mask);
      const present = CORNERS.filter(([bits]) => (mask & bits) === bits);
      const rest = CORNERS.filter(([bits]) => (mask & bits) !== bits);
      const chosen = present.concat(rest).slice(0, degree);
      const h = hash2(x + 13, y + 47);
      const wantsSignal = seg === SEG.CROSS || h % 3 !== 0;
      if (wantsSignal) {
        c.signal = chosen.map(([, cx, cz]) => ({ cx, cz }));
      } else {
        const stem = openSides(mask)[0] || [1, 0];
        c.sign = { kind: 'stop', text: 'STOP', dx: stem[0], dz: stem[1] };
      }
    }
  }

  dispatch(b, c) {
    const { seg } = c;
    c.hasSidewalks = c.xs.sidewalk;
    c.hasMarks = seg !== SEG.RAMP && seg !== SEG.TUNNEL && seg !== SEG.ROUNDABOUT;
    c.hasDrain = c.xs.drainage;

    addSurface(b, c);
    addSidewalks(b, c);
    addLaneMarkings(b, c);
    addMedian(b, c);
    addCycleLane(b, c);
    addParkingLane(b, c);
    addDrainage(b, c);

    if (seg === SEG.BRIDGE) addBridgeStructure(b, c);
    else if (seg === SEG.RAMP) addRampStructure(b, c);
    else if (seg === SEG.ROUNDABOUT) addRoundabout(b, c);
    else if (seg === SEG.TUNNEL) addTunnel(b, c);
    else if (seg === SEG.DEAD_END) addDeadEnd(b, c);

    addStreetLight(b, c);
    addTrafficLight(b, c);
    addRoadSign(b, c);
    addBusStop(b, c);
  }

  emit(buckets, extras, sigBuckets = {}, signalCells = []) {
    const addMesh = (geo, material, name, opts = {}) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      m.castShadow = opts.castShadow ?? false;
      m.receiveShadow = opts.receiveShadow ?? true;
      if (opts.pick) {
        m.userData.pick = opts.pick;
        this.pickables.push(m);
      }
      this.group.add(m);
      return m;
    };

    addMesh(merge(buckets.asphalt), standard(0xffffff, 0.92), 'road-asphalt', {
      pick: { type: 'road' }
    });
    addMesh(merge(buckets.walks), standard(0xffffff, 0.9), 'road-sidewalks', { castShadow: true });
    addMesh(merge(buckets.marks), standard(0xffffff, 0.7), 'road-marks');
    addMesh(merge(buckets.structs), standard(0xffffff, 0.86), 'road-structs', { castShadow: true });
    addMesh(merge(buckets.water), standard(0xffffff, 0.3, { metalness: 0.15 }), 'road-water');
    addMesh(merge(buckets.lampGlow), sharedLampGlow, 'road-lamps');

    const LAMP = {
      r: { mat: sharedSignalRed, name: 'red' },
      a: { mat: sharedSignalAmber, name: 'amber' },
      g: { mat: sharedSignalGreen, name: 'green' }
    };
    this.signalMeshes = [];
    for (const key of Object.keys(sigBuckets)) {
      const [, group, axis, lamp] = key.split(':');
      const meta = LAMP[lamp];
      const geo = merge(sigBuckets[key]);
      if (!meta || !geo) continue;
      const m = addMesh(geo, meta.mat, `road-signal-${group}-${axis}-${meta.name}`);
      if (m) this.signalMeshes.push({ mesh: m, group: Number(group), axis, lamp: meta.name });
    }
    this.signals = new SignalController(signalCells, this.signalMeshes);

    for (const m of extras) {
      this.signMeshes.push(m);
      this.group.add(m);
    }
  }

  static laneVector(mask, dirBit) {
    const e = edgeInfo(mask).find((d) => d.bit === dirBit);
    if (!e) return { x: 0, z: 0 };
    return { x: e.ox / HALF, z: e.oz / HALF };
  }
}

function standard(color, roughness, opts = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color,
    roughness,
    metalness: opts.metalness ?? 0.02
  });
}

/**
 * Build one visual water body for each connected set of water cells.  Water
 * cells stay square in the simulation because zoning, bridges and resource
 * accounting all depend on the grid.  The visible body is a separate rounded
 * polygon: its dark shore hides tile seams and its slightly inset surface has
 * deterministic shoreline variation, so a lake reads as an organic feature
 * without changing the authoritative tile layout.
 */
function createWaterBodyMeshes(grid, waterCells) {
  if (!waterCells.length) return [];
  const water = new Set(waterCells.map(([x, y]) => `${x},${y}`));
  const components = [];
  const unseen = new Set(water);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (unseen.size) {
    const start = unseen.values().next().value;
    unseen.delete(start);
    const queue = [start];
    const cells = [];
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      const [x, y] = key.split(',').map(Number);
      cells.push([x, y]);
      for (const [dx, dy] of dirs) {
        const next = `${x + dx},${y + dy}`;
        if (unseen.delete(next)) queue.push(next);
      }
    }
    components.push(cells);
  }

  const meshes = [];
  for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
    const component = components[componentIndex];
    const loop = largestBoundaryLoop(component, water, grid);
    if (loop.length < 3) continue;

    const shoreShape = roundedShape(loop, grid, 0);
    const centre = loop.reduce((sum, p) => ({ x: sum.x + p.x, z: sum.z + p.z }), { x: 0, z: 0 });
    centre.x /= loop.length;
    centre.z /= loop.length;
    const surfacePoints = loop.map((p, i) => {
      const dx = p.x - centre.x;
      const dz = p.z - centre.z;
      const length = Math.hypot(dx, dz) || 1;
      // Keep the variation smaller than the shore inset. This adds a natural
      // edge without allowing the surface to spill over adjacent land cells.
      const wave = Math.sin((i + 1) * 2.17 + component.length * 0.31 + componentIndex) * CELL * 0.08;
      const inset = CELL * 0.18;
      const scale = Math.max(0.78, 1 - inset / length);
      return {
        x: centre.x + dx * scale + (dx / length) * wave,
        z: centre.z + dz * scale + (dz / length) * wave
      };
    });
    const surfaceShape = roundedShape(surfacePoints, grid, CELL * 0.08);

    const shore = new THREE.Mesh(
      new THREE.ShapeGeometry(shoreShape),
      new THREE.MeshStandardMaterial({
        color: 0x244f68,
        roughness: 0.78,
        metalness: 0.04,
        side: THREE.DoubleSide
      })
    );
    shore.name = `road-water-shore-${componentIndex}`;
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = 0.006;
    shore.receiveShadow = true;

    const surface = new THREE.Mesh(
      new THREE.ShapeGeometry(surfaceShape),
      new THREE.MeshStandardMaterial({
        color: PALETTE.water,
        roughness: 0.2,
        metalness: 0.12,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide
      })
    );
    surface.name = `road-water-surface-${componentIndex}`;
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.045;
    surface.receiveShadow = true;
    meshes.push(shore, surface);
  }
  return meshes;
}

function largestBoundaryLoop(component, water, grid) {
  const edges = new Map();
  const addEdge = (sx, sy, ex, ey) => {
    const start = `${sx},${sy}`;
    // Diagonal-only contacts can make two loops share a corner. Keep the
    // first edge here; the component itself is four-connected, so the common
    // case remains a single unambiguous shoreline.
    if (!edges.has(start)) edges.set(start, [ex, ey]);
  };
  for (const [x, y] of component) {
    if (!water.has(`${x},${y - 1}`)) addEdge(x, y, x + 1, y);
    if (!water.has(`${x + 1},${y}`)) addEdge(x + 1, y, x + 1, y + 1);
    if (!water.has(`${x},${y + 1}`)) addEdge(x + 1, y + 1, x, y + 1);
    if (!water.has(`${x - 1},${y}`)) addEdge(x, y + 1, x, y);
  }

  const loops = [];
  const unused = new Set(edges.keys());
  while (unused.size) {
    const start = unused.values().next().value;
    let current = start;
    const loop = [];
    const guard = edges.size + 4;
    for (let i = 0; i < guard; i++) {
      const edge = edges.get(current);
      if (!edge) break;
      const [sx, sy] = current.split(',').map(Number);
      loop.push(cornerWorld(grid, sx, sy));
      unused.delete(current);
      current = `${edge[0]},${edge[1]}`;
      if (current === start) break;
    }
    if (loop.length >= 3 && current === start) loops.push(loop);
    else break;
  }
  loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  return loops[0] || [];
}

function cornerWorld(grid, x, y) {
  return {
    x: (x - grid.w / 2) * CELL,
    z: (y - grid.h / 2) * CELL
  };
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function roundedShape(points, grid, extraRadius = 0) {
  const shape = new THREE.Shape();
  const n = points.length;
  const entries = points.map((point, i) => {
    const previous = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const beforeLength = Math.hypot(previous.x - point.x, previous.z - point.z) || CELL;
    const afterLength = Math.hypot(next.x - point.x, next.z - point.z) || CELL;
    const radius = Math.min(CELL * 0.38 + extraRadius, beforeLength * 0.3, afterLength * 0.3);
    return {
      point,
      incoming: {
        x: point.x + (previous.x - point.x) * radius / beforeLength,
        z: point.z + (previous.z - point.z) * radius / beforeLength
      },
      outgoing: {
        x: point.x + (next.x - point.x) * radius / afterLength,
        z: point.z + (next.z - point.z) * radius / afterLength
      }
    };
  });
  // ShapeGeometry is created in XY and rotated onto the XZ ground plane. The
  // negated second coordinate keeps world +Z pointing in the expected direction.
  const first = entries[0].outgoing;
  shape.moveTo(first.x, -first.z);
  for (const entry of entries) {
    shape.lineTo(entry.incoming.x, -entry.incoming.z);
    shape.quadraticCurveTo(entry.point.x, -entry.point.z, entry.outgoing.x, -entry.outgoing.z);
  }
  shape.closePath();
  return shape;
}

function popcount(m) {
  let n = 0;
  if (m & N) n++;
  if (m & E) n++;
  if (m & S) n++;
  if (m & W) n++;
  return n;
}

function findOpenDir(mask) {
  for (const [bit, dx, dz] of [
    [N, 0, -1],
    [E, 1, 0],
    [S, 0, 1],
    [W, -1, 0]
  ]) {
    if (mask & bit) return [-dx, -dz];
  }
  return null;
}

function openSides(mask) {
  const out = [];
  if (!(mask & N)) out.push([0, -1]);
  if (!(mask & E)) out.push([1, 0]);
  if (!(mask & S)) out.push([0, 1]);
  if (!(mask & W)) out.push([-1, 0]);
  return out;
}

function pickSignSide(c, axis, kind, text) {
  const h = hash2(c.x + 211, c.y + 7);
  let side = h & 1 ? 1 : -1;
  if (c.lamp) {
    const lampSide = axis === 'z' ? c.lamp.dx : c.lamp.dz;
    if (lampSide === side) side = -side;
  }
  if (c.hasCycle && c.cycleSide === side) side = -side;
  const dir = axis === 'z' ? { dx: side, dz: 0 } : { dx: 0, dz: side };
  return { kind, text, dx: dir.dx, dz: dir.dz };
}

export function roadCellsWithKind(grid) {
  return grid.roadCells().filter(([x, y]) => grid.kindAt(x, y) === CELL_KIND.ROAD);
}

export function roadDirBit(dx, dy) {
  if (dy < 0) return N;
  if (dy > 0) return S;
  if (dx > 0) return E;
  return W;
}

export { EDGE_DIR };
