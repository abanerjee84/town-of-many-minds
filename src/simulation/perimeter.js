import { events } from '../core/events.js';
import { CELL_KIND } from '../core/config.js';
import { basePrice, quotePrice } from './priceChart.js';

/**
 * The rendered grid is deliberately larger than the founding hamlet. This
 * ledger separates "visible ground" from land the town has actually brought
 * inside its serviced perimeter. The founding buildings, resource sites, and
 * their roads define a tight envelope. Every non-water cell inside that
 * envelope is acquired at start; only cells beyond it are frontier land.
 * Roads can only pull new land in through a contiguous extension, and
 * acquisition is paid once for fresh cells.
 */
export class PerimeterSystem {
  constructor(town) {
    this.town = town;
    this.reset();
  }

  reset() {
    this.acquired = new Set();
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this.expansions = 0;
    this.acquiredCells = 0;
    this.last = null;
    this.costPerCell = basePrice('land', 650);
  }

  key(x, y) { return `${x},${y}`; }

  seed() {
    const g = this.town.grid;
    let minX = g.w - 1; let minY = g.h - 1;
    let maxX = 0; let maxY = 0; let seen = 0;
    const occupied = [];
    for (const building of this.town.buildings || []) {
      for (const cell of building.footprint?.length ? building.footprint : [building.cell]) {
        if (!cell || !g.inBounds(cell[0], cell[1])) continue;
        minX = Math.min(minX, cell[0]); minY = Math.min(minY, cell[1]);
        maxX = Math.max(maxX, cell[0]); maxY = Math.max(maxY, cell[1]);
        occupied.push(cell);
        seen++;
      }
    }
    // Founding resource sites are municipal assets too. Include their exact
    // cells in the initial ledger so a farm, reservoir or power yard is never
    // rendered outside the town's own boundary. This keeps the envelope tight
    // around the complete founding settlement while leaving the open cells
    // between assets for future acquisition.
    for (const site of this.town.resources?.sites || []) {
      for (const cell of site.cells || (site.cell ? [site.cell] : [])) {
        if (!cell || !g.inBounds(cell[0], cell[1])) continue;
        minX = Math.min(minX, cell[0]); minY = Math.min(minY, cell[1]);
        maxX = Math.max(maxX, cell[0]); maxY = Math.max(maxY, cell[1]);
        occupied.push(cell);
        seen++;
      }
    }
    // Public green/plaza cells are already commissioned town land. Seeding
    // them keeps the initial boundary from cutting through an opening park;
    // the complete envelope is acquired below, including its unzoned cells.
    g.forEach((x, y) => {
      const kind = g.kindAt(x, y);
      if (kind !== CELL_KIND.PARK && kind !== CELL_KIND.PLAZA) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      occupied.push([x, y]);
      seen++;
    });
    // Seed all existing founding roads as serviced infrastructure. Their
    // envelope is still bounded by the compact resource/building envelope,
    // while every later street must be acquired through the frontier planner.
    g.forEach((x, y) => {
      if (!g.isRoad(x, y)) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      occupied.push([x, y]);
      seen++;
    });
    // A road-only founding is still valid in a partially generated test town;
    // the road sweep above normally covers it, but keep this fallback for
    // minimal fixtures that do not expose a Grid.forEach implementation.
    if (!seen) {
      g.forEach((x, y) => {
        if (!g.isRoad(x, y)) return;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        occupied.push([x, y]);
        seen++;
      });
    }
    if (!seen) return this.reset();
    const roadMinX = Math.max(0, minX - 1);
    const roadMaxX = Math.min(g.w - 1, maxX + 1);
    const roadMinY = Math.max(0, minY - 1);
    const roadMaxY = Math.min(g.h - 1, maxY + 1);
    g.forEach((x, y) => {
      if (x >= roadMinX && x <= roadMaxX && y >= roadMinY && y <= roadMaxY && g.isRoad(x, y)) occupied.push([x, y]);
    });
    // The tight founding envelope is already town land. Acquire every
    // non-water cell inside it, while leaving the ring outside the envelope
    // as frontier. The old exact-asset ledger left empty cells between roads,
    // homes, and resources looking like frontier, so ACQUIRE_LAND could buy
    // an interior tile even though the player was still inside the initial
    // town. Future acquisition is now unambiguously outward.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!g.inBounds(x, y) || g.isWater(x, y)) continue;
        this.acquired.add(this.key(x, y));
      }
    }
    this.minX = Math.max(0, minX);
    this.minY = Math.max(0, minY);
    this.maxX = Math.min(g.w - 1, maxX);
    this.maxY = Math.min(g.h - 1, maxY);
    this.acquiredCells = this.acquired.size;
  }

  isAcquired(x, y) { return this.acquired.has(this.key(x, y)); }

  /**
   * Bounds of the cells the town actually owns. `minX..maxY` is the serviced
   * perimeter envelope used by frontier surveys and the ground plane; it can
   * include empty gaps while the ledger is expanding around an irregular
   * edge. Camera framing must use the acquired-cell set itself.
   */
  acquiredBounds() {
    const g = this.town.grid;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const key of this.acquired) {
      const [x, y] = key.split(',').map(Number);
      if (!g.inBounds(x, y) || g.isWater(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  quote(cells = []) {
    const fresh = [];
    for (const [x, y] of cells) {
      if (!this.town.grid.inBounds(x, y) || this.isAcquired(x, y)) continue;
      const key = this.key(x, y);
      if (!fresh.some((c) => c.key === key)) fresh.push({ x, y, key });
    }
    const cost = fresh.length ? quotePrice('land', this.town, { quantity: fresh.length, fallback: this.costPerCell }) : 0;
    return { cells: fresh.map(({ x, y }) => [x, y]), cost };
  }

  frontierCells(limit = 6) {
    const g = this.town.grid;
    const candidates = [];
    for (let y = Math.max(0, this.minY - 1); y <= Math.min(g.h - 1, this.maxY + 1); y++) {
      for (let x = Math.max(0, this.minX - 1); x <= Math.min(g.w - 1, this.maxX + 1); x++) {
        if (this.isAcquired(x, y) || g.kindAt(x, y) !== 0 || g.isWater(x, y)) continue;
        const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.isAcquired(x + dx, y + dy));
        if (!adjacent) continue;
        let roadAdj = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (g.isRoad(x + dx, y + dy)) roadAdj++;
        }
        // A purchase should open usable town land. Prefer a parcel's actual
        // street-facing cell over a vacant cell that merely touches the
        // envelope through a resource yard, park, or another unbuildable lot.
        const parcel = this.town.parcels?.at?.(x, y);
        const front = parcel && this.town.parcels?.buildableCell?.(parcel);
        const buildableFront = !!parcel?.buildable && !!front && front[0] === x && front[1] === y;
        const outside = x === this.minX - 1 || x === this.maxX + 1 || y === this.minY - 1 || y === this.maxY + 1;
        const score = roadAdj * 100 + (buildableFront ? 40 : 0) + (parcel?.buildable ? 10 : 0) + (outside ? 8 : 0);
        candidates.push({ cell: [x, y], roadAdj, buildableFront, outside, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score || b.roadAdj - a.roadAdj ||
      a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
    // Keep the fallback ring available when a road has no empty frontage yet,
    // but never let that fallback outrank a serviced construction plot.
    const serviced = candidates.filter((c) => c.roadAdj > 0 && c.buildableFront);
    const chosen = serviced.length ? serviced.slice() : candidates.slice();
    // Each shortage purchase includes one contiguous frontier tile beyond the
    // current envelope. The remaining tiles are useful frontage when it
    // exists, so acquisition both advances the boundary and opens build sites.
    const outside = candidates.find((c) => c.outside);
    if (outside) {
      const existing = chosen.findIndex((c) => c.cell[0] === outside.cell[0] && c.cell[1] === outside.cell[1]);
      if (existing >= 0) chosen.splice(existing, 1);
      else chosen.pop();
      chosen.unshift(outside);
    }
    return chosen.slice(0, limit).map((c) => c.cell);
  }

  acquire(cells = [], { reason = 'perimeter expansion', charge = true } = {}) {
    const quote = this.quote(cells);
    if (!quote.cells.length) return { ok: true, ...quote, added: 0 };
    if (charge && this.town.economy && this.town.economy.treasury < quote.cost) {
      return { ok: false, ...quote, reason: `land acquisition needs $${quote.cost.toLocaleString('en-US')}` };
    }
    if (charge && this.town.economy) {
      const paid = this.town.economy.transfer({
        from: 'government', to: 'external', amount: quote.cost,
        category: 'public_investment', metadata: { land: quote.cells.length, reason }
      });
      if (!paid.ok) return { ok: false, ...quote, reason: paid.reason || 'land acquisition failed' };
    }
    for (const [x, y] of quote.cells) {
      this.acquired.add(this.key(x, y));
      this.minX = Math.min(this.minX, x); this.minY = Math.min(this.minY, y);
      this.maxX = Math.max(this.maxX, x); this.maxY = Math.max(this.maxY, y);
    }
    this.expansions++;
    this.acquiredCells = this.acquired.size;
    this.last = { day: this.town.economy?.lastDay || 1, cells: quote.cells.length, cost: quote.cost, reason };
    events.emit('land-acquired', { ...this.last, cells: quote.cells });
    events.emit('log', { kind: 'event', text: `The town acquires ${quote.cells.length} new perimeter tile${quote.cells.length === 1 ? '' : 's'} for expansion.` });
    return { ok: true, ...quote, added: quote.cells.length };
  }

  /** Roll back a speculative site reservation after a failed project. */
  release(cells = []) {
    const removed = new Set();
    for (const [x, y] of cells) {
      const key = this.key(x, y);
      if (!this.acquired.has(key)) continue;
      this.acquired.delete(key);
      removed.add(key);
    }
    if (!removed.size) return 0;
    this.acquiredCells = this.acquired.size;
    this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity;
    for (const key of this.acquired) {
      const [x, y] = key.split(',').map(Number);
      this.minX = Math.min(this.minX, x); this.minY = Math.min(this.minY, y);
      this.maxX = Math.max(this.maxX, x); this.maxY = Math.max(this.maxY, y);
    }
    events.emit('land-released', { cells: [...removed].map((key) => key.split(',').map(Number)) });
    return removed.size;
  }

  stats() {
    const g = this.town.grid;
    return {
      acquired: this.acquiredCells,
      available: Math.max(0, g.w * g.h - this.acquiredCells),
      expansions: this.expansions,
      bounds: Number.isFinite(this.minX) ? { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY } : null,
      last: this.last,
      nextTileCost: quotePrice('land', this.town, { fallback: this.costPerCell })
    };
  }
}
