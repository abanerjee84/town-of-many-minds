import { events } from '../core/events.js';
import { commodityPrice, priceChart } from './priceChart.js';
import catalog from '../data/industryCatalog.json' with { type: 'json' };
import demandRules from '../data/industryDemand.json' with { type: 'json' };
import buildTimeChart from '../data/buildtime.json' with { type: 'json' };
import { assessIndustrialDemand } from './industryDemand.js';
import { CELL_KIND, CELL, SIM } from '../core/config.js';

/**
 * Phase 6 — industry & trade. Factories produce the materials construction
 * consumes (lumber, steel, cement) plus consumer goods; a stockpile gates
 * every gated build, exports add treasury income, and citizens' goods access
 * feeds their mood. Deterministic: production jitter comes from one forked
 * stream, so seeded runs replay exactly. A factory's rate is capacity-normalized:
 * a standard three-by-three two-storey works is the reference, and footprint
 * times floors scale its output, input draw, capital requirement, and revenue.
 */

/** Material cost per construction type — consumed on start, refunded on stall. */
export const MATERIALS = Object.freeze(catalog.materials);

/**
 * Candidate LOT SIZES for a works, as [cols, rows] — the same rich/array
 * shape landmarks and archetypes use, so `siteForFootprint` picks a size on
 * site quality, budget headroom and need rather than a hardcoded dimension.
 *
 * A works used to be 1x1 with no candidate list at all, which put a single
 * cell-sized shed in the middle of a 4x4 parcel next to a shop: the one kind
 * of building that genuinely needs land, and the one that got the least. The
 * order is small-to-large so the chooser's need-fit term can climb it, and the
 * 3x3 is the floor — below that a factory reads as a kiosk rather than a
 * works campus.
 */
export const FACTORY_SIZES = Object.freeze(catalog.factorySizes.map((size) => Object.freeze(size.slice())));

/**
 * The factory kinds; one product each, all consuming town energy. `floors`
 * and `modules` are part of the stable visual/inspection contract: production
 * is still selected by product, while the kit can give each industry a
 * recognisable silhouette instead of rendering seven copies of one shed.
 */
export const FACTORY_TYPES = Object.freeze(catalog.factoryTypes.map((factory) => Object.freeze({
  ...factory,
  modules: Object.freeze((factory.modules || []).slice())
})));

export const COMMODITIES = Object.freeze(catalog.commodities.slice());

// Crude oil is a tradable raw input, not a locally manufactured product. It
// remains in the same contractor inventory and economy stats as every other
// commodity, but it is excluded from factory-balancing and export surplus
// loops so a refinery does not compete with itself for a phantom producer.
const RAW_INPUTS = new Set(['crude_oil']);

const BASE_PRICE = Object.freeze(Object.fromEntries(
  Object.entries(priceChart().commodity || {}).map(([key, row]) => [key, Number(row.base) || 1])
));
const IMPORT_MULT = catalog.importMultiplier;
const EXPORT_MULT = catalog.exportMultiplier;

