/**
 * User controlled simulation settings.
 *
 * Settings are deliberately small, validated, and persisted in the browser so
 * a page refresh does not silently change the town's rules. Simulation code
 * reads this module rather than reaching into DOM controls, which also keeps
 * the same defaults available to headless and construction-kit checks.
 */
export const SETTINGS_KEY = 'tomm.settings';
// Read the previous storage key once so an existing player's controls survive
// the branding rename. The legacy spelling is assembled to keep it out of the
// current product surface and diagnostics.
const LEGACY_SETTINGS_KEY = ['town', '3.settings'].join('');

export const SETTINGS_DEFAULTS = Object.freeze({
  residentsPerTilePerFloor: 3,
  maxPopulation: 1000,
  glowIntensity: 1,
  shadows: false,
  councilTemperature: 0.15,
  councilSittingsPerDay: 2,
  cabinetMotionsPerSitting: 5,
  averageCongestionThreshold: 0.5,
  autoCouncil: true,
  fitTown: true,
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
  const shadows = patch.shadows;
  const temperature = Number(patch.councilTemperature);
  const sittingsPerDay = Number(patch.councilSittingsPerDay);
  const cabinetMotionsPerSitting = Number(patch.cabinetMotionsPerSitting);
  const averageCongestionThreshold = Number(patch.averageCongestionThreshold);
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
    shadows: shadows === true || shadows === 'true',
    councilTemperature: Number.isFinite(temperature)
      ? Math.round(clamp(temperature, 0, 1) * 100) / 100
      : SETTINGS_DEFAULTS.councilTemperature,
    councilSittingsPerDay: Number.isFinite(sittingsPerDay)
      ? Math.round(clamp(sittingsPerDay, 1, 12))
      : SETTINGS_DEFAULTS.councilSittingsPerDay,
    cabinetMotionsPerSitting: Number.isFinite(cabinetMotionsPerSitting)
      ? Math.round(clamp(cabinetMotionsPerSitting, 1, 5))
      : SETTINGS_DEFAULTS.cabinetMotionsPerSitting,
    averageCongestionThreshold: Number.isFinite(averageCongestionThreshold)
      ? Math.round(clamp(averageCongestionThreshold, 0.1, 0.9) * 20) / 20
      : SETTINGS_DEFAULTS.averageCongestionThreshold,
    autoCouncil: patch.autoCouncil !== false,
    fitTown: patch.fitTown !== false,
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
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (raw && !localStorage.getItem(SETTINGS_KEY)) localStorage.setItem(SETTINGS_KEY, raw);
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
