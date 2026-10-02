import { CELL_KIND } from '../core/config.js';
import { makeRng } from '../core/rng.js';
import { events } from '../core/events.js';

/**
 * Forest stewardship for the whole build plate.
 *
 * Trees remain ordinary custom props so the existing renderer, savepoints and
 * bulldozer keep one source of truth. This system owns the policy around those
 * props: how the founding woods are seeded, how planting is counted, how
 * clearing returns timber, and the small deterministic natural-fall cycle.
 */
export class ForestSystem {
  constructor(town) {
    this.town = town;
    this.reset(town.seed || 1);
  }

  reset(seed = 1) {
    this.rng = makeRng(`${seed}:forest`);
    this.seeded = 0;
    this.planted = 0;
    this.felled = 0;
    this.naturalFalls = 0;
    this.lumberYield = 0;
    this.lastDay = null;
    this.fallDebt = 0;
  }

  isTreeProp(type) {
    return type === 'tree' || type === 'pine';
  }

  treeCount() {
    let count = 0;
    for (const list of this.town.customProps.values()) {
      for (const type of list) if (this.isTreeProp(type)) count++;
    }
    return count;
  }

  hasTreeAt(x, y) {
    const g = this.town.grid;
    if (!g.inBounds(x, y)) return false;
    return (this.town.customProps.get(g.idx(x, y)) || []).some((type) => this.isTreeProp(type));
  }

  treeCells() {
    const out = [];
    for (const [idx, list] of this.town.customProps) {
      const tree = list.some((type) => this.isTreeProp(type));
      if (!tree) continue;
      const y = Math.floor(idx / this.town.grid.w);
      const x = idx - y * this.town.grid.w;
      out.push([x, y]);
    }
    return out;
  }

