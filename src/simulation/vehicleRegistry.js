import { SIM, CELL } from '../core/config.js';
import { SECTOR } from './economicConfig.js';
import { CIVILIAN_VEHICLE_TYPES, SERVICE_VEHICLE_TYPES, EMERGENCY_VEHICLE_TYPES, vehicleFootprint } from '../kits/vehicles/vehicleKit.js';

/**
 * The vehicle stock: a register of durable assets that outlive any single
 * driver, owner or trip.
 *
 * WHY A REGISTER AT ALL
 *
 * The rule this town runs on is that the number of vehicles is not a free
 * parameter. Nobody — not a citizen deciding they need a lift, not the treasury
 * deciding it needs another ambulance, not the player clicking the road tool —
 * can conjure one. What the town has is a STOCK, and the stock has two rules:
 *
 *   1. Private stock is a function of population. `stockTarget(population)`
 *      gives the number of vehicles the town's people are entitled to, at a
 *      fixed cars-per-person rate. Population rises, the entitlement rises, and
 *      the difference is released to the market — that is the only way the
 *      number of private vehicles ever changes, and it is driven by demography
 *      rather than by anybody's decision.
 *
 *   2. The state is the exception, and deliberately so. A government answers to
 *      its citizens, not to a cars-per-capita formula, so `procure` may open a
 *      unit whenever a documented shortfall requires it. It has to be paid for
 *      out of the treasury, and it is recorded as capital expenditure, so the
 *      cost of governing shows up in the budget rather than appearing for free.
 *
 * A vehicle is an ASSET, so it has an owner — the party holding the title. It
 * may also have a HOLDER, the party currently using it. Those are deliberately
 * different fields: a household can hold a car by owning it or by renting it
 * from someone who does, and only the distinction between them makes "buy" and
 * "rent" different operations rather than the same one with a different label.
 *
 * What the register guarantees is structural, not procedural: there is no code
 * path that adds to `this.slots` except `releaseToMarket`, and that one only
 * ever runs up to `stockTarget`. Nothing can take a vehicle out of the register
 * except scrapping it, which returns the money.
 */

/** Private vehicles the town is entitled to, per resident. */
export const VEHICLES_PER_CAPITA = 0.16;

/** A private vehicle is never worth more than this, however rich the buyer. */
const VALUE_CEILING = 45000;

/** Floor on the value of anything roadworthy, so nothing is given away. */
const VALUE_FLOOR = 1800;

/** Years a vehicle is assumed to last before it is worth scrapping. */
const DEPRECIATION_YEARS = 12;

/** What a private vehicle costs to keep on the road for a day. */
const DAILY_UPKEEP = 3.2;

/** What it costs to rent one for a day instead of owning it. */
const DAILY_RENT = 6.5;

let uid = 0;

function nextUnitId() {
  return `veh-${++uid}`;
}

/**
 * What a vehicle of this type is worth today, in the absence of any market
 * history. Deliberately a function of the thing itself — size and class — so
 * two households face the same price for the same car, and a bus is never
 * cheaper than a scooter.
 */
export function baseValue(type) {
  const spec = vehicleFootprint(type);
  const size = spec.length * spec.width;
  // $900 for the smallest car up to $40,000 for the largest, on a mild curve.
  const raw = 900 * Math.pow(size / (3.3 * 1.6), 1.35) * 9;
  return Math.round(Math.max(VALUE_FLOOR, Math.min(VALUE_CEILING, raw)) / 100) * 100;
}

export class VehicleRegistry {
  constructor(town) {
    this.town = town;
    this.slots = [];
    this.agentsBySlot = new Map();
    this.log = [];
    this.turnover = 0;
    this.treasurySpend = 0;
    this.householdSpend = 0;
    this.rentCollected = 0;
  }

  reset() {
    this.slots = [];
    this.agentsBySlot = new Map();
    this.log = [];
    this.turnover = 0;
    this.treasurySpend = 0;
    this.householdSpend = 0;
    this.rentCollected = 0;
  }

  get stock() {
    return this.slots.length;
  }

  get assigned() {
    return this.agentsBySlot.size;
  }

  /** Vehicles with a title but nobody using them — the market's supply. */
  get idle() {
    return this.slots.filter((s) => !s.agent && !s.scrapped);
  }

  /**
   * How many private vehicles the current population is entitled to. This is
   * the number the whole system turns on: the market can only ever hand out
   * slots up to here, so population is the sole driver of private stock.
   */
  stockTarget(population = this.population()) {
    return Math.max(2, Math.round(population * VEHICLES_PER_CAPITA));
  }

  population() {
    return this.town.pedestrians?.citizens?.length || 0;
  }

  /**
   * Open new slots up to the entitlement. Called whenever the population moves.
   *
   * This is the ONLY function permitted to grow the register, and it cannot
   * exceed `stockTarget` — so "a citizen decided to own a car" is not a thing
   * that can happen at any price. The slots it opens are unowned and unassigned:
   * they enter the market and are bought or rented by whoever can actually
   * afford one, which is a separate decision made later.
   */
  releaseToMarket() {
    const target = this.stockTarget();
    // Count only the PRIVATE slots against the entitlement. The state fleet
    // lives in the same register, and counting it here would silently starve the
    // market by the size of the fleet — a town with four emergency vehicles
    // would be four cars short of what its people are entitled to, forever.
    let privateCount = this.slots.filter((s) => s.source === 'population').length;
    const opened = [];
    while (privateCount < target) {
      const type = this.pickMarketType();
      const slot = this.openSlot({ type, owner: null, holder: null, source: 'population' });
      opened.push(slot);
      privateCount++;
    }
    if (opened.length) this.note(`Stock released ${opened.length} vehicle${opened.length === 1 ? '' : 's'} to the market.`);
    return opened;
  }

