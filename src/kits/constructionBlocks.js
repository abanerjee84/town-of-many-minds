/**
 * Shared construction vocabulary.
 *
 * The individual kits still own geometry and simulation rules. This catalogue
 * is the stable contract between those kits, the placement tools, the council
 * prompt, and future editors. A block is a buildable idea, not a promise that
 * every block occupies one grid cell: footprints and requirements make that
 * distinction explicit.
 */
const BLOCKS = [
  // Housing and mixed-use shells.
  { id: 'house.core', kit: 'houses', family: 'housing', label: 'Family house', footprint: [1, 1], modules: ['entrance', 'unit', 'roof'] },
  { id: 'house.townhouse', kit: 'houses', family: 'housing', label: 'Townhouse', footprint: [1, 1], modules: ['entrance', 'corridor', 'unit', 'roof'] },
  { id: 'house.balcony', kit: 'houses', family: 'housing', label: 'Balcony house', footprint: [1, 1], modules: ['entrance', 'balcony', 'unit', 'roof'] },
  { id: 'house.accessible', kit: 'houses', family: 'housing', label: 'Accessible home', footprint: [1, 1], modules: ['entrance', 'ramp', 'unit', 'roof'] },
  { id: 'house.solar', kit: 'houses', family: 'housing', label: 'Solar home', footprint: [1, 1], modules: ['entrance', 'unit', 'solar-roof'] },
  { id: 'mixed.use', kit: 'houses', family: 'commerce', label: 'Mixed-use block', footprint: [2, 1], modules: ['storefront', 'lobby', 'unit', 'roof'] },
  { id: 'office.lobby', kit: 'houses', family: 'commerce', label: 'Office block', footprint: [1, 1], modules: ['lobby', 'fin', 'roofplant'] },

  // Civic buildings. Facility IDs are consumed by civicKit, so these remain
  // useful even when a future renderer replaces the shared house shell.
  { id: 'civic.townhall', kit: 'civic', family: 'civic', label: 'Town hall', facility: 'townhall', footprint: [1, 1], modules: ['entrance', 'lobby', 'unit', 'roof'] },
  // Campus-like civic facilities claim land as well as floors. The footprint
  // is the smallest credible site; a future WING can still add another strip
  // when the same parcel has room. Education is deliberately horizontal first:
  // classrooms, courtyards, labs, and accessible circulation need land.
  { id: 'civic.library', kit: 'civic', family: 'civic', label: 'Library', facility: 'library', footprint: [2, 1], modules: ['entrance', 'porch', 'unit', 'roof'] },
  { id: 'civic.school', kit: 'civic', family: 'civic', label: 'School', facility: 'school', footprint: [2, 2], modules: ['entrance', 'unit', 'porch', 'playground', 'roof'] },
  { id: 'civic.college', kit: 'civic', family: 'civic', label: 'College', facility: 'college', footprint: [3, 2], modules: ['entrance', 'ramp', 'lecture-hall', 'lab', 'courtyard', 'solar-roof'] },
  { id: 'civic.university', kit: 'civic', family: 'civic', label: 'University', facility: 'university', footprint: [4, 2], modules: ['entrance', 'ramp', 'lecture-hall', 'library', 'lab', 'courtyard', 'green-roof'] },
  { id: 'civic.clinic', kit: 'civic', family: 'civic', label: 'Clinic', facility: 'clinic', footprint: [1, 1], modules: ['entrance', 'ramp', 'storefront', 'roof'] },
  { id: 'civic.hospital', kit: 'civic', family: 'civic', label: 'Hospital', facility: 'hospital', footprint: [3, 2], modules: ['entrance', 'ramp', 'lobby', 'ward', 'roof'] },
  { id: 'civic.police', kit: 'civic', family: 'civic', label: 'Police station', facility: 'police', footprint: [1, 1], modules: ['entrance', 'garage', 'unit', 'roof'] },
  { id: 'civic.fire', kit: 'civic', family: 'civic', label: 'Fire station', facility: 'fire', footprint: [1, 1], modules: ['entrance', 'garage', 'loading-bay', 'roof'] },
  { id: 'civic.government', kit: 'civic', family: 'civic', label: 'Government office', facility: 'government', footprint: [2, 1], modules: ['entrance', 'lobby', 'unit', 'roof'] },
  { id: 'civic.community', kit: 'civic', family: 'civic', label: 'Community centre', facility: 'community', footprint: [2, 1], modules: ['entrance', 'porch', 'unit', 'roof'] },
  { id: 'civic.postoffice', kit: 'civic', family: 'civic', label: 'Post office', facility: 'postoffice', footprint: [1, 1], modules: ['entrance', 'storefront', 'unit', 'roof'] },
  { id: 'civic.daycare', kit: 'civic', family: 'civic', label: 'Daycare centre', facility: 'daycare', footprint: [2, 1], modules: ['entrance', 'porch', 'unit', 'playground', 'roof'] },
  { id: 'civic.museum', kit: 'civic', family: 'civic', label: 'Museum', facility: 'museum', footprint: [2, 1], modules: ['entrance', 'lobby', 'unit', 'gallery', 'roof'] },
  { id: 'civic.conservatory', kit: 'civic', family: 'civic', label: 'Conservatory', facility: 'conservatory', footprint: [2, 2], modules: ['entrance', 'storefront', 'unit', 'greenhouse', 'roof'] },
  { id: 'civic.busdepot', kit: 'civic', family: 'mobility', label: 'Bus depot', facility: 'busdepot', footprint: [2, 1], modules: ['entrance', 'garage', 'loading-bay', 'roof'] },
  { id: 'civic.courthouse', kit: 'civic', family: 'civic', label: 'Courthouse', facility: 'courthouse', footprint: [2, 1], modules: ['entrance', 'ramp', 'lobby', 'courtroom', 'roof'] },
  { id: 'civic.shelter', kit: 'civic', family: 'civic', label: 'Emergency shelter', facility: 'shelter', footprint: [1, 1], modules: ['entrance', 'ramp', 'unit', 'green-roof'] },
  { id: 'civic.transit', kit: 'civic', family: 'mobility', label: 'Transit hub', facility: 'transit', footprint: [2, 1], modules: ['entrance', 'ramp', 'lobby', 'solar-roof'] },
  { id: 'civic.recycling', kit: 'civic', family: 'utility', label: 'Recycling centre', facility: 'recycling', footprint: [2, 1], modules: ['entrance', 'ramp', 'loading-bay', 'sorting-line', 'solar-roof'] },

  // Employment and resource production.
  { id: 'industry.factory', kit: 'houses', family: 'industry', label: 'Factory shell', footprint: [3, 3], modules: ['loading-bay', 'service-yard', 'roof'] },
  { id: 'industry.sawmill', kit: 'houses', family: 'industry', label: 'Sawmill', footprint: [3, 3], modules: ['timber-yard', 'sawtooth-roof', 'dust-collector'] },
  { id: 'industry.steelworks', kit: 'houses', family: 'industry', label: 'Steelworks', footprint: [4, 4], modules: ['cooling-tower', 'blast-furnace', 'ore-yard', 'stack'] },
  { id: 'industry.cement', kit: 'houses', family: 'industry', label: 'Cement works', footprint: [4, 3], modules: ['kiln-tower', 'silo-bank', 'conveyor', 'stack'] },
  { id: 'industry.goods', kit: 'houses', family: 'industry', label: 'Goods plant', footprint: [3, 3], modules: ['assembly-hall', 'loading-dock', 'office-block'] },
  { id: 'industry.textile', kit: 'houses', family: 'industry', label: 'Textile mill', footprint: [4, 3], modules: ['sawtooth-roof', 'dye-tanks', 'delivery-bay'] },
  { id: 'industry.software', kit: 'houses', family: 'industry', label: 'Software house', footprint: [3, 3], modules: ['office-tower', 'data-hall', 'cooling-units'] },
  { id: 'industry.furniture', kit: 'houses', family: 'industry', label: 'Furniture workshop', footprint: [3, 3], modules: ['showroom', 'timber-yard', 'loading-dock'] },
  { id: 'industry.estate', kit: 'resources', family: 'industry', label: 'Industrial estate', footprint: [2, 2], modules: ['loading-bay', 'service-yard'] },
  { id: 'resource.lake', kit: 'resources', family: 'resource', label: 'Lake catchment', footprint: [2, 2], modules: ['water', 'shoreline', 'pump-house'] },
  { id: 'resource.farm', kit: 'resources', family: 'resource', label: 'Farm yard', footprint: [7, 4], modules: ['barn', 'field', 'service-yard'] },
  { id: 'resource.greenhouse', kit: 'resources', family: 'resource', label: 'Greenhouse extension', footprint: [1, 1], modules: ['glasshouse', 'irrigation', 'battery'] },
  { id: 'resource.livestock', kit: 'resources', family: 'resource', label: 'Livestock yard', footprint: [7, 4], modules: ['barn', 'paddock', 'silo'] },
  { id: 'resource.poultry', kit: 'resources', family: 'resource', label: 'Poultry yard', footprint: [7, 4], modules: ['coop', 'feed-store', 'silo'] },
  { id: 'resource.solar', kit: 'resources', family: 'resource', label: 'Solar field', footprint: [2, 2], modules: ['panel-array', 'inverter', 'battery'] },
  { id: 'resource.wind', kit: 'resources', family: 'resource', label: 'Wind farm', footprint: [2, 2], modules: ['turbine', 'service-yard'] },
  { id: 'resource.silo', kit: 'resources', family: 'resource', label: 'Grain silo', footprint: [2, 2], modules: ['silo', 'loading-bay'] },
  { id: 'resource.reservoir', kit: 'resources', family: 'resource', label: 'Reservoir', footprint: [2, 1], modules: ['basin', 'pump-house'] },
  { id: 'resource.gas', kit: 'resources', family: 'resource', label: 'Fuel station', footprint: [2, 2], modules: ['pump', 'canopy', 'tank'], planningClass: 'civic', publicFacing: true },

  // Utility and transport infrastructure.
  { id: 'utility.substation', kit: 'utilities', family: 'utility', label: 'Power substation', footprint: [1, 1], modules: ['transformer', 'switchgear', 'battery'] },
  { id: 'utility.water', kit: 'utilities', family: 'utility', label: 'Water tower', footprint: [1, 1], modules: ['tank', 'pump-house'] },
  { id: 'utility.sewage', kit: 'utilities', family: 'utility', label: 'Sewage plant', footprint: [1, 1], modules: ['clarifier', 'digestor', 'pump-house'] },
  { id: 'utility.battery', kit: 'utilities', family: 'utility', label: 'Battery storage', footprint: [1, 1], modules: ['battery', 'inverter'] },
  { id: 'road.complete', kit: 'roads', family: 'mobility', label: 'Complete street', footprint: [1, 1], modules: ['sidewalk', 'lane', 'drainage', 'street-light'] },
  { id: 'road.cycle', kit: 'roads', family: 'mobility', label: 'Cycle corridor', footprint: [1, 1], modules: ['cycle-lane', 'crosswalk', 'parking-lane'] },
  { id: 'road.transit', kit: 'roads', family: 'mobility', label: 'Transit stop', footprint: [1, 1], modules: ['bus-stop', 'shelter', 'crosswalk'] },
  { id: 'road.bridge', kit: 'roads', family: 'mobility', label: 'Bridge crossing', footprint: [1, 1], modules: ['bridge', 'ramp', 'drainage'] },

  // Public realm and neighbourhood furniture.
  { id: 'public.path', kit: 'publicspace', family: 'public', label: 'Pedestrian path', footprint: [1, 1], modules: ['path', 'lamp', 'bench'] },
  { id: 'public.sports', kit: 'publicspace', family: 'public', label: 'Sports pitch', footprint: [2, 2], modules: ['pitch', 'goal', 'lamp'] },
  { id: 'public.garden', kit: 'publicspace', family: 'public', label: 'Community garden', footprint: [2, 2], modules: ['planter', 'bench', 'tree'] },
  { id: 'public.playground', kit: 'publicspace', family: 'public', label: 'Playground', footprint: [2, 2], modules: ['play-structure', 'swing', 'soft-ground'] },
  { id: 'public.plaza', kit: 'publicspace', family: 'public', label: 'Civic plaza', footprint: [2, 2], modules: ['fountain', 'bench', 'lamp'] },
  { id: 'prop.tree', kit: 'props', family: 'public', label: 'Street tree', footprint: [1, 1], modules: ['tree'] },
  { id: 'prop.foliage', kit: 'props', family: 'public', label: 'Foliage cluster', footprint: [1, 1], modules: ['tree', 'pine', 'shrub', 'understory'] },
  { id: 'prop.lamp', kit: 'props', family: 'mobility', label: 'Lamp post', footprint: [1, 1], modules: ['lamp', 'glow'] },
  { id: 'prop.bench', kit: 'props', family: 'public', label: 'Bench', footprint: [1, 1], modules: ['bench'] },
  { id: 'prop.fountain', kit: 'props', family: 'public', label: 'Fountain', footprint: [1, 1], modules: ['fountain', 'water'] },
  { id: 'prop.mobility', kit: 'props', family: 'mobility', label: 'Bike and charging bay', footprint: [1, 1], modules: ['bike-rack', 'ev-charger', 'planter'] }
];

