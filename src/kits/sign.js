import * as THREE from 'three';
import { glowMaterial, unregisterGlow } from './glow.js';

export function makeSign(text, opts = {}) {
  const width = opts.width ?? 2.4;
  const height = opts.height ?? 0.6;
  const bg = opts.bg ?? '#2f3b47';
  const fg = opts.fg ?? '#ffe9c2';

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 72);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 66);
  ctx.fillStyle = fg;
  ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 38, 240);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const mat = glowMaterial({
    material: new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.6,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0
    }),
    intensity: 0.85
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.userData.isSign = true;
  // Every sign is a NEW material with a NEW CanvasTexture, so the glow registry
  // grew by one per sign per regeneration and never shrank (+23/regen measured,
  // 253 orphans by the twelfth). `unregisterGlow` was imported here and never
  // called. Now the sign owns its own release: whoever disposes the sign's
  // geometry disposes this too, and the registry stops holding it.
  mesh.userData.disposeSelf = () => {
    unregisterGlow(mat);
    mat.map?.dispose?.();
    mat.dispose();
    mesh.geometry?.dispose?.();
  };
  return mesh;
}
