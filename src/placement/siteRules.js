/**
 * Shared land-use setbacks.
 *
 * Agricultural resource sites are working yards, not decorative empty lots.
 * Their fields, paddocks and poultry runs need a quiet buffer for access,
 * odour, dust and future expansion. Keep this rule in a dependency-free
 * module so the council picker and the player placement path cannot drift.
 */

/** Resource kinds whose cells represent an agricultural yard or field. */
export const AGRICULTURAL_SITE_KINDS = Object.freeze(new Set([
  'farm',
  'husbandry',
  'poultry'
]));

/** Chebyshev tiles kept clear around an agricultural yard. */
export const AGRICULTURAL_SETBACK = 2;

function cellsOf(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (candidate?.cells?.length) return candidate.cells;
  if (candidate?.cell) return [candidate.cell];
  return [];
}

/**
 * Return the first agricultural yard that conflicts with a candidate
 * footprint, or null when the candidate has the required separation.
 */
export function agriculturalSetbackConflict(resources, candidate, buffer = AGRICULTURAL_SETBACK) {
  const cells = cellsOf(candidate);
  if (!cells.length || !resources?.sites?.length) return null;
  const gap = Math.max(0, Math.round(buffer));
  for (const site of resources.sites) {
    if (!AGRICULTURAL_SITE_KINDS.has(site?.kind)) continue;
    const yard = cellsOf(site);
    for (const [x, y] of cells) {
      for (const [sx, sy] of yard) {
        const distance = Math.max(Math.abs(x - sx), Math.abs(y - sy));
        if (distance <= gap) return { site, cell: [x, y], siteCell: [sx, sy], distance };
      }
    }
  }
  return null;
}

export function violatesAgriculturalSetback(resources, candidate, buffer = AGRICULTURAL_SETBACK) {
  return !!agriculturalSetbackConflict(resources, candidate, buffer);
}

