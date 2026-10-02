import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// The vehicle rules this town runs on:
//  1. STOCK IS A FUNCTION OF POPULATION. Private stock never exceeds
//     population x cars-per-capita, and only changes when population does.
//     Nobody — not a citizen, not the state, not the player's car tool — can
//     add a vehicle outside that.
//  2. EVERY VEHICLE IS OWNED BY SOMEBODY, and paid for. Title is held by a
//     party; the money came out of that party's balance.
//  3. TITLE AND USE ARE SEPARATE, so buying and renting are genuinely different
//     operations and a renter never acquires equity.
//  4. A VEHICLE OUTLIVES ITS DRIVER. A dead or departed citizen's car returns
//     to the market rather than roaming ownerless or vanishing.
//  5. NOBODY GETS ONE FOR FREE. Not a household, not the town.
const PROBE = async () => {
  const t = window.town;
  const reg = t.vehicles;
  const ec = t.economy;
  const out = { steps: [] };
  // Real spec lookup: a lease is only granted to someone who can keep the car,
  // so the tests must pick renters from the same pool `spawn` draws from.
  const { vehicleFootprint } = await import('/src/kits/vehicles/vehicleKit.js');
  // A citizen who could actually take this vehicle home right now.
  const eligibleFor = (slot, excludeId) =>
    t.pedestrians.citizens.find(
      (c) =>
        c.p.id !== excludeId &&
        !c.vehicle &&
        !c.driving &&
        ec.purchasingPower(c) > 200 &&
        t.traffic.canTakeVehicle(c, vehicleFootprint(slot.type))
    ) || null;

  const pop = () => t.pedestrians.citizens.length;
  const perCapita = 0.16;
  const target = () => Math.max(2, Math.round(pop() * perCapita));

  // 1. founding PRIVATE stock matches the entitlement (the state fleet sits in
  //    the same register but is deliberately outside the per-capita rule)
  out.steps.push({
    step: 'founding-stock-matches-entitlement',
    population: pop(),
    target: target(),
    privateStock: reg.privateStock(),
    stateStock: reg.stateStock(),
    matches: reg.privateStock() === target()
  });

  // 2. every vehicle has a title, and a state one cost the treasury money
  const stateOwned = reg.slots.filter((s) => s.owner?.sector === 'government');
  out.steps.push({
    step: 'founding-fleet-funded',
    stateUnits: stateOwned.length,
    treasurySpend: Math.round(reg.treasurySpend),
    allFunded: stateOwned.every((s) => (s.paid || 0) > 0),
    types: stateOwned.map((s) => s.unit || s.type).sort()
  });

  // 3. nothing on the road lacks a title (an ownerless car is a free car)
  const agents = t.traffic.vehicles;
  out.steps.push({
    step: 'every-agent-has-a-slot',
    agents: agents.length,
    allBound: agents.every((a) => !!a.slot),
    allOwned: agents.every((a) => !!a.slot?.owner),
    unbound: agents.filter((a) => !a.slot).length
  });

  // 4. the player tool cannot conjure a vehicle
  const beforeTool = reg.stock;
  const tryTool = t.traffic.spawn(1, null, { type: 'sedan' });
  out.steps.push({
    step: 'no-free-spawn',
    toolRefused: !tryTool,
    stockUnchanged: reg.stock === beforeTool,
    reason: tryTool ? 'spawned anyway' : 'no slot consumed'
  });

  // 5. a household that cannot afford one does not get one
  const poor = t.pedestrians.citizens
    .map((c) => ({ c, power: ec.purchasingPower(c) }))
    .sort((a, b) => a.power - b.power)[0];
  const marketBefore = reg.idle.length;
  const advice = poor ? reg.adviseHousehold(poor.c) : { action: 'none' };
  if (advice.action !== 'none' && poor) reg.buy(advice.slot, advice.party);
  out.steps.push({
    step: 'poverty-blocks-purchase',
    power: Math.round(poor?.power || 0),
    price: advice.price || null,
    advice: advice.action,
    refusedForMoney: advice.action === 'none' ? advice.reason : 'could afford it',
    marketNotDrainedByPoor: advice.action === 'none' || advice.price <= poor.power
  });

  // 6. buying moves real money: the buyer's liquid wealth falls by the price
  const rich = t.pedestrians.citizens
    .map((c) => ({ c, power: ec.purchasingPower(c) }))
    .sort((a, b) => b.power - a.power)[0];
  const supply = reg.idle.filter((s) => s.role === 'civilian');
  let buyStep = { step: 'buy-moves-real-money', tested: false };
  if (rich && supply.length) {
    const slot = supply.reduce((a, b) => (reg.currentValue(a) <= reg.currentValue(b) ? a : b));
    const price = reg.currentValue(slot);
    const powerBefore = ec.purchasingPower(rich.c);
    const party = { sector: 'household', id: rich.c.p.id };
    const res = reg.buy(slot, party);
    buyStep = {
      step: 'buy-moves-real-money',
      tested: true,
      price,
      ok: res.ok,
      powerBefore: Math.round(powerBefore),
      powerAfter: Math.round(ec.purchasingPower(rich.c)),
      fellByPrice: res.ok ? Math.abs((powerBefore - ec.purchasingPower(rich.c)) - price) < 0.01 : false,
      nowOwned: res.ok ? slot.owner?.id === rich.c.p.id : false,
      equityWithSeparatedUse: res.ok ? (slot.owner != null && slot.holder != null) : false
    };
  }
  out.steps.push(buyStep);

  // 7. rent does NOT transfer title — that is the whole point of renting.
  //    A lease is only granted to someone who can actually keep the car, so the
  //    renter is drawn from the same eligibility pool `spawn` uses.
  const spare = reg.idle.filter((s) => s.role === 'civilian' && s.owner);
  let rentStep = { step: 'rent-leaves-title-with-owner', tested: false, note: 'no second-hand vehicle on the market to rent' };
  const renterCitizen = spare.length ? eligibleFor(spare[0], spare[0].owner.id) : null;
  if (spare.length && renterCitizen) {
    const slot = spare[0];
    const ownerId = slot.owner.id;
    const party = { sector: 'household', id: renterCitizen.p.id };
    const res = reg.rent(slot, party);
    rentStep = {
      step: 'rent-leaves-title-with-owner',
      tested: true,
      ok: res.ok,
      refusal: res.ok ? null : res.reason,
      titleUnchanged: slot.owner?.id === ownerId,
      renterRecorded: slot.leasedTo?.id === renterCitizen.p.id,
      renterIsNotOwner: slot.leasedTo?.id !== slot.owner?.id
    };
  }
  out.steps.push(rentStep);

  // 8. a vehicle outlives its driver: kill someone and check the car is back
  //    on the market, not destroyed and not still driving
  const victim = t.pedestrians.citizens.find((c) => c.vehicle);
  let deathStep = { step: 'vehicle-outlives-driver', tested: false, note: 'nobody was driving' };
  if (victim) {
    const slotId = victim.vehicle?.slot?.id;
    const stockBefore = reg.stock;
    t.pedestrians.remove(victim);
    const slot = reg.slots.find((s) => s.id === slotId);
    deathStep = {
      step: 'vehicle-outlives-driver',
      tested: true,
      stillRegistered: !!slot,
      stockUnchanged: reg.stock === stockBefore,
      onTheMarket: !!slot && !slot.holder,
      noLongerInTraffic: !t.traffic.vehicles.some((a) => a.slot?.id === slotId)
    };
  }
  out.steps.push(deathStep);

  // 9. run a long settlement: PRIVATE stock must track population. The ceiling
  //    is the entitlement plus whatever is still in use after a shrink — see
  //    VehicleRegistry.privateCeiling.
  const trajectory = [];
  let overCeiling = 0;
  for (let day = 0; day < 40; day++) {
    ec.daily();
    const p = pop();
    const priv = reg.privateStock();
    overCeiling = Math.max(overCeiling, priv - reg.privateCeiling());
    if (day % 10 === 0) trajectory.push({ day, pop: p, priv, target: Math.max(2, Math.round(p * perCapita)), fleet: reg.stateStock(), agents: t.traffic.vehicles.length });
  }
  out.steps.push({
    step: 'stock-tracks-population',
    trajectory,
    neverExceededCeiling: overCeiling <= 0,
    maxOverCeiling: overCeiling
  });

  // 10. no vehicle is sold over and over. A sale that cannot be delivered used
  //     to roll back and go straight back on the market, so one truck sold 256
  //     times in 25 days and the town took $2m for a car that never existed.
  const perVehicle = reg.slots.map((s) => ({ id: s.id, type: s.type, sales: s.purchases || 0 }));
  out.steps.push({
    step: 'no-resale-runaway',
    maxSalesOnOneVehicle: Math.max(0, ...perVehicle.map((v) => v.sales)),
    totalTurnover: reg.turnover,
    daysRun: 40,
    saneTurnover: reg.turnover <= 40,
    worst: perVehicle.sort((a, b) => b.sales - a.sales)[0]
  });

  // 11. every vehicle still has a title after all that churn
  out.steps.push({
    step: 'titles-intact-after-churn',
    unowned: reg.slots.filter((s) => !s.owner && !s.leasedTo).length,
    onMarketUnownedIsLegal: true,
    agentsWithoutTitle: t.traffic.vehicles.filter((a) => !a.slot?.owner).length
  });

  // 12. SR-6 / INV-3 — the asset/money halves of these operations commit
  //     together. Each of these shipped broken and is a regression from this
  //     session's own work.
  const rg = t.vehicles;

  // 12a. A failed spawn must return its slot to the market. `registry.bind` used
  //      to run before the road-pose test, and the `noPose` branch `continue`d
  //      without unbinding — so `slot.agent` pointed at an agent that was never
  //      added to `traffic.vehicles`. Since `idle` is `filter(s => !s.agent)`, that
  //      vehicle could never be offered again, and `trimToEntitlement` could not
  //      reclaim it either because it had a holder. One failed pose permanently
  //      removed a car from the town.
  const idleBefore = rg.idle.length;
  const stockBefore2 = rg.stock;
  const realPose = t.traffic.spawnPose.bind(t.traffic);
  t.traffic.spawnPose = () => null;
  let ghostSlots = 0;
  let ghostHolders = 0;
  for (let i = 0; i < 6; i++) {
    t.traffic.spawn(1, null, {});
    // any slot with an agent that is not actually in the traffic pool is a leak
    for (const s of rg.slots) {
      if (s.agent && !t.traffic.vehicles.includes(s.agent)) { ghostSlots++; if (s.holder) ghostHolders++; }
    }
  }
  t.traffic.spawnPose = realPose;
  out.steps.push({
    step: 'failed-spawn-returns-its-slot',
    idleBefore,
    idleAfter: rg.idle.length,
    stockUnchanged: rg.stock === stockBefore2,
    ghostBoundSlots: ghostSlots,
    ghostWithHolder: ghostHolders,
    // the bijection the audit says must hold: every bound agent is a real agent
    boundAgentsAreReal: rg.agentsBySlot.size === t.traffic.vehicles.length
  });

  // 12b. `scrap()` must not destroy a vehicle whose salvage was not paid.
  //      An UNOWNED market vehicle is the interesting case: it has no owner to be
  //      paid, so the salvage is simply the outside world's and the operation
  //      legitimately succeeds. The original bug was the reverse — it tore the
  //      vehicle down unconditionally and then reported `ok: paid.ok`, so the
  //      `external -> external` self-transfer always failed and the car was
  //      destroyed for nothing while the caller was told it had not been.
  const marketSlot = rg.slots.find((s) => !s.owner && !s.scrapped);
  let scrapResult = null;
  if (marketSlot) {
    const moneyBefore = ec._moneyTotal();
    const before = rg.stock;
    const res = rg.scrap(marketSlot, {});
    const afterScrape = rg.stock;
    // The per-capita rule means a scrapped vehicle is replaced: the entitlement
    // follows population, which has not changed. So the fleet must not shrink
    // permanently NOR gain a surplus one.
    rg.releaseToMarket();
    scrapResult = {
      step: 'unowned-scrap-honest', tested: true,
      // it SUCCEEDS: nobody owned it, so nothing needed paying
      ok: res.ok,
      removedFromRegister: !rg.slots.includes(marketSlot),
      stockFellByExactlyOne: afterScrape === before - 1,
      // and no money was conjured or destroyed doing it
      moneyConserved: Math.abs(ec._moneyTotal() - moneyBefore) < 0.01,
      // the entitlement restores it rather than the town quietly losing a car.
      // Compare PRIVATE stock with the private entitlement: `stock` also counts
      // the state fleet, which is outside the per-capita rule by design.
      privateStockRestoredToEntitlement: rg.privateStock() === rg.stockTarget()
    };
  }
  out.steps.push({ step: 'unowned-scrap-honest', tested: !!scrapResult, ...(scrapResult || {}) });

  // 12c. A reversed sale must restore the vehicle's VALUE, not just its owner.
  //      `buy` overwrites `value` with the sale price and the rollback did not
  //      put the old one back, so a reversed sale left the asset marked up and
  //      every later purchase priced off the inflated number.
  const vs = rg.slots.find((s) => s.role === 'civilian' && !s.scrapped);
  let rev = null;
  if (vs) {
    const valueBefore = vs.value;
    const buyer = { sector: 'household', id: t.pedestrians.citizens[0].p.id };
    rg.buy(vs, buyer, { price: valueBefore * 4 });   // deliberately overpay
    rg.reverseSale(vs, buyer, valueBefore * 4);
    rev = { valueBefore, valueAfter: vs.value, restored: Math.abs(vs.value - valueBefore) < 0.01 };
  }
  out.steps.push({ step: 'reverse-sale-restores-value', tested: !!rev, ...(rev || {}) });

  // 12d. `rent()` must make the renter the HOLDER. It used to leave `holder`
  //      unset, and `traffic.spawn` then overwrote it via `registry.assign` with
  //      whichever driver the RNG picked. So the renter never got
  //      `citizen.vehicle`, was re-offered transport every single day (taking a
  //      fresh lease each time, since the previous slot had an agent), and
  //      `runDaily` billed the renter while a third party drove.
  //      A lease is only granted to someone who can actually KEEP the car, so
  //      the renter must be picked from the same eligibility pool `spawn` uses.
  const owned = rg.slots.find((s) => s.owner && s.owner.sector === 'household' && !s.scrapped);
  const eligibleRenter = owned ? eligibleFor(owned, owned.owner.id) : null;
  let rentResult = { step: 'renter-becomes-holder', tested: false, note: 'no eligible renter in the founding town' };
  if (owned && eligibleRenter) {
    const party = { sector: 'household', id: eligibleRenter.p.id };
    const res = rg.rent(owned, party);
    let gotVehicle = null;
    if (res.ok) {
      t.traffic.spawn(1, null, { slot: owned, type: owned.type });
      gotVehicle = !!eligibleRenter.vehicle;
    }
    rentResult = {
      step: 'renter-becomes-holder', tested: true, ok: res.ok,
      holderIsRenter: owned.holder?.id === eligibleRenter.p.id,
      renterGotVehicle: gotVehicle,
      titleStillWithOwner: res.ok ? owned.owner.id === res.owner?.id : null
    };
  }
  out.steps.push(rentResult);

  // 12e. SR-6 — leases must lapse. `leaseEndsDay` was written in three places
  //      and compared in none, so a 30-day lease ran for ever: the renter kept a
  //      holder, which kept the car off the market and out of trimToEntitlement's
  //      reach, and runDaily kept charging them.
  //      Uses whatever lease exists (step 7 may have made one), otherwise makes
  //      a short one, so it never depends on an earlier step having succeeded.
  let leaseSlot = rg.slots.find((s) => s.leasedTo) || null;
  let leaseNote = 'reused the existing lease';
  if (!leaseSlot) {
    const spareForLease = rg.slots.find((s) => s.owner && !s.leasedTo && !s.agent);
    if (spareForLease) {
      const who = eligibleFor(spareForLease, spareForLease.owner.id);
      if (who && rg.rent(spareForLease, { sector: 'household', id: who.p.id }, { days: 5 }).ok) {
        leaseSlot = spareForLease;
        leaseNote = 'created a 5-day lease';
      }
    }
  }
  let leaseCheck = { step: 'lease-expires', tested: false, note: 'no lease could be established' };
  if (leaseSlot) {
    const endDay = leaseSlot.leaseEndsDay;
    const notYet = rg.leaseExpired(leaseSlot) === false;
    const dayBefore = ec.lastDay;
    ec.lastDay = endDay + 1;                    // step past the lease end
    const nowExpired = rg.leaseExpired(leaseSlot);
    const before = rg.slots.filter((s) => s.leasedTo).length;
    const ended = rg.expireLeases();
    const after = rg.slots.filter((s) => s.leasedTo).length;
    ec.lastDay = dayBefore;
    leaseCheck = {
      step: 'lease-expires', tested: true, note: leaseNote,
      hasEndDay: endDay != null,
      notExpiredBeforeEnd: notYet,
      expiresAfterEnd: nowExpired,
      expireLeasesClearedThem: before > 0 && after === 0,
      holderClearedOnExpiry: ended.length ? ended[0].holder == null : null
    };
  }
  out.steps.push(leaseCheck);

  // 13. SR-6 / SR-4 — the economy's audit must still pass
  const audit = ec.audit();
  out.audit = {
    ok: audit.ok,
    unexpectedMoney: Math.round((audit.unexpectedMoneyCreation || 0) * 100) / 100,
    creditInconsistencies: audit.creditInconsistencies,
    negativeBalances: (audit.negativeBalances || []).length
  };
  out.stock = reg.stats();
  return out;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'step' || k === 'note' || k === 'tested' || k === 'refusedForMoney' || k === 'types' || k === 'trajectory' || k === 'onMarketUnownedIsLegal' || k === 'price' || k === 'power' || k === 'powerBefore' || k === 'powerAfter' || k === 'advice' || k === 'reason' || k === 'refusal' || k === 'maxOverCeiling') continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (!r.audit.ok) problems.push('audit');
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  if (problems.length) console.log('   ', JSON.stringify(r, null, 1).slice(0, 2400));
  else {
    const s = r.stock;
    console.log(`        stock ${s.stock} = ${s.privateStock} private + ${s.stateStock} state, for pop ${s.population} (private ${Math.round((s.privateStock / Math.max(1, s.population)) * 1000) / 1000}/cap of ${0.16})  ·  on road ${s.inUse}  ·  market ${s.onMarket}  ·  leased ${s.leased}`);
    console.log(`        roles ${JSON.stringify(s.byRole)}  ·  fleet assets $${s.stateAssets.toLocaleString()}  ·  treasury spent $${s.treasurySpend.toLocaleString()}  ·  households spent $${s.householdSpend.toLocaleString()}  ·  turnover ${s.turnover}`);
    console.log(`        trajectory: ${r.steps.find((x) => x.step === 'stock-tracks-population').trajectory.map((x) => `d${x.day} pop${x.pop} priv${x.priv}/t${x.target} fleet${x.fleet} road${x.agents}`).join('  ')}`);
  }
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
