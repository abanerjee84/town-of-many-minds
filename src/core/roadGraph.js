import { CELL } from './config.js';
import { N, E, S, W, ROAD_FEATURE } from './grid.js';

const DIR_BITS = [
  [N, 0, -1],
  [E, 1, 0],
  [S, 0, 1],
  [W, -1, 0]
];

const key = (x, y) => `${x},${y}`;

function degree(mask) {
  let n = 0;
  if (mask & N) n++;
  if (mask & E) n++;
  if (mask & S) n++;
  if (mask & W) n++;
  return n;
}

function dirBit(px, py, cx, cy) {
  if (cy < py) return N;
  if (cy > py) return S;
  if (cx > px) return E;
  return W;
}

/**
 * Road graph: nodes at junctions / dead ends / isolated tiles / roundabouts,
 * edges as chains of ordinary road cells between them.
 * Rebuilt wholesale whenever RoadKit.build() runs, so runtime road edits
 * refresh the graph automatically.
 */
export class RoadGraph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.nodeCells = new Map();
    this.linkCell = new Map();
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this.nodeCells = new Map();
    this.linkCell = new Map();
  }

  nodeAt(x, y) {
    const id = this.nodeCells.get(key(x, y));
    return id === undefined ? null : id;
  }

  edgeAt(x, y) {
    const id = this.linkCell.get(key(x, y));
    return id === undefined ? null : this.edges[id] || null;
  }

  node(id) {
    return this.nodes[id] || null;
  }

  edge(id) {
    return this.edges[id] || null;
  }

  stats() {
    let junctions = 0;
    let deadEnds = 0;
    let roundabouts = 0;
    for (const n of this.nodes) {
      if (n.kind === 'roundabout') roundabouts++;
      else if (n.degree <= 1) deadEnds++;
      else if (n.degree >= 3) junctions++;
    }
    return {
      nodes: this.nodes.length,
      edges: this.edges.length,
      junctions,
      deadEnds,
      roundabouts
    };
  }

  build(grid, info = {}) {
    this.clear();
    const xsByCell = info.xsByCell || new Map();
    const isRoad = (x, y) => grid.inBounds(x, y) && grid.isRoad(x, y);

    for (const group of this.collectRoundabouts(grid, isRoad)) {
      this.addNode(group, grid, info, 'roundabout');
    }

    grid.forEach((x, y, g) => {
      if (!g.isRoad(x, y)) return;
      if (this.nodeCells.has(key(x, y))) return;
      const d = degree(g.roadAt(x, y));
      if (d !== 2) this.addNode([[x, y]], grid, info, d <= 1 ? 'deadend' : 'junction');
    });

    const visited = new Set();
    for (const node of this.nodes) {
      for (const [cx, cy] of node.cells) {
        const mask = grid.roadAt(cx, cy);
        for (const [bit, dx, dy] of DIR_BITS) {
          if (!(mask & bit)) continue;
          this.walkEdge(grid, cx, cy, bit, dx, dy, node.id, visited, info, xsByCell);
        }
      }
    }

    this.closeRings(grid, info, xsByCell);

    for (const node of this.nodes) node.degree = node.links.length;
    for (const node of this.nodes) {
      for (const [x, y] of node.cells) this.linkCell.delete(key(x, y));
    }
    return this;
  }

  addNode(cells, grid, info, kind) {
    const id = this.nodes.length;
    const [sx, sy] = cells[0];
    const node = {
      id,
      cells,
      x: sx,
      y: sy,
      degree: 0,
      links: [],
      kind,
      feature: grid.featureAt(sx, sy),
      street: info.cellInfo?.get(key(sx, sy))?.street || null,
      components: []
    };
    const comps = new Set();
    for (const [x, y] of cells) {
      this.nodeCells.set(key(x, y), id);
      for (const n of info.cellInfo?.get(key(x, y))?.names || []) comps.add(n);
    }
    node.components = [...comps];
    this.nodes.push(node);
    return node;
  }

  collectRoundabouts(grid, isRoad) {
    const seen = new Set();
    const groups = [];
    grid.forEach((x, y, g) => {
      if (!g.isRoad(x, y)) return;
      if (g.featureAt(x, y) !== ROAD_FEATURE.ROUNDABOUT) return;
      const k = key(x, y);
      if (seen.has(k)) return;
      seen.add(k);
      const stack = [[x, y]];
      const group = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        group.push([cx, cy]);
        for (const [, dx, dy] of DIR_BITS) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nk = key(nx, ny);
          if (seen.has(nk) || !isRoad(nx, ny)) continue;
          if (grid.featureAt(nx, ny) !== ROAD_FEATURE.ROUNDABOUT) continue;
          seen.add(nk);
          stack.push([nx, ny]);
        }
      }
      groups.push(group);
    });
    return groups;
  }

  walkEdge(grid, sx, sy, bit, dx, dy, fromNode, visited, info, xsByCell) {
    const startKey = `${key(sx, sy)}>${bit}`;
    if (visited.has(startKey)) return;

    const cells = [];
    let px = sx;
    let py = sy;
    let cx = sx + dx;
    let cy = sy + dy;
    let endNode = null;
    let guard = 0;

    while (grid.inBounds(cx, cy) && grid.isRoad(cx, cy) && guard++ < 4096) {
      const nk = this.nodeCells.get(key(cx, cy));
      if (nk !== undefined) {
        endNode = nk;
        break;
      }
      cells.push([cx, cy]);
      const mask = grid.roadAt(cx, cy);
      let tx = null;
      let ty = null;
      for (const [b, ddx, ddy] of DIR_BITS) {
        if (!(mask & b)) continue;
        const ox = cx + ddx;
        const oy = cy + ddy;
        if (ox === px && oy === py) continue;
        tx = ox;
        ty = oy;
        break;
      }
      px = cx;
      py = cy;
      if (tx === null) break;
      cx = tx;
      cy = ty;
    }

    visited.add(startKey);
    if (endNode !== null) {
      visited.add(`${key(cx, cy)}>${dirBit(cx, cy, px, py)}`);
      if (!cells.length) {
        const edge = this.pushEdge([], fromNode, endNode, info, xsByCell);
        edge.kind = 'short';
        this.nodes[fromNode].links.push(edge.id);
        this.nodes[endNode].links.push(edge.id);
        return;
      }
    }

    const edge = this.pushEdge(cells, fromNode, endNode, info, xsByCell);
    this.nodes[fromNode].links.push(edge.id);
    if (endNode !== null) this.nodes[endNode].links.push(edge.id);
  }

  closeRings(grid, info, xsByCell) {
    const seen = new Set();
    grid.forEach((x, y, g) => {
      if (!g.isRoad(x, y)) return;
      const k = key(x, y);
      if (seen.has(k)) return;
      if (this.nodeCells.has(k)) return;
      if (this.linkCell.has(k)) return;

      const cells = [];
      let px = -1;
      let py = -1;
      let cx = x;
      let cy = y;
      let guard = 0;
      while (grid.inBounds(cx, cy) && grid.isRoad(cx, cy) && guard++ < 4096) {
        const k2 = key(cx, cy);
        if (cells.length && k2 === key(x, y)) break;
        if (this.nodeCells.has(k2)) break;
        if (this.linkCell.has(k2)) break;
        seen.add(k2);
        cells.push([cx, cy]);
        const mask = grid.roadAt(cx, cy);
        let tx = null;
        let ty = null;
        for (const [b, ddx, ddy] of DIR_BITS) {
          if (!(mask & b)) continue;
          const ox = cx + ddx;
          const oy = cy + ddy;
          if (ox === px && oy === py) continue;
          tx = ox;
          ty = oy;
          break;
        }
        px = cx;
        py = cy;
        if (tx === null) break;
        cx = tx;
        cy = ty;
      }
      if (cells.length < 2) return;
      const edge = this.pushEdge(cells, null, null, info, xsByCell);
      edge.kind = 'ring';
    });
  }

  pushEdge(cells, a, b, info, xsByCell) {
    const edge = {
      id: this.edges.length,
      a,
      b,
      cells,
      kind: a === null || b === null ? 'stub' : 'link',
      length: Math.round(cells.length * CELL * 100) / 100,
      street: null,
      seg: null,
      cls: null,
      width: null,
      lanes: null,
      components: []
    };

    const streets = new Set();
    const comps = new Set();
    let lanes = 0;
    let width = 0;
    for (const [x, y] of cells) {
      const meta = info.cellInfo?.get(key(x, y));
      const xs = xsByCell.get(key(x, y));
      if (meta) {
        if (meta.street) streets.add(meta.street);
        for (const n of meta.names) comps.add(n);
        if (!edge.seg && meta.seg) edge.seg = meta.seg;
      }
      if (xs) {
        if (!edge.cls) edge.cls = xs.cls;
        if (xs.lanes > lanes) lanes = xs.lanes;
        if (xs.width > width) width = xs.width;
      }
    }
    edge.street = streets.size === 1 ? [...streets][0] : null;
    edge.lanes = lanes || 2;
    edge.width = width || CELL;
    edge.components = [...comps];

    this.edges.push(edge);
    for (const [x, y] of cells) this.linkCell.set(key(x, y), edge.id);
    return edge;
  }

  describe(x, y) {
    const out = { node: null, edge: null };
    const nodeId = this.nodeAt(x, y);
    if (nodeId !== null) {
      const n = this.nodes[nodeId];
      out.node = { kind: n.kind, degree: n.degree, links: n.links.length, street: n.street };
    }
    const edge = this.edgeAt(x, y);
    if (edge) {
      out.edge = {
        id: edge.id,
        kind: edge.kind,
        street: edge.street,
        cls: edge.cls,
        length: edge.length,
        width: edge.width,
        lanes: edge.lanes
      };
    }
    return out;
  }
}
