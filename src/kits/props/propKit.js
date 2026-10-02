import * as THREE from 'three';
import { PALETTE } from '../../core/config.js';
import { box, cyl, sphere, cone, merge, jitterColor } from '../geometry.js';
import { sharedLampGlow } from '../glow.js';

function single(geos, opts = {}) {
  const geo = merge(geos);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0.02
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTree(rng, scale = 1) {
  const geos = [];
  const h = rng.float(1.6, 2.6) * scale;
  const trunkR = 0.14 * scale;
  geos.push(cyl(trunkR * 0.8, trunkR * 1.2, h, PALETTE.trunk, 0, h / 2, 0, 7));
  const leaf = jitterColor(rng.pick(PALETTE.foliage), rng, 0.06);
  const blobs = rng.int(2, 3);
  for (let i = 0; i < blobs; i++) {
    const r = rng.float(0.55, 0.95) * scale;
    geos.push(
      sphere(
        r,
        jitterColor(leaf, rng, 0.05),
        rng.float(-0.4, 0.4) * scale,
        h + rng.float(-0.1, 0.55) * scale,
        rng.float(-0.4, 0.4) * scale,
        6,
        4
      )
    );
  }
  if (rng.chance(0.22)) {
    geos.push(cone(0.85 * scale, 1.3 * scale, jitterColor(leaf, rng, 0.08), 0, h + 0.5 * scale, 0, 7));
  }
  return single(geos);
}

export function buildPine(rng, scale = 1) {
  const geos = [];
  const h = rng.float(2.6, 4.2) * scale;
  geos.push(cyl(0.1 * scale, 0.16 * scale, h * 0.45, PALETTE.trunk, 0, h * 0.22, 0, 7));
  const leaf = jitterColor(rng.pick(PALETTE.foliage), rng, 0.05);
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = (1.05 - t * 0.62) * scale;
    const y = h * 0.32 + t * h * 0.6;
    geos.push(cone(r, h * 0.4, jitterColor(leaf, rng, 0.05), 0, y, 0, 6));
  }
  return single(geos);
}

export function buildBush(rng, scale = 1) {
  const geos = [];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    geos.push(
      sphere(
        rng.float(0.28, 0.45) * scale,
        jitterColor(rng.pick(PALETTE.foliage), rng, 0.07),
        rng.float(-0.3, 0.3) * scale,
        rng.float(0.2, 0.35) * scale,
        rng.float(-0.3, 0.3) * scale,
        7,
        5
      )
    );
  }
  return single(geos);
}

export function buildLamp() {
  const geos = [];
  geos.push(box(0.36, 0.1, 0.36, 0x4a4f57, 0, 0.05, 0));
  geos.push(cyl(0.07, 0.1, 2.9, 0x3a3f47, 0, 1.5, 0, 8));
  geos.push(box(0.7, 0.1, 0.16, 0x3a3f47, 0.28, 2.95, 0));
  const pole = single(geos, { metalness: 0.35, roughness: 0.5 });

  const glowGeo = merge([
    box(0.44, 0.2, 0.3, 0xfff2cf, 0.56, 2.86, 0),
    box(0.5, 0.06, 0.36, 0xffe0a0, 0.56, 2.76, 0)
  ]);
  const head = new THREE.Mesh(glowGeo, sharedLampGlow);
  head.castShadow = false;

  const g = new THREE.Group();
  g.add(pole, head);
  return g;
}

export function buildMailbox() {
  const geos = [
    box(0.1, 0.7, 0.1, 0x5a4634, 0, 0.35, 0),
    box(0.3, 0.22, 0.4, 0x33608f, 0, 0.8, 0),
    box(0.06, 0.16, 0.1, 0xd94f4f, 0.17, 0.9, 0.08)
  ];
  return single(geos);
}

export function buildBench() {
  const geos = [];
  for (const s of [-1, 1]) {
    geos.push(box(0.1, 0.42, 0.5, 0x4a4f57, s * 0.6, 0.21, 0));
  }
  for (let i = 0; i < 3; i++) {
    geos.push(box(1.5, 0.07, 0.14, 0x8a6a45, 0, 0.44, -0.16 + i * 0.16));
  }
  for (let i = 0; i < 3; i++) {
    geos.push(box(1.5, 0.14, 0.06, 0x8a6a45, 0, 0.6 + i * 0.16, -0.26));
  }
  return single(geos);
}

export function buildFence(length = 3.6, height = 0.72) {
  const geos = [];
  const posts = Math.max(2, Math.round(length / 0.7));
  for (let i = 0; i <= posts; i++) {
    const x = -length / 2 + (i / posts) * length;
    geos.push(box(0.09, height, 0.09, 0xf0ece2, x, height / 2, 0));
  }
  for (const y of [height * 0.42, height * 0.82]) {
    geos.push(box(length, 0.08, 0.05, 0xf0ece2, 0, y, 0));
  }
  return single(geos);
}

