import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
// One seed, deliberately. A leak check must hold everything else constant: with
// five seeds cycling, the counts oscillate 136/163/151/153/142 with the size of
// each seed's town, which is legitimate variance and reads as a leak. Cycling
// five seeds produced a perfectly periodic series (period 5) — which is itself
// good evidence of no leak, but a useless assertion.
const SEED = '42';
const REGENS = 14;

// INV-9 — GPU and heap resources are released on every teardown path.
//
// `renderer.info.memory` is the assertion. Three.js only decrements it on
// `dispose()`, so a geometry that is detached without disposal is
// unreclaimable without losing the GL context — and the scene-graph node count
// stays flat, which is exactly why it hid: the leak is in buffers belonging to
// nothing in the scene.
//
// Measured before this check existed: +57 geometries per regeneration, linear,
// and +23 glow materials per regeneration, each still holding a 256x72
// CanvasTexture. `pedestrians.remove()` detached a rig and disposed nothing
// while its sibling `traffic.remove()` did it correctly, and `makeSign`
// registered a material the registry never released.
const PROBE = async ({ seed, regens }) => {
  const info = () => ({
    geometries: window.sceneMgr.renderer.info.memory.geometries,
    textures: window.sceneMgr.renderer.info.memory.textures,
    programs: window.sceneMgr.renderer.info.programs?.length ?? 0,
    nodes: (() => { let n = 0; window.sceneMgr.scene.traverse(() => n++); return n; })(),
    meshes: (() => { let n = 0; window.sceneMgr.scene.traverse((o) => { if (o.isMesh) n++; }); return n; })()
  });
  const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
  const glowMod = await import('/src/kits/glow.js');

  const series = [];
  for (let i = 0; i < regens; i++) {
    window.town.generate(seed);
    await frame();
    await frame();                       // let the renderer actually realise it
    series.push({ ...info(), glow: glowMod.glowCount() });
  }
  return { series };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);

const r = await page.evaluate(PROBE, { seed: SEED, regens: REGENS });
const s = r.series;
// Compare the warm run (after the first) against the last: a leak is monotonic.
const steady = s.slice(2);
const first = steady[0];
const last = steady[steady.length - 1];
const spread = (k) => Math.max(...steady.map((x) => x[k])) - Math.min(...steady.map((x) => x[k]));

console.log(`  regen   geometries  textures  programs  nodes  meshes   glow-registry`);
for (let i = 0; i < s.length; i++) {
  const x = s[i];
  console.log(`  ${String(i).padStart(5)}  ${String(x.geometries).padStart(10)}  ${String(x.textures).padStart(8)}  ${String(x.programs).padStart(8)}  ${String(x.nodes).padStart(5)}  ${String(x.meshes).padStart(6)}   ${String(x.glow).padStart(4)}`);
}
const problems = [];
if (last.geometries > first.geometries + 2) problems.push(`geometries grew ${first.geometries} -> ${last.geometries}`);
if (last.textures > first.textures + 1) problems.push(`textures grew ${first.textures} -> ${last.textures}`);
if (last.glow > first.glow + 2) problems.push(`glow registry grew ${first.glow} -> ${last.glow}`);
if (spread('nodes') > 2) problems.push(`scene nodes varied by ${spread('nodes')}`);

console.log(`\n  steady state (regens 2..${s.length - 1}): geometries spread ${spread('geometries')}, textures ${spread('textures')}, glow ${spread('glow')}, nodes ${spread('nodes')}`);
console.log(problems.length ? `\n  ${problems.join('\n  ')}` : '\n  no growth: every resource is released on teardown');
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'none');
process.exit(problems.length ? 1 : 0);
