import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const REQUIRED_IDS = [
  'hud', 'tools', 'tool-grid', 'seed-input', 'regen', 'reset-town',
  'settings-toggle', 'camera-toolbar', 'camera-readout', 'camera-orbit', 'camera-zoom', 'camera-pan',
  'stat-pop', 'stat-bld', 'stat-treasury', 'council', 'council-feedback',
  'council-thought', 'council-learning', 'society-feedback', 'society-feedback-summary',
  'society-feedback-detail', 'society-feedback-election', 'speed-100', 'inspector'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.town?.growth && !!window.town?.economy, null, { timeout: 60000 });
await page.waitForTimeout(500);

const result = await page.evaluate((required) => {
  const missing = required.filter((id) => !document.getElementById(id));
  const town = window.town;
  const stats = {
    population: town.pedestrians?.citizens?.length || 0,
    buildings: town.buildings?.length || 0,
    catalogue: window.auditConstructionBlocks?.() || null,
    providerHooks: !!window.planFor && !!window.parseIntent && !!window.constructionPalette,
    initialCameraTarget: window.sceneMgr.controls.target.toArray(),
    cameraOrbit: document.getElementById('camera-orbit')?.textContent,
    cameraZoom: document.getElementById('camera-zoom')?.textContent,
    cameraPan: document.getElementById('camera-pan')?.textContent,
    cameraToolbar: {
      actions: [...document.querySelectorAll('#camera-toolbar [data-camera-action]')].map((el) => el.dataset.cameraAction),
      presets: [...document.querySelectorAll('#camera-toolbar [data-camera-preset]')].map((el) => el.dataset.cameraPreset)
    }
  };
  return { missing, stats };
}, REQUIRED_IDS);

// Reset must restore the same wide overview as first load, even after the
// player has orbited elsewhere.
await page.evaluate(() => {
  window.sceneMgr.camera.position.set(20, 30, 40);
  window.sceneMgr.controls.target.set(10, 0, 10);
  window.sceneMgr.controls.update();
});
await page.click('#reset-town');
const resetCameraTarget = await page.evaluate(() => window.sceneMgr.controls.target.toArray());
result.stats.resetCameraTarget = resetCameraTarget;
await page.click('[data-camera-action="orbit-right"]');
result.stats.cameraToolbarMutation = await page.evaluate(() => ({
  readout: document.getElementById('camera-orbit')?.textContent,
  yaw: window.sceneMgr.controls.getAzimuthalAngle() * 180 / Math.PI
}));
await page.click('[data-camera-preset="iso"]');
result.stats.cameraPresetMutation = await page.evaluate(() => ({
  orbit: document.getElementById('camera-orbit')?.textContent,
  zoom: document.getElementById('camera-zoom')?.textContent
}));
await page.click('#view-centre');
result.stats.townCentreCamera = await page.evaluate(() => ({
  target: window.sceneMgr.controls.target.toArray(),
  yaw: window.sceneMgr.controls.getAzimuthalAngle() * 180 / Math.PI,
  pitch: window.sceneMgr.controls.getPolarAngle() * 180 / Math.PI,
  zoom: window.sceneMgr.camera.position.distanceTo(window.sceneMgr.controls.target)
}));
await page.click('#reset-town');

