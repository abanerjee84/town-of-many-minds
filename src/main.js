import * as THREE from 'three';
import { SceneManager } from './world/scene.js';
import { Town, GRID_W, GRID_H } from './simulation/town.js';
import { Clock } from './core/clock.js';
import { CELL, SIM } from './core/config.js';
import { getSettings, updateSettings, resetSettings } from './core/settings.js';
import { setGlowLevel } from './kits/glow.js';
import { events } from './core/events.js';
import { Hud } from './ui/hud.js';
import { Interaction } from './ui/interaction.js';
import { roadRoute } from './simulation/routes.js';
import { planFor as planForType } from './simulation/growth.js';
import { validationSummary, validateTown } from './placement/validator.js';
import { parseIntent, planCode, systemPrompt, SYSTEM_PROMPT, COUNCIL_PROMPT_TOKEN_BUDGET } from './simulation/governance.js';
import { registerLLMProvider, listLLMProviders } from './simulation/llmProviders.js';
import { councilSnapshot, scoreCouncilRun, runCouncilBenchmark } from './simulation/councilBenchmark.js';
import { CONSTRUCTION_BLOCKS, listConstructionBlocks, constructionBlockStats, auditConstructionBlocks, constructionBlockDemand } from './kits/constructionBlocks.js';
import { constructionPalette } from './simulation/constructionPalette.js';
import { urbanProfile, edgeScore, INDUSTRIAL_MIN_EDGE, roadComponents, hasNetworkAccess } from './placement/placementController.js';

const container = document.getElementById('app');
const sceneMgr = new SceneManager(container);
sceneMgr.buildGround(GRID_W * CELL, GRID_H * CELL);

const clock = new Clock();
const town = new Town(sceneMgr.scene);

const hud = new Hud(clock, town);
const interaction = new Interaction({
  camera: sceneMgr.camera,
  dom: sceneMgr.renderer.domElement,
  town,
  clock
});

// The pale ground is the acquired town perimeter. The broader dark skirt is
// future land; each successful acquisition expands the visible buildable
// surface so perimeter growth is legible in the world, not only in the HUD.
const syncPlayableGround = () => sceneMgr.setPlayableBounds(town.perimeter?.stats?.().bounds, town.grid);
events.on('land-acquired', syncPlayableGround);
events.on('land-released', syncPlayableGround);

function updateCameraReadout() {
  const controls = sceneMgr.controls;
  const orbit = document.getElementById('camera-orbit');
  const zoom = document.getElementById('camera-zoom');
  const pan = document.getElementById('camera-pan');
  if (!orbit || !zoom || !pan) return;
  const pitch = THREE.MathUtils.radToDeg(controls.getPolarAngle());
  // OrbitControls has no meaningful azimuth at the exact pole and reports
  // 0° there. Preserve the requested Settings yaw for that one pose so a
  // 90°/0°/300 m inspection remains truthful in the readout.
  const azimuth = pitch < 0.05 ? sceneMgr.cameraYaw : controls.getAzimuthalAngle();
  const yaw = THREE.MathUtils.radToDeg(azimuth);
  const distance = sceneMgr.camera.position.distanceTo(controls.target);
  orbit.textContent = `${yaw.toFixed(1)}° yaw · ${pitch.toFixed(1)}° tilt`;
  zoom.textContent = `${distance.toFixed(0)} m`;
  pan.textContent = `x ${controls.target.x.toFixed(1)} · z ${controls.target.z.toFixed(1)}`;
}

function applySettingsToRuntime({ speed = false, camera = false, population = false } = {}) {
  const settings = getSettings();
  // SIM is a shared runtime contract used by lifecycle admission and citizen
  // spawning. Apply the persisted cap before the first generate() call and on
  // every live edit; lowering it never deletes existing residents.
  if (population || SIM.maxCitizens !== settings.maxPopulation) SIM.maxCitizens = settings.maxPopulation;
  if (speed) clock.speed = settings.defaultSpeed;
  if (camera) sceneMgr.applyCameraDefaults(settings);
  if (town.governance) {
    town.governance.temperature = settings.councilTemperature;
    town.governance.auto = settings.autoCouncil;
  }
  hud.syncSpeed();
  updateCameraReadout();
}

