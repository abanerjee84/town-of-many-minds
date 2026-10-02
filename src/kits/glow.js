import * as THREE from 'three';

/**
 * Every material whose emissive/opacity tracks the night factor.
 *
 * This registry is a STRONG reference to materials the rest of the system no
 * longer owns, and it only ever grew: `clearGlows()` was exported and called
 * from nowhere, and `sign.js` imported `unregisterGlow` without ever calling it.
 * Every `makeSign` therefore registered a brand-new material permanently.
 * Measured: exactly +23 entries per regeneration, monotonic, never shrinking —
 * 253 orphans by the twelfth, each still holding a 256x72 `CanvasTexture`, so
 * this is real heap growth and not merely a stale pointer.
 *
 * `setGlowLevel` then walked all of them EVERY FRAME, writing `emissiveIntensity`
 * onto hundreds of dead materials for no visual benefit, so the per-frame cost
 * grew with session length too.
 *
 * `makeSign` now unregisters what it registered (see `sign.js`), and
 * `pruneGlows` gives the registry a way to drop anything whose owner has gone.
 */
const mats = new Set();
const persistent = new Set();

export function registerGlow(material, { persistent: keep = false } = {}) {
  if (material && !mats.has(material)) mats.add(material);
  if (material && keep) persistent.add(material);
  return material;
}

export function unregisterGlow(material) {
  mats.delete(material);
}

export function clearGlows() {
  for (const m of [...mats]) if (!persistent.has(m)) mats.delete(m);
}

/** How many materials the registry is holding. Diagnostics only. */
export function glowCount() {
  return mats.size;
}

/**
 * Drop registered materials that are no longer in the scene graph. Shared
 * singletons (`sharedWindowGlow` and friends) are never in the graph by
 * themselves but are referenced by meshes in it, so they are kept explicitly —
 * a material is only pruned when nothing reachable from any root still uses it.
 *
 * Called on town teardown rather than per frame: this walks the graph, and the
 * per-frame `setGlowLevel` must stay cheap.
 */
export function pruneGlows(root) {
  if (!root) return 0;
  const live = new Set();
  root.traverse((node) => {
    const list = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const m of list) if (m) live.add(m);
  });
  let dropped = 0;
  for (const m of [...mats]) {
    // Shared materials are created once at module load, before the first
    // town has meshes. Keeping them here prevents the initial regeneration
    // from pruning the material that newly built lamp/window meshes reuse.
    if (live.has(m) || persistent.has(m)) continue;
    mats.delete(m);
    dropped++;
  }
  return dropped;
}

export function setGlowLevel(night) {
  for (const m of mats) {
    m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * night;
    // Additive overlays (headlight beams) fade with the same night curve.
    if (m.userData.baseOpacity != null) m.opacity = m.userData.baseOpacity * night;
  }
}

export function glowMaterial(params = {}) {
  const m = params.material;
  m.userData.baseEmissive = params.intensity ?? 1;
  m.emissiveIntensity = 0;
  registerGlow(m);
  return m;
}

/** A non-emissive overlay driven by the night factor through its opacity. */
export function fadeMaterial(params = {}) {
  const m = params.material;
  m.userData.baseOpacity = params.opacity ?? 1;
  m.opacity = 0;
  registerGlow(m);
  return m;
}

function make(hex, intensity, opts = {}) {
  const material = glowMaterial({
    material: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0.02,
      color: opts.color ?? 0xffffff,
      emissive: new THREE.Color(hex)
    }),
    intensity
  });
  persistent.add(material);
  return material;
}

export const sharedWindowGlow = make(0xffc873, 1.15, { roughness: 0.3, metalness: 0.1 });
export const sharedLampGlow = make(0xffd9a0, 2.6, { roughness: 0.4 });
export const sharedVehicleGlow = make(0xfff0c8, 1.9, { roughness: 0.2, metalness: 0.1 });
export const sharedSignalRed = make(0xff4433, 1.7, { roughness: 0.35 });
export const sharedSignalAmber = make(0xffb020, 1.7, { roughness: 0.35 });
export const sharedSignalGreen = make(0x35d97a, 1.7, { roughness: 0.35 });
export const sharedBeaconGlow = make(0x63b3ff, 2.2, { roughness: 0.3 });
// Headlight lenses sit brighter than the cabin glow so they read as the light source.
export const sharedHeadlightGlow = make(0xfff4d6, 3.4, { roughness: 0.15, metalness: 0 });
export const sharedHeadlightBeam = fadeMaterial({
  material: new THREE.MeshBasicMaterial({
    color: 0xffe6b4,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  }),
  opacity: 0.6
});
