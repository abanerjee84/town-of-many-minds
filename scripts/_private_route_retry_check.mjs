import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5176');
  await page.waitForFunction(() => window.town?.traffic);
  const result = await page.evaluate(() => {
    const t = window.town, clock = window.clock;
    t.generate(1337); clock.reset(); clock.speed = 0; clock.hour = 8;
    const car = t.traffic.vehicles.find(v => v.role === 'civilian' && v.driverCitizen);
    if (!car) throw Error('No privately owned vehicle in fixture');
    const citizen = car.driverCitizen;
    citizen.enterBuilding(citizen.home);
    citizen.work = t.buildings.find(b => b !== citizen.home);
    citizen.desiredKey = () => ({ kind: 'work' });
    car.parkTimer = Infinity; car.trip = null; car.lastPrivateTripToken = null;
    car.fuel = car.fuelCapacity;
    let attempts = 0, releases = 0;
    car.planRoute = () => { attempts++; return false; };
    const release = t.parking.release.bind(t.parking);
    t.parking.release = v => { if (v === car) releases++; return release(v); };
    for (let i = 0; i < 40; i++) car.update(0.05, t.traffic.vehicles, t.rng);
    if (attempts > 3 || attempts < 2) throw Error(`Retry cadence: ${attempts} A* attempts in two seconds`);
    if (releases || car.parkTimer !== Infinity || citizen.driving) throw Error('Failed trip released parking or boarded driver');
    const beforeRoad = attempts;
    t.roadGraphVersion++;
    car.beginPrivateTrip(clock, t.rng);
    if (attempts !== beforeRoad + 1) throw Error('Road mutation did not retry immediately');
    const beforePurpose = attempts;
    citizen.desiredKey = () => ({ kind: 'leisure' });
    car.privateDestination = () => ({ purpose: 'leisure', building: citizen.work });
    car.beginPrivateTrip(clock, t.rng);
    if (attempts !== beforePurpose + 1) throw Error('New trip purpose did not retry immediately');
    car.planRoute = () => { attempts++; return true; };
    clock.day++;
    if (!car.beginPrivateTrip(clock, t.rng) || releases !== 1 || citizen.driving !== car)
      throw Error('New day/successful route did not release parking and board driver');
    if (car.beginPrivateTrip(clock, t.rng) || releases !== 1) throw Error('Trip started twice');
    const tripReleases = releases;
    t.generate(1337);
    if (t.traffic.vehicleIndex.entries.size || t.traffic.pedestrianIndex.entries.size)
      throw Error('Reset retained stale indexed agents');
    return { attempts, releases: tripReleases, retrySeconds: 1 };
  });
  assert.equal(result.releases, 1);
  console.log(JSON.stringify({ ok: true, ...result }));
} finally { await browser.close(); }