  canGrow(x, y) {
    const t = this.town;
    const g = t.grid;
    if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isPath(x, y) || g.isWater(x, y)) return false;
    if (g.kindAt(x, y) === CELL_KIND.PLAZA) return false;
    if (t.buildingAt(x, y) || t.resources?.ownsCell(x, y)) return false;
    const list = t.customProps.get(g.idx(x, y)) || [];
    // Keep street furniture and existing decorative props readable. A tree
    // may share a cell with a lamp in the old API, but a plantation should not
    // bury that lamp in a grove.
    if (list.some((type) => type === 'lamp' || type === 'bench' || type === 'bush')) return false;
    return list.length < 6;
  }

  addTreeRaw(x, y, type = 'tree') {
    const t = this.town;
    const g = t.grid;
    if (!this.canGrow(x, y)) return false;
    const idx = g.idx(x, y);
    const list = t.customProps.get(idx) || [];
    if (list.some((item) => this.isTreeProp(item))) return false;
    list.push(type);
    t.customProps.set(idx, list);
    return true;
  }

  plant(x, y, { source = 'plantation', rebuild = true, type = null } = {}) {
    const chosen = type || (this.rng.chance(0.18) ? 'pine' : 'tree');
    if (!this.addTreeRaw(x, y, chosen)) return false;
    if (source === 'seed') this.seeded++;
    else this.planted++;
    if (rebuild) this.town.rebuildStatic({ roads: false, lots: true, validate: false });
    events.emit('forest-change', { action: 'plant', source, cell: [x, y], trees: this.treeCount() });
    return true;
  }

  /** Record a tree removed by a road, building, park, or bulldozer. */
  recordCleared(count, { reason = 'deforestation', rebuild = false } = {}) {
    if (!count) return 0;
    this.felled += count;
    this.lumberYield += count * 4;
    this.town.industry?.refund({ lumber: count * 4 });
    events.emit('forest-change', { action: 'fell', reason, count, lumber: count * 4, trees: this.treeCount() });
    if (rebuild) this.town.rebuildStatic({ roads: false, lots: true, validate: false });
    return count;
  }

  fellOne(x, y, { reason = 'natural fall', natural = false } = {}) {
    const t = this.town;
    const g = t.grid;
    if (!g.inBounds(x, y)) return false;
    const idx = g.idx(x, y);
    const list = t.customProps.get(idx);
    if (!list) return false;
    const at = list.findIndex((type) => this.isTreeProp(type));
    if (at < 0) return false;
    list.splice(at, 1);
    if (list.length) t.customProps.set(idx, list);
    else t.customProps.delete(idx);
    this.recordCleared(1, { reason });
    if (natural) this.naturalFalls++;
    return true;
  }

  pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const crossing = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
      if (crossing) inside = !inside;
    }
    return inside;
  }

  /**
   * Seed the complete build plate once after founding assets and the initial
   * perimeter exist. The irregular polygon is intentionally outside the
   * serviced envelope: it reads as a dense woodland at the town edge while
   * leaving a meaningful, tree covered frontier for future acquisition.
   */
  seedInitial() {
    const t = this.town;
    const g = t.grid;
    const bounds = t.perimeter?.stats?.().bounds || {
      minX: Math.floor(g.w * 0.3), minY: Math.floor(g.h * 0.3),
      maxX: Math.ceil(g.w * 0.7), maxY: Math.ceil(g.h * 0.7)
    };
    const minX = bounds.minX; const minY = bounds.minY;
    const maxX = bounds.maxX; const maxY = bounds.maxY;
    // Eight uneven corners make a distinct polygonal woodland at the southern
    // edge of the founding envelope; it is never the rectangle used by the
    // perimeter ledger and does not turn the whole frontier into one uniform
    // wall of trees.
    const edgeX = Math.floor((minX + maxX) / 2);
    const polygon = [
      [edgeX - 11, maxY - 2],
      [edgeX - 7, maxY + 3],
      [edgeX - 1, maxY + 6],
      [edgeX + 9, maxY + 5],
      [edgeX + 13, maxY + 1],
      [edgeX + 7, maxY - 4],
      [edgeX - 3, maxY - 5],
      [edgeX - 8, maxY - 3]
    ];
    const rng = this.rng.fork(9917);
    let added = 0;
    g.forEach((x, y) => {
      if (!this.canGrow(x, y)) return;
      const outside = t.perimeter ? !t.perimeter.isAcquired(x, y) : true;
      const denseEdge = outside && this.pointInPolygon(x + 0.5, y + 0.5, polygon);
      // The outer plate is wooded rather than an empty green void. The edge
      // polygon is a dense stand; serviced land is lighter so future lots are
      // still readable and construction clears it into usable timber.
      const chance = denseEdge ? 0.98 : outside ? 0.84 : 0.28;
      if (!rng.chance(chance)) return;
      const type = rng.chance(denseEdge ? 0.27 : 0.14) ? 'pine' : 'tree';
      if (this.addTreeRaw(x, y, type)) { this.seeded++; added++; }
    });
    if (added) {
      t.rebuildStatic({ roads: false, lots: true, validate: false });
      events.emit('log', {
        kind: 'event',
        text: `Founding woodland planted · ${added} trees across the build plate, with a dense irregular edge stand.`
      });
    }
    return added;
  }

  /** Advance natural fall using game days, independent of render frame rate. */
  update(clock) {
    if (!clock) return;
    if (this.lastDay == null) this.lastDay = clock.day;
    const elapsedDays = Math.max(0, clock.day - this.lastDay);
    if (!elapsedDays) return;
    this.lastDay = clock.day;
    const count = this.treeCount();
    // A low, bounded hazard: mature woodland renews itself over years instead
    // of disappearing during a fast 800-day soak. One fall yields four lumber.
    this.fallDebt += count * 0.00045 * elapsedDays;
    // Forestry crews inspect the plate weekly. Accruing the hazard daily but
    // rebuilding decoration only on inspection days keeps a 100x/800-day run
    // cheap while preserving deterministic, time-based falls.
    if (clock.day % 7 !== 0) return;
    let fallen = 0;
    while (this.fallDebt >= 1) {
      this.fallDebt -= 1;
      const cells = this.treeCells();
      if (!cells.length) { this.fallDebt = 0; break; }
      const [x, y] = cells[Math.floor(this.rng.next() * cells.length)];
      if (this.fellOne(x, y, { natural: true })) fallen++;
    }
    if (!fallen) return;
    this.town.rebuildStatic({ roads: false, lots: true, validate: false });
    events.emit('log', {
      kind: 'event',
      text: `${fallen} tree${fallen === 1 ? '' : 's'} fell naturally · ${fallen * 4} lumber recovered.`
    });
  }

  snapshot() {
    return {
      seeded: this.seeded, planted: this.planted, felled: this.felled,
      naturalFalls: this.naturalFalls, lumberYield: this.lumberYield,
      lastDay: this.lastDay, fallDebt: this.fallDebt, rng: this.rng.getState()
    };
  }

  restore(state) {
    if (!state) return;
    Object.assign(this, state);
    this.rng = makeRng(1);
    this.rng.setState(state.rng ?? 1);
  }

  stats() {
    return {
      trees: this.treeCount(),
      seeded: this.seeded,
      planted: this.planted,
      felled: this.felled,
      naturalFalls: this.naturalFalls,
      lumberYield: this.lumberYield,
      coverage: Math.round((this.treeCount() / Math.max(1, this.town.grid.w * this.town.grid.h)) * 100)
    };
  }
}
