import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const DAYS = Number(process.env.VEHICLE_PARKING_DAYS || 80);
const SEED = Number(process.env.VEHICLE_PARKING_SEED || 42);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.traffic && !!window.clock);

const result = await page.evaluate(({ seed, days }) => {
  const t = window.town;
  const c = window.clock;
  t.generate(seed);
  c.speed = 100;
  t.governance.auto = false;
  t.growth.auto = false;

  const last = new Map();
  const badBacking = [];
  const parkedMotion = [];
  const badIdleRelease = [];
  let dockingTransitions = 0;
  let parkedTransitions = 0;
  let maxWidth = 0;
  let maxLength = 0;
  for (let day = 0; day < days; day++) {
    const raw = 24 * 60 * 0.9 / c.speed;
    c.update(raw);
    t.advance(1296, c);
    t.lifecycle.update(1296, c);
    t.economy.update(1296, c);
    t.industry.update(1296, c);
    t.growth.update(1296);
    t.utilities.update(c);
    t.resources.update(c, raw);

    for (const v of t.traffic.vehicles) {
      maxWidth = Math.max(maxWidth, v.spec.width);
      maxLength = Math.max(maxLength, v.spec.length);
      const p = v.group.position;
      const previous = last.get(v.uid);
      const parked = v.parkTimer > 0;
      if (v.backing && (v.docking || v.parkSpace)) {
        badBacking.push({ day, uid: v.uid, type: v.type, docking: !!v.docking, claimed: !!v.parkSpace });
      }
      if (previous?.parked && parked && Math.hypot(p.x - previous.x, p.z - previous.z) > 0.03) {
        parkedMotion.push({ day, uid: v.uid, type: v.type });
      }
      if (previous?.parked && !parked && previous.stationHold &&
        !v.incident && v.status !== 'enroute') {
        badIdleRelease.push({ day, uid: v.uid, type: v.type, status: v.status });
      }
      if (v.docking && !previous?.docking) dockingTransitions++;
      if (parked && !previous?.parked) parkedTransitions++;
      last.set(v.uid, {
        parked,
        docking: !!v.docking,
        stationHold: !!v.stationHold,
        x: p.x,
        z: p.z
      });
    }
  }
  return {
    seed,
    days,
    vehicles: t.traffic.vehicles.length,
    dockingTransitions,
    parkedTransitions,
    maxWidth: Number(maxWidth.toFixed(3)),
    maxLength: Number(maxLength.toFixed(3)),
    badBacking,
    parkedMotion,
    badIdleRelease
  };
}, { seed: SEED, days: DAYS });

await browser.close();
console.log(JSON.stringify({ ...result, pageErrors }));

if (pageErrors.length) process.exit(1);
if (!result.vehicles) throw new Error('no vehicles spawned');
if (result.maxWidth > 1.4) throw new Error(`vehicle footprint too wide: ${result.maxWidth}`);
if (result.badBacking.length) throw new Error(`parking reverse glitch: ${JSON.stringify(result.badBacking[0])}`);
if (result.parkedMotion.length) throw new Error(`parked vehicle moved: ${JSON.stringify(result.parkedMotion[0])}`);
if (result.badIdleRelease.length) throw new Error(`idle station vehicle left its bay: ${JSON.stringify(result.badIdleRelease[0])}`);