  /** Private vehicles the town is entitled to, and currently has. */
  privateStock() {
    return this.slots.filter((s) => !s.scrapped && s.source === 'population').length;
  }

  /** State-owned vehicles. Outside the per-capita entitlement by design. */
  stateStock() {
    return this.slots.filter((s) => !s.scrapped && s.source !== 'population').length;
  }

  /**
   * The state acquires a unit. Paid for, recorded, and NOT subject to the
   * per-capita entitlement — a government buys a police car because it needs
   * one, and finds the money or does not get the car.
   */
  /**
   * The state acquires a unit. Paid for, recorded, and NOT subject to the
   * per-capita entitlement — a government buys a police car because it needs
   * one, and finds the money or does not get the car.
   *
   * The unit is also put ON THE ROAD. A slot with no agent is an asset nobody
   * can dispatch, and an emergency vehicle that is paid for but never leaves a
   * depot is the most expensive kind of nothing.
   */
  procure(type, opts = {}) {
    const reason = opts.reason || 'required';
    const value = baseValue(type);
    const paid = this.town.economy.transfer({
      from: 'government',
      to: 'external',
      amount: value,
      category: 'public_investment',
      metadata: { vehicle: type, procurement: reason }
    });
    if (!paid.ok) return { ok: false, reason: 'treasury_short', shortfall: value - this.town.economy.treasury };

    const slot = this.openSlot({
      type,
      owner: { sector: SECTOR.GOVERNMENT, id: 'government' },
      holder: { sector: SECTOR.GOVERNMENT, id: 'government' },
      source: 'procurement',
      paid: value
    });
    slot.procuredFor = reason;
    slot.stationCell = opts.homeCell || null;
    this.treasurySpend += value;
    // Deploy it. If the road network cannot take it right now the slot still
    // exists and the town can crew it later — but say so, because a purchased
    // unit sitting undelivered is worth knowing about.
    const cell = opts.homeCell || this.town.randomRoadCell(this.town.rng) || null;
    const agent = this.town.traffic.spawn(1, cell, {
      slot,
      type,
      homeCell: opts.homeCell || null,
      homeLabel: opts.homeLabel || null
    });
    if (!agent) this.note(`Treasury bought a ${type} for ${reason} — ${money(value)} — but it cannot be crewed yet.`);
    else this.note(`Treasury bought a ${type} for ${reason} — ${money(value)}.`);
    return { ok: true, slot, value, reason, agent };
  }

  /**
   * Buy a vehicle outright: the title moves from its current holder to the
   * buyer, and the seller is paid.
   *
   * The buyer's own money pays for it — top the wallet up from savings if it has
   * to, then debit the wallet. It is tempting to let the payment fall on
   * `external` (which the ledger permits to overdraw) for a vehicle nobody owns
   * yet, but that would hand out a free car to anyone: the household would
   * never be out of pocket. A purchase has to cost the purchaser something, or
   * "can afford it?" is not a question the game is asking.
   */
  buy(slot, buyer, opts = {}) {
    if (!slot || slot.scrapped) return { ok: false, reason: 'no_such_vehicle' };
    if (slot.holder && sameParty(slot.holder, buyer)) return { ok: false, reason: 'already_owns' };
    if (slot.leasedTo && !sameParty(slot.holder, buyer)) return { ok: false, reason: 'currently_leased' };

    const price = opts.price ?? this.currentValue(slot);
    // A government buys through `procure` when it is responding to a shortfall,
    // so that the reason and the capital-expenditure record are attached. This
    // path is the same purchase without one — the player, or a settlement, using
    // a spare market vehicle.
    const isState = buyer?.sector === SECTOR.GOVERNMENT;
    if (!this.topsUpWallet(buyer, price)) return { ok: false, reason: 'cannot_afford', need: price, price };

    // The buyer pays. In both branches the money leaves the BUYER: to the
    // previous owner on a second-hand sale, to the manufacturer (the outside
    // world) on a new one. Routing it the other way round would credit the buyer
    // with the price of the car.
    const seller = slot.owner;
    const paid = this.town.economy.transfer({
      from: buyer,
      to: seller || 'external',
      amount: price,
      category: isState ? 'public_investment' : 'private_investment',
      metadata: { vehicleId: slot.id, vehicle: slot.type, secondHand: !!seller }
    });
    if (!paid.ok) return { ok: false, reason: 'payment_failed', detail: paid.reason };

    const previous = slot.owner;
    // Kept so a failed delivery can hand the title back exactly where it was.
    slot.ownerBefore = previous;
    slot.boughtDayBefore = slot.boughtDay;
    // `value` too: `buy` overwrites it with the sale price, and it is what every
    // later `currentValue` — and therefore every later `buy` — is priced off. A
    // reversed sale that left it marked up inflated the asset for ever, and the
    // rollback claimed to unwind "EVERY counter the sale touched".
    slot.valueBefore = slot.value;
    slot.owner = buyer;
    slot.holder = buyer;
    slot.leasedTo = null;
    slot.leaseEndsDay = null;
    slot.value = price;
    slot.boughtDay = this.town.economy.lastDay;
    slot.purchases = (slot.purchases || 0) + 1;
    if (isState) this.treasurySpend += price;
    else this.householdSpend += price;
    this.turnover++;
    this.note(`${labelFor(buyer)} bought a ${slot.type}${previous ? ' second-hand' : ''} — ${money(price)}.`);
    return { ok: true, slot, price, seller: previous };
  }

