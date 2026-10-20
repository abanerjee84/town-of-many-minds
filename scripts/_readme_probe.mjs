// Playwright probe used to verify README claims against the live app.
// Loads the dev server, captures HUD/clock/council state, lets the sim run,
// exercises modals and camera presets, and saves screenshots + a JSON report.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const ROOT = path.join(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'docs', 'assets');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));

const report = { appUrl: APP_URL, loadedAt: new Date().toISOString(), checks: {}, state: {} };

await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('#loading.hidden', { timeout: 120_000 });
await page.waitForTimeout(4000);

report.checks.loadingRemoved = (await page.$('#loading')) === null;
report.checks.canvasPresent = !!(await page.$('#app canvas'));

const grabState = () => page.evaluate(() => {
  const txt = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const t = window.town;
  const c = window.clock;
  const townState = t ? {
    seed: t.seed,
    day: c?.day ?? null,
    hour: c?.hour ?? null,
    simSpeed: c?.speed ?? null,
    treasury: Math.round(t.economy?.treasury ?? -1),
    taxRate: t.economy?.taxRate ?? null,
    sittingsPerDay: t.governance?.sittingsPerDay ?? null,
    motionsPerSitting: t.governance?.cabinet?.motionsPerSitting ?? null,
    autoCouncil: t.governance?.autoCouncil ?? null
  } : null;
  return {
    townState,
    day: txt('stat-day'), period: txt('stat-period'), time: txt('stat-time'),
    season: txt('stat-season'), weather: txt('stat-weather'),
    population: txt('stat-pop'), households: txt('stat-hhd'), buildings: txt('stat-bld'),
    vehicles: txt('stat-veh'), roadTiles: txt('stat-road'), mood: txt('stat-mood'),
    treasury: txt('stat-treasury'), tax: txt('stat-tax'), unemployment: txt('stat-jobs'),
    beds: txt('stat-beds'), debt: txt('stat-debt'), congestion: txt('stat-traffic'),
    councilState: txt('council-state'), councilSittings: txt('council-sittings'),
    councilList: document.getElementById('council-list')?.innerText?.slice(0, 400) ?? null,
    councilThought: txt('council-thought'), councilLearning: txt('council-learning'),
    societySummary: txt('society-feedback-summary'),
    performance: txt('performance-values'),
    cameraOrbit: txt('camera-orbit'), cameraZoom: txt('camera-zoom'),
    activeSpeed: document.querySelector('.speed-row button.active')?.textContent?.trim() ?? null,
    tools: [...document.querySelectorAll('#tool-grid button')].map((b) => b.textContent.trim()),
    inspector: document.getElementById('inspector')?.innerText?.slice(0, 200) ?? null
  };
});

report.state.afterLoad = await grabState();
await page.screenshot({ path: path.join(ASSETS, 'readme-town.png') });

// Top-down camera preset
await page.click('[data-camera-preset="top"]');
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(ASSETS, 'readme-topdown.png') });
report.state.topdownCamera = { orbit: await page.$eval('#camera-orbit', (el) => el.textContent.trim()) };
await page.click('[data-camera-preset="iso"]');
await page.waitForTimeout(600);

// Let the sim run at default speed and confirm the calendar advances
await page.waitForTimeout(20_000);
report.state.after20s = await grabState();
const a = report.state.afterLoad, b = report.state.after20s;
report.checks.calendarAdvanced = (a.townState?.day !== b.townState?.day)
  || (a.townState?.hour !== b.townState?.hour)
  || (a.time !== b.time);

// The inspector re-renders its buttons on every HUD tick, so direct DOM clicks
// are used for anything inside #inspector.
const clickInPage = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) throw new Error(`not found: ${s}`);
  el.click();
}, sel);

// KPI modal
await clickInPage('.insp-btn[data-modal="kpi"]');
await page.waitForTimeout(700);
report.kpi = await page.evaluate(() => ({
  title: document.getElementById('modal-title')?.textContent?.trim(),
  run: document.querySelector('.kpi-run')?.innerText?.replace(/\n/g, ' | ') ?? null,
  sections: [...document.querySelectorAll('.kpi-section > b')].map((el) => el.textContent.trim()),
  firstRows: [...document.querySelectorAll('.kpi-row')].slice(0, 6).map((r) => r.innerText.replace(/\n/g, ' · '))
}));
await page.screenshot({ path: path.join(ASSETS, 'readme-kpi.png') });
await clickInPage('#modal-close');
await page.waitForTimeout(400);

// Decisions modal
await clickInPage('.insp-btn[data-modal="council"]');
await page.waitForTimeout(700);
report.decisions = await page.evaluate(() => ({
  title: document.getElementById('modal-title')?.textContent?.trim(),
  body: document.getElementById('modal-body')?.innerText?.slice(0, 500) ?? null
}));
await clickInPage('#modal-close');
await page.waitForTimeout(400);

// Trade modal
await clickInPage('.insp-btn[data-modal="trade"]');
await page.waitForTimeout(700);
report.trade = await page.evaluate(() => ({
  title: document.getElementById('modal-title')?.textContent?.trim(),
  body: document.getElementById('modal-body')?.innerText?.slice(0, 400) ?? null
}));
await clickInPage('#modal-close');
await page.waitForTimeout(400);

// Palette modal
await clickInPage('.insp-btn[data-modal="construction"]');
await page.waitForTimeout(700);
report.palette = await page.evaluate(() => ({
  title: document.getElementById('modal-title')?.textContent?.trim(),
  body: document.getElementById('modal-body')?.innerText?.slice(0, 400) ?? null
}));
await clickInPage('#modal-close');
await page.waitForTimeout(400);

// Settings modal
await page.click('#settings-toggle');
await page.waitForTimeout(700);
report.settings = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.settings-row')].map((r) => {
    const label = r.querySelector('b')?.textContent?.trim() ?? '';
    const input = r.querySelector('input, select');
    const value = input ? (input.type === 'checkbox' ? String(input.checked) : input.value) : null;
    return `${label}=${value}`;
  }),
  checks: [...document.querySelectorAll('.settings-check')].map((c) => {
    const label = c.querySelector('b')?.textContent?.trim() ?? '';
    return `${label}=${c.querySelector('input')?.checked}`;
  })
}));
await page.screenshot({ path: path.join(ASSETS, 'readme-settings.png') });
await clickInPage('#modal-close');
await page.waitForTimeout(400);

report.state.final = await grabState();
report.consoleErrors = consoleErrors.slice(0, 20);

fs.writeFileSync(path.join(ROOT, 'scripts', '_readme_probe.report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 2));
console.log('REPORT WRITTEN: scripts/_readme_probe.report.json');
await browser.close();

