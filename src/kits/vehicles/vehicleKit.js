import * as THREE from 'three';
import { PALETTE } from '../../core/config.js';
import { box, boxEuler, cyl, sphere, merge, jitterColor } from '../geometry.js';
import { sharedVehicleGlow, sharedHeadlightGlow, sharedHeadlightBeam } from '../glow.js';

const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12);
wheelGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.26, 8);
hubGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.4, metalness: 0.6 });

// Opposing lane centres are 1.6 m apart. At 0.8 the largest emergency bodies
// occupied almost the full centre-to-centre gap, leaving no visual or
// collision buffer while passing. Keep meshes and exported footprints on this
// one scale so every vehicle fits its lane with a small clearance.
export const VEHICLE_SCALE = 0.68;

export const VEHICLE_TYPES = [
  { id: 'sedan', weight: 26, length: 3.3, width: 1.6, height: 1.35, speed: 1.0 },
  { id: 'hatchback', weight: 16, scale: 0.84, length: 2.9, width: 1.5, height: 1.3, speed: 0.96 },
  { id: 'taxi', weight: 9, length: 3.3, width: 1.6, height: 1.35, speed: 1.05 },
  { id: 'van', weight: 12, length: 3.6, width: 1.75, height: 1.95, speed: 0.9 },
  { id: 'pickup', weight: 9, scale: 0.95, length: 3.6, width: 1.72, height: 1.6, speed: 0.94 },
  { id: 'sport', weight: 6, scale: 0.9, length: 3.4, width: 1.62, height: 1.15, speed: 1.35 },
  { id: 'truck', weight: 5, length: 4.4, width: 1.85, height: 2.3, speed: 0.78 },
  { id: 'bus', weight: 3, role: 'transit', unit: 'Bus', length: 5.4, width: 1.95, height: 2.5, speed: 0.72 },
  { id: 'police', weight: 0, role: 'emergency', unit: 'Police', length: 3.5, width: 1.7, height: 1.4, speed: 1.18 },
  { id: 'ambulance', weight: 0, role: 'emergency', unit: 'Ambulance', length: 4.3, width: 1.9, height: 2.05, speed: 1.1 },
  { id: 'fire', weight: 0, role: 'emergency', unit: 'Fire', length: 4.9, width: 2.0, height: 2.3, speed: 1.02 },
  { id: 'utility', weight: 0, role: 'service', unit: 'Utility', length: 3.7, width: 1.8, height: 1.95, speed: 0.92 },
  { id: 'refuse', weight: 0, role: 'service', unit: 'Refuse', length: 4.6, width: 1.9, height: 2.3, speed: 0.8 }
];

export const CIVILIAN_VEHICLE_TYPES = VEHICLE_TYPES.filter((v) => v.role == null);

export const SERVICE_VEHICLE_TYPES = VEHICLE_TYPES.filter((v) => v.role != null);

export const EMERGENCY_VEHICLE_TYPES = VEHICLE_TYPES.filter((v) => v.role === 'emergency');

/**
 * Footprint a rig of `type` actually occupies on the ground: the raw
 * dimensions scaled the same way `buildVehicle` scales them. Callers that
 * need to know whether a parking pad will accept a vehicle before building it
 * (parking eligibility) must use this, not `VEHICLE_TYPES` directly.
 */
export function vehicleFootprint(type = 'sedan', params = {}) {
  const spec = VEHICLE_TYPES.find((v) => v.id === type) || VEHICLE_TYPES[0];
  const scale = VEHICLE_SCALE * (spec.scale ?? 1);
  return {
    ...spec,
    length: (params.length ?? spec.length) * scale,
    width: (params.width ?? spec.width) * scale
  };
}

const FLEET_LIVERY = {
  police: 0xf3f5f7,
  ambulance: 0xf7f6f2,
  fire: 0xc0392b,
  utility: 0xe8b23a,
  refuse: 0x4f7a3f,
  bus: 0x2f8f7a
};

function paintList(geos, color, offset) {
  return geos.map((g) => {
    if (offset) g.translate(offset[0], offset[1], offset[2]);
    return g;
  });
}

/**
 * A tapered ground light pool starting at the bumper (z = 0, running +z).
 * The vertex alpha fades with distance and toward the edges, so the shared
 * additive material lights the asphalt without a texture.
 */
