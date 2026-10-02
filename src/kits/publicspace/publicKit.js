import { CELL, CELL_KIND } from '../../core/config.js';
import { box, cyl } from '../geometry.js';
import {
  buildBench, buildLamp, buildTrashBin, buildPlanter, buildPicnicTable,
  buildBikeRack, buildPlayStructure, buildSwingSet
} from '../props/propKit.js';

const PATH_COLOR = 0xc9c2b2;
const PATH_EDGE = 0xb0a894;
const PITCH_COLOR = 0x4f9448;
const LINE_COLOR = 0xeef3ea;

function key(x, y) {
  return `${x},${y}`;
}

function blocksOf(town) {
  const g = town.grid;
  const seen = new Set();
  const out = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.kindAt(x, y) !== CELL_KIND.PARK) continue;
      if (seen.has(key(x, y))) continue;
      const cells = [];
      const stack = [[x, y]];
      seen.add(key(x, y));
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!g.inBounds(nx, ny) || seen.has(key(nx, ny))) continue;
          if (g.kindAt(nx, ny) !== CELL_KIND.PARK) continue;
          seen.add(key(nx, ny));
          stack.push([nx, ny]);
        }
      }
      if (cells.length) out.push(cells);
    }
  }
  return out;
}

function roadNeighbours(g, cells) {
  const set = new Set(cells.map(([x, y]) => key(x, y)));
  const out = [];
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (g.isRoad(x + dx, y + dy)) out.push([x, y]);
    }
  }
  return [...new Map(out.map((c) => [key(c[0], c[1]), c])).values()];
}

function findRect(set, w, h) {
  const xs = [...set].map((k) => k.split(',').map(Number));
  for (const [sx, sy] of xs) {
    let ok = true;
    for (let dy = 0; dy < h && ok; dy++) {
      for (let dx = 0; dx < w && ok; dx++) {
        if (!set.has(key(sx + dx, sy + dy))) ok = false;
      }
    }
    if (ok) return { x: sx, y: sy, w, h };
  }
  return null;
}

function inRect(rect, x, y) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function lPath(a, b) {
  const out = [];
  const sx = Math.sign(b[0] - a[0]);
  const sy = Math.sign(b[1] - a[1]);
  let [x, y] = a;
  out.push([x, y]);
  while (x !== b[0]) {
    x += sx;
    out.push([x, y]);
  }
  while (y !== b[1]) {
    y += sy;
    out.push([x, y]);
  }
  return out;
}

/**
 * Public Space Kit (1.8): pedestrian `Path` networks through parks and
 * `Sports Area` pitches carved out of park blocks. Plans are pure data so the
 * lot renderer and the inspector read the same source.
 */
