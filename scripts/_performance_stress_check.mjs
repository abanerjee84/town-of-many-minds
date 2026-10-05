import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const targetPopulation = Math.max(300, Number(process.env.STRESS_POPULATION || 1000));
const frames = Math.max(12, Number(process.env.STRESS_FRAMES || 24));
const speed = Math.max(50, Number(process.env.STRESS_SPEED || 50));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.pedestrians?.addCitizen && !!window.sceneMgr && !!window.clock, null, { timeout: 60000 });
  const result = await page.evaluate(({ targetPopulation, frames, speed }) => {
    const town = window.town;
    const clock = window.clock;
    town.generate(1337);
    town.governance.auto = false;
    town.governance.enabled = false;
    town.growth.auto = false;

    // Use the real citizen kit to fill the configured 1,000-person ceiling.
    // The added residents stay indoors, so this stresses the simulation's
    // population scheduler without turning the probe into a route-fixture test.
    const base = town.pedestrians.citizens[0];
    const home = town.buildings.find((building) => building.kind === 'house');
    for (let i = town.pedestrians.citizens.length; i < targetPopulation; i++) {
      const profile = JSON.parse(JSON.stringify(base.p));
      profile.id = `stress-${i}`;
      profile.name = `Stress ${i}`;
      profile.age = 24 + (i % 40);
      profile.relationships = { partner: null, parents: [], children: [] };
      town.pedestrians.addCitizen(profile, home);
    }

    // Keep the full acquired plate in view so the rendering side of the stress
    // test includes the seeded woodland and static lot layer.
    window.sceneMgr.camera.position.set(0, 800, 0);
    window.sceneMgr.camera.lookAt(0, 0, 0);
    window.sceneMgr.controls.target.set(0, 0, 0);
    clock.speed = speed;
    const rawDt = 1 / 60;
    const simDt = rawDt * speed;
    const samples = [];
    for (let frame = 0; frame < frames; frame++) {
      const start = performance.now();
      town.advance(simDt, clock);
      town.lifecycle.update(simDt, clock);
      town.economy.update(simDt, clock);
      town.industry.update(simDt, clock);
      town.growth.update(simDt);
      town.governance.update(simDt, clock);
      town.utilities.update(clock);
      town.resources.update(clock, rawDt);
      window.sceneMgr.setPerformanceMode({
        speed,
        population: town.pedestrians.citizens.length,
        staticVersion: town.staticVersion?.() ?? null
      });
      window.sceneMgr.render();
      samples.push(performance.now() - start);
    }
    const ordered = samples.slice(4).sort((a, b) => a - b);
    const average = ordered.reduce((sum, value) => sum + value, 0) / Math.max(1, ordered.length);
    const percentile = (p) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] || 0;
    return {
      population: town.pedestrians.citizens.length,
      buildings: town.buildings.length,
      vehicles: town.traffic.vehicles.length,
      frameMs: { average, p95: percentile(0.95), max: ordered.at(-1) || 0 },
      performance: town.traffic.performanceStats(),
      renderer: {
        mode: window.sceneMgr.performanceMode,
        calls: window.sceneMgr.renderer.info.render.calls,
        triangles: window.sceneMgr.renderer.info.render.triangles,
        geometries: window.sceneMgr.renderer.info.memory.geometries
      }
    };
  }, { targetPopulation, frames, speed });

  const failures = [
    ...pageErrors.map((message) => `page error: ${message}`),
    result.population !== targetPopulation ? `stress population stopped at ${result.population}` : null,
    result.performance.mode !== 'high-speed' ? `high-speed scheduler was not selected (${result.performance.mode})` : null,
    Math.abs(result.performance.fixedStepSeconds - 0.1) > 0.001 ? `high-speed fixed step is ${result.performance.fixedStepSeconds}` : null,
    result.performance.lodStride < 8 ? `high-speed LOD stride is only ${result.performance.lodStride}` : null,
    result.performance.lagRatio > 0.35 ? `agent lag ratio remains ${result.performance.lagRatio}` : null,
    result.renderer.mode !== 'high-speed' ? `render high-speed mode was not selected (${result.renderer.mode})` : null
  ].filter(Boolean);
  console.log(JSON.stringify({ ok: failures.length === 0, targetPopulation, frames, speed, ...result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
