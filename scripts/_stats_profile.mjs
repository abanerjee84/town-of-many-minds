import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';

const PROBE = () => {
  const t = window.town;
  const time = (label, fn, n = 30) => {
    const s = performance.now();
    for (let i = 0; i < n; i++) fn();
    return { label, ms: (performance.now() - s) / n };
  };
  const rows = [
    time('town.stats() TOTAL', () => t.stats()),
    time('  growth.stats()', () => t.growth.stats()),
    time('  economy.stats()', () => t.economy.stats()),
    time('  governance.stats()', () => t.governance.stats()),
    time('  parcels.stats()', () => t.parcels.stats()),
    time('  traffic.mobilityStats()', () => t.traffic.mobilityStats()),
    time('  traffic.fleetStats()', () => t.traffic.fleetStats()),
    time('  pedestrians avg/vis', () => [t.pedestrians.averageMood(), t.pedestrians.visibleCount(), t.pedestrians.outsideCount(), t.pedestrians.insideCount()]),
    time('  lifecycle.stats()', () => t.lifecycle.stats()),
    time('  resources.stats()', () => t.resources.stats()),
    time('  utilities.stats()', () => t.utilities.stats()),
    time('  industry.stats()', () => t.industry.stats()),
    time('  publicSpaceStats', () => window.town.stats().publicSpace),
    time('  policy.stats()', () => t.policy.stats()),
    time('  research.stats()', () => t.research.stats())
  ];
  return rows;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(1000);
const rows = await page.evaluate(PROBE);
const total = rows[0].ms;
for (const r of rows) {
  const pct = ((r.ms / total) * 100).toFixed(0).padStart(3);
  console.log(`  ${r.label.padEnd(30)} ${r.ms.toFixed(3).padStart(8)} ms  ${pct}%`);
}
await browser.close();