export function planPublicSpaces(town, rng) {
  const g = town.grid;
  const plan = { paths: [], sports: [], gardens: [], playgrounds: [], cellUse: new Map() };
  const blocks = blocksOf(town);

  const ranked = blocks
    .map((cells) => ({ cells, score: cells.length + rng.float(0, 3) }))
    .sort((a, b) => b.score - a.score);

  const sportsCap = 5;
  let sportsDone = 0;

  for (const { cells } of ranked) {
    const set = new Set(cells.map(([x, y]) => key(x, y)));
    const ringCells = roadNeighbours(g, cells);
    const ringSet = new Set(ringCells.map(([x, y]) => key(x, y)));
    const interior = new Set(
      cells.filter(([x, y]) => !ringSet.has(key(x, y))).map(([x, y]) => key(x, y))
    );

    const reserved = new Set();
    const markRect = (rect, kind) => {
      if (!rect) return;
      for (let dy = 0; dy < rect.h; dy++) {
        for (let dx = 0; dx < rect.w; dx++) {
          const k = key(rect.x + dx, rect.y + dy);
          reserved.add(k);
          plan.cellUse.set(k, kind);
        }
      }
    };
    const available = () => new Set([...interior].filter((k) => !reserved.has(k)));

    let rect = null;
    if (sportsDone < sportsCap && cells.length >= 8) {
      rect =
        findRect(interior, 3, 2) ||
        findRect(interior, 2, 3) ||
        findRect(set, 3, 2) ||
        findRect(set, 2, 3);
      if (rect) {
        plan.sports.push(rect);
        markRect(rect, 'sports');
        sportsDone++;
      }
    }

    // Two more public-space blocks fill larger park interiors without turning
    // every park into the same sports pitch. They are deliberately selected
    // from unreserved interior cells, so the path ring and amenities never
    // overlap one another.
    if (cells.length >= 8) {
      const playground = findRect(available(), 2, 2);
      if (playground) {
        plan.playgrounds.push(playground);
        markRect(playground, 'playground');
      }
    }
    if (cells.length >= 6) {
      const garden = findRect(available(), 2, 2);
      if (garden) {
        plan.gardens.push(garden);
        markRect(garden, 'garden');
      }
    }

    const ring = ringCells.filter(([x, y]) => !reserved.has(key(x, y)));
    if (ring.length) {
      plan.paths.push({ cells: ring });
      for (const [x, y] of ring) plan.cellUse.set(key(x, y), 'path');
    }

    const amenity = plan.playgrounds.at(-1) || plan.gardens.at(-1) || rect;
    if (amenity && ring.length) {
      const target = [amenity.x + Math.floor(amenity.w / 2), amenity.y + Math.floor(amenity.h / 2)];
      let best = ring[0];
      let bd = Infinity;
      for (const c of ring) {
        const d = Math.hypot(c[0] - target[0], c[1] - target[1]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const steps = lPath(best, target).filter(
        ([x, y]) => !reserved.has(key(x, y)) && !g.isRoad(x, y) && !ringSet.has(key(x, y))
      );
      if (steps.length) {
        plan.paths.push({ cells: steps });
        for (const [x, y] of steps) plan.cellUse.set(key(x, y), 'path');
      }
    }
  }

  // Plaza cells always read as a path.
  g.forEach((x, y, grid) => {
    if (grid.kindAt(x, y) === CELL_KIND.PLAZA) plan.cellUse.set(key(x, y), 'path');
  });

  return plan;
}

/** Duck-types the lot Batch: `{ pads: [], add(obj) }`. */
export function renderPublicSpaces(town, plan, batch, rng) {
  const g = town.grid;
  if (!plan) return;

  for (const block of plan.paths) {
    for (const [x, y] of block.cells) {
      const p = g.cellToWorld(x, y);
      batch.pads.push(box(CELL - 1.1, 0.1, CELL - 1.1, PATH_COLOR, p.x, 0.1, p.z));
      batch.pads.push(box(CELL - 1.5, 0.06, CELL - 1.5, PATH_EDGE, p.x, 0.16, p.z));
    }
    const mid = block.cells[Math.floor(block.cells.length / 2)];
    if (mid && rng.chance(0.5)) {
      const p = g.cellToWorld(mid[0], mid[1]);
      const bench = buildBench();
      bench.position.set(p.x + rng.float(-0.8, 0.8), 0.16, p.z + rng.float(-0.8, 0.8));
      bench.rotation.y = rng.float(0, Math.PI * 2);
      batch.add(bench);
    }
    const end = block.cells[block.cells.length - 1];
    if (end && rng.chance(0.6)) {
      const p = g.cellToWorld(end[0], end[1]);
      const bin = buildTrashBin();
      bin.position.set(p.x + rng.float(-1, 1), 0.16, p.z + rng.float(-1, 1));
      batch.add(bin);
    }
  }

  for (const rect of plan.sports) {
    const cx = rect.x + rect.w / 2 - 0.5;
    const cy = rect.y + rect.h / 2 - 0.5;
    const p = g.cellToWorld(cx, cy);
    const w = rect.w * CELL - 1.2;
    const d = rect.h * CELL - 1.2;

    batch.pads.push(box(w, 0.12, d, PITCH_COLOR, p.x, 0.1, p.z));
    batch.pads.push(box(w - 0.5, 0.03, d - 0.5, 0x000000, p.x, 0.17, p.z));
    batch.pads.push(box(w - 0.7, 0.03, d - 0.7, PITCH_COLOR, p.x, 0.18, p.z));
    batch.pads.push(box(0.1, 0.03, d - 0.7, LINE_COLOR, p.x, 0.19, p.z));
    batch.pads.push(box(w - 0.7, 0.03, 0.1, LINE_COLOR, p.x, 0.19, p.z - (d - 0.7) / 2));
    batch.pads.push(box(w - 0.7, 0.03, 0.1, LINE_COLOR, p.x, 0.19, p.z + (d - 0.7) / 2));
    batch.pads.push(box(0.1, 0.03, d - 0.7, LINE_COLOR, p.x - (w - 0.7) / 2, 0.19, p.z));

    const goalW = Math.min(1.8, d * 0.4);
    for (const s of [-1, 1]) {
      const gx = p.x + (s * (w - 0.7)) / 2;
      batch.pads.push(box(0.12, 0.9, goalW, LINE_COLOR, gx, 0.55, p.z));
      batch.pads.push(box(0.5, 0.12, goalW, LINE_COLOR, gx - s * 0.2, 1.0, p.z));
    }

    for (const [ox, oz] of [[-1, -1], [1, 1]]) {
      const l = buildLamp();
      l.position.set(p.x + (ox * w) / 2, 0.16, p.z + (oz * d) / 2);
      batch.add(l);
    }
  }

  for (const rect of plan.gardens) {
    const cx = rect.x + rect.w / 2 - 0.5;
    const cy = rect.y + rect.h / 2 - 0.5;
    const p = g.cellToWorld(cx, cy);
    const w = rect.w * CELL - 1.1;
    const d = rect.h * CELL - 1.1;
    batch.pads.push(box(w, 0.1, d, 0x78955c, p.x, 0.1, p.z));
    batch.pads.push(box(w - 0.4, 0.04, d - 0.4, 0x9cb477, p.x, 0.17, p.z));
    const planter = buildPlanter();
    planter.position.set(p.x - w * 0.25, 0.17, p.z - d * 0.25);
    batch.add(planter);
    const table = buildPicnicTable();
    table.position.set(p.x + w * 0.2, 0.17, p.z + d * 0.12);
    table.rotation.y = 0.2;
    batch.add(table);
    const rack = buildBikeRack();
    rack.position.set(p.x - w * 0.2, 0.17, p.z + d * 0.24);
    rack.rotation.y = Math.PI / 2;
    batch.add(rack);
  }

  for (const rect of plan.playgrounds) {
    const cx = rect.x + rect.w / 2 - 0.5;
    const cy = rect.y + rect.h / 2 - 0.5;
    const p = g.cellToWorld(cx, cy);
    const w = rect.w * CELL - 1.0;
    const d = rect.h * CELL - 1.0;
    batch.pads.push(box(w, 0.12, d, 0xd2a467, p.x, 0.1, p.z));
    batch.pads.push(box(w - 0.3, 0.04, d - 0.3, 0xc48658, p.x, 0.18, p.z));
    const play = buildPlayStructure();
    play.position.set(p.x - w * 0.18, 0.18, p.z);
    batch.add(play);
    const swings = buildSwingSet();
    swings.position.set(p.x + w * 0.23, 0.18, p.z + d * 0.08);
    swings.rotation.y = Math.PI / 2;
    batch.add(swings);
    const lamp = buildLamp();
    lamp.position.set(p.x + w * 0.36, 0.18, p.z - d * 0.35);
    batch.add(lamp);
  }
}

export function publicSpaceUse(town, x, y) {
  const plan = town.publicPlan;
  if (!plan) return null;
  const u = plan.cellUse.get(key(x, y));
  if (!u) return null;
  return u === 'sports'
    ? 'Sports area'
    : u === 'garden'
      ? 'Community garden'
      : u === 'playground'
        ? 'Playground'
        : 'Path';
}

export function publicSpaceStats(town) {
  const plan = town.publicPlan;
  if (!plan) return { paths: 0, sports: 0, gardens: 0, playgrounds: 0, cells: 0 };
  return {
    paths: plan.paths.length,
    sports: plan.sports.length,
    gardens: plan.gardens?.length || 0,
    playgrounds: plan.playgrounds?.length || 0,
    cells: plan.cellUse.size
  };
}

export const PUBLIC_SPACE_KIND = ['path', 'sports', 'garden', 'playground'];
