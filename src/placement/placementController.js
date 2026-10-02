import { CELL_KIND, ZONE } from '../core/config.js';
import { findLinkPath } from '../core/pathfinding.js';

/**
 * Placement Controller: every placement decision derives from the grid and the
 * seed — no fixed coordinates. Owns the town core, the street layout, zoning
 * and road-network connectivity (component labelling, auto-connect, access and
 * split checks) so the initial town, growth and the player tools share one set
 * of rules.
 */

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const BLOCK_MIN = 4; // narrowest block between two streets
const BLOCK_MAX = 5; // widest block before it is split again
const CORE_MARGIN = 4; // outskirts ring kept free for resources
/** Longest auto-connect path, in cells. Exported: growth ranks its expansion
 *  candidates against the same link limit it has to fit inside. */
export const MAX_LINK = 12;

/**
 * How far toward the middle of town a site sits before industry is refused
 * it, as a fraction of the road network's own radius. 0 is the centroid, 1 is
 * the rim of the built area. The outermost blocks of a gridded core sit around
 * 0.8, so 0.62 keeps the works out of the centre while leaving the whole rim
 * in play — the core's own block subdivision guarantees free land out there.
 */
export const INDUSTRIAL_MIN_EDGE = 0.62;

/**
 * The built centre of the road network, MEASURED rather than assumed: the
 * centroid of every road cell, plus the radius that contains 90% of them. The
 * percentile is the point — one long country road dragging the mean out would
 * make the whole town read as "downtown" and refuse every factory.
 *
 * This is the same discipline as ResourceKit's `coreBounds`, and it is what
 * lets the outskirts rule keep working after the town has grown well past the
 * rectangle `planCore` drew at seed time.
 */
export function urbanProfile(g) {
  const cells = g.roadCells();
  const fallback = { cx: g.w / 2, cy: g.h / 2 };
  if (!cells.length) return { ...fallback, r: 1 };
  let sx = 0;
  let sy = 0;
  for (const [x, y] of cells) {
    sx += x;
    sy += y;
  }
  const cx = sx / cells.length;
  const cy = sy / cells.length;
  const dists = cells.map(([x, y]) => Math.hypot(x - cx, y - cy)).sort((a, b) => a - b);
  const r = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] || 1;
  return { cx, cy, r: Math.max(1, r) };
}

/**
 * How far out on the rim a cell sits: 0 dead centre, 1 at the rim of the built
 * area, above 1 beyond it. Every industrial siting rule reads this, so "the
 * outskirts" means one measured thing across the seed, the planner, the
 * player tool and the validator.
 */
export function edgeScore(profile, x, y) {
  return Math.hypot(x - profile.cx, y - profile.cy) / (profile.r || 1);
}

/** Is this cell industrial-eligible land? The hard half of the outskirts rule. */
export function onIndustrialGround(profile, x, y) {
  return edgeScore(profile, x, y) >= INDUSTRIAL_MIN_EDGE;
}

/**
 * Core rectangle sized in ABSOLUTE cells, jittered by the seed, and centred in
 * whatever room the grid leaves.
 *
 * Founding rule — a compact core: the initial town is 30 people in 16
 * buildings, so it gets a street grid sized for that (± infill room), not a
 * town scaled to the map. This used to take a `frac` of the grid, which meant
 * the founding town silently grew every time the map was enlarged — the exact
 * opposite of the intent. Pass `{ w: [lo, hi], h: [lo, hi] }` with real cell
 * counts and the hamlet is the same size on a 34-wide map or a 200-wide one,
 * leaving the rest of the extent for growth to earn.
 *
 * `CORE_MARGIN` still clamps the result so the core can never touch the border,
 * and the core stays centred: on a large map the slack is huge, so the ±1 cell
 * jitter is a rounding detail, not a real choice of site.
 */
