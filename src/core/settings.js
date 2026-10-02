/**
 * User controlled simulation settings.
 *
 * Settings are deliberately small, validated, and persisted in the browser so
 * a page refresh does not silently change the town's rules. Simulation code
 * reads this module rather than reaching into DOM controls, which also keeps
 * the same defaults available to headless and construction-kit checks.
 */
export const SETTINGS_KEY = 'town3.settings';

export const SETTINGS_DEFAULTS = Object.freeze({
  residentsPerTilePerFloor: 3,
  maxPopulation: 1000,
  glowIntensity: 1,
  councilTemperature: 0.15,
  autoCouncil: true,
  defaultSpeed: 100,
  cameraYaw: 34.5,
  cameraPitch: 64,
  cameraZoom: 228,
  cameraTargetX: -20,
  cameraTargetZ: -40
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalise(patch = {}) {
  const residents = Number(patch.residentsPerTilePerFloor);
  const maxPopulation = Number(patch.maxPopulation);
  const glow = Number(patch.glowIntensity);
  const temperature = Number(patch.councilTemperature);
  const speed = Number(patch.defaultSpeed);
  const cameraYaw = Number(patch.cameraYaw);
  const cameraPitch = Number(patch.cameraPitch);
  const cameraZoom = Number(patch.cameraZoom);
  const cameraTargetX = Number(patch.cameraTargetX);
  const cameraTargetZ = Number(patch.cameraTargetZ);
  return {
    residentsPerTilePerFloor: Number.isFinite(residents)
      ? Math.round(clamp(residents, 1, 8))
      : SETTINGS_DEFAULTS.residentsPerTilePerFloor,
    maxPopulation: Number.isFinite(maxPopulation)
      ? Math.round(clamp(maxPopulation, 30, 1000))
      : SETTINGS_DEFAULTS.maxPopulation,
    glowIntensity: Number.isFinite(glow)
      ? Math.round(clamp(glow, 0.2, 2) * 10) / 10
      : SETTINGS_DEFAULTS.glowIntensity,
    councilTemperature: Number.isFinite(temperature)
      ? Math.round(clamp(temperature, 0, 1) * 100) / 100
      : SETTINGS_DEFAULTS.councilTemperature,
    autoCouncil: patch.autoCouncil !== false,
    defaultSpeed: [0, 1, 2, 4, 10, 20, 50, 100].includes(speed)
      ? speed
      : SETTINGS_DEFAULTS.defaultSpeed,
    cameraYaw: Number.isFinite(cameraYaw)
      ? Math.round(clamp(cameraYaw, -180, 180) * 2) / 2
      : SETTINGS_DEFAULTS.cameraYaw,
    cameraPitch: Number.isFinite(cameraPitch)
      ? Math.round(clamp(cameraPitch, 0, 80))
      : SETTINGS_DEFAULTS.cameraPitch,
    cameraZoom: Number.isFinite(cameraZoom)
      ? Math.round(clamp(cameraZoom, 40, 500))
      : SETTINGS_DEFAULTS.cameraZoom,
    cameraTargetX: Number.isFinite(cameraTargetX)
      ? Math.round(clamp(cameraTargetX, -96, 96) * 2) / 2
      : SETTINGS_DEFAULTS.cameraTargetX,
    cameraTargetZ: Number.isFinite(cameraTargetZ)
      ? Math.round(clamp(cameraTargetZ, -80, 80) * 2) / 2
      : SETTINGS_DEFAULTS.cameraTargetZ
  };
}

function readStored() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let current = normalise({ ...SETTINGS_DEFAULTS, ...readStored() });

function persist() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Storage can be disabled or full. The current session still has settings.
  }
}

export function getSettings() {
  return { ...current };
}

export function updateSettings(patch = {}) {
  current = normalise({ ...current, ...patch });
  persist();
  return getSettings();
}

export function resetSettings() {
  current = normalise(SETTINGS_DEFAULTS);
  persist();
  return getSettings();
}
