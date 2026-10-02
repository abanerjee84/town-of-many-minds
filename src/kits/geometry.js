import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function withColor(geo, color) {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return geo;
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return withColor(geo, color);
}

export function boxEuler(w, h, d, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(pos[0], pos[1], pos[2]);
  return withColor(geo, color);
}

export function cyl(radiusTop, radiusBottom, height, color, x = 0, y = 0, z = 0, segments = 10) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  geo.translate(x, y, z);
  return withColor(geo, color);
}

export function sphere(radius, color, x = 0, y = 0, z = 0, wSeg = 10, hSeg = 8) {
  const geo = new THREE.SphereGeometry(radius, wSeg, hSeg);
  geo.translate(x, y, z);
  return withColor(geo, color);
}

export function cone(radius, height, color, x = 0, y = 0, z = 0, segments = 10) {
  const geo = new THREE.ConeGeometry(radius, height, segments);
  geo.translate(x, y, z);
  return withColor(geo, color);
}

/**
 * Merge a list of geometries into one.
 *
 * `mergeGeometries` copies vertex data, so the inputs are dead the moment this
 * returns and every caller must be able to release them. Two things were not:
 *
 *   - `toNonIndexed()` allocates a SECOND geometry for every indexed input, and
 *     that copy was never disposed — so a merge of indexed geometries leaked one
 *     full copy of each. The temporaries are released here, and the caller's
 *     originals are left alone (they still own them).
 *   - the inputs themselves. Callers that build a batch of thousands and merge
 *     it were left holding every intermediate. `Batch.addTo` now releases them
 *     itself, since only it knows which list it owns.
 */
export function merge(geos) {
  const inputs = geos.filter(Boolean);
  if (inputs.length === 0) return null;
  // `toNonIndexed()` makes a copy, so it is ours to release. `g.index` is falsy
  // for an already non-indexed geometry, in which case the original is used
  // directly and must NOT be disposed here.
  const temporaries = [];
  const valid = inputs.map((g) => {
    if (!g.index) return g;
    const copy = g.toNonIndexed();
    temporaries.push(copy);
    return copy;
  });
  let geo = null;
  try {
    geo = mergeGeometries(valid, false);
  } finally {
    for (const t of temporaries) t.dispose();
  }
  if (!geo) {
    console.warn('mergeGeometries failed', valid.length);
  }
  return geo;
}

export function buildMesh(geos, opts = {}) {
  const geo = merge(geos);
  if (!geo) return null;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0.02,
    flatShading: opts.flatShading ?? false,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 0
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  return mesh;
}

export function jitterColor(hex, rng, amount = 0.05) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + rng.float(-amount, amount) * 0.35 + 1) % 1,
    Math.min(1, Math.max(0, hsl.s + rng.float(-amount, amount))),
    Math.min(0.95, Math.max(0.05, hsl.l + rng.float(-amount, amount)))
  );
  return c.getHex();
}