function renderSettings() {
  const settings = getSettings();
  const modal = document.getElementById('insp-modal');
  const modalBox = modal.querySelector('.modal-box');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const speedOptions = [0, 1, 2, 4, 10, 20, 50, 100]
    .map((speed) => `<option value="${speed}"${speed === settings.defaultSpeed ? ' selected' : ''}>${speed === 0 ? 'Paused' : `${speed}×`}</option>`)
    .join('');

  modalBox.classList.add('settings-modal-box');
  title.textContent = 'Simulation settings';
  body.innerHTML = `
    <div class="settings-form">
      <div class="settings-toolbar">
        <label class="settings-search"><span aria-hidden="true">⌕</span><input id="settings-search" type="search" placeholder="Search settings" aria-label="Search settings" autocomplete="off" /><button id="settings-search-clear" type="button" title="Clear settings search" aria-label="Clear settings search">×</button></label>
        <span id="settings-search-summary" class="settings-search-summary"></span>
      </div>
      <section class="settings-section" data-settings-section="simulation">
        <div class="settings-section-head"><h3>Simulation</h3><span>Town rules and clock</span></div>
        <label class="settings-row settings-item" data-setting-search="residents residential density family people tile floor housing">
          <span><b>Avg residents per tile / floor</b><small>New residential construction and vertical growth</small></span>
          <input id="setting-residents" type="number" min="1" max="8" step="1" value="${settings.residentsPerTilePerFloor}" />
        </label>
        <label class="settings-row settings-item" data-setting-search="maximum population residents citizen cap settlement limit">
          <span><b>Maximum population</b><small>Hard resident ceiling for this run (30–1,000)</small></span>
          <input id="setting-max-population" type="number" min="30" max="1000" step="10" value="${settings.maxPopulation}" />
        </label>
        <label class="settings-row settings-item" data-setting-search="default simulation speed clock reset time">
          <span><b>Default simulation speed</b><small>Speed restored by Reset</small></span>
          <select id="setting-speed">${speedOptions}</select>
        </label>
      </section>
      <section class="settings-section" data-settings-section="council">
        <div class="settings-section-head"><h3>Council</h3><span>LLM decision behaviour</span></div>
        <label class="settings-row settings-item" data-setting-search="council creativity llm temperature variety proposals">
          <span><b>Council creativity</b><small>LLM temperature for varied proposals</small></span>
          <span class="settings-inline"><input id="setting-temperature" type="range" min="0" max="0.6" step="0.05" value="${settings.councilTemperature}" /><output id="setting-temperature-value">${settings.councilTemperature.toFixed(2)}</output></span>
        </label>
        <label class="settings-check settings-item" data-setting-search="automatic llm council decisions governance">
          <input id="setting-auto-council" type="checkbox"${settings.autoCouncil ? ' checked' : ''} /> <span><b>Automatic LLM Council</b><small>Let the council make scheduled decisions</small></span>
        </label>
      </section>
      <section class="settings-section" data-settings-section="visuals">
        <div class="settings-section-head"><h3>Visuals</h3><span>Lighting and atmosphere</span></div>
        <label class="settings-row settings-item" data-setting-search="night glow lighting lamps windows emissive">
          <span><b>Night glow</b><small>Window, lamp and emissive light strength</small></span>
          <span class="settings-inline"><input id="setting-glow" type="range" min="0.2" max="2" step="0.1" value="${settings.glowIntensity}" /><output id="setting-glow-value">${settings.glowIntensity.toFixed(1)}×</output></span>
        </label>
      </section>
      <section class="settings-section" data-settings-section="camera">
        <div class="settings-section-head"><h3>Camera</h3><span>Defaults used on load and Reset</span></div>
        <label class="settings-row settings-item" data-setting-search="camera orbit yaw azimuth direction">
          <span><b>Default orbit yaw</b><small>Horizontal rotation around the town</small></span>
          <span class="settings-inline"><input id="setting-camera-yaw" type="range" min="-180" max="180" step="0.5" value="${settings.cameraYaw}" /><output id="setting-camera-yaw-value">${settings.cameraYaw.toFixed(1)}°</output></span>
        </label>
        <label class="settings-row settings-item" data-setting-search="camera orbit pitch tilt elevation angle">
          <span><b>Default orbit tilt</b><small>Vertical camera angle from the top</small></span>
          <span class="settings-inline"><input id="setting-camera-pitch" type="range" min="0" max="80" step="1" value="${settings.cameraPitch}" /><output id="setting-camera-pitch-value">${settings.cameraPitch.toFixed(0)}°</output></span>
        </label>
        <label class="settings-row settings-item" data-setting-search="camera zoom distance view scale">
          <span><b>Default zoom distance</b><small>Camera distance restored on Reset</small></span>
          <span class="settings-inline"><input id="setting-camera-zoom" type="range" min="40" max="500" step="1" value="${settings.cameraZoom}" /><output id="setting-camera-zoom-value">${settings.cameraZoom.toFixed(0)} m</output></span>
        </label>
        <label class="settings-row settings-item" data-setting-search="camera pan right drag target x horizontal">
          <span><b>Default pan X</b><small>Right-drag target coordinate, horizontal axis</small></span>
          <input id="setting-camera-target-x" type="number" min="-96" max="96" step="0.5" value="${settings.cameraTargetX}" />
        </label>
        <label class="settings-row settings-item" data-setting-search="camera pan right drag target z depth">
          <span><b>Default pan Z</b><small>Right-drag target coordinate, depth axis</small></span>
          <input id="setting-camera-target-z" type="number" min="-80" max="80" step="0.5" value="${settings.cameraTargetZ}" />
        </label>
      </section>
      <div class="settings-note">Residential density applies to homes built after the change and to the next Reset. Founding homes retain their five-bed starter contract.</div>
      <button id="settings-reset" class="settings-reset" type="button">Restore defaults</button>
    </div>`;

  const sections = [...body.querySelectorAll('.settings-section')];
  const search = document.getElementById('settings-search');
  const searchSummary = document.getElementById('settings-search-summary');
  const filterSettings = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const section of sections) {
      let sectionVisible = 0;
      for (const row of section.querySelectorAll('.settings-item')) {
        const matches = !query || row.dataset.settingSearch.includes(query);
        row.hidden = !matches;
        if (matches) sectionVisible++;
      }
      section.hidden = sectionVisible === 0;
      visible += sectionVisible;
    }
    searchSummary.textContent = query ? `${visible} match${visible === 1 ? '' : 'es'}` : `${visible} settings`;
  };
  search.addEventListener('input', filterSettings);
  document.getElementById('settings-search-clear').addEventListener('click', () => {
    search.value = '';
    filterSettings();
    search.focus();
  });
  filterSettings();

  const residents = document.getElementById('setting-residents');
  residents.addEventListener('change', () => {
    const next = updateSettings({ residentsPerTilePerFloor: residents.value });
    residents.value = String(next.residentsPerTilePerFloor);
  });

  const maxPopulation = document.getElementById('setting-max-population');
  maxPopulation.addEventListener('change', () => {
    const next = updateSettings({ maxPopulation: maxPopulation.value });
    maxPopulation.value = String(next.maxPopulation);
    applySettingsToRuntime({ population: true });
  });

  const glow = document.getElementById('setting-glow');
  const glowValue = document.getElementById('setting-glow-value');
  glow.addEventListener('input', () => {
    const next = updateSettings({ glowIntensity: glow.value });
    glowValue.textContent = `${next.glowIntensity.toFixed(1)}×`;
  });

  const temperature = document.getElementById('setting-temperature');
  const temperatureValue = document.getElementById('setting-temperature-value');
  temperature.addEventListener('input', () => {
    const next = updateSettings({ councilTemperature: temperature.value });
    temperatureValue.textContent = next.councilTemperature.toFixed(2);
    applySettingsToRuntime();
  });

  document.getElementById('setting-speed').addEventListener('change', (event) => {
    updateSettings({ defaultSpeed: event.target.value });
    applySettingsToRuntime({ speed: true });
  });
  document.getElementById('setting-auto-council').addEventListener('change', (event) => {
    updateSettings({ autoCouncil: event.target.checked });
    applySettingsToRuntime();
  });
  const bindCameraRange = (id, key, outputId, format) => {
    const input = document.getElementById(id);
    const output = document.getElementById(outputId);
    input.addEventListener('input', () => {
      const next = updateSettings({ [key]: input.value });
      output.textContent = format(next[key]);
      applySettingsToRuntime({ camera: true });
    });
  };
  bindCameraRange('setting-camera-yaw', 'cameraYaw', 'setting-camera-yaw-value', (value) => `${value.toFixed(1)}°`);
  bindCameraRange('setting-camera-pitch', 'cameraPitch', 'setting-camera-pitch-value', (value) => `${value.toFixed(0)}°`);
  bindCameraRange('setting-camera-zoom', 'cameraZoom', 'setting-camera-zoom-value', (value) => `${value.toFixed(0)} m`);
  const bindCameraNumber = (id, key) => {
    const input = document.getElementById(id);
    input.addEventListener('change', () => {
      const next = updateSettings({ [key]: input.value });
      input.value = String(next[key]);
      applySettingsToRuntime({ camera: true });
    });
  };
  bindCameraNumber('setting-camera-target-x', 'cameraTargetX');
  bindCameraNumber('setting-camera-target-z', 'cameraTargetZ');
  document.getElementById('settings-reset').addEventListener('click', () => {
    resetSettings();
    applySettingsToRuntime({ speed: true, camera: true, population: true });
    renderSettings();
  });
  modal.classList.remove('hidden');
  search.focus();
}

