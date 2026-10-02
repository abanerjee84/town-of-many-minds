// A road extension is evaluated without editing the grid. Existing roads form
// the graph; each candidate contributes at most four straight, vacant cells.
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_TRIPS = 32;
// Eight observations was too strict for a small town: seed-42 completed only
// five trips in its first 200 days, so congestion could stay above the gate
// forever without an extension. Four completed trips still provide multiple
// OD pairs for a measured detour test; below that, only a topology join is
// eligible and arbitrary paving remains impossible.
const MIN_TRIPS = 4;

class Heap {
  constructor() { this.a = []; }
  push(i, cost) {
    const a = this.a;
    let p = a.length;
    a.push({ i, cost });
    while (p) {
      const q = (p - 1) >> 1;
      if (a[q].cost <= cost) break;
      a[p] = a[q];
      p = q;
    }
    a[p] = { i, cost };
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const head = a[0];
    const last = a.pop();
    if (a.length) {
      let p = 0;
      while (p * 2 + 1 < a.length) {
        let q = p * 2 + 1;
        if (q + 1 < a.length && a[q + 1].cost < a[q].cost) q++;
        if (a[q].cost >= last.cost) break;
        a[p] = a[q];
        p = q;
      }
      a[p] = last;
    }
    return head;
  }
  get length() { return this.a.length; }
}

function distances(grid, start, weights, reverse = false) {
  const out = new Float64Array(grid.w * grid.h).fill(Infinity);
  const heap = new Heap();
  out[start] = 0;
  heap.push(start, 0);
  while (heap.length) {
    const next = heap.pop();
    if (next.cost !== out[next.i]) continue;
    const x = next.i % grid.w;
    const y = (next.i / grid.w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!grid.isRoad(nx, ny)) continue;
      const ni = grid.idx(nx, ny);
      const cost = next.cost + (reverse ? weights[next.i] : weights[ni]);
      if (cost >= out[ni]) continue;
      out[ni] = cost;
      heap.push(ni, cost);
    }
  }
  return out;
}

function boundary(grid, cells) {
  const added = new Set(cells.map(([x, y]) => grid.idx(x, y)));
  const out = [];
  for (const [x, y] of cells) {
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!grid.isRoad(nx, ny)) continue;
      const road = grid.idx(nx, ny);
      if (!added.has(road)) out.push({ road, x, y });
    }
  }
  return out;
}

function key(run) {
  return run.cells.map(([x, y]) => `${x},${y}`).sort().join('|');
}

function geometricScore(run) {
  return run.cells.length * 2 - run.junctionDelta * 6 + (run.joins ? 4 : 0);
}

function componentJoins(grid, run, components) {
  return Math.max(0, new Set(boundary(grid, run.cells).map((e) => components.label[e.road])).size - 1);
}

/**
 * A sparse completed-trip sample is common in a young town. A run that touches
 * a measured busy/delayed road is still evidence-based, so it can be selected
 * when OD detour scoring has too little signal. This never scores empty land:
 * every term comes from the live demand cells collected by TrafficSystem.
 */
function hotspotScore(grid, run, demand) {
  const cells = demand?.cells;
  if (!cells || typeof cells.get !== 'function') return 0;
  let score = 0;
  const seen = new Set();
  for (const edge of boundary(grid, run.cells)) {
    if (seen.has(edge.road)) continue;
    seen.add(edge.road);
    const value = cells.get(edge.road);
    if (!value) continue;
    const visits = Math.max(0, Number(value.visits) || 0);
    const delay = Math.max(0, Number(value.delay) || 0);
    // Delay is strongest; repeated occupancy is a weaker but still measured
    // signal when vehicles are moving too quickly to accumulate a wait.
    score += Math.min(4, delay / Math.max(1, visits) * 4);
    score += Math.min(1, visits / 10);
  }
  return score;
}

function bestHotspot(grid, legal, demand) {
  const ranked = legal
    .map((run) => ({ run, pressure: hotspotScore(grid, run, demand) }))
    .filter((row) => row.pressure > 0)
    .sort((a, b) => b.pressure - a.pressure || geometricScore(b.run) - geometricScore(a.run) || a.run.key.localeCompare(b.run.key));
  if (!ranked.length) return null;
  const { run, pressure } = ranked[0];
  return {
    ...run,
    pressure,
    benefit: pressure,
    score: pressure - run.cells.length * 0.25 - run.junctionDelta * 2,
    reason: pressure >= 1 ? 'relieves measured queue' : 'serves measured traffic'
  };
}

