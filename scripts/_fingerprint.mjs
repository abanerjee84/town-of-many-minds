import { chromium } from 'playwright';
import fs from 'node:fs';

// Writes a fingerprint of the founding outcome for N seeds to the file named in
// argv[2], so two builds of the resource planner can be compared for exact
// behavioural equivalence.
const OUT = process.argv[2];
const SEEDS = ['42', '1337', '7', '2024', '99', '1', '500', '77', '1234', '8888'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

const out = {};
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(600);
  out[seed] = await page.evaluate(() => {
    const t = window.town;
    const l = t.resources.sites.find((s) => s.kind === 'lake');
    return {
      lake: l ? l.cells.map((c) => c.join(',')).sort().join(' ') : null,
      spur: l && l.spur ? l.spur.map((c) => c.join(',')).sort().join(' ') : null,
      kinds: t.resources.sites.map((s) => s.kind).sort().join(','),
      roads: t.grid.roadCount,
      bldg: t.buildings.map((x) => `${x.kind}@${x.cell}`).sort().join(' '),
      cells: [...t.grid.kindCounts].join(',')
    };
  });
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`wrote ${OUT} for ${SEEDS.length} seeds`);
await browser.close();