applySettingsToRuntime({ speed: true, camera: true, population: true });

function currentSeed() {
  const input = document.getElementById('seed-input');
  const raw = (input?.value || '1337').trim();
  return raw.length ? raw : '1337';
}

function generate(seed) {
  town.generate(seed);
  syncPlayableGround();
  // Town generation resets governance state; carry the user's council controls
  // back onto the new run without changing the currently selected speed.
  applySettingsToRuntime();
  const s = town.stats();
  const pipe = s.pipeline ? `${s.pipeline.steps} stages · ${s.pipeline.ms} ms` : '';
  const val = validationSummary(s.validation);
  events.emit('log', {
    kind: 'event',
    text: `Town "${seed}" placed · ${s.buildings} buildings, ${s.roads} road tiles, ${s.population} citizens · ${pipe} · ${val}.`
  });
  if (s.validation && !s.validation.ok) {
    for (const e of s.validation.errors) events.emit('log', { kind: 'event', text: `Validation · ${e}` });
  } else if (s.validation?.warnings?.length) {
    for (const w of s.validation.warnings.slice(0, 4)) events.emit('log', { kind: 'event', text: `Validation · ${w}` });
  }
  interaction.select(null);
}

document.getElementById('regen').addEventListener('click', () => {
  generate(currentSeed());
  interaction.select(null);
});

