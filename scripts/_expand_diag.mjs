import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173';
// For the first farm/husbandry site: show the next-tier rectangle placements
// around its 7x4 founding yard and WHY each fresh cell refuses.
const PROBE = () => {
  const t = window.town;
  const g = t.grid;
  const rs = t.resources;
  const s = rs.sites.find((x) => ['farm', 'husbandry'].includes(x.kind));
  if (!s) return 'no ag site';
  const xs = s.cells.map((c) => c[0]);
  const ys = s.cells.map((c) => c[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const own = new Set(s.cells.map(([x, y]) => `${x},${y}`));
  const kindName = ['EMPTY', 'ROAD', 'LOT', 'PARK', 'WATER', 'PLAZA', 'PATH'];
  const report = { site: s.kind, bbox: [x0, y0, x1, y1], placements: [] };
  for (const [w, h] of [[3, 2], [2, 3]]) {
    for (let ay = y1 - h + 1; ay <= y0; ay++) {
      for (let ax = x1 - w + 1; ax <= x0; ax++) {
        const fresh = [];
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const x = ax + dx, y = ay + dy;
            if (own.has(`${x},${y}`)) continue;
            const info = {
              at: [x, y],
              inBounds: g.inBounds(x, y),
              kind: g.inBounds(x, y) ? kindName[g.kindAt(x, y)] : 'OOB',
              owned: rs.owned.has(`${x},${y}`),
              bld: !!t.buildingAt(x, y)
            };
            fresh.push(info);
          }
        }
        report.placements.push({ rect: [w, h], anchor: [ax, ay], fresh });
      }
    }
  }
  return report;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#seed-input', '1337');
await page.click('#regen');
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