export function planCore(g, rng, { w: spanW, h: spanH, frac } = {}) {
  const fit = (total, lo, hi) => {
    const cap = Math.max(BLOCK_MIN * 2 + 1, total - CORE_MARGIN * 2);
    return Math.max(BLOCK_MIN * 2 + 1, Math.min(cap, Math.round(rng.float(lo, hi))));
  };
  const lo = frac?.[0] ?? 0.6;
  const hi = frac?.[1] ?? 0.68;
  const w = spanW ? fit(g.w, spanW[0], spanW[1]) : fit(g.w, g.w * lo, g.w * hi);
  const h = spanH ? fit(g.h, spanH[0], spanH[1]) : fit(g.h, g.h * lo, g.h * hi);
  const slackX = Math.max(0, g.w - w - CORE_MARGIN * 2);
  const slackY = Math.max(0, g.h - h - CORE_MARGIN * 2);
  const x0 = Math.min(g.w - w, CORE_MARGIN + Math.round(slackX / 2 + rng.float(-1, 1) * Math.min(1, slackX / 2)));
  const y0 = Math.min(g.h - h, CORE_MARGIN + Math.round(slackY / 2 + rng.float(-1, 1) * Math.min(1, slackY / 2)));
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

/**
 * Recursive block subdivision: split the longer side of a rect with a street
 * across its full extent until every block is BLOCK_MIN..BLOCK_MAX wide. Each
 * street ends on its parent street, so the network is connected by construction.
 */
export function layoutStreets(g, rng, core) {
  const lines = [];
  const split = (r) => {
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const canX = w >= BLOCK_MIN * 2 + 1 && w > BLOCK_MAX;
    const canY = h >= BLOCK_MIN * 2 + 1 && h > BLOCK_MAX;
    if (!canX && !canY) return;
    const vertical = canX && (!canY || w > h || (w === h && rng.chance(0.5)));
    const lo = (vertical ? r.x0 : r.y0) + BLOCK_MIN;
    const hi = (vertical ? r.x1 : r.y1) - BLOCK_MIN;
    const mid = (lo + hi) / 2;
    // Continue an existing parallel street when one lands in range, so the
    // grid keeps through-junctions instead of jogged, offset T's.
    const axis = vertical ? 'x' : 'y';
    const aligned = lines
      .filter((l) => l.axis === axis && l.at >= lo && l.at <= hi)
      .sort((a, b) => Math.abs(a.at - mid) - Math.abs(b.at - mid))[0];
    const at = aligned && rng.chance(0.85)
      ? aligned.at
      : Math.round(mid + rng.float(-0.5, 0.5) * Math.min(2, hi - lo));
    const p = Math.max(lo, Math.min(hi, at));
    if (vertical) {
      for (let y = r.y0; y <= r.y1; y++) g.setKind(p, y, CELL_KIND.ROAD);
      lines.push({ axis: 'x', at: p });
      split({ ...r, x1: p - 1 });
      split({ ...r, x0: p + 1 });
    } else {
      for (let x = r.x0; x <= r.x1; x++) g.setKind(x, p, CELL_KIND.ROAD);
      lines.push({ axis: 'y', at: p });
      split({ ...r, y1: p - 1 });
      split({ ...r, y0: p + 1 });
    }
  };
  split(core);
  return lines;
}

export function isAdjacentToRoad(g, x, y) {
  for (const [dx, dy] of DIRS) if (g.isRoad(x + dx, y + dy)) return true;
  return false;
}

/** Label road cells by connected component; the largest is the network. */
export function roadComponents(g) {
  const label = new Int32Array(g.w * g.h).fill(-1);
  const sizes = [];
  g.forEach((x, y) => {
    const i = g.idx(x, y);
    if (!g.isRoad(x, y) || label[i] >= 0) return;
    const id = sizes.length;
    let n = 0;
    const stack = [[x, y]];
    label[i] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      n++;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!g.isRoad(nx, ny)) continue;
        const ni = g.idx(nx, ny);
        if (label[ni] >= 0) continue;
        label[ni] = id;
        stack.push([nx, ny]);
      }
    }
    sizes.push(n);
  });
  let main = -1;
  for (let i = 0; i < sizes.length; i++) if (main < 0 || sizes[i] > sizes[main]) main = i;
  return { label, sizes, main, count: sizes.length };
}

function passable(g, x, y) {
  return g.inBounds(x, y) && g.kindAt(x, y) === CELL_KIND.EMPTY && !g.owner[g.idx(x, y)];
}

/**
 * Shortest path through free land from any `from` cell to a road cell that
 * satisfies `isTarget`. Returns the free cells to pave (endpoints excluded).
 *
 * Thin wrapper over `findLinkPath`: the shape of the link is the point — see
 * there for why a plain BFS is not enough.
 */
function linkPath(g, from, isTarget, maxLen = MAX_LINK) {
  return findLinkPath(g, from, isTarget, {
    maxLen,
    passable: (x, y) => passable(g, x, y),
    stopAt: (cell) => g.isRoad(cell % g.w, (cell / g.w) | 0)
  });
}

