import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';

// Measures the two things the extent change put at risk: the per-frame stats
// cost (which used to walk the whole grid several times at 60 Hz) and the
// realised frame rate with the grid doubled.
const PROBE = async () => {
  const t = window.town;
  // Cost of one stats() call, and of the full-grid work it used to do.
  let s = performance.now();
  for (let i = 0; i < 50; i++) t.stats();
  const statsMs = (performance.now() - s) / 50;

  const g = t.grid;
  s = performance.now();
  for (let i = 0; i < 50; i++) g.roadCells();
  const roadCellsMs = (performance.now() - s) / 50;

  s = performance.now();
  for (let i = 0; i < 50; i++) window.urbanProfile(g);
  const profileMs = (performance.now() - s) / 50;

  return { statsMs, roadCellsMs, profileMs, roads: g.roadCount, cells: g.w * g.h };
};

const FPS = () =>
  new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    let n = 0;
    function tick(now) {
      times.push(now - last);
      last = now;
      if (++n < 180) requestAnimationFrame(tick);
      else {
        times.sort((a, b) => a - b);
        resolve({
          medianFrameMs: times[Math.floor(times.length / 2)],
          p95FrameMs: times[Math.floor(times.length * 0.95)],
          worstFrameMs: times[times.length - 1]
        });
      }
    }
    requestAnimationFrame(tick);
  });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(1000);

const p = await page.evaluate(PROBE);
console.log(`grid ${p.cells} cells, ${p.roads} road tiles`);
console.log(`  town.stats()          ${p.statsMs.toFixed(3)} ms/call   (x60 fps = ${(p.statsMs * 60).toFixed(1)}% of a frame budget)`);
console.log(`  grid.roadCells()      ${p.roadCellsMs.toFixed(3)} ms/call   <- was called from stats() every frame`);
console.log(`  urbanProfile(g)       ${p.profileMs.toFixed(3)} ms/call`);

for (const speed of [1, 50]) {
  await page.evaluate((s) => { window.clock.speed = s; }, speed);
  await page.waitForTimeout(1500);
  const f = await page.evaluate(FPS);
  console.log(
    `  speed ${String(speed).padStart(2)}x   median ${f.medianFrameMs.toFixed(1)} ms (${(1000 / f.medianFrameMs).toFixed(0)} fps)  p95 ${f.p95FrameMs.toFixed(1)} ms  worst ${f.worstFrameMs.toFixed(1)} ms`
  );
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
