import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.traffic?.vehicles?.length, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const town = window.town;
    town.generate(1337);
    const vehicle = town.traffic.vehicles[0];
    const wheelChildren = vehicle.rig.wheels.map((pivot) => pivot.children.length);
    const wheelVertices = vehicle.rig.wheels[0]?.children[0]?.geometry?.attributes?.position?.count || 0;
    const wheelShadows = vehicle.rig.wheels.some((pivot) => pivot.children.some((child) => child.castShadow));
    const bodyShadows = vehicle.rig.group.children.some((child) => child.castShadow);
    return {
      mode: 'simple',
      type: vehicle.type,
      wheels: vehicle.rig.wheels.length,
      wheelChildren,
      wheelVertices,
      wheelShadows,
      bodyShadows,
      pickable: vehicle.rig.group.userData.pick?.type === 'vehicle',
      pageErrors: []
    };
  });
  const failures = [];
  if (result.wheels !== 4) failures.push(`vehicle should retain four wheel pivots, got ${result.wheels}`);
  if (!result.wheelChildren.every((count) => count === 1)) failures.push(`simple wheel pivots should contain one low-poly wheel: ${result.wheelChildren.join(',')}`);
  if (!(result.wheelVertices > 0 && result.wheelVertices < 100)) failures.push(`wheel vertex budget is unexpected: ${result.wheelVertices}`);
  if (result.wheelShadows || result.bodyShadows) failures.push('simple vehicle render still casts shadows');
  if (!result.pickable) failures.push('vehicle inspection metadata was lost');
  failures.push(...pageErrors.map((message) => `page error: ${message}`));
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