function pave(g, cells) {
  for (const [x, y] of cells) {
    const i = g.idx(x, y);
    g.setKind(x, y, CELL_KIND.ROAD);
    g.zone[i] = null;
    g.owner[i] = null;
  }
}

/** Join every stray road component to the main network through free land. */
export function ensureRoadConnectivity(g) {
  let carved = 0;
  let unreachable = 0;
  for (let guard = 0; guard < 64; guard++) {
    const c = roadComponents(g);
    if (c.count <= 1) break;
    let joined = false;
    for (let id = 0; id < c.count && !joined; id++) {
      if (id === c.main) continue;
      const cells = [];
      g.forEach((x, y) => {
        if (c.label[g.idx(x, y)] === id) cells.push([x, y]);
      });
      const path = linkPath(g, cells, (x, y) => c.label[g.idx(x, y)] === c.main, g.w + g.h);
      if (path) {
        pave(g, path);
        carved += path.length;
        joined = true;
      }
    }
    if (!joined) {
      unreachable = c.count - 1;
      break;
    }
  }
  g.computeRoadMask();
  const c = roadComponents(g);
  return { components: c.count, carved, unreachable };
}

/**
 * Pave (x, y) and, when it does not touch the network, the shortest free-land
 * link to it. Returns the paved cells, or null when no link fits.
 */
export function planConnectedRoad(g, x, y) {
  if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isWater(x, y)) return null;
  const c = roadComponents(g);
  if (c.count === 0) return [[x, y]];
  const onMain = (nx, ny) => c.label[g.idx(nx, ny)] === c.main;
  for (const [dx, dy] of DIRS) {
    if (g.isRoad(x + dx, y + dy) && onMain(x + dx, y + dy)) return [[x, y]];
  }
  const path = linkPath(g, [[x, y]], onMain);
  return path ? [[x, y], ...path.filter(([px, py]) => px !== x || py !== y)] : null;
}

/** True when a cell fronts a road that belongs to the main network. */
export function hasNetworkAccess(g, x, y, comps = roadComponents(g)) {
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!g.inBounds(nx, ny)) continue;
    if (g.isRoad(nx, ny) && comps.label[g.idx(nx, ny)] === comps.main) return true;
    // A footway chain that reaches the main road counts as network access —
    // that is what makes an inland (road-less) lot buildable.
    if (g.isPath(nx, ny) && pathReachesMain(g, nx, ny, comps)) return true;
  }
  return false;
}

/** Can this footway cell walk (through footways) to the main road network? */
function pathReachesMain(g, x, y, comps) {
  const seen = new Set([g.idx(x, y)]);
  const queue = [[x, y]];
  for (let head = 0; head < queue.length; head++) {
    const [cx, cy] = queue[head];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!g.inBounds(nx, ny)) continue;
      if (g.isRoad(nx, ny)) {
        if (comps.label[g.idx(nx, ny)] === comps.main) return true;
        continue;
      }
      if (g.isPath(nx, ny)) {
        const ni = g.idx(nx, ny);
        if (seen.has(ni)) continue;
        seen.add(ni);
        queue.push([nx, ny]);
      }
    }
  }
  return false;
}

/**
 * Pave a footway from (x, y) to the nearest road or footway: the shortest
 * chain through free land (linkPath's BFS with a path-aware target).
 * Returns the cells to pave (anchor included), or null when no chain fits.
 */
export function planFootway(g, x, y, maxLen = 24) {
  if (!g.inBounds(x, y) || g.isWater(x, y)) return null;
  if (g.kindAt(x, y) !== CELL_KIND.EMPTY) return null;
  const path = linkPath(
    g,
    [[x, y]],
    (nx, ny) => g.isRoad(nx, ny) || g.isPath(nx, ny),
    maxLen
  );
  if (!path) return null;
  const cells = [[x, y], ...path.filter(([px, py]) => px !== x || py !== y)];
  return cells;
}

/** Would removing this road cell split the network? */
export function splitsNetwork(g, x, y) {
  if (!g.isRoad(x, y)) return false;
  const before = roadComponents(g).count;
  const i = g.idx(x, y);
  const kind = g.kind[i];
  g.kind[i] = CELL_KIND.EMPTY;
  const after = roadComponents(g).count;
  g.kind[i] = kind;
  return after > before;
}

