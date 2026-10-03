import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth, null, { timeout: 60000 });

const result = await page.evaluate(({ days }) => {
  const t = window.town;
  t.generate(1337);
  const c = window.clock;
  c.speed = 50;
  t.governance.auto = false;
  t.growth.auto = false;
  const raw = 24 * 60 * 0.9 / c.speed;
  const dt = 1296;
  const snapshot = (day) => {
    const facilities = {};
    for (const b of t.buildings) if (b.kind === 'civic') facilities[b.facility] = (facilities[b.facility] || 0) + 1;
    const fleet = t.vehicles.slots.filter((s) => !s.scrapped && s.owner?.sector === 'government');
    const busAssets = fleet.filter((s) => s.type === 'bus').map((s) => ({
      id: s.id,
      stationKey: s.stationKey || null,
      stationCell: s.stationCell || null,
      operational: !!(s.agent?.transitRoute?.length > 1)
    }));
    const units = {};
    for (const s of fleet) units[s.unit || s.type] = (units[s.unit || s.type] || 0) + 1;
    return {
      day,
      pop: t.pedestrians.citizens.length,
      facilities,
      fleet: { total: fleet.length, emergency: fleet.filter((s) => s.role === 'emergency').length, units },
      transport: t.transport.stats(),
      busAssets,
      shortfall: t.vehicles.stateShortfall().map((x) => x.unit),
      civicLoads: t.growth.civicLoads?.(t) || [],
      ranked: t.growth.ranked().slice(0, 8).map((x) => ({ type: x.type, score: x.score, opts: x.opts }))
    };
  };
  const snapshots = [snapshot(0)];
  for (let day = 0; day < days; day++) {
    c.update(raw);
    t.advance(dt, c);
    t.lifecycle.update(dt, c);
    t.economy.update(dt, c);
    t.industry.update(dt, c);
    t.growth.update(dt);
    t.utilities.update(c);
    t.resources.update(c, raw);
    if (day % 8 === 0) {
      const plan = t.growth.evaluate({ amenities: false });
      const code = window.planCode(plan);
      if (code) t.governance.forceRequest(`INTENT: ${code}`);
    }
    if (day % 100 === 99 || day === days - 1) snapshots.push(snapshot(day + 1));
  }
  const final = snapshot(days);
  const failures = [];
  if (final.transport.ready && final.transport.fleet < 1) failures.push('transit network has no state bus');
  if (final.transport.ready && final.transport.operationalFleet !== final.transport.fleet) failures.push('one or more state buses lack a station or live route');
  if (final.transport.ready && final.busAssets.some((bus) => !bus.stationKey || !bus.stationCell || !bus.operational)) failures.push('bus asset metadata is incomplete');
  if (final.shortfall.length) failures.push(`uncovered emergency service: ${final.shortfall.join(', ')}`);
  return { snapshots, final, failures };
}, { days: Number(process.env.SERVICE_AUDIT_DAYS || 800) });

console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();
if (errors.length || result.failures?.length) process.exitCode = 1;
