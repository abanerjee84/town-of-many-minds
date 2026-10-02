import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL, PALETTE } from '../core/config.js';

function makeGrassTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = '#5c8f4a';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const colors = ['#548642', '#639a51', '#4d7d3e', '#6ca357', '#587f45'];
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 3.2;
    ctx.globalAlpha = 0.35 + Math.random() * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Left at 1:1 — `buildGround` sets the repeat from the extent it is given,
  // so the grass keeps a constant real-world scale instead of stretching when
  // the ground is enlarged.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class SceneManager {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd3ef);
    this.scene.fog = new THREE.Fog(0x9fd3ef, 260, 900);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.5,
      2200
    );
    // Frame the founding hamlet just right of centre so the playable map reads
    // cleanly between the HUD panels. The modestly tighter pose keeps roads and
    // utilities legible while leaving enough surrounding land for orientation.
    this.camera.position.set(96, 100, 129);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 760;
    // Keep the initial/reset pivot slightly right of centre and toward the far
    // side of the map. The horizontal offset compensates for the left HUD panel
    // without hiding the eastern expansion area behind the inspector.
    // With the old origin pivot, the near apron filled the lower frame while
    // the town sat too high and the far edge was clipped behind the HUD. This
    // pivot gives the same wide, elevated overview as the reference layout:
    // the whole road network remains readable and the town has clear sky and
    // land around it for orientation.
    this.controls.target.set(-20, 0, -40);
    this.camera.lookAt(this.controls.target);
    this.homeCamera = this.camera.position.clone();
    this.homeTarget = this.controls.target.clone();
    this.homeUp = this.camera.up.clone();
    // Orbit feel lives in the pose, not the pivot: polar angle and azimuth are
    // taken from the home view so every focus action orbits exactly like the
    // default view does.
    const homeOffset = this.homeCamera.clone().sub(this.homeTarget);
    this.homePolar = Math.acos(homeOffset.y / homeOffset.length());
    this.homeAzimuth = Math.atan2(homeOffset.x, homeOffset.z);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4c6b3f, 1.1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.1);
    this.sun.position.set(90, 130, 60);
    this.sun.castShadow = true;
    // The shadow frustum is fixed on the world origin (sun.target is never
    // moved), so it has to cover the whole extent from day one. The extent's
    // corner radius is hypot(96, 80) = 125 m, which a +/-165 ortho box covers
    // with room to spare — that box used to be mostly wasted on unbuildable
    // apron, and now every one of its texels lands on land the town can use.
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 420;
    const s = 165;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambient = new THREE.AmbientLight(0x6f86b8, 0.35);
    this.scene.add(this.ambient);

    this.groundMat = new THREE.MeshStandardMaterial({
      map: makeGrassTexture(),
      roughness: 1,
      metalness: 0
    });

    this._night = 0;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  /**
   * The ground is the buildable extent and nothing else.
   *
   * The inner plane is EXACTLY the grid's world size — every tile of it is a
   * tile the player can build on, so the visible land and the playable land are
   * the same rectangle. It used to be the grid plus a 240 m apron, which meant
   * most of what you could see was scenery you could not click.
   *
   * The skirt is a larger, flatter, darker plane sitting just beneath it. It is
   * not playable and does not pretend to be: it reads as the country the town
   * sits in, and the inner plane's edge is the visible boundary of where the
   * town can ever grow.
   */
  buildGround(width, height) {
    this.groundMat.map.repeat.set(width / 9, height / 9);
    const geo = new THREE.PlaneGeometry(width, height, 1, 1);
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    this.ground = ground;

    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 600, height + 600),
      new THREE.MeshStandardMaterial({ color: 0x4a7a3c, roughness: 1 })
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.12;
    skirt.receiveShadow = true;
    this.scene.add(skirt);
    return ground;
  }

  updateLighting(clock) {
    const d = clock.daylight;
    this._night = 1 - d;

    const sunAngle = ((clock.hour - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAngle) * 140;
    const sy = Math.max(12, Math.sin(sunAngle) * 150);
    this.sun.position.set(sx, sy, 70);
    this.sun.intensity = 0.15 + d * 2.0;
    this.sun.color.setHSL(0.1, 0.55 - d * 0.3, 0.55 + d * 0.28);
    this.hemi.intensity = 0.28 + d * 0.95;
    this.ambient.intensity = 0.22 + d * 0.2;

    const daySky = new THREE.Color(0x9fd3ef);
    const duskSky = new THREE.Color(0xe08a5a);
    const nightSky = new THREE.Color(0x0b1626);

    const sky = new THREE.Color();
    if (d > 0.45) {
      sky.copy(daySky);
    } else if (d > 0.12) {
      const t = (d - 0.12) / 0.33;
      sky.copy(duskSky).lerp(daySky, t);
    } else {
      const t = d / 0.12;
      sky.copy(nightSky).lerp(duskSky, t);
    }
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.renderer.toneMappingExposure = 0.72 + d * 0.45;
  }

  get nightFactor() {
    return this._night;
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Apply the user-facing camera defaults and retain them as the Reset pose.
   * OrbitControls stores the camera as a spherical offset from its target, so
   * yaw, polar tilt, and distance are the stable values to expose in Settings.
   */
  applyCameraDefaults({ cameraYaw = 34.5, cameraPitch = 64, cameraZoom = 228, cameraTargetX, cameraTargetZ } = {}) {
    const yaw = THREE.MathUtils.degToRad(Number(cameraYaw) || 0);
    const polar = THREE.MathUtils.degToRad(Math.max(25, Math.min(80, Number(cameraPitch) || 64)));
    const distance = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, Number(cameraZoom) || 228));
    const target = this.homeTarget.clone();
    if (Number.isFinite(Number(cameraTargetX))) target.x = Number(cameraTargetX);
    if (Number.isFinite(Number(cameraTargetZ))) target.z = Number(cameraTargetZ);
    const horizontal = Math.sin(polar) * distance;
    this.homeTarget.copy(target);
    this.controls.target.copy(target);
    this.camera.up.copy(this.homeUp);
    this.camera.position.set(
      target.x + Math.sin(yaw) * horizontal,
      target.y + Math.cos(polar) * distance,
      target.z + Math.cos(yaw) * horizontal
    );
    this.camera.lookAt(target);
    this.controls.update();
    this.homeCamera.copy(this.camera.position);
    this.homePolar = polar;
    this.homeAzimuth = yaw;
  }

  resetView() {
    this.camera.up.copy(this.homeUp);
    this.camera.position.copy(this.homeCamera);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
  }

  /**
   * Frame a point with the home view's polar angle, azimuth and up vector, so
   * the orbit behaves exactly like the default view - only the pivot moves.
   * `height` is the eye height above the target. OrbitControls orbits about
   * `camera.up` and a pose on the pole has no usable horizontal orbit, which
   * is why this never sets a top-down up-vector.
   */
  focusCentre(x = 0, z = 0, camera = {}) {
    // A numeric third argument remains compatible with the old vertical-height
    // API. The normal path receives the user's yaw, tilt, and zoom settings.
    const legacyHeight = typeof camera === 'number' ? camera : null;
    const requestedYaw = Number(camera.cameraYaw);
    const requestedPitch = Number(camera.cameraPitch);
    const requestedZoom = Number(camera.cameraZoom);
    const yaw = legacyHeight == null
      ? (Number.isFinite(requestedYaw) ? THREE.MathUtils.degToRad(requestedYaw) : this.homeAzimuth)
      : this.homeAzimuth;
    const polar = legacyHeight == null
      ? THREE.MathUtils.degToRad(Number.isFinite(requestedPitch)
        ? Math.max(25, Math.min(80, requestedPitch))
        : THREE.MathUtils.radToDeg(this.homePolar))
      : this.homePolar;
    const distance = legacyHeight == null
      ? Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, Number.isFinite(requestedZoom) ? requestedZoom : this.homeCamera.distanceTo(this.homeTarget)))
      : legacyHeight / Math.max(0.01, Math.cos(polar));
    const horizontal = Math.sin(polar) * distance;
    this.controls.target.set(x, 0, z);
    this.camera.up.copy(this.homeUp);
    this.camera.position.set(
      x + Math.sin(yaw) * horizontal,
      Math.cos(polar) * distance,
      z + Math.cos(yaw) * horizontal
    );
    this.camera.lookAt(x, 0, z);
    this.controls.update();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  worldSize(grid) {
    return { width: grid.w * CELL, height: grid.h * CELL };
  }
}

export function disposeObject(obj) {
  obj.traverse((node) => {
    // An object may own resources beyond its own geometry — a sign's material,
    // for instance, which the shared traversal cannot reach: it is not the
    // node's own geometry and its texture is not a geometry at all. Anything
    // that allocates per-instance says so here.
    node.userData?.disposeSelf?.();
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
