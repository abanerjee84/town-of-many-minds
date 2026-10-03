import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5173/?seed=1337';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.resources?.sites?.some((site) => site.kind === 'lake'), null, { timeout: 60000 });
await page.waitForTimeout(400);

const result = await page.evaluate(() => {
  const town = window.town;
  const lake = town.resources.sites.find((site) => site.kind === 'lake');
  const waterMeshes = [];
  town.roadsGroup?.traverse((object) => {
    if (object.name?.startsWith('road-water-')) waterMeshes.push(object.name);
  });
  const waterCells = lake?.cells || [];
  const xs = waterCells.map(([x]) => x);
  const ys = waterCells.map(([, y]) => y);
  return {
    cells: waterCells.length,
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...ys) - Math.min(...ys) + 1,
    waterMeshes,
    validation: town.stats()?.validation?.ok
  };
});

const failures = [
  ...(result.cells < 24 ? [`lake is only ${result.cells} cells`] : []),
  ...(result.width < 4 || result.depth < 3 ? ['lake footprint is too small'] : []),
  ...(result.waterMeshes.length < 2 ? ['rounded shoreline/surface meshes are missing'] : []),
  ...(result.validation !== true ? ['town validation failed'] : []),
  ...errors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, result, errors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
