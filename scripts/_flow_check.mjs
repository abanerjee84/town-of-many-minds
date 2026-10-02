import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// INV-6 — the numbers the town reports, and the behaviour it exhibits, must
// mean what they say.
//
// Each finding here was measured against the old code. They share one theme:
// the simulation naming a state it did not then honour.
//   - congestion counted `bay`/`dock`/`fuel` as traffic, contradicting the
//     module's own rule, and drove every moving vehicle's speed. Five cars
//     waiting for a bay slowed the town by ~31%.
//   - `escalate` treated a parking hold as a deadlock: 13 re-plans, 2 uncommanded
//     reverses and 6 silent destination changes in 90 s for one car, plus 33
//     phantom road-demand records in 60 s from a vehicle that never moved — and
//     those records are what the council reads to site a new street.
//   - a car parked at home with a dry tank was unreachable by the fuel logic and
//     by `recoverStranded`: invisible and unrecoverable.
//   - a dry vehicle looped to an empty pump for ever, with no terminal state.
const PROBE = () => {
  const t = window.town;
  const traffic = t.traffic;
  const out = { steps: [] };

  // 1. Congestion must not be produced by kerbside parking.
  //    Assert on the HELD component specifically, not the total: `over` counts
  //    several vehicles sharing a cell, which is real congestion whatever they
  //    are waiting for, and leaving them stacked made this test measure the wrong
  //    term.
  const moved = traffic.vehicles.slice();
  for (const v of moved) {
    v._savedHoldT = v.holdT;
    v._savedWaitKind = v.waitKind;
    v.holdT = 12;                 // past CONGESTION_WINDOW
    v.waitKind = 'bay';
    v.parkTimer = 0;               // counted as live
  }
  const allParking = traffic.computeCongestion(0.5);
  for (const v of moved) {
    v.holdT = v._savedHoldT;
    v.waitKind = v._savedWaitKind;
    delete v._savedHoldT;
    delete v._savedWaitKind;
  }
  traffic.computeCongestion(0.5);

  // Same again, but with a wait kind that IS congestion, to prove the metric
  // still responds to real traffic — otherwise "0 when parking" could just mean
  // the counter is broken.
  const moved2 = traffic.vehicles.slice();
  for (const v of moved2) {
    v._savedHoldT = v.holdT;
    v._savedWaitKind = v.waitKind;
    v.holdT = 12;
    v.waitKind = 'queue';
    v.parkTimer = 0;
  }
  const allQueued = traffic.computeCongestion(0.5);
  for (const v of moved2) {
    v.holdT = v._savedHoldT;
    v.waitKind = v._savedWaitKind;
    delete v._savedHoldT;
    delete v._savedWaitKind;
  }
  traffic.computeCongestion(0.5);

  out.steps.push({
    step: 'parking-is-not-congestion',
    liveVehicles: moved.length,
    heldWhileAllWaitingForABay: allParking.held,
    heldWhileAllQueued: allQueued.held,
    // the old code counted these as held, and that number drove every moving
    // vehicle's target speed
    noHeldForParking: allParking.held === 0,
    // and the metric still measures actual queues
    stillMeasuresRealQueues: allQueued.held > allParking.held
  });

  // 2. `escalate` must not fire on a vehicle that is waiting to park.
  const victim = traffic.vehicles.find((v) => v.role === 'civilian' && v.driverCitizen);
  let esc = null;
  if (victim) {
    victim.holdT = 60;                  // far past every escalation threshold
    victim.rerouteT = 0;
    victim.jamLevel = 0;
    victim._savedJam = victim.jamState;
    victim._savedIdx = victim.idx;
    victim._savedPoints = victim.points;
    // and force the parking-hold flags the audit described
    victim.awaitingBay = true;
    traffic.escalate(victim);
    esc = {
      step: 'parking-hold-is-not-a-deadlock',
      tested: true,
      holdT: 60,
      jamStateAfter: victim.jamState,
      jamLevelAfter: victim.jamLevel,
      routeReplanned: victim.points !== victim._savedPoints || victim.idx !== victim._savedIdx,
      // the old code rerouted, backed out, and after 20s replaced the
      // destination entirely
      leftAlone: victim.jamLevel === 0 && victim.jamState === victim._savedJam
        && victim.points === victim._savedPoints && victim.idx === victim._savedIdx
    };
    // restore
    victim.awaitingBay = false;
    victim.holdT = 0;
    victim.rerouteT = 0;
    victim.jamLevel = 0;
    victim.jamState = victim._savedJam;
    victim.points = victim._savedPoints;
    victim.idx = victim._savedIdx;
    delete victim._savedJam;
    delete victim._savedIdx;
    delete victim._savedPoints;
  } else {
    esc = { step: 'parking-hold-is-not-a-deadlock', tested: false, note: 'no drivable civilian' };
  }
  out.steps.push(esc);

  // 3. Road demand is recorded on COMPLETION, not on planning. A re-plan is not
  //    a journey.
  const before = traffic.demandTrips.length;
  const p = traffic.vehicles[0];
  if (p) {
    const fakeFrom = p.currentCell() || [1, 1];
    p.planRoute(t.traffic.rng, [20, 20]);
  }
  const afterPlan = traffic.demandTrips.length;
  out.steps.push({
    step: 'replanning-is-not-demand',
    demandBefore: before,
    demandAfterAPlan: afterPlan,
    // the old code recorded inside planRoute, so every re-plan counted
    noPhantomDemand: afterPlan === before
  });

  // 4. A home-parked vehicle with a dry tank must be able to set off for a pump.
  const dry = traffic.vehicles.find((v) => v.role === 'civilian' && v.driverCitizen && v.parkTimer > 0);
  let dryStep = { step: 'parked-dry-vehicle-can-reach-a-pump', tested: false, note: 'no home-parked civilian' };
  if (dry) {
    const savedFuel = dry.fuel;
    dry.fuel = 0;
    dry.fuelStop = null;
    dry._savedPark = dry.parkTimer;
    dry.update(0.05, traffic.vehicles, traffic.rng);
    dryStep = {
      step: 'parked-dry-vehicle-can-reach-a-pump',
      tested: true,
      fuel: savedFuel,
      fuelAfter: dry.fuel,
      setOffForAPump: !!dry.fuelStop || dry.parkTimer === 0 || dry.speed > 0,
      // the old code left it parked at Infinity with stranded never set, so it
      // was invisible to recoverStranded AND could not move
      noInvisibleStranded: dry.stranded === false || dry.fuelStop != null
    };
    dry.fuel = savedFuel;
    dry.fuelStop = null;
    dry.parkTimer = dry._savedPark;
    delete dry._savedPark;
  }
  out.steps.push(dryStep);

  // 5. A dry vehicle must not loop to an empty pump for ever.
  const pumper = traffic.vehicles.find((v) => v.role === 'civilian');
  let pumpStep = { step: 'empty-pump-does-not-loop', tested: false, note: 'no civilian' };
  if (pumper) {
    const site = t.resources?.sites?.find((s) => s.kind === 'gas');
    const realDispense = t.resources.dispenseFuel;
    t.resources.dispenseFuel = () => 0;              // the pump is empty
    pumper.fuel = 0;
    pumper.fuelStop = { site, resume: null };
    const dispatchedBefore = traffic.tripStarts;
    pumper.finishFuelStop();
    pumpStep = {
      step: 'empty-pump-does-not-loop',
      tested: true,
      fuelAfter: pumper.fuel,
      // fuel is NOT invented — that invariant is untouched
      noFuelInvented: pumper.fuel === 0,
      // and the vehicle waits instead of immediately setting off again
      parkedNotDeparting: pumper.fuelStop === null && pumper.parkTimer > 0,
      waited: Math.round(pumper.parkTimer),
      stayedPut: traffic.tripStarts === dispatchedBefore
    };
    t.resources.dispenseFuel = realDispense;
    pumper.fuelStop = null;
    pumper.fuel = 20;
    pumper.parkTimer = 0;
  }
  out.steps.push(pumpStep);

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
  await page.waitForTimeout(800);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (['step', 'note', 'tested', 'liveVehicles', 'heldWhileAllWaitingForABay', 'heldWhileAllQueued',
           'holdT', 'jamStateAfter', 'jamLevelAfter', 'routeReplanned', 'demandBefore', 'demandAfterAPlan',
           'fuel', 'fuelAfter', 'waited'].includes(k)) continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  for (const s of r.steps) {
    const { step, tested, note, ...rest } = s;
    if (tested === false) continue;
    console.log(`        ${step}: ${JSON.stringify(rest)}`);
  }
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 4) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