export const CONSTRUCTION_BLOCKS = Object.freeze(BLOCKS.map((block) => Object.freeze({
  ...block,
  footprint: Object.freeze(block.footprint.slice()),
  modules: Object.freeze((block.modules || []).slice())
})));

/**
 * A small, deterministic bill of quantities for the shared blocks. Geometry
 * remains kit-owned, but the council and the player need the same estimate
 * before a project is commissioned. Values are deliberately expressed in the
 * existing industry materials and game hours, so a quote can be compared with
 * a project's treasury reserve without inventing a second economy.
 */
const FAMILY_BILLS = Object.freeze({
  housing: { cost: 9000, materials: { lumber: 18, cement: 14, steel: 4 }, labourHours: 16 },
  commerce: { cost: 12000, materials: { lumber: 22, cement: 18, steel: 7 }, labourHours: 20 },
  civic: { cost: 30000, materials: { lumber: 32, cement: 28, steel: 12 }, labourHours: 32 },
  mobility: { cost: 18000, materials: { lumber: 20, cement: 24, steel: 14 }, labourHours: 26 },
  industry: { cost: 26000, materials: { lumber: 24, cement: 26, steel: 16 }, labourHours: 36 },
  resource: { cost: 30000, materials: { lumber: 20, cement: 24, steel: 18 }, labourHours: 40 },
  utility: { cost: 18000, materials: { lumber: 12, cement: 22, steel: 20 }, labourHours: 28 },
  public: { cost: 3000, materials: { lumber: 8, cement: 8, steel: 2 }, labourHours: 8 }
});

