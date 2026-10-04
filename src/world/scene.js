import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL, PALETTE } from '../core/config.js';

// Reused by updateLighting. Constructing a dozen Color objects per frame was
// pure garbage on the render path; the values are immutable references and the
// three scratch colours are copied/lerped in place below.
const SKY_PALETTE = Object.freeze({
  dayTop: new THREE.Color(0x4b91c4),
  dayHorizon: new THREE.Color(0xbfe7f4),
  dayBottom: new THREE.Color(0x8fb9c9),
  duskTop: new THREE.Color(0x4a365f),
  duskHorizon: new THREE.Color(0xf0a06b),
  duskBottom: new THREE.Color(0xd9785a),
  nightTop: new THREE.Color(0x020611),
  nightHorizon: new THREE.Color(0x182b43),
  nightBottom: new THREE.Color(0x0b1626),
  overcast: new THREE.Color(0x71808a),
  top: new THREE.Color(),
  horizon: new THREE.Color(),
  bottom: new THREE.Color()
});

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

function makeSkybox() {
  const uniforms = {
    topColor: { value: new THREE.Color(0x4b91c4) },
    horizonColor: { value: new THREE.Color(0xbfe7f4) },
    bottomColor: { value: new THREE.Color(0x8fb9c9) },
    sunColor: { value: new THREE.Color(0xffe5b0) },
    sunDirection: { value: new THREE.Vector3(0.5, 0.7, 0.35).normalize() },
    nightStrength: { value: 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vSkyDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vSkyDirection = worldPosition.xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform float nightStrength;
      varying vec3 vSkyDirection;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
        float horizonMix = smoothstep(0.04, 0.48, height);
        float topMix = smoothstep(0.42, 0.94, height);
        vec3 color = mix(bottomColor, horizonColor, horizonMix);
        color = mix(color, topColor, topMix);

        float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
        float sunGlow = pow(sunDot, 12.0) * 0.12 + pow(sunDot, 220.0) * 0.8;
        color += sunColor * sunGlow * (1.0 - nightStrength);

        vec2 starCell = floor(direction.xz * 180.0 + direction.y * 37.0);
        float stars = step(0.9985, hash21(starCell));
        stars *= smoothstep(0.16, 0.82, direction.y) * nightStrength;
        color += vec3(0.65, 0.78, 1.0) * stars * 0.75;

        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), material);
  mesh.name = 'skybox';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

/**
 * Lightweight, camera-local precipitation. The geometry is created once and
 * moved with the orbit target, so weather remains visible over the town
 * without allocating particles every frame or covering the whole 100x100
 * build plate. Rain uses short line segments; snow uses soft points.
 */
function makeWeatherEffects() {
  const group = new THREE.Group();
  group.name = 'weather-effects';

  const rainCount = 360;
  const rainPositions = new Float32Array(rainCount * 6);
  for (let i = 0; i < rainCount; i++) {
    const a = i * 12.9898;
    const x = ((Math.sin(a) * 0.5 + 0.5) * 2 - 1) * 78;
    const z = ((Math.sin(a * 1.731) * 0.5 + 0.5) * 2 - 1) * 78;
    const y = ((Math.sin(a * 2.177) * 0.5 + 0.5) * 48) + 5;
    const j = i * 6;
    rainPositions[j] = x;
    rainPositions[j + 1] = y;
    rainPositions[j + 2] = z;
    rainPositions[j + 3] = x - 0.22;
    rainPositions[j + 4] = y - 1.7;
    rainPositions[j + 5] = z - 0.06;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({
    color: 0xa8d6ea,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true
  }));
  rain.name = 'rain';
  rain.frustumCulled = false;
  rain.visible = false;

  const snowCount = 260;
  const snowPositions = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowCount; i++) {
    const a = (i + 17) * 19.193;
    snowPositions[i * 3] = ((Math.sin(a) * 0.5 + 0.5) * 2 - 1) * 78;
    snowPositions[i * 3 + 1] = ((Math.sin(a * 1.37) * 0.5 + 0.5) * 44) + 7;
    snowPositions[i * 3 + 2] = ((Math.sin(a * 1.91) * 0.5 + 0.5) * 2 - 1) * 78;
  }
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({
    color: 0xf4fbff,
    size: 0.65,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true
  }));
  snow.name = 'snow';
  snow.frustumCulled = false;
  snow.visible = false;

  group.add(rain, snow);
  return { group, rain, snow };
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
    this.scene.background = new THREE.Color(0xbfe7f4);
    // The full plate is 400m across. Start fading beyond the readable town
    // core and finish before the plate's diagonal corners, so the rectangular
    // build boundary dissolves into the procedural sky instead of remaining a
    // hard green frame in wide overviews.
    this.scene.fog = new THREE.Fog(0xbfe7f4, 120, 460);
    const sky = makeSkybox();
    this.skybox = sky.mesh;
    this.skyUniforms = sky.uniforms;
    this.scene.add(this.skybox);
    this.weatherFx = makeWeatherEffects();
    this.scene.add(this.weatherFx.group);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.5,
      3000
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
    // At an exact top-down pose the spherical azimuth is mathematically
    // undefined and OrbitControls normalises it to zero. Keep the requested
    // yaw separately so the HUD and Settings can still report the user's
    // chosen orientation while pitch is 0°.
    this.cameraYaw = this.homeAzimuth;

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4c6b3f, 1.1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.1);
    this.sun.position.set(90, 130, 60);
    this.sun.castShadow = true;
    // The shadow frustum is fixed on the world origin (sun.target is never
    // moved), so it has to cover the whole 400m plate from day one. A 260m
    // half-width covers the 200m corner radius with room for the sun angle.
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 700;
    const s = 260;
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
   * The inner plane is the currently acquired town land. The darker skirt is
   * the finite world the council can buy into later. Keeping those surfaces
   * separate makes the founding perimeter visible instead of presenting the
   * whole future grid as already-owned empty land.
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
    this.skirt = skirt;
    return ground;
  }

  /** Resize and move the light playable plane to the acquired cell envelope. */
  setPlayableBounds(bounds, grid) {
    if (!this.ground || !bounds || !grid ||
      ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return;
    const min = grid.cellToWorld(bounds.minX, bounds.minY);
    const max = grid.cellToWorld(bounds.maxX, bounds.maxY);
    const width = (bounds.maxX - bounds.minX + 1) * CELL;
    const height = (bounds.maxY - bounds.minY + 1) * CELL;
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(width, height, 1, 1);
    this.ground.position.set((min.x + max.x) / 2, -0.04, (min.z + max.z) / 2);
    this.ground.userData.playableBounds = { ...bounds };
    this.groundMat.map.repeat.set(width / 9, height / 9);
  }

  updateLighting(clock, weather = null) {
    const d = clock.daylight;
    this._night = 1 - d;
    const precipitation = Math.max(0, Math.min(1, Number(weather?.precipitation) || 0));
    const cloud = Math.min(1, precipitation * 0.65 + (weather?.weather === 'cloudy' ? 0.22 : 0));

    const sunAngle = ((clock.hour - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAngle) * 140;
    const sy = Math.max(12, Math.sin(sunAngle) * 150);
    this.sun.position.set(sx, sy, 70);
    this.sun.intensity = (0.15 + d * 2.0) * (1 - cloud * 0.28);
    this.sun.color.setHSL(0.1, 0.55 - d * 0.3, 0.55 + d * 0.28);
    this.hemi.intensity = (0.28 + d * 0.95) * (1 - cloud * 0.12);
    this.ambient.intensity = 0.22 + d * 0.2;

    const {
      dayTop, dayHorizon, dayBottom, duskTop, duskHorizon, duskBottom,
      nightTop, nightHorizon, nightBottom, overcast, top, horizon, bottom
    } = SKY_PALETTE;
    if (d > 0.45) {
      top.copy(dayTop); horizon.copy(dayHorizon); bottom.copy(dayBottom);
    } else if (d > 0.12) {
      const t = (d - 0.12) / 0.33;
      top.copy(nightTop).lerp(duskTop, Math.min(1, t));
      horizon.copy(nightHorizon).lerp(duskHorizon, Math.min(1, t));
      bottom.copy(nightBottom).lerp(duskBottom, Math.min(1, t));
    } else {
      const t = d / 0.12;
      top.copy(nightTop).lerp(duskTop, t);
      horizon.copy(nightHorizon).lerp(duskHorizon, t);
      bottom.copy(nightBottom).lerp(duskBottom, t);
    }
    // Overcast weather desaturates the daytime sky and pulls the horizon fog
    // closer, giving rain and storms a visible atmospheric footprint without
    // replacing the deterministic day/night cycle.
    if (cloud > 0) {
      top.lerp(overcast, cloud * 0.25);
      horizon.lerp(overcast, cloud * 0.32);
      bottom.lerp(overcast, cloud * 0.18);
    }
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.horizonColor.value.copy(horizon);
    this.skyUniforms.bottomColor.value.copy(bottom);
    this.skyUniforms.sunColor.value.copy(this.sun.color);
    this.skyUniforms.sunDirection.value.copy(this.sun.position).normalize();
    this.skyUniforms.nightStrength.value = this._night;
    this.scene.background.copy(horizon);
    this.scene.fog.color.copy(horizon);
    this.scene.fog.near = 120 - cloud * 30;
    this.scene.fog.far = 460 - cloud * 100;
    this.renderer.toneMappingExposure = 0.72 + d * 0.45;
    this.updateWeatherEffects(weather, clock);
  }

  /** Update camera-local precipitation and expose the current visual state. */
  updateWeatherEffects(weather = null, clock = null) {
    const fx = this.weatherFx;
    if (!fx) return;
    const state = weather?.weather || 'clear';
    const precipitation = THREE.MathUtils.clamp(Number(weather?.precipitation) || 0, 0, 1);
    const rainOn = (state === 'rain' || state === 'storm') && precipitation > 0.2;
    const snowOn = state === 'snow' && precipitation > 0.2;
    const target = this.controls?.target;
    if (target) fx.group.position.set(target.x, 0, target.z);
    const elapsed = Number(clock?.elapsed);
    const time = Number.isFinite(elapsed) ? elapsed : performance.now() / 1000;
    fx.rain.visible = rainOn;
    fx.snow.visible = snowOn;
    fx.rain.material.opacity = rainOn ? 0.2 + precipitation * 0.42 : 0;
    fx.snow.material.opacity = snowOn ? 0.35 + precipitation * 0.5 : 0;
    // The shared field scrolls through a short vertical loop. Its large local
    // envelope keeps the effect stable while orbiting and avoids per-particle
    // CPU work in long simulations.
    fx.rain.position.y = rainOn ? ((time * 13) % 42) - 12 : 0;
    fx.rain.position.x = rainOn ? Math.sin(time * 0.35) * 2 : 0;
    fx.snow.position.y = snowOn ? Math.sin(time * 0.45) * 1.5 : 0;
    fx.snow.position.x = snowOn ? Math.sin(time * 0.18) * 5 : 0;
    fx.snow.position.z = snowOn ? Math.cos(time * 0.14) * 4 : 0;
    fx.group.visible = rainOn || snowOn;
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
    const requestedPitch = Number(cameraPitch);
    const pitch = Number.isFinite(requestedPitch) ? requestedPitch : 64;
    const polar = THREE.MathUtils.degToRad(Math.max(0, Math.min(80, pitch)));
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
    this.cameraYaw = yaw;
  }

  resetView() {
    this.camera.up.copy(this.homeUp);
    this.camera.position.copy(this.homeCamera);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    this.cameraYaw = this.homeAzimuth;
  }

  /** Move to an absolute camera angle while keeping the current focus target. */
  setCameraPose({ yaw = 34.5, pitch = 64, zoom = 228, targetX, targetZ } = {}) {
    const controls = this.controls;
    const target = controls.target.clone();
    if (Number.isFinite(Number(targetX))) target.x = Number(targetX);
    if (Number.isFinite(Number(targetZ))) target.z = Number(targetZ);
    const azimuth = THREE.MathUtils.degToRad(Number(yaw) || 0);
    const polar = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(pitch) || 0, 0, 80));
    const distance = THREE.MathUtils.clamp(Number(zoom) || 228, controls.minDistance, controls.maxDistance);
    const horizontal = Math.sin(polar) * distance;
    controls.target.copy(target);
    this.camera.up.copy(this.homeUp);
    this.camera.position.set(
      target.x + Math.sin(azimuth) * horizontal,
      target.y + Math.cos(polar) * distance,
      target.z + Math.cos(azimuth) * horizontal
    );
    this.camera.lookAt(target);
    controls.update();
    this.cameraYaw = azimuth;
  }

  /** Apply a small viewport nudge without changing the saved Settings pose. */
  nudgeCamera({ yaw = 0, pitch = 0, zoom = 0, panX = 0, panZ = 0 } = {}) {
    const controls = this.controls;
    const currentPitch = controls.getPolarAngle();
    const currentYaw = currentPitch < 0.0001 ? this.cameraYaw : controls.getAzimuthalAngle();
    const wrapYaw = (value) => ((value + Math.PI) % (Math.PI * 2)) - Math.PI;
    const nextYaw = wrapYaw(currentYaw + THREE.MathUtils.degToRad(Number(yaw) || 0));
    const nextPitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(currentPitch) + (Number(pitch) || 0), 0, 80
    ));
    const distance = THREE.MathUtils.clamp(
      this.camera.position.distanceTo(controls.target) + (Number(zoom) || 0),
      controls.minDistance,
      controls.maxDistance
    );
    const target = controls.target.clone();
    target.x += Number(panX) || 0;
    target.z += Number(panZ) || 0;
    const horizontal = Math.sin(nextPitch) * distance;
    controls.target.copy(target);
    this.camera.up.copy(this.homeUp);
    this.camera.position.set(
      target.x + Math.sin(nextYaw) * horizontal,
      target.y + Math.cos(nextPitch) * distance,
      target.z + Math.cos(nextYaw) * horizontal
    );
    this.camera.lookAt(target);
    controls.update();
    this.cameraYaw = nextYaw;
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
        ? Math.max(0, Math.min(80, requestedPitch))
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
    this.cameraYaw = yaw;
  }

  /**
   * Frame the complete acquired town envelope without changing the current
   * orbit direction. The fit toggle calls this when the perimeter grows, so
   * expansion remains visible while manual orbit and pan still feel natural.
   */
  // Fit the acquired land tightly. A diagonal multiplier of 1.35 made the
  // camera frame a large frontier skirt around the owned cells, especially at
  // the default elevated tilt. 0.75 keeps a small edge buffer while making
  // the acquired footprint fill the playable viewport.
  fitTown(bounds, grid, { padding = 0.75 } = {}) {
    if (!bounds || !grid || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null;
    const min = grid.cellToWorld(bounds.minX, bounds.minY);
    const max = grid.cellToWorld(bounds.maxX, bounds.maxY);
    const width = Math.max(CELL, (bounds.maxX - bounds.minX + 1) * CELL);
    const depth = Math.max(CELL, (bounds.maxY - bounds.minY + 1) * CELL);
    const target = {
      x: (min.x + max.x) / 2,
      z: (min.z + max.z) / 2
    };
    const currentPitch = this.controls.getPolarAngle();
    const currentYaw = currentPitch < 0.0001 ? this.cameraYaw : this.controls.getAzimuthalAngle();
    const polar = THREE.MathUtils.clamp(currentPitch, 0, this.controls.maxPolarAngle);
    const diagonal = Math.hypot(width, depth);
    const distance = THREE.MathUtils.clamp(
      diagonal * Number(padding || 1.35),
      this.controls.minDistance,
      this.controls.maxDistance
    );
    const horizontal = Math.sin(polar) * distance;
    this.controls.target.set(target.x, 0, target.z);
    this.camera.up.copy(this.homeUp);
    this.camera.position.set(
      target.x + Math.sin(currentYaw) * horizontal,
      Math.cos(polar) * distance,
      target.z + Math.cos(currentYaw) * horizontal
    );
    this.camera.lookAt(target.x, 0, target.z);
    this.controls.update();
    this.cameraYaw = currentYaw;
    return { ...target, distance, bounds: { ...bounds } };
  }

  render() {
    this.controls.update();
    // Keep the sky infinitely distant even when the player pans across the
    // full plate; only its direction should change with the camera.
    this.skybox.position.copy(this.camera.position);
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