  /**
   * Rent a vehicle without buying it. The title stays where it is; the renter
   * gets use of it and pays the owner daily. This is how a household with money
   * but no appetite for capital — or no garage — gets a car at all.
   */
  rent(slot, renter, opts = {}) {
    if (!slot || slot.scrapped) return { ok: false, reason: 'no_such_vehicle' };
    if (slot.holder && sameParty(slot.holder, renter)) return { ok: false, reason: 'already_uses' };
    if (slot.leasedTo && !sameParty(slot.leasedTo, renter)) return { ok: false, reason: 'already_leased' };
    const owner = slot.owner;
    if (!owner) return { ok: false, reason: 'unowned' };
    if (this.affordable(renter, opts.deposit ?? DAILY_RENT * 7) !== true) return { ok: false, reason: 'cannot_afford' };
    // The renter has to be able to KEEP the car, not merely want it. A lease
    // granted to someone traffic cannot place (no adult at home with a job, no
    // driveway it fits in) produces a lease nobody can act on: the car sits
    // leased-but-undriven, the renter is never recorded as having transport, and
    // `adviseHousehold` keeps offering them something else. This is the same
    // gate a purchase passes, and for the same reason.
    const citizen = this.citizenFor(renter);
    if (citizen && !this.canHouse(citizen, slot)) return { ok: false, reason: 'cannot_keep_it' };

    slot.leasedTo = renter;
    // The renter IS the holder. This used to be left unset, and `traffic.spawn`
    // then overwrote `holder` via `registry.assign` with whichever driver the
    // RNG picked from the eligibility pool — not necessarily the renter. Three
    // things followed: the renter never received `citizen.vehicle`, so
    // `adviseHousehold` kept offering them transport and they took a fresh lease
    // every single day; `runDaily` billed the renter while a third party drove;
    // and the guard above was testing `holder` when it meant to test `leasedTo`.
    slot.holder = renter;
    slot.leaseEndsDay = opts.days ?? 30;
    slot.leaseDay = this.town.economy.lastDay;
    this.note(`${labelFor(renter)} rented a ${slot.type} from ${labelFor(owner)}.`);
    return { ok: true, slot, owner, perDay: DAILY_RENT };
  }

  endLease(slot) {
    if (!slot.leasedTo) return false;
    // The holder goes with the lease: a car nobody is leasing is a car nobody is
    // using, and leaving the renter as holder would keep `runDaily` billing them
    // after the lease ended.
    if (sameParty(slot.holder, slot.leasedTo)) slot.holder = null;
    slot.leasedTo = null;
    slot.leaseEndsDay = null;
    slot.leaseDay = null;
    return true;
  }

  /**
   * Has this lease run out?
   *
   * `leaseEndsDay` was written in three places and compared in none, so every
   * lease ran for ever. That is not cosmetic: a renter who keeps a lease open
   * keeps `slot.holder` set, which keeps the vehicle off the market and out of
   * `trimToEntitlement`'s reach, and `runDaily` keeps charging them.
   */
  leaseExpired(slot) {
    if (!slot?.leaseEndsDay) return false;
    return this.town.economy.lastDay >= slot.leaseEndsDay;
  }

  /** End every lease that has run out. Called from the daily settlement. */
  expireLeases() {
    const ended = [];
    for (const slot of this.slots) {
      if (!slot.leasedTo || !this.leaseExpired(slot)) continue;
      this.endLease(slot);
      ended.push(slot);
    }
    return ended;
  }

  /**
   * Release a vehicle back to the market: it loses its holder and goes on sale.
   * Called when its driver dies or leaves town, when a lease lapses, or when a
   * household decides it no longer needs the car. The vehicle is NOT destroyed —
   * the asset persists, which is the whole point of a register.
   */
  releaseToMarketFrom(slot) {
    if (!slot) return false;
    if (slot.leasedTo) this.endLease(slot);
    slot.holder = null;
    slot.agent = null;
    this.agentsBySlot.delete(slot.id);
    return true;
  }

