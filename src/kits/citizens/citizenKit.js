import * as THREE from 'three';
import { PALETTE } from '../../core/config.js';
import { box, cyl, sphere, merge } from '../geometry.js';

export const CITIZEN_SCALE = 0.82;

/**
 * Whole-body scale by life stage. The rig geometry is adult-shaped, so the
 * group is scaled down for the young and grows back to 1.0 by age 18 —
 * without this a newborn is rendered full-size and reads as just another
 * adult on the street. Piecewise, continuous at each boundary.
 */
export function ageScale(age) {
  const a = age ?? 18;
  if (a >= 18) return 1;
  if (a >= 13) return 0.8 + ((a - 13) / 5) * 0.2;
  if (a >= 2) return 0.6 + ((a - 2) / 11) * 0.2;
  return 0.5 + (Math.max(0, a) / 2) * 0.1;
}

let bubbleTexture = null;

function getBubbleTexture() {
  if (bubbleTexture) return bubbleTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(6, 6, 116, 66, 18);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(44, 70);
  ctx.lineTo(60, 92);
  ctx.lineTo(74, 70);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5b6570';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(36 + i * 28, 40, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  bubbleTexture = new THREE.CanvasTexture(c);
  bubbleTexture.colorSpace = THREE.SRGBColorSpace;
  return bubbleTexture;
}