document.getElementById('seed-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    generate(currentSeed());
    interaction.select(null);
  }
});

document.getElementById('reset-town').addEventListener('click', () => {
  const seed = currentSeed();
  town.fullReset(seed);
  syncPlayableGround();
  clock.reset();
  sceneMgr.resetView();
  applySettingsToRuntime({ speed: true, camera: true, population: true });
  hud.clearLog();
  interaction.select(null);
  const s = town.stats();
  events.emit('log', {
    kind: 'event',
    text: `Reset · "${seed}" · ${s.buildings} buildings, ${s.roads} road tiles, ${s.households} households, ${s.population} citizens.`
  });
});

document.getElementById('view-centre').addEventListener('click', () => {
  const junctions = town.grid.roadCells().filter(([x, y]) => town.grid.roadDegree(x, y) >= 3);
  let centre = null;
  let best = Infinity;
  for (const cell of junctions) {
    const p = town.grid.cellToWorld(cell[0], cell[1]);
    const d = p.x * p.x + p.z * p.z;
    if (d < best) {
      best = d;
      centre = p;
    }
  }
  sceneMgr.focusCentre(centre?.x || 0, centre?.z || 0, getSettings());
  updateCameraReadout();
});

const cameraActions = {
  'orbit-left': () => sceneMgr.nudgeCamera({ yaw: -15 }),
  'orbit-right': () => sceneMgr.nudgeCamera({ yaw: 15 }),
  'tilt-up': () => sceneMgr.nudgeCamera({ pitch: -10 }),
  'tilt-down': () => sceneMgr.nudgeCamera({ pitch: 10 }),
  'zoom-in': () => sceneMgr.nudgeCamera({ zoom: -20 }),
  'zoom-out': () => sceneMgr.nudgeCamera({ zoom: 20 }),
  'camera-home': () => sceneMgr.resetView(),
  'camera-centre': () => document.getElementById('view-centre').click()
};
const cameraPresets = {
  iso: { yaw: 45, pitch: 55, zoom: 360 },
  // A 500m top-down view fits the entire 400m build plate while retaining a
  // readable margin for the HUD panels.
  top: { yaw: 0, pitch: 0, zoom: 500 },
  north: { yaw: 0, pitch: 64, zoom: 228 },
  east: { yaw: 90, pitch: 64, zoom: 228 }
};
for (const button of document.querySelectorAll('#camera-toolbar [data-camera-action]')) {
  button.addEventListener('click', () => {
    cameraActions[button.dataset.cameraAction]?.();
    updateCameraReadout();
  });
}
for (const button of document.querySelectorAll('#camera-toolbar [data-camera-preset]')) {
  button.addEventListener('click', () => {
    sceneMgr.setCameraPose(cameraPresets[button.dataset.cameraPreset]);
    updateCameraReadout();
  });
}

