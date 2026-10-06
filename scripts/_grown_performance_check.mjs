import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.town?.economy);
  const fixture = await page.evaluate(() => {
    const t = window.town, c = window.clock;
    t.generate(1337); c.reset(); c.speed = 50;
    t.governance.auto = false; t.growth.auto = false;
    for (let day = 0; day < 180; day++) {
      c.update(1296 / 50);
      t.advance(1296, c); t.lifecycle.update(1296, c);
      t.economy.update(1296, c); t.industry.update(1296, c);
      t.growth.update(1296); t.utilities.update(c); t.resources.update(c, 1296 / 50);
      if (day % 3 === 0) {
        const p = t.growth.evaluate({ amenities: false });
        if (p) t.governance.forceRequest(`INTENT: ${window.planCode(p)}`);
      }
    }
    c.hour = 8;
    // Augment the naturally grown fixture to match the reported town's load.
    // All extra buildings use the real placement boundary and acquired frontage.
    for (const [x, y] of t.grid.roadCells()) {
      if (t.buildings.length >= 51) break;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (t.buildings.length >= 51) break;
        t.placeBuilding(x+dx, y+dy, 'residential', { floors: 3 });
      }
    }
    const homes = t.buildings.filter(b => b.kind === 'house');
    const base = t.pedestrians.citizens[0].p;
    for (let i=t.pedestrians.citizens.length; i<170; i++) {
      const p=JSON.parse(JSON.stringify(base));
      p.id=`grown-load-${i}`; p.name=`Load resident ${i}`; p.age=30;
      p.relationships={partner:null,parents:[],children:[]};
      t.pedestrians.addCitizen(p, homes[i % homes.length]);
    }
    // Registered, owned vehicles, never unowned mock meshes.
    // Service vehicles avoid fabricating employment/driver credentials merely
    // to populate the load fixture; the natural civilian fleet remains intact.
    for (let attempt=0; t.traffic.vehicles.length<38 && attempt<80; attempt++) {
      const slot=t.vehicles.openSlot({type:'utility', owner:{sector:'government',id:'government'}, source:'performance-fixture'});
      if (!t.traffic.spawn(1, null, {slot, type:'utility'})) slot.scrapped=true;
    }
    const site = t.resources.sites?.find(s => s.kind === 'farm');
    if (site?.cells?.[0]) window.interaction.select({ kind: 'cell', x: site.cells[0][0], y: site.cells[0][1] });
    const snapshot=t.stats({force:true});
    const kitBytes=JSON.stringify(snapshot.kitStats).length;
    const summaryRows=snapshot.governance.staff?.civic?.rows || [];
    const leanStaff=summaryRows.every(row=>!('building' in row) && 'buildingId' in row);
    const profile = {};
    const wrap = (object, method, label) => {
      if (typeof object?.[method] !== 'function') return;
      const fn = object[method];
      object[method] = function (...args) {
        const start = performance.now();
        try { return fn.apply(this, args); }
        finally {
          const row = profile[label] ||= { calls: 0, ms: 0, max: 0 };
          const ms = performance.now() - start;
          row.calls++; row.ms += ms; row.max = Math.max(row.max, ms);
        }
      };
    };
    for (const [object, method, label] of [
      [t, 'advance', 'advance'], [t, 'stats', 'stats'],
      [t.lifecycle, 'update', 'lifecycle'], [t.economy, 'update', 'economy'],
      [t.industry, 'update', 'industry'], [t.growth, 'update', 'growth'],
      [t.resources, 'update', 'resources'], [t.utilities, 'update', 'utilities'],
      [t.governance, 'update', 'governance'], [window.hud, 'update', 'hud'],
      [window.interaction, 'update', 'inspector'], [window.sceneMgr, 'render', 'render'],
      [t.growth, 'archetypeOpportunity', 'archetypeOpportunity'],
      [t.growth, 'ranked', 'ranked'], [t.traffic, 'runShared', 'agents']
    ]) wrap(object, method, label);
    for (const key of ['vehicles','lifecycle','economy','foreignInvestment','industry','forest','weather','growth','perimeter','transport','society','governance','kpi','utilities','resources','policy','research','parcels']) {
      wrap(t[key], 'stats', `${key}.stats`);
    }
    wrap(t.kits, 'kitStats', 'kitStats');
    window.__grownProfile = profile;
    window.__grownFrames = [];
    let last = performance.now();
    const sample = now => {
      window.__grownFrames.push(now - last); last = now;
      if (window.__grownFrames.length === 10) {
        window.__grownStart = { wall: now, elapsed: c.elapsed };
        t.traffic.timeDroppedTotal = 0;
      }
      window.__grownEnd = { wall: now, elapsed: c.elapsed };
      if (window.__grownFrames.length < 125) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return { population: t.pedestrians.citizens.length, buildings: t.buildings.length,
      vehicles: t.traffic.vehicles.length, day: c.day, kitBytes, leanStaff };
  });
  console.log(JSON.stringify({ fixture }));
  await page.waitForFunction(() => window.__grownFrames?.length >= 120, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const samples = window.__grownFrames.slice(10).sort((a,b) => a-b);
    return { frameMs: { average: samples.reduce((s,v) => s+v,0)/samples.length,
      p95: samples[Math.floor(samples.length*.95)] },
      clockRate: (window.__grownEnd.elapsed-window.__grownStart.elapsed) /
        ((window.__grownEnd.wall-window.__grownStart.wall)/1000),
      profile: window.__grownProfile, performance: window.town.traffic.performanceStats(),
      renderer: { calls: window.sceneMgr.renderer.info.render.calls,
        triangles: window.sceneMgr.renderer.info.render.triangles },
      activeVehicles: window.town.traffic.vehicles.filter(v => v.parkTimer <= 0 && v.points?.length).length,
      gpu: (()=>{const gl=window.sceneMgr.renderer.getContext();const info=gl.getExtension('WEBGL_debug_renderer_info');return info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'unavailable';})() };
  });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  assert.equal(errors.length,0,'browser errors during grown-town frame test');
  assert.equal(fixture.population,170);
  assert(fixture.buildings>=45,'fixture must contain many real buildings');
  assert(fixture.vehicles>=35,'fixture must contain active traffic');
  assert(fixture.leanStaff,'report must not include live civic building rigs');
  assert(fixture.kitBytes<100000,'kit diagnostics unexpectedly contain heavy state');
  assert.equal(result.performance.mode,'normal');
  assert.equal(result.performance.fixedStepSeconds,0.05);
  assert(result.clockRate>0,'foreground simulation clock did not advance');
  assert(result.activeVehicles>0,'traffic fixture must not be idle');
  const averageStats=result.profile.stats.ms/result.profile.stats.calls;
  assert(averageStats<40,`grown-town stats cost ${averageStats.toFixed(1)}ms`);
  assert(result.profile['economy.stats'].calls/result.profile.stats.calls<10,'price quotes rebuilt the economy report');
} finally { await browser.close(); }
