import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEEDS = ['42', '1337', '7'];

// SR-1 / SR-2 — the loop must not be killable.
//
// Before this, `frame()` had no `try`/`catch` anywhere and re-armed
// `requestAnimationFrame` as its FINAL statement, so a single throw in any of
// ten per-frame systems ended the game permanently: one console error, the clock
// frozen, and the Regen button still live leaving a world that looked interactive
// and was not. This asserts the loop survives an armed fault and that `pending`
// is still released.
const PROBE = () =>
  new Promise((resolve) => {
    const t = window.town;
    const gov = t.governance;
    const out = { steps: [] };

    // The council is disabled for this probe: an in-flight LLM sitting pins
    // `pending` (and therefore the clock) legitimately, which would be
    // indistinguishable from the failure we are testing for.
    const wasEnabled = gov.enabled;
    gov.enabled = false;

    // Count real frames. Headless software GL runs at roughly 9 fps, so an
    // absolute frame count says nothing — the loop is judged against its OWN
    // measured baseline, which is the only fair comparison available.
    let frames = 0;
    let stop = false;
    const tick = () => {
      frames++;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const window1 = () => new Promise((r) => setTimeout(r, 1500));
    const hourBefore = window.clock.hour;
    const speedBefore = window.clock.speed;

    (async () => {
      // Baseline: how many frames does this environment do when healthy?
      const baseStart = frames;
      await window1();
      const baseFrames = frames - baseStart;

      // 1. Arm a fault in a per-frame system the loop calls every frame.
      const victim = t.economy;
      const realUpdate = victim.update.bind(victim);
      victim.update = () => {
        throw new Error('injected-fault');
      };

      const faultStart = frames;
      const hourAtFault = window.clock.hour;
      await window1();
      const faultFrames = frames - faultStart;
      victim.update = realUpdate;

      out.steps.push({
        step: 'loop-survives-throw',
        baselineFrames: baseFrames,
        framesDuringFault: faultFrames,
        // The invariant: the loop kept scheduling. A killed loop scores 0, and
        // that is the defect this check exists for. Frame PACING is reported but
        // not asserted — under software GL a GC pause or a slow frame moves it
        // around by 50%+ between identical windows, so asserting on it would
        // make this a flake generator rather than a regression detector.
        loopAlive: faultFrames > 0,
        keptPacing: baseFrames > 0 ? faultFrames >= baseFrames * 0.5 : faultFrames > 0,
        // other systems still ran: the clock advanced even though economy did not
        otherSystemsStillRan: window.clock.hour !== hourAtFault,
        speedPreserved: window.clock.speed === speedBefore,
        hourBefore
      });

      // 2. After recovery the town is simulating, not merely drawing.
      const popBefore = t.pedestrians.citizens.length;
      const h0 = window.clock.hour;
      await window1();
      out.steps.push({
        step: 'sim-resumes-after-recovery',
        framesAdvanced: frames - faultStart,
        citizensStillThere: t.pedestrians.citizens.length === popBefore,
        clockAdvanced: window.clock.hour !== h0
      });

      // 3. SR-2 — `pending` must be released even if `situationKey` throws.
      const realKey = gov.situationKey.bind(gov);
      gov.situationKey = () => {
        throw new Error('injected-situationKey');
      };
      const before = !!gov.pending;
      try {
        await gov.ask();
      } catch {
        /* the point is the flag, not the rejection */
      }
      out.steps.push({
        step: 'pending-released-after-throw',
        pendingBefore: before,
        pendingAfter: !!gov.pending,
        released: !gov.pending,
        clockWouldFreeze: !!gov.pending
      });
      gov.situationKey = realKey;
      gov.enabled = wasEnabled;
      stop = true;
      resolve(out);
    })();
  });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(1000);

let fail = 0;
for (const seed of SEEDS) {
  await page.fill('#seed-input', seed);
  await page.click('#regen');
  await page.waitForTimeout(900);
  const r = await page.evaluate(PROBE);
  const problems = [];
  for (const s of r.steps) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'step' || k === 'framesAdvanced' || k === 'pendingBefore' || k === 'clockHour' || k === 'speedPreserved' || k === 'clockWouldFreeze' || k === 'pendingAfter' || k === 'baselineFrames' || k === 'framesDuringFault' || k === 'hourBefore' || k === 'keptPacing') continue;
      if (v === false) problems.push(`${s.step}.${k}`);
    }
  }
  // the injected fault MUST be reported (once), not swallowed silently
  const reported = consoleErrors.some((e) => e.includes('injected-fault'));
  if (!reported) problems.push('fault not reported');
  if (problems.length) fail++;
  const s1 = r.steps.find((x) => x.step === 'loop-survives-throw');
  const s3 = r.steps.find((x) => x.step === 'pending-released-after-throw');
  console.log(`seed ${seed.padEnd(5)} ${problems.length ? 'FAIL' : 'OK  '}  ${problems.join(' ')}`);
  console.log(`        frames: baseline ${s1.baselineFrames} -> during fault ${s1.framesDuringFault}  (loop alive ${s1.loopAlive}, kept pacing ${s1.keptPacing})`);
  console.log(`        other systems still ran: ${s1.otherSystemsStillRan}  speed preserved: ${s1.speedPreserved}`);
  console.log(`        pending released after situationKey throw: ${s3.released}  fault reported: ${reported}`);
}
console.log('\nERRORS:', consoleErrors.length ? consoleErrors.slice(0, 4) : 'none');
console.log(fail ? `\n${fail}/${SEEDS.length} FAILED` : `\nALL ${SEEDS.length} OK`);
await browser.close();
process.exit(fail ? 1 : 0);
