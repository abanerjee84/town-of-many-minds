import { events } from '../core/events.js';

/**
 * Phase 6 — industry & trade. Factories produce the materials construction
 * consumes (lumber, steel, cement) plus consumer goods; a stockpile gates
 * every gated build, exports add treasury income, and citizens' goods access
 * feeds their mood. Deterministic: production jitter comes from one forked
 * stream, so seeded runs replay exactly.
 */

/** Material cost per construction type — consumed on start, refunded on stall. */
export const MATERIALS = {
  house: { lumber: 12, cement: 8 },
  shop: { lumber: 14, cement: 12, steel: 4 },
  civic: { lumber: 16, cement: 24, steel: 10 },
  factory: { lumber: 10, cement: 28, steel: 34 },
  upgrade: { lumber: 8, cement: 6, steel: 4 },
  renovate: { lumber: 6, cement: 4, steel: 2 },
  tierup: { lumber: 10, cement: 8, steel: 6 },
  wing: { lumber: 14, cement: 10, steel: 6 },
  archetype: { lumber: 14, cement: 12, steel: 8 },
  // Phase 9 — a bridge is a steel structure; per water cell spanned.
  bridge: { steel: 12, cement: 6 }
  // Landmark per-CELL rates live with their catalogue rows (growth LANDMARKS).
};

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
export const FACTORY_SIZES = [
  [3, 3],
  [4, 3],
  [3, 4],
  [4, 4],
  [5, 4]
];

/**
 * The factory kinds; one product each, all consuming town energy. `floors`
 * and `modules` are part of the stable visual/inspection contract: production
 * is still selected by product, while the kit can give each industry a
 * recognisable silhouette instead of rendering seven copies of one shed.
 */
export const FACTORY_TYPES = [
  { id: 'sawmill', label: 'Sawmill', product: 'lumber', floors: 2, modules: ['timber-yard', 'sawtooth-roof', 'dust-collector'] },
  { id: 'steelworks', label: 'Steelworks', product: 'steel', floors: 4, modules: ['cooling-tower', 'blast-furnace', 'ore-yard', 'stack'] },
  { id: 'cement', label: 'Cement works', product: 'cement', floors: 3, modules: ['kiln-tower', 'silo-bank', 'conveyor', 'stack'] },
  { id: 'goods', label: 'Goods plant', product: 'goods', floors: 3, modules: ['assembly-hall', 'loading-dock', 'office-block'] },
  // Phase 12 (C3) — three consumer works so the industrial ring is not just
  // construction materials. Every table below carries a row for each product;
  // trade rows, HUD, Stocks and stats all iterate COMMODITIES already.
  { id: 'textile', label: 'Textile mill', product: 'cloth', floors: 3, modules: ['sawtooth-roof', 'dye-tanks', 'delivery-bay'] },
  { id: 'software', label: 'Software house', product: 'software', floors: 5, modules: ['office-tower', 'data-hall', 'cooling-units'] },
  { id: 'furniture', label: 'Furniture workshop', product: 'furniture', floors: 2, modules: ['showroom', 'timber-yard', 'loading-dock'] }
];

export const COMMODITIES = ['lumber', 'steel', 'cement', 'goods', 'cloth', 'software', 'furniture'];

