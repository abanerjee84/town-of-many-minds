import { findPath } from '../core/pathfinding.js';
import performanceRules from '../data/performance.json' with { type: 'json' };

const caches = new WeakMap();
const walkable = (x, y, grid) => grid.isRoad(x, y);

/** Only unweighted pedestrian road cells are cached. Vehicle costs remain live. */
export function cachedRoadPath(town, from, to) {
  let cache = caches.get(town);
  if (!cache || cache.grid !== town.grid || cache.version !== town.roadGraphVersion) {
    cache = { grid: town.grid, version: town.roadGraphVersion, paths: new Map(), junctions: null };
    caches.set(town, cache);
  }
  const key = `${from[0]},${from[1]}>${to[0]},${to[1]}`;
  if (cache.paths.has(key)) return cache.paths.get(key);
  const path = findPath(town.grid, from, to, { walkable, maxNodes: 9000 });
  // Cached cells are immutable; each walker builds its own current doorway,
  // pavement, crossing and avoidance geometry from them.
  if (path) {
    for (const cell of path) Object.freeze(cell);
    Object.freeze(path);
  }
  const limit = performanceRules.agents.roadPathCacheEntries || 512;
  if (cache.paths.size >= limit) cache.paths.delete(cache.paths.keys().next().value);
  cache.paths.set(key, path);
  return path;
}

/** Stable row-major crossing catalogue; road mutations invalidate it with paths. */
export function roadJunctions(town) {
  let cache = caches.get(town);
  if (!cache || cache.grid !== town.grid || cache.version !== town.roadGraphVersion) {
    cache = { grid: town.grid, version: town.roadGraphVersion, paths: new Map(), junctions: null };
    caches.set(town, cache);
  }
  if (!cache.junctions) {
    cache.junctions = [];
    town.grid.forEach((x,y,g)=>{
      if (g.isRoad(x,y) && g.roadDegree(x,y)>=3) cache.junctions.push([x,y]);
    });
  }
  return cache.junctions;
}
