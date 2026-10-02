/**
 * Traffic signal controller.
 *
 * Every signalised junction belongs to one of three phase groups (baked into
 * the geometry by `signalPhaseGroup`), and each group runs its own offset copy
 * of a two-axis cycle: NS green -> NS amber -> all red -> EW green -> EW amber
 * -> all red. Vehicles ask `stateFor(group, axis)` before entering a junction
 * and the lamp meshes are switched to match on every phase change.
 */

const GREEN = 4.4;
const AMBER = 1.1;
const ALL_RED = 0.7;
const HALF = GREEN + AMBER + ALL_RED;

export const SIGNAL_PERIOD = HALF * 2;
export const SIGNAL_PHASE = { GREEN, AMBER, ALL_RED };

export class SignalController {
  constructor(cells = [], meshes = []) {
    this.cells = cells;
    this.meshes = meshes;
    this.info = new Map();
    for (const c of cells) this.info.set(`${c.x},${c.y}`, c);
    this.groups = new Set();
    for (const m of meshes) this.groups.add(m.group);
    this.t = 0;
    this._key = null;
    this.sync(true);
  }

  /** Junctions run at offsets across the period so green waves alternate. */
  offset(group) {
    return (group * SIGNAL_PERIOD) / Math.max(1, this.groups.size || 3);
  }

  localTime(group) {
    const off = this.offset(group);
    return (((this.t - off) % SIGNAL_PERIOD) + SIGNAL_PERIOD) % SIGNAL_PERIOD;
  }

  stateFor(group, axis) {
    const t = this.localTime(group);
    if (axis === 'z') {
      if (t < GREEN) return 'green';
      if (t < GREEN + AMBER) return 'amber';
      return 'red';
    }
    if (t < HALF) return 'red';
    if (t < HALF + GREEN) return 'green';
    if (t < HALF + GREEN + AMBER) return 'amber';
    return 'red';
  }

  at(x, y) {
    return this.info.get(`${x},${y}`) || null;
  }

  hasSignal(x, y) {
    return this.info.has(`${x},${y}`);
  }

  update(dt) {
    if (dt > 0) this.t += dt;
    this.sync();
  }

  /** Only touch the meshes when a phase actually changed. */
  sync(force = false) {
    const groups = [...this.groups].sort((a, b) => a - b);
    let key = '';
    const states = new Map();
    for (const g of groups) {
      const x = this.stateFor(g, 'x');
      const z = this.stateFor(g, 'z');
      states.set(g, { x, z });
      key += `${g}:${x}/${z};`;
    }
    if (!force && key === this._key) return;
    this._key = key;
    for (const m of this.meshes) {
      const st = states.get(m.group);
      m.mesh.visible = !!st && st[m.axis] === m.lamp;
    }
  }

  counts() {
    return {
      groups: this.groups.size,
      junctions: this.cells.length,
      lamps: this.meshes.length
    };
  }
}