await page.click('#settings-toggle');
result.stats.settings = await page.evaluate(() => ({
  open: !document.getElementById('insp-modal').classList.contains('hidden'),
  residents: document.getElementById('setting-residents')?.value,
  maxPopulation: document.getElementById('setting-max-population')?.value,
  glow: document.getElementById('setting-glow')?.value,
  temperature: document.getElementById('setting-temperature')?.value,
  speed: document.getElementById('setting-speed')?.value,
  speedOptions: [...(document.getElementById('setting-speed')?.options || [])].map((option) => option.value),
  autoCouncil: document.getElementById('setting-auto-council')?.checked,
  cameraYaw: document.getElementById('setting-camera-yaw')?.value,
  cameraPitch: document.getElementById('setting-camera-pitch')?.value,
  cameraZoom: document.getElementById('setting-camera-zoom')?.value,
  cameraTargetX: document.getElementById('setting-camera-target-x')?.value,
  cameraTargetZ: document.getElementById('setting-camera-target-z')?.value,
  sectionCount: document.querySelectorAll('.settings-section').length,
  searchable: !!document.getElementById('settings-search')
}));
await page.fill('#settings-search', 'camera');
result.stats.settingsSearch = await page.evaluate(() => ({
  visibleSections: [...document.querySelectorAll('.settings-section')].filter((section) => !section.hidden).map((section) => section.dataset.settingsSection),
  visibleRows: [...document.querySelectorAll('.settings-item')].filter((row) => !row.hidden).length,
  summary: document.getElementById('settings-search-summary')?.textContent
}));
await page.fill('#settings-search', '');
await page.fill('#setting-residents', '4');
await page.locator('#setting-residents').press('Tab');
await page.fill('#setting-max-population', '900');
await page.locator('#setting-max-population').press('Tab');
result.stats.settingsMutation = await page.evaluate(async () => {
  const { residentialCapacityPerFloor } = await import('/src/kits/houses/houseKit.js');
  return {
    stored: JSON.parse(localStorage.getItem('town3.settings') || '{}').residentsPerTilePerFloor,
    maxPopulation: JSON.parse(localStorage.getItem('town3.settings') || '{}').maxPopulation,
    runtimeCap: window.town?.pedestrians?.citizens?.length <= (window.town?.stats?.()?.progression?.populationCap || 0),
    capacity: residentialCapacityPerFloor({ footprintTiles: 1 })
  };
});
await page.fill('#setting-camera-target-x', '-10');
await page.locator('#setting-camera-target-x').press('Tab');
result.stats.cameraMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('town3.settings') || '{}').cameraTargetX,
  target: window.sceneMgr.controls.target.x,
  readout: document.getElementById('camera-pan')?.textContent
}));
await page.click('#settings-reset');
result.stats.settingsReset = await page.evaluate(() => ({
  residents: document.getElementById('setting-residents')?.value,
  maxPopulation: document.getElementById('setting-max-population')?.value,
  stored: JSON.parse(localStorage.getItem('town3.settings') || '{}').residentsPerTilePerFloor,
  targetX: window.sceneMgr.controls.target.x,
  targetZ: window.sceneMgr.controls.target.z,
  zoom: window.sceneMgr.camera.position.distanceTo(window.sceneMgr.controls.target)
}));
await page.click('#modal-close');
await page.setViewportSize({ width: 1024, height: 768 });
result.stats.ribbon1024 = await page.evaluate(() => {
  const tools = document.getElementById('tools').getBoundingClientRect();
  const settings = document.getElementById('settings-toggle').getBoundingClientRect();
  const reset = document.getElementById('reset-town').getBoundingClientRect();
  return { overflow: settings.right > tools.right + 1 || reset.right > tools.right + 1 };
});

