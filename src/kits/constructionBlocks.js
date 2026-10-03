/**
 * Shared construction vocabulary.
 *
 * The individual kits still own geometry and simulation rules. This catalogue
 * is the stable contract between those kits, the placement tools, the council
 * prompt, and future editors. A block is a buildable idea, not a promise that
 * every block occupies one grid cell: footprints and requirements make that
 * distinction explicit.
 */
import { getSettings } from '../core/settings.js';
import { basePrice, quotePrice } from '../simulation/priceChart.js';
import catalog from '../data/constructionCatalog.json' with { type: 'json' };

const BLOCKS = catalog.blocks;

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
  ...Object.fromEntries(Object.entries(catalog.familyBills).map(([family, row]) => [family, {
    cost: basePrice(row.priceKey, row.fallbackCost),
    materials: Object.freeze({ ...(row.materials || {}) }),
    labourHours: row.labourHours
  }]))
});

const MODULE_PREMIUM = Object.freeze({
  ...Object.fromEntries(Object.entries(catalog.modulePremium).map(([module, row]) => [module, {
    cost: basePrice(row.priceKey, row.fallbackCost),
    materials: Object.freeze({ ...(row.materials || {}) }),
    labourHours: row.labourHours
  }]))
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
  const familyPriceKey = {
    housing: 'house', commerce: 'shop', civic: 'civic', mobility: 'road',
    industry: 'factory', resource: 'utility', utility: 'utility', public: 'park'
  }[block.family] || 'house';
  const dynamicBase = quotePrice(`construction.${familyPriceKey}`, context.town, {
    fallback: base.cost,
    quantity: area
  });
  let cost = Math.round(dynamicBase * 0.85);
  let labourHours = Math.round(base.labourHours * Math.max(1, scale));
  let materials = mergeMaterials({}, base.materials, Math.max(1, scale));
  for (const module of block.modules || []) {
    const premium = MODULE_PREMIUM[module];
    if (!premium) continue;
    cost += quotePrice(`module.${module}`, context.town, { fallback: premium.cost });
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
  const evidence = town?.governance?.congestionEvidence?.();
  const averageCongestion = Number.isFinite(Number(evidence?.average))
    ? Number(evidence.average)
    : Number(mobility.congestion) || 0;
  const congestionGate = Number(getSettings().averageCongestionThreshold) || 0.5;
  const pop = town?.pedestrians?.citizens?.length || 0;
  const gate = {
    'road.complete': averageCongestion > congestionGate,
    'road.cycle': (mobility.trips || 0) > 40 || pop > 70,
    'road.transit': pop > 60,
    'road.arterial': averageCongestion > Math.max(congestionGate + 0.1, 0.6) || pop > 180,
    'road.roundabout': averageCongestion > congestionGate && ((mobility.junctions || mobility.junctionCount || mobility.crossings || 0) > 0 || pop > 120),
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