  /**
   * Scrap a vehicle. The only way a slot leaves the register, and the money
   * comes back — depreciation is not the same as destruction, and a town that
   * simply deletes its old cars is a town that quietly invents new ones.
   *
   * The teardown is gated on the payment SUCCEEDING, because the two halves of
   * this have to commit together. It used to be unconditional and only the
   * return value reflected the result, which meant:
   *
   *   - scrapping an unowned market vehicle always failed, because
   *     `external -> external` is rejected as `same_account`. The car was
   *     destroyed for no salvage, the stock count went short, and
   *     `releaseToMarket` then conjured a replacement to fill the gap — the town
   *     lost a vehicle and gained one, for nothing, in both directions.
   *   - a broke payer's vehicle was destroyed anyway.
   *
   * So an unowned vehicle now has no owner to be paid, and the salvage simply
   * accrues to the outside world without a transfer; anything with a real owner
   * must actually be paid for.
   */
  scrap(slot, opts = {}) {
    if (!slot || slot.scrapped) return { ok: false, reason: 'no_such_vehicle' };
    const value = Math.round(this.currentValue(slot) * (opts.salvage ?? 0.25));
    // Nobody owns a freshly released vehicle, so there is no one to pay — the
    // salvage is simply the outside world's, and inventing a self-transfer to
    // "settle" it is what made this path always fail.
    const owner = slot.owner;
    if (owner) {
      const buyer = opts.to || 'external';
      const paid = this.town.economy.transfer({
        from: buyer,
        to: owner,
        amount: value,
        category: 'private_investment',
        metadata: { vehicleId: slot.id, salvage: true }
      });
      if (!paid.ok) {
        // Nothing has changed yet, so there is nothing to roll back — the
        // vehicle stays on the register, exactly as it was.
        return { ok: false, reason: 'salvage_unpaid', value, detail: paid.reason };
      }
    }
    slot.scrapped = true;
    slot.holder = null;
    slot.agent = null;
    this.agentsBySlot.delete(slot.id);
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    this.note(`A ${slot.type} was scrapped — ${money(value)} salvage.`);
    return { ok: true, value, salvaged: true, paidTo: owner || null };
  }

  /**
   * What a vehicle is worth now, after depreciation. Buying and selling both
   * use this, so a vehicle cannot be sold for more than it is worth and the
   * owner's balance sheet is not quietly inflated.
   */
  currentValue(slot) {
    const age = Math.max(0, (this.town.economy.lastDay - (slot.boughtDay ?? 0)) / 365);
    const kept = Math.max(0.08, 1 - age / DEPRECIATION_YEARS);
    return Math.round((slot.value ?? baseValue(slot.type)) * kept);
  }

  /** Book value of everything the state owns — an asset on the balance sheet. */
  stateAssets() {
    return this.slots
      .filter((s) => !s.scrapped && s.owner?.sector === SECTOR.GOVERNMENT)
      .reduce((sum, s) => sum + this.currentValue(s), 0);
  }

  privateAssets() {
    return this.slots
      .filter((s) => !s.scrapped && s.owner && s.owner.sector !== SECTOR.GOVERNMENT)
      .reduce((sum, s) => sum + this.currentValue(s), 0);
  }

  openSlot({ type, owner, holder, source, paid = 0 }) {
    const value = paid || baseValue(type);
    const slot = {
      id: nextUnitId(),
      type,
      role: roleFor(type),
      unit: unitFor(type),
      owner: owner || null,
      holder: holder || null,
      leasedTo: null,
      leaseEndsDay: null,
      leaseDay: null,
      agent: null,
      value,
      paid,
      source,
      boughtDay: this.town.economy.lastDay,
      odometer: 0,
      upkeepPaid: 0,
      scrapped: false
    };
    this.slots.push(slot);
    return slot;
  }

  /**
   * A vehicle the STATE owns and the market has not: the founding fleet. These
   * are funded at founding rather than bought later, because a town that begins
   * its first day with no ambulance has no way to get one — there is no market
   * yet for a vehicle nobody can afford to manufacture into existence.
   */
  seedFleet(type, opts = {}) {
    const value = baseValue(type);
    const slot = this.openSlot({
      type,
      owner: { sector: SECTOR.GOVERNMENT, id: 'government' },
      holder: { sector: SECTOR.GOVERNMENT, id: 'government' },
      source: 'founding-fleet',
      paid: value
    });
    slot.stationCell = opts.homeCell || null;
    slot.homeLabel = opts.homeLabel || null;
    slot.stationKey = opts.stationKey || null;
    this.treasurySpend += value;
    return slot;
  }

  /**
   * Give a driver use of a specific vehicle. Separated from buying and renting
   * because possession is its own fact: the same vehicle can pass from a lease
   * to a purchase to a bequest without ever being destroyed.
   */
  assign(slot, holder) {
    if (!slot || slot.scrapped) return { ok: false, reason: 'no_such_vehicle' };
    slot.holder = holder;
    return { ok: true, slot };
  }

  /** Bind a live traffic agent to a slot, and the slot back to the agent. */
  bind(agent, slot) {
    slot.agent = agent;
    agent.slot = slot;
    this.agentsBySlot.set(slot.id, agent);
  }

  unbind(agent) {
    const slot = agent?.slot;
    if (!slot) return null;
    slot.agent = null;
    this.agentsBySlot.delete(slot.id);
    agent.slot = null;
    return slot;
  }

  /**
   * Can this party actually raise `amount` in spendable money?
   *
   * Savings count, because that is what a bank account is FOR: someone with
   * $200 in their pocket and $9,000 banked can afford a $10,000 car, they just
   * have to draw the money down first. Net worth does not count — a house is
   * not cash, and treating it as spendable money would let every household in
   * town be a car owner on the strength of the building they sleep in.
   */
  affordable(party, amount) {
    if (!party) return false;
    if (party.sector === SECTOR.GOVERNMENT) return this.town.economy.treasury >= amount;
    const citizen = this.citizenFor(party);
    if (!citizen) return false;
    return this.town.economy.purchasingPower(citizen) >= amount;
  }