/**
 * Return the best legal run. A sufficient demand sample prefers a measured
 * OD improvement; when that sample is sparse or no run shortens those trips,
 * a legal run touching a measured live hotspot remains eligible. Empty-land
 * geometry is never enough to authorize paving.
 * Distances to each trip's endpoints are computed once, then each candidate
 * tests a virtual detour through its own cells and existing boundary roads.
 */
export function chooseRoadExtension(grid, runs, demand, components) {
  const seen = new Set();
  const legal = [];
  for (const run of runs) {
    const k = key(run);
    const anchor = run.cells[0];
    const mainTouch = DIRS.some(([dx, dy]) => {
      const x = anchor[0] + dx;
      const y = anchor[1] + dy;
      return grid.isRoad(x, y) && components.label[grid.idx(x, y)] === components.main;
    });
    if (!mainTouch || seen.has(k)) continue;
    seen.add(k);
    legal.push({ ...run, key: k });
  }
  if (!legal.length) return null;

  const trips = (demand?.trips || []).slice(-MAX_TRIPS).filter((trip) => {
    const a = trip.from;
    const b = trip.to;
    return a && b && grid.isRoad(a[0], a[1]) && grid.isRoad(b[0], b[1]);
  });
  if (trips.length < MIN_TRIPS) {
    // A congestion flag without completed origin/destination observations is
    // not a location. The old geometric fallback chose the first attractive
    // four-cell run, so EXTEND_STREET could pave arbitrary land before the
    // town had evidence that a corridor was useful. A true component join is
    // still actionable with a small sample, followed by a legal run touching
    // a measured live hotspot rather than guessing a destination.
    const joins = legal
      .filter((run) => componentJoins(grid, run, components) > 0)
      .sort((a, b) =>
        componentJoins(grid, b, components) - componentJoins(grid, a, components) ||
        geometricScore(b) - geometricScore(a) || a.key.localeCompare(b.key));
    if (joins.length) return { ...joins[0], reason: 'joins networks', benefit: null, score: geometricScore(joins[0]) };
    return bestHotspot(grid, legal, demand);
  }

  const weights = new Float64Array(grid.w * grid.h).fill(1);
  for (const [idx, value] of demand.cells || []) {
    if (idx < 0 || idx >= weights.length) continue;
    // Delay per occupied second is a local cost. Visits alone do not assert
    // congestion; a busy road that flows freely keeps its base cost.
    weights[idx] += Math.min(3, value.delay / Math.max(0.25, value.visits));
  }
  const forward = new Map();
  const backward = new Map();
  const observations = trips.map((trip) => {
    const start = grid.idx(trip.from[0], trip.from[1]);
    const end = grid.idx(trip.to[0], trip.to[1]);
    if (!forward.has(start)) forward.set(start, distances(grid, start, weights));
    if (!backward.has(end)) backward.set(end, distances(grid, end, weights, true));
    return { from: forward.get(start), to: backward.get(end), end, weight: trip.weight || 1 };
  });

  let best = null;
  for (const run of legal) {
    const ends = boundary(grid, run.cells);
    const joined = componentJoins(grid, run, components);
    let saved = 0;
    let reached = 0;
    for (const trip of observations) {
      const before = trip.from[trip.end];
      let after = before;
      for (const entry of ends) {
        const approach = trip.from[entry.road];
        if (!Number.isFinite(approach)) continue;
        for (const exit of ends) {
          const departure = trip.to[exit.road];
          if (!Number.isFinite(departure)) continue;
          const newTiles = Math.abs(entry.x - exit.x) + Math.abs(entry.y - exit.y) + 1;
          const cost = approach + newTiles + weights[exit.road] + departure;
          if (cost < after) after = cost;
        }
      }
      if (!Number.isFinite(before) && Number.isFinite(after)) reached += trip.weight;
      else if (Number.isFinite(before)) saved += (before - after) * trip.weight;
    }
    const benefit = saved + reached * 20 + joined * 8;
    const score = benefit - run.cells.length * 0.25 - run.junctionDelta * 2;
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && run.key < best.key)) {
      best = { ...run, benefit, score, reason: reached ? 'connects trips' : joined > 0 ? 'joins networks' : 'shortens trips' };
    }
  }
  // A route sample can be valid but still fail to produce a positive virtual
  // detour: for example all four OD pairs may currently use the same corridor.
  // Sustained live pressure is a second, measured signal in that case.
  return best || bestHotspot(grid, legal, demand);
}