document.getElementById('settings-toggle').addEventListener('click', renderSettings);

generate(currentSeed());

const rayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
void rayPlane;

/**
 * Run one system, containing any fault to itself.
 *
 * A throw in a single subsystem must not be able to end the game. The frame
 * loop used to have no `try`/`catch` anywhere and re-armed
 * `requestAnimationFrame` as its final statement, so one fault in any of the ten
 * systems below killed the loop permanently — one console error, the clock
 * frozen, and the Regen button still live, leaving the player with a world that
 * looks interactive and is not. Every other defect in the audit is recoverable;
 * that one is not, so each step is isolated and a faulting system is skipped
 * rather than fatal.
 *
 * A fault is reported ONCE per system. A per-frame `console.error` on a system
 * that throws every frame is itself a denial of service, and it buries the one
 * message that matters.
 */
const faulted = new Set();
function step(name, fn) {
  try {
    fn();
  } catch (error) {
    if (!faulted.has(name)) {
      faulted.add(name);
      console.error(`[town3] "${name}" failed and will be skipped until it recovers:`, error);
      events.emit('log', { kind: 'event', text: `Simulation fault in ${name} — skipped, the town keeps running.` });
    }
  }
}

let last = performance.now();
function frame(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.1, rawDt);
  last = now;

  // Pause while the council's LLM is thinking. Two reasons, both load-bearing:
  // the town report the model reads is snapshotted at ask() time, so a world
  // that keeps moving under a 20-second round-trip answers a town that no
  // longer exists; and at 10x–50x a single sitting would burn hours of game
  // time mid-decision. Speed is held and restored inside the same frame (JS is
  // single-threaded, so a click cannot land between the two), which keeps the
  // HUD's speed buttons on the user's intended rate, lets a click DURING the
  // freeze stick as the resume rate, and still stops the rotors and the clock
  // for the frame (resourceKit freezes on clock.speed === 0, the same rule the
  // pause button uses). The rules fallback is never paused: its decision is
  // synchronous and clears pending before enact runs.
  const thinking = !!town.governance?.pending;
  const heldSpeed = thinking ? clock.speed : 0;
  if (thinking) clock.speed = 0;

  try {
    step('clock', () => clock.update(dt));
    const simDt = dt * clock.speed;

    // Traffic, signals, incidents and pedestrians share one fixed step (P-E04):
    // they are advanced together inside town.advance() rather than in two
    // separate batches, so a crossing decision can no longer depend on how the
    // frame was chunked between them.
    step('advance', () => town.advance(simDt, clock));
    step('lifecycle', () => town.lifecycle.update(simDt, clock));
    step('economy', () => town.economy.update(simDt, clock));
    step('industry', () => town.industry.update(simDt, clock));
    step('growth', () => town.growth.update(simDt));
    step('governance', () => town.governance.update(simDt, clock));
    step('utilities', () => town.utilities.update(clock));
    step('resources', () => town.resources.update(clock, dt));

    // The held speed MUST be restored even if a system above threw, or the clock
    // stays frozen forever and the player cannot unpause their way out.
    if (thinking) clock.speed = heldSpeed;

    step('lighting', () => sceneMgr.updateLighting(clock));
    step('glow', () => setGlowLevel(sceneMgr.nightFactor * getSettings().glowIntensity));

    step('hud', () => hud.update(town.stats(), rawDt));
    step('interaction', () => interaction.update(rawDt));
    step('camera-readout', updateCameraReadout);
    step('render', () => sceneMgr.render());
  } finally {
    // The one guarantee the loop makes: it always reschedules. Everything above
    // is best-effort; this is not.
    requestAnimationFrame(frame);
  }
}