  /**
   * Make sure a household has `amount` in its WALLET, drawing the shortfall
   * down from its savings if it has to.
   *
   * The wallet is what a transfer actually debits, so this is how a household
   * that has banked most of its money still manages to buy something. It does
   * not itself pay anybody — the caller does that with a real transfer, so the
   * money is never conjured on the way through.
   */
  topsUpWallet(party, amount) {
    const ec = this.town.economy;
    if (party?.sector === SECTOR.GOVERNMENT) return ec.treasury >= amount;
    const citizen = this.citizenFor(party);
    if (!citizen) return false;
    const p = citizen.p;
    if (p.cash >= amount) return true;
    const shortfall = amount - p.cash;
    if (ec.purchasingPower(citizen) < amount) return false;
    return ec.withdrawFor(citizen, shortfall).ok;
  }

  citizenFor(party) {
    if (!party || party.sector !== SECTOR.HOUSEHOLD) return null;
    return (this.town.pedestrians?.citizens || []).find((c) => c.p.id === party.id) || null;
  }

  /**
   * Population can change between the lifecycle removal and the next market
   * settlement.  A vehicle title that still names a departed household is no
   * longer payable through the ledger; retrying that sale every day produced
   * a growing stream of `private_investment/invalid_account` rows and hid the
   * real economy audit behind vehicle churn.  The outside world absorbs an
   * abandoned title, while a departed holder simply releases the car.
   */
  pruneStaleHouseholdTitles() {
    for (const slot of this.slots) {
      if (slot.scrapped) continue;
      if (slot.owner?.sector === SECTOR.HOUSEHOLD && !this.citizenFor(slot.owner)) {
        slot.owner = null;
      }
      if (slot.holder?.sector === SECTOR.HOUSEHOLD && !this.citizenFor(slot.holder)) {
        this.releaseToMarketFrom(slot);
      }
      if (slot.leasedTo?.sector === SECTOR.HOUSEHOLD && !this.citizenFor(slot.leasedTo)) {
        this.endLease(slot);
      }
    }
  }

  /**
   * Daily running costs. This is what makes ownership mean something after the
   * purchase: a vehicle costs money to keep whether or not it is being driven,
   * and the owner pays it. A state unit is paid for out of the treasury, a
   * private one out of the household's pocket — so the fleet's cost lands on
   * whoever actually holds the title.
   */
  runDaily() {
    const ec = this.town.economy;
    this.pruneStaleHouseholdTitles();
    // Expire leases BEFORE charging, so a lapsed renter is not billed for a car
    // they no longer have and the vehicle returns to the market that day.
    this.expireLeases();
    let upkeep = 0;
    let rent = 0;
    let unpaid = 0;
    for (const slot of this.slots) {
      if (slot.scrapped) continue;
      if (slot.leasedTo) {
        // Rent goes from the renter to the owner. Same as an owned vehicle's
        // running cost, except it is income to the title holder rather than a
        // cost, which is the entire reason renting and owning differ.
        const renter = this.citizenFor(slot.leasedTo);
        const owner = this.citizenFor(slot.owner);
        if (renter && owner && renter !== owner) {
          const t = ec.transfer({
            from: { sector: SECTOR.HOUSEHOLD, id: renter.p.id },
            to: { sector: SECTOR.HOUSEHOLD, id: owner.p.id },
            amount: DAILY_RENT,
            category: 'rent',
            metadata: { vehicleId: slot.id }
          });
          if (t.ok) {
            rent += DAILY_RENT;
            this.rentCollected += DAILY_RENT;
          } else {
            unpaid += DAILY_RENT;
          }
        } else if (renter) {
          // Rented from the state: the money goes to the treasury.
          const t = ec.transfer({
            from: { sector: SECTOR.HOUSEHOLD, id: renter.p.id },
            to: 'government',
            amount: DAILY_RENT,
            category: 'rent',
            metadata: { vehicleId: slot.id, to: 'state' }
          });
          if (t.ok) {
            rent += DAILY_RENT;
            this.rentCollected += DAILY_RENT;
          } else {
            unpaid += DAILY_RENT;
          }
        }
        continue;
      }
      if (!slot.holder) continue;
      if (slot.holder.sector === SECTOR.GOVERNMENT) {
        const t = ec.transfer({ from: 'government', to: 'external', amount: DAILY_UPKEEP, category: 'government_procurement', metadata: { vehicleId: slot.id, upkeep: true } });
        if (t.ok) upkeep += DAILY_UPKEEP;
        else unpaid += DAILY_UPKEEP;
      } else {
        const citizen = this.citizenFor(slot.holder);
        if (!citizen) continue;
        const t = ec.transfer({ from: { sector: SECTOR.HOUSEHOLD, id: citizen.p.id }, to: 'external', amount: DAILY_UPKEEP, category: 'private_investment', metadata: { vehicleId: slot.id, upkeep: true } });
        if (t.ok) {
          slot.upkeepPaid += DAILY_UPKEEP;
          upkeep += DAILY_UPKEEP;
        } else {
          unpaid += DAILY_UPKEEP;
        }
      }
    }
    // Release whatever the population is now entitled to, and claw back
    // entitlements the town has shrunk below.
    const released = this.releaseToMarket();
    this.trimToEntitlement();
    // The docstring on `privateCeiling` says exceeding it "would be a bug" —
    // which was true of nothing, because nothing called it. It is checked here,
    // where the entitlement is recomputed, so an invariant that used to be a
    // comment is now an observation.
    const over = this.privateStock() - this.privateCeiling();
    if (over > 0) {
      this.breaches = (this.breaches || 0) + 1;
      events.emit('log', {
        kind: 'event',
        text: `Vehicle stock is ${over} above its entitlement — the population shrank faster than the fleet could be returned to the market.`
      });
    }
    return { upkeep, rent, unpaid, released: released.length, overEntitlement: Math.max(0, over) };
  }

