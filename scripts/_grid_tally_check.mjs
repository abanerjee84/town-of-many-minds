import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7', '2024', '99'];

// The Grid's O(1) kind tally is now load-bearing for the HUD road count, the
// park count and the connectivity readout. If it can drift from `kind[]`, every
// one of those numbers is quietly wrong. This asserts, by brute force, that the
// tally matches the array after founding AND after a pile of random mutations.
// async because the rollback case drives the real snapshot module, imported
// dynamically so this check uses the same instance the app is running.
const PROBE = async () => {
  const t = window.town;
  const g = t.grid;
  const NAMES = ['empty', 'road', 'lot', 'park', 'water', 'plaza', 'path'];

  const brute = () => {
    const c = new Array(NAMES.length).fill(0);
    for (let i = 0; i < g.w * g.h; i++) c[g.kind[i]]++;
    return c;
  };
  const tallied = () => NAMES.map((_, k) => g.countOf(k));

  const atFounding = { brute: brute(), tallied: tallied() };

  // Hammer the grid: repaint a wide swathe of tiles through setKind, then
  // assert the tally still matches. Also exercise the direct kind[i] write in
  // placementController (the net-zero save/restore) to prove it cannot drift.
  let mutations = 0;
  for (let y = 2; y < g.h - 2; y += 3) {
    for (let x = 2; x < g.w - 2; x += 3) {
      const k = ((x * 7 + y * 13) % 7);
      g.setKind(x, y, k);
      mutations++;
    }
  }
  const afterMutate = { brute: brute(), tallied: tallied() };

  const save = g.kind[g.idx(5, 5)];
  g.kind[g.idx(5, 5)] = 3;
  g.kind[g.idx(5, 5)] = save;
  const afterRawWrite = { brute: brute(), tallied: tallied() };

  // The case that actually shipped broken: a ROLLED-BACK project. Snapshotting
  // writes `kind` (and now `kindCounts`) straight through TypedArray.set,
  // bypassing setKind, and `restoreProjectWorld` writes the grid -> rebuildAll()
  // -> writes the grid again. Before the fix the tally survived the rollback
  // describing a grid that no longer existed: roadCount said 130 while the grid
  // said 129, and the HUD's road figure stayed wrong for the rest of the session.
  // This drives the real snapshot/restore path rather than hand-rolling it.
  const snapMod = await import('/src/simulation/projectSnapshot.js');
  const before = { brute: brute(), tallied: tallied() };
  const world = snapMod.snapshotProjectWorld(t);
  g.setKind(3, 3, 1);
  g.setKind(4, 4, 1);
  g.setKind(5, 5, 1);
  const mutated = { brute: brute(), tallied: tallied() };
  snapMod.restoreProjectWorld(t, world);
  const afterRollback = { brute: brute(), tallied: tallied() };

  // An out-of-range kind must not corrupt the tally. Before the guard, the old
  // cell's counter was decremented and the new one's increment was silently
  // dropped, so the tally lost a cell permanently with no throw. The fix REFUSES
  // the write, so the correct outcome is that nothing changes at all.
  const g2 = new (g.constructor)(4, 4);
  const good = g2.countOf(0);
  g2.setKind(1, 1, 999);
  const rangeGuard = {
    tallyUnchanged: g2.countOf(0) === good,
    cellUntouched: g2.kindAt(1, 1) === 0,
    totalIntact: [...g2.kindCounts].reduce((a, b) => a + b, 0) === 16
  };

  const eq = (a, b) => a.every((v, i) => v === b[i]);
  return {
    mutations,
    founding: eq(before.brute, before.tallied) ? 'match' : { brute: before.brute, tallied: before.tallied },
    afterMutate: eq(mutated.brute, mutated.tallied) ? 'match' : { brute: mutated.brute, tallied: mutated.tallied },
    afterRawWrite: eq(afterRawWrite.brute, afterRawWrite.tallied) ? 'match' : { brute: afterRawWrite.brute, tallied: afterRawWrite.tallied },
    // total must always equal the cell count — the sum is the invariant that
    // catches a missing decrement as well as a missing increment
    totalAtFounding: before.tallied.reduce((a, b) => a + b, 0),
    totalAfterMutate: mutated.tallied.reduce((a, b) => a + b, 0),
    totalCells: g.w * g.h,
    roadCountGetter: g.roadCount,
    roadCountBrute: brute()[1],
    rollback: eq(afterRollback.brute, afterRollback.tallied)
      ? 'match'
      : { brute: afterRollback.brute, tallied: afterRollback.tallied },
    rollbackActuallyChanged: mutated.brute[1] !== before.brute[1],
    rangeGuard
  };
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
  const problems = [];
  if (r.founding !== 'match') problems.push('founding');
  if (r.afterMutate !== 'match') problems.push('afterMutate');
  if (r.afterRawWrite !== 'match') problems.push('afterRawWrite');
  if (r.rollback !== 'match') problems.push('rollback');
  if (r.totalAtFounding !== r.totalCells) problems.push('totalAtFounding');
  if (r.totalAfterMutate !== r.totalCells) problems.push('totalAfterMutate');
  if (r.roadCountGetter !== r.roadCountBrute) problems.push('roadCount');
  if (!r.rangeGuard.tallyUnchanged) problems.push('rangeGuard.tallyUnchanged');
  if (!r.rangeGuard.cellUntouched) problems.push('rangeGuard.cellUntouched');
  if (!r.rangeGuard.totalIntact) problems.push('rangeGuard.totalIntact');
  if (problems.length) fail++;
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        mutations ${String(r.mutations).padStart(4)}  founding ${r.founding}  afterMutate ${r.afterMutate}  afterRawWrite ${r.afterRawWrite}  total ${r.totalAtFounding}/${r.totalCells}  road ${r.roadCountGetter}`);
  console.log(`        project rollback: ${r.rollback} (the case that shipped broken)`);
  console.log(`        range guard: tally unchanged ${r.rangeGuard.tallyUnchanged}, cell untouched ${r.rangeGuard.cellUntouched}, total intact ${r.rangeGuard.totalIntact}`);
  for (const k of ['founding', 'afterMutate', 'afterRawWrite', 'rollback']) {
    if (typeof r[k] === 'object') console.log(`        ${k}: ${JSON.stringify(r[k])}`);
  }
}
console.log('\nERRORS:', errs.length ? errs.slice(0, 5) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
