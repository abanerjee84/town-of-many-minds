/** Mutable broad phase for one physics step. Callers retain exact collision tests. */
export class SpatialIndex {
  constructor(cellSize = 8, cacheEntries = 256) {
    this.cellSize = cellSize;
    this.cacheEntries = cacheEntries;
    this.buckets = new Map();
    this.entries = new Map();
    this.queries = new Map();
    this.nextOrder = 0;
  }
  key(x, z) { return Math.floor(x / this.cellSize) * 65536 + Math.floor(z / this.cellSize); }
  clear() {
    this.buckets.clear();
    this.entries.clear();
    this.queries.clear();
    this.nextOrder = 0;
  }
  rebuild(list) {
    this.clear();
    for (let i = 0; i < list.length; i++) this.update(list[i], i);
  }
  update(agent, order = this.entries.get(agent)?.order ?? this.nextOrder++) {
    this.nextOrder = Math.max(this.nextOrder, order + 1);
    const p = agent.group.position;
    const key = this.key(p.x, p.z);
    const previous = this.entries.get(agent);
    if (previous?.key === key) return;
    this.queries.clear();
    if (previous) this.remove(agent);
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, bucket = new Set());
    bucket.add(agent);
    this.entries.set(agent, { key, order });
  }
  remove(agent) {
    const entry = this.entries.get(agent);
    if (!entry) return;
    this.queries.clear();
    const bucket = this.buckets.get(entry.key);
    bucket.delete(agent);
    if (!bucket.size) this.buckets.delete(entry.key);
    this.entries.delete(agent);
  }
  near(x, z, radius) {
    const size = this.cellSize;
    const minX = Math.floor((x - radius) / size), maxX = Math.floor((x + radius) / size);
    const minZ = Math.floor((z - radius) / size), maxZ = Math.floor((z + radius) / size);
    const key = `${minX},${maxX},${minZ},${maxZ}`;
    const cached = this.queries.get(key);
    if (cached) return cached;
    const result = [];
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const bucket = this.buckets.get(bx * 65536 + bz);
        if (!bucket) continue;
        for (const agent of bucket) {
          result.push(agent);
        }
      }
    }
    // First-blocker and equal-distance choices retain the original roster order.
    result.sort((a, b) => this.entries.get(a).order - this.entries.get(b).order);
    // Lists cover complete buckets. Fine distance/geometry checks stay live at
    // the caller even when an agent moves within its current bucket.
    if (this.queries.size >= this.cacheEntries) this.queries.clear();
    this.queries.set(key, result);
    return result;
  }
}