  /**
   * Population can fall, and then the town has more private vehicles than the
   * people left justify. Surplus vehicles go back on sale — but only the ones
   * nobody is using. A vehicle with a driver is not surplus the town can
   * confiscate; it stays until its user releases it, so private stock can sit
   * slightly above the entitlement while a shrink is still working through. That
   * ceiling is `privateCeiling()` and it is honest about it rather than quietly
   * deleting somebody's car mid-commute.
   */
  trimToEntitlement() {
    const target = this.stockTarget();
    const privateOwned = this.slots.filter((s) => !s.scrapped && s.source === 'population');
    if (privateOwned.length <= target) return [];
    let surplus = privateOwned.length - target;
    const released = [];
    for (const slot of privateOwned) {
      if (surplus <= 0) break;
      if (slot.holder) continue;
      this.releaseToMarketFrom(slot);
      released.push(slot);
      surplus--;
    }
    return released;
  }

  /**
   * The most private stock the town can legitimately be carrying: the
   * entitlement, plus the vehicles currently in use that a falling population
   * has not yet taken back. Exceeding THIS would be a bug; exceeding the bare
   * entitlement is not.
   */
  privateCeiling() {
    const inUse = this.slots.filter((s) => !s.scrapped && s.source === 'population' && s.holder).length;
    return this.stockTarget() + inUse;
  }

  /**
   * Clear the market: match the vehicles on offer to the households that want
   * one and can pay, and let the state cover whatever the town is short of.
   *
   * This is the ONLY place a vehicle changes hands, and it is driven by three
   * things in a fixed order of priority:
   *
   *   1. the state's documented shortfalls, because an uncovered emergency
   *      outranks anybody's convenience;
   *   2. households that can afford to OWN one, richest first, because an
   *      owned car is equity and a rented one is an ongoing cost;
   *   3. households that can only afford to RENT, so that being short on capital
   *      is not the same as being unable to get to work.
   *
   * `onlyBuyers` restricts it to step 2 — used at founding, where a brand-new
   * town should not immediately start handing out rental agreements.
   */
  settleMarket(opts = {}) {
    const outcomes = { stateBought: 0, householdsBought: 0, householdsRenting: 0, released: 0, refused: 0 };
    this.pruneStaleHouseholdTitles();

    // 1. The state answers its own shortfalls, if it can pay for them.
    for (const gap of this.stateShortfall()) {
      const result = this.procure(gap.unit, { reason: gap.reason });
      if (result.ok) outcomes.stateBought++;
    }

    // 2. Private buyers, richest first. Sorting by liquid wealth is what makes
    //    the scarce cars go to whoever can actually sustain them, instead of to
    //    whoever clicked first.
    const households = (this.town.pedestrians?.citizens || [])
      .filter((c) => c.home && c.work)
      .map((c) => ({ citizen: c, power: this.town.economy.purchasingPower(c) }))
      .sort((a, b) => b.power - a.power);

    for (const { citizen } of households) {
      if (citizen.vehicle) continue;
      const advice = this.adviseHousehold(citizen);
      if (advice.action === 'buy') {
        // Sale and delivery together: a household is never charged for a
        // vehicle it cannot park.
        const res = this.sellAndDeliver(advice.slot, advice.party, citizen);
        if (res.ok) {
          outcomes.householdsBought++;
          continue;
        }
        outcomes.refused++;
        continue;
      }
      if (opts.onlyBuyers) continue;
      if (advice.action === 'rent') {
        const leased = this.rent(advice.slot, advice.party);
        if (leased.ok) {
          const agent = this.town.traffic.spawn(1, null, { slot: leased.slot, type: leased.slot.type });
          if (agent) outcomes.householdsRenting++;
          else this.endLease(leased.slot);
        }
      }
    }

    // 3. Whatever the population is entitled to but nobody bought stays on sale
    //    for next time. It is released here as well as in `runDaily`, so the
    //    market is fresh at the point of founding.
    const released = this.releaseToMarket();
    outcomes.released = released.length;
    return outcomes;
  }

  /**
   * Can this household actually KEEP this vehicle at home?
   *
   * Money is not the only thing that makes a car buyable, and neither is having
   * a driveway. Traffic's `canTakeVehicle` is the authority on this — same test
   * the spawn path uses, so the market can never disagree with delivery about
   * who is eligible.
   *
   * Getting this wrong is expensive. The market used to buy first and find out
   * afterwards, when the vehicle failed to spawn, rolled back and went straight
   * back on the market to be bought again by somebody else the next day. One
   * truck did 2,070 phantom sales in 300 days that way, churning the ledger for
   * a car nobody ever drove.
   */
  canHouse(citizen, slot) {
    if (!citizen?.home) return false;
    return this.town.traffic?.canTakeVehicle(citizen, vehicleFootprint(slot.type)) === true;
  }

