import { events } from '../core/events.js';
import { CELL_KIND, ZONE } from '../core/config.js';
import { ECON, PUBLIC_PROJECT_TYPES, PRIVATE_PROJECT_TYPES, PUBLIC_PROGRAM_TYPES, SECTOR, TRANSACTION_CATEGORIES } from './economicConfig.js';
import { qualifies, qualifiedJobs, jobById } from '../kits/citizens/personality.js';
import { setJob } from '../kits/citizens/citizenProfile.js';
import { basePrice } from './priceChart.js';

export const TICKET = 16;

/**
 * The ledger's declared vocabulary, as a Set for the per-transfer guard in
 * `transfer`. `category: 'transfer'` remains the default so an unnamed call
 * still lands somewhere sensible.
 */
const LEDGER_CATEGORIES = new Set([...TRANSACTION_CATEGORIES, 'transfer', 'project_reversal']);
/**
 * Floor area one member of staff is responsible for, in square metres.
 *
 * The single tunable behind `staffNeeded`. Chosen so a one-storey shop (about
 * 8 m² of floor) is staffed by one person, a two-storey one by two, and a
 * six-storey office by five or six — i.e. the requirement visibly scales with
 * the building instead of collapsing to 1 for anything small.
 */
export const AREA_PER_STAFF = 15;
/** @deprecated kept for callers that still name the old capacity divisor. */
export const STAFF_UNIT = 70;
export const ASSESS = { residential: 45000, commercial: 70000, industrial: 140000, civic: 220000, park: 15000 };
export const SHOP_TIERS = {
  stall: { id: 'stall', label: 'market stall', cellCost: basePrice('commerce.stall', 4500), capacity: 70, sizes: [[1, 1]] },
  kiosk: { id: 'kiosk', label: 'kiosk', cellCost: basePrice('commerce.kiosk', 6500), capacity: 140, sizes: [[2, 1], [1, 2]] },
  shop: { id: 'shop', label: 'shop', cellCost: basePrice('commerce.shop', 8500), capacity: 300, sizes: [[2, 2], [2, 1]] },
  store: { id: 'store', label: 'department store', cellCost: basePrice('commerce.store', 11000), capacity: 650, sizes: [[3, 2], [4, 2], [3, 1]] }
};

export function money(v) { return `$${Math.round(v || 0).toLocaleString('en-US')}`; }
function businessLabel(b) {
  if (b.purpose === 'industrial') return 'Works';
  if (b.kind === 'office') return 'Office';
  if (b.kind === 'hotel') return 'Hotel';
  if (b.kind === 'resort') return 'Resort';
  return 'Shop';
}
function finiteAmount(v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; }

/** Proprietor names — a private firm has a person behind it, not a sector id. */
const OWNER_NAMES = ['Ada', 'Bruno', 'Clara', 'Dmitri', 'Elif', 'Fen', 'Greta', 'Hugo', 'Ines', 'Jonas',
  'Kaya', 'Leo', 'Mira', 'Nils', 'Odette', 'Pablo', 'Quinn', 'Rosa', 'Sami', 'Tessa'];
const OWNER_SURNAMES = ['Aalto', 'Bergstrom', 'Cardoso', 'Delacroix', 'Eriksen', 'Fontaine', 'Gallardo',
  'Halvorsen', 'Ibarra', 'Kowalski', 'Moreau', 'Nakamura', 'Petrov', 'Rasmussen', 'Sandoval', 'Thorne'];
