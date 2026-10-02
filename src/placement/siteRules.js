/**
 * Shared land-use setbacks.
 *
 * Resource sites are working yards, not decorative empty lots.
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

/**
 * Facility sites that should not share a kerb with ordinary development.
 *
 * Fuel stations are intentionally omitted: they are public-facing civic
 * infrastructure and the land-use model keeps them close to town. Lakes are
 * also omitted because a water edge is an amenity rather than a noisy yard.
 * Industrial buildings are allowed beside the sites that supply them.
 */
export const RESOURCE_SITE_KINDS = Object.freeze(new Set([
  'reservoir',
  'silo',
  'windmill',
  'solar',
  'farm',
  'husbandry',
  'poultry',
  'battery'
]));

/** Tiles kept clear between a resource facility and ordinary development. */
export const RESOURCE_BUILDING_SETBACK = 2;

/**
 * Education facilities with a real campus footprint. These are planned as
 * districts rather than kerb-side amenities: two campuses need a walkable
 * institutional catchment between them, even when a road separates their
 * parcels. The rule deliberately covers schools and conservatories as well as
 * tertiary campuses so a later catalogue addition cannot create a second
 * school directly across the street from the first one.
 */
export const EDUCATION_CAMPUS_FACILITIES = Object.freeze(new Set([
  'school',
  'college',
  'university',
  'conservatory',
  'campus'
]));

/** Chebyshev tiles kept clear around an education campus. */
export const EDUCATION_CAMPUS_SETBACK = 3;

function cellsOf(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (candidate?.cells?.length) return candidate.cells;
  if (candidate?.footprint?.length) return candidate.footprint;
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

/**
 * Return the first production/storage facility that is too close to a public
 * or residential candidate. Factories are deliberately exempt: co-location
 * with a supplier is a valid industrial pattern and the industrial siting
 * rule already keeps works on the rim.
 */
export function resourceSetbackConflict(
  resources,
  candidate,
  { zone = null, kind = null, buffer = RESOURCE_BUILDING_SETBACK } = {}
) {
  if (zone === 'industrial' || kind === 'factory') return null;
  const cells = cellsOf(candidate);
  if (!cells.length || !resources?.sites?.length) return null;
  const gap = Math.max(0, Math.round(buffer));
  for (const site of resources.sites) {
    if (!RESOURCE_SITE_KINDS.has(site?.kind)) continue;
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

/**
 * Resource planning runs after the founding buildings. Reject a facility
 * footprint that would be placed beside an existing ordinary building. This
 * closes the inverse of resourceSetbackConflict, including later resource
 * expansion and replacement sites.
 */
export function resourceSiteBuildingConflict(
  town,
  candidate,
  siteKind,
  buffer = RESOURCE_BUILDING_SETBACK
) {
  if (!RESOURCE_SITE_KINDS.has(siteKind)) return null;
  const cells = cellsOf(candidate);
  if (!cells.length || !town?.buildings?.length) return null;
  const gap = Math.max(0, Math.round(buffer));
  for (const building of town.buildings) {
    if (building?.zone === 'industrial' || building?.kind === 'factory') continue;
    const occupied = cellsOf(building);
    for (const [x, y] of cells) {
      for (const [bx, by] of occupied) {
        const distance = Math.max(Math.abs(x - bx), Math.abs(y - by));
        if (distance <= gap) return { building, cell: [x, y], buildingCell: [bx, by], distance };
      }
    }
  }
  return null;
}

/**
 * Return the first education campus that is too close to a candidate campus.
 * Chebyshev distance treats a diagonal corner and a road-facing opposite lot
 * consistently: a one-tile road between two footprints is still a conflict,
 * while a genuine institutional buffer is accepted. `candidateFacility` is
 * required so ordinary civic buildings can continue using the frontage grid.
 */
export function educationCampusConflict(
  town,
  candidate,
  candidateFacility,
  buffer = EDUCATION_CAMPUS_SETBACK
) {
  if (!EDUCATION_CAMPUS_FACILITIES.has(candidateFacility)) return null;
  const cells = cellsOf(candidate);
  if (!cells.length || !town?.buildings?.length) return null;
  const gap = Math.max(0, Math.round(buffer));
  for (const building of town.buildings) {
    const facility = building?.facility || building?.subtype;
    if (!EDUCATION_CAMPUS_FACILITIES.has(facility)) continue;
    const occupied = cellsOf(building);
    for (const [x, y] of cells) {
      for (const [bx, by] of occupied) {
        const distance = Math.max(Math.abs(x - bx), Math.abs(y - by));
        if (distance <= gap) {
          return { building, cell: [x, y], campusCell: [bx, by], distance, buffer: gap };
        }
      }
    }
  }
  return null;
}

export function violatesEducationCampusSetback(
  town,
  candidate,
  candidateFacility,
  buffer = EDUCATION_CAMPUS_SETBACK
) {
  return !!educationCampusConflict(town, candidate, candidateFacility, buffer);
}