export function buildHydrant() {
  return single([
    cyl(0.13, 0.16, 0.5, 0xc0392b, 0, 0.25, 0, 8),
    sphere(0.14, 0xc0392b, 0, 0.52, 0, 8, 6),
    box(0.44, 0.1, 0.1, 0xa93226, 0, 0.36, 0),
    cyl(0.06, 0.06, 0.1, 0x8e2a20, 0, 0.6, 0, 6)
  ]);
}

export function buildTrashBin() {
  return single([
    cyl(0.24, 0.2, 0.62, 0x3f5a3a, 0, 0.31, 0, 10),
    cyl(0.27, 0.27, 0.07, 0x2f4630, 0, 0.65, 0, 10)
  ]);
}

export function buildFountain(rng) {
  const geos = [];
  geos.push(cyl(1.5, 1.6, 0.4, 0xb9b3a8, 0, 0.2, 0, 16));
  geos.push(cyl(1.3, 1.3, 0.32, PALETTE.water, 0, 0.42, 0, 16));
  geos.push(cyl(0.3, 0.4, 0.8, 0xb9b3a8, 0, 0.7, 0, 10));
  geos.push(cyl(0.7, 0.15, 0.16, 0xb9b3a8, 0, 1.15, 0, 12));
  geos.push(sphere(0.2, 0xd7d2c6, 0, 1.3, 0, 10, 8));
  const m = single(geos);
  m.userData.water = true;
  void rng;
  return m;
}

export function buildSwingSet() {
  const geos = [];
  for (const s of [-1, 1]) {
    geos.push(cyl(0.06, 0.08, 1.9, 0xd9822b, s * 0.9, 0.95, 0, 6));
  }
  geos.push(box(2.0, 0.1, 0.1, 0xd9822b, 0, 1.9, 0));
  for (const s of [-1, 1]) {
    geos.push(box(0.05, 1.4, 0.05, 0x8a6a45, s * 0.4, 1.2, 0));
    geos.push(box(0.42, 0.07, 0.2, 0x4a4f57, s * 0.4, 0.52, 0));
  }
  return single(geos);
}

export function buildPlayStructure() {
  const geos = [];
  geos.push(box(1.6, 0.12, 1.6, 0x8a6a45, 0, 0.5, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    geos.push(box(0.1, 1.0, 0.1, 0x6b5540, sx * 0.7, 0.5, sz * 0.7));
  }
  geos.push(boxEulerLocal(1.7, 0.1, 1.7, 0xc0392b, 0, 1.35, 0));
  geos.push(box(0.14, 1.2, 1.4, 0xd9822b, -0.8, 0.6, 0));
  return single(geos);
}

function boxEulerLocal(w, h, d, color, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.rotateZ(0.45);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function buildShrubRow(length, rng) {
  const geos = [];
  const n = Math.max(2, Math.round(length / 0.55));
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    geos.push(
      sphere(
        rng.float(0.2, 0.3),
        jitterColor(rng.pick(PALETTE.foliage), rng, 0.06),
        x,
        rng.float(0.2, 0.3),
        0,
        7,
        5
      )
    );
  }
  return single(geos);
}

/** Small shared public-realm blocks used by gardens, plazas, and mobility bays. */
export function buildPlanter() {
  return single([
    box(0.92, 0.3, 0.92, 0xb7aa91, 0, 0.15, 0),
    box(0.7, 0.08, 0.7, 0x6f5136, 0, 0.34, 0),
    sphere(0.34, 0x5e874f, -0.16, 0.6, 0.04, 7, 5),
    sphere(0.3, 0x739c5d, 0.18, 0.58, -0.04, 7, 5)
  ]);
}

export function buildPicnicTable() {
  const geos = [
    box(1.6, 0.1, 0.62, 0x8a6a45, 0, 0.85, 0),
    box(1.9, 0.1, 0.14, 0x8a6a45, 0, 0.42, -0.58),
    box(1.9, 0.1, 0.14, 0x8a6a45, 0, 0.42, 0.58)
  ];
  for (const x of [-0.62, 0.62]) {
    geos.push(box(0.08, 0.85, 0.08, 0x5c4736, x, 0.42, -0.24));
    geos.push(box(0.08, 0.85, 0.08, 0x5c4736, x, 0.42, 0.24));
  }
  return single(geos);
}

export function buildBikeRack() {
  const geos = [box(1.6, 0.06, 0.08, 0x4a4f57, 0, 0.03, 0)];
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    geos.push(box(0.06, 0.62, 0.36, 0x59636d, x, 0.31, 0));
  }
  return single(geos, { metalness: 0.35, roughness: 0.55 });
}