/** Stable 32-bit string hash — deterministic names, no rng draw. */
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < String(id).length; i++) {
    h ^= String(id).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A state-run works does not have a proprietor to recruit a specialist from
// the local labour pool.  Keep the mapping here so the public staffing pass
// can choose a credible trade, with assembler as the safe fallback for a new
// worker who has not yet earned the steel/cement credential.
const FACTORY_JOB = Object.freeze({
  sawmill: 'millworker',
  steelworks: 'metallurgist',
  cement: 'cementworker',
  goods: 'assembler',
  textile: 'assembler',
  software: 'assembler',
  furniture: 'assembler',
  quarry: 'assembler',
  'food-processing': 'assembler',
  glassworks: 'assembler',
  chemicals: 'assembler',
  paper: 'assembler',
  electronics: 'assembler',
  machinery: 'assembler',
  refinery: 'assembler',
  polymers: 'assembler',
  pharma: 'assembler',
  batteries: 'assembler'
});

// A vacancy is a role at a workplace, not a demand for one particular
// starting job.  These are the local job families that can legally transfer
// into each building kind.  `qualifiedJobs` still applies the citizen's
// education gate, so a transfer never manufactures a credential.
const BUILDING_JOB_ROLES = Object.freeze({
  shop: ['shopkeeper', 'baker', 'barista', 'chef', 'mechanic', 'carpenter', 'florist'],
  office: ['officeclerk', 'accountant', 'designer'],
  hotel: ['barista', 'chef', 'shopkeeper'],
  resort: ['barista', 'chef', 'shopkeeper'],
  factory: ['assembler'],
  civic: ['clerk', 'teacher', 'nurse', 'librarian', 'councillor'],
  park: ['gardener']
});

function isGovernmentBuilding(building) {
  return building?.ownerType === SECTOR.GOVERNMENT || building?.owner === 'state';
}
function blankPeriod(day = 1) {
  return {
    day, wages: 0, sales: 0, incomeTax: 0, salesTax: 0, propertyTax: 0, corporateTax: 0,
    rent: 0, spending: 0, governmentRevenue: 0, governmentExpenditure: 0,
    municipalRevenue: 0, transitFare: 0, businessLicense: 0, landLease: 0, tourismTax: 0, utilityFee: 0,
    householdConsumption: 0, privateFixedInvestment: 0, inventoryInvestment: 0,
    governmentConsumption: 0, governmentInvestment: 0, exports: 0, imports: 0,
    householdSaving: 0, businessRevenue: 0, businessProfit: 0, categories: Object.create(null)
  };
}

/** Central accounts, transaction ledger, persistent firms and derived statistics. */
export class EconomySystem {
  constructor(town) { this.town = town; this.rng = town.rng.fork(4407); this.reset(); }

  reset() {
    this.ids = { building: 1, business: 1, transaction: 1, loan: 1, bond: 1, project: 1, household: 1 };
    this.businessesById = new Map();
    this.ownersById = new Map();
    this.businesses = [];
    this.closedBusinesses = [];
    this.registeredCitizens = new Set();
    this.inventoryExpected = new Map();
    this.ledger = [];
    this.transactions = this.ledger;
    this.rejectedTransactions = [];
    this.paymentFailureWarnings = new Set();
    this.loans = [];
    this.bonds = [];
    this.accounts = {
      government: { id: 'government', cash: this.initialTreasuryTarget() },
      bank: { id: 'bank', cash: 1000000, deposits: 0, loans: 0, reserves: 1000000, equity: 1000000, interestIncome: 0 },
      external: { id: 'external', cash: 0 },
      developer: { id: 'developer', cash: ECON.business.developerCash, debt: 0, inventory: {} },
      contractor: { id: 'contractor', cash: ECON.business.contractorCash }
    };
    this.capital = { privateResidential: 0, privateCommercial: 0, privateIndustrial: 0, publicInfrastructure: 0, publicBuildings: 0 };
    this.expectedMoney = 0;
    this.day = 0;
    this.lastDay = 1;
    this.bizCount = -1;
    this.landAvg = 0.5;
    this.frontageBump = new Map();
    this.assessed = 0;
    this.lastDividend = 0;
    this.period = blankPeriod(1);
    this.lastPeriod = blankPeriod(0);
    this.acc = this.period;
    this.totalTrips = 0;
    this.unemployment = 0;
    this.participation = 0;
    this.tourism = {
      arrivals: 0, departures: 0, nights: 0, revenue: 0, revenueToday: 0,
      roomCapacity: 0, occupiedRooms: 0, freeRooms: 0, appeal: 0, demand: 0,
      visitors: 0, occupancy: 0, lastDay: 0
    };
    this.gdp = 0;
    this.gdpComponents = { consumption: 0, privateFixedInvestment: 0, inventoryInvestment: 0, governmentConsumption: 0, governmentInvestment: 0, exports: 0, imports: 0, period: 'daily' };
    this.landValue = null;
    this.warnings = [];
    this.taxScale = 1;
    this.reserve = 0;
    this.reserveTarget = Math.round(this.accounts.government.cash * ECON.government.reserveTargetShare);
    this.debt = 0;
    this.spendingScale = 1;
    this.subsidy = null;
    this.policySpending = 0;
    this.policyTax = 0;
    this.policyStaffPay = 0;
    this.policyStaffFloor = 0;
    this.policyRevenue = 0;
    this.policyPropertyBase = 0;
    this.staffBonus = 0;
    this.lastHiring = { local: 0, retrained: 0, imported: 0, public: 0, private: 0 };
    // Accumulate public wages committed during one staffing pass. Checking
    // only the first hire allowed a civic/resource sweep to fill an entire
    // roster while proving that just one worker fit the operating reserve.
    this.publicHiringCommitted = 0;
    this.eventHistory = [];
    this.treasuryDailyClose = new Map();
    // Citizens whose savings account has been opened. One-shot per citizen: it
    // is what stops `openFirstAccount` running again on a later day and
    // banking the same cash twice.
    this.openedAccounts = new Set();
    this.settledDeposits = 0;
    // Conservation memo for household wallets, built from the roster once and
    // then maintained by the account setter. It has to be seeded here because
    // `_resetExpectedMoney` at the end of this method reads it.
    this.householdCashLedger = (this.town.pedestrians?.citizens || []).reduce((s, c) => s + (c.p.cash || 0), 0);
    this.syncEntities();
    this._resetExpectedMoney();
  }

  /**
   * The configured treasury is the balance residents see when day one opens,
   * after the founding pipeline has booked its public assets. Keeping this in
   * data makes the opening policy tunable without scattering a magic number.
   */
  initialTreasuryTarget() {
    const value = Number(ECON.government?.initialTreasury);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 1000000;
  }

  /**
   * Reconcile the founding account to the configured day-one opening balance.
   * The founding fleet is still paid for through the normal public-investment
   * path; this separate, explicit transfer records only the opening capital
   * needed to make the configured value a post-founding balance.
   */
  settleOpeningTreasury() {
    const target = this.initialTreasuryTarget();
    const delta = Math.round((target - this.treasury) * 100) / 100;
    if (Math.abs(delta) < 0.01) return { ok: true, target, amount: 0, treasury: this.treasury };
    const result = delta > 0
      ? this.transfer({
        from: 'external', to: 'government', amount: delta,
        category: 'opening_capitalization',
        metadata: { openingTreasury: true, target }
      })
      : this.transfer({
        from: 'government', to: 'external', amount: -delta,
        category: 'opening_capitalization',
        metadata: { openingTreasury: true, target, surplus: true, allowBelowOperatingFloor: true }
      });
    if (!result.ok) return { ...result, target, treasury: this.treasury };
    return { ok: true, target, amount: delta, treasury: this.treasury, transaction: result.transaction };
  }

  /**
   * The treasury balance.
   *
   * Deliberately does NOT re-baseline `expectedMoney`. It used to, which made
   * this single property a global mute on the only conservation alarm in the
   * system: anything that assigned through the setter laundered itself, and
   * `audit().ok` stayed true. Verified by the audit team — minting $5,000,000
   * through the setter produced `unexpectedMoneyCreation: 0`.
   *
   * A baseline is a statement about the past ("this is what the town had when
   * the world was set up"), and only `reset()` may make one. Legitimate
   * movements of public money go through `transfer`, which is what keeps them
   * visible.
   */
  get treasury() { return this.accounts.government.cash; }
  set treasury(value) { this.accounts.government.cash = Number(value) || 0; }
  nextId(kind) { const n = this.ids[kind] || 1; this.ids[kind] = n + 1; return `${kind}-${n}`; }
  note(text, category = 'economy', severity = 'info') {
    this.eventHistory.push({ tick: this.lastDay, category, severity, text });
    if (this.eventHistory.length > 80) this.eventHistory.shift();
    events.emit('log', { text, kind: severity === 'info' ? 'note' : 'event' });
  }

  ensureBuildingIdentity(building) {
    if (!building) return null;
    if (!building.id) building.id = this.town.nextEntityId ? this.town.nextEntityId('building') : this.nextId('building');
    if (!building.ownerType) {
      building.ownerType = building.owner === 'state' ? SECTOR.GOVERNMENT : 'developer';
      building.ownerId = building.owner === 'state' ? 'government' : 'developer';
    }
    if (!building.ownerId) building.ownerId = building.ownerType === SECTOR.GOVERNMENT ? 'government' : 'developer';
    building.owner = building.ownerType === SECTOR.GOVERNMENT ? 'state' : 'private';
    return building.id;
  }

  /**
   * Record a change to a household's wallet in the conservation memo.
   *
   * Called from the account's balance setter and from nowhere else, on purpose.
   * The memo is the ledger's view of household money, so only the ledger may
   * change it: a direct write to `p.cash` — founding a citizen with an opening
   * balance, or zeroing one before it is re-issued from `external` — is not a
   * money movement and must not be counted as one. Adjusting the memo at those
   * sites as well double-counted the opening balance and put the memo
   * hundreds of thousands below the roster.
   */
  _noteHouseholdCash(delta) {
    if (!delta) return;
    this.householdCashLedger = (this.householdCashLedger || 0) + delta;
  }

  ensureCitizenFinance(profile) {
    if (!profile) return null;
    const seed = Number.isFinite(profile.cash) ? profile.cash : Number(profile.wealth) || 0;
    // A normalisation of an existing figure, not a movement of money, so the
    // conservation memo is deliberately untouched here.
    profile.cash = seed;
    // Savings at the bank, distinct from the spendable wallet.
    //
    // Defaulted to ZERO rather than seeded from `financialAssets`. It used to be
    // `??= Number(profile.financialAssets) || 0`, which handed any profile
    // arriving without a `deposits` field a savings balance the bank had never
    // received — free purchasing power, and a bank whose liability did not match
    // the households claiming it. Fresh profiles set `deposits` explicitly in
    // citizenProfile, so nothing legitimate depended on the fallback.
    profile.deposits ??= 0;
    profile.wealth = this.liquidWealth(profile);
    profile.grossIncome ??= 0;
    profile.disposableIncome ??= 0;
    profile.consumption ??= 0;
    profile.housingCost ??= 0;
    profile.taxPaid ??= 0;
    profile.debt ??= 0;
    profile.propertyValue ??= 0;
    this.syncFinancialAssets(profile);
    profile.netWorth = this.netWorthOf(profile);
    profile.employmentStatus ??= profile.age < 18 || profile.age >= 66 ? 'not_in_labor_force' : 'unemployed';
    return profile;
  }

  /** Everything a household could spend today: wallet plus banked savings. */
  liquidWealth(profile) {
    return (profile.cash || 0) + (profile.deposits || 0);
  }

  /** Assets less liabilities — the number a household is actually worth. */
  netWorthOf(profile) {
    return this.liquidWealth(profile) + (profile.propertyValue || 0) - (profile.debt || 0);
  }

  /**
   * Keep `financialAssets` in step with `deposits`. It is a mirror, not a
   * second source of truth: several systems read `financialAssets` for a
   * household's non-cash wealth, and letting the two drift apart would make net
   * worth depend on which field a caller happened to read.
   */
  syncFinancialAssets(profile) {
    profile.financialAssets = profile.deposits || 0;
    return profile;
  }

  /**
   * Bank cash into savings. This is a real transfer between two accounts — the
   * household's wallet and the bank — so it goes through the ledger, which keeps
   * money conserved. The bank's `deposits` liability and the household's
   * `deposits` balance are then updated as MEMOS of where that money now sits;
   * they move no money themselves, so they cannot break the invariant.
   *
   * Phase 1 pays no interest (see ECON.banking): paying it would mean the bank
   * creates credit instead of moving money.
   */
  depositFor(citizen, amount) {
    const p = this.ensureCitizenFinance(citizen?.p);
    if (!p) return { ok: false, reason: 'no_profile' };
    const value = Math.min(finiteAmount(amount), p.cash);
    if (value <= 0) return { ok: false, reason: 'insufficient_cash' };
    const result = this.transfer({
      from: { sector: SECTOR.HOUSEHOLD, id: p.id },
      to: 'bank',
      amount: value,
      category: 'deposit',
      metadata: { household: p.id }
    });
    if (!result.ok) return result;
    p.deposits = (p.deposits || 0) + value;
    this.accounts.bank.deposits += value;
    this.syncFinancialAssets(p);
    p.wealth = this.liquidWealth(p);
    p.netWorth = this.netWorthOf(p);
    return { ok: true, amount: value, deposits: p.deposits };
  }

  /**
   * Draw savings back into the wallet. The only sanctioned way to reverse a
   * deposit, and the one a large purchase (a vehicle, say) has to go through —
   * which is what stops such a purchase from silently raiding savings the
   * household never agreed to spend.
   */
  withdrawFor(citizen, amount) {
    const p = this.ensureCitizenFinance(citizen?.p);
    if (!p) return { ok: false, reason: 'no_profile' };
    const value = Math.min(finiteAmount(amount), p.deposits || 0);
    if (value <= 0) return { ok: false, reason: 'insufficient_savings' };
    const result = this.transfer({
      from: 'bank',
      to: { sector: SECTOR.HOUSEHOLD, id: p.id },
      amount: value,
      category: 'withdrawal',
      metadata: { household: p.id }
    });
    if (!result.ok) return result;
    p.deposits -= value;
    this.accounts.bank.deposits = Math.max(0, this.accounts.bank.deposits - value);
    this.syncFinancialAssets(p);
    p.wealth = this.liquidWealth(p);
    p.netWorth = this.netWorthOf(p);
    return { ok: true, amount: value, deposits: p.deposits };
  }

  /**
   * How much a household could raise right now, savings included. This is the
   * number a purchase has to be able to cover, and it is deliberately NOT
   * `p.cash`: a household with $50 in the wallet and $9,000 banked can afford a
   * car, it just has to draw the money down first.
   */
  purchasingPower(citizen) {
    const p = citizen?.p;
    if (!p) return 0;
    return this.liquidWealth(p);
  }

  /**
   * Move a household's spending surplus from its wallet into savings.
   *
   * Called at the day boundary. The floor is what stops this from starving a
   * household's day-to-day spending, and the rate keeps the sweep gradual so a
   * single good day does not empty the wallet.
   */
  sweepSavings(citizen) {
    const p = this.ensureCitizenFinance(citizen?.p);
    if (!p) return { ok: false, reason: 'no_profile' };
    const surplus = p.cash - ECON.banking.liquidFloor;
    if (surplus <= 0) return { ok: false, reason: 'no_surplus' };
    return this.depositFor(citizen, surplus * ECON.banking.savingsRate);
  }

  /**
   * A named private proprietor. The business used to be its own owner
   * (`ownerId === id`), which is why nothing in the town could ever decide
   * anything: ownership existed on paper and no counterparty held it. The owner
   * is a separate party who holds the equity, pays the wages, and answers for
   * the firm's debt — so "the owner cannot fund payroll" is a real state with a
   * cause, not a comment.
   *
   * The name is derived from the business id, not drawn from `this.rng`: a
   * proprietor appearing must not shift the economy's random stream, or every
   * downstream figure in the sim moves for a reason that has nothing to do with
   * money.
   */
  createOwner(business) {
    const seed = hashId(business.id);
    const first = OWNER_NAMES[seed % OWNER_NAMES.length];
    const last = OWNER_SURNAMES[(seed >>> 8) % OWNER_SURNAMES.length];
    return {
      id: `owner-${business.id}`,
      name: `${first} ${last}`,
      businessId: business.id,
      sector: SECTOR.BUSINESS,
      cash: 0,
      credit: ECON.business.ownerCredit
    };
  }

  createBusiness(building) {
    this.ensureBuildingIdentity(building);
    const id = building.businessId || this.nextId('business');
    building.businessId = id;
    const governmentOwned = isGovernmentBuilding(building);
    const type = building.purpose === 'industrial'
      ? 'industry'
      : building.kind === 'office'
        ? 'office'
        : (building.kind === 'hotel' || building.kind === 'resort' || building.tourism || building.house?.spec?.tourism)
          ? 'lodging'
        : building.kind === 'shop' || building.zone === ZONE.COMMERCIAL ? 'retail' : 'services';
    const propertyValue = this.propertyValue(building);
    const owner = governmentOwned ? null : this.createOwner({ id });
    const business = {
      id, sector: SECTOR.BUSINESS, building, buildingId: building.id,
      ownerId: governmentOwned ? 'government' : owner.id,
      owner,
      // A public works still has a business ledger for inventory and output,
      // but its operating employer is the state.  Keeping that distinction
      // prevents syncEntities() from silently turning a public factory into a
      // private firm and lets payroll use the government account.
      operatorSector: governmentOwned ? SECTOR.GOVERNMENT : SECTOR.BUSINESS,
      operatorId: governmentOwned ? 'government' : id,
      equityInvestor: governmentOwned ? 'government' : 'developer',
      name: building.name || `${businessLabel(building)} ${id.split('-').pop()}`, type,
      cash: 0,
      inventory: type === 'industry' ? {} : { goods: ECON.business.retailOpeningInventory },
      fixedCapital: propertyValue, propertyValue, debt: 0, revenue: 0, wageExpense: 0,
      inputExpense: 0, rentExpense: 0, utilityExpense: 0, interestExpense: 0,
      depreciationExpense: 0, taxExpense: 0, municipalExpense: 0, profit: 0, retainedEarnings: 0,
      employees: 0, jobsRequired: 0, staffNeed: 0, vacancies: 0, customers: 0,
      rent: 0, open: true, status: 'active', production: 0, productionFactor: 0, utilityFactor: 1,
      rooms: Math.max(0, Math.floor(Number(building.tourism?.rooms || building.house?.spec?.tourism?.rooms) || 0)),
      rate: Math.max(0, Number(building.tourism?.nightlyRate || building.house?.spec?.tourism?.nightlyRate) || 0),
      tourismRevenue: 0
    };
    if (governmentOwned) {
      building.ownerType = SECTOR.GOVERNMENT;
      building.ownerId = 'government';
      building.owner = 'state';
    } else {
      building.ownerType = SECTOR.BUSINESS;
      building.ownerId = id;
      building.owner = 'private';
    }
    this.businessesById.set(id, business);
    if (owner) this.ownersById.set(owner.id, owner);
    for (const [commodity, quantity] of Object.entries(business.inventory))
      this.inventoryExpected.set(`${id}:${commodity}`, quantity);
    // Public works already received their capital through project finance; do
    // not charge the treasury a second private-style startup float when the
    // economy merely registers the building. Private firms retain the normal
    // developer injection and bounded loan fallback.
    const openingCash = governmentOwned ? 0 : ECON.business.startupCash;
    const capital = openingCash
      ? this.transfer({
          from: 'developer', to: { sector: SECTOR.BUSINESS, id }, amount: openingCash,
          category: 'capital_injection', metadata: { businessId: id, ownerId: business.ownerId, openingBalance: true, governmentOwned }
        })
      : { ok: true };
    // A public works must not quietly borrow as a private firm when the
    // treasury cannot fund its operating float.  Private businesses retain
    // their existing bounded owner loan fallback.
    if (!capital.ok && !governmentOwned) this.issueLoan({ sector: SECTOR.BUSINESS, id }, ECON.business.startupCash);
    return business;
  }

  syncEntities() {
    const live = new Set();
    for (const building of this.town.buildings || []) {
      this.ensureBuildingIdentity(building);
      if (building.purpose !== 'commercial' && building.purpose !== 'industrial') continue;
      let business = building.businessId ? this.businessesById.get(building.businessId) : null;
      if (!business) business = this.createBusiness(building);
      business.building = building;
      business.buildingId = building.id;
      business.open = true;
      if (business.status === 'closed') business.status = 'active';
      if (business.type === 'lodging') {
        business.rooms = Math.max(0, Math.floor(Number(building.tourism?.rooms || building.house?.spec?.tourism?.rooms || business.rooms) || 0));
        business.rate = Math.max(0, Number(building.tourism?.nightlyRate || building.house?.spec?.tourism?.nightlyRate || business.rate) || 0);
      }
      live.add(business.id);
    }
    for (const business of this.businessesById.values()) {
      if (!live.has(business.id) && business.open) {
        business.open = false;
        business.status = 'closed';
        business.building = null;
        if (!this.closedBusinesses.includes(business)) this.closedBusinesses.push(business);
      }
    }
    this.businesses = [...this.businessesById.values()].filter((b) => b.open);
    this.bizCount = (this.town.buildings || []).length;
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const profile = this.ensureCitizenFinance(citizen.p);
      if (!this.registeredCitizens.has(profile.id)) {
        // Zeroing the balance is a normalisation, not a movement: the opening
        // cash was never in the memo, because founding a citizen writes `p.cash`
        // directly. The transfer below re-issues it from `external` and THAT is
        // what puts it into the memo, through the account setter.
        const openingCash = profile.cash;
        profile.cash = 0;
        profile.wealth = 0;
        this.registeredCitizens.add(profile.id);
        if (openingCash > 0) this.transfer({
          from: 'external', to: { sector: SECTOR.HOUSEHOLD, id: profile.id }, amount: openingCash,
          category: 'immigration_capital_inflow', metadata: { citizenId: profile.id, openingBalance: true }
        });
      }
    }
    for (const household of this.town.pedestrians?.households || []) {
      if (!household.id) household.id = this.town.nextEntityId ? this.town.nextEntityId('household') : this.nextId('household');
      if (household.home) {
        this.ensureBuildingIdentity(household.home);
        if (household.home.ownerType === 'developer') {
          household.home.ownerType = SECTOR.HOUSEHOLD;
          household.home.ownerId = household.id;
        }
        const members = household.members || [];
        const share = members.length ? this.propertyValue(household.home) / members.length : 0;
        for (const member of members) {
          this.ensureCitizenFinance(member.p);
          member.p.propertyValue = share;
          member.p.netWorth = this.netWorthOf(member.p);
        }
      }
    }
    this.assessed = (this.town.buildings || []).reduce((s, b) => s + this.propertyValue(b), 0);
    return this.businesses;
  }

  rebuild() { this.syncEntities(); this.computeLandValues(); return this.businesses; }

  _account(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') {
      if (ref === 'treasury' || ref === 'government') ref = { sector: SECTOR.GOVERNMENT, id: 'government' };
      else if (ref === 'bank') ref = { sector: SECTOR.BANK, id: 'bank' };
      else if (ref === 'external') ref = { sector: SECTOR.EXTERNAL, id: 'external' };
      else if (ref === 'developer') ref = { sector: SECTOR.DEVELOPER, id: 'developer' };
      else if (ref === 'reserve') ref = { sector: SECTOR.RESERVE, id: 'reserve' };
      else if (ref === 'contractor') ref = { sector: SECTOR.BUSINESS, id: 'contractor' };
      else { const [sector, ...id] = ref.split(':'); ref = { sector, id: id.join(':') }; }
    }
    if (ref.p) ref = { sector: SECTOR.HOUSEHOLD, id: ref.p.id };
    if (ref.buildingId && ref.cash != null) ref = { sector: SECTOR.BUSINESS, id: ref.id };
    const sector = ref.sector || ref.ownerType || ref.type;
    const id = ref.id || ref.ownerId;
    if (sector === SECTOR.GOVERNMENT) {
      const a = this.accounts.government;
      return { key: 'government:government', sector, id: 'government', object: a, get balance() { return a.cash; }, set balance(v) { a.cash = v; } };
    }
    if (sector === SECTOR.BANK) {
      const a = this.accounts.bank;
      return { key: 'bank:bank', sector, id: 'bank', object: a, get balance() { return a.cash; }, set balance(v) { a.cash = v; a.reserves = v; } };
    }
    if (sector === SECTOR.EXTERNAL) {
      const a = this.accounts.external;
      return { key: 'external:external', sector, id: 'external', object: a, get balance() { return a.cash; }, set balance(v) { a.cash = v; } };
    }
    if (sector === SECTOR.DEVELOPER) {
      const a = this.accounts.developer;
      return { key: 'developer:developer', sector, id: 'developer', object: a, get balance() { return a.cash; }, set balance(v) { a.cash = v; } };
    }
    if (sector === SECTOR.RESERVE) {
      const system = this;
      return { key: 'reserve:reserve', sector, id: 'reserve', object: system,
        get balance() { return system.reserve; }, set balance(v) { system.reserve = v; } };
    }
    if (sector === SECTOR.BUSINESS && id === 'contractor') {
      const a = this.accounts.contractor;
      return { key: 'business:contractor', sector, id, object: a, get balance() { return a.cash; }, set balance(v) { a.cash = v; } };
    }
    if (sector === SECTOR.BUSINESS) {
      const b = this.businessesById.get(id);
      if (!b) return null;
      return { key: `business:${id}`, sector, id, object: b, get balance() { return b.cash; }, set balance(v) { b.cash = v; } };
    }
    if (sector === SECTOR.HOUSEHOLD) {
      const citizen = (this.town.pedestrians?.citizens || []).find((c) => c.p.id === id);
      if (!citizen) return null;
      const p = this.ensureCitizenFinance(citizen.p);
      // `this` inside a getter/setter defined in an object literal is the
      // object, not the economy — so the system is captured explicitly. The old
      // inline arithmetic got away with it only because it never called out.
      const sys = this;
      // `balance` is the SPENDABLE wallet, deliberately not liquid wealth. A
      // transfer that debits this account — buying groceries, paying rent —
      // must not help itself to savings the household never chose to spend;
      // drawing on those is an explicit `withdrawFor` instead.
      //
      // The memo is adjusted HERE, in the one place a household balance can
      // change through the ledger, so `_moneyTotal` cannot drift from the sum
      // of what households actually hold — including a household that has been
      // removed from the roster.
      return { key: `household:${id}`, sector, id, object: p,
        get balance() { return p.cash; },
        set balance(v) {
          const before = p.cash;
          p.cash = v;
          sys._noteHouseholdCash(v - before);
          p.wealth = sys.liquidWealth(p);
          p.netWorth = sys.netWorthOf(p);
        }
      };
    }
    return null;
  }

  _allInternalAccounts() {
    const out = [this._account('government'), this._account('bank'), this._account('developer'), this._account('contractor')];
    for (const b of this.businessesById.values()) out.push(this._account({ sector: SECTOR.BUSINESS, id: b.id }));
    for (const c of this.town.pedestrians?.citizens || []) out.push(this._account({ sector: SECTOR.HOUSEHOLD, id: c.p.id }));
    return out.filter(Boolean);
  }
  /**
   * Total money in the town, as the ledger claims it.
   *
   * Households are counted from a MEMO, not by enumerating the live roster.
   * The roster version had a hole the audit found by execution: a citizen who
   * left the town stopped being enumerated, so their cash vanished from this
   * total while `expectedMoney` — a single scalar that only moves through
   * `transfer` — was untouched. Both sides dropped by the same amount, and the
   * conservation check read **clean**. A $50,000 disappearance audited as
   * `ok: true`. `settleEstate` makes the in-tree removal path honest, but a
   * conservation check that any `splice` can silence is not a check.
   *
   * The memo is maintained in one place: the household account's balance
   * setter, which every transfer to or from a household must go through.
   */
  _moneyTotal() {
    let sum = 0;
    for (const a of this._allInternalAccounts()) {
      // Skip households here — they are summed from the memo below, so counting
      // them here as well would double them.
      if (a.sector === SECTOR.HOUSEHOLD) continue;
      sum += a.balance;
    }
    return sum + (this.householdCashLedger || 0) + (this.reserve || 0);
  }
  _resetExpectedMoney() { if (this.accounts) this.expectedMoney = this._moneyTotal(); }
  _adjustExpectedInventory(businessId, commodity, delta) {
    const key = `${businessId}:${commodity}`;
    this.inventoryExpected.set(key, (this.inventoryExpected.get(key) || 0) + delta);
  }
  _resetInventoryExpected() {
    this.inventoryExpected.clear();
    for (const business of this.businessesById.values())
      for (const [commodity, quantity] of Object.entries(business.inventory || {}))
        this.inventoryExpected.set(`${business.id}:${commodity}`, quantity);
  }

  _trackPeriod(category, amount) {
    this.period.categories[category] = (this.period.categories[category] || 0) + amount;
    if (category === 'income_tax') this.period.incomeTax += amount;
    if (category === 'sales_tax') this.period.salesTax += amount;
    if (category === 'property_tax') this.period.propertyTax += amount;
    if (category === 'corporate_tax') this.period.corporateTax += amount;
    const municipalCategory = {
      transit_fare: 'transitFare',
      business_license: 'businessLicense',
      land_lease: 'landLease',
      tourism_tax: 'tourismTax',
      utility_fee: 'utilityFee'
    }[category];
    if (municipalCategory) {
      this.period[municipalCategory] += amount;
      this.period.municipalRevenue += amount;
    }
    if (['income_tax', 'sales_tax', 'property_tax', 'corporate_tax', 'permit_fee', 'foreign_tax', 'transit_fare', 'business_license', 'land_lease', 'tourism_tax', 'utility_fee'].includes(category)) this.period.governmentRevenue += amount;
    if (['government_procurement', 'government_payroll'].includes(category)) { this.period.governmentConsumption += amount; this.period.governmentExpenditure += amount; this.period.spending += amount; }
    if (category === 'public_investment') { this.period.governmentInvestment += amount; this.period.governmentExpenditure += amount; this.period.spending += amount; }
    if (['subsidy', 'welfare', 'pension', 'bond_interest'].includes(category)) { this.period.governmentExpenditure += amount; this.period.spending += amount; }
    if (category === 'private_investment' || category === 'permit_fee' || category === 'foreign_investment') this.period.privateFixedInvestment += amount;
    if (category === 'export') this.period.exports += amount;
    if (category === 'import') this.period.imports += amount;
  }

  _notePaymentFailure(row) {
    const required = new Set([
      'government_procurement', 'government_payroll', 'public_investment',
      'pension', 'welfare', 'bond_interest', 'bond_repayment', 'reserve_allocation'
    ]);
    if (!required.has(row.category)) return;
    const purpose = row.metadata?.purpose || row.category;
    const key = `${row.tick}:${row.category}:${purpose}:${row.reason}`;
    if (this.paymentFailureWarnings.has(key)) return;
    this.paymentFailureWarnings.add(key);
    if (this.paymentFailureWarnings.size > 5000) {
      const first = this.paymentFailureWarnings.values().next().value;
      this.paymentFailureWarnings.delete(first);
    }
    this.note(`Required payment failed: ${row.category} (${row.reason}).`, 'fiscal', 'warning');
  }

  _applyBusinessFlow(from, to, amount, category) {
    if (to?.sector === SECTOR.BUSINESS && ['purchase', 'export', 'government_procurement'].includes(category) && to.id !== 'contractor') {
      to.object.revenue += amount;
      this.period.businessRevenue += amount;
    }
    if (from?.sector === SECTOR.BUSINESS && from.id !== 'contractor') {
      if (category === 'wage' || category === 'income_tax') from.object.wageExpense += amount;
      else if (category === 'import') from.object.inputExpense += amount;
      else if (category === 'rent') from.object.rentExpense += amount;
      else if (category === 'interest') from.object.interestExpense += amount;
      else if (category === 'corporate_tax') from.object.taxExpense += amount;
      else if (['business_license', 'land_lease', 'tourism_tax', 'utility_fee'].includes(category)) from.object.municipalExpense += amount;
    }
  }

  transfer({ from, to, amount, category = 'transfer', metadata = {} }) {
    const value = finiteAmount(amount);
    // `TRANSACTION_CATEGORIES` is the ledger's declared vocabulary, and until
    // now nothing read it: a typo'd or invented category sailed straight into
    // the ledger and then vanished from every category total, with no error.
    // A 34-item allowlist nothing enforces is a trap for whoever adds the 35th
    // category, so the ledger checks itself. `report_reversal` is the one
    // bookkeeping-only category, used by a reversal to mirror an original
    // transfer's category.
    if (!LEDGER_CATEGORIES.has(category)) {
      const row = { id: `rejected-${this.ids.transaction++}`, tick: this.lastDay, from, to, amount, category, reason: 'unknown_category', metadata };
      this.rejectedTransactions.push(row);
      this._notePaymentFailure(row);
      if (this.rejectedTransactions.length > 100) this.rejectedTransactions.shift();
      return { ok: false, reason: 'unknown_category', transaction: row };
    }
    const payer = this._account(from);
    const receiver = this._account(to);
    const reject = (reason) => {
      const row = { id: `rejected-${this.ids.transaction++}`, tick: this.lastDay, from, to, amount, category, reason, metadata };
      this.rejectedTransactions.push(row);
      this._notePaymentFailure(row);
      if (this.rejectedTransactions.length > 100) this.rejectedTransactions.shift();
      return { ok: false, reason, transaction: row };
    };
    if (!value) return reject('invalid_amount');
    if (!payer || !receiver) return reject('invalid_account');
    if (payer.key === receiver.key) return reject('same_account');
    // Keep the operating floor meaningful.  Before this guard, daily public
    // services, state fleet upkeep, payroll and pensions could spend the
    // treasury all the way to zero even though project finance correctly
    // reserved a runway.  The result was a town that passed every individual
    // affordability check and still became insolvent over a long horizon.
    // Deliberate emergency/debt actions may opt out explicitly; ordinary
    // operations must wait for tax inflows or a reserve transfer.
    const floorProtected = payer.sector === SECTOR.GOVERNMENT &&
      ['government_procurement', 'government_payroll', 'public_investment', 'pension', 'welfare', 'subsidy'].includes(category) &&
      !metadata.allowBelowOperatingFloor;
    if (floorProtected && payer.balance - value < ECON.government.reserveOperatingFloor) {
      return reject('operating_reserve_floor');
    }
    const mayOverdraw = payer.sector === SECTOR.EXTERNAL || (payer.sector === SECTOR.BANK && metadata.creditCreation);
    if (!mayOverdraw && payer.balance + 1e-8 < value) return reject('insufficient_funds');
    const fromBefore = payer.balance;
    const toBefore = receiver.balance;
    payer.balance = fromBefore - value;
    receiver.balance = toBefore + value;
    const transaction = {
      id: `tx-${this.ids.transaction++}`, tick: this.lastDay,
      from: { sector: payer.sector, id: payer.id }, to: { sector: receiver.sector, id: receiver.id },
      amount: value, debit: value, credit: value, category, metadata,
      balances: { fromBefore, fromAfter: payer.balance, toBefore, toAfter: receiver.balance }
    };
    this.ledger.push(transaction);
    if (this.ledger.length > 10000) this.ledger.splice(0, this.ledger.length - 10000);
    this._trackPeriod(category, value);
    if (metadata.physicalTrade && receiver.sector === SECTOR.EXTERNAL) this.period.imports += value;
    if (metadata.physicalTrade && payer.sector === SECTOR.EXTERNAL) this.period.exports += value;
    this._applyBusinessFlow(payer, receiver, value, category);
    if (payer.sector === SECTOR.EXTERNAL && receiver.sector !== SECTOR.EXTERNAL) this.expectedMoney += value;
    if (receiver.sector === SECTOR.EXTERNAL && payer.sector !== SECTOR.EXTERNAL) this.expectedMoney -= value;
    if (metadata.creditCreation) this.expectedMoney += value;
    return { ok: true, transaction };
  }

  payWage(citizen, gross, employer = null) {
    const p = citizen?.p || citizen;
    if (!p?.id) return { ok: false, reason: 'invalid_worker' };
    this.ensureCitizenFinance(p);
    const grossWage = finiteAmount(gross);
    const payer = employer || { sector: SECTOR.GOVERNMENT, id: 'government' };
    const account = this._account(payer);
    if (!grossWage || !account || account.balance < grossWage) {
      p.employmentStatus = 'unemployed';
      // Arrears is a *firm's* state, not the contractor account's.
      if (account?.sector === SECTOR.BUSINESS && account.id !== 'contractor') account.object.status = 'payroll_arrears';
      this.note(`${account?.object?.name || 'Employer'} cannot fund payroll for ${p.name}.`, 'payroll', 'warning');
      return { ok: false, reason: 'unfunded_wage' };
    }
    const tax = Math.round(grossWage * ECON.tax.income * this.policyTaxScale() * 100) / 100;
    const net = grossWage - tax;
    const category = account.sector === SECTOR.GOVERNMENT ? 'government_payroll' : 'wage';
    // Payroll is an existing public obligation. The reserve guard prevents
    // creating new public posts, but once a worker is employed the government
    // must settle that day's wage rather than silently leaving an unpaid
    // worker on the roster. The account balance check above still prevents an
    // actual overdraft; only the discretionary runway floor is bypassed.
    const wage = this.transfer({ from: payer, to: { sector: SECTOR.HOUSEHOLD, id: p.id }, amount: grossWage, category, metadata: {
      workerId: p.id, gross: grossWage, net, tax,
      ...(account.sector === SECTOR.GOVERNMENT ? { allowBelowOperatingFloor: true } : {})
    } });
    if (!wage.ok) return wage;
    const taxTx = this.transfer({ from: { sector: SECTOR.HOUSEHOLD, id: p.id }, to: 'government', amount: tax, category: 'income_tax', metadata: { taxpayerId: p.id, employerId: account.id, gross: grossWage } });
    if (!taxTx.ok) return taxTx;
    p.grossIncome += grossWage;
    p.disposableIncome += net;
    p.taxPaid += tax;
    this.period.wages += grossWage;
    if (account.sector === SECTOR.BUSINESS) account.object.status = 'active';
    return { ok: true, gross: grossWage, net, tax, transactions: [wage.transaction, taxTx.transaction] };
  }

  purchase({ buyer, seller, amount = null, quantity = 1, unitPrice = null, commodity = 'goods', taxable = true }) {
    const buyerRef = buyer?.p ? { sector: SECTOR.HOUSEHOLD, id: buyer.p.id } : buyer;
    const sellerRef = seller?.id && this.businessesById.has(seller.id) ? { sector: SECTOR.BUSINESS, id: seller.id } : seller;
    const buyerAccount = this._account(buyerRef);
    const sellerAccount = this._account(sellerRef);
    if (!buyerAccount || !sellerAccount) return { ok: false, reason: 'invalid_account' };
    const sellerBusiness = sellerAccount.sector === SECTOR.BUSINESS ? sellerAccount.object : null;
    const available = sellerBusiness && commodity ? Number(sellerBusiness.inventory[commodity] || 0) : Infinity;
    const requested = Math.max(0, Number(quantity) || 0);
    const price = finiteAmount(unitPrice || (amount && requested ? amount / requested : amount));
    if (!price || !requested) return { ok: false, reason: 'invalid_purchase' };
    const qty = Math.min(requested, available, Math.floor(buyerAccount.balance / price));
    if (qty <= 0) return { ok: false, reason: available <= 0 ? 'inventory_shortage' : 'insufficient_funds' };
    const total = Math.round(qty * price * 100) / 100;
    const salesRate = taxable ? ECON.tax.sales * this.policyTaxScale() : 0;
    const tax = Math.round((total * salesRate / (1 + salesRate)) * 100) / 100;
    const net = total - tax;
    const sale = this.transfer({ from: buyerRef, to: sellerRef, amount: net, category: 'purchase', metadata: { buyerId: buyerAccount.id, sellerId: sellerAccount.id, commodity, quantity: qty, unitPrice: price } });
    if (!sale.ok) return sale;
    const taxTx = tax > 0 ? this.transfer({ from: buyerRef, to: 'government', amount: tax, category: 'sales_tax', metadata: { taxpayerId: buyerAccount.id, sellerId: sellerAccount.id, commodity, quantity: qty } }) : null;
    if (taxTx && !taxTx.ok) return taxTx;
    if (sellerBusiness && commodity) {
      sellerBusiness.inventory[commodity] -= qty;
      this._adjustExpectedInventory(sellerBusiness.id, commodity, -qty);
    }
    if (buyerAccount.sector === SECTOR.HOUSEHOLD) { buyerAccount.object.consumption += total; this.period.householdConsumption += total; }
    this.period.sales += total;
    return { ok: true, quantity: qty, total, net, tax, transaction: sale.transaction, taxTransaction: taxTx?.transaction || null };
  }

  buyInventory({ buyer, seller, commodity, quantity, unitPrice }) {
    const buyerAccount = this._account(buyer);
    const sellerAccount = this._account(seller);
    if (!buyerAccount || !sellerAccount || buyerAccount.sector !== SECTOR.BUSINESS || sellerAccount.sector !== SECTOR.BUSINESS)
      return { ok: false, reason: 'invalid_supply_chain_parties' };
    const available = sellerAccount.object.inventory[commodity] || 0;
    const qty = Math.min(Math.max(0, Number(quantity) || 0), available);
    const total = qty * finiteAmount(unitPrice);
    if (!qty || !total) return { ok: false, reason: available <= 0 ? 'inventory_shortage' : 'invalid_purchase' };
    const paid = this.transfer({ from: buyer, to: seller, amount: total, category: 'purchase',
      metadata: { buyerId: buyerAccount.id, sellerId: sellerAccount.id, commodity, quantity: qty, unitPrice, intermediate: true } });
    if (!paid.ok) return paid;
    sellerAccount.object.inventory[commodity] -= qty;
    buyerAccount.object.inventory[commodity] = (buyerAccount.object.inventory[commodity] || 0) + qty;
    buyerAccount.object.inputExpense += total;
    this._adjustExpectedInventory(sellerAccount.id, commodity, -qty);
    this._adjustExpectedInventory(buyerAccount.id, commodity, qty);
    return { ok: true, quantity: qty, total, transaction: paid.transaction };
  }

  ownerAccount(building) {
    if (!building) return null;
    this.ensureBuildingIdentity(building);
    if (building.ownerType === SECTOR.GOVERNMENT) return { sector: SECTOR.GOVERNMENT, id: 'government' };
    if (building.ownerType === SECTOR.BUSINESS) return { sector: SECTOR.BUSINESS, id: building.ownerId };
    if (building.ownerType === SECTOR.HOUSEHOLD) {
      const household = (this.town.pedestrians?.households || []).find((h) => h.id === building.ownerId);
      const citizen = household?.members?.[0];
      return citizen ? { sector: SECTOR.HOUSEHOLD, id: citizen.p.id } : { sector: SECTOR.DEVELOPER, id: 'developer' };
    }
    return { sector: SECTOR.DEVELOPER, id: 'developer' };
  }

  payRent(citizen, building, amount) {
    const p = citizen?.p || citizen;
    const owner = this.ownerAccount(building);
    if (!p?.id || !owner) return { ok: false, reason: 'invalid_rent_parties' };
    if (owner.sector === SECTOR.HOUSEHOLD && owner.id === p.id) return { ok: false, reason: 'owner_occupied' };
    const result = this.transfer({ from: { sector: SECTOR.HOUSEHOLD, id: p.id }, to: owner, amount, category: 'rent', metadata: { tenantId: p.id, buildingId: building.id, ownerId: owner.id } });
    if (result.ok) { p.housingCost += amount; this.period.rent += amount; }
    return result;
  }

  propertyValue(building) {
    if (!building) return 0;
    const replacement = (ASSESS[building.purpose] ?? 40000) * Math.max(1, building.footprint?.length || 1);
    const cell = building.cell || [0, 0];
    const land = this.landValue ? this.landValueAt(cell[0], cell[1]) : 0.5;
    const quality = 1 + Math.max(0, (building.budget || 1) - 1) * ECON.property.qualityPerBudgetTier;
    const access = this.town.roadNeighborOf?.(cell[0], cell[1]) ? 1.05 : 0.8;
    return Math.round(replacement * (0.65 + land * ECON.property.landWeight) * quality * access);
  }

  assessPropertyTaxes() {
    const rate = ECON.tax.property * this.policyTaxScale() / 365;
    for (const building of this.town.buildings || []) {
      this.ensureBuildingIdentity(building);
      if (building.ownerType === SECTOR.GOVERNMENT) continue;
      const owner = this.ownerAccount(building);
      const value = this.propertyValue(building) * (1 + (this.policyPropertyBase || 0)) * this.jurisdictionRatio();
      const due = Math.round(value * rate * 100) / 100;
      if (due) this.transfer({ from: owner, to: 'government', amount: due, category: 'property_tax', metadata: { taxpayerId: owner.id, buildingId: building.id, assessedValue: value } });
    }
  }

  policyTaxScale() { return this.taxScale * (1 + (this.policyTax || 0)); }
  setTax(scale) {
    const next = Math.round(Math.max(0.5, Math.min(1.5, scale)) * 100) / 100;
    if (next !== this.taxScale) this.note(`Council sets the tax rate to ${Math.round(next * 100)}% of the base rate.`, 'policy');
    this.taxScale = next;
    return next;
  }
  jurisdictionRatio() { const j = this.town.policy?.computeJurisdiction?.(); return j ? j.ratio : 1; }

  /**
   * How many people a building needs to run it.
   *
   * This used to divide the building's CAPACITY by a flat 70, which is why the
   * numbers looked absurd: capacity means different things for different
   * buildings (desks for an office, stock for a shop, beds for a house, visitors
   * for a clinic), so the same divisor produced nonsense. A six-storey office
   * with 64 desks came out at 1 staff — one person running sixty-four desks —
   * while a civic building with a larger capacity number got four. Staffing was
   * tracking the wrong quantity.
   *
   * It now scales with FLOOR AREA, which is the thing that actually takes
   * people: footprint x storeys, at one person per `AREA_PER_STAFF` square metre.
   * That is monotone in both dimensions, so a bigger building always needs more
   * staff and a taller one always needs more, and a single shop and a six-storey
   * block can no longer both come out as 1.
   *
   * Area is read from the built spec where it exists and falls back to the
   * building's recorded footprint, so a building raised before this rule — or one
   * from a path that does not carry a spec — still gets a sensible count rather
   * than zero.
   */
  staffNeeded(building) {
    if (!building) return 1;
    const spec = building.house?.spec || building.spec || null;
    const floors = Math.max(1, building.floors || spec?.floors || 1);
    const w = spec?.w || building.size?.w || 3.2;
    const d = spec?.d || building.size?.d || 2.8;
    const area = w * d * floors;
    const raw = area / AREA_PER_STAFF;
    // A building is never staffed by nobody, and the council's staffing policy
    // scales the whole requirement.
    return Math.max(1, Math.ceil(raw * (1 + (this.policyStaffFloor || 0))));
  }

  /** The floor area a single member of staff is responsible for, in m². */
  floorAreaOf(building) {
    const spec = building?.house?.spec || building?.spec || null;
    const floors = Math.max(1, building?.floors || spec?.floors || 1);
    const w = spec?.w || building?.size?.w || 3.2;
    const d = spec?.d || building?.size?.d || 2.8;
    return w * d * floors;
  }

  /**
   * Trades worked from home or the street (artist, writer, courier). They have
   * no employer to stand at, but they are not jobless either: they hold a job
   * id, draw a wage, and trade. Counting them in the labour force as
   * `unemployed` put a hard ~16% floor under the rate that no amount of
   * construction could move.
   */
  static selfEmployed(citizen) {
    const kind = citizen?.p?.job?.work;
    return kind === 'home' || kind === 'road';
  }

  /**
   * Owners hire, and they hire residents. For each open post, take an
   * UNEMPLACED local whose job kind suits the business — never a stranger,
   * never a worker already standing somewhere else, never an unqualified
   * citizen (the schooling gate is the same one `setJob` enforces).
   *
   * This is the pass that closes the loop `assignEmployees` used to leave
   * open: it counted the citizens who happened to be standing at a business
   * and never placed anyone, so a newly opened shop kept a vacancy forever and
   * the rate never moved.
   */
  /**
   * Re-post the townsfolk whose workplace vanished.
   *
   * A building is demolished with `c.work = null` left behind (`town.js`), and
   * nothing used to put the displaced worker anywhere: a civic clerk whose
   * town hall came down, or a farm hand whose site was cleared, stayed
   * unemployed for ever because only `assignWork` (spawn, graduation, resource
   * top-up) ever placed anyone. Their trade still has a kind, so the census can
   * find them a post — and must, or a demolition permanently deletes a job.
   */
  repostOrphans() {
    const ped = this.town.pedestrians;
    if (!ped?.pickGapBuilding) return 0;
    let reposted = 0;
    for (const citizen of ped.citizens || []) {
      const p = citizen.p;
      if (!p || p.age < 18 || p.age >= 66 || p.job?.id === 'retired') continue;
      const kind = p.job?.work;
      let post = null;
      if (kind === 'farm' || kind === 'power' || kind === 'fuel') {
        post = this.town.resources?.workplace?.(kind) || null;
      } else if (kind === 'civic') post = ped.pickGapBuilding(['civic', 'shop'], citizen);
      else if (kind === 'park') post = ped.pickGapBuilding(['park'], citizen);
      if (!post) continue;
      citizen.work = post;
      citizen.routeGoalKey = null;
      reposted++;
    }
    return reposted;
  }

  hireResidents(jobs) {
    const ped = this.town.pedestrians;
    if (!ped) return 0;
    // Idle = an unemployed adult local with no post. Self-employed home/road
    // trades are deliberately left alone: a vacancy must not erase an
    // independent livelihood merely to fill a roster.
    const idle = (ped.citizens || []).filter(
      (c) => c.p && c.p.age >= 18 && c.p.age < 66 && c.p.job?.id !== 'retired' && !c.work &&
        (c.p.employmentStatus === 'unemployed' || !c.p.employmentStatus) && !EconomySystem.selfEmployed(c)
    );
    if (!idle.length) return 0;
    let hired = 0;
    for (const job of jobs) {
      // `room` is what the firm has not yet got, counting who is already
      // standing there. This only POSTS a citizen — the headcount itself is
      // settled by the census in `assignEmployees`, which is the only place a
      // worker is ever turned into `business.employees`.
      let room = job.jobsRequired - (job.employees || 0);
      while (room > 0) {
        const index = idle.findIndex((c) => this.canHire(c, job, this.targetJobFor(c, job.building)));
        if (index < 0) break;
        const take = idle[index];
        const target = this.targetJobFor(take, job.building);
        if (!target || !this.canHire(take, job, target)) break;
        idle.splice(index, 1);
        const previous = take.p.job?.id;
        const changed = previous === target.id || setJob(take.p, target.id, this.rng);
        if (!changed) continue;
        take.work = job.building;
        take.routeGoalKey = null;
        this.lastHiring.local++;
        if (previous !== target.id) this.lastHiring.retrained++;
        if (job.operatorSector === SECTOR.GOVERNMENT || isGovernmentBuilding(job.building)) {
          this.lastHiring.public++;
          this.recordPublicHire(job.building);
        } else this.lastHiring.private++;
        room--;
        hired++;
      }
      if (!idle.length) break;
    }
    return hired;
  }

  /** Workplace kinds this citizen's trade can be posted to, widest first. */
  buildingKinds(p) {
    switch (p?.job?.work) {
      case 'shop': return ['shop', 'office', 'hotel', 'resort'];
      case 'office': return ['office', 'shop', 'hotel', 'resort'];
      case 'lodging': return ['hotel', 'resort'];
      case 'civic': return ['civic', 'shop'];
      case 'park': return ['park'];
      case 'industry': return ['factory'];
      default: return [];
    }
  }

  /**
   * Return the legal target role for an unemployed resident at a workplace.
   * The building advertises a job family; the citizen's education still
   * decides which role in that family is legal.
   */
  targetJobFor(citizen, building) {
    const p = citizen?.p;
    if (!p || !building) return null;
    const factoryId = this.town.industry?.typeOf?.(building)?.id || building.factoryType || building.subtype;
    const facility = building.facility || building.house?.spec?.facility;
    const civicRoles = facility && /school|college|university|campus/.test(facility)
      ? ['teacher', 'clerk']
      : facility && /clinic|hospital/.test(facility)
        ? ['nurse', 'clerk']
        : facility && /library|museum/.test(facility)
          ? ['librarian', 'clerk']
          : BUILDING_JOB_ROLES.civic;
    const roles = building.kind === 'factory'
      ? [FACTORY_JOB[factoryId] || 'assembler', 'assembler']
      : building.kind === 'civic'
        ? civicRoles
        : (BUILDING_JOB_ROLES[building.kind] || []);
    const eligible = qualifiedJobs(p.education?.level).filter((candidate) => roles.includes(candidate.id));
    if (!eligible.length) return null;
    // Preserve a compatible existing trade. A transfer is used only when the
    // unemployed resident needs a role for this vacancy.
    return eligible.find((candidate) => candidate.id === p.job?.id) || eligible[0];
  }

  /** Match local jobless residents to public civic vacancies before importing. */
  staffPublicCivic() {
    const ped = this.town.pedestrians;
    const rows = this.town.lifecycle?.civicStaffing?.()?.rows || [];
    if (!ped?.citizens || !rows.length) return 0;
    let hired = 0;
    for (const row of rows.sort((a, b) => b.open - a.open)) {
      if (row.open <= 0 || !this.publicPayrollCanExpand(row.building)) continue;
      let remaining = row.open;
      while (remaining > 0) {
        if (!this.publicPayrollCanExpand(row.building)) break;
        const candidate = ped.citizens.find((c) =>
          c.p && c.p.age >= 18 && c.p.age < 66 && c.p.job?.id !== 'retired' && !c.work &&
          (c.p.employmentStatus === 'unemployed' || !c.p.employmentStatus) && !EconomySystem.selfEmployed(c) &&
          this.targetJobFor(c, row.building)
        );
        if (!candidate) break;
        const target = this.targetJobFor(candidate, row.building);
        const previous = candidate.p.job?.id;
        if (!target || !(previous === target.id || setJob(candidate.p, target.id, this.rng))) break;
        candidate.work = row.building;
        candidate.routeGoalKey = null;
        this.recordPublicHire(row.building);
        this.lastHiring.local++;
        this.lastHiring.public++;
        if (previous !== target.id) this.lastHiring.retrained++;
        remaining--;
        hired++;
      }
    }
    return hired;
  }

  /** A post is open at this business for a legal target role. */
  canHire(citizen, job, targetJob = null) {
    const target = targetJob || this.targetJobFor(citizen, job?.building);
    if (!target || !qualifies(citizen.p.education?.level, target.id)) return false;
    if (job?.operatorSector === SECTOR.GOVERNMENT || isGovernmentBuilding(job?.building))
      return this.publicPayrollCanExpand(job.building);
    return this.ownerCanPay(job);
  }

  /** Do not add a public post when the next day's payroll would consume the
   * measured operating runway. Private payroll remains the owner's concern. */
  publicPayrollCanExpand(building) {
    const government = this._account('government');
    if (!government) return false;
    const dailyWage = this.publicDailyWage(building);
    return government.balance - this.publicHiringCommitted - dailyWage + 1e-8 >= this.requiredPublicReserve(0);
  }

  publicDailyWage(building) {
    return Math.max(ECON.wages.minimumAnnual, Number(building?.staffWage) || 0) / 365;
  }

  recordPublicHire(building) {
    this.publicHiringCommitted += this.publicDailyWage(building);
  }

  /**
   * An owner hires out of its own pocket. A business that cannot cover one more
   * day's wage does not advertise the post — the vacancy is real but unfunded,
   * which is what a payroll-arrears firm looks like from the outside. Credit is
   * the owner's own borrowing room, not the town's: it is the business-limit
   * multiple of its equity.
   */
  ownerCanPay(job) {
    if (job?.operatorSector === SECTOR.GOVERNMENT || isGovernmentBuilding(job?.building)) {
      const government = this._account('government');
      const dailyWage = Math.max(ECON.wages.minimumAnnual, Number(job?.building?.staffWage) || 0) / 365;
      return !!government && government.balance - dailyWage + 1e-8 >= ECON.government.reserveOperatingFloor;
    }
    const account = this._account({ sector: SECTOR.BUSINESS, id: job.id });
    if (!account) return true;
    if (account.balance > 0) return true;
    // The owner's own credit, measured against the equity behind the firm.
    const owner = job.owner || this.ownersById.get(job.ownerId);
    const equity = (job.fixedCapital || 0) - (job.debt || 0);
    const limit = (owner?.credit ?? ECON.business.ownerCredit) * equity;
    return equity > 0 && limit > 0;
  }

  /**
   * Staff state-owned factories without taking workers away from private
   * firms. A public works can recruit an unemployed local and, if the town has
   * a vacant home, bring in one credentialed newcomer. The cap keeps a single
   * newly opened works from importing its whole workforce in one tick.
   */
  staffPublicFactories(limit = 3) {
    const ped = this.town.pedestrians;
    if (!ped?.citizens) return 0;
    const factories = this.businesses
      .filter((business) => business.type === 'industry' && business.building && isGovernmentBuilding(business.building))
      .sort((a, b) => (b.jobsRequired - b.employees) - (a.jobsRequired - a.employees));
    if (!factories.length) return 0;

    let hired = 0;
    for (const business of factories) {
      if (!this.publicPayrollCanExpand(business.building)) continue;
      const target = Math.max(0, business.jobsRequired - ped.citizens.filter((c) => c.work === business.building &&
        c.p?.age >= 18 && c.p?.age < 66 && c.p?.job?.id !== 'retired').length);
      let remaining = target;
      const factoryId = this.town.industry?.typeOf?.(business.building)?.id;
      const preferred = FACTORY_JOB[factoryId] || 'assembler';
      while (remaining > 0 && hired < limit) {
        if (!this.publicPayrollCanExpand(business.building)) break;
        let candidate = ped.citizens.find((c) =>
          c.p && c.p.age >= 18 && c.p.age < 66 && c.p.job?.id !== 'retired' &&
          !c.work && (c.p.employmentStatus === 'unemployed' || !c.p.employmentStatus)
        );
        if (candidate) {
          const target = this.targetJobFor(candidate, business.building) ||
            (qualifies(candidate.p.education?.level, preferred) ? jobById(preferred) : jobById('assembler'));
          const jobId = target?.id;
          const previous = candidate.p.job?.id;
          const changed = !!jobId && (previous === jobId || setJob(candidate.p, jobId, this.rng));
          if (!changed) {
            candidate = null;
          } else {
            candidate.work = business.building;
            candidate.routeGoalKey = null;
            this.lastHiring.local++;
            if (previous !== jobId) this.lastHiring.retrained++;
            this.lastHiring.public++;
            this.recordPublicHire(business.building);
            remaining--;
            hired++;
            continue;
          }
        }

        const lifecycle = this.town.lifecycle;
        if (!lifecycle?.immigrate) break;
        const jobId = preferred;
        const before = new Set(ped.citizens);
        if (!lifecycle.immigrate({ job: jobId })) break;
        const newcomer = ped.citizens.find((c) => before.has(c) ? false : true);
        if (!newcomer) break;
        newcomer.work = business.building;
        newcomer.routeGoalKey = null;
        this.recordPublicHire(business.building);
        this.lastHiring.imported++;
        this.lastHiring.public++;
        remaining--;
        hired++;
      }
      if (hired >= limit) break;
    }
    return hired;
  }

  assignEmployees() {
    this.syncEntities();
    this.lastHiring = { local: 0, retrained: 0, imported: 0, public: 0, private: 0 };
    this.publicHiringCommitted = 0;
    // New resource sites can appear after the founding pass. Give their
    // public crews a chance to claim idle locals before the business census.
    this.town.pedestrians?.staffWorkforce?.();
    this.staffPublicCivic();
    const citizens = this.town.pedestrians?.citizens || [];
    const byBuilding = new Map(this.businesses.map((b) => [b.building, b]));
    for (const business of this.businesses) {
      business.employees = 0;
      business.jobsRequired = this.staffNeeded(business.building);
      business.staffNeed = business.jobsRequired;
    }
    // Seed the headcount from who is ALREADY standing there, so an owner only
    // advertises the posts it genuinely lacks. A minor or a retiree is not on
    // the roster: they cannot hold a post, so they cannot fill one either.
    for (const citizen of citizens) {
      const business = byBuilding.get(citizen.work);
      if (business && citizen.p.age >= 18 && citizen.p.age < 66 && citizen.p.job?.id !== 'retired') business.employees++;
    }
    // A public post lost to a demolition is refilled before the private ones,
    // so a town hall coming down costs a job for a day, not for ever.
    this.repostOrphans();
    // Owners post their vacancies BEFORE the census, so an open post is filled
    // from the town's own unemployed the same day it appears.
    const jobs = this.businesses
      .filter((b) => b.building && ['shop', 'office', 'hotel', 'resort', 'factory'].includes(b.building.kind))
      .sort((a, b) => (b.jobsRequired - b.employees) - (a.jobsRequired - a.employees));
    this.hireResidents(jobs);
    // State-owned factories are public employment. If no resident already has
    // the matching industrial trade, recruit into the vacancy rather than
    // leaving a government works visibly open with zero staff.
    this.staffPublicFactories();

    // The census is the only place a citizen becomes `business.employees`: it
    // seats them against each firm's post budget in town order, and a citizen
    // over a full firm is unposted rather than double-counted.
    let workingAge = 0, employed = 0, unemployed = 0, selfEmployed = 0;
    const seated = new Map();
    for (const citizen of citizens) {
      const p = this.ensureCitizenFinance(citizen.p);
      if (p.age < 18 || p.age >= 66 || p.job?.id === 'retired') {
        // Outside the labour force, so outside every roster: a child spawned
        // next to a shop used to keep a `work` pointer that occupied a post the
        // census then refused to count, leaving headcount and placement
        // permanently one apart.
        if (byBuilding.has(citizen.work)) citizen.work = null;
        p.employmentStatus = 'not_in_labor_force';
        continue;
      }
      workingAge++;
      const business = byBuilding.get(citizen.work);
      // A resource site's door is `kind: 'site'` with the workforce nested on
      // `work.site` — it carries neither `purpose: 'civic'` nor `kind: 'park'`,
      // so a farm/power/fuel crew was falling through to `unemployed` and
      // going unpaid while standing on the job. A sited crew is employment.
      const siteDoor = !!citizen.work && citizen.work.kind === 'site';
      const publicJob = !!citizen.work && (citizen.work.purpose === 'civic' || citizen.work.kind === 'park' || siteDoor);
      const at = business ? seated.get(business.id) || 0 : 0;
      if (business && at < business.jobsRequired) {
        seated.set(business.id, at + 1);
        p.employerId = business.operatorSector === SECTOR.GOVERNMENT ? 'government' : business.id;
        p.employmentStatus = 'employed'; employed++;
      } else if (publicJob) {
        p.employerId = siteDoor ? 'site' : 'government';
        p.employmentStatus = 'employed'; employed++;
      } else if (EconomySystem.selfEmployed(citizen)) {
        // A trade, not a vacancy: employed in their own account, never posted
        // to a business and never counted as a jobless adult.
        p.employerId = 'self'; p.employmentStatus = 'self_employed'; selfEmployed++; employed++;
      } else {
        if (business) citizen.work = null;
        p.employerId = null; p.employmentStatus = 'unemployed'; unemployed++;
      }
    }
    for (const b of this.businesses) {
      b.employees = seated.get(b.id) || 0;
      b.vacancies = Math.max(0, b.jobsRequired - b.employees);
    }
    const labourForce = employed + unemployed;
    this.unemployment = labourForce ? unemployed / labourForce : 0;
    this.participation = workingAge ? labourForce / workingAge : 0;
    this.selfEmployed = selfEmployed;
    return { employed, unemployed, selfEmployed, labourForce, workingAge };
  }

  employed() {
    const adults = [], jobless = [];
    for (const c of this.town.pedestrians?.citizens || []) {
      if (c.p.age < 18 || c.p.age >= 66) continue;
      adults.push(c);
      if (c.p.employmentStatus === 'unemployed') jobless.push(c);
    }
    return { adults, jobless };
  }

  resetPeriodActors() {
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = this.ensureCitizenFinance(citizen.p);
      p.grossIncome = 0; p.disposableIncome = 0; p.consumption = 0; p.housingCost = 0; p.taxPaid = 0;
    }
    for (const b of this.businesses) {
      b.revenue = 0; b.wageExpense = 0; b.inputExpense = 0; b.rentExpense = 0;
      b.utilityExpense = 0; b.interestExpense = 0; b.depreciationExpense = 0;
      b.taxExpense = 0; b.municipalExpense = 0; b.profit = 0; b.customers = 0; b.production = 0; b.tourismRevenue = 0;
    }
  }

  runPayroll() {
    const lift = 1 + (this.policyStaffPay || 0);
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = citizen.p;
      if (p.employmentStatus === 'self_employed') {
        // No employer, no payroll run: a home/road trade is paid out of its own
        // account as trade income, taxed on the same terms as a wage.
        const gross = Math.max(ECON.wages.minimumAnnual, p.income || 0) / 365 * lift;
        const tax = Math.round(gross * ECON.tax.income * this.policyTaxScale() * 100) / 100;
        const net = gross - tax;
        const paid = this.transfer({
          from: 'external', to: { sector: SECTOR.HOUSEHOLD, id: p.id }, amount: net,
          category: 'wage', metadata: { workerId: p.id, gross, net, selfEmployed: true }
        });
        if (!paid.ok) continue;
        const taxTx = this.transfer({
          from: { sector: SECTOR.HOUSEHOLD, id: p.id }, to: 'government', amount: tax,
          category: 'income_tax', metadata: { taxpayerId: p.id, selfEmployed: true }
        });
        if (taxTx.ok) p.taxPaid += tax;
        p.grossIncome += gross; p.disposableIncome += net; this.period.wages += gross;
        continue;
      }
      if (p.employmentStatus !== 'employed') continue;
      const gross = Math.max(ECON.wages.minimumAnnual, p.income || 0) / 365 * lift;
      // Civic and park staff are the town's own payroll; a sited resource crew
      // is paid by the contractor that runs the works, not by the treasury.
      const employer = p.employerId === 'government'
        ? { sector: SECTOR.GOVERNMENT, id: 'government' }
        : p.employerId === 'site'
          ? { sector: SECTOR.BUSINESS, id: 'contractor' }
          : { sector: SECTOR.BUSINESS, id: p.employerId };
      this.payWage(citizen, gross, employer);
    }
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = citizen.p;
      if (p.job?.id !== 'retired') continue;
      const pension = (p.income || ECON.wages.pensionAnnual) / 365;
      const paid = this.transfer({ from: 'government', to: { sector: SECTOR.HOUSEHOLD, id: p.id }, amount: pension, category: 'pension', metadata: { recipientId: p.id } });
      if (paid.ok) { p.grossIncome += pension; p.disposableIncome += pension; }
    }
  }

  /** Buildings that sell rooms to visitors rather than ordinary residents. */
  lodgingBusinesses() {
    return this.businesses.filter((b) => b.open && b.type === 'lodging' && b.building);
  }

  /**
   * Current tourism evidence. Rooms are a hard capacity ceiling; demand is a
   * bounded composite of attractions, civic legitimacy and weather. The
   * Council can therefore distinguish “we have no rooms” from “the town has
   * rooms but visitors are not interested” without creating fake residents.
   */
  tourismStats() {
    const lodging = this.lodgingBusinesses();
    const roomCapacity = lodging.reduce((sum, b) => sum + Math.max(0, b.rooms || 0), 0);
    const civicAttractions = {
      stadium: 3, zoo: 3, amphitheatre: 2.5, museum: 2, conservatory: 1.5,
      campus: 1.5, university: 1.5, college: 0.8
    };
    let attractions = 0;
    for (const b of this.town.buildings || []) {
      const declared = Number(b.tourism?.appeal || b.house?.spec?.tourism?.appeal) || 0;
      attractions += declared;
      attractions += civicAttractions[b.subtype] || 0;
    }
    const parks = this.town.grid?.countOf ? this.town.grid.countOf(CELL_KIND.PARK) : 0;
    attractions += Math.min(6, parks * 0.08);
    const society = this.town.society?.stats?.() || {};
    const legitimacy = Math.max(0, Math.min(1, Number(society.approvalRate) || 0.5));
    const mood = Math.max(0, Math.min(1, Number(society.mood) || 0.5));
    const weather = this.town.weather?.stats?.();
    const weatherFactor = weather && weather.precipitation > 0.7 ? 0.78 : weather && weather.precipitation > 0.4 ? 0.9 : 1;
    const appeal = Math.max(0, Math.min(1.5, attractions / 18 + legitimacy * 0.22 + mood * 0.12));
    const demand = Math.max(0, Math.min(1, appeal * weatherFactor));
    const occupiedRooms = Math.max(0, Math.min(roomCapacity, Math.round(roomCapacity * (0.18 + demand * 0.7))));
    Object.assign(this.tourism, {
      roomCapacity,
      occupiedRooms,
      freeRooms: Math.max(0, roomCapacity - occupiedRooms),
      appeal,
      demand,
      occupancy: roomCapacity ? occupiedRooms / roomCapacity : 0,
      visitors: occupiedRooms
    });
    return { ...this.tourism };
  }

  /** Settle one lodging night per available room at the day boundary. */
  runTourism() {
    const previous = this.tourism.occupiedRooms || 0;
    const stats = this.tourismStats();
    if (this.tourism.lastDay === this.lastDay) return stats;
    this.tourism.lastDay = this.lastDay;
    this.tourism.revenueToday = 0;
    let remaining = stats.occupiedRooms;
    let booked = 0;
    for (const business of this.lodgingBusinesses().sort((a, b) => a.id.localeCompare(b.id))) {
      const rooms = Math.min(Math.max(0, business.rooms || 0), remaining);
      remaining -= rooms;
      if (!rooms || !business.rate) continue;
      const amount = Math.round(rooms * business.rate * 100) / 100;
      const paid = this.transfer({
        from: 'external',
        to: { sector: SECTOR.BUSINESS, id: business.id },
        amount,
        category: 'export',
        metadata: { tourism: true, businessId: business.id, rooms, nightlyRate: business.rate }
      });
      if (!paid.ok) continue;
      const occupancyTaxRate = Math.max(0, Math.min(1, Number(ECON.municipalRevenue?.tourism?.occupancyTax) || 0));
      if (occupancyTaxRate > 0) {
        this.transfer({
          from: { sector: SECTOR.BUSINESS, id: business.id }, to: 'government',
          amount: amount * occupancyTaxRate, category: 'tourism_tax',
          metadata: { tourism: true, businessId: business.id, rooms, occupancyTaxRate }
        });
      }
      business.customers = (business.customers || 0) + rooms;
      business.revenue += amount;
      business.tourismRevenue = (business.tourismRevenue || 0) + amount;
      booked += rooms;
      this.tourism.revenue += amount;
      this.tourism.revenueToday += amount;
    }
    this.tourism.nights += booked;
    this.tourism.arrivals += Math.max(0, booked - previous);
    this.tourism.departures += Math.max(0, previous - booked);
    this.tourism.occupiedRooms = booked;
    this.tourism.freeRooms = Math.max(0, stats.roomCapacity - booked);
    this.tourism.occupancy = stats.roomCapacity ? booked / stats.roomCapacity : 0;
    this.tourism.visitors = booked;
    return { ...this.tourism };
  }

  /**
   * Collect the town's own-source service charges. These are deliberately
   * settled through transfer(), so every dollar is visible in the ledger and
   * a private operator who cannot pay simply misses the charge for that day.
   * Rates live in economyRules.json; this method only applies them to the
   * measured scale of the service being used.
   */
  runMunicipalRevenue() {
    const rules = ECON.municipalRevenue || {};
    const transit = rules.transit || {};
    const fare = Math.max(0, Number(transit.fare) || 0);
    const collectionRate = Math.max(0, Math.min(1, Number(transit.collectionRate) || 0));
    const citizens = (this.town.pedestrians?.citizens || [])
      .filter((citizen) => citizen.p?.preferences?.transport === 'bus' && citizen.p?.age >= 16)
      .sort((a, b) => String(a.p.id).localeCompare(String(b.p.id)));
    const transportStats = this.town.transport?.stats?.() || {};
    const serviceableRides = Math.min(
      Math.max(0, Math.floor(Number(transportStats.dailyRides) || 0)),
      Math.floor(citizens.length * 2 * collectionRate)
    );
    let transitFare = 0;
    if (fare > 0 && serviceableRides > 0) {
      let remaining = serviceableRides;
      for (const citizen of citizens) {
        if (remaining <= 0) break;
        const rides = Math.min(2, remaining);
        const amount = Math.min(Math.max(0, citizen.p.cash || 0), rides * fare);
        if (amount <= 0) continue;
        const paid = this.transfer({
          from: { sector: SECTOR.HOUSEHOLD, id: citizen.p.id }, to: 'government',
          amount, category: 'transit_fare',
          metadata: { riderId: citizen.p.id, rides, fare }
        });
        if (paid.ok) {
          transitFare += amount;
          remaining -= rides;
        }
      }
    }

    const utility = rules.utility || {};
    let utilityFee = 0;
    const householdBase = Math.max(0, Number(utility.householdBaseDaily) || 0);
    const perResident = Math.max(0, Number(utility.perResidentDaily) || 0);
    for (const household of this.town.pedestrians?.households || []) {
      const members = household.members || [];
      const payer = members.find((member) => member.p.age >= 18) || members[0];
      if (!payer?.p?.id) continue;
      const due = householdBase + perResident * members.length;
      const paid = this.transfer({
        from: { sector: SECTOR.HOUSEHOLD, id: payer.p.id }, to: 'government',
        amount: due, category: 'utility_fee',
        metadata: { householdId: household.id, residents: members.length, service: 'water-energy-waste' }
      });
      if (paid.ok) utilityFee += due;
    }

    const licence = rules.businessLicense || {};
    let businessLicense = 0;
    for (const business of this.businesses) {
      if (!business.open || business.operatorSector === SECTOR.GOVERNMENT || business.id === 'contractor' || !business.building) continue;
      const building = business.building;
      const floors = Math.max(1, Number(building.floors || building.house?.spec?.floors) || 1);
      const cells = Math.max(1, Array.isArray(building.footprint) ? building.footprint.length : 1);
      const turnover = Math.max(0, Number(business.revenue) || 0);
      let multiplier = 1;
      if (business.type === 'industry') multiplier = Number(licence.industrialMultiplier) || 1;
      else if (business.type === 'lodging') multiplier = Number(licence.lodgingMultiplier) || 1;
      const due = Math.max(0,
        (Number(licence.dailyBase) || 0) +
        (Number(licence.perFloor) || 0) * floors +
        (Number(licence.perCell) || 0) * cells +
        (Number(licence.turnoverRate) || 0) * turnover
      ) * multiplier;
      const paid = this.transfer({
        from: { sector: SECTOR.BUSINESS, id: business.id }, to: 'government',
        amount: due, category: 'business_license',
        metadata: { businessId: business.id, floors, cells, turnover, multiplier }
      });
      if (paid.ok) businessLicense += due;
    }

    const lease = rules.landLease || {};
    let landLease = 0;
    const annualRate = Math.max(0, Number(lease.annualRate) || 0);
    for (const business of this.businesses) {
      if (!business.open || business.operatorSector === SECTOR.GOVERNMENT || business.id === 'contractor' || !business.building) continue;
      let multiplier = 1;
      if (business.type === 'industry') multiplier = Number(lease.industrialMultiplier) || 1;
      else if (business.type === 'lodging') multiplier = Number(lease.lodgingMultiplier) || 1;
      const value = Math.max(0, this.propertyValue(business.building));
      const due = Math.max(Number(lease.minimumDaily) || 0, value * annualRate / 365) * multiplier;
      const paid = this.transfer({
        from: { sector: SECTOR.BUSINESS, id: business.id }, to: 'government',
        amount: due, category: 'land_lease',
        metadata: { businessId: business.id, assessedValue: value, annualRate, multiplier }
      });
      if (paid.ok) landLease += due;
    }

    const businessBase = Math.max(0, Number(utility.businessBaseDaily) || 0);
    const perFloor = Math.max(0, Number(utility.perFloorDaily) || 0);
    for (const business of this.businesses) {
      if (!business.open || business.operatorSector === SECTOR.GOVERNMENT || business.id === 'contractor' || !business.building) continue;
      const floors = Math.max(1, Number(business.building.floors || business.building.house?.spec?.floors) || 1);
      let multiplier = 1;
      if (business.type === 'industry') multiplier = Number(utility.industrialMultiplier) || 1;
      else if (business.type === 'lodging') multiplier = Number(utility.lodgingMultiplier) || 1;
      const due = (businessBase + perFloor * floors) * multiplier;
      const paid = this.transfer({
        from: { sector: SECTOR.BUSINESS, id: business.id }, to: 'government',
        amount: due, category: 'utility_fee',
        metadata: { businessId: business.id, floors, service: 'water-energy-waste', multiplier }
      });
      if (paid.ok) utilityFee += due;
    }
    return { transitFare, businessLicense, landLease, tourismTax: this.period.tourismTax, utilityFee };
  }

  runConsumption() {
    const sellers = this.businesses.filter((b) => b.open && b.type !== 'industry' && b.type !== 'lodging');
    if (!sellers.length) return;
    const weights = sellers.map((b) => Math.max(1, b.building?.capacity || 1));
    const totalWeight = weights.reduce((n, w) => n + w, 0);
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = citizen.p;
      if (p.age < 16 || p.cash <= 0) continue;
      const desired = Math.max(ECON.consumption.dailyMinimum,
        p.disposableIncome * ECON.consumption.propensity * (0.75 + (p.preferences?.spending || 0.5) * 0.5));
      const budget = Math.min(p.cash, desired);
      if (budget < 1) continue;
      let draw = this.rng.next() * totalWeight;
      let index = 0;
      while (index < sellers.length - 1 && (draw -= weights[index]) >= 0) index++;
      const seller = sellers[index];
      const result = seller.type === 'office'
        ? this.purchase({ buyer: citizen, seller, quantity: 1, unitPrice: budget, commodity: null })
        : this.purchase({ buyer: citizen, seller, quantity: Math.max(1, Math.floor(budget / TICKET)), unitPrice: TICKET, commodity: 'goods' });
      if (result.ok) seller.customers += result.quantity;
    }
  }

  runHousing() {
    const seen = new Set();
    for (const citizen of this.town.pedestrians?.citizens || []) {
      if (!citizen.home || !citizen.household || seen.has(citizen.household)) continue;
      seen.add(citizen.household);
      const payer = citizen.household.members?.find((m) => m.p.age >= 18) || citizen;
      this.payRent(payer, citizen.home, this.propertyValue(citizen.home) * ECON.property.annualRentYield / 365);
    }
    this.assessPropertyTaxes();
  }

  runGovernmentConsumption() {
    const pop = this.town.pedestrians?.citizens?.length || 0;
    const scale = this.spendingScale * (1 + (this.policySpending || 0));
    const amount = (ECON.government.fixedDailySpend + pop * ECON.government.perResidentDailySpend) * scale;
    this.transfer({ from: 'government', to: 'contractor', amount, category: 'government_procurement', metadata: { purpose: 'public_services', serviceScale: scale } });
  }

  closeBusinessBooks() {
    this.lastDividend = 0;
    for (const b of this.businesses) {
      const depreciation = b.fixedCapital * ECON.business.depreciationRate / 365;
      b.depreciationExpense += depreciation;
      b.fixedCapital = Math.max(0, b.fixedCapital - depreciation);
      const beforeTax = b.revenue - b.wageExpense - b.inputExpense - b.rentExpense - b.utilityExpense - b.interestExpense - b.depreciationExpense - b.municipalExpense;
      if (beforeTax > 0) {
        this.transfer({ from: { sector: SECTOR.BUSINESS, id: b.id }, to: 'government', amount: beforeTax * ECON.tax.corporate * this.policyTaxScale(), category: 'corporate_tax', metadata: { taxpayerId: b.id, taxableProfit: beforeTax } });
      }
      b.profit = b.revenue - b.wageExpense - b.inputExpense - b.rentExpense - b.utilityExpense - b.interestExpense - b.depreciationExpense - b.municipalExpense - b.taxExpense;
      b.retainedEarnings += b.profit;
      this.period.businessProfit += b.profit;
      // The developer supplied opening equity; profitable firms return a
      // controlled share after retaining a cash buffer for their own payroll.
      if (b.profit > 0 && b.retainedEarnings > 0 && b.cash > ECON.business.startupCash) {
        const dividend = Math.min(b.profit * 0.25, b.cash - ECON.business.startupCash);
        const paid = this.transfer({ from: { sector: SECTOR.BUSINESS, id: b.id }, to: 'developer',
          amount: dividend, category: 'owner_distribution', metadata: { businessId: b.id, investorId: b.equityInvestor } });
        if (paid.ok) { b.retainedEarnings -= dividend; this.lastDividend += dividend; }
      }
      if (b.cash < 0) b.status = 'business_insolvent';
    }
  }

  calculateGDP(period = this.period) {
    const daily = period.householdConsumption + period.privateFixedInvestment + period.inventoryInvestment +
      period.governmentConsumption + period.governmentInvestment + period.exports - period.imports;
    this.gdpComponents = {
      consumption: period.householdConsumption,
      privateFixedInvestment: period.privateFixedInvestment,
      inventoryInvestment: period.inventoryInvestment,
      governmentConsumption: period.governmentConsumption,
      governmentInvestment: period.governmentInvestment,
      exports: period.exports, imports: period.imports, period: 'daily'
    };
    this.gdp = daily * 365;
    return daily;
  }

  runEconomicDay() {
    this.syncEntities();
    this.assignEmployees();
    this.period = blankPeriod(this.lastDay);
    this.acc = this.period;
    this.resetPeriodActors();
    this.releaseReserveIfNeeded();
    this.runPayroll();
    this.runConsumption();
    // Lodging is settled after ordinary household spending so visitor money
    // appears in the same daily ledger as exports and is visible to the next
    // council sitting.
    this.runTourism();
    // Transit, private business licences, and site-value leases are settled
    // after the day's turnover is known. This keeps the charge proportional to
    // actual activity while preserving a complete day-level ledger.
    this.runMunicipalRevenue();
    this.runHousing();
    this.runGovernmentConsumption();
    this.serviceDebt();
    this.closeBusinessBooks();
    for (const key of Object.keys(this.capital)) {
      const depreciation = this.capital[key] * ECON.business.depreciationRate / 365;
      this.capital[key] = Math.max(0, this.capital[key] - depreciation);
    }
    for (const citizen of this.town.pedestrians?.citizens || []) {
      const p = citizen.p;
      this.period.householdSaving += p.disposableIncome - p.consumption - p.housingCost;
      // Bank the day's surplus before net worth is struck, so the figure
      // reported at the end of the day reflects where the money actually sits.
      // Moving it does not change net worth — cash to deposits is a change of
      // form, not of wealth — which is exactly why this can run here without
      // disturbing any total computed above.
      this.sweepSavings(citizen);
      p.netWorth = this.netWorthOf(p);
    }
    this.calculateGDP(this.period);
    this.lastPeriod = this.period;
    // The vehicle market clears once a day, after wages have been paid and
    // savings banked — so a household that could not afford a car this morning
    // can buy one this evening, and one that just lost its driver can sell. The
    // register also charges each vehicle's running cost to whoever holds the
    // title, which is what makes the fleet cost the town and the households
    // something rather than being free scenery.
    this.town.vehicles?.runDaily();
    this.town.vehicles?.settleMarket();
    if (this.subsidy && --this.subsidy.days <= 0) this.subsidy = null;
    this.day++;
    if (this.day % 7 === 0) this.computeLandValues();
    this.updateWarnings();
    return this.period;
  }

  update(dt, clock) {
    if (dt <= 0) return;
    if ((this.town.buildings?.length || 0) !== this.bizCount) this.rebuild();
    if (clock && clock.day !== this.lastDay) {
      this.treasuryDailyClose.set(this.lastDay, this.treasury);
      this.lastDay = clock.day;
      this.runEconomicDay();
      this.updatePolicy();
    }
  }
  daily() { return this.runEconomicDay(); }

  updatePolicy() {
    const policy = this.town.policy;
    if (!policy || policy.lastDay === this.lastDay) return;
    policy.lastDay = this.lastDay;
    policy.computeJurisdiction();
    policy.daily();
    const research = this.town.research;
    if (research && research.lastDay !== this.lastDay) {
      research.lastDay = this.lastDay; research.setDay(this.lastDay); research.daily();
    }
  }

  updateWarnings() {
    this.warnings = this.warnings.filter((w) => !w.startsWith('fiscal:') && w !== 'deficit');
    const daily = this.lastPeriod || this.period;
    const netBurn = Math.max(0, daily.governmentExpenditure - daily.governmentRevenue);
    const projectedBurn = this.projectedGovernmentDailyBurn();
    const runway = projectedBurn > 0 ? this.treasury / projectedBurn : Infinity;
    const operatingReserve = this.requiredPublicReserve(0);
    this.fiscalBand = this.treasury < 0 ? 'insolvent'
      : this.treasury < this.reserve ? 'reserve pressure'
      : this.treasury < operatingReserve ? 'operating reserve pressure'
      : runway < ECON.government.warningRunwayDays ? 'liquidity risk'
      : netBurn > 0 ? 'operating deficit' : 'healthy';
    if (this.fiscalBand !== 'healthy') this.warnings.push(`fiscal:${this.fiscalBand}`);
    if (this.unemployment > 0.22 && !this.warnings.includes('jobs')) this.warnings.push('jobs');
    if (this.unemployment < 0.14) this.warnings = this.warnings.filter((w) => w !== 'jobs');
  }

  setAside(pct = 0.25) {
    const remaining = Math.max(0, this.reserveTarget - this.reserve);
    if (remaining < 1000) return { ok: false, reason: `reserve target ${Math.round(this.reserveTarget)} already met` };
    const operatingCash = Math.max(0, this.treasury - ECON.government.reserveOperatingFloor);
    const amount = Math.min(remaining, Math.round(operatingCash * pct));
    if (amount < 1000) return { ok: false, reason: `treasury ${Math.round(this.treasury)} too thin to set aside` };
    const paid = this.transfer({ from: 'government', to: 'reserve', amount,
      category: 'reserve_allocation', metadata: { purpose: 'fiscal_reserve' } });
    if (!paid.ok) return paid;
    this.note(`Council sets aside ${money(amount)} in reserve.`, 'fiscal');
    return { ok: true, amount, reserve: Math.round(this.reserve), target: Math.round(this.reserveTarget) };
  }
  releaseReserveIfNeeded() {
    const gap = Math.max(0, ECON.government.reserveOperatingFloor - this.treasury);
    const amount = Math.min(this.reserve, gap);
    if (amount < 1) return { ok: false, reason: 'operating floor is funded' };
    const paid = this.transfer({
      from: 'reserve', to: 'government', amount,
      category: 'reserve_transfer', metadata: { purpose: 'automatic_liquidity' }
    });
    if (!paid.ok) return paid;
    this.note(`Reserve releases ${money(amount)} to restore operating liquidity.`, 'fiscal', 'warning');
    return { ok: true, amount, reserve: Math.round(this.reserve), treasury: Math.round(this.treasury) };
  }
  slashSpending() {
    const next = Math.max(0.5, Math.round((this.spendingScale - 0.15) * 100) / 100);
    if (next === this.spendingScale) return { ok: false, reason: 'spending already at its floor' };
    this.spendingScale = next;
    this.note(`Council slashes spending — services now run at ${Math.round(next * 100)}%.`, 'policy', 'warning');
    return { ok: true, scale: next };
  }
  grantSubsidy() {
    const open = this.businesses.filter((b) => b.type !== 'industry');
    if (!open.length) return { ok: false, reason: 'no business to subsidise' };
    const target = open.slice().sort((a, b) => a.profit - b.profit)[0];
    const amount = Math.min(50000, Math.max(0, Math.round(this.treasury - 100000)));
    if (amount < 1000) return { ok: false, reason: 'treasury too thin for a grant' };
    const paid = this.transfer({ from: 'government', to: { sector: SECTOR.BUSINESS, id: target.id }, amount, category: 'subsidy', metadata: { businessId: target.id } });
    if (!paid.ok) return paid;
    this.subsidy = { bizId: target.id, name: target.name, days: 20, amount };
    this.note(`Council grants ${money(amount)} to ${target.name}.`, 'subsidy');
    return { ok: true, amount, target: target.name, days: 20 };
  }

  /**
   * How much credit this borrower may still take out.
   *
   * `ECON.credit.businessLimitMultiple` was declared and read NOWHERE, so
   * `issueLoan` had no limit at all: 50 sequential loans on one business took
   * `outstanding` to $5,000,000 (verified). A proprietor is limited to a
   * multiple of the equity behind the firm — the same basis `payWage` already
   * uses for hiring credit — so leverage is bounded by what the business is
   * actually worth rather than by how many times the button is pressed.
   */
  creditRoom(borrower) {
    const account = this._account(borrower);
    if (!account) return 0;
    if (account.sector === SECTOR.HOUSEHOLD) {
      // A household's borrowing room is its own net worth, less what it owes.
      const p = account.object;
      return Math.max(0, this.netWorthOf(p) - (p.debt || 0));
    }
    const business = account.object;
    const equity = (business.fixedCapital || 0) - (business.debt || 0);
    return Math.max(0, (business.credit ?? ECON.business.ownerCredit) * equity);
  }

  issueLoan(borrower, amount, rate = ECON.credit.businessRate, termDays = 365) {
    const account = this._account(borrower);
    const value = finiteAmount(amount);
    if (!account || !value || account.sector === SECTOR.GOVERNMENT) return { ok: false, reason: 'invalid_borrower' };
    // Bounded credit. Without this the town's bank is an infinite money
    // printer that any solvent business can drain on demand.
    const room = this.creditRoom(borrower);
    if (value > room) {
      return { ok: false, reason: 'credit_limit', room: Math.round(room), requested: Math.round(value) };
    }
    const loan = { id: `loan-${this.ids.loan++}`, borrower: { sector: account.sector, id: account.id }, principal: value, outstandingPrincipal: value, interestRate: rate, issueTick: this.lastDay, maturityTick: this.lastDay + termDays, status: 'current' };
    // `creditCreation` is here for the OVERDRAW permission, not for the
    // expectation bump: the bank must be allowed to lend beyond the cash it
    // holds. But the flag also makes `transfer` add the full value to
    // `expectedMoney`, on the assumption the receiver's money is newly created —
    // and it is not. The borrower's cash came out of the bank's reserves, so in
    // a closed town a loan normally moves money rather than creating it, and
    // banking the full value as creation left the conservation check out by
    // exactly the principal (measured: total 100,000 below expected after one
    // loan). Only what the bank could NOT cover is genuine creation.
    const result = this.transfer({ from: 'bank', to: loan.borrower, amount: value, category: 'loan', metadata: { loanId: loan.id, creditCreation: true } });
    if (!result.ok) return result;
    const realCreation = Math.max(0, -this.accounts.bank.cash);
    this.expectedMoney -= value - realCreation;
    // NOTE: the bank is NOT topped back up. It used to add the lent amount
    // straight back to `bank.cash`, which made the bank's balance invariant to
    // how much it had lent — and with the overdraw permitted, the solvency
    // check (`deposits > bank.cash`) could then never fire and `reserves`
    // meant nothing. Letting the cash actually fall is what makes both figures
    // mean something.
    this.accounts.bank.reserves = this.accounts.bank.cash;
    account.object.debt = (account.object.debt || 0) + value;
    this.accounts.bank.loans += value;
    // `deposits` is the bank's liability to households for their savings, and
    // is maintained by `depositFor`/`withdrawFor`. It used to be bumped here
    // too, which meant the same credit was counted as both a loan and a
    // deposit — so the field could not mean either. Loans are a bank ASSET;
    // deposits are a bank LIABILITY, and the two never move together.
    this.loans.push(loan);
    return { ok: true, loan };
  }

  repayLoan(loan, amount) {
    if (!loan || loan.outstandingPrincipal <= 0) return { ok: false, reason: 'invalid_loan' };
    const value = Math.min(loan.outstandingPrincipal, finiteAmount(amount));
    const result = this.transfer({ from: loan.borrower, to: 'bank', amount: value, category: 'loan_repayment', metadata: { loanId: loan.id } });
    if (!result.ok) return result;
    // The transfer above has already put the money INTO the bank. It used to be
    // taken straight back out again, with `expectedMoney` adjusted to match, so
    // a fully repaid loan left the bank exactly as liquid as before (verified:
    // bank cash 1,000,000 before and after a 100,000 repayment). The bank was
    // therefore a pure money sink — which is what made the solvency check inert.
    // The principal now stays where it landed.
    this.accounts.bank.reserves = this.accounts.bank.cash;
    loan.outstandingPrincipal -= value;
    const borrower = this._account(loan.borrower);
    borrower.object.debt = Math.max(0, (borrower.object.debt || 0) - value);
    this.accounts.bank.loans -= value;
    // Deposit liabilities are untouched by loan repayment — see issueLoan.
    if (loan.outstandingPrincipal <= 0) loan.status = 'repaid';
    return { ok: true, amount: value };
  }

  issueBond(pct = 0.1, lender = 'bank') {
    const amount = Math.round(Math.max(25000, Math.min(this.gdp * pct, 500000)));
    const bond = { id: `bond-${this.ids.bond++}`, principal: amount, outstandingPrincipal: amount,
      interestRate: ECON.credit.governmentBondRate, issueTick: this.lastDay,
      maturityTick: this.lastDay + ECON.credit.bondMaturityDays,
      lender: typeof lender === 'string' ? lender : lender.id,
      lenderRef: lender === 'bank' ? { sector: SECTOR.BANK, id: 'bank' } : lender, status: 'current' };
    const result = this.transfer({ from: bond.lenderRef, to: 'government', amount, category: 'bond_issue', metadata: { bondId: bond.id } });
    if (!result.ok) return result;
    this.bonds.push(bond); this.debt += amount;
    if (!this.warnings.includes('debt')) this.warnings.push('debt');
    this.note(`Government issued ${money(amount)} bond.`, 'debt');
    return { ok: true, amount, debt: Math.round(this.debt), bond };
  }

  serviceDebt() {
    for (const loan of this.loans) {
      if (loan.outstandingPrincipal <= 0) continue;
      // Arrears is a PENALTY RATE, not a terminal state. It used to be set on the
      // first missed payment and then skipped for ever by the
      // `status !== 'current'` guard: one bad day bought unlimited, permanent,
      // interest-free credit, with `outstandingPrincipal`, `bank.loans` and the
      // borrower's `debt` all still inflated (verified: 100,000 outstanding,
      // zero interest transactions over the following nine days). The sim's own
      // agents can reach that state via payroll arrears.
      const rate = loan.status === 'arrears' ? loan.interestRate * ECON.credit.arrearsPenalty : loan.interestRate;
      const interest = loan.outstandingPrincipal * rate / 365;
      const paid = this.transfer({ from: loan.borrower, to: 'bank', amount: interest, category: 'interest', metadata: { loanId: loan.id, arrears: loan.status === 'arrears' } });
      if (paid.ok) {
        this.accounts.bank.interestIncome += interest;
        // A borrower that pays its way out of arrears is current again: enough
        // liquid wealth behind the loan to cover thirty days of penalty.
        const account = this._account(loan.borrower);
        if (loan.status === 'arrears' && account && this.liquidWealth(account.object || {}) > interest * 30) {
          loan.status = 'current';
        }
      } else {
        loan.status = 'arrears';
      }
    }
    for (const bond of this.bonds) {
      if (bond.outstandingPrincipal <= 0) continue;
      const matured = this.lastDay >= bond.maturityTick;
      // A matured bond that cannot be redeemed stops accruing and is marked
      // defaulted. It used to keep charging 5 %/365 for ever: the interest line
      // ran BEFORE the maturity test, a failed redemption left `status` as
      // 'current' and the principal outstanding, so the town accrued interest
      // on a debt it could never pay down and `this.debt` never fell (verified:
      // 11 interest transactions on a $25,000 bond past maturity).
      if (matured) {
        const paid = this.transfer({ from: 'government', to: bond.lenderRef, amount: bond.outstandingPrincipal, category: 'bond_repayment', metadata: { bondId: bond.id } });
        if (paid.ok) {
          this.debt -= bond.outstandingPrincipal;
          bond.outstandingPrincipal = 0;
          bond.status = 'repaid';
        } else if (bond.status !== 'defaulted') {
          bond.status = 'defaulted';
          this.warnings = this.warnings.filter((w) => w !== 'bond_default');
          this.warnings.push('bond_default');
          this.note(`The town cannot redeem ${bond.id} — it is in default.`, 'debt', 'warning');
        }
        continue;
      }
      if (bond.status === 'defaulted') continue;
      this.transfer({ from: 'government', to: bond.lenderRef, amount: bond.outstandingPrincipal * bond.interestRate / 365, category: 'bond_interest', metadata: { bondId: bond.id } });
    }
    if (this.debt <= 0) this.warnings = this.warnings.filter((w) => w !== 'debt');
  }

  /**
   * Resolve the economic boundary for a project.
   *
   * A Council order is not an ownership transfer. Private project types are
   * therefore developer opportunities unless they carry an explicit public
   * programme (currently social_housing) or modify an existing public asset.
   * Public outcomes may still use a developer PPP leg, so financing and
   * ownership remain separate fields.
   */
  projectFinancePolicy(plan = {}) {
    const type = String(plan.type || '');
    const privateType = PRIVATE_PROJECT_TYPES.has(type);
    const publicType = PUBLIC_PROJECT_TYPES.has(type);
    const publicProgram = typeof plan.publicProgram === 'string'
      ? PUBLIC_PROGRAM_TYPES.has(plan.publicProgram)
      : plan.publicProgram === true;
    const targetPublic = plan.target?.ownerType === SECTOR.GOVERNMENT || plan.target?.owner === 'state';
    const requested = plan.financingSector || (plan.owner === 'state' ? SECTOR.GOVERNMENT : null);
    let financierSector;
    if (privateType && !publicProgram && !targetPublic) {
      // Private actors retain the right to refuse a private opportunity. An
      // accidental owner=state or financingSector=government on a normal
      // house/shop/factory cannot turn that opportunity into public spending.
      financierSector = SECTOR.DEVELOPER;
    } else if (requested) {
      financierSector = requested;
    } else if (targetPublic || publicProgram || publicType || plan.owner === 'state') {
      financierSector = SECTOR.GOVERNMENT;
    } else if (PRIVATE_PROJECT_TYPES.has(type) || plan.owner === 'private') {
      financierSector = SECTOR.DEVELOPER;
    } else if (plan.target?.ownerType === SECTOR.BUSINESS) {
      financierSector = SECTOR.BUSINESS;
    } else if (plan.target?.ownerType === SECTOR.HOUSEHOLD) {
      financierSector = SECTOR.HOUSEHOLD;
    } else {
      financierSector = SECTOR.GOVERNMENT;
    }
    return {
      type,
      privateType,
      publicType,
      publicProgram,
      publicOutcome: publicProgram || publicType || targetPublic || (!privateType && plan.owner === 'state'),
      privateActor: privateType && !publicProgram && !targetPublic,
      requestedSector: requested,
      financierSector
    };
  }

  normalizeProjectFinance(plan = {}) {
    const policy = this.projectFinancePolicy(plan);
    if (policy.privateActor) {
      plan.financingSector = SECTOR.DEVELOPER;
      // A stale owner flag must not make a private house or shop state-owned.
      if (plan.owner === 'state') plan.owner = 'private';
      plan.financeBoundary = 'private_market';
    } else if (policy.publicProgram) {
      plan.owner = 'state';
      plan.publicProgram = plan.publicProgram === true ? 'social_housing' : plan.publicProgram;
      plan.financeBoundary = 'public_program';
    } else if (policy.publicOutcome) {
      plan.financeBoundary = 'public_mandate';
    }
    return this.projectFinancePolicy(plan);
  }

  classifyProject(plan = {}) {
    // An explicit developer leg remains valid for public outcomes (PPP), but
    // private project types cannot be promoted to public spending by a stale
    // owner/financing flag.
    return this.normalizeProjectFinance(plan).financierSector;
  }
  projectFinancier(plan = {}) {
    const sector = this.classifyProject(plan);
    if (plan.financierId) return { sector, id: plan.financierId };
    if (sector === SECTOR.GOVERNMENT) return { sector: SECTOR.GOVERNMENT, id: 'government' };
    if (sector === SECTOR.BUSINESS) return { sector, id: plan.target?.businessId || plan.target?.ownerId };
    if (sector === SECTOR.HOUSEHOLD) return { sector, id: plan.target?.ownerId };
    // An explicit financing leg is authoritative.  Do not let the target's
    // existing business/household ownership pull a PPP capacity upgrade back
    // onto an empty proprietor wallet after classifyProject selected the
    // developer account.
    if (plan.financingSector === SECTOR.DEVELOPER) return { sector: SECTOR.DEVELOPER, id: 'developer' };
    if (plan.target?.businessId) return { sector: SECTOR.BUSINESS, id: plan.target.businessId };
    return { sector: SECTOR.DEVELOPER, id: 'developer' };
  }
  /**
   * Conservative public cash requirement for the operating runway. It uses the
   * population target as the near-term growth case, includes active programme
   * and research commitments, and spreads bond principal due inside the runway
   * across its remaining days.
   */
  projectedGovernmentDailyBurn() {
    const pop = this.town.pedestrians?.citizens?.length || 0;
    const target = this.town.lifecycle?.stability?.()?.target ?? pop;
    const projectedPop = Math.max(pop, target);
    const scale = this.spendingScale * (1 + (this.policySpending || 0));
    const services = (ECON.government.fixedDailySpend + projectedPop * ECON.government.perResidentDailySpend) * scale;
    const schemes = this.town.policy?.active?.reduce((sum, scheme) => sum + (scheme.per || 0), 0) || 0;
    const research = Object.values(this.town.research?.funding || {}).reduce((sum, amount) => sum + (amount || 0), 0);
    const days = ECON.government.operatingRunwayDays;
    const debtInterest = this.bonds.reduce((sum, bond) => {
      if (bond.status === 'defaulted' || bond.outstandingPrincipal <= 0) return sum;
      return sum + bond.outstandingPrincipal * bond.interestRate / 365;
    }, 0);
    const debtMaturity = this.bonds.reduce((sum, bond) => {
      if (bond.status === 'defaulted' || bond.outstandingPrincipal <= 0) return sum;
      return sum + (this.lastDay + days >= bond.maturityTick ? bond.outstandingPrincipal / days : 0);
    }, 0);
    const payroll = this.lastPeriod?.categories?.government_payroll || 0;
    const observed = this.lastPeriod?.governmentExpenditure || 0;
    return Math.max(observed, services + schemes + research + payroll + debtInterest + debtMaturity);
  }
  requiredPublicReserve(base = 0) {
    const burn = this.projectedGovernmentDailyBurn();
    const runway = burn * ECON.government.operatingRunwayDays;
    return Math.max(base, ECON.government.reserveOperatingFloor, Math.ceil(runway));
  }
  resolveProjectFinance(plan = {}, reserve = 0) {
    const financier = this.projectFinancier(plan);
    const policy = this.projectFinancePolicy(plan);
    const account = this._account(financier);
    const projectCost = finiteAmount(plan.cost);
    const reserveRequired = financier.sector === SECTOR.GOVERNMENT ? this.requiredPublicReserve(reserve) : 0;
    const requiredCash = projectCost + reserveRequired;
    const availableCash = account?.balance || 0;
    return {
      ownerSector: policy.publicOutcome ? SECTOR.GOVERNMENT : (plan.target?.ownerType || financier.sector),
      ownerId: policy.publicOutcome ? 'government' : (plan.target?.ownerId || plan.ownerId || financier.id),
      financierSector: financier.sector, financierId: financier.id, account,
      financeBoundary: policy.privateActor ? 'private_market' : policy.publicProgram ? 'public_program' : (policy.publicOutcome || financier.sector === SECTOR.GOVERNMENT) ? 'public_mandate' : 'private_market',
      privateActor: policy.privateActor,
      projectCost, reserveRequired, requiredCash, availableCash,
      shortfall: Math.max(0, requiredCash - availableCash),
      affordable: !!account && availableCash + 1e-8 >= requiredCash,
      reason: !account ? 'invalid_financier' : availableCash + 1e-8 < requiredCash ? 'insufficient_financing' : ''
    };
  }
  canFinanceProject(plan, reserve = 0) {
    const f = this.resolveProjectFinance(plan, reserve);
    return { ...f, ok: f.affordable, available: f.availableCash, required: f.requiredCash };
  }
  projectTransactions(projectId) {
    return this.ledger.filter((tx) => tx.metadata?.projectId === projectId);
  }
  treasuryFlow(day = this.lastDay) {
    const rows = this.ledger.filter((tx) => tx.tick === day &&
      (tx.from?.sector === SECTOR.GOVERNMENT || tx.to?.sector === SECTOR.GOVERNMENT));
    const received = rows.filter((tx) => tx.to?.sector === SECTOR.GOVERNMENT);
    const paid = rows.filter((tx) => tx.from?.sector === SECTOR.GOVERNMENT);
    const sum = (items, categories) => items.filter((tx) => categories.includes(tx.category)).reduce((n, tx) => n + tx.amount, 0);
    const inflows = received.reduce((n, tx) => n + tx.amount, 0);
    const outflows = paid.reduce((n, tx) => n + tx.amount, 0);
    const closing = this.treasuryDailyClose.get(day) ?? this.treasury;
    const taxes = sum(received, ['income_tax', 'sales_tax', 'property_tax', 'corporate_tax', 'foreign_tax']);
    const municipalFees = sum(received, ['transit_fare', 'business_license', 'land_lease', 'tourism_tax', 'utility_fee']);
    const permitFees = sum(received, ['permit_fee']);
    const operations = sum(paid, ['government_procurement']);
    const payrollServices = sum(paid, ['government_payroll']);
    const publicConstruction = sum(paid, ['public_investment']);
    const subsidiesPrograms = sum(paid, ['subsidy', 'welfare', 'pension']);
    const debtService = sum(paid, ['bond_interest', 'bond_repayment']);
    const first = rows[0];
    const opening = first ? (first.from?.sector === SECTOR.GOVERNMENT ? first.balances?.fromBefore : first.balances?.toBefore) : closing;
    return { day, opening, inflows, outflows, closing,
      taxes, municipalFees, permitFees, otherPublicRevenue: inflows - taxes - municipalFees - permitFees,
      operations, payrollServices, publicConstruction, subsidiesPrograms, debtService,
      otherPublicOutflow: outflows - operations - payrollServices - publicConstruction - subsidiesPrograms - debtService,
      reconciled: Math.abs(closing - (opening + inflows - outflows)) < 0.01,
      rows };
  }
  budgetLedger(day = this.lastDay, { includeRows = false } = {}) {
    const rows = this.ledger.filter((tx) => tx.tick === day && tx.from?.sector === SECTOR.GOVERNMENT);
    const sum = (predicate) => rows.filter(predicate).reduce((total, tx) => total + tx.amount, 0);
    const programmePurposes = new Set(['scheme', 'law', 'programme_operations', 'research', 'settler_campaign']);
    const isProgramme = (tx) => programmePurposes.has(tx.metadata?.purpose) || ['subsidy', 'welfare', 'pension'].includes(tx.category);
    return {
      day,
      reserveTransfers: sum((tx) => ['reserve_allocation', 'reserve_transfer'].includes(tx.category)),
      construction: sum((tx) => tx.category === 'public_investment'),
      operations: sum((tx) => ['government_procurement', 'government_payroll'].includes(tx.category) && !isProgramme(tx)),
      policyPrograms: sum(isProgramme),
      debtService: sum((tx) => ['bond_interest', 'bond_repayment'].includes(tx.category)),
      ...(includeRows ? { rows } : {})
    };
  }
  reconcileProject(projectId) {
    const rows = this.projectTransactions(projectId);
    return { projectId, debits: rows.reduce((n, tx) => n + tx.debit, 0), credits: rows.reduce((n, tx) => n + tx.credit, 0), transactions: rows };
  }
  _reverseProjectTransfers(transactions, projectId) {
    for (const tx of [...transactions].reverse()) {
      const payer = this._account(tx.from), receiver = this._account(tx.to);
      if (!payer || !receiver) throw new Error(`Cannot reverse project transfer ${tx.id}`);
      // Project recipients can spend labour/material payments before a site
      // fails. Reversing the original amount unconditionally used to create a
      // negative contractor/business balance and made audit() fail even though
      // every ledger row was balanced. External is an unconstrained sink, but
      // internal recipients can refund only the cash they still hold; the
      // remainder is a recorded sunk project cost rather than an overdraft.
      const recoverable = receiver.sector === SECTOR.EXTERNAL
        ? tx.amount
        : Math.min(tx.amount, Math.max(0, receiver.balance));
      if (recoverable <= 0) continue;
      payer.balance += recoverable;
      receiver.balance -= recoverable;
      this._trackPeriod(tx.category, -recoverable);
      if (tx.metadata?.physicalTrade && receiver.sector === SECTOR.EXTERNAL) this.period.imports -= recoverable;
      if (receiver.sector === SECTOR.EXTERNAL) this.expectedMoney += recoverable;
      if (payer.sector === SECTOR.EXTERNAL) this.expectedMoney -= recoverable;
      this.ledger.push({ id: `tx-${this.ids.transaction++}`, tick: this.lastDay, from: tx.to, to: tx.from,
        amount: recoverable, debit: recoverable, credit: recoverable, category: 'project_reversal',
        metadata: { projectId, reversal: tx.id, recovered: recoverable, original: tx.amount,
          sunk: Math.max(0, tx.amount - recoverable) } });
    }
  }
  fundProject(plan) {
    const cost = finiteAmount(plan?.cost);
    if (!cost || plan.charge === false) return { ok: true, amount: 0 };
    const financier = this.projectFinancier(plan);
    const sector = this.classifyProject(plan);
    const policy = this.projectFinancePolicy(plan);
    const category = sector === SECTOR.GOVERNMENT ? 'public_investment' : 'private_investment';
    const acquisitionCost = plan.acquisitionQuote?.total || 0;
    const constructionCost = Math.max(0, cost - acquisitionCost);
    const payments = [];
    if (constructionCost > 0) {
      const shares = ECON.construction;
      const components = [
        ['construction_labour_pool', shares.labour, 'contractor'],
        ['domestic_materials', shares.domesticMaterials, 'contractor'],
        ['contractor_margin', shares.contractorMargin, 'contractor'],
        ['imported_inputs', shares.importedInputs, 'external'],
        [sector === SECTOR.GOVERNMENT ? 'public_overhead' : 'permit_fee', shares.feesTaxes,
          sector === SECTOR.GOVERNMENT ? 'contractor' : 'government']
      ];
      let allocated = 0;
      for (let index = 0; index < components.length; index++) {
        const [component, share, recipient] = components[index];
        const amount = index === components.length - 1
          ? constructionCost - allocated
          : constructionCost * share;
        allocated += amount;
        payments.push({ from: financier, to: recipient, amount,
          category: component === 'permit_fee' ? 'permit_fee' : category,
          metadata: { projectId: plan.projectId, projectType: plan.type, component,
            origin: plan.commissionedBy === 'developer' ? 'DEVELOPER' : plan.origin || 'SYSTEM',
            financingSector: sector, financierId: financier.id,
            ownerType: plan.target?.ownerType || sector, ownerId: plan.target?.ownerId || plan.ownerId || financier.id,
            physicalTrade: component === 'imported_inputs' } });
      }
    }
    for (const item of plan.acquisitionQuote?.items || []) {
      for (const [component, amount, to] of [
        ['acquisition_compensation', item.propertyCompensation, item.owner],
        ['relocation_support', item.relocationCost, item.owner],
        ['demolition', item.demolitionCost, 'contractor']
      ]) {
        if (amount > 0) payments.push({ from: financier, to, amount,
          category: component === 'demolition' ? category : component,
          metadata: { projectId: plan.projectId, buildingId: item.buildingId, component,
            origin: plan.commissionedBy === 'developer' ? 'DEVELOPER' : plan.origin || 'SYSTEM' } });
      }
    }
    const account = this._account(financier);
    if (!account || account.balance + 1e-8 < payments.reduce((n, p) => n + p.amount, 0))
      return { ok: false, reason: 'insufficient_financing' };
    if (payments.some((p) => !this._account(p.to))) return { ok: false, reason: 'invalid_account' };
    const transactions = [];
    for (const payment of payments) {
      const paid = this.transfer(payment);
      if (!paid.ok) {
        this._reverseProjectTransfers(transactions, plan.projectId);
        return paid;
      }
      transactions.push(paid.transaction);
    }
    const capitalKey = sector === SECTOR.GOVERNMENT
      ? (['road', 'roadup', 'bridge', 'footway', 'utility'].includes(plan.type) ? 'publicInfrastructure' : 'publicBuildings')
      : plan.type === 'house' ? 'privateResidential' : plan.type === 'factory' ? 'privateIndustrial' : 'privateCommercial';
    this.capital[capitalKey] += constructionCost;
    plan.financingSector = sector; plan.financierId = financier.id;
    plan.ownerType = policy.publicOutcome ? SECTOR.GOVERNMENT : sector;
    plan.ownerId ||= policy.publicOutcome ? 'government' : financier.id;
    plan.financeBoundary = policy.privateActor ? 'private_market' : policy.publicProgram ? 'public_program' : (policy.publicOutcome || sector === SECTOR.GOVERNMENT) ? 'public_mandate' : 'private_market';
    plan.fundingTransactionId = transactions[0]?.id || null;
    plan.fundingTransactions = transactions;
    plan.fundedCapital = { key: capitalKey, amount: constructionCost };
    return { ok: true, amount: cost, transaction: transactions[0], transactions, capitalKey };
  }
  refundProject(plan) {
    if (!plan?.fundingTransactions?.length) return { ok: true, amount: 0 };
    this._reverseProjectTransfers(plan.fundingTransactions, plan.projectId);
    if (plan.fundedCapital) this.capital[plan.fundedCapital.key] -= plan.fundedCapital.amount;
    const amount = plan.fundingTransactions.reduce((n, tx) => n + tx.amount, 0);
    plan.fundingTransactions = [];
    plan.fundingTransactionId = null;
    plan.fundedCapital = null;
    return { ok: true, amount };
  }

  acquisitionQuote(buildings = [], plan = {}) {
    const items = [];
    for (const building of [...new Set(buildings.filter(Boolean))]) {
      const ownerType = building.ownerType || (building.owner === 'state' ? SECTOR.GOVERNMENT : SECTOR.DEVELOPER);
      const ownerId = building.ownerId || (ownerType === SECTOR.GOVERNMENT ? 'government' : 'developer');
      const owner = { sector: ownerType, id: ownerId };
      if (ownerType === SECTOR.GOVERNMENT && this.classifyProject(plan) !== SECTOR.GOVERNMENT)
        return { ok: false, reason: 'public_asset_transfer_required', items: [], total: 0 };
      const propertyCompensation = this.propertyValue(building);
      if (ownerType === SECTOR.GOVERNMENT) {
        const replacementCost = propertyCompensation;
        const demolitionCost = propertyCompensation * ECON.construction.demolitionShare;
        items.push({ building, buildingId: building.id, owner,
          propertyCompensation: 0, relocationCost: 0, demolitionCost: replacementCost + demolitionCost,
          replacementCost, publicAssetTransfer: true, total: replacementCost + demolitionCost });
        continue;
      }
      const relocationCost = building.purpose === 'residential' ? propertyCompensation * ECON.construction.relocationShare : 0;
      const demolitionCost = propertyCompensation * ECON.construction.demolitionShare;
      items.push({ building, buildingId: building.id, owner, propertyCompensation, relocationCost, demolitionCost, total: propertyCompensation + relocationCost + demolitionCost });
    }
    return { ok: true, items, total: items.reduce((s, i) => s + i.total, 0) };
  }
  compensateAcquisition(quote, plan) {
    if (!quote?.ok) return quote || { ok: false, reason: 'invalid_quote' };
    const financier = this.projectFinancier(plan);
    if ((this._account(financier)?.balance || 0) < quote.total) return { ok: false, reason: 'insufficient_funds' };
    const transactions = [];
    for (const item of quote.items) {
      if (item.propertyCompensation > 0) {
        const payment = this.transfer({ from: financier, to: item.owner, amount: item.propertyCompensation,
          category: 'acquisition_compensation', metadata: { projectId: plan.projectId, buildingId: item.buildingId, ownerId: item.owner.id } });
        if (!payment.ok) return payment;
        transactions.push(payment.transaction);
      }
      if (item.relocationCost > 0) {
        const relocation = this.transfer({ from: financier, to: item.owner, amount: item.relocationCost, category: 'relocation_support', metadata: { projectId: plan.projectId, buildingId: item.buildingId } });
        if (relocation.ok) transactions.push(relocation.transaction);
      }
      if (item.demolitionCost > 0) {
        const demolition = this.transfer({ from: financier, to: 'contractor', amount: item.demolitionCost,
          category: this.classifyProject(plan) === SECTOR.GOVERNMENT ? 'public_investment' : 'private_investment', metadata: { projectId: plan.projectId, buildingId: item.buildingId, component: 'demolition' } });
        if (demolition.ok) transactions.push(demolition.transaction);
      }
    }
    return { ok: true, total: quote.total, transactions };
  }

  recordProduction(business, commodity, quantity, inputs = {}, unitValue = 0) {
    const b = typeof business === 'string' ? this.businessesById.get(business) : business;
    const qty = Math.max(0, Number(quantity) || 0);
    if (!b || !commodity || qty <= 0) return { ok: false, reason: 'production_constrained' };
    for (const [key, required] of Object.entries(inputs)) {
      if ((b.inventory[key] || 0) < required) return { ok: false, reason: 'inventory_shortage', commodity: key };
    }
    for (const [key, required] of Object.entries(inputs)) {
      b.inventory[key] -= required;
      this._adjustExpectedInventory(b.id, key, -required);
    }
    b.inventory[commodity] = (b.inventory[commodity] || 0) + qty;
    this._adjustExpectedInventory(b.id, commodity, qty);
    b.production += qty;
    b.inventoryUnitValue ??= {};
    if (unitValue > 0) {
      b.inventoryUnitValue[commodity] = unitValue;
      this.period.inventoryInvestment += qty * unitValue;
    }
    return { ok: true, quantity: qty };
  }
  importGoods(importer, commodity, quantity, unitPrice) {
    const account = this._account(importer);
    const qty = Math.max(0, Number(quantity) || 0);
    const total = qty * finiteAmount(unitPrice);
    if (!account || !qty || !total) return { ok: false, reason: 'invalid_import' };
    const result = this.transfer({ from: importer, to: 'external', amount: total, category: 'import', metadata: { importerId: account.id, commodity, quantity: qty, unitPrice } });
    if (!result.ok) return result;
    account.object.inventory ??= {};
    account.object.inventory[commodity] = (account.object.inventory[commodity] || 0) + qty;
    if (account.sector === SECTOR.BUSINESS) this._adjustExpectedInventory(account.id, commodity, qty);
    return { ok: true, quantity: qty, cost: total };
  }
  exportGoods(exporter, commodity, quantity, unitPrice) {
    const account = this._account(exporter);
    const qty = Math.max(0, Number(quantity) || 0);
    const available = account?.object?.inventory?.[commodity] || 0;
    const sold = Math.min(qty, available);
    const total = sold * finiteAmount(unitPrice);
    if (!account || !sold || !total) return { ok: false, reason: available <= 0 ? 'inventory_shortage' : 'invalid_export' };
    const result = this.transfer({ from: 'external', to: exporter, amount: total, category: 'export', metadata: { exporterId: account.id, commodity, quantity: sold, unitPrice } });
    if (!result.ok) return result;
    account.object.inventory[commodity] -= sold;
    if (account.sector === SECTOR.BUSINESS) this._adjustExpectedInventory(account.id, commodity, -sold);
    const bookValue = account.object.inventoryUnitValue?.[commodity] || unitPrice;
    this.period.inventoryInvestment -= sold * bookValue;
    return { ok: true, quantity: sold, revenue: total };
  }

  recordMigration(citizen, direction) {
    const p = citizen?.p || citizen;
    if (!p?.id) return { ok: false, reason: 'invalid_citizen' };
    this.ensureCitizenFinance(p);
    // A citizen leaving the town takes their savings with them. The funds were
    // never the household's to keep — the bank holds them against a liability —
    // so the claim is settled back to the bank and the liability goes with it.
    // Leaving it behind would silently delete the bank's obligation to a person
    // who no longer exists.
    if (direction !== 'in') this.settleDeposits(p, 'external');
    const amount = p.cash;
    if (!amount) return { ok: true, amount: 0 };
    if (direction === 'in') {
      // Normalisation only — the transfer below re-issues the cash and is what
      // records it in the memo.
      p.cash = 0; p.wealth = 0;
      this.registeredCitizens.add(p.id);
      return this.transfer({ from: 'external', to: { sector: SECTOR.HOUSEHOLD, id: p.id }, amount, category: 'immigration_capital_inflow', metadata: { citizenId: p.id } });
    }
    return this.transfer({ from: { sector: SECTOR.HOUSEHOLD, id: p.id }, to: 'external', amount, category: 'emigration_capital_outflow', metadata: { citizenId: p.id } });
  }

  /**
   * Close out everything a departing citizen leaves behind, so the town's books
   * balance when they go.
   *
   * Two different things have to happen, and they are not the same operation:
   *
   *   - Their SAVINGS stop being the bank's liability. The funds were already
   *     at the bank, so no money moves; only the bank's debt to them is written
   *     off (`settleDeposits`).
   *   - Their WALLET CASH has to actually go somewhere. It was counted in the
   *     town's money total only for as long as the citizen was on the books, so
   *     removing them without moving it makes money appear to evaporate — the
   *     ledger stops counting a balance that was never handed to anyone.
   *
   * Normally the estate is settled before this, by `inherit` (to a partner, a
   * child, or the treasury). This is the backstop for every removal path that
   * does not go through one of those — and in the ordinary case there is nothing
   * left to do, because the cash is already at zero.
   */
  settleEstate(p, reason = 'citizen-removed') {
    if (!p?.id) return { ok: false, reason: 'no_profile' };
    const cash = p.cash || 0;
    this.settleDeposits(p, reason);
    if (cash <= 0) return { ok: true, amount: 0 };
    // The person and their money have both left the town.
    const paid = this.transfer({
      from: { sector: SECTOR.HOUSEHOLD, id: p.id },
      to: 'external',
      amount: cash,
      category: 'estate_settlement',
      metadata: { citizenId: p.id, reason }
    });
    if (!paid.ok) return { ok: false, reason: 'unsettled', amount: cash };
    p.wealth = this.liquidWealth(p);
    p.netWorth = this.netWorthOf(p);
    return { ok: true, amount: cash };
  }

  /**
   * Close a citizen's savings: the balance stops being owed and the bank keeps
   * the cash. No money moves — the funds were already at the bank, so the only
   * thing that changes is who the bank owes, which is what keeps the liability
   * memo equal to the sum of household deposits after someone leaves or dies.
   */
  settleDeposits(p, reason = 'settled') {
    const value = p.deposits || 0;
    if (value <= 0) return { ok: true, amount: 0 };
    p.deposits = 0;
    this.accounts.bank.deposits = Math.max(0, this.accounts.bank.deposits - value);
    this.syncFinancialAssets(p);
    p.wealth = this.liquidWealth(p);
    p.netWorth = this.netWorthOf(p);
    this.settledDeposits = (this.settledDeposits || 0) + value;
    return { ok: true, amount: value, reason };
  }

  /**
   * Hand a claim on savings from one citizen to another — an estate passing to
   * an heir. No money moves: both balances are liabilities of the same bank, so
   * this is a change of creditor, not a payment, and the bank's total liability
   * is unchanged. An heir with no savings of their own ends up with the estate's.
   */
  transferDepositClaim(fromP, toP, amount) {
    const value = Math.min(finiteAmount(amount), fromP.deposits || 0);
    if (value <= 0) return { ok: false, reason: 'nothing_to_bequest' };
    fromP.deposits -= value;
    toP.deposits = (toP.deposits || 0) + value;
    for (const p of [fromP, toP]) {
      this.syncFinancialAssets(p);
      p.wealth = this.liquidWealth(p);
      p.netWorth = this.netWorthOf(p);
    }
    return { ok: true, amount: value };
  }

  /**
   * Bank part of a newly arrived citizen's opening cash, so a household has a
   * savings position from day one.
   *
   * This is the ONLY way a deposit balance comes into existence without a prior
   * withdrawal, and it runs exactly once per citizen. Going through the normal
   * transfer is the point: the alternative — letting `citizenProfile` set a
   * starting `deposits` figure — would leave the bank owing money it never
   * received, and the drift grows with every immigrant.
   */
  openFirstAccount(citizen) {
    const p = this.ensureCitizenFinance(citizen?.p);
    if (!p?.id) return { ok: false, reason: 'no_profile' };
    if (this.openedAccounts.has(p.id)) return { ok: false, reason: 'already_open' };
    this.openedAccounts.add(p.id);
    const share = (p.cash || 0) * ECON.banking.openingSavingsShare;
    if (share < 1) return { ok: false, reason: 'too_small_to_open' };
    return this.depositFor(citizen, share);
  }

  inherit(fromCitizen, toCitizen) {
    const from = fromCitizen?.p || fromCitizen, to = toCitizen?.p || toCitizen;
    if (!from?.id || !to?.id || from.id === to.id) return { ok: false, reason: 'invalid_heir' };
    // Savings pass to the heir as a claim, so the estate is not silently
    // reduced by whatever the deceased had banked.
    this.transferDepositClaim(from, this.ensureCitizenFinance(to), from.deposits || 0);
    return this.transfer({ from: { sector: SECTOR.HOUSEHOLD, id: from.id }, to: { sector: SECTOR.HOUSEHOLD, id: to.id }, amount: from.cash,
      category: 'inheritance', metadata: { estateId: from.id, heirId: to.id } });
  }

  audit() {
    this.syncEntities();
    const unbalancedTransactions = this.ledger.filter((tx) => Math.abs((tx.debit || 0) - (tx.credit || 0)) > 0.001 || !tx.from?.id || !tx.to?.id);
    const negativeBalances = this._allInternalAccounts().filter((a) => a.balance < -0.001).map((a) => ({ account: a.key, balance: a.balance }));
    const orphanedOwnership = [], orphanedReferences = [], inventoryInconsistencies = [];
    for (const building of this.town.buildings || []) {
      if (!building.id || !building.ownerType || !building.ownerId) orphanedOwnership.push(building.id || building.cell);
      if (building.businessId && !this.businessesById.has(building.businessId)) orphanedReferences.push({ buildingId: building.id, businessId: building.businessId });
    }
    for (const b of this.businessesById.values()) {
      if (b.open && !(this.town.buildings || []).some((building) => building.id === b.buildingId)) orphanedReferences.push({ businessId: b.id, buildingId: b.buildingId });
      for (const [commodity, quantity] of Object.entries(b.inventory || {})) {
        if (!Number.isFinite(quantity) || quantity < -0.001) inventoryInconsistencies.push({ businessId: b.id, commodity, quantity });
        const expected = this.inventoryExpected.get(`${b.id}:${commodity}`);
        if ((expected == null && Math.abs(quantity) > 0.001) || (expected != null && Math.abs(quantity - expected) > 0.001))
          inventoryInconsistencies.push({ businessId: b.id, commodity, quantity, expected, reason: 'unexplained_inventory_change' });
      }
    }
    const unexpectedMoney = Math.abs(this._moneyTotal() - this.expectedMoney) > 0.01 ? this._moneyTotal() - this.expectedMoney : 0;
    const invalidTaxTransfers = this.ledger.filter((tx) => tx.category.endsWith('_tax') && tx.to.sector !== SECTOR.GOVERNMENT);
    const invalidSubsidies = this.ledger.filter((tx) => tx.category === 'subsidy' && (tx.from.sector !== SECTOR.GOVERNMENT || tx.to.sector !== SECTOR.BUSINESS));
    const outstandingLoans = this.loans.reduce((s, l) => s + l.outstandingPrincipal, 0);
    const outstandingBonds = this.bonds.reduce((s, b) => s + b.outstandingPrincipal, 0);
    const creditInconsistencies = [];
    if (Math.abs(outstandingLoans - this.accounts.bank.loans) > 0.01)
      creditInconsistencies.push({ kind: 'bank_loans', ledger: outstandingLoans, bankAsset: this.accounts.bank.loans });
    if (Math.abs(outstandingBonds - this.debt) > 0.01)
      creditInconsistencies.push({ kind: 'government_bonds', schedule: outstandingBonds, reportedDebt: this.debt });
    // The bank's deposit liability must equal the sum of what households hold.
    // Both sides are updated in depositFor/withdrawFor, so this can only fail if
    // one was updated without the other — which would let the bank quietly
    // conjure or destroy savings.
    const householdDeposits = (this.town.pedestrians?.citizens || []).reduce((s, c) => s + (c.p.deposits || 0), 0);
    if (Math.abs(householdDeposits - this.accounts.bank.deposits) > 0.01)
      creditInconsistencies.push({ kind: 'bank_deposits', households: householdDeposits, bankLiability: this.accounts.bank.deposits });
    // The bank cannot owe depositors more than it holds.
    if (this.accounts.bank.deposits > this.accounts.bank.cash + 0.01)
      creditInconsistencies.push({ kind: 'bank_insolvent', deposits: this.accounts.bank.deposits, cash: this.accounts.bank.cash });
    // The household-cash memo is what `_moneyTotal` now reports, so it is worth
    // checking against the roster directly. They are SUPPOSED to differ when a
    // citizen has been removed (the memo still counts their money, which is the
    // point), so this is a signal to investigate, not an automatic failure — but
    // it catches a memo that was never seeded or double-adjusted.
    const rosterCash = (this.town.pedestrians?.citizens || []).reduce((s, c) => s + (c.p.cash || 0), 0);
    const memoCash = this.householdCashLedger || 0;
    if (memoCash < rosterCash - 0.01)
      creditInconsistencies.push({ kind: 'household_cash_memo_low', memo: memoCash, roster: rosterCash, reason: 'memo_below_roster' });
    return {
      ok: !unbalancedTransactions.length && !negativeBalances.length && !orphanedOwnership.length && !orphanedReferences.length && !inventoryInconsistencies.length && !unexpectedMoney && !invalidTaxTransfers.length && !invalidSubsidies.length && !creditInconsistencies.length,
      balances: {
        householdCash: (this.town.pedestrians?.citizens || []).reduce((s, c) => s + (c.p.cash || 0), 0),
        householdDeposits,
        businessCash: [...this.businessesById.values()].reduce((s, b) => s + b.cash, 0), treasury: this.treasury,
        bank: this.accounts.bank.cash, external: this.accounts.external.cash
      },
      outstandingLoans, governmentDebt: this.debt, householdDeposits,
      unbalancedTransactions, negativeBalances,
      unfundedWages: this.rejectedTransactions.filter((tx) => ['wage', 'government_payroll'].includes(tx.category)),
      unfundedConstruction: this.rejectedTransactions.filter((tx) => ['private_investment', 'public_investment'].includes(tx.category)),
      invalidTaxTransfers, invalidSubsidies, creditInconsistencies, inventoryInconsistencies, orphanedOwnership, orphanedReferences,
      unexpectedMoneyCreation: unexpectedMoney
    };
  }

  computeLandValues() {
    const grid = this.town.grid;
    if (!grid) return;
    const values = new Float32Array(grid.w * grid.h);
    const civic = [], parks = [];
    for (const b of this.town.buildings || []) {
      if (b.purpose === 'civic') civic.push(b.cell);
      else if (b.kind === 'park' || b.purpose === 'park') parks.push(b.cell);
    }
    const cx = grid.w / 2, cy = grid.h / 2;
    const shops = (this.town.buildings || []).filter((b) => b.purpose === 'commercial');
    const utilityStats = this.town.utilities?.stats?.();
    const wired = utilityStats ? Object.values(utilityStats.types || {}).reduce((s, t) => s + (t.coverage || 0), 0) / 300 : 0.5;
    grid.forEach((x, y, current) => {
      const index = current.idx(x, y);
      if (current.kindAt(x, y) === 'water') { values[index] = 0; return; }
      let value = 0.28, road = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (current.isRoad(x + dx, y + dy)) road++;
      if (road) value += 0.14;
      if (road > 1) value += 0.04;
      let dCivic = 99;
      for (const cell of civic) dCivic = Math.min(dCivic, Math.abs(cell[0] - x) + Math.abs(cell[1] - y));
      if (dCivic <= 8) value += 0.2 * (1 - dCivic / 9);
      let dPark = 99;
      for (const cell of parks) dPark = Math.min(dPark, Math.abs(cell[0] - x) + Math.abs(cell[1] - y));
      if (dPark <= 6) value += 0.14 * (1 - dPark / 7);
      let dShop = 99;
      for (const b of shops) dShop = Math.min(dShop, Math.abs(b.cell[0] - x) + Math.abs(b.cell[1] - y));
      if (shops.length && dShop <= 5) value += 0.12 * (1 - dShop / 6);
      value += Math.max(0, 0.1 - Math.hypot(x - cx, y - cy) * 0.004) + wired * 0.1;
      values[index] = Math.max(0, Math.min(1, value + (this.frontageBump.get(`${x},${y}`) || 0)));
    });
    this.landValue = values;
    this.landAvg = values.reduce((s, value) => s + value, 0) / values.length;
  }
  landValueAt(x, y) {
    if (!this.landValue || !this.town.grid?.inBounds(x, y)) return 0.5;
    return this.landValue[this.town.grid.idx(x, y)];
  }
  bumpFrontage(entries) {
    const grid = this.town.grid;
    for (const [x, y, rungs] of entries) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const kind = grid.kindAt(nx, ny);
        if (kind !== CELL_KIND.LOT && kind !== CELL_KIND.EMPTY) continue;
        const key = `${nx},${ny}`;
        this.frontageBump.set(key, Math.min(0.2, (this.frontageBump.get(key) || 0) + 0.04 * Math.max(1, rungs || 1)));
      }
    }
    this.computeLandValues();
  }

  /**
   * Compact service-sector census for the report and HUD. Private offices and
   * other non-retail service firms are market businesses; civic facilities are
   * public service employers staffed through Lifecycle.civicStaffing(). Keep
   * the two lanes separate so retail does not hide a missing professional or
   * state-administration sector.
   */
  serviceSectorStats() {
    const privateBusinesses = this.businesses.filter((business) =>
      business.type === 'office' || business.type === 'services'
    );
    const civicStaff = this.town.lifecycle?.civicStaffing?.() || { filled: 0, open: 0 };
    const stateFacilities = (this.town.buildings || []).filter((building) => building.kind === 'civic');
    const privateEmployees = privateBusinesses.reduce((sum, business) => sum + (business.employees || 0), 0);
    const privateVacancies = privateBusinesses.reduce((sum, business) => sum + (business.vacancies || 0), 0);
    return {
      private: {
        businesses: privateBusinesses.length,
        offices: privateBusinesses.filter((business) => business.type === 'office').length,
        employees: privateEmployees,
        vacancies: privateVacancies,
        revenue: Math.round(privateBusinesses.reduce((sum, business) => sum + (business.revenue || 0), 0))
      },
      state: {
        facilities: stateFacilities.length,
        employees: civicStaff.filled || 0,
        vacancies: civicStaff.open || 0
      },
      total: {
        employers: privateBusinesses.length + stateFacilities.length,
        employees: privateEmployees + (civicStaff.filled || 0),
        vacancies: privateVacancies + (civicStaff.open || 0)
      }
    };
  }

  stats() {
    const p = this.period || blankPeriod(this.lastDay);
    const citizens = this.town.pedestrians?.citizens || [];
    const householdCash = citizens.reduce((s, c) => s + (c.p.cash || 0), 0);
    const householdDeposits = citizens.reduce((s, c) => s + (c.p.deposits || 0), 0);
    const householdDebt = citizens.reduce((s, c) => s + (c.p.debt || 0), 0);
    const incomes = citizens.map((c) => c.p.grossIncome || 0).filter((v) => v > 0);
    const averageDailyWage = incomes.length ? incomes.reduce((a, b) => a + b, 0) / incomes.length : 0;
    const dailyGDP = p.householdConsumption + p.privateFixedInvestment + p.inventoryInvestment +
      p.governmentConsumption + p.governmentInvestment + p.exports - p.imports;
    const privateCapital = this.capital.privateResidential + this.capital.privateCommercial + this.capital.privateIndustrial;
    const publicCapital = this.capital.publicInfrastructure + this.capital.publicBuildings;
    const tourism = this.tourismStats();
    const serviceSector = this.serviceSectorStats();
    const municipalRevenue = Math.round(p.municipalRevenue ||
      ['transit_fare', 'business_license', 'land_lease', 'tourism_tax', 'utility_fee']
        .reduce((sum, category) => sum + (p.categories[category] || 0), 0));
    const taxRevenueOnly = Math.round(
      (p.categories.income_tax || 0) + (p.categories.sales_tax || 0) +
      (p.categories.property_tax || 0) + (p.categories.corporate_tax || 0) +
      (p.categories.foreign_tax || 0)
    );
    return {
      treasury: Math.round(this.treasury), gdp: Math.round(dailyGDP * 365), gdpDaily: Math.round(dailyGDP),
      gdpPerCapita: Math.round((dailyGDP * 365) / Math.max(1, citizens.length)),
      gdpPeriod: 'annualized from daily transactions', gdpComponents: {
        consumption: p.householdConsumption, privateFixedInvestment: p.privateFixedInvestment,
        inventoryInvestment: p.inventoryInvestment, governmentConsumption: p.governmentConsumption,
        governmentInvestment: p.governmentInvestment, exports: p.exports, imports: p.imports, period: 'daily' },
      taxRevenue: Math.round(p.governmentRevenue), governmentRevenue: Math.round(p.governmentRevenue),
      taxRevenueOnly, municipalRevenue,
      revenueBreakdown: {
        taxes: taxRevenueOnly,
        municipal: municipalRevenue,
        transitFare: Math.round(p.categories.transit_fare || 0),
        businessLicense: Math.round(p.categories.business_license || 0),
        landLease: Math.round(p.categories.land_lease || 0),
        tourismTax: Math.round(p.categories.tourism_tax || 0),
        utilityFee: Math.round(p.categories.utility_fee || 0),
        permits: Math.round(p.categories.permit_fee || 0),
        foreignInvestment: Math.round(p.categories.foreign_tax || 0)
      },
      governmentExpenditure: Math.round(p.governmentExpenditure), budgetBalance: Math.round(p.governmentRevenue - p.governmentExpenditure),
      wages: Math.round(p.wages), rent: Math.round(p.rent), spending: Math.round(p.spending),
      unemployment: Math.round(this.unemployment * 1000) / 10, participation: Math.round(this.participation * 1000) / 10,
      businesses: this.businesses.length, revenue: Math.round(this.businesses.reduce((s, b) => s + b.revenue, 0)),
      serviceSector,
      tourism,
      owners: this.ownersById.size,
      openPosts: this.businesses.reduce((s, b) => s + (b.vacancies || 0), 0),
      employmentChannels: { ...this.lastHiring },
      selfEmployed: this.selfEmployed || 0,
      profit: Math.round(this.businesses.reduce((s, b) => s + b.profit, 0)), dividend: Math.round(this.lastDividend || 0),
      avgIncome: Math.round(averageDailyWage * 365), averageWage: Math.round(averageDailyWage * 365),
      // `wealth` is the whole liquid position, wallet and savings together —
      // it used to be the wallet alone, which read as households getting poorer
      // every time they sensibly banked some of it.
      wealth: Math.round(householdCash + householdDeposits),
      householdCash: Math.round(householdCash),
      householdDeposits: Math.round(householdDeposits),
      householdDebt: Math.round(householdDebt),
      bankDeposits: Math.round(this.accounts.bank.deposits),
      householdSaving: Math.round(p.householdSaving), consumption: Math.round(p.householdConsumption),
      privateFixedInvestment: Math.round(p.privateFixedInvestment), inventoryInvestment: Math.round(p.inventoryInvestment),
      governmentConsumption: Math.round(p.governmentConsumption), governmentInvestment: Math.round(p.governmentInvestment),
      exports: Math.round(p.exports), imports: Math.round(p.imports), tradeBalance: Math.round(p.exports - p.imports),
      privateCapital: Math.round(privateCapital), publicCapital: Math.round(publicCapital),
      landValue: Math.round((this.landAvg || 0) * 1000) / 1000,
      taxRate: Math.round(this.taxScale * 100), effectiveTaxRate: Math.round(this.policyTaxScale() * 100),
      reserve: Math.round(this.reserve), reserveTarget: Math.round(this.reserveTarget),
      debt: Math.round(this.debt), spendingScale: Math.round(this.spendingScale * 100) / 100,
      effectiveSpending: Math.round(this.spendingScale * (1 + (this.policySpending || 0)) * 100) / 100,
      operatingReserve: Math.round(this.requiredPublicReserve(0)),
      projectedDailyBurn: Math.round(this.projectedGovernmentDailyBurn()),
      budget: this.budgetLedger(),
      jurisdiction: this.town.policy?.jurisdiction?.ratio ?? 1, subsidy: this.subsidy ? { name: this.subsidy.name, days: this.subsidy.days } : null,
      period: 'daily flows; current stocks unless labelled annualized',
      fiscalBand: this.fiscalBand || 'healthy', warnings: [...this.warnings]
    };
  }

  describeBusiness(building) {
    const b = building?.businessId ? this.businessesById.get(building.businessId) : this.businesses.find((candidate) => candidate.building === building);
    if (!b) return null;
    return {
      id: b.id, name: b.name, type: b.type, status: b.status, cash: Math.round(b.cash), debt: Math.round(b.debt),
      owner: b.operatorSector === SECTOR.GOVERNMENT ? 'State' : (b.owner ? b.owner.name : null),
      ownerId: b.ownerId,
      inventory: { ...b.inventory }, customers: b.customers, revenue: Math.round(b.revenue), profit: Math.round(b.profit),
      municipalExpense: Math.round(b.municipalExpense || 0),
      rooms: b.type === 'lodging' ? b.rooms : undefined,
      nightlyRate: b.type === 'lodging' ? b.rate : undefined,
      tourismRevenue: b.type === 'lodging' ? Math.round(b.tourismRevenue || 0) : undefined,
      lodgingOccupancy: b.type === 'lodging' && b.rooms ? Math.round((b.customers || 0) / b.rooms * 100) / 100 : undefined,
      rent: Math.round(b.rentExpense), employees: b.employees, jobsRequired: b.jobsRequired,
      staffNeed: b.staffNeed, vacancies: b.vacancies, production: b.production, productionFactor: b.productionFactor,
      landValue: Math.round(this.landValueAt(building.cell[0], building.cell[1]) * 100) / 100
    };
  }
}
