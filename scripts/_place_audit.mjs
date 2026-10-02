import { chromium } from 'playwright';

const OUT = 'C:/Users/abhi/Downloads/TOWN3/shots';
const URL = process.env.APP_URL || 'http://localhost:5173';
const SEED = process.env.SEED || '1337';

const AUDIT = () => {
  const t = window.town;
  const g = t.grid;
  const profile = window.urbanProfile(g);
  const works = t.buildings.filter((b) => b.purpose === 'industrial' || b.kind === 'factory');
  const rows = works.map((b) => {
    const cells = b.footprint && b.footprint.length ? b.footprint : [b.cell];
    const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
    const my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    return {
      name: b.name,
      subtype: b.subtype,
      factoryType: b.house?.spec?.factoryType,
      cells: cells.length,
      cols: cells.reduce((s, c) => s + c[0], 0) / cells.length,
      rows: cells.reduce((s, c) => s + c[1], 0) / cells.length,
      at: b.cell,
      edge: Math.hypot(mx - profile.cx, my - profile.cy) / profile.r,
      zone: b.zone,
      cellZone: g.zone[g.idx(b.cell[0], b.cell[1])],
      parcelType: t.parcels?.at(b.cell[0], b.cell[1])?.type,
      setback: t.parcels?.at(b.cell[0], b.cell[1])?.setback
    };
  });
  // zoning census
  const zones = {};
  for (let i = 0; i < g.zone.length; i++) {
    const z = g.zone[i];
    if (z) zones[z] = (zones[z] || 0) + 1;
  }
  const parcelTypes = {};
  for (const p of t.parcels?.parcels || []) {
    parcelTypes[p.type] = (parcelTypes[p.type] || 0) + 1;
  }
  const checks = (t.validation?.checks || []).map((c) => `${c.status}  ${c.id}  ${c.detail}`);
  return {
    profile: { cx: +profile.cx.toFixed(2), cy: +profile.cy.toFixed(2), r: +profile.r.toFixed(2) },
    worksCount: works.length,
    works: rows.map((r) => ({
      ...r,
      edge: +r.edge.toFixed(3),
      cols: +r.cols.toFixed(1),
      rows: +r.rows.toFixed(1)
    })),
    zones,
    parcelTypes,
    speed: window.clock.speed,
    checks
  };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const seeds = SEED.split(',');
for (const seed of seeds) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(1200);
  const a = await page.evaluate(AUDIT);
  console.log(`\n===== SEED ${seed} =====`);
  console.log('profile', JSON.stringify(a.profile), 'speed', a.speed);
  console.log('zones', JSON.stringify(a.zones));
  console.log('parcelTypes', JSON.stringify(a.parcelTypes));
  console.log(`works: ${a.worksCount}`);
  for (const w of a.works) {
    console.log(
      `   ${String(w.name).padEnd(26)} type=${String(w.factoryType).padEnd(10)} ` +
        `lot=${w.cols}x${w.rows}(${w.cells}) edge=${w.edge} zone=${w.zone}/${w.cellZone} ` +
        `parcel=${w.parcelType} setback=${w.setback} at=${w.at}`
    );
  }
  console.log('checks:');
  for (const c of a.checks) console.log('   ' + c);
  if (seed === seeds[0]) {
    await page.screenshot({ path: `${OUT}/audit-${seed}-top.png` });
    await page.evaluate(() => window.sceneMgr.resetView());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/audit-${seed}.png` });
  }
}

console.log('\nERRORS:', errs.length ? errs.slice(0, 10) : 'none');
await browser.close();
