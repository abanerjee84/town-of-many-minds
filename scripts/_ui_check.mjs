import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const REQUIRED_IDS = [
  'hud', 'tools', 'tool-grid', 'seed-input', 'regen', 'reset-town', 'fit-town',
  'settings-toggle', 'camera-toolbar', 'camera-readout', 'camera-orbit', 'camera-zoom', 'camera-pan',
  'stat-pop', 'stat-bld', 'stat-treasury', 'stat-season', 'stat-weather', 'council', 'council-feedback',
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
    branding: {
      title: document.title,
      loading: document.querySelector('#loading .brand')?.textContent,
      heading: document.querySelector('#hud h1')?.textContent
    },
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
    },
    sceneAtmosphere: {
      skybox: !!window.sceneMgr.scene.getObjectByName('skybox'),
      fogNear: window.sceneMgr.scene.fog?.near,
      fogFar: window.sceneMgr.scene.fog?.far
    },
    weather: town.weather?.stats?.() || null,
    storehouse: (() => {
      const box = document.getElementById('stat-trade');
      const style = box ? getComputedStyle(box) : null;
      return {
        rows: box?.querySelectorAll('.trade-row').length || 0,
        overflowY: style?.overflowY || '',
        maxHeight: style?.maxHeight || '',
        scrollable: !!box && box.scrollHeight > box.clientHeight
      };
    })(),
    fitTown: {
      pressed: document.getElementById('fit-town')?.getAttribute('aria-pressed'),
      active: document.getElementById('fit-town')?.classList.contains('active'),
      stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').fitTown,
      target: window.sceneMgr.controls.target.toArray(),
      zoom: window.sceneMgr.camera.position.distanceTo(window.sceneMgr.controls.target),
      bounds: town.perimeter?.stats?.().bounds || null,
      acquiredBounds: town.perimeter?.acquiredBounds?.() || null
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
result.stats.resetFitTown = await page.evaluate(() => ({
  pressed: document.getElementById('fit-town')?.getAttribute('aria-pressed'),
  target: window.sceneMgr.controls.target.toArray(),
  bounds: window.town.perimeter?.stats?.().bounds || null,
  acquiredBounds: window.town.perimeter?.acquiredBounds?.() || null
}));
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
await page.click('#fit-town');
result.stats.fitTownOff = await page.evaluate(() => ({
  pressed: document.getElementById('fit-town')?.getAttribute('aria-pressed'),
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').fitTown
}));
await page.click('#fit-town');
result.stats.fitTownOn = await page.evaluate(() => ({
  pressed: document.getElementById('fit-town')?.getAttribute('aria-pressed'),
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').fitTown
}));
await page.evaluate(() => {
  const cell = window.town.perimeter?.frontierCells?.(1)?.[0];
  if (cell) window.town.perimeter.acquire([cell], { charge: false });
});
result.stats.expansionFit = await page.evaluate(() => {
  const bounds = window.town.perimeter?.stats?.().bounds;
  const acquiredBounds = window.town.perimeter?.acquiredBounds?.();
  return {
    target: window.sceneMgr.controls.target.toArray(),
    bounds,
    acquiredBounds,
    zoom: window.sceneMgr.camera.position.distanceTo(window.sceneMgr.controls.target)
  };
});
await page.click('#reset-town');

await page.click('#settings-toggle');
result.stats.settings = await page.evaluate(() => ({
  open: !document.getElementById('insp-modal').classList.contains('hidden'),
  residents: document.getElementById('setting-residents')?.value,
  maxPopulation: document.getElementById('setting-max-population')?.value,
  glow: document.getElementById('setting-glow')?.value,
  shadows: document.getElementById('setting-shadows')?.checked,
  rendererShadows: window.sceneMgr?.renderer?.shadowMap?.enabled,
  temperature: document.getElementById('setting-temperature')?.value,
  temperatureMax: document.getElementById('setting-temperature')?.max,
  speed: document.getElementById('setting-speed')?.value,
  speedOptions: [...(document.getElementById('setting-speed')?.options || [])].map((option) => option.value),
  autoCouncil: document.getElementById('setting-auto-council')?.checked,
  councilSittings: document.getElementById('setting-council-sittings')?.value,
  cabinetMotions: document.getElementById('setting-cabinet-motions')?.value,
  congestionThreshold: document.getElementById('setting-congestion-threshold')?.value,
  congestionThresholdMin: document.getElementById('setting-congestion-threshold')?.min,
  congestionThresholdMax: document.getElementById('setting-congestion-threshold')?.max,
  cameraYaw: document.getElementById('setting-camera-yaw')?.value,
  cameraPitch: document.getElementById('setting-camera-pitch')?.value,
  cameraZoom: document.getElementById('setting-camera-zoom')?.value,
  cameraTargetX: document.getElementById('setting-camera-target-x')?.value,
  cameraTargetZ: document.getElementById('setting-camera-target-z')?.value,
  sectionCount: document.querySelectorAll('.settings-section').length,
  searchable: !!document.getElementById('settings-search')
}));
await page.check('#setting-shadows');
result.stats.shadowMutation = await page.evaluate(() => ({
  checked: document.getElementById('setting-shadows')?.checked,
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').shadows,
  renderer: window.sceneMgr?.renderer?.shadowMap?.enabled
}));
await page.fill('#settings-search', 'camera');
result.stats.settingsSearch = await page.evaluate(() => ({
  visibleSections: [...document.querySelectorAll('.settings-section')].filter((section) => !section.hidden).map((section) => section.dataset.settingsSection),
  visibleRows: [...document.querySelectorAll('.settings-item')].filter((row) => !row.hidden).length,
  summary: document.getElementById('settings-search-summary')?.textContent
}));
await page.fill('#settings-search', '');
await page.locator('#setting-temperature').evaluate((el) => {
  el.value = '1';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
result.stats.temperatureMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').councilTemperature,
  runtime: window.town?.governance?.temperature,
  max: document.getElementById('setting-temperature')?.max
}));
await page.locator('#setting-congestion-threshold').evaluate((el) => {
  el.value = '0.6';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
result.stats.congestionMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').averageCongestionThreshold,
  value: document.getElementById('setting-congestion-threshold')?.value,
  runtimeGate: window.getSettings?.().averageCongestionThreshold
}));
await page.fill('#setting-council-sittings', '4');
await page.locator('#setting-council-sittings').press('Tab');
result.stats.councilCadenceMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').councilSittingsPerDay,
  runtime: window.town?.governance?.sittingsPerDay,
  cadenceHours: window.town?.governance?.stats?.().cadenceHours
}));
await page.fill('#setting-cabinet-motions', '3');
await page.locator('#setting-cabinet-motions').press('Tab');
result.stats.cabinetMotionsMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').cabinetMotionsPerSitting,
  runtime: window.town?.governance?.cabinet?.motionsPerSitting
}));
await page.fill('#setting-residents', '4');
await page.locator('#setting-residents').press('Tab');
await page.fill('#setting-max-population', '900');
await page.locator('#setting-max-population').press('Tab');
result.stats.settingsMutation = await page.evaluate(async () => {
  const { residentialCapacityPerFloor } = await import('/src/kits/houses/houseKit.js');
  return {
    stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').residentsPerTilePerFloor,
    maxPopulation: JSON.parse(localStorage.getItem('tomm.settings') || '{}').maxPopulation,
    runtimeCap: window.town?.pedestrians?.citizens?.length <= (window.town?.stats?.()?.progression?.populationCap || 0),
    capacity: residentialCapacityPerFloor({ footprintTiles: 1 })
  };
});
await page.fill('#setting-camera-target-x', '-10');
await page.locator('#setting-camera-target-x').press('Tab');
result.stats.cameraMutation = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').cameraTargetX,
  target: window.sceneMgr.controls.target.x,
  readout: document.getElementById('camera-pan')?.textContent
}));
await page.click('#settings-reset');
result.stats.settingsReset = await page.evaluate(() => ({
  residents: document.getElementById('setting-residents')?.value,
  maxPopulation: document.getElementById('setting-max-population')?.value,
  councilSittings: document.getElementById('setting-council-sittings')?.value,
  cabinetMotions: document.getElementById('setting-cabinet-motions')?.value,
  congestionThreshold: document.getElementById('setting-congestion-threshold')?.value,
  shadows: document.getElementById('setting-shadows')?.checked,
  stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').residentsPerTilePerFloor,
  targetX: window.sceneMgr.controls.target.x,
  targetZ: window.sceneMgr.controls.target.z,
  zoom: window.sceneMgr.camera.position.distanceTo(window.sceneMgr.controls.target),
  fitTown: JSON.parse(localStorage.getItem('tomm.settings') || '{}').fitTown
}));
await page.click('#modal-close');
await page.setViewportSize({ width: 1024, height: 768 });
result.stats.ribbon1024 = await page.evaluate(() => {
  const tools = document.getElementById('tools').getBoundingClientRect();
  const settings = document.getElementById('settings-toggle').getBoundingClientRect();
  const reset = document.getElementById('reset-town').getBoundingClientRect();
  const fit = document.getElementById('fit-town').getBoundingClientRect();
  return { overflow: settings.right > tools.right + 1 || reset.right > tools.right + 1 || fit.right > tools.right + 1 };
});

