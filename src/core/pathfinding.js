class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function findPath(grid, start, goal, opts = {}) {
  const walkable = opts.walkable || (() => true);
  const costFn = opts.cost || (() => 1);
  const maxNodes = opts.maxNodes || 20000;
  const heuristic = opts.heuristic || ((a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y));

  const [sx, sy] = start;
  const [gx, gy] = goal;
  if (!grid.inBounds(sx, sy) || !grid.inBounds(gx, gy)) return null;
  // Both ends must sit on the network. A caller that starts off-road would
  // otherwise expand from a cell its own `walkable` predicate rejects, which
  // is how a stranded agent plans its first segment through terrain.
  if (!walkable(sx, sy, grid) && !opts.allowStart) return null;
  if (!walkable(gx, gy, grid) && !opts.allowGoal) return null;

  const w = grid.w;
  const startIdx = sy * w + sx;
  const goalIdx = gy * w + gx;
  if (startIdx === goalIdx) return [[sx, sy]];

  const g = new Float32Array(grid.w * grid.h).fill(Infinity);
  const came = new Int32Array(grid.w * grid.h).fill(-1);
  const closed = new Uint8Array(grid.w * grid.h);
  const open = new MinHeap();

  g[startIdx] = 0;
  open.push({ i: startIdx, f: heuristic({ x: sx, y: sy }, { x: gx, y: gy }) });

  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === goalIdx) break;
    if (++expanded > maxNodes) return null;

    const cx = cur.i % w;
    const cy = (cur.i / w) | 0;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      if (!walkable(nx, ny, grid)) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur.i] + costFn(nx, ny, grid, cx, cy);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur.i;
        open.push({ i: ni, f: ng + heuristic({ x: nx, y: ny }, { x: gx, y: gy }) });
      }
    }
  }

  if (came[goalIdx] === -1 && goalIdx !== startIdx) return null;

  const path = [];
  let node = goalIdx;
  while (node !== -1) {
    path.push([node % w, (node / w) | 0]);
    if (node === startIdx) break;
    node = came[node];
  }
  path.reverse();
  return path;
}

/**
 * The shortest link from any cell in `from` to the first cell satisfying
 * `isTarget`, breaking ties on the fewest direction changes.
 *
 * A plain BFS answers "shortest" but not "which shortest". With a fixed
 * neighbour order it hands back the staircase — one right, one up, one right —
 * so every auto-linked street and every access spur comes out as a saw-tooth
 * of single-cell jogs. This scores a path as (cells, bends) lexicographically:
 * length still decides, and only between paths of equal length does the
 * straighter one win. The result is the same cells paved, in a shape with one
 * clean corner instead of a dozen.
 *
 * `opts.passable(x, y)` gates expansion, `opts.stopAt(cell)` ends the
 * reconstruction WITHOUT emitting that cell — the endpoint already in the
 * network, or the source the spur left from. Returns the cells in order, or
 * null when nothing is reachable within `opts.maxLen`.
 */
export function findLinkPath(grid, from, isTarget, opts = {}) {
  const maxLen = opts.maxLen ?? 12;
  const passable = opts.passable || (() => true);
  const stopAt = opts.stopAt || (() => false);
  const w = grid.w;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const START = DIRS.length;         // heading slot meaning "have not moved yet"
  const SLOTS = DIRS.length + 1;
  const BIG = maxLen + 2;            // bigger than any bend count, so cells win
  const state = (cell, head) => cell * SLOTS + head;

  const best = new Map();            // state -> (cells * BIG + bends)
  const bends = new Map();
  const came = new Map();
  const steps = new Map();
  const open = new MinHeap();

  for (const [x, y] of from) {
    if (!grid.inBounds(x, y)) continue;
    const s = state(y * w + x, START);
    if (best.has(s)) continue;
    best.set(s, 0);
    bends.set(s, 0);
    came.set(s, -1);
    steps.set(s, 0);
    open.push({ i: s, f: 0 });
  }
  if (open.size === 0) return null;

  while (open.size > 0) {
    const cur = open.pop();
    const s = cur.i;
    if (best.get(s) !== cur.f) continue;      // superseded entry
    const cell = (s / SLOTS) | 0;
    const head = s % SLOTS;
    const cx = cell % w;
    const cy = (cell / w) | 0;
    const d0 = steps.get(s);
    for (let d = 0; d < DIRS.length; d++) {
      const nx = cx + DIRS[d][0];
      const ny = cy + DIRS[d][1];
      if (!grid.inBounds(nx, ny)) continue;
      if (isTarget(nx, ny)) {
        const path = [];
        let k = s;
        while (k >= 0) {
          const c = (k / SLOTS) | 0;
          if (stopAt(c)) break;
          path.push([c % w, (c / w) | 0]);
          k = came.get(k);
        }
        return path.reverse();
      }
      if (d0 >= maxLen || !passable(nx, ny)) continue;
      const turned = head !== START && head !== d ? 1 : 0;
      const nb = bends.get(s) + turned;
      const ns = state(ny * w + nx, d);
      const nf = (d0 + 1) * BIG + nb;
      if (best.has(ns) && best.get(ns) <= nf) continue;
      best.set(ns, nf);
      bends.set(ns, nb);
      came.set(ns, s);
      steps.set(ns, d0 + 1);
      open.push({ i: ns, f: nf });
    }
  }
  return null;
}

/**
 * A uniformly random cell from `walkable`, at least `minDist` from `from`.
 *
 * For a road network this deliberately shies away from a cul-de-sac: a car
 * sent to the end of a dead-end street has to stop, turn round and come back,
 * which reads as stuck rather than as a trip. A dead end is only used when
 * the town offers nothing else — the caller still gets a legal destination.
 */
export function randomWalkableCell(grid, walkable, rng, from, minDist = 0) {
  let culDeSac = null;
  for (let i = 0; i < 400; i++) {
    const x = rng.int(0, grid.w - 1);
    const y = rng.int(0, grid.h - 1);
    if (!walkable(x, y, grid)) continue;
    if (from && Math.abs(x - from[0]) + Math.abs(y - from[1]) < minDist) continue;
    if (grid.isRoad(x, y) && grid.roadDegree(x, y) <= 1) {
      if (!culDeSac) culDeSac = [x, y];
      continue;
    }
    return [x, y];
  }
  return culDeSac;
}
