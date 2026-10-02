import * as THREE from 'three';
import { CELL, SIM } from '../core/config.js';

/**
 * EXTEND_STREET's afterglow.
 *
 * A street order lays its tiles instantly (BUILD_HOURS.road is 0), so without
 * a marker the council has no way to see WHERE its money went — the run is
 * just four more grey tiles in a town of grey tiles. Every cell an order paves
 * is therefore highlighted for STREET_GLOW_HOURS of GAME time (not wall-clock,
 * so pausing or 50x speed cannot shorten it), then fades out over
 * FADE_HOURS so the highlight is never cut off mid-view.
 */
export const STREET_GLOW_HOURS = 5;
/** Run-off fade AFTER the five hours — "at least 5 game hours", literally. */
const FADE_HOURS = 0.5;

/** Lifetimes in simulation seconds — the unit `update(dt)` is handed. */
const HOLD = STREET_GLOW_HOURS * 60 * SIM.secondsPerGameMinute;
const FADE = FADE_HOURS * 60 * SIM.secondsPerGameMinute;
const LIFE = HOLD + FADE;

const CORE_OPACITY = 0.58;
const HALO_OPACITY = 0.42;
const GLOW_COLOR = 0x6ff5b4;
const HALO_COLOR = 0xccffe9;
/** Pulses per second, and how far the pulse swings from its mean. */
const PULSE_RATE = 2.6;
const PULSE_DEPTH = 0.22;

let tileTexture = null;
let tileBuilt = false;

/**
 * One freshly-paved tile: a soft wash under a blurred rounded border. The
 * blur is load-bearing — it lets neighbouring tiles in a run merge into one
 * continuous lit band instead of four boxed-off squares.
 */
function glowTile() {
  if (tileBuilt) return tileTexture;
  tileBuilt = true;
  if (typeof document === 'undefined') return null;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const h = S / 2;
  const wash = x.createRadialGradient(h, h, 2, h, h, h);
  wash.addColorStop(0, 'rgba(255,255,255,0.78)');
  wash.addColorStop(0.5, 'rgba(255,255,255,0.34)');
  wash.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = wash;
  x.fillRect(0, 0, S, S);

  x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.lineWidth = 6;
  x.shadowColor = 'rgba(255,255,255,0.85)';
  x.shadowBlur = 12;
  const m = 12;
  x.beginPath();
  if (x.roundRect) x.roundRect(m, m, S - 2 * m, S - 2 * m, 18);
  else x.rect(m, m, S - 2 * m, S - 2 * m);
  x.stroke();
  x.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tileTexture = tex;
  return tex;
}

export class StreetGlow {
  constructor(town) {
    this.town = town;
    this.group = new THREE.Group();
    this.group.name = 'street-glow';
    this.group.raycast = () => {};
    town.root.add(this.group);
    // 'x,y' -> { geo, core, halo, coreMat, haloMat, remaining, phase }
    this.entries = new Map();
    this.t = 0;
  }

  /**
   * Highlight the cells one EXTEND_STREET order just paved. Re-marking a cell
   * (bulldozed, then extended again) restarts its clock rather than stacking a
   * second overlay on top of the first.
   */
  mark(cells) {
    if (!cells || !cells.length) return 0;
    const g = this.town.grid;
    const tex = glowTile();
    // One phase for the whole run: a street lights up as a band, not as four
    // tiles flashing out of step with each other.
    const seed = cells[0];
    const phase = (((seed[0] * 13 + seed[1] * 7) % 37) / 37) * Math.PI * 2;
    let marked = 0;
    for (const [x, y] of cells) {
      if (!g.inBounds(x, y) || !g.isRoad(x, y)) continue;
      const key = `${x},${y}`;
      const stale = this.entries.get(key);
      if (stale) this.drop(key, stale);

      const p = g.cellToWorld(x, y);
      // Geometry stays centred on its own origin: the halo scales up, and a
      // scale on vertices already translated into world space would throw the
      // glow out across the map (about 0,0, not about the cell).
      const geo = new THREE.PlaneGeometry(CELL, CELL);
      geo.rotateX(-Math.PI / 2);

      const coreMat = new THREE.MeshBasicMaterial({
        map: tex || undefined,
        color: GLOW_COLOR,
        transparent: true,
        opacity: CORE_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const haloMat = new THREE.MeshBasicMaterial({
        map: tex || undefined,
        color: HALO_COLOR,
        transparent: true,
        opacity: HALO_OPACITY,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      });

      const core = new THREE.Mesh(geo, coreMat);
      const halo = new THREE.Mesh(geo, haloMat);
      const y0 = g.heightAtWorld(p.x, p.z) + 0.06;
      core.position.set(p.x, y0, p.z);
      halo.position.set(p.x, y0, p.z);
      halo.scale.set(1.14, 1, 1.14);
      core.renderOrder = 6;
      halo.renderOrder = 7;
      // Never intercept a click: cell picking runs off the ground plane, but a
      // pickable overlay would still show up in town.pick()'s agent hits.
      core.raycast = () => {};
      halo.raycast = () => {};
      this.group.add(core, halo);
      this.entries.set(key, { geo, core, halo, coreMat, haloMat, remaining: LIFE, phase });
      marked++;
    }
    return marked;
  }

  /** Advance every highlight: drop expired/repaved tiles, then breathe. */
  update(dt) {
    if (dt > 0) this.t += dt;
    if (!this.entries.size) return;
    const g = this.town.grid;
    for (const [key, e] of [...this.entries]) {
      const [x, y] = key.split(',').map(Number);
      // A tile the player bulldozed (or a run rolled back) is no longer the
      // street this highlight was about — take it down.
      if (!g.inBounds(x, y) || !g.isRoad(x, y)) {
        this.drop(key, e);
        continue;
      }
      e.remaining -= dt;
      if (e.remaining <= 0) {
        this.drop(key, e);
        continue;
      }
      const bright = e.remaining > FADE ? 1 : e.remaining / FADE;
      const wave = 1 - PULSE_DEPTH + PULSE_DEPTH * Math.sin(this.t * PULSE_RATE + e.phase);
      e.coreMat.opacity = CORE_OPACITY * bright * wave;
      e.haloMat.opacity = HALO_OPACITY * bright * wave;
    }
  }

  drop(key, e) {
    this.entries.delete(key);
    this.group.remove(e.core, e.halo);
    e.coreMat.dispose();
    e.haloMat.dispose();
    e.geo.dispose();
  }

  clear() {
    for (const [key, e] of [...this.entries]) this.drop(key, e);
  }
}