/** Non-road land regions inside the core, each a street block. */
export function coreBlocks(g, core) {
  const seen = new Uint8Array(g.w * g.h);
  const blocks = [];
  const inCore = (x, y) => x >= core.x0 && x <= core.x1 && y >= core.y0 && y <= core.y1;
  for (let y = core.y0; y <= core.y1; y++) {
    for (let x = core.x0; x <= core.x1; x++) {
      const i = g.idx(x, y);
      if (seen[i] || g.isRoad(x, y) || g.isWater(x, y)) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[i] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inCore(nx, ny)) continue;
          const ni = g.idx(nx, ny);
          if (seen[ni] || g.isRoad(nx, ny) || g.isWater(nx, ny)) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
      const cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
      blocks.push({ cells, cx, cy });
    }
  }
  return blocks;
}

function spacedCount(g, cells, gap = 3) {
  const taken = [];
  for (const c of cells) {
    if (!isAdjacentToRoad(g, c[0], c[1])) continue;
    if (taken.some((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) < gap)) continue;
    taken.push(c);
  }
  return taken.length;
}

/**
 * Zoning from block rank by distance to the core centre: the OUTERMOST blocks
 * go industrial (works belong on the rim, not downtown), the central blocks go
 * commercial, the next ring civic (enough frontage for `civicSlots`), one
 * outer block becomes the park, the rest residential frontage.
 *
 * The industrial ring is claimed before the park, so a park is never taken out
 * of the ground industry was just given — and it is what makes the planner's
 * `zoneBonus` for industrial land reachable at all (nothing else ever assigns
 * ZONE.INDUSTRIAL, so before this the reward was dead code and every
 * council-planned works landed on highest-land-value land: the town centre).
 */
export function zoneBlocks(g, rng, core, { civicSlots = 4, downtownBlocks = 2, industrialBlocks = 2 } = {}) {
  const mx = (core.x0 + core.x1) / 2;
  const my = (core.y0 + core.y1) / 2;
  const blocks = coreBlocks(g, core)
    .map((b) => ({ ...b, d: Math.hypot(b.cx - mx, b.cy - my) }))
    .sort((a, b) => a.d - b.d || a.cy - b.cy || a.cx - b.cx);
  if (!blocks.length) return { park: 0, civic: 0, commercial: 0, industrial: 0 };

  const role = new Map();
  const roomy = blocks.filter((b) => b.cells.length >= BLOCK_MIN * 2);
  // Industry takes the rim first — the outermost blocks, and only while there
  // are enough of them left to still build a town in the middle.
  const industrial = industrialBlocks > 0 ? roomy.slice(-industrialBlocks) : [];
  for (const b of industrial) role.set(b, ZONE.INDUSTRIAL);

  const outer = roomy.filter((b) => !role.has(b)).slice(-3);
  const park = outer.length ? rng.pick(outer) : null;
  if (park) role.set(park, ZONE.PARK);

  const rest = blocks.filter((b) => !role.has(b));
  let downtown = 0;
  for (const b of rest) {
    if (downtown >= downtownBlocks) break;
    role.set(b, ZONE.COMMERCIAL);
    downtown++;
  }
  let slots = 0;
  for (const b of rest) {
    if (slots >= civicSlots) break;
    if (role.has(b)) continue;
    role.set(b, ZONE.CIVIC);
    slots += spacedCount(g, b.cells);
  }

  const out = { park: 0, civic: 0, commercial: 0, industrial: 0 };
  for (const b of blocks) {
    const z = role.get(b) || ZONE.RESIDENTIAL;
    for (const [x, y] of b.cells) {
      const idx = g.idx(x, y);
      if (z === ZONE.PARK) {
        g.setKind(x, y, CELL_KIND.PARK);
        g.zone[idx] = ZONE.PARK;
        out.park++;
        continue;
      }
      // An industrial block reads industrial throughout, not just on its
      // road-facing cells: interior cells left unzoned pair into VACANT
      // parcels, and a works whose lot covers one then inherits the vacant
      // setback and a residential driveway. Other zones keep the old
      // frontage-only rule — an interior cell cannot hold a house or a shop,
      // so leaving it unzoned is what keeps it out of the parcel ladder.
      if (z === ZONE.INDUSTRIAL) {
        g.zone[idx] = z;
        out.industrial++;
        continue;
      }
      if (!isAdjacentToRoad(g, x, y)) continue;
      g.zone[idx] = z;
      if (z === ZONE.CIVIC) out.civic++;
      if (z === ZONE.COMMERCIAL) out.commercial++;
    }
  }
  return out;
}
