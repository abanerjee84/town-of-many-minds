/**
 * Shared foliage vocabulary for the simulation and renderer.
 *
 * Forest stewardship decides where foliage may live; this kit decides how a
 * requested variant is represented. Keeping the variants here makes a town's
 * intentional landscaping distinct from the natural woodland seed.
 */
import { buildTree, buildPine, buildBush } from './propKit.js';

export const FOLIAGE_VARIANTS = Object.freeze([
  Object.freeze({ id: 'tree', label: 'Street tree', role: 'canopy' }),
  Object.freeze({ id: 'pine', label: 'Pine accent', role: 'evergreen' }),
  Object.freeze({ id: 'bush', label: 'Low shrub', role: 'understory' })
]);

export function buildFoliage(type, rng, scale = 1) {
  if (type === 'pine') return buildPine(rng, scale);
  if (type === 'bush') return buildBush(rng, scale);
  return buildTree(rng, scale);
}

/** Deterministic choice used by small player/Council landscaping plans. */
export function chooseFoliage(rng, { decorative = false } = {}) {
  if (decorative && rng.chance(0.22)) return 'bush';
  return rng.chance(0.24) ? 'pine' : 'tree';
}