requestAnimationFrame(frame);

const loading = document.getElementById('loading');
setTimeout(() => {
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 500);
}, 250);

window.THREE = THREE;
window.town = town;
window.clock = clock;
window.events = events;
window.sceneMgr = sceneMgr;
window.interaction = interaction;
window.hud = hud;
window.roadRoute = roadRoute;
window.validateTown = validateTown;
window.parseIntent = parseIntent;
window.systemPrompt = systemPrompt;
window.SYSTEM_PROMPT = SYSTEM_PROMPT;
window.COUNCIL_PROMPT_TOKEN_BUDGET = COUNCIL_PROMPT_TOKEN_BUDGET;
window.urbanProfile = urbanProfile;
window.edgeScore = edgeScore;
window.INDUSTRIAL_MIN_EDGE = INDUSTRIAL_MIN_EDGE;
window.roadComponents = roadComponents;
window.hasNetworkAccess = hasNetworkAccess;
window.planFor = planForType;
window.planCode = planCode;
window.forceCouncilRequest = (text) => town.governance?.forceRequest?.(text) || { status: 'unavailable' };
window.registerLLMProvider = registerLLMProvider;
window.listLLMProviders = listLLMProviders;
window.councilSnapshot = councilSnapshot;
window.scoreCouncilRun = scoreCouncilRun;
window.runCouncilBenchmark = runCouncilBenchmark;
window.CONSTRUCTION_BLOCKS = CONSTRUCTION_BLOCKS;
window.listConstructionBlocks = listConstructionBlocks;
window.constructionBlockStats = constructionBlockStats;
window.auditConstructionBlocks = auditConstructionBlocks;
window.constructionBlockDemand = constructionBlockDemand;
window.constructionPalette = (opts = {}) => constructionPalette(town, opts);
