import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5179';
const DAYS = Number(process.env.BUS_STUCK_DAYS || 180);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.growth, null, { timeout: 60000 });
  const result = await page.evaluate(({ days }) => {
    const town = window.town;
    town.generate(1337);
    const clock = window.clock;
    clock.speed = 50;
    town.governance.auto = false;
    town.growth.auto = false;
    const rawDay = 24 * 60 * 0.9 / clock.speed;
    const dayStep = 1296;
    let maxTransitHold = 0;
    let worst = null;
    let forcedRefuel = false;
    let refuelEntered = false;
    let refueled = false;
    let stationHoldDays = 0;
    let maxStationHoldDays = 0;
    let refuelProbe = null;

    for (let day = 0; day < days; day++) {
      clock.update(rawDay);
      town.advance(dayStep, clock);
      town.lifecycle.update(dayStep, clock);
      town.economy.update(dayStep, clock);
      town.industry.update(dayStep, clock);
      town.growth.update(dayStep);
      town.utilities.update(clock);
      town.resources.update(clock, rawDay);
      if (day % 8 === 0) {
        const plan = town.growth.evaluate({ amenities: false });
        const code = window.planCode(plan);
        if (code) town.governance.forceRequest(`INTENT: ${code}`);
      }
      for (const vehicle of town.traffic.vehicles.filter((item) => item.role === 'transit')) {
        // Force one realistic low-tank diversion so the regression covers the
        // pump approach and docking path, not only the ordinary bus loop.
        if (!forcedRefuel) {
          vehicle.fuel = 5;
          forcedRefuel = true;
          refuelProbe = { day: day + 1, uid: vehicle.uid };
        }
        const atFuelStation = !!vehicle.fuelStop || !!vehicle.docking && vehicle.docking.kind === 'pump';
        if (atFuelStation) {
          refuelEntered = true;
          stationHoldDays++;
          maxStationHoldDays = Math.max(maxStationHoldDays, stationHoldDays);
        } else {
          stationHoldDays = 0;
        }
        if (forcedRefuel && vehicle.fuel > 5 && !vehicle.fuelStop && !vehicle.docking) refueled = true;
        if (vehicle.holdT <= maxTransitHold) continue;
        maxTransitHold = vehicle.holdT;
        const cell = town.grid.worldToCell(vehicle.group.position.x, vehicle.group.position.z);
        worst = {
          day: day + 1,
          uid: vehicle.uid,
          cell: [cell.x, cell.y],
          hold: Math.round(vehicle.holdT * 100) / 100,
          wait: vehicle.waitKind,
          jam: vehicle.jamState
        };
      }
    }

    const buses = town.traffic.vehicles
      .filter((vehicle) => vehicle.role === 'transit')
      .map((vehicle) => {
        const cell = town.grid.worldToCell(vehicle.group.position.x, vehicle.group.position.z);
        return {
          uid: vehicle.uid,
          cell: [cell.x, cell.y],
          hold: Math.round(vehicle.holdT * 100) / 100,
          wait: vehicle.waitKind,
          jam: vehicle.jamState
        };
      });
    const transport = town.transport.stats();
    const failures = [];
    if (!transport.ready) failures.push('seeded horizon never commissioned a ready bus route');
    if (!transport.fleet || !transport.operationalFleet) failures.push('ready bus route has no operational fleet');
    if (maxTransitHold > 8) failures.push(`transit hold reached ${Math.round(maxTransitHold * 100) / 100}s`);
    if (!forcedRefuel) failures.push('seeded horizon never commissioned a bus for the refuel probe');
    if (!refuelEntered) failures.push('forced low-fuel bus never reached a legal pump leg');
    if (!refueled) failures.push('forced low-fuel bus did not leave the pump with more fuel');
    if (maxStationHoldDays > 24) failures.push(`bus held at fuel station for ${maxStationHoldDays} sampled days`);
    return {
      days,
      transport,
      maxTransitHold: Math.round(maxTransitHold * 100) / 100,
      maxStationHoldDays,
      refuelProbe,
      forcedRefuel,
      refuelEntered,
      refueled,
      worst,
      buses,
      failures
    };
  }, { days: DAYS });

  const failures = [...result.failures, ...errors.map((message) => `page error: ${message}`)];
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, errors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