function beamGeo(x, nearW, farW, len) {
  const cols = 4;
  const rows = 6;
  const pos = [];
  const col = [];
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const w = (nearW + (farW - nearW) * t) * 0.5;
    const along = Math.pow(1 - t, 1.7);
    for (let c = 0; c <= cols; c++) {
      const s = c / cols;
      pos.push(x + (s - 0.5) * 2 * w, 0, t * len);
      col.push(1, 1, 1, along * Math.cos((s - 0.5) * Math.PI));
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * (cols + 1) + c;
      idx.push(i, i + 1, i + cols + 1, i + 1, i + cols + 2, i + cols + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  return geo;
}

export function buildVehicle(params = {}) {
  const rng = params.rng;
  const type = params.type || 'sedan';
  const spec = VEHICLE_TYPES.find((v) => v.id === type) || VEHICLE_TYPES[0];
  const color =
    params.color ??
    (FLEET_LIVERY[type] ?? jitterColor(rng ? rng.pick(PALETTE.vehicle) : PALETTE.vehicle[0], rng, 0.05));
  const L = params.length ?? spec.length;
  const W = params.width ?? spec.width;
  const H = spec.height;

  const body = [];
  const glow = [];
  const lamps = [];
  const wheelPos = [];
  const isVan = type === 'van' || type === 'bus' || type === 'truck' || type === 'utility';
  let beacon = null;

  const wheelZ = L / 2 - (type === 'bus' || type === 'truck' || type === 'refuse' ? 0.85 : 0.62);
  const wheelY = 0.32;
  const wheelX = W / 2 - 0.06;
  wheelPos.push([-wheelX, wheelY, wheelZ], [wheelX, wheelY, wheelZ]);
  wheelPos.push([-wheelX, wheelY, -wheelZ], [wheelX, wheelY, -wheelZ]);

  const chassisY = wheelY + 0.18;

  if (type === 'bus') {
    body.push(box(W, H - 0.5, L, color, 0, chassisY + (H - 0.5) / 2, 0));
    body.push(box(W + 0.04, 0.12, L - 0.4, 0x2b2f36, 0, chassisY + 0.3, 0));
    glow.push(box(W + 0.06, 0.62, L - 1.4, 0x9fc7e8, 0, chassisY + H - 0.95, 0));
    glow.push(box(W - 0.5, 0.7, 0.1, 0xbfe0f5, 0, chassisY + H - 1.0, L / 2 + 0.02));
    for (let i = 0; i < 5; i++) {
      body.push(box(0.08, 0.7, 0.1, 0x2b2f36, W / 2 + 0.02, chassisY + H - 0.95, -L / 2 + 1 + i * 1.0));
      body.push(box(0.08, 0.7, 0.1, 0x2b2f36, -W / 2 - 0.02, chassisY + H - 0.95, -L / 2 + 1 + i * 1.0));
    }
  } else if (type === 'truck') {
    body.push(box(W, 1.1, L * 0.34, color, 0, chassisY + 0.75, L * 0.3));
    glow.push(box(W - 0.25, 0.5, 0.1, 0x9fc7e8, 0, chassisY + 1.15, L * 0.47));
    body.push(box(W, 1.55, L * 0.6, 0xe8e4dc, 0, chassisY + 1.05, -L * 0.18));
    body.push(box(W + 0.06, 0.1, L * 0.6 + 0.06, 0xc9c4bb, 0, chassisY + 1.85, -L * 0.18));
    body.push(box(W + 0.1, 0.2, 0.2, 0x8a8f97, 0, chassisY + 0.3, L / 2 - 0.05));
  } else if (isVan) {
    body.push(box(W, H - 0.55, L, color, 0, chassisY + (H - 0.55) / 2, 0));
    body.push(box(W + 0.03, 0.1, L * 0.9, 0x2b2f36, 0, chassisY + 0.25, 0));
    glow.push(box(W + 0.05, 0.55, 0.1, 0x9fc7e8, 0, chassisY + H - 0.75, L / 2 + 0.02));
    glow.push(box(W + 0.06, 0.5, L * 0.34, 0x9fc7e8, 0, chassisY + H - 0.72, L * 0.16));
    glow.push(box(W + 0.06, 0.5, 0.1, 0x9fc7e8, 0, chassisY + H - 0.72, -L / 2 - 0.02));
    if (type !== 'utility') {
      body.push(box(W * 0.95, 0.14, L * 0.6, 0x2b2f36, 0, chassisY + H - 0.2, -L * 0.12));
    }
  } else if (type === 'police') {
    body.push(box(W, 0.55, L, color, 0, chassisY + 0.3, 0));
    body.push(box(W - 0.06, 0.16, L - 0.3, color, 0, chassisY + 0.62, 0));
    body.push(box(W + 0.04, 0.2, L * 0.56, 0x2b4fa8, 0, chassisY + 0.42, -L * 0.05));
    body.push(box(W - 0.14, 0.5, L * 0.5, color, 0, chassisY + 0.8, -L * 0.06));
    glow.push(box(W - 0.1, 0.34, L * 0.5 - 0.28, 0x9fc7e8, 0, chassisY + 0.87, -L * 0.06));
    glow.push(box(W - 0.2, 0.4, 0.1, 0xaed4f0, 0, chassisY + 0.7, L * 0.19));
    body.push(box(W - 0.02, 0.1, L * 0.5 - 0.1, color, 0, chassisY + 1.09, -L * 0.06));
    body.push(box(W * 0.7, 0.1, 0.36, 0x2b2f36, 0, chassisY + 1.16, -L * 0.06));
    body.push(box(W + 0.04, 0.14, 0.14, 0x8a8f97, 0, chassisY + 0.24, L / 2 - 0.04));
    beacon = { x: 0, y: chassisY + 1.26, z: -L * 0.06, spread: 0.3, w: 0.3, h: 0.15, d: 0.32 };
  } else if (type === 'ambulance') {
    const boxL = L * 0.7;
    const boxZ = -L * 0.12;
    body.push(box(W, H - 0.6, boxL, color, 0, chassisY + (H - 0.6) / 2 + 0.12, boxZ));
    body.push(box(W + 0.05, 0.2, boxL, 0xc0392b, 0, chassisY + 0.52, boxZ));
    body.push(box(W - 0.08, 0.5, L * 0.32, color, 0, chassisY + 0.38, L * 0.3));
    body.push(box(W + 0.03, 0.16, L * 0.3, color, 0, chassisY + 0.66, L * 0.3));
    glow.push(box(W - 0.2, 0.44, 0.1, 0xbfe0f5, 0, chassisY + 1.0, L * 0.155));
    glow.push(box(0.07, 0.3, 0.7, 0x9fc7e8, W / 2 + 0.04, chassisY + H - 0.62, -L * 0.02));
    glow.push(box(0.07, 0.3, 0.7, 0x9fc7e8, -W / 2 - 0.04, chassisY + H - 0.62, -L * 0.02));
    for (const s of [-1, 1]) {
      body.push(box(0.07, 0.42, 0.14, 0xc0392b, (s * (W / 2 + 0.05)), chassisY + 1.28, -L * 0.3));
      body.push(box(0.07, 0.14, 0.42, 0xc0392b, (s * (W / 2 + 0.05)), chassisY + 1.28, -L * 0.3));
    }
    body.push(box(W + 0.04, 0.1, boxL, 0x2b2f36, 0, chassisY + H - 0.02, boxZ));
    beacon = { x: 0, y: chassisY + H + 0.1, z: boxZ + 0.2, spread: 0.34, w: 0.34, h: 0.17, d: 0.42 };
  } else if (type === 'fire') {
    body.push(box(W, 1.15, L * 0.3, color, 0, chassisY + 0.8, L * 0.33));
    glow.push(box(W - 0.3, 0.5, 0.1, 0xbfe0f5, 0, chassisY + 1.14, L * 0.47));
    glow.push(box(0.07, 0.36, 0.5, 0x9fc7e8, W / 2 + 0.04, chassisY + 1.0, L * 0.33));
    glow.push(box(0.07, 0.36, 0.5, 0x9fc7e8, -W / 2 - 0.04, chassisY + 1.0, L * 0.33));
    body.push(box(W + 0.04, 1.2, L * 0.58, color, 0, chassisY + 1.0, -L * 0.16));
    body.push(box(W + 0.09, 0.14, L * 0.58, 0xe8b23a, 0, chassisY + 0.52, -L * 0.16));
    body.push(box(W + 0.06, 0.14, L * 0.58, 0xe8e4dc, 0, chassisY + 1.5, -L * 0.16));
    body.push(box(0.5, 0.09, L * 0.5, 0xc9c4bb, -0.22, chassisY + 1.74, -L * 0.16));
    body.push(box(0.5, 0.09, L * 0.5, 0xc9c4bb, 0.22, chassisY + 1.74, -L * 0.16));
    for (let i = 0; i < 9; i++) {
      body.push(box(0.48, 0.07, 0.09, 0xa9a49b, 0, chassisY + 1.74, -L * 0.38 + i * 0.28));
    }
    body.push(box(W + 0.08, 0.5, 0.24, 0x2b2f36, 0, chassisY + 1.1, -L / 2 - 0.08));
    beacon = { x: 0, y: chassisY + 1.5, z: L * 0.33, spread: 0.4, w: 0.36, h: 0.18, d: 0.36 };
  } else if (type === 'refuse') {
    body.push(box(W, 1.1, L * 0.3, color, 0, chassisY + 0.75, L * 0.33));
    glow.push(box(W - 0.3, 0.46, 0.1, 0xbfe0f5, 0, chassisY + 1.1, L * 0.47));
    glow.push(box(0.07, 0.34, 0.5, 0x9fc7e8, W / 2 + 0.04, chassisY + 0.98, L * 0.33));
    glow.push(box(0.07, 0.34, 0.5, 0x9fc7e8, -W / 2 - 0.04, chassisY + 0.98, L * 0.33));
    body.push(box(W + 0.06, 1.5, L * 0.6, 0x3f6b34, 0, chassisY + 1.05, -L * 0.15));
    body.push(box(W + 0.11, 0.16, L * 0.6, 0x2f5127, 0, chassisY + 1.82, -L * 0.15));
    body.push(box(W + 0.09, 0.16, L * 0.6, 0xe8b23a, 0, chassisY + 0.44, -L * 0.15));
    body.push(box(W + 0.13, 0.55, 0.3, 0x2f5127, 0, chassisY + 1.2, -L / 2 - 0.05));
    beacon = { x: 0, y: chassisY + 1.32, z: L * 0.33, spread: 0.36, w: 0.28, h: 0.16, d: 0.3, amber: true };
  } else {
    const low = type === 'sport';
    const cabH = low ? 0.42 : 0.5;
    const cabL = L * (low ? 0.44 : 0.5);
    body.push(box(W, 0.55, L, color, 0, chassisY + 0.3, 0));
    body.push(box(W - 0.06, 0.16, L - 0.3, color, 0, chassisY + 0.62, 0));
    body.push(box(W - 0.14, cabH, cabL, color, 0, chassisY + 0.55 + cabH / 2, -L * 0.06));
    glow.push(box(W - 0.1, 0.34, cabL - 0.28, 0x9fc7e8, 0, chassisY + 0.55 + cabH * 0.62, -L * 0.06));
    glow.push(box(W - 0.2, 0.4, 0.1, 0xaed4f0, 0, chassisY + 0.62 + cabH * 0.5, cabL / 2 - L * 0.06));
    body.push(box(W - 0.02, 0.1, cabL - 0.1, color, 0, chassisY + 0.55 + cabH + 0.04, -L * 0.06));
    body.push(box(W + 0.04, 0.16, 0.16, 0x8a8f97, 0, chassisY + 0.22, L / 2 - 0.04));
    body.push(box(W + 0.04, 0.16, 0.16, 0x8a8f97, 0, chassisY + 0.22, -L / 2 + 0.04));
    if (low) {
      body.push(boxEuler(W - 0.1, 0.07, 0.5, 0x2b2f36, [0, chassisY + 1.0, -L * 0.42], [0.2, 0, 0]));
    }
  }

  if (type === 'taxi') {
    body.push(box(0.7, 0.2, 0.34, 0xf7d117, 0, chassisY + H + 0.16, -L * 0.02));
    glow.push(box(0.62, 0.14, 0.3, 0xfff3b0, 0, chassisY + H + 0.2, -L * 0.02));
    for (let i = 0; i < 6; i++) {
      body.push(box(0.16, 0.1, 0.1, 0x2b2f36, -W / 2 + 0.1, chassisY + 0.42 + (i % 2) * 0.22, -L * 0.3 + i * 0.24));
    }
  }

  if (type === 'utility') {
    const roofY = chassisY + (H - 0.55);
    body.push(box(W - 0.3, 0.1, L * 0.7, 0x8a8f97, 0, roofY + 0.05, -L * 0.1));
    body.push(box(0.46, 0.14, L * 0.66, 0xc9c4bb, -0.24, roofY + 0.17, -L * 0.1));
    body.push(box(0.46, 0.14, L * 0.66, 0xc9c4bb, 0.24, roofY + 0.17, -L * 0.1));
    for (let i = 0; i < 8; i++) {
      body.push(box(0.52, 0.06, 0.08, 0xa9a49b, 0, roofY + 0.17, -L * 0.38 + i * 0.34));
    }
    body.push(box(W + 0.05, 0.5, 0.14, 0xe8e4dc, W / 2 + 0.02, chassisY + 0.62, -L * 0.12));
    body.push(box(W + 0.05, 0.5, 0.14, 0xe8e4dc, -W / 2 - 0.02, chassisY + 0.62, -L * 0.12));
    beacon = { x: 0, y: roofY + 0.32, z: L * 0.24, spread: 0.3, w: 0.26, h: 0.15, d: 0.3, amber: true };
  }

  // Lenses must sit proud of the front face, otherwise the opaque body box
  // swallows them. Each cab style puts its nose at a different z.
  const frontZ =
    type === 'truck'
      ? L * 0.47
      : type === 'fire' || type === 'refuse'
        ? L * 0.48
        : type === 'ambulance'
          ? L * 0.46
          : L / 2;
  for (const s of [-1, 1]) {
    lamps.push(box(0.34, 0.18, 0.16, 0xfff6d8, s * (W / 2 - 0.3), chassisY + 0.42, frontZ));
    glow.push(box(0.3, 0.16, 0.08, 0xff5a4a, s * (W / 2 - 0.28), chassisY + 0.44, -L / 2 + 0.04));
  }

  const group = new THREE.Group();

  // A seated silhouette is visible through the front glass while occupied.
  const driverCue = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x28313b, roughness: 1 })
  );
  driverCue.position.set(-W * 0.19, chassisY + 0.86, frontZ - 0.06);
  driverCue.visible = false;
  group.add(driverCue);

  const bodyMesh = new THREE.Mesh(
    merge(body),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.32 })
  );
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const glowGeo = merge(glow);
  if (glowGeo) {
    const m = new THREE.Mesh(glowGeo, sharedVehicleGlow);
    m.castShadow = false;
    group.add(m);
  }

  const lampGeo = merge(lamps);
  if (lampGeo) {
    const m = new THREE.Mesh(lampGeo, sharedHeadlightGlow);
    m.castShadow = false;
    group.add(m);
  }

  // Light pools on the asphalt ahead of each lamp. The shared material is
  // opaque-free and additive, so opacity alone switches them on at night.
  const beamOff = W / 2 - 0.28;
  const beams = merge([beamGeo(-beamOff, 0.4, 1.5, 4.6), beamGeo(beamOff, 0.4, 1.5, 4.6)]);
  if (beams) {
    const m = new THREE.Mesh(beams, sharedHeadlightBeam);
    m.castShadow = false;
    m.receiveShadow = false;
    m.position.set(0, 0.03, frontZ);
    m.renderOrder = 1;
    group.add(m);
  }

  let beaconRig = null;
  if (beacon) {
    const mk = (hex, dx) => {
      const m = new THREE.Mesh(
        box(beacon.w, beacon.h, beacon.d, hex, beacon.x + dx, beacon.y, beacon.z),
        new THREE.MeshBasicMaterial({ color: hex, toneMapped: false })
      );
      m.castShadow = false;
      m.renderOrder = 2;
      group.add(m);
      return m;
    };
    beaconRig = beacon.amber
      ? { amber: mk(0xffb020, 0), red: null, blue: null }
      : { amber: null, red: mk(0xff2f3a, -beacon.spread), blue: mk(0x2f6bff, beacon.spread) };
    beaconRig.lit = false;
    setBeaconState(beaconRig, 'off');
  }

  const wheels = [];
  for (const [x, y, z] of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.castShadow = false;
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(w, hub);
    group.add(pivot);
    wheels.push(pivot);
  }

  const pick = {
    type: 'vehicle',
    title: typeLabel(type),
    typeId: type
  };
  group.userData.pick = pick;
  const scale = VEHICLE_SCALE * (spec.scale ?? 1);
  group.scale.setScalar(scale);

  return {
    group,
    wheels,
    driverCue,
    beacon: beaconRig,
    spec: {
      ...vehicleFootprint(type, params),
      wheelRadius: wheelY * scale,
      maxSpeed: (params.speed ?? 9) * spec.speed
    },
    type
  };
}

export function typeLabel(id) {
  const labels = {
    sedan: 'Sedan',
    hatchback: 'Hatchback',
    taxi: 'Taxi',
    van: 'Delivery Van',
    pickup: 'Pickup',
    sport: 'Sports Car',
    truck: 'Box Truck',
    bus: 'City Bus',
    police: 'Police Cruiser',
    ambulance: 'Ambulance',
    fire: 'Fire Engine',
    utility: 'Utility Van',
    refuse: 'Refuse Truck'
  };
  return labels[id] || id;
}

export function setBeaconState(rig, mode) {
  if (!rig) return;
  if (rig.amber) {
    rig.amber.visible = mode === 'blink';
    return;
  }
  if (mode === 'off') {
    rig.red.visible = false;
    rig.blue.visible = false;
    return;
  }
  rig.red.visible = mode !== 'blue';
  rig.blue.visible = mode === 'blue';
}

export function roleLabel(role) {
  return role === 'emergency' ? 'Emergency response' : role === 'service' ? 'Town service' : 'Civilian traffic';
}