const MODULE_PREMIUM = Object.freeze({
  ramp: { cost: 450, materials: { cement: 2, steel: 1 }, labourHours: 1 },
  balcony: { cost: 650, materials: { cement: 1, steel: 3 }, labourHours: 2 },
  'solar-roof': { cost: 1800, materials: { steel: 4, cement: 1 }, labourHours: 3 },
  'green-roof': { cost: 1100, materials: { lumber: 2, cement: 2 }, labourHours: 3 },
  battery: { cost: 2200, materials: { steel: 5, cement: 2 }, labourHours: 3 },
  'ev-charger': { cost: 900, materials: { steel: 2 }, labourHours: 1 },
  'play-structure': { cost: 700, materials: { lumber: 3, steel: 2 }, labourHours: 2 }
});

const mergeMaterials = (a, b, scale = 1) => {
  const out = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) out[key] = (out[key] || 0) + Math.ceil(value * scale);
  return out;
};

/** Quote one block at a footprint size. The result is immutable and safe to
 * copy into a project/decision record; later catalogue edits cannot mutate an
 * already-started build. */
export function constructionBlockQuote(id, context = {}) {
  const block = constructionBlock(id);
  if (!block) return null;
  const area = Math.max(1, Number(context.area || block.footprint[0] * block.footprint[1]));
  const base = FAMILY_BILLS[block.family] || FAMILY_BILLS.housing;
  const scale = Math.max(1, area / Math.max(1, block.footprint[0] * block.footprint[1]));
  let cost = Math.round(base.cost * area * 0.85);
  let labourHours = Math.round(base.labourHours * Math.max(1, scale));
  let materials = mergeMaterials({}, base.materials, Math.max(1, scale));
  for (const module of block.modules || []) {
    const premium = MODULE_PREMIUM[module];
    if (!premium) continue;
    cost += premium.cost;
    labourHours += premium.labourHours;
    materials = mergeMaterials(materials, premium.materials);
  }
  return Object.freeze({
    blockId: block.id,
    area,
    cost,
    materials: Object.freeze(materials),
    labourHours,
    modules: block.modules
  });
}

