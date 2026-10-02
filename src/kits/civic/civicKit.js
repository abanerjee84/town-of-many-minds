import { jitterColor } from '../geometry.js';

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

export const CIVIC_CAPACITY_KIND = {
  townhall: 'visitors',
  library: 'visitors',
  school: 'students',
  clinic: 'patients/day',
  hospital: 'beds',
  police: 'officers',
  fire: 'firefighters',
  government: 'staff',
  community: 'visitors',
  postoffice: 'mail',
  daycare: 'children',
  museum: 'visitors',
  conservatory: 'pupils',
  busdepot: 'riders',
  courthouse: 'staff',
  shelter: 'beds',
  transit: 'riders',
  recycling: 'waste',
  college: 'tertiary',
  university: 'tertiary'
};

export const CIVIC_CATALOGUE = {
  townhall: {
    label: 'Town Hall',
    style: 'townhouse',
    floors: 2,
    w: [3.1, 3.5],
    d: [2.6, 3.0],
    roofType: 'gable',
    wall: 0xe8dcc4,
    trim: 0xf5f2ea,
    roofColor: [0x4a5560, 0x5d6b78, 0x3f4b57],
    doorColor: 0x37506b,
    signBg: '#24405c',
    porch: true,
    chimney: true,
    capacity: 90
  },
  library: {
    label: 'Public Library',
    style: 'townhouse',
    floors: 2,
    w: [3.0, 3.4],
    d: [2.6, 3.0],
    roofType: 'hip',
    wall: 0xdfd3bd,
    trim: 0xf3efe4,
    roofColor: [0x54606c, 0x46525e],
    doorColor: 0x3d5a4a,
    signBg: '#2b4a39',
    porch: true,
    chimney: false,
    capacity: 70
  },
  school: {
    label: 'School',
    style: 'townhouse',
    floors: 2,
    w: [3.2, 3.5],
    d: [2.7, 3.0],
    roofType: 'gable',
    wall: 0xf0d9a6,
    trim: 0x7a4a2f,
    roofColor: [0x9c4a34, 0x8a4030],
    doorColor: 0x2f5d46,
    signBg: '#7a4a1f',
    porch: false,
    chimney: true,
    capacity: 240
  },
  clinic: {
    label: 'Clinic',
    style: 'shop',
    floors: 1,
    w: [3.0, 3.4],
    d: [2.6, 3.0],
    roofType: 'flat',
    wall: 0xeef2ee,
    trim: 0xcfdad2,
    roofColor: [0x8f9aa1],
    doorColor: 0x2f6f7a,
    signBg: '#20565e',
    porch: false,
    chimney: false,
    awningColor: 0x2f6f7a,
    capacity: 45
  },
  hospital: {
    label: 'Hospital',
    style: 'shop',
    floors: 3,
    w: [3.2, 3.5],
    d: [2.7, 3.0],
    roofType: 'flat',
    wall: 0xf4f6f7,
    trim: 0xd3dade,
    roofColor: [0x7f8b94],
    doorColor: 0x24506b,
    signBg: '#7a2f2f',
    porch: false,
    chimney: false,
    awningColor: 0x24506b,
    capacity: 160
  },
  police: {
    label: 'Police Station',
    style: 'townhouse',
    floors: 2,
    w: [3.0, 3.4],
    d: [2.6, 2.9],
    roofType: 'hip',
    wall: 0xd7dde4,
    trim: 0xf2f4f6,
    roofColor: [0x3f4b57, 0x36414d],
    doorColor: 0x22303e,
    signBg: '#1f2c3a',
    porch: false,
    chimney: false,
    capacity: 40
  },
  fire: {
    label: 'Fire Station',
    style: 'shop',
    floors: 1,
    w: [3.3, 3.5],
    d: [2.6, 2.9],
    roofType: 'flat',
    wall: 0xc0503c,
    trim: 0xf1e6dc,
    roofColor: [0x6b3a30],
    doorColor: 0x2f2f33,
    signBg: '#6b2f2f',
    porch: false,
    chimney: false,
    garage: true,
    awningColor: 0x2f2f33,
    capacity: 24
  },
  government: {
    label: 'Government Office',
    style: 'townhouse',
    floors: 3,
    w: [3.1, 3.5],
    d: [2.7, 3.0],
    roofType: 'hip',
    wall: 0xd9d4c8,
    trim: 0xf0ede4,
    roofColor: [0x4a525c, 0x3f4750],
    doorColor: 0x33465c,
    signBg: '#2c3f55',
    porch: true,
    chimney: false,
    capacity: 120
  },
  community: {
    label: 'Community Centre',
    style: 'cottage',
    floors: 1,
    w: [3.2, 3.5],
    d: [2.7, 3.0],
    roofType: 'hip',
    wall: 0xe6d9b8,
    trim: 0x8a6f4a,
    roofColor: [0x7a5c3a, 0x6b5133],
    doorColor: 0x4a6b3f,
    signBg: '#3f5a2b',
    porch: true,
    chimney: true,
    awningColor: 0x4a6b3f,
    capacity: 110
  },
  postoffice: {
    label: 'Post Office',
    style: 'townhouse',
    floors: 1,
    w: [3.0, 3.4],
    d: [2.6, 3.0],
    roofType: 'hip',
    wall: 0xd9c9ae,
    trim: 0xf0ebe0,
    roofColor: [0x3f4b57, 0x54606c],
    doorColor: 0x2f4a6b,
    signBg: '#2f4a6b',
    porch: false,
    chimney: false,
    capacity: 60
  },
  daycare: {
    label: 'Daycare Centre',
    style: 'cottage',
    floors: 1,
    w: [3.1, 3.5],
    d: [2.7, 3.0],
    roofType: 'gable',
    wall: 0xf2e3c0,
    trim: 0xb8863c,
    roofColor: [0xc2703a, 0xa85f34],
    doorColor: 0x3f7a5a,
    signBg: '#3f7a5a',
    porch: true,
    chimney: true,
    awningColor: 0xb8863c,
    capacity: 30
  },
  museum: {
    label: 'Museum',
    style: 'townhouse',
    floors: 2,
    w: [3.2, 3.5],
    d: [2.7, 3.0],
    roofType: 'flat',
    wall: 0xe4ded2,
    trim: 0x8f8778,
    roofColor: [0x6b6b70],
    doorColor: 0x4a3f6b,
    signBg: '#3f3a6b',
    porch: false,
    chimney: false,
    capacity: 90
  },
  conservatory: {
    label: 'Conservatory',
    style: 'townhouse',
    floors: 2,
    w: [3.1, 3.4],
    d: [2.6, 3.0],
    roofType: 'hip',
    wall: 0xdde8dc,
    trim: 0x4a7a55,
    roofColor: [0x3f6b4a, 0x54805f],
    doorColor: 0x3f6b4a,
    signBg: '#2f5a3a',
    porch: false,
    chimney: false,
    awningColor: 0x4a7a55,
    capacity: 50
  },
  busdepot: {
    label: 'Bus Depot',
    style: 'shop',
    floors: 1,
    w: [3.3, 3.5],
    d: [2.7, 3.0],
    roofType: 'flat',
    wall: 0xcfc9bd,
    trim: 0x4a4f57,
    roofColor: [0x4a525c],
    doorColor: 0x2f3b47,
    signBg: '#2f4a3a',
    porch: false,
    chimney: false,
    garage: true,
    awningColor: 0x2f3b47,
    capacity: 40
  },
  courthouse: {
    label: 'Courthouse',
    style: 'townhouse',
    floors: 2,
    w: [3.2, 3.6],
    d: [2.7, 3.1],
    roofType: 'hip',
    wall: 0xd9d5cc,
    trim: 0xf4f1ea,
    roofColor: [0x59616a, 0x4a525c],
    doorColor: 0x34465a,
    signBg: '#35495d',
    porch: true,
    chimney: false,
    accessible: true,
    capacity: 70
  },
  shelter: {
    label: 'Emergency Shelter',
    style: 'cottage',
    floors: 2,
    w: [3.3, 3.7],
    d: [2.8, 3.2],
    roofType: 'gable',
    wall: 0xe8d8bd,
    trim: 0x7d6245,
    roofColor: [0x8b4f38, 0x754330],
    doorColor: 0x3d6249,
    signBg: '#3d6249',
    porch: true,
    chimney: true,
    accessible: true,
    greenRoof: true,
    capacity: 80
  },
  transit: {
    label: 'Transit Hub',
    style: 'shop',
    floors: 1,
    w: [3.4, 3.8],
    d: [2.8, 3.3],
    roofType: 'flat',
    wall: 0xcad6da,
    trim: 0x3f6672,
    roofColor: [0x4e6d77],
    doorColor: 0x2d5f6c,
    signBg: '#2d5f6c',
    porch: false,
    chimney: false,
    accessible: true,
    solar: true,
    capacity: 90
  },
  recycling: {
    label: 'Recycling Centre',
    style: 'shop',
    floors: 1,
    w: [3.4, 3.8],
    d: [2.9, 3.4],
    roofType: 'flat',
    wall: 0xbfd2c5,
    trim: 0x3e6850,
    roofColor: [0x4c765c],
    doorColor: 0x3d6b4b,
    signBg: '#3d6b4b',
    porch: false,
    chimney: false,
    accessible: true,
    solar: true,
    greenRoof: true,
    capacity: 55
  },
  college: {
    label: 'College',
    style: 'townhouse',
    floors: 3,
    w: [3.4, 3.9],
    d: [3.0, 3.5],
    roofType: 'flat',
    wall: 0xd7e0e8,
    trim: 0x4f6d88,
    roofColor: [0x4f6d88, 0x5d788f],
    doorColor: 0x2e5270,
    signBg: '#2e5270',
    porch: true,
    chimney: false,
    accessible: true,
    solar: true,
    capacity: 180
  },
  university: {
    label: 'University',
    style: 'townhouse',
    floors: 4,
    w: [3.8, 4.4],
    d: [3.4, 4.0],
    roofType: 'flat',
    wall: 0xcdd9e3,
    trim: 0x3b5973,
    roofColor: [0x3b5973, 0x4b647c],
    doorColor: 0x27465f,
    signBg: '#27465f',
    porch: true,
    chimney: false,
    accessible: true,
    greenRoof: true,
    capacity: 320
  }
};

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
