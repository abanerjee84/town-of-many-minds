import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// `frontier()` was rewritten to walk only the outer ring instead of the whole
// grid. The ring walk must return EXACTLY the set the old full-grid scan did —
// a dropped cell silently shrinks the annexable land, and a duplicated one
// inflates the survey count.
const PROBE = () => {
  const t = window.town;
  const r = t.research;
  const g = t.grid;

  // The original implementation, verbatim, as the oracle.
  const brute = () => {
    const out = [];
    g.forEach((x, y, grid) => {
      const k = grid.kindAt(x, y);
      if (k !== 0 && k !== 2) return;           // EMPTY or LOT
      if (t.resources && t.resources.ownsCell(x, y)) return;
      if (r.surveyed.has(`${x},${y}`)) return;
      // edgeCell: min(x, y, w-1-x, h-1-y) < EDGE_RING (2)
      if (Math.min(x, y, g.w - 1 - x, g.h - 1 - y) >= 2) return;
      out.push(`${x},${y}`);
    });
    return out;
  };

  const got = r.frontier().map(([x, y]) => `${x},${y}`);
  const a = new Set(brute());
  const b = new Set(got);
  const missing = [...a].filter((k) => !b.has(k));
  const extra = [...b].filter((k) => !a.has(k));
  const dupes = got.length !== b.size;

  let s = performance.now();
  for (let i = 0; i < 200; i++) r.frontier();
  const ms = (performance.now() - s) / 200;

  s = performance.now();
  for (let i = 0; i < 200; i++) brute();
  const bruteMs = (performance.now() - s) / 200;

  return { count: got.length, oracleCount: a.size, missing, extra, dupes, ms, bruteMs, ringCells: got.length };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(800);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(700);
  const r = await page.evaluate(PROBE);
  const ok = !r.missing.length && !r.extra.length && !r.dupes && r.count === r.oracleCount;
  if (!ok) fail++;
  console.log(`seed ${seed.padEnd(5)} ${ok ? 'OK  ' : 'FAIL'}  frontier ${r.count} (oracle ${r.oracleCount})  missing ${r.missing.length}  extra ${r.extra.length}  dupes ${r.dupes}  ${r.ms.toFixed(4)} ms vs brute ${r.bruteMs.toFixed(4)} ms (${(r.bruteMs / r.ms).toFixed(1)}x)`);
  if (r.missing.length) console.log('   missing:', r.missing.slice(0, 8));
  if (r.extra.length) console.log('   extra:  ', r.extra.slice(0, 8));
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