export function buildCitizen(personality) {
  const a = personality.avatar;
  const s = CITIZEN_SCALE * a.scale * (a.build === 'slim' ? 0.95 : a.build === 'sturdy' ? 1.06 : 1);
  const skin = PALETTE.skin[a.skin];
  const shirt = PALETTE.shirt[a.shirt];
  const pants = PALETTE.shirt[(a.pants + 7) % PALETTE.shirt.length];
  const hair = PALETTE.hair[a.hair];
  const hipY = 0.78 * s;
  const shoulderY = 1.3 * s;
  const bodyW = (a.build === 'sturdy' ? 0.54 : a.build === 'slim' ? 0.42 : 0.48) * s;

  const torso = [];
  const limbA = [];
  const limbB = [];

  torso.push(box(bodyW, 0.6 * s, 0.28 * s, shirt, 0, hipY + 0.3 * s, 0));
  torso.push(box(bodyW + 0.02 * s, 0.14 * s, 0.3 * s, pants, 0, hipY + 0.03 * s, 0));
  torso.push(box(0.14 * s, 0.1 * s, 0.14 * s, skin, 0, hipY + 0.62 * s, 0));

  const headY = hipY + 0.62 * s + 0.2 * s;
  torso.push(sphere(0.195 * s, skin, 0, headY, 0, 10, 8));
  torso.push(box(0.06 * s, 0.07 * s, 0.06 * s, skin, 0, headY - 0.02 * s, 0.19 * s));

  if (a.hairStyle === 'bald') {
    // no hair
  } else if (a.hairStyle === 'cap') {
    torso.push(cyl(0.205 * s, 0.205 * s, 0.16 * s, shirt, 0, headY + 0.13 * s, 0, 10));
    torso.push(box(0.3 * s, 0.05 * s, 0.24 * s, shirt, 0, headY + 0.07 * s, 0.2 * s));
  } else if (a.hairStyle === 'long') {
    torso.push(sphere(0.205 * s, hair, 0, headY + 0.04 * s, -0.02 * s, 10, 8));
    torso.push(box(0.34 * s, 0.4 * s, 0.14 * s, hair, 0, headY - 0.16 * s, -0.14 * s));
  } else if (a.hairStyle === 'bun') {
    torso.push(sphere(0.205 * s, hair, 0, headY + 0.05 * s, -0.01 * s, 10, 8));
    torso.push(sphere(0.11 * s, hair, 0, headY + 0.2 * s, -0.14 * s, 8, 6));
  } else {
    torso.push(sphere(0.205 * s, hair, 0, headY + 0.05 * s, -0.01 * s, 10, 8));
    torso.push(box(0.36 * s, 0.12 * s, 0.34 * s, hair, 0, headY + 0.1 * s, -0.04 * s));
  }

  for (const sx of [-1, 1]) {
    torso.push(sphere(0.035 * s, 0x2b2f36, sx * 0.075 * s, headY + 0.02 * s, 0.18 * s, 6, 5));
  }

  if (a.facialHair && a.hairStyle !== 'bald') {
    torso.push(box(0.2 * s, 0.1 * s, 0.1 * s, hair, 0, headY - 0.13 * s, 0.13 * s));
  }

  if (a.accessory === 'glasses') {
    for (const sx of [-1, 1]) {
      torso.push(box(0.11 * s, 0.08 * s, 0.03 * s, 0x2b2f36, sx * 0.075 * s, headY + 0.02 * s, 0.2 * s));
    }
    torso.push(box(0.06 * s, 0.02 * s, 0.02 * s, 0x2b2f36, 0, headY + 0.02 * s, 0.2 * s));
  }

  if (a.accessory === 'backpack') {
    torso.push(box(0.34 * s, 0.4 * s, 0.18 * s, PALETTE.shirt[(a.shirt + 4) % 12], 0, hipY + 0.34 * s, -0.24 * s));
    torso.push(box(0.3 * s, 0.1 * s, 0.05 * s, 0x2b2f36, 0, hipY + 0.16 * s, -0.33 * s));
  }

  if (a.accessory === 'bag') {
    torso.push(box(0.24 * s, 0.26 * s, 0.12 * s, 0x8a6a45, 0.3 * s, hipY - 0.02 * s, 0.02 * s));
    torso.push(box(0.05 * s, 0.3 * s, 0.05 * s, 0x8a6a45, 0.3 * s, hipY + 0.2 * s, 0.02 * s));
  }

  if (a.accessory === 'umbrella') {
    torso.push(cyl(0.025 * s, 0.025 * s, 0.75 * s, 0x3a3f47, -0.3 * s, hipY + 0.2 * s, 0.04 * s, 6));
    torso.push(cyl(0.09 * s, 0.01 * s, 0.3 * s, PALETTE.shirt[(a.shirt + 2) % 12], -0.3 * s, hipY + 0.72 * s, 0.04 * s, 8));
  }

  const legMesh = (sx) => {
    const g = [];
    g.push(box(0.17 * s, 0.78 * s, 0.2 * s, pants, sx * 0.11 * s, -0.39 * s, 0));
    g.push(box(0.19 * s, 0.11 * s, 0.28 * s, 0x2f333a, sx * 0.11 * s, -0.74 * s, 0.05 * s));
    return g;
  };
  const armMesh = (sx) => {
    const g = [];
    g.push(box(0.13 * s, 0.55 * s, 0.15 * s, shirt, sx * 0.02 * s, -0.27 * s, 0));
    g.push(sphere(0.075 * s, skin, sx * 0.02 * s, -0.57 * s, 0, 7, 6));
    return g;
  };

  limbA.push(...legMesh(1), ...armMesh(-1));
  limbB.push(...legMesh(-1), ...armMesh(1));

  const pivotA = new THREE.Group();
  pivotA.position.y = hipY;
  const pivotB = new THREE.Group();
  pivotB.position.y = hipY;

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });

  const bodyMesh = new THREE.Mesh(merge(torso), mat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;

  const meshA = new THREE.Mesh(merge(limbA), mat);
  meshA.castShadow = true;
  const meshB = new THREE.Mesh(merge(limbB), mat);
  meshB.castShadow = true;
  pivotA.add(meshA);
  pivotB.add(meshB);

  const group = new THREE.Group();
  group.add(bodyMesh, pivotA, pivotB);
  group.scale.setScalar(ageScale(personality.age));

  const bubble = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.45),
    new THREE.MeshBasicMaterial({ map: getBubbleTexture(), transparent: true, depthTest: false })
  );
  bubble.position.set(0, headY + 0.55 * s, 0);
  bubble.renderOrder = 10;
  bubble.visible = false;
  group.add(bubble);

  group.userData.pick = { type: 'citizen', title: personality.name };
  group.userData.bubble = bubble;

  return {
    group,
    pivots: [pivotA, pivotB],
    bubble,
    height: 1.85 * s,
    headY
  };
}

export function animateWalk(rig, phase, speedFactor, moving, baseY = 0) {
  const swing = Math.sin(phase) * 0.62 * Math.min(1.15, speedFactor);
  rig.pivots[0].rotation.x = swing;
  rig.pivots[1].rotation.x = -swing;
  if (moving) {
    rig.group.position.y = baseY + Math.abs(Math.sin(phase)) * 0.045;
    rig.group.rotation.x = 0.05 * speedFactor;
  } else {
    rig.group.position.y = baseY + Math.sin(phase * 0.35) * 0.012;
    rig.group.rotation.x = 0;
  }
}
