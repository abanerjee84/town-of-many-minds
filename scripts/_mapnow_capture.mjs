import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const root = process.cwd();
const mapDir = path.join(root, 'MapNow');
fs.mkdirSync(mapDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.mapNow?.capture, null, { timeout: 60000 });
  const text = await page.evaluate(() => window.mapNow.capture());
  const endpointSaved = await page.evaluate(() => window.mapNow.save());
  fs.writeFileSync(path.join(mapDir, 'latest.map.txt'), text, 'utf8');
  const summary = {
    ok: /^TOMM-MAP\/1/m.test(text) && /^COARSE_MAP/m.test(text) && /^LEGEND/m.test(text),
    file: path.join('MapNow', 'latest.map.txt'),
    endpointSaved,
    bytes: Buffer.byteLength(text),
    lines: text.split('\n').length,
    pageErrors
  };
  if (pageErrors.length) summary.ok = false;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
} finally {
  await browser.close();
}