const failures = [
  ...(result.stats.branding?.title !== 'TOMM — three.js town simulator' || (result.stats.branding?.loading != null && result.stats.branding?.loading !== 'TOMM') || result.stats.branding?.heading !== 'TOMM Simulator' ? ['branding still exposes a legacy town name'] : []),
  ...(result.missing.length ? [`missing DOM nodes: ${result.missing.join(', ')}`] : []),
  ...(result.stats.population <= 0 ? ['town did not initialise citizens'] : []),
  ...(result.stats.buildings <= 0 ? ['town did not initialise buildings'] : []),
  ...(result.stats.catalogue && !result.stats.catalogue.ok ? ['construction catalogue audit failed'] : []),
  ...(!result.stats.providerHooks ? ['council/provider hooks are not exposed'] : []),
  ...(result.stats.cameraToolbar?.actions?.length !== 8 || result.stats.cameraToolbar?.presets?.join(',') !== 'iso,top,north,east' ? ['camera toolbar is missing a nudge or preset control'] : []),
  ...(result.stats.cameraToolbarMutation?.readout?.includes('NaN') || result.stats.cameraPresetMutation?.orbit?.includes('NaN') ? ['camera toolbar produced an invalid pose'] : []),
  ...(!result.stats.sceneAtmosphere?.skybox || !(result.stats.sceneAtmosphere.fogNear > 0) || !(result.stats.sceneAtmosphere.fogFar > result.stats.sceneAtmosphere.fogNear) ? ['skybox or horizon fog is missing'] : []),
  ...(!result.stats.weather?.season || !result.stats.weather?.weatherLabel ? ['weather system is missing live season/weather state'] : []),
  ...(result.stats.fitTown?.pressed !== 'true' || !result.stats.fitTown?.active ? ['Fit Town is not enabled by default'] : []),
  ...(result.stats.fitTownOff?.pressed !== 'false' || result.stats.fitTownOff?.stored !== false ? ['Fit Town toggle did not persist off'] : []),
  ...(result.stats.fitTownOn?.pressed !== 'true' || result.stats.fitTownOn?.stored !== true ? ['Fit Town toggle did not persist on'] : []),
  ...(result.stats.fitTown?.acquiredBounds && Math.abs((result.stats.fitTown?.target?.[0] ?? 0) - (((result.stats.fitTown.acquiredBounds.minX + result.stats.fitTown.acquiredBounds.maxX) / 2 - 49.5) * 4)) > 8 ? ['initial camera did not fit the acquired land bounds'] : []),
  ...(result.stats.fitTown?.zoom > 190 ? ['Fit Town still leaves too much frontier margin'] : []),
  ...(result.stats.expansionFit?.acquiredBounds && (Math.abs((result.stats.expansionFit.target?.[0] ?? 0) - (((result.stats.expansionFit.acquiredBounds.minX + result.stats.expansionFit.acquiredBounds.maxX) / 2 - 49.5) * 4)) > 8 || Math.abs((result.stats.expansionFit.target?.[2] ?? 0) - (((result.stats.expansionFit.acquiredBounds.minY + result.stats.expansionFit.acquiredBounds.maxY) / 2 - 49.5) * 4)) > 8) ? ['Fit Town did not reframe after acquired-land growth'] : []),
  ...(result.stats.settingsReset?.fitTown !== true ? ['settings restore defaults did not re-enable Fit Town'] : []),
  ...(!result.stats.settings?.open ? ['settings modal did not open'] : []),
  ...(result.stats.settings?.residents !== '3' ? ['settings modal has the wrong residential density default'] : []),
  ...(result.stats.settings?.maxPopulation !== '1000' ? ['settings modal has the wrong maximum population default'] : []),
  ...(result.stats.settings?.glow !== '1' ? ['settings modal has the wrong glow default'] : []),
  ...(result.stats.settings?.shadows !== false || result.stats.settings?.rendererShadows !== false ? ['shadows are not disabled by default'] : []),
  ...(result.stats.shadowMutation?.checked !== true || result.stats.shadowMutation?.stored !== true || result.stats.shadowMutation?.renderer !== true ? ['shadow setting did not enable the renderer'] : []),
  ...(result.stats.settings?.temperatureMax !== '1' ? ['settings modal temperature does not allow 1.0'] : []),
  ...(result.stats.settings?.speed !== '100' ? ['settings modal has the wrong speed default'] : []),
  ...(result.stats.settings?.councilSittings !== '2' ? ['settings modal has the wrong Council cadence default'] : []),
  ...(result.stats.settings?.cabinetMotions !== '5' ? ['settings modal has the wrong Cabinet motion default'] : []),
  ...(result.stats.settings?.congestionThreshold !== '0.5' || result.stats.settings?.congestionThresholdMin !== '0.1' || result.stats.settings?.congestionThresholdMax !== '0.9' ? ['settings modal has the wrong average congestion gate slider'] : []),
  ...(!result.stats.settings?.speedOptions?.includes('100') ? ['settings modal is missing the 100x speed option'] : []),
  ...(result.stats.settings?.cameraYaw !== '34.5' || result.stats.settings?.cameraPitch !== '64' || result.stats.settings?.cameraZoom !== '228' || result.stats.settings?.cameraTargetX !== '-20' || result.stats.settings?.cameraTargetZ !== '-40' ? ['settings modal has the wrong camera defaults'] : []),
  ...(result.stats.settings?.sectionCount !== 4 || !result.stats.settings?.searchable ? ['settings modal is missing search or sections'] : []),
  ...(result.stats.storehouse?.overflowY !== 'auto' || !result.stats.storehouse?.maxHeight || result.stats.storehouse?.rows < 18 ? ['storehouse rows are missing its bounded scroll region'] : []),
  ...(result.stats.settingsSearch?.visibleSections.join(',') !== 'camera' || result.stats.settingsSearch?.visibleRows !== 5 ? ['settings search did not isolate camera controls'] : []),
  ...(result.stats.cameraMutation?.stored !== -10 || Math.abs((result.stats.cameraMutation?.target ?? 0) + 10) > 0.01 ? ['pan setting did not update the OrbitControls target'] : []),
  ...(!result.stats.cameraOrbit?.includes('yaw') || !result.stats.cameraZoom?.endsWith('m') || !result.stats.cameraPan?.includes('x') ? ['camera readout is missing orbit, zoom, or pan values'] : []),
  ...(result.stats.settingsMutation?.stored !== 4 || result.stats.settingsMutation?.capacity !== 4 ? ['residential density setting did not apply to kit capacity'] : []),
  ...(result.stats.settingsMutation?.maxPopulation !== 900 ? ['maximum population setting did not persist'] : []),
  ...(result.stats.congestionMutation?.stored !== 0.6 || result.stats.congestionMutation?.runtimeGate !== 0.6 ? ['average congestion gate setting did not persist'] : []),
  ...(result.stats.temperatureMutation?.stored !== 1 || result.stats.temperatureMutation?.runtime !== 1 ? ['temperature 1.0 did not persist or reach the live Council'] : []),
  ...(result.stats.councilCadenceMutation?.stored !== 4 || result.stats.councilCadenceMutation?.runtime !== 4 || result.stats.councilCadenceMutation?.cadenceHours !== 6 ? ['Council cadence setting did not reach the live Council'] : []),
  ...(result.stats.cabinetMotionsMutation?.stored !== 3 || result.stats.cabinetMotionsMutation?.runtime !== 3 ? ['Cabinet motion setting did not reach the live Council'] : []),
  ...(result.stats.settingsReset?.residents !== '3' || result.stats.settingsReset?.maxPopulation !== '1000' || result.stats.settingsReset?.councilSittings !== '2' || result.stats.settingsReset?.cabinetMotions !== '5' || result.stats.settingsReset?.congestionThreshold !== '0.5' || result.stats.settingsReset?.stored !== 3 ? ['settings restore defaults did not persist'] : []),
  ...(result.stats.settingsReset?.shadows !== false ? ['settings restore defaults did not disable shadows'] : []),
  ...(result.stats.settingsReset?.fitTown !== true || Math.abs((result.stats.settingsReset?.targetX ?? 0) - (((result.stats.resetFitTown?.acquiredBounds?.minX + result.stats.resetFitTown?.acquiredBounds?.maxX) / 2 - 49.5) * 4)) > 8 || Math.abs((result.stats.settingsReset?.targetZ ?? 0) - (((result.stats.resetFitTown?.acquiredBounds?.minY + result.stats.resetFitTown?.acquiredBounds?.maxY) / 2 - 49.5) * 4)) > 8 ? ['settings restore defaults did not restore acquired-land framing'] : []),
  ...(result.stats.ribbon1024?.overflow ? ['bottom ribbon controls overflow at 1024px'] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