function priceFor(town, key, side = 'local') {
  return commodityPrice(town, key, side) || BASE_PRICE[key] || 1;
}
const CAPACITY = catalog.capacity;
const INITIAL = catalog.initial;
/** Units produced per reference-capacity factory per game day. */
const RATE = catalog.rate;
// HouseKit's factory capacity is an area/floor measure. A normal 3x3 campus
// with two floors is roughly 400 capacity units; larger works must earn a
// proportionally larger rated output instead of sharing one flat rate.
const FACTORY_REFERENCE_CAPACITY = catalog.referenceCapacity;
// A staffed works can keep a small line alive while it recruits the rest of
// its posts. This models an owner/operator crew and basic automation; an empty
// works still produces nothing, and a fully staffed works still reaches 100%.
const FACTORY_MIN_STAFFED_UTILIZATION = catalog.minStaffedUtilization;
export const FACTORY_INPUTS = Object.freeze(catalog.inputs);
const INPUTS = FACTORY_INPUTS;
const LABEL = catalog.labels;
/** Construction materials — what a plan's bill is denominated in. */
export const MATERIAL_KEYS = ['lumber', 'steel', 'cement'];
/** Storehouse fill below this ratio counts as strained (commission signal). */
const STRAIN_GATE = catalog.strainGate;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export class IndustrySystem {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(3701);
    this.reset();
  }

  reset() {
    this.stocks = { ...INITIAL };
    if (this.town.economy?.accounts?.contractor) this.town.economy.accounts.contractor.inventory = this.stocks;
    this.exported = 0;
    this.imported = 0;
    this.lastDay = -1;
    this.day = 1;
    this.history = [];
    // Phase 17 — written only by the innovation ladder's `output` lever.
    this.outputBonus = 0;
    this.demandHistory = [];
    this.pressureSince = {};
    this.lastConsumption = { requested: 0, fulfilled: 0, spent: 0 };
  }

  /** Trade log line: shown in the event log and kept for the Trade modal. */
  note(text) {
    this.history.push({ day: this.day, text });
    if (this.history.length > 60) this.history.shift();
    events.emit('log', { text });
  }

  /** Placed factories, newest last. */
  factories() {
    return this.town.buildings.filter((b) => b.purpose === 'industrial');
  }

  /**
   * The factory type for a building, or null when there is no building. The
   * null case matters: a closed firm's `building` is nulled (economy.js), and
   * the old `|| FACTORY_TYPES[0]` fallback read every such ghost as a sawmill
   * — a demolished lumber mill with goods in its inventory counted as the
   * town's goods producer. A LIVE building without a recorded type still falls
   * back to sawmill (createBuilding always writes factoryType, so that is a
   * legacy record, not a ghost).
   */
  typeOf(building) {
    if (!building) return null;
    const id = building?.house?.spec?.factoryType;
    return FACTORY_TYPES.find((t) => t.id === id) || FACTORY_TYPES[0];
  }

  /** Citizen goods demand per game day: population plus the shops they fill. */
  goodsDemand() {
    const pop = this.town.pedestrians?.citizens?.length || 0;
    const shops = this.town.buildings.filter((b) => b.purpose === 'commercial').length;
    return Math.round(pop * 0.45 + shops * 1.5);
  }

  /** 0..1 — how close goods are to running out (1 = same day empty). */
  goodsStress() {
    const demand = this.goodsDemand();
    if (demand <= 0) return 0;
    return clamp01(1 - this.stocks.goods / demand);
  }

  /** Commercial revenue multiplier: shortages shrink the shops' takings. */
  goodsFactor() {
    return Math.round((1 - 0.55 * this.goodsStress()) * 100) / 100;
  }

  canAfford(mats) {
    return Object.entries(mats).every(([k, v]) => this.totalStock(k) >= v);
  }

  totalStock(key) {
    const firms = this.town.economy?.businesses?.filter((b) => b.type === 'industry') || [];
    return (this.stocks[key] || 0) + firms.reduce((sum, firm) => sum + (firm.inventory[key] || 0), 0);
  }

  /** Human-readable shortage for a plan's material bill, or '' when covered. */
  shortfall(mats) {
    return Object.entries(mats)
      .filter(([k, v]) => (this.stocks[k] || 0) < v)
      .map(([k, v]) => `${LABEL[k] || k} −${Math.ceil(v - this.stocks[k])}`)
      .join(', ');
  }

  /**
   * Draw materials: out of the town storehouse first, then out of the firms'
   * own holdings.
   *
   * ATOMIC. It used to debit key by key and `return false` the moment one came
   * up short, leaving everything already debited gone with no rollback — a
   * partial draw that simply evaporated. Verified: `take({cement: 5,
   * lumber: 5000})` with no lumber returned `false` having already taken the
   * 5 cement. `canAfford` runs immediately before every current caller, so the
   * branch is unreachable today, which is exactly why it is dangerous: one new
   * caller without that gate and materials start disappearing.
   *
   * The whole request is now checked first, and only then applied, so the
   * operation either happens or does not.
   */
  take(mats) {
    const firms = this.town.economy?.businesses?.filter((b) => b.type === 'industry') || [];
    // Pass 1 — can the whole request be met?
    const plan = [];
    const owed = { ...mats };
    for (const k of Object.keys(mats)) {
      let remaining = Number(mats[k]) || 0;
      if (remaining <= 0) continue;
      const fromStock = Math.min(remaining, this.stocks[k] || 0);
      remaining -= fromStock;
      const fromFirms = [];
      if (remaining > 1e-6) {
        for (const firm of firms) {
          if (remaining <= 1e-6) break;
          const used = Math.min(remaining, firm.inventory[k] || 0);
          if (used <= 0) continue;
          fromFirms.push({ firm, used });
          remaining -= used;
        }
      }
      if (remaining > 1e-6) return false;          // nothing has been touched yet
      plan.push({ k, fromStock, fromFirms });
    }
    // Pass 2 — apply it.
    for (const { k, fromStock, fromFirms } of plan) {
      this.stocks[k] -= fromStock;
      for (const { firm, used } of fromFirms) {
        firm.inventory[k] = (firm.inventory[k] || 0) - used;
        this.town.economy?._adjustExpectedInventory(firm.id, k, -used);
      }
    }
    this.recordDemandFlow('construction', mats);
    return true;
  }

  /**
   * Return materials.
   *
   * Goes back to the town storehouse. Material drawn from a FIRM's own holdings
   * is refunded to the storehouse rather than to that firm, which moves stock
   * out of a private firm's books and into the town's — a mis-credit that only
   * bit once a second caller appeared, but is wrong on its face.
   */
  refund(mats) {
    this.recordDemandFlow('construction', Object.fromEntries(Object.entries(mats).map(([key, qty]) => [key, -qty])));
    for (const [k, v] of Object.entries(mats)) {
      this.stocks[k] = Math.min(CAPACITY[k] || Infinity, (this.stocks[k] || 0) + v);
    }
  }

  /**
   * The weakest construction material (under STRAIN_GATE of its storehouse) —
   * what a commissioning factory should produce, or null when materials are
   * healthy. commissionProduct() superseded this for live commissioning (it
   * weighs ALL commodities and balances works counts); this stays as the
   * materials-only read for callers that specifically need the construction
   * bottleneck rather than the whole-storehouse picture.
   */
  deficitProduct() {
    let worst = null;
    let worstRatio = STRAIN_GATE;
    for (const key of MATERIAL_KEYS) {
      const ratio = this.stocks[key] / CAPACITY[key];
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = key;
      }
    }
    return worst;
  }

  /**
   * Missing rung in the starter construction-material ring. A material with
   * an existing local producer is allowed to run low; commissioning a second
   * identical works would spend scarce land and crews without closing the
   * steel/cement/lumber gap.
   */
  missingConstructionProduct() {
    const local = new Set(this.factories().map((building) => this.typeOf(building)?.product).filter(Boolean));
    // Do not let catalogue order decide which missing works is commissioned.
    // A zero-cement store must beat a merely low lumber store even though
    // lumber is the first row in MATERIAL_KEYS.  Use total stock so material
    // already held by an operating works is not mistaken for a town shortage.
    return MATERIAL_KEYS
      .map((key) => ({ key, ratio: this.fillRatio(key), stock: this.totalStock(key) }))
      .filter((row) => !local.has(row.key) && row.ratio < STRAIN_GATE)
      .sort((a, b) => a.ratio - b.ratio || a.stock - b.stock || MATERIAL_KEYS.indexOf(a.key) - MATERIAL_KEYS.indexOf(b.key))[0]?.key || null;
  }
  /** 0..1 storehouse fill for one commodity (1 = full). */
  fillRatio(key) {
    return this.totalStock(key) / (CAPACITY[key] || 1);
  }

  /**
   * Phase 12 — the weakest commodity across EVERY row (not just construction
   * materials): fill below STRAIN_GATE counts as strained; ties break to the
   * most understocked (lower absolute stock). null when nothing is strained.
   */
  strainedProduct() {
    // One filter and one argmin, so "under the gate" is structural rather than
    // argued. The old loop seeded `worstRatio` AT the gate and only ever lowered
    // it, assigned `worst` only inside a branch already requiring
    // `ratio < STRAIN_GATE`, and then re-tested `fillRatio(worst) >= STRAIN_GATE`
    // — an unsatisfiable predicate (verified: 0 hits across 4,000 random stock
    // states). The tie clause was dead twice over, because `worst` is null on the
    // first iteration and so a tie could only ever break among already-sub-gate
    // candidates.
    let worst = null;
    let worstRatio = Infinity;
    let worstStock = Infinity;
    for (const key of COMMODITIES) {
      if (RAW_INPUTS.has(key)) continue;
      const ratio = this.fillRatio(key);
      if (ratio >= STRAIN_GATE) continue;
      const stock = this.stocks[key] || 0;
      if (ratio < worstRatio - 1e-9 || (Math.abs(ratio - worstRatio) < 1e-9 && stock < worstStock)) {
        worstRatio = ratio;
        worstStock = stock;
        worst = key;
      }
    }
    return worst;
  }

  /** Record settled material draws and sales; proposals are not customer orders. */
  recordDemandFlow(source, quantities) {
    let row = this.demandHistory.find((entry) => entry.day === this.day && entry.source === source);
    if (!row) { row = { day: this.day, source, quantities: {} }; this.demandHistory.push(row); }
    for (const [key, value] of Object.entries(quantities)) row.quantities[key] = (row.quantities[key] || 0) + (Number(value) || 0);
    this.demandHistory = this.demandHistory.filter((entry) => entry.day > this.day - demandRules.historyDays);
  }

  /** Concrete daily requests, bounded by the buyer's wallet. Retail goods use the existing shopping path. */
  consumptionOrders({ forecast = false } = {}) {
    const economy = this.town.economy;
    if (!economy) return [];
    const orders = [];
    const prices = Object.fromEntries(COMMODITIES.map((key) => [key, priceFor(this.town, key)]));
    const government = { sector: 'government', id: 'government' };
    const reserve = economy.requiredPublicReserve?.(0) || 0;
    const publicBudget = Math.max(0, (economy._account(government)?.balance || 0) - reserve);
    const add = (buyer, profile, units, source, impact = source, budget = Infinity) => {
      const balance = economy._account(buyer)?.balance || 0;
      const available = Math.max(0, Math.min(balance, budget, buyer?.sector === 'government' ? publicBudget : Infinity));
      const rows = Object.entries(profile || {}).map(([product, rate]) => ({ product, quantity: Math.max(0, rate * units) }));
      const cost = rows.reduce((sum, row) => sum + row.quantity * prices[row.product], 0);
      const factor = cost > 0 ? Math.min(1, available / cost) : 0;
      const publicNeed = forecast && buyer?.sector === 'government';
      for (const row of rows) if (row.quantity * factor > 0 || (publicNeed && row.quantity > 0)) orders.push({ ...row,
        quantity: row.quantity * (publicNeed ? 1 : factor), affordableQuantity: row.quantity * factor,
        buyer, source, impact: demandRules.sourceImpact[impact] || 0 });
    };
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = citizen.p;
      if (!p || p.age < 16) continue;
      const budget = Math.max(demandRules.minimumHouseholdBudget, Math.max(0, p.disposableIncome || 0) * demandRules.householdBudgetShare);
      add({ sector: 'household', id: p.id }, demandRules.household, 1, 'households', 'households', budget);
    }
    for (const firm of economy.businesses || []) {
      if (!firm.open || !firm.building || firm.id === 'contractor' || firm.building.purpose === 'civic') continue;
      const buyer = firm.operatorSector === 'government' ? government : { sector: 'business', id: firm.id };
      const profile = demandRules.business[firm.type === 'industry' ? 'industry' : firm.type === 'office' ? 'office' : firm.type === 'lodging' ? 'lodging' : 'retail'];
      add(buyer, profile, Math.max(1, firm.building.floors || 1), 'business');
    }
    for (const building of this.town.buildings || []) {
      if (building.purpose === 'civic') {
        const facility = building.facility || building.kind;
        const impact = ['clinic', 'hospital'].includes(facility) ? 'health' : ['school', 'college', 'university'].includes(facility) ? 'education' : 'maintenance';
        add(economy.ownerAccount(building) || government, demandRules.civic[facility] || demandRules.civic.default,
          Math.max(1, building.floors || 1), 'services', impact);
      }
      add(economy.ownerAccount(building), demandRules.buildingMaintenance, Math.max(1, building.footprint?.length || 1), 'maintenance');
    }
    add(government, demandRules.roadMaintenance, this.town.grid?.kindCounts?.[CELL_KIND.ROAD] || 0, 'maintenance');
    for (const slot of this.town.vehicles?.slots || []) if (slot.owner && !slot.scrapped)
      add(slot.owner, demandRules.vehicleMaintenance, 1, 'maintenance');
    // Several assets can share one wallet. Limit the combined basket, not each asset independently.
    const totals = new Map();
    for (const row of orders) {
      const id = `${row.buyer.sector}:${row.buyer.id}`;
      totals.set(id, (totals.get(id) || 0) + row.quantity * prices[row.product]);
    }
    for (const row of orders) {
      const id = `${row.buyer.sector}:${row.buyer.id}`;
      const budget = row.buyer.sector === 'government' ? publicBudget : economy._account(row.buyer)?.balance || 0;
      const factor = Math.min(1, Math.max(0, budget) / Math.max(1e-9, totals.get(id)));
      if (forecast && row.buyer.sector === 'government') row.affordableQuantity = row.quantity * factor;
      else row.quantity *= factor;
    }
    return orders;
  }

  /** Purchases consume seller inventory and settle through the audited economy ledger. */
  settleConsumption() {
    const economy = this.town.economy;
    const sellers = [economy._account('contractor')?.object, ...(economy.businesses || []).filter((firm) => firm.open && firm.type === 'industry')].filter(Boolean);
    const summary = { requested: 0, fulfilled: 0, spent: 0 };
    for (const order of this.consumptionOrders()) {
      summary.requested += order.quantity;
      let remaining = order.quantity;
      for (const seller of sellers) {
        if (remaining <= 1e-6) break;
        if (order.buyer.sector === 'business' && order.buyer.id === seller.id) continue;
        const price = priceFor(this.town, order.product);
        const balance = economy._account(order.buyer)?.balance || 0;
        const reserve = order.buyer.sector === 'government' ? economy.requiredPublicReserve(0) : 0;
        const quantity = Math.min(remaining, Math.max(0, balance - reserve) / price, seller.inventory?.[order.product] || 0);
        if (quantity * price < 0.01) continue;
        const result = economy.purchase({ buyer: order.buyer, seller: { sector: 'business', id: seller.id },
          commodity: order.product, quantity, unitPrice: price, taxable: order.buyer.sector !== 'government' });
        if (!result.ok) continue;
        remaining -= result.quantity; summary.fulfilled += result.quantity; summary.spent += result.total;
        if (order.buyer.sector === 'business') {
          const buyer = economy._account(order.buyer)?.object;
          if (buyer) buyer.inputExpense = (buyer.inputExpense || 0) + result.total;
        }
      }
    }
    this.lastConsumption = summary;
    return summary;
  }

  /** One context for all outputs. Read-only reports never advance shortage age or call full town statistics. */
  demandBoard() {
    const supply = {}, leadDays = {};
    const time = buildTimeChart.types.factory;
    const minArea = Math.min(...FACTORY_SIZES.map(([w, d]) => w * d));
    const orders = this.consumptionOrders({ forecast: true });
    orders.push({ product: 'goods', quantity: this.goodsDemand(), source: 'households', impact: demandRules.sourceImpact.households });
    for (const row of this.demandHistory) {
      if (row.day <= this.day - demandRules.historyDays) continue;
      const window = Math.min(demandRules.historyDays, Math.max(1, this.day));
      for (const [product, quantity] of Object.entries(row.quantities)) if (quantity > 0)
        orders.push({ product, quantity: quantity / window, source: row.source, impact: demandRules.sourceImpact[row.source] || 0 });
    }
    const utility = this.town.utilities?.electricityState?.().serviceFactor ?? 1;
    for (const def of FACTORY_TYPES) {
      leadDays[def.product] = time.base * (1 + time.area * (minArea - 1)) * (1 + time.floors * (def.floors - 1)) * buildTimeChart.defaults.maxFactor / 24;
      supply[def.product] = { stock: this.totalStock(def.product), rated: 0, effective: 0, pending: 0, pendingLeadDays: 0, constraints: [],
        importBenefit: Math.max(0, (priceFor(this.town, def.product, 'import') - priceFor(this.town, def.product)) / Math.max(1, priceFor(this.town, def.product, 'import'))) };
    }
    const inputPool = Object.fromEntries(COMMODITIES.map((key) => [key, this.totalStock(key)]));
    inputPool.food = Math.max(0, (this.town.resources?.levels?.food || 0) - (this.town.resources?.demandNow?.(this.town)?.food || 0));
    let publicInputBudget = Math.max(0, (this.town.economy?.treasury || 0) - (this.town.economy?.requiredPublicReserve?.(0) || 0));
    for (const building of this.factories().slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const key = this.typeOf(building).product, row = supply[key];
      const rated = this.factoryProductionRate(building);
      const firm = this.town.economy?.businessesById?.get(building.businessId);
      const labour = this.factoryLabourFactor(firm);
      const capital = Math.min(1, Math.max(0, firm?.fixedCapital || 0) / Math.max(1, rated * demandRules.capitalPerDailyOutput));
      row.rated += rated;
      if (labour < 0.99) row.constraints.push('staff/training');
      if (capital < 0.99) row.constraints.push('capital');
      if (utility < 0.99) row.constraints.push('electricity');
      let materials = 1;
      let inputCost = 0;
      for (const [input, perUnit] of Object.entries(INPUTS[key] || {})) {
        const available = inputPool[input] || 0;
        const factor = Math.min(1, available / Math.max(1e-9, rated * perUnit));
        if (factor < 0.99) row.constraints.push(`input:${input}`);
        materials = Math.min(materials, factor);
        const missing = Math.max(0, rated * perUnit - (firm?.inventory?.[input] || 0));
        inputCost += missing * (demandRules.primaryInputPrices[input] || priceFor(this.town, input));
      }
      const publicFirm = firm?.operatorSector === 'government';
      const publicFloat = publicFirm ? Math.min(publicInputBudget, Math.max(0, inputCost - (firm.cash || 0))) : 0;
      publicInputBudget -= publicFloat;
      const cashFactor = inputCost > 0 ? Math.min(1, (Math.max(0, firm?.cash || 0) + publicFloat) / inputCost) : 1;
      if (cashFactor < 0.99) row.constraints.push('working capital');
      const effective = rated * Math.max(0, Math.min(labour, capital, utility, materials, cashFactor));
      row.effective += effective;
      for (const [input, perUnit] of Object.entries(INPUTS[key] || {})) inputPool[input] = Math.max(0, (inputPool[input] || 0) - effective * perUnit);
    }
    for (const project of this.town.growth?.projects || []) {
      const plan = project.plan;
      const def = plan?.type === 'factory' && FACTORY_TYPES.find((row) => row.id === plan.factory);
      const target = plan?.target;
      const key = def?.product || (target?.purpose === 'industrial' && ['upgrade', 'wing', 'tierup'].includes(plan.type) ? this.typeOf(target)?.product : null);
      if (!key || !supply[key]) continue;
      const row = supply[key];
      // Conservative shell dimensions use the renderer's smallest jittered lot shell.
      const cols = plan.footprint?.cols || 3, rows = plan.footprint?.rows || 3;
      const shell = Math.max(3.5, cols * CELL - 0.95) * Math.max(3.4, rows * CELL - 0.95);
      row.pending += def ? RATE[key] * Math.max(0.1, shell * def.floors * 1.6 / FACTORY_REFERENCE_CAPACITY)
        : this.factoryProductionRate(target) / Math.max(1, target.floors || 1);
      const days = Number.isFinite(project.remaining) ? project.remaining / (SIM.secondsPerGameMinute * 60 * 24) : (project.hours || 0) / 24;
      row.pendingLeadDays = Math.max(row.pendingLeadDays, days);
    }
    for (const row of Object.values(supply)) row.constraints = [...new Set(row.constraints)];
    const ageDays = Object.fromEntries(Object.entries(this.pressureSince).map(([key, day]) => [key, Math.max(0, this.day - day)]));
    return assessIndustrialDemand({ orders, supply, leadDays, ageDays }, catalog, demandRules);
  }

  productDemand(key) { return this.demandBoard().find((row) => row.product === key)?.demand || 0; }
  producerCapacity(key) {
    return this.factories().filter((building) => this.typeOf(building)?.product === key)
      .reduce((sum, building) => sum + this.factoryProductionRate(building, { includeBonus: false }), 0);
  }
  producerPressure(key) { return this.demandBoard().find((row) => row.product === key && row.actionable) || null; }
  producerPressureSnapshot(limit = FACTORY_TYPES.length) { return this.demandBoard().filter((row) => row.actionable).slice(0, Math.max(1, limit)); }
  mostUrgentProducer() {
    return this.demandBoard().find((row) => row.actionable && ['build_factory', 'expand_capacity'].includes(row.remedy))?.product || null;
  }
  commissionProduct() { return this.mostUrgentProducer(); }
  updateDemandPersistence() {
    for (const row of this.demandBoard()) {
      if (row.actionable) this.pressureSince[row.product] ??= this.day;
      else delete this.pressureSince[row.product];
    }
  }
  serialize() { return { demandHistory: this.demandHistory.map((row) => ({ ...row, quantities: { ...row.quantities } })),
    pressureSince: { ...this.pressureSince }, lastConsumption: { ...this.lastConsumption } }; }
  restore(state) {
    this.demandHistory = (state?.demandHistory || []).map((row) => ({ ...row, quantities: { ...row.quantities } }));
    this.pressureSince = { ...state?.pressureSince };
    this.lastConsumption = { requested: 0, fulfilled: 0, spent: 0, ...state?.lastConsumption };
  }

  /**
   * The capacity contract used by a factory's output loop. HouseKit records a
   * floor/footprint capacity on the building; the fallback keeps legacy records
   * meaningful when they predate that field.
   */
  factoryCapacity(building) {
    const spec = building?.house?.spec || building?.spec || null;
    const capacity = Number(building?.capacity ?? spec?.capacity);
    if (Number.isFinite(capacity) && capacity > 0) return capacity;
    const footprint = Math.max(1, building?.footprint?.length || spec?.footprintTiles || 1);
    const floors = Math.max(1, building?.floors || spec?.floors || 1);
    return footprint * floors * 1.6;
  }

  factoryCapacityScale(building) {
    return Math.max(0.1, this.factoryCapacity(building) / FACTORY_REFERENCE_CAPACITY);
  }

  factoryProductionRate(building, { includeBonus = true } = {}) {
    const key = this.typeOf(building).product;
    const bonus = includeBonus ? 1 + (this.outputBonus || 0) : 1;
    return RATE[key] * this.factoryCapacityScale(building) * bonus;
  }

  factoryLabourFactor(firm) {
    if (!firm || firm.status === 'payroll_arrears') return 0;
    const employees = Math.max(0, Number(firm.employees) || 0);
    if (!employees) return 0;
    const staffing = employees / Math.max(1, Number(firm.jobsRequired) || 1);
    return Math.min(1, FACTORY_MIN_STAFFED_UTILIZATION + staffing * (1 - FACTORY_MIN_STAFFED_UTILIZATION));
  }

  /** Daily full-capacity output value of one factory — its GDP contribution. */
  revenuePerDay(building) {
    const key = this.typeOf(building).product;
    return Math.round(this.factoryProductionRate(building) * priceFor(this.town, key));
  }

  manualBuy(key, qty = 50) {
    if (!CAPACITY[key]) return { ok: false, reason: 'no such goods' };
    const n = Math.min(qty, Math.floor(CAPACITY[key] - this.totalStock(key)));
    if (n < 1) return { ok: false, reason: 'storehouse is full' };
    const imported = this.town.economy.importGoods({ sector: 'business', id: 'contractor' }, key, n, priceFor(this.town, key, 'import'));
    if (!imported.ok) return imported;
    const cost = imported.cost;
    this.imported += cost;
    this.note(`Bought ${n} ${LABEL[key].toLowerCase()} for $${cost.toLocaleString('en-US')}.`);
    return { ok: true, qty: n, cost };
  }

  /**
   * Whether the founding contractor can import a missing bill for the first
   * works.  Construction consumes the seed stockpile before the industry loop
   * has a chance to commission a factory; without this bridge the town can
   * reach a state where every material is short and the first producer is
   * impossible to approve.  This check is deliberately limited to a town with
   * no factories, so later construction must be supplied by local production
   * or an explicit council trade.
   */
  canBootstrapMaterials(mats = {}, product = null) {
    const factories = this.factories();
    const local = new Set(factories.map((building) => this.typeOf(building)?.product).filter(Boolean));
    // Bootstrap is a bounded industrial starter ring: only a missing local
    // construction-material producer may use the contractor's import bridge,
    // and only until lumber, steel and cement each have one.
    if (!MATERIAL_KEYS.includes(product) || local.has(product)) return false;
    if (MATERIAL_KEYS.every((key) => local.has(key))) return false;
    const contractor = this.town.economy?._account?.('contractor');
    if (!contractor) return false;
    let total = 0;
    for (const [key, value] of Object.entries(mats)) {
      const need = Math.max(0, Math.ceil((Number(value) || 0) - this.totalStock(key)));
      if (!need) continue;
      const capacity = CAPACITY[key] || 0;
      if (need > Math.max(0, Math.floor(capacity - this.totalStock(key)))) return false;
      total += need * priceFor(this.town, key, 'import');
    }
    return contractor.balance + 1e-8 >= total;
  }

  /**
   * Import the exact missing first-factory bill as one deterministic bootstrap
   * transaction per commodity.  All capacity and cash checks happen before the
   * first import, so a failed bootstrap cannot leave a half-seeded storehouse.
   */
  bootstrapMaterials(mats = {}, product = null) {
    if (!this.canBootstrapMaterials(mats, product)) return { ok: false, reason: 'factory-bootstrap-unaffordable' };
    const needs = Object.entries(mats)
      .map(([key, value]) => [key, Math.max(0, Math.ceil((Number(value) || 0) - this.totalStock(key)))])
      .filter(([, qty]) => qty > 0);
    const imported = [];
    for (const [key, qty] of needs) {
      const result = this.manualBuy(key, qty);
      if (!result.ok) return { ok: false, reason: result.reason || 'factory-bootstrap-failed', imported };
      imported.push({ key, qty: result.qty, cost: result.cost });
    }
    return { ok: true, imported, cost: imported.reduce((sum, row) => sum + row.cost, 0) };
  }

  /**
   * Essential network works may import a missing construction bill through the
   * contractor account. This is a cash and storehouse-capacity check only; the
   * caller opts into it for utilities/resource upgrades, so ordinary housing
   * and civic construction still depends on local industry.
   */
  canImportMaterials(mats = {}) {
    const contractor = this.town.economy?._account?.('contractor');
    if (!contractor) return false;
    let total = 0;
    for (const [key, value] of Object.entries(mats)) {
      const need = Math.max(0, Math.ceil((Number(value) || 0) - this.totalStock(key)));
      if (!need) continue;
      if (need > Math.max(0, Math.floor((CAPACITY[key] || 0) - this.totalStock(key)))) return false;
      total += need * priceFor(this.town, key, 'import');
    }
    return contractor.balance + 1e-8 >= total;
  }

  importMaterials(mats = {}) {
    if (!this.canImportMaterials(mats)) return { ok: false, reason: 'construction-import-unaffordable' };
    const needs = Object.entries(mats)
      .map(([key, value]) => [key, Math.max(0, Math.ceil((Number(value) || 0) - this.totalStock(key)))])
      .filter(([, qty]) => qty > 0);
    const imported = [];
    for (const [key, qty] of needs) {
      const result = this.manualBuy(key, qty);
      if (!result.ok) return { ok: false, reason: result.reason || 'construction-import-failed', imported };
      imported.push({ key, qty: result.qty, cost: result.cost });
    }
    return { ok: true, imported, cost: imported.reduce((sum, row) => sum + row.cost, 0) };
  }

  manualSell(key, qty = 50) {
    if (!CAPACITY[key]) return { ok: false, reason: 'no such goods' };
    const n = Math.min(qty, Math.floor(this.stocks[key]));
    if (n < 1) return { ok: false, reason: 'storehouse is empty' };
    const exported = this.town.economy.exportGoods({ sector: 'business', id: 'contractor' }, key, n, priceFor(this.town, key, 'export'));
    if (!exported.ok) return exported;
    const gain = exported.revenue;
    this.exported += gain;
    this.recordDemandFlow('exports', { [key]: n });
    this.note(`Sold ${n} ${LABEL[key].toLowerCase()} for $${gain.toLocaleString('en-US')}.`);
    return { ok: true, qty: n, cost: gain };
  }

  /** One game day: produce, consume, then rebalance the storehouse by trade. */
  runLegacyDay() {
    for (const b of this.factories()) {
      const key = this.typeOf(b).product;
      const made = this.factoryProductionRate(b) * this.rng.float(0.9, 1.1);
      this.stocks[key] = Math.min(CAPACITY[key], this.stocks[key] + made);
    }

    const demand = this.goodsDemand();
    if (demand > 0) this.stocks.goods = Math.max(0, this.stocks.goods - demand);

    // Surplus materials are exported for treasury income (never below 60%).
    // Phase 12 — every consumer row rides the same rule; goods keeps its own
    // import branch below (it is the staple the shops draw on, not a surplus).
    for (const key of COMMODITIES) {
      if (key === 'goods' || RAW_INPUTS.has(key)) continue;
      const cap = CAPACITY[key];
      if (this.stocks[key] <= cap * 0.85) continue;
      const qty = Math.floor(this.stocks[key] - cap * 0.6);
      if (qty < 1) continue;
      const gain = Math.round(priceFor(this.town, key, 'export') * qty);
      this.town.economy.transfer({ from: 'external', to: 'contractor', amount: gain, category: 'export', metadata: { commodity: key, quantity: qty } });
      this.exported += gain;
      this.stocks[key] -= qty;
      this.note(`Exports: ${qty} ${LABEL[key].toLowerCase()} sold for $${gain.toLocaleString('en-US')}.`);
    }

    // Consumer goods fall back to imports — but only while funds allow it,
    // so a broke town feels the shortage instead of papering over it.
    const g = this.stocks.goods;
    if (g < CAPACITY.goods * 0.2) {
      const qty = Math.min(40, Math.floor(CAPACITY.goods * 0.5 - g));
      const cost = Math.round(priceFor(this.town, 'goods', 'import') * qty);
      const contractor = this.town.economy?._account?.('contractor');
      if (qty > 0 && contractor && contractor.balance >= cost) {
        const paid = this.town.economy.transfer({ from: 'contractor', to: 'external', amount: cost, category: 'import', metadata: { commodity: 'goods', quantity: qty } });
        if (paid.ok) {
          this.imported += cost;
          this.stocks.goods = Math.min(CAPACITY.goods, g + qty);
          this.note(`Imports: ${qty} goods bought for $${cost.toLocaleString('en-US')}.`);
        }
      }
    }
  }

  /** Day-boundary driver for the main loop — mirrors economy.update. */
  /** Stock-flow production: output is firm inventory until an actual sale. */
  runStockFlowDay() {
    const economy = this.town.economy;
    economy?.syncEntities();
    economy?.assignEmployees();
    const utilityFactor = this.town.utilities?.electricityState?.().serviceFactor ?? 1;
    const industrialFirms = economy?.businesses?.filter((business) => business.type === 'industry') || [];
    const supplyInput = (firm, key, quantity) => {
      let remaining = Math.max(0, quantity - (firm.inventory[key] || 0));
      if (remaining <= 1e-9) return;
      // Food is produced and stored by ResourceSystem. Move it into the
      // factory's normal business inventory before recordProduction consumes
      // it, so the processor is tied to the same finite farm reserve rather
      // than receiving a second invisible food supply.
      if (key === 'food') {
        const resource = this.town.resources;
        const available = Math.max(0, (Number(resource?.levels?.food) || 0) - (resource?.demandNow?.(this.town)?.food || 0));
        const price = demandRules.primaryInputPrices.food;
        const moved = Math.min(remaining, available, Math.max(0, firm.cash || 0) / price);
        if (moved > 0) {
          const paid = economy.transfer({ from: { sector: 'business', id: firm.id }, to: 'contractor', amount: moved * price,
            category: 'purchase', metadata: { commodity: key, quantity: moved, intermediate: true } });
          if (!paid.ok) return;
          resource.levels.food -= moved;
          firm.inputExpense += moved * price;
          firm.inventory[key] = (firm.inventory[key] || 0) + moved;
          economy?._adjustExpectedInventory(firm.id, key, moved);
          remaining -= moved;
        }
      }
      // Crude oil is an imported raw input. It uses the same contractor
      // inventory and economy import path as a manual commodity purchase, but
      // only tops up the amount this refinery actually needs for today's run.
      if (remaining > 1e-9 && RAW_INPUTS.has(key)) {
        const price = priceFor(this.town, key, 'import');
        const quantity = Math.min(remaining, CAPACITY[key], Math.max(0, firm.cash || 0) / price);
        const imported = economy.importGoods({ sector: 'business', id: firm.id }, key, quantity, price);
        if (imported.ok) {
          this.imported += imported.cost;
          remaining -= imported.quantity;
        }
      }
      // The contractor storehouse is the public material buffer. It is used
      // before peer inventories so imported seed stock and local works share a
      // single physical flow rather than three disconnected silos.
      const price = priceFor(this.town, key);
      const fromStore = Math.min(remaining, this.stocks[key] || 0, Math.max(0, firm.cash || 0) / price);
      if (fromStore > 0) {
        const trade = economy.buyInventory({ buyer: { sector: 'business', id: firm.id }, seller: { sector: 'business', id: 'contractor' },
          commodity: key, quantity: fromStore, unitPrice: price });
        if (trade.ok) remaining -= trade.quantity;
      }
      if (remaining <= 1e-9) return;
      for (const source of industrialFirms) {
        if (source === firm || remaining <= 1e-9) continue;
        const moved = Math.min(remaining, source.inventory[key] || 0, Math.max(0, firm.cash || 0) / price);
        if (moved <= 0) continue;
        const trade = economy.buyInventory({ buyer: { sector: 'business', id: firm.id }, seller: { sector: 'business', id: source.id },
          commodity: key, quantity: moved, unitPrice: price });
        if (trade.ok) remaining -= trade.quantity;
      }
    };
    for (const building of this.factories()) {
      const firm = economy?.businessesById?.get(building.businessId);
      if (!firm) continue;
      const key = this.typeOf(building).product;
      // Rated output is the building's capacity contract. Keep staffing,
      // utilities, working capital, and input draw as utilization gates on
      // that same rated quantity; a larger multi-storey works must not still
      // consume and produce like the smallest baseline factory.
      const ratedOutput = this.factoryProductionRate(building);
      const labour = this.factoryLabourFactor(firm);
      const capital = Math.min(1, (firm.fixedCapital || 0) / Math.max(1, ratedOutput * demandRules.capitalPerDailyOutput));
      const needs = INPUTS[key] || {};
      const runnableOutput = ratedOutput * Math.max(0, Math.min(labour, capital, utilityFactor));
      // Public plants have no private startup float. Cover their measured input bill
      // as ordinary operating procurement, within reserve, rather than giving free inputs.
      if (firm.operatorSector === 'government') {
        const bill = Object.entries(needs).reduce((sum, [input, perUnit]) => sum +
          Math.max(0, runnableOutput * perUnit - (firm.inventory[input] || 0)) *
          (demandRules.primaryInputPrices[input] || priceFor(this.town, input, RAW_INPUTS.has(input) ? 'import' : 'local')), 0);
        const room = Math.max(0, economy.treasury - economy.requiredPublicReserve(0));
        const amount = Math.min(room, Math.max(0, bill - (firm.cash || 0)));
        if (amount >= 0.01) economy.transfer({ from: 'government', to: { sector: 'business', id: firm.id }, amount,
          category: 'government_procurement', metadata: { purpose: 'factory_inputs', businessId: firm.id } });
      }
      for (const [input, perUnit] of Object.entries(needs))
        supplyInput(firm, input, runnableOutput * perUnit);
      let materials = 1;
      for (const [input, perUnit] of Object.entries(needs))
        materials = Math.min(materials, (firm.inventory[input] || 0) / Math.max(1e-6, ratedOutput * perUnit));
      const factor = Math.max(0, Math.min(labour, capital, materials, utilityFactor));
      const made = Math.min(ratedOutput * factor * this.rng.float(0.9, 1.1),
        ...Object.entries(needs).map(([input, perUnit]) => (firm.inventory[input] || 0) / Math.max(1e-9, perUnit)));
      const consumed = Object.fromEntries(Object.entries(needs).map(([input, perUnit]) => [input, made * perUnit]));
      firm.productionFactor = factor;
      firm.utilityFactor = utilityFactor;
      if (made > 0) economy.recordProduction(firm, key, made, consumed, priceFor(this.town, key));
      const band = factor >= 0.99 ? 'full' : factor <= 0 ? 'stopped' : `reduced-${Math.floor(factor * 4)}`;
      if (band !== firm.lastConstraintBand && band !== 'full')
        this.note(`${firm.name} production reduced to ${Math.round(factor * 100)}% by labour, inputs, capital or utilities.`);
      firm.lastConstraintBand = band;
    }
    this.settleConsumption();
    this.updateDemandPersistence();
    const goodsProducer = economy?.businesses?.find((firm) =>
      firm.type === 'industry' && this.typeOf(firm.building)?.product === 'goods' && (firm.inventory.goods || 0) > 0);
    if (goodsProducer) {
      for (const retailer of economy.businesses.filter((firm) => firm.type !== 'industry' && firm.type !== 'office')) {
        const need = Math.max(0, 120 - (retailer.inventory.goods || 0));
        if (!need) continue;
        const trade = economy.buyInventory({
          buyer: { sector: 'business', id: retailer.id }, seller: { sector: 'business', id: goodsProducer.id },
          commodity: 'goods', quantity: need, unitPrice: priceFor(this.town, 'goods')
        });
        if (!trade.ok && trade.reason === 'insufficient_funds') retailer.status = 'input_arrears';
      }
    }
    for (const key of COMMODITIES) {
      if (key === 'goods' || RAW_INPUTS.has(key)) continue;
      const cap = CAPACITY[key];
      for (const firm of economy?.businesses?.filter((b) => b.type === 'industry') || []) {
        if ((firm.inventory[key] || 0) <= cap * 0.2) continue;
        const qty = Math.floor((firm.inventory[key] || 0) - cap * 0.15);
        const sold = economy.exportGoods({ sector: 'business', id: firm.id }, key, qty, priceFor(this.town, key, 'export'));
        if (!sold.ok) continue;
        this.exported += sold.revenue;
        this.recordDemandFlow('exports', { [key]: sold.quantity });
        this.note(`${firm.name} exported ${sold.quantity} ${LABEL[key].toLowerCase()} for $${Math.round(sold.revenue).toLocaleString('en-US')}.`);
      }
    }
    const retail = economy?.businesses?.find((b) => b.type !== 'industry' && (b.inventory.goods || 0) < 20);
    if (retail) {
      const bought = economy.importGoods({ sector: 'business', id: retail.id }, 'goods', 40, priceFor(this.town, 'goods', 'import'));
      if (bought.ok) {
        this.imported += bought.cost;
        this.note(`${retail.name} imported 40 goods for $${Math.round(bought.cost).toLocaleString('en-US')}.`);
      }
    }
  }

  runDay() { return this.runStockFlowDay(); }

  update(dt, clock) {
    if (!clock) return;
    this.day = clock.day;
    if (this.lastDay === -1) {
      this.lastDay = clock.day;
      return;
    }
    if (clock.day === this.lastDay) return;
    this.lastDay = clock.day;
    this.runStockFlowDay();
  }

  describe(building) {
    const def = this.typeOf(building);
    if (!def) return null;
    const key = def.product;
    const rate = this.factoryProductionRate(building);
    const firm = this.town.economy?.businessesById?.get(building.businessId);
    const utilization = Number.isFinite(firm?.productionFactor) ? firm.productionFactor : null;
    return {
      label: def.label,
      product: key,
      productLabel: LABEL[key],
      rate: Math.round(rate),
      baseRate: RATE[key],
      factoryCapacity: Math.round(this.factoryCapacity(building)),
      capacityScale: Math.round(this.factoryCapacityScale(building) * 100) / 100,
      utilization: utilization == null ? null : Math.round(utilization * 100) / 100,
      actualRate: utilization == null ? null : Math.round(rate * utilization),
      stock: Math.round(this.totalStock(key)),
      stockCapacity: CAPACITY[key],
      worth: this.revenuePerDay(building)
    };
  }

  stats() {
    const commodities = {};
    for (const key of COMMODITIES) {
      const s = this.totalStock(key);
      commodities[key] = {
        label: LABEL[key],
        stock: Math.round(s),
        capacity: CAPACITY[key],
        percent: Math.round((s / CAPACITY[key]) * 100),
        buy: Math.round(priceFor(this.town, key, 'import')),
        sell: Math.round(priceFor(this.town, key, 'export'))
      };
    }
    const factories = this.factories();
    const revenue = factories.reduce((s, b) => s + this.revenuePerDay(b), 0);
    return {
      commodities,
      demandBoard: this.demandBoard(),
      consumption: { ...this.lastConsumption },
      factories: factories.length,
      revenue: Math.round(revenue),
      goods: {
        stock: Math.round(this.totalStock('goods')),
        demand: this.goodsDemand(),
        factor: this.goodsFactor()
      },
      exported: Math.round(this.exported),
      imported: Math.round(this.imported),
      net: Math.round(this.exported - this.imported)
    };
  }
}
