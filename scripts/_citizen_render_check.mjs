import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.pedestrians?.citizens?.length, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const town = window.town;
    town.generate(1337);
    const agent = town.pedestrians.citizens[0];
    const meshes = [];
    agent.group.traverse((node) => { if (node.isMesh) meshes.push(node); });
    const body = meshes.find((mesh) => mesh.geometry?.attributes?.position && mesh.geometry !== meshes.at(-1)?.geometry);
    return {
      mode: 'simple',
      meshCount: meshes.length,
      bodyVertices: body?.geometry?.attributes?.position?.count || 0,
      castShadows: meshes.some((mesh) => mesh.castShadow),
      pivotCount: agent.rig.pivots.length,
      pickable: agent.group.userData.pick?.type === 'citizen',
      bubble: !!agent.rig.bubble,
      pageErrors: []
    };
  });
  const failures = [];
  if (result.meshCount !== 2) failures.push(`simple citizen should use one body mesh plus bubble, got ${result.meshCount}`);
  if (!(result.bodyVertices > 0 && result.bodyVertices < 200)) failures.push(`simple citizen body vertex budget is unexpected: ${result.bodyVertices}`);
  if (result.castShadows) failures.push('simple citizens still cast shadows');
  if (result.pivotCount !== 2 || !result.pickable || !result.bubble) failures.push('simple citizen lost animation or inspection contract');
  failures.push(...pageErrors.map((message) => `page error: ${message}`));
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