const BASE_PRICE = {
  lumber: 48, steel: 64, cement: 40, goods: 36,
  cloth: 44, software: 78, furniture: 52
};
const IMPORT_MULT = 1.18;
const EXPORT_MULT = 0.84;
const CAPACITY = {
  lumber: 900, steel: 850, cement: 850, goods: 900,
  cloth: 800, software: 600, furniture: 800
};
const INITIAL = {
  lumber: 500, steel: 400, cement: 450, goods: 400,
  // software sits just over the strain gate at load: the founding storehouse
  // starts healthy (no commission signal until real drawdown).
  cloth: 300, software: 250, furniture: 300
};
/** Units produced per factory per game day. */
const RATE = {
  lumber: 45, steel: 35, cement: 40, goods: 30,
  cloth: 32, software: 20, furniture: 28
};
const INPUTS = {
  goods: { steel: 0.05, lumber: 0.08 },
  furniture: { lumber: 0.25 },
  cement: { lumber: 0.03 }
};
const LABEL = {
  lumber: 'Lumber', steel: 'Steel', cement: 'Cement', goods: 'Goods',
  cloth: 'Cloth', software: 'Software', furniture: 'Furniture'
};
/** Construction materials — what a plan's bill is denominated in. */
export const MATERIAL_KEYS = ['lumber', 'steel', 'cement'];
/** Storehouse fill below this ratio counts as strained (commission signal). */
const STRAIN_GATE = 0.35;

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
    return MATERIAL_KEYS.find((key) => !local.has(key) && this.stocks[key] / CAPACITY[key] < STRAIN_GATE) || null;
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

  /**
   * Demand-driven pick for a commission with no pinned type: the strained
   * product if any, else a BALANCED pick — the product with the fewest works
   * producing it (ties → table order). Never a fixed default.
   */
  commissionProduct() {
    // Keep the construction loop alive before balancing consumer goods: a
    // town that has exhausted steel or cement cannot build the next factory
    // unless that material's own works is commissioned first.
    const construction = this.missingConstructionProduct() || this.deficitProduct();
    if (construction) return construction;
    const strained = this.strainedProduct();
    if (strained) return strained;
    const counts = {};
    for (const key of COMMODITIES) counts[key] = 0;
    for (const b of this.factories()) {
      const key = this.typeOf(b).product;
      if (counts[key] != null) counts[key]++;
    }
    let best = COMMODITIES[0];
    for (const key of COMMODITIES) {
      if (counts[key] < counts[best]) best = key;
    }
    return best;
  }

  /** Daily output value of one factory — what the works contributes to GDP. */
  revenuePerDay(building) {
    const key = this.typeOf(building).product;
    // Phase 17 — the innovation ladder's `output` lever rides the same
    // per-works rate the whole industry is sized from, so a research gain and a
    // new works are comparable and compound.
    return Math.round(RATE[key] * BASE_PRICE[key] * (1 + (this.outputBonus || 0)));
  }

  manualBuy(key, qty = 50) {
    if (!CAPACITY[key]) return { ok: false, reason: 'no such goods' };
    const n = Math.min(qty, Math.floor(CAPACITY[key] - this.totalStock(key)));
    if (n < 1) return { ok: false, reason: 'storehouse is full' };
    const imported = this.town.economy.importGoods({ sector: 'business', id: 'contractor' }, key, n, BASE_PRICE[key] * IMPORT_MULT);
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
      total += need * BASE_PRICE[key] * IMPORT_MULT;
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
      total += need * BASE_PRICE[key] * IMPORT_MULT;
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
    const exported = this.town.economy.exportGoods({ sector: 'business', id: 'contractor' }, key, n, BASE_PRICE[key] * EXPORT_MULT);
    if (!exported.ok) return exported;
    const gain = exported.revenue;
    this.exported += gain;
    this.note(`Sold ${n} ${LABEL[key].toLowerCase()} for $${gain.toLocaleString('en-US')}.`);
    return { ok: true, qty: n, cost: gain };
  }

  /** One game day: produce, consume, then rebalance the storehouse by trade. */
  runLegacyDay() {
    for (const b of this.factories()) {
      const key = this.typeOf(b).product;
      const made = RATE[key] * this.rng.float(0.9, 1.1);
      this.stocks[key] = Math.min(CAPACITY[key], this.stocks[key] + made);
    }

    const demand = this.goodsDemand();
    if (demand > 0) this.stocks.goods = Math.max(0, this.stocks.goods - demand);

    // Surplus materials are exported for treasury income (never below 60%).
    // Phase 12 — every consumer row rides the same rule; goods keeps its own
    // import branch below (it is the staple the shops draw on, not a surplus).
    for (const key of COMMODITIES) {
      if (key === 'goods') continue;
      const cap = CAPACITY[key];
      if (this.stocks[key] <= cap * 0.85) continue;
      const qty = Math.floor(this.stocks[key] - cap * 0.6);
      if (qty < 1) continue;
      const gain = Math.round(BASE_PRICE[key] * EXPORT_MULT * qty);
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
      const cost = Math.round(BASE_PRICE.goods * IMPORT_MULT * qty);
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
      // The contractor storehouse is the public material buffer. It is used
      // before peer inventories so imported seed stock and local works share a
      // single physical flow rather than three disconnected silos.
      const fromStore = Math.min(remaining, this.stocks[key] || 0);
      if (fromStore > 0) {
        this.stocks[key] -= fromStore;
        firm.inventory[key] = (firm.inventory[key] || 0) + fromStore;
        economy?._adjustExpectedInventory(firm.id, key, fromStore);
        remaining -= fromStore;
      }
      if (remaining <= 1e-9) return;
      for (const source of industrialFirms) {
        if (source === firm || remaining <= 1e-9) continue;
        const moved = Math.min(remaining, source.inventory[key] || 0);
        if (moved <= 0) continue;
        source.inventory[key] -= moved;
        firm.inventory[key] = (firm.inventory[key] || 0) + moved;
        economy?._adjustExpectedInventory(source.id, key, -moved);
        economy?._adjustExpectedInventory(firm.id, key, moved);
        remaining -= moved;
      }
    };
    for (const building of this.factories()) {
      const firm = economy?.businessesById?.get(building.businessId);
      if (!firm) continue;
      const key = this.typeOf(building).product;
      const labour = firm.status === 'payroll_arrears'
        ? 0
        : Math.min(1, (firm.employees || 0) / Math.max(1, firm.jobsRequired || 1));
      const capital = Math.min(1, (firm.fixedCapital || 0) / Math.max(1, RATE[key] * 800));
      const needs = INPUTS[key] || {};
      for (const [input, perUnit] of Object.entries(needs))
        supplyInput(firm, input, RATE[key] * perUnit);
      let materials = 1;
      for (const [input, perUnit] of Object.entries(needs))
        materials = Math.min(materials, (firm.inventory[input] || 0) / Math.max(1e-6, RATE[key] * perUnit));
      const factor = Math.max(0, Math.min(labour, capital, materials, utilityFactor));
      const made = RATE[key] * factor * (1 + (this.outputBonus || 0)) * this.rng.float(0.9, 1.1);
      const consumed = Object.fromEntries(Object.entries(needs).map(([input, perUnit]) => [input, made * perUnit]));
      firm.productionFactor = factor;
      firm.utilityFactor = utilityFactor;
      if (made > 0) economy.recordProduction(firm, key, made, consumed, BASE_PRICE[key]);
      const band = factor >= 0.99 ? 'full' : factor <= 0 ? 'stopped' : `reduced-${Math.floor(factor * 4)}`;
      if (band !== firm.lastConstraintBand && band !== 'full')
        this.note(`${firm.name} production reduced to ${Math.round(factor * 100)}% by labour, inputs, capital or utilities.`);
      firm.lastConstraintBand = band;
    }
    const goodsProducer = economy?.businesses?.find((firm) =>
      firm.type === 'industry' && this.typeOf(firm.building)?.product === 'goods' && (firm.inventory.goods || 0) > 0);
    if (goodsProducer) {
      for (const retailer of economy.businesses.filter((firm) => firm.type !== 'industry' && firm.type !== 'office')) {
        const need = Math.max(0, 120 - (retailer.inventory.goods || 0));
        if (!need) continue;
        const trade = economy.buyInventory({
          buyer: { sector: 'business', id: retailer.id }, seller: { sector: 'business', id: goodsProducer.id },
          commodity: 'goods', quantity: need, unitPrice: BASE_PRICE.goods
        });
        if (!trade.ok && trade.reason === 'insufficient_funds') retailer.status = 'input_arrears';
      }
    }
    for (const key of COMMODITIES) {
      if (key === 'goods') continue;
      const cap = CAPACITY[key];
      for (const firm of economy?.businesses?.filter((b) => b.type === 'industry') || []) {
        if ((firm.inventory[key] || 0) <= cap * 0.2) continue;
        const qty = Math.floor((firm.inventory[key] || 0) - cap * 0.15);
        const sold = economy.exportGoods({ sector: 'business', id: firm.id }, key, qty, BASE_PRICE[key] * EXPORT_MULT);
        if (!sold.ok) continue;
        this.exported += sold.revenue;
        this.note(`${firm.name} exported ${sold.quantity} ${LABEL[key].toLowerCase()} for $${Math.round(sold.revenue).toLocaleString('en-US')}.`);
      }
    }
    const retail = economy?.businesses?.find((b) => b.type !== 'industry' && (b.inventory.goods || 0) < 20);
    if (retail) {
      const bought = economy.importGoods({ sector: 'business', id: retail.id }, 'goods', 40, BASE_PRICE.goods * IMPORT_MULT);
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
    return {
      label: def.label,
      product: key,
      productLabel: LABEL[key],
      rate: RATE[key],
      stock: Math.round(this.totalStock(key)),
      capacity: CAPACITY[key],
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
        buy: Math.round(BASE_PRICE[key] * IMPORT_MULT),
        sell: Math.round(BASE_PRICE[key] * EXPORT_MULT)
      };
    }
    const factories = this.factories();
    const revenue = factories.reduce((s, b) => s + this.revenuePerDay(b), 0);
    return {
      commodities,
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