/** Measured demand gates for road/public furniture. A palette row can be
 * visible before its gate and explain why it is waiting, so the council does
 * not pave amenities on a hunch. */
export function constructionBlockDemand(id, town) {
  const mobility = town?.traffic?.mobilityStats?.() || {};
  const pop = town?.pedestrians?.citizens?.length || 0;
  const gate = {
    'road.complete': mobility.congestion > 0.34,
    'road.cycle': (mobility.trips || 0) > 40 || pop > 70,
    'road.transit': pop > 60,
    'prop.mobility': (mobility.parkingPressure || 0) > 1 || pop > 80
  };
  return Object.prototype.hasOwnProperty.call(gate, id) ? !!gate[id] : true;
}

const BY_ID = new Map(CONSTRUCTION_BLOCKS.map((block) => [block.id, block]));

export function constructionBlock(id) {
  return BY_ID.get(String(id || '').toLowerCase()) || null;
}

export function listConstructionBlocks(filter = {}) {
  return CONSTRUCTION_BLOCKS.filter((block) =>
    (!filter.kit || block.kit === filter.kit) &&
    (!filter.family || block.family === filter.family) &&
    (!filter.facility || block.facility === filter.facility)
  );
}

export function constructionBlockStats() {
  const kits = {};
  const families = {};
  for (const block of CONSTRUCTION_BLOCKS) {
    kits[block.kit] = (kits[block.kit] || 0) + 1;
    families[block.family] = (families[block.family] || 0) + 1;
  }
  return { total: CONSTRUCTION_BLOCKS.length, kits, families };
}

export function auditConstructionBlocks() {
  const ids = new Set();
  const errors = [];
  for (const block of CONSTRUCTION_BLOCKS) {
    if (ids.has(block.id)) errors.push(`duplicate id ${block.id}`);
    ids.add(block.id);
    if (!block.kit || !block.family || !block.label) errors.push(`incomplete block ${block.id}`);
    if (!Array.isArray(block.footprint) || block.footprint.some((n) => !Number.isInteger(n) || n < 1)) {
      errors.push(`invalid footprint ${block.id}`);
    }
    if (!block.modules?.length) errors.push(`block has no modules ${block.id}`);
    if (!FAMILY_BILLS[block.family]) errors.push(`block has no bill family ${block.id}`);
    if (!constructionBlockQuote(block.id)) errors.push(`block cannot be quoted ${block.id}`);
  }
  return { ok: errors.length === 0, errors, ...constructionBlockStats() };
}
