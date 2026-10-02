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
    this.decorativeSeeded = 0;
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

  foliageCount() {
    let count = 0;
    for (const list of this.town.customProps.values()) {
      for (const type of list) if (this.isTreeProp(type) || type === 'bush') count++;
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

  addFoliageRaw(x, y, type = 'bush') {
    const t = this.town;
    const g = t.grid;
    if (!this.canGrow(x, y)) return false;
    const idx = g.idx(x, y);
    const list = t.customProps.get(idx) || [];
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
   * Seed the complete 100x100 build plate once after founding assets and the
   * initial perimeter exist. The irregular polygon wraps the serviced envelope
   * without becoming a straight hedge: it reads as a dense woodland at the
   * town edge while the interior remains clear enough to plan new lots.
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
    // Uneven corners make a distinct polygonal woodland ring around the
    // founding envelope. The perimeter ledger remains rectangular; this shape
    // is only a visual/ecological band and never grants land ownership.
    const polygon = [
      [minX - 7, minY - 2],
      [minX + 2, minY - 7],
      [maxX - 4, minY - 6],
      [maxX + 6, minY - 1],
      [maxX + 9, minY + 8],
      [maxX + 6, maxY - 5],
      [maxX + 2, maxY + 8],
      [maxX - 8, maxY + 10],
      [minX + 3, maxY + 7],
      [minX - 7, maxY + 3],
      [minX - 10, maxY - 6],
      [minX - 8, minY + 6]
    ];
    const rng = this.rng.fork(9917);
    const interiorCandidates = [];
    let added = 0;
    g.forEach((x, y) => {
      if (!this.canGrow(x, y)) return;
      // Treat the tight founding envelope as town land for visual density even
      // where a cell is still an unacquired gap between two assets. Otherwise
      // the open gaps inside the rectangle would get frontier density and the
      // centre would look like a meadow rather than a neighbourhood.
      const insideEnvelope = x >= minX && x <= maxX && y >= minY && y <= maxY;
      if (insideEnvelope) {
        interiorCandidates.push([x, y]);
        return;
      }
      const outside = t.perimeter ? !t.perimeter.isAcquired(x, y) : true;
      const denseEdge = !insideEnvelope && outside && this.pointInPolygon(x + 0.5, y + 0.5, polygon);
      // The edge band is dense, while the owned town is deliberately sparse so
      // roads, buildings and future construction remain legible. The wider
      // frontier still gets light woodland coverage instead of an empty green
      // void; clearing any of it returns timber to the lumber stock.
      const chance = denseEdge ? 0.92 : insideEnvelope ? 0.015 : 0.12;
      if (!rng.chance(chance)) return;
      const type = rng.chance(denseEdge ? 0.27 : 0.14) ? 'pine' : 'tree';
      if (this.addTreeRaw(x, y, type)) { this.seeded++; added++; }
    });
    // The envelope gets intentional landscaping rather than the same random
    // ecology as the frontier: about fifty canopy specimens make the town
    // feel inhabited, with a small understory layer for parks and courtyards.
    for (let i = interiorCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [interiorCandidates[i], interiorCandidates[j]] = [interiorCandidates[j], interiorCandidates[i]];
    }
    const interiorTrees = Math.min(50, interiorCandidates.length);
    for (let i = 0; i < interiorTrees; i++) {
      const [x, y] = interiorCandidates[i];
      const type = rng.chance(0.24) ? 'pine' : 'tree';
      if (this.addTreeRaw(x, y, type)) { this.seeded++; added++; }
    }
    const interiorBushes = Math.min(12, Math.max(0, interiorCandidates.length - interiorTrees));
    for (let i = 0; i < interiorBushes; i++) {
      const [x, y] = interiorCandidates[interiorTrees + i];
      if (this.addFoliageRaw(x, y, 'bush')) { this.decorativeSeeded++; added++; }
    }
    if (added) {
      t.rebuildStatic({ roads: false, lots: true, validate: false });
      events.emit('log', {
        kind: 'event',
        text: `Founding woodland planted - ${this.treeCount()} trees and ${this.decorativeSeeded} decorative foliage across the build plate, with a dense irregular edge stand.`,
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
      seeded: this.seeded, decorativeSeeded: this.decorativeSeeded,
      planted: this.planted, felled: this.felled,
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
      foliage: this.foliageCount(),
      decorative: this.decorativeSeeded || 0,
      seeded: this.seeded,
      planted: this.planted,
      felled: this.felled,
      naturalFalls: this.naturalFalls,
      lumberYield: this.lumberYield,
      coverage: Math.round((this.treeCount() / Math.max(1, this.town.grid.w * this.town.grid.h)) * 100)
    };
  }
}
