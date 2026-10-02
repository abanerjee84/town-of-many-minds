import { events } from '../core/events.js';

/**
 * The rendered grid is deliberately larger than the founding hamlet. This
 * ledger separates "visible ground" from land the town has actually brought
 * inside its serviced perimeter. Existing roads/buildings and a one-cell
 * service apron are seeded; the open blocks between them still have to be
 * acquired as the town grows. Roads can only pull new land in through a
 * contiguous extension, and the acquisition is paid once for fresh cells.
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
    this.costPerCell = 650;
  }

  key(x, y) { return `${x},${y}`; }

  seed() {
    const g = this.town.grid;
    let minX = g.w - 1; let minY = g.h - 1;
    let maxX = 0; let maxY = 0; let seen = 0;
    const occupied = [];
    g.forEach((x, y, grid) => {
      if (grid.kindAt(x, y) === 1 || this.town.buildingAt(x, y)) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        occupied.push([x, y]);
        seen++;
      }
    });
    if (!seen) return this.reset();
    for (const [x, y] of occupied) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (!g.inBounds(nx, ny) || g.isWater(nx, ny)) continue;
        this.acquired.add(this.key(nx, ny));
      }
    }
    this.minX = Math.max(0, minX - 1);
    this.minY = Math.max(0, minY - 1);
    this.maxX = Math.min(g.w - 1, maxX + 1);
    this.maxY = Math.min(g.h - 1, maxY + 1);
    this.acquiredCells = this.acquired.size;
  }

  isAcquired(x, y) { return this.acquired.has(this.key(x, y)); }

  quote(cells = []) {
    const fresh = [];
    for (const [x, y] of cells) {
      if (!this.town.grid.inBounds(x, y) || this.isAcquired(x, y)) continue;
      const key = this.key(x, y);
      if (!fresh.some((c) => c.key === key)) fresh.push({ x, y, key });
    }
    return { cells: fresh.map(({ x, y }) => [x, y]), cost: fresh.length * this.costPerCell };
  }

  frontierCells(limit = 6) {
    const g = this.town.grid;
    const out = [];
    for (let y = Math.max(0, this.minY - 1); y <= Math.min(g.h - 1, this.maxY + 1); y++) {
      for (let x = Math.max(0, this.minX - 1); x <= Math.min(g.w - 1, this.maxX + 1); x++) {
        if (this.isAcquired(x, y) || g.kindAt(x, y) !== 0 || g.isWater(x, y)) continue;
        const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.isAcquired(x + dx, y + dy));
        if (adjacent) out.push([x, y]);
        if (out.length >= limit) return out;
      }
    }
    return out;
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

  stats() {
    const g = this.town.grid;
    return {
      acquired: this.acquiredCells,
      available: Math.max(0, g.w * g.h - this.acquiredCells),
      expansions: this.expansions,
      bounds: Number.isFinite(this.minX) ? { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY } : null,
      last: this.last,
      nextTileCost: this.costPerCell
    };
  }
}