const failures = [
  ...(result.missing.length ? [`missing DOM nodes: ${result.missing.join(', ')}`] : []),
  ...(result.stats.population <= 0 ? ['town did not initialise citizens'] : []),
  ...(result.stats.buildings <= 0 ? ['town did not initialise buildings'] : []),
  ...(result.stats.catalogue && !result.stats.catalogue.ok ? ['construction catalogue audit failed'] : []),
  ...(!result.stats.providerHooks ? ['council/provider hooks are not exposed'] : []),
  ...(result.stats.cameraToolbar?.actions?.length !== 8 || result.stats.cameraToolbar?.presets?.join(',') !== 'iso,top,north,east' ? ['camera toolbar is missing a nudge or preset control'] : []),
  ...(result.stats.cameraToolbarMutation?.readout?.includes('NaN') || result.stats.cameraPresetMutation?.orbit?.includes('NaN') ? ['camera toolbar produced an invalid pose'] : []),
  ...(Math.abs((result.stats.initialCameraTarget?.[0] ?? 0) + 20) > 0.01 ? ['initial camera target is not horizontally centred for the HUD'] : []),
  ...(Math.abs((result.stats.initialCameraTarget?.[2] ?? 0) + 40) > 0.01 ? ['initial camera target is not the wide overview pivot'] : []),
  ...(Math.abs((result.stats.resetCameraTarget?.[0] ?? 0) + 20) > 0.01 ? ['reset did not restore the horizontal overview pivot'] : []),
  ...(Math.abs((result.stats.resetCameraTarget?.[2] ?? 0) + 40) > 0.01 ? ['reset did not restore the wide overview pivot'] : []),
  ...(Math.abs((result.stats.townCentreCamera?.yaw ?? 0) - 34.5) > 0.5 || Math.abs((result.stats.townCentreCamera?.pitch ?? 0) - 64) > 0.5 || Math.abs((result.stats.townCentreCamera?.zoom ?? 0) - 228) > 1 ? ['Town Centre did not use configured camera values'] : []),
  ...(!result.stats.settings?.open ? ['settings modal did not open'] : []),
  ...(result.stats.settings?.residents !== '3' ? ['settings modal has the wrong residential density default'] : []),
  ...(result.stats.settings?.maxPopulation !== '1000' ? ['settings modal has the wrong maximum population default'] : []),
  ...(result.stats.settings?.glow !== '1' ? ['settings modal has the wrong glow default'] : []),
  ...(result.stats.settings?.speed !== '100' ? ['settings modal has the wrong speed default'] : []),
  ...(!result.stats.settings?.speedOptions?.includes('100') ? ['settings modal is missing the 100x speed option'] : []),
  ...(result.stats.settings?.cameraYaw !== '34.5' || result.stats.settings?.cameraPitch !== '64' || result.stats.settings?.cameraZoom !== '228' || result.stats.settings?.cameraTargetX !== '-20' || result.stats.settings?.cameraTargetZ !== '-40' ? ['settings modal has the wrong camera defaults'] : []),
  ...(result.stats.settings?.sectionCount !== 4 || !result.stats.settings?.searchable ? ['settings modal is missing search or sections'] : []),
  ...(result.stats.settingsSearch?.visibleSections.join(',') !== 'camera' || result.stats.settingsSearch?.visibleRows !== 5 ? ['settings search did not isolate camera controls'] : []),
  ...(result.stats.cameraMutation?.stored !== -10 || Math.abs((result.stats.cameraMutation?.target ?? 0) + 10) > 0.01 ? ['pan setting did not update the OrbitControls target'] : []),
  ...(!result.stats.cameraOrbit?.includes('yaw') || !result.stats.cameraZoom?.endsWith('m') || !result.stats.cameraPan?.includes('x') ? ['camera readout is missing orbit, zoom, or pan values'] : []),
  ...(result.stats.settingsMutation?.stored !== 4 || result.stats.settingsMutation?.capacity !== 4 ? ['residential density setting did not apply to kit capacity'] : []),
  ...(result.stats.settingsMutation?.maxPopulation !== 900 ? ['maximum population setting did not persist'] : []),
  ...(result.stats.settingsReset?.residents !== '3' || result.stats.settingsReset?.maxPopulation !== '1000' || result.stats.settingsReset?.stored !== 3 ? ['settings restore defaults did not persist'] : []),
  ...(Math.abs((result.stats.settingsReset?.targetX ?? 0) + 20) > 0.01 || Math.abs((result.stats.settingsReset?.targetZ ?? 0) + 40) > 0.01 || Math.abs((result.stats.settingsReset?.zoom ?? 0) - 228) > 1 ? ['settings restore defaults did not restore camera defaults'] : []),
  ...(result.stats.ribbon1024?.overflow ? ['bottom ribbon controls overflow at 1024px'] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
