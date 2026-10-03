import { jitterColor } from '../geometry.js';
import rules from '../../data/civicRules.json' with { type: 'json' };
import catalog from '../../data/civicCatalog.json' with { type: 'json' };

/**
 * Civic Kit (1.9). Every facility is authored through the same modular
 * Building Kit — this catalogue only supplies the parameters (massing, finish,
 * capacity, purpose) that make a School read as a School.
 */
export const CIVIC_FACILITY = {
  TOWN_HALL: 'townhall',
  LIBRARY: 'library',
  SCHOOL: 'school',
  CLINIC: 'clinic',
  HOSPITAL: 'hospital',
  POLICE: 'police',
  FIRE: 'fire',
  GOVERNMENT: 'government',
  COMMUNITY: 'community',
  POST_OFFICE: 'postoffice',
  DAYCARE: 'daycare',
  MUSEUM: 'museum',
  CONSERVATORY: 'conservatory',
  BUS_DEPOT: 'busdepot',
  COURTHOUSE: 'courthouse',
  SHELTER: 'shelter',
  TRANSIT: 'transit',
  RECYCLING: 'recycling',
  COLLEGE: 'college',
  UNIVERSITY: 'university'
};

export const CIVIC_CAPACITY_KIND = Object.freeze({ ...rules.capacityKind });

/**
 * Facility-specific vertical limits. Civic capacity is not interchangeable:
 * a recycling centre, bus depot, or fire station is a low-rise service yard,
 * while a university or hospital can justify a taller institutional block.
 * These limits leave horizontal wings and additional facilities as the normal
 * way to scale a campus instead of turning every overloaded service into a
 * tower.
 */
export const CIVIC_VERTICAL_CAPS = Object.freeze({ ...rules.verticalCaps });

// Facility evolution is deliberately conservative: it only replaces a civic
// with a better authored variant that fits the same parcel area. Larger
// campuses still use a new BUILD_CIVIC order or WING so the land decision stays
// visible instead of silently swallowing neighbouring plots.
export const CIVIC_UPGRADE_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(rules.upgradePaths).map(([id, path]) => [id, Object.freeze({ ...path })])
));

export const CIVIC_CATALOGUE = catalog.catalogue;

/** Placement order: the plaza anchor first, then the supplied 1.9 facilities. */
export const CIVIC_ORDER = [
  CIVIC_FACILITY.TOWN_HALL,
  CIVIC_FACILITY.LIBRARY,
  CIVIC_FACILITY.SCHOOL,
  CIVIC_FACILITY.CLINIC,
  CIVIC_FACILITY.POLICE,
  CIVIC_FACILITY.FIRE,
  CIVIC_FACILITY.COMMUNITY,
  CIVIC_FACILITY.HOSPITAL,
  CIVIC_FACILITY.GOVERNMENT,
  CIVIC_FACILITY.POST_OFFICE,
  CIVIC_FACILITY.DAYCARE,
  CIVIC_FACILITY.MUSEUM,
  CIVIC_FACILITY.CONSERVATORY,
  CIVIC_FACILITY.BUS_DEPOT,
  CIVIC_FACILITY.COURTHOUSE,
  CIVIC_FACILITY.SHELTER,
  CIVIC_FACILITY.TRANSIT,
  CIVIC_FACILITY.RECYCLING,
  CIVIC_FACILITY.COLLEGE,
  CIVIC_FACILITY.UNIVERSITY
];

export function civicFacility(id) {
  return CIVIC_CATALOGUE[id] || CIVIC_CATALOGUE.townhall;
}

/** Return the authored storey ceiling for a civic record or facility id. */
export function civicVerticalCap(recordOrId) {
  const id = typeof recordOrId === 'string'
    ? recordOrId
    : recordOrId?.facility || recordOrId?.house?.spec?.facility;
  return CIVIC_VERTICAL_CAPS[id] || 4;
}

/**
 * Build the Building-Kit params for one facility. `r` is the cell rng so the
 * same seed always yields the same massing and finish.
 */
export function civicParams(id, r, options = {}) {
  const f = civicFacility(id);
  // Capacity is tied to the amount of usable civic floor area, not just the
  // number of storeys. A school or college that claims a larger horizontal
  // site must provide more rooms before it is allowed to advertise the same
  // service load. `baseFootprintArea` comes from the shared construction block
  // catalogue; an unscaled one-cell founding facility remains valid at 0.5x.
  const footprintArea = Math.max(1, Number(options.footprintArea || 1));
  const baseFootprintArea = Math.max(1, Number(options.baseFootprintArea || 1));
  const areaScale = Math.max(0.5, footprintArea / baseFootprintArea);
  const capacity = Math.max(1, Math.round(f.capacity * areaScale));
  return {
    rng: r,
    style: f.style,
    w: r.float(f.w[0], f.w[1]),
    d: r.float(f.d[0], f.d[1]),
    floors: f.floors,
    wall: jitterColor(f.wall, r, 0.05),
    trim: f.trim,
    roofColor: r.pick(f.roofColor),
    doorColor: f.doorColor,
    roofType: f.roofType,
    signBg: f.signBg,
    porch: !!f.porch,
    chimney: !!f.chimney,
    garage: !!f.garage,
    awningColor: f.awningColor,
    purpose: 'civic',
    facility: id,
    capacity,
    // Civic frontages are public by definition: every new facility gets the
    // shared accessible-entrance block, while catalogue rows may opt into the
    // balcony, solar roof, or planted roof through the same shell contract.
    accessible: f.accessible !== false,
    balcony: !!f.balcony,
    solar: !!f.solar,
    greenRoof: !!f.greenRoof,
    // Capacity per FLOOR — the invariant rebuildHouse keeps across floor
    // upgrades (houseKit scales capacity by floors from this), so a clinic's
    // patients/day grows when the council raises it a floor.
    capacityPerFloor: (f.capacity / f.floors) * areaScale
  };
}

export function civicSummary() {
  const out = [];
  for (const id of CIVIC_ORDER) {
    const f = civicFacility(id);
    out.push({
      id,
      label: f.label,
      floors: f.floors,
      capacity: f.capacity,
      unit: CIVIC_CAPACITY_KIND[id]
    });
  }
  return out;
}