  /**
   * Buy a vehicle and put it on the road, or do neither.
   *
   * The two halves cannot be allowed to come apart. If the sale succeeds but the
   * vehicle cannot be delivered, the money has been taken for nothing — so the
   * sale is reversed and the household is put back where it started. Refunding
   * rather than merely not spawning is what makes a failed purchase a non-event.
   */
  sellAndDeliver(slot, party, citizen) {
    const price = this.currentValue(slot);
    const bought = this.buy(slot, party);
    if (!bought.ok) return bought;
    const agent = this.town.traffic.spawn(1, null, { slot, type: slot.type });
    if (agent) return { ...bought, agent };
    this.reverseSale(slot, party, price);
    return { ok: false, reason: 'could_not_deliver' };
  }

  /** Undo a completed sale: the title and the money both go back. */
  reverseSale(slot, buyer, price) {
    const seller = slot.ownerBefore || 'external';
    this.town.economy.transfer({
      from: seller,
      to: buyer,
      amount: price,
      category: 'private_investment',
      metadata: { vehicleId: slot.id, refund: true }
    });
    slot.owner = slot.ownerBefore || null;
    slot.holder = null;
    slot.leasedTo = null;
    slot.leaseEndsDay = null;
    slot.leaseDay = null;
    slot.boughtDay = slot.boughtDayBefore;
    // `buy` wrote the sale price over `value`, so the rollback has to put the
    // old one back or the vehicle stays marked up for every future negotiation.
    slot.value = slot.valueBefore ?? slot.value;
    // Unwind EVERY counter the sale touched. Leaving `purchases` incremented
    // made a failed sale look like a successful one forever after, which is
    // exactly how a phantom resell loop hides from a turnover check.
    slot.purchases = Math.max(0, (slot.purchases || 1) - 1);
    const isState = buyer?.sector === SECTOR.GOVERNMENT;
    if (isState) this.treasurySpend -= price;
    else this.householdSpend -= price;
    this.turnover = Math.max(0, this.turnover - 1);
    this.note(`Sale of a ${slot.type} reversed — it could not be delivered.`);
  }

  /**
   * What a household should do about transport today, if anything: buy if it
   * can afford one outright, rent if it cannot, and do nothing if it can afford
   * neither. The order matters — owning beats renting for a household that can
   * swing it, because a rental is an ongoing cost for no equity.
   *
   * "Can afford" here means affordable AND able to keep it at home; see
   * `canHouse` for why the second half is not optional.
   */
  adviseHousehold(citizen) {
    const ec = this.town.economy;
    const p = citizen?.p;
    if (!p) return { action: 'none', reason: 'no_profile' };
    const needs = !!citizen.home && !!citizen.work;
    if (!needs) return { action: 'none', reason: 'no_commute' };
    if (citizen.vehicle) return { action: 'none', reason: 'already_has_one' };

    const power = ec.purchasingPower(citizen);
    const houseable = this.idle.filter((s) => s.role === 'civilian' && this.canHouse(citizen, s));
    if (!houseable.length) {
      return { action: 'none', reason: this.idle.length ? 'nothing_fits_at_home' : 'no_stock_available' };
    }

    const cheapest = houseable.reduce((a, b) => (this.currentValue(a) <= this.currentValue(b) ? a : b));
    const price = this.currentValue(cheapest);
    if (power >= price) return { action: 'buy', slot: cheapest, price, party: householdParty(citizen) };
    if (power >= DAILY_RENT * 14) return { action: 'rent', slot: cheapest, price, party: householdParty(citizen) };
    return { action: 'none', reason: 'cannot_afford', power, price };
  }

  /**
   * What the town is short of, and so what the state should buy.
   *
   * Two independent triggers, because a government needs an emergency service
   * for two quite different reasons:
   *
   *   1. DEMAND THAT IS ALREADY WAITING. More calls open right now than there
   *      are units free to answer them. This is the urgent one, and it has
   *      nothing to do with population — a fire in a small town still needs an
   *      engine, and no per-capita formula will ever notice that.
   *
   *   2. COVERAGE. Enough units of each kind for a town this size. The original
   *      rules here tested for a unit count of zero, which the founding fleet
   *      guaranteed — so they could never fire, and a town could double in size
   *      with the same two patrol cars. Coverage is a question about the number
   *      a town needs, not whether it has any at all.
   *
   * `unit` is the display name the fleet roster and incident board use
   * ('Ambulance'); `type` is what a vehicle is actually built from.
   */
  stateShortfall() {
    const need = [];
    const fleet = this.slots.filter((s) => !s.scrapped && s.owner?.sector === SECTOR.GOVERNMENT);
    const emergency = fleet.filter((s) => s.role === 'emergency');
    const count = (unit) => emergency.filter((s) => s.unit === unit).length;
    const pop = this.population();
    const calls = this.town.incidents;

    // 1. Calls with nobody free to take them. `openCount` counts only calls no
    //    unit has accepted, so this is genuinely uncovered demand.
    const open = calls
      ? calls.openCount('medical') + calls.openCount('fire') + calls.openCount('police')
      : 0;
    // "Free" has to mean free TO TAKE A CALL, not "not currently owned by
    // anybody". Measuring it off `holder` counted every stationed unit as busy,
    // so `available` was always zero and the town bought a new emergency
    // vehicle every single day it had an open call — 43 extra vans for a
    // thirty-person town over 300 days.
    const units = (this.town.traffic?.vehicles || []).filter((v) => v.role === 'emergency');
    const busy = units.filter((v) => v.incident).length;
    const available = units.length - busy;
    if (open > available) {
      // Answer with whatever kind is scarcest, so the town is not left with
      // three patrol cars and nobody to put out a fire.
      const scarcest = ['Ambulance', 'Fire', 'Police']
        .map((unit) => ({ unit, type: TYPE_FOR_UNIT[unit], n: count(unit) }))
        .sort((a, b) => a.n - b.n)[0];
      need.push({
        unit: scarcest.type,
        reason: `${open} call${open === 1 ? '' : 's'} waiting, ${available} unit${available === 1 ? '' : 's'} free`,
        urgency: 1
      });
    }

    // 2. Coverage for a town this size.
    for (const { unit, ratio } of COVERAGE) {
      const required = 1 + Math.floor(pop / ratio);
      if (count(unit) < required) {
        need.push({
          unit: TYPE_FOR_UNIT[unit],
          reason: `${pop} residents on ${count(unit)} ${unit.toLowerCase()}`,
          urgency: 0.5
        });
      }
    }
    return need;
  }

