export const CELL = 4;
import worldRules from '../data/worldRules.json' with { type: 'json' };

/**
 * The full extent the town can ever grow to, in cells. This is the whole
 * ground plane: there is no second, larger piece of scenery and no out-of-bounds
 * apron, so every tile the player can see is a tile they can build on.
 *
 * The town does NOT start here. `FOUNDING_CORE` is the small rectangle the
 * hamlet is laid out in, and growth walks the road network outward until it
 * reaches these edges. Nothing in the simulation gates growth to the founding
 * core — the road network is the only limit — so the only thing that decides
 * how big the town can ever get is these two numbers.
 */
// 10,000 tiles at four metres per tile: a 400m x 400m build plate. The
// founding core stays compact; this larger plate is the woodland frontier the
// council can acquire over a long run.
export const EXTENT = Object.freeze({ ...worldRules.extent });

/**
 * The founding core, in absolute cells, NOT a fraction of EXTENT. Sizing the
 * hamlet as a fraction meant it grew in lockstep with the map, which is exactly
 * backwards: a bigger map should mean more room to grow INTO, not a bigger
 * town on day one. Roughly 22x19 against a 100x100 extent, so the town is
 * founded on under 5% of the land and has to earn the rest.
 */
// The hamlet is deliberately compact inside a wider map. It gives the first
// 30 residents a readable neighbourhood while keeping a broad ring of land on
// every side for visible, paid expansion. The largest founding frame is 24x21,
// well below the 30x30 initial-town ceiling while leaving room for campuses.
export const FOUNDING_CORE = Object.freeze({ w: [...worldRules.foundingCore.w], h: [...worldRules.foundingCore.h] });

/**
 * Tallest building the town may be FOUNDED with. Two storeys.
 *
 * A hamlet of thirty people has no six-storey office block in it. The office
 * roll used to reach eight floors on day one and a founding town really did
 * contain a six-storey tower, which is both absurd for the population and
 * dishonest about what the town is: a landmark on the first day is not earned
 * later, it is simply handed over. Height is something growth and upzoning have
 * to buy, so the founding ceiling has to be low enough that a tower is an event.
 *
 * This is a founding constraint only. `MAX_FLOORS` still governs everything
 * built afterwards.
 */
export const FOUNDING_MAX_FLOORS = worldRules.foundingMaxFloors;

/** Hard ceiling on building height in storeys — every floor clamp reads this. */
export const MAX_FLOORS = worldRules.maxFloors;

export const CELL_KIND = {
  EMPTY: 0,
  ROAD: 1,
  LOT: 2,
  PARK: 3,
  WATER: 4,
  PLAZA: 5,
  PATH: 6
};

export const ZONE = {
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  CIVIC: 'civic',
  PARK: 'park',
  INDUSTRIAL: 'industrial'
};