  /**
   * The mix of vehicle the market releases. Weighted toward the small, common
   * types, so a growing town gets more hatchbacks than it gets trucks.
   */
  pickMarketType() {
    return this.town.rng.weighted(CIVILIAN_VEHICLE_TYPES).id;
  }

  note(text) {
    this.log.push({ day: this.town.economy.lastDay, text });
    if (this.log.length > 40) this.log.shift();
  }

  stats() {
    const byRole = { emergency: 0, service: 0, civilian: 0 };
    for (const s of this.slots) {
      if (s.scrapped) continue;
      byRole[s.role] = (byRole[s.role] || 0) + 1;
    }
    return {
      stock: this.stock,
      privateStock: this.privateStock(),
      stateStock: this.stateStock(),
      target: this.stockTarget(),
      population: this.population(),
      assigned: this.assigned,
      inUse: this.assigned,
      idle: this.idle.length,
      onMarket: this.idle.filter((s) => !s.owner).length,
      leased: this.slots.filter((s) => s.leasedTo).length,
      byRole,
      perCapita: this.population() ? Math.round((this.stock / this.population()) * 1000) / 1000 : 0,
      stateAssets: this.stateAssets(),
      privateAssets: this.privateAssets(),
      treasurySpend: Math.round(this.treasurySpend),
      householdSpend: Math.round(this.householdSpend),
      rentCollected: Math.round(this.rentCollected),
      turnover: this.turnover
    };
  }

  describe(slot) {
    return {
      id: slot.id,
      type: slot.type,
      role: slot.role,
      unit: slot.unit || null,
      owner: slot.owner ? labelFor(slot.owner) : 'unowned',
      holder: slot.holder ? labelFor(slot.holder) : 'on the market',
      leased: !!slot.leasedTo,
      value: this.currentValue(slot),
      upkeep: DAILY_UPKEEP,
      age: Math.round(this.town.economy.lastDay - (slot.boughtDay ?? 0))
    };
  }
}

function sameParty(a, b) {
  if (!a || !b) return false;
  return a.sector === b.sector && a.id === b.id;
}

export function householdParty(citizen) {
  return { sector: SECTOR.HOUSEHOLD, id: citizen.p.id };
}

export function stateParty() {
  return { sector: SECTOR.GOVERNMENT, id: 'government' };
}

function roleFor(type) {
  const spec = SERVICE_VEHICLE_TYPES.find((v) => v.id === type);
  if (spec?.role === 'transit') return 'transit';
  if (EMERGENCY_VEHICLE_TYPES.some((v) => v.id === type)) return 'emergency';
  if (SERVICE_VEHICLE_TYPES.some((v) => v.id === type)) return 'service';
  return 'civilian';
}

/** Fleet display name -> the vehicle type that provides it. */
const TYPE_FOR_UNIT = { Police: 'police', Ambulance: 'ambulance', Fire: 'fire', Utility: 'utility', Refuse: 'refuse' };

/**
 * Residents per additional unit of each kind. A town starts with one of each
 * (the founding fleet) and earns a second when it outgrows that — roughly every
 * three hours of town's growth for police, a little less often for the heavier
 * appliances. These are the only place the state's appetite for vehicles is
 * tuned, and they are here rather than inline so the shape of the rule is
 * readable at a glance.
 */
const COVERAGE = [
  { unit: 'Police', ratio: 180 },
  { unit: 'Ambulance', ratio: 220 },
  { unit: 'Fire', ratio: 320 }
];

function unitFor(type) {
  return { police: 'Police', ambulance: 'Ambulance', fire: 'Fire', utility: 'Utility', refuse: 'Refuse', bus: 'Bus' }[type] || null;
}

/** Attach the display unit name the fleet roster and incidents already use. */
export function stampUnit(slot) {
  slot.unit = unitFor(slot.type);
  return slot;
}

function money(v) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function labelFor(party) {
  if (!party) return 'nobody';
  if (party.sector === SECTOR.GOVERNMENT) return 'The town';
  if (party.sector === SECTOR.HOUSEHOLD) {
    const c = (window?.town?.pedestrians?.citizens || []).find((x) => x.p.id === party.id);
    return c ? c.p.name : 'a household';
  }
  return `${party.sector} ${party.id}`;
}