export const PALETTE = {
  asphalt: 0x3a3f47,
  asphaltDark: 0x31353c,
  line: 0xe8e2c8,
  sidewalk: 0x9aa1a9,
  curb: 0x767d86,
  grass: 0x5c8f4a,
  grassDark: 0x4a7a3c,
  grassLight: 0x6fa357,
  dirt: 0x8a7355,
  path: 0xb9ad91,
  water: 0x3f7fa8,
  trunk: 0x6b4a33,
  foliage: [0x3f7d3a, 0x4f9146, 0x37703a, 0x569c4b, 0x2f6b34],
  lamp: 0xffd9a0,
  roof: [0xa8483c, 0x8c4a3a, 0x5d6b78, 0x4a5560, 0x7a5c48, 0x3f4b57, 0x94684a],
  wall: [0xe8dcc4, 0xd9c9a8, 0xcfd8dc, 0xe6c9b0, 0xd7d3c4, 0xc9d6c4, 0xf0e6d2, 0xdcc0b4],
  trim: [0xf5f2ea, 0x3f4b57, 0x8a5a3c, 0x2f3b47],
  door: [0x7a4a2c, 0x37506b, 0x6b2f2f, 0x3f5a3a, 0x4a4a52],
  glass: 0x9fc7e8,
  vehicle: [
    0xd94f4f, 0x4f7fd9, 0xededed, 0x3d4147, 0xe0a63a, 0x4fa86a,
    0x9b59b6, 0x2c8f9e, 0xd97f4f, 0x8a939c, 0xc0392b, 0x1f6f8b
  ],
  road: {
    concrete: 0x8f959d,
    concreteDark: 0x6d747c,
    concreteLight: 0xb4bac1,
    medianBed: 0x4f9146,
    medianDry: 0x8d9a6a,
    cycleLane: 0x2f8f7a,
    cycleGlyph: 0xe9f7f1,
    parkingBay: 0x41464e,
    bayLine: 0xe8e2c8,
    island: 0x4f9146,
    islandBed: 0x9aa1a9,
    signalPole: 0x2b2f36,
    signalRed: 0xff4433,
    signalAmber: 0xffb020,
    signalGreen: 0x35d97a,
    signPole: 0x8b9199,
    signPlate: 0xf2efe4,
    signBlue: 0x2f6fb5,
    signGreen: 0x2f7d4f,
    signRed: 0xc0392b,
    grate: 0x2a2d32,
    gutter: 0x33373d,
    shelterGlass: 0x9fc7e8,
    shelterFrame: 0x37506b,
    shelterRoof: 0x4a5560,
    deck: 0x7d838b,
    pier: 0x9aa1a9,
    tunnel: 0x9aa1a9,
    tunnelDark: 0x575d65,
    mound: 0x5c8f4a,
    moundDark: 0x4a7a3c,
    deadEnd: 0xe8e2c8
  },
  skin: [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa86a3f],
  shirt: [
    0xd94f4f, 0x4f7fd9, 0x53b46b, 0xe8b23a, 0x9b59b6, 0x2c8f9e,
    0xf0f0f0, 0x3d4147, 0xe07aa8, 0x7f8c8d, 0x16a085, 0xe67e22
  ],
  hair: [0x2b2118, 0x4a3524, 0x7a5230, 0xb5884a, 0x1a1a1a, 0x8f8f8f, 0xa8442a]
};

/**
 * Speed the clock starts at, and the speed a town reset returns to. Kept here
 * so the constructor and `Clock.reset` cannot drift apart — the Reset button
 * calls `reset()`, so a hardcoded literal here previously reintroduced 10x
 * behind the player's back.
 */
export const DEFAULT_SPEED = 100;

/** The selectable speeds, in button order. `DEFAULT_SPEED` must be a member. */
export const SPEEDS = [0, 1, 2, 4, 10, 20, 50, 100];

export const SIM = {
  secondsPerGameMinute: 0.9,
  startHour: 7.5,
  maxVehicles: 24,
  // Population ceiling exposed in Settings. The metropolis ladder starts at
  // 320, so the default must leave a real late-game runway instead of clipping
  // a town that has earned more beds and civic capacity.
  maxCitizens: 1000,
  walkSpeed: { min: 1.5, max: 2.6 },
  laneOffset: 0.8,
  // Outer half of the rendered pavement, with enough clearance from the
  // scaled service-vehicle bodies while remaining inside the road tile.
  walkOffset: 1.88,
  chatDistance: 2.6,
  roundaboutOffset: 1.85
};

export const HOUSEHOLD = {
  avgSize: 2.5,
  sizes: [
    { size: 1, weight: 14 },
    { size: 2, weight: 30 },
    { size: 3, weight: 28 },
    { size: 4, weight: 19 },
    { size: 5, weight: 9 }
  ]
};

/**
 * Founding rule — the initial town is built for exactly this many people:
 * housing beds, resource sizing (via planned beds) and founding provisions
 * all derive from this one number. No spare beds, no shortfall: later growth
 * must earn its headroom by building.
 */
export const FOUNDING_POPULATION = 30;

export const ROAD = {
  // Slim pavements, generous carriageway: the asphalt reads wide on the 4 m
  // tile while pedestrians (walkOffset 1.88) and poles still sit on paving.
  sidewalkW: 0.3,
  asphaltH: 0.12,
  walkH: 0.24,
  deckH: 1.3,
  medianHalf: 0.22,
  medianH: 0.16,
  edgeLine: 1.3,
  cycleInner: 0.96,
  cycleOuter: 1.34,
  parkingInner: 0.95,
  parkingOuter: 1.34,
  narrowSidewalk: 0.26,
  roundaboutR: 0.9,
  tunnelWallH: 2.6
};
