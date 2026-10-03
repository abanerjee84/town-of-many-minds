/**
 * Calls the town answers: a resident collapses, a building catches fire, a
 * disturbance is reported. Emergency units sit at their station until a call
 * matches their unit type - an ambulance only ever moves for a sick resident,
 * the fire engine only for a fire, police patrol until someone needs them.
 */
import * as THREE from 'three';
import { events } from '../core/events.js';
import rules from '../data/incidentRules.json' with { type: 'json' };

const KIND_UNIT = { medical: 'Ambulance', fire: 'Fire', police: 'Police' };
const KIND_TYPE = { medical: 'ambulance', fire: 'fire', police: 'police' };

/**
 * Per-state age budgets in seconds (P-E02). An unanswered call only has the
 * town's grace period; a claimed or en route one is kept alive by the
 * responder working it, with the drive given far longer than a parked unit;
 * a claim whose vehicle has gone is dropped quickly rather than pinned.
 */
const TIMEOUTS = {
  unassigned: (grace) => grace,
  orphaned: () => rules.timeouts.orphaned,
  assigned: () => rules.timeouts.assigned,
  enroute: () => rules.timeouts.enroute
};

const window = (kind, table) => rules[table]?.[kind] || [0, 0];

function streetOf(town, cell) {
  const info = town.roadKit?.cellInfo?.get(`${cell[0]},${cell[1]}`);
  if (info?.street) return info.street;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const n = town.roadKit?.cellInfo?.get(`${cell[0] + dx},${cell[1] + dy}`);
    if (n?.street) return n.street;
  }
  return 'the high street';
}

function flameMarker() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false });
  const core = new THREE.MeshBasicMaterial({ color: 0xffd34d, toneMapped: false });
  const flames = [
    [0.9, 1.5, 0.9, 0, 0, mat],
    [0.6, 2.2, 0.6, 0.35, 0.2, core],
    [0.5, 1.8, 0.5, -0.3, -0.25, mat],
    [0.4, 1.2, 0.4, 0.1, -0.4, core]
  ];
  for (const [w, h, d, x, z, m] of flames) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, h / 2, z);
    b.castShadow = false;
    group.add(b);
  }
  group.visible = false;
  return group;
}

export class IncidentBoard {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(707);
    this.group = new THREE.Group();
    this.group.name = 'incidents';
    this.list = [];
    this.seq = 1;
    this.next = Object.fromEntries(Object.keys(rules.spawnWindows).map((kind) => [kind, this.rng.float(...window(kind, 'spawnWindows'))]));
    this.flames = null;
    this.flameFor = null;
    this.blink = 0;
    this.flicker = 0;
    // DECLARE_EMERGENCY: while set, an unanswered call ages out at double the
    // grace period — the board holds it rather than dropping it.
    this.emergency = false;
  }

  clear() {
    this.list = [];
    this.dropFlames();
    this.emergency = false;
    this.dropFlames();
    this.seq = 1;
    this.next = Object.fromEntries(Object.keys(rules.spawnWindows).map((kind) => [kind, this.rng.float(...window(kind, 'spawnWindows'))]));
  }

  resetRng(rng) {
    this.rng = rng.fork(707);
    this.clear();
  }

  unitsOf(type) {
    let n = 0;
    for (const v of this.town.traffic.vehicles) if (v.type === type) n++;
    return n;
  }

  openCount(kind) {
    let n = 0;
    for (const i of this.list) if (i.kind === kind && !i.takenBy) n++;
    return n;
  }

  update(dt) {
    for (const kind of ['medical', 'fire', 'police']) {
      this.next[kind] -= dt;
      if (this.next[kind] > 0) continue;
      if (kind === 'medical') this.raiseMedical();
      else if (kind === 'fire') this.raiseFire();
      else this.raisePolice();
      this.next[kind] = this.rng.float(...window(kind, 'respawnWindows'));
    }

    this.blink += dt;
    if (this.flames) {
      this.flicker += dt;
      const s = 1 + Math.sin(this.flicker * 9) * 0.12;
      this.flames.scale.set(1, s, 1);
      this.flames.rotation.y += dt * 0.6;
    }

    let dropped = false;
    // An emergency declaration doubles the grace period before an unanswered
    // call is dropped, and the declaration lifts itself once the town is calm.
    const grace = this.emergency ? rules.timeouts.emergencyGrace : rules.timeouts.defaultGrace;
    for (const i of this.list) {
      i.age += dt;
      const state = this.ageState(i);
      i.state = state;
      if (i.age > TIMEOUTS[state](grace)) {
        // An expired call is cancelled, not merely forgotten: the board drops
        // it AND the responder that had claimed it stops holding the claim
        // (P-E02 / P-E01). `cancelled` keeps it from later being read as a
        // live resolution when its unit finally rolls up.
        i.dead = true;
        i.cancelled = true;
        const v = i.takenBy;
        if (v) {
          if (v.incident === i) this.abandonCall(v, 'expired');
          v.incident = v.incident === i ? null : v.incident;
        }
        i.takenBy = null;
        dropped = true;
      }
    }
    if (dropped) this.list = this.list.filter((i) => !i.dead);
    if (this.emergency && this.list.length === 0) this.emergency = false;
    if (this.flameFor && !this.list.includes(this.flameFor)) this.dropFlames();
  }

  /**
   * Where a call has got to (P-E02). Each state ages on its own budget: an
   * open call only has the town's grace period, a claimed one a responder has
   * already committed to, one being driven to has to survive the drive, and
   * one whose responder no longer exists is stranded rather than pending.
   */
  ageState(inc) {
    const v = inc.takenBy;
    if (!v) return 'unassigned';
    if (!this.town.traffic?.vehicles.includes(v)) return 'orphaned';
    if (v.incident !== inc) return 'assigned';
    return 'enroute';
  }

  /** Sick residents first - lowest health, then anyone frail. */
  sickList() {
    const out = [];
    for (const c of this.town.pedestrians.citizens) {
      if (!c.p) continue;
      const conds = c.p.conditions || [];
      const ill = conds.includes('ill') || conds.includes('frail') || c.p.health < 0.5;
      if (ill) out.push(c);
    }
    out.sort((a, b) => a.p.health - b.p.health);
    return out;
  }

  push(incident) {
    incident.id = this.seq++;
    incident.age = 0;
    incident.takenBy = null;
    this.list.push(incident);
    if (incident.text) events.emit('log', { kind: 'event', text: incident.text });
    return incident;
  }

  raiseMedical() {
    if (this.unitsOf(KIND_TYPE.medical) === 0) return;
    if (this.openCount('medical') > 0) return;
    const sick = this.sickList();
    if (!sick.length) return;
    const pick = sick[this.rng.int(0, Math.min(2, sick.length - 1))];
    const pos = pick.group.position;
    const cell = this.town.grid.worldToCell(pos.x, pos.z);
    const road = this.town.nearestRoadCell(cell.x, cell.y);
    if (!road) return;
    const name = pick.p.name || 'a resident';
    return this.push({
      kind: 'medical',
      cell: road,
      label: name,
      text: `Ambulance called - ${name} is ill on ${streetOf(this.town, road)}.`,
      sceneText: `Paramedics work with ${name}.`,
      clearText: `${name} is handed over at the hospital.`
    });
  }

  raiseFire() {
    if (this.unitsOf(KIND_TYPE.fire) === 0) return;
    if (this.openCount('fire') > 0) return;
    const pool = this.town.buildings.filter((b) => b.facility !== 'fire station');
    const b = this.rng.pick(pool.length ? pool : this.town.buildings);
    if (!b) return;
    const road = this.town.nearestRoadCell(b.cell[0], b.cell[1]);
    if (!road) return;
    const label = b.name || (b.kind === 'house' ? 'a house' : b.kind === 'shop' ? 'a shop' : 'a building');
    const incident = this.push({
      kind: 'fire',
      cell: road,
      label,
      text: `Fire reported at ${label}!`,
      sceneText: `Fire crews beat back the flames at ${label}.`,
      clearText: `The fire at ${label} is out.`
    });
    this.lightFlames(b);
    return incident;
  }

  raisePolice() {
    if (this.unitsOf(KIND_TYPE.police) === 0) return;
    if (this.openCount('police') > 0) return;
    const cell = this.town.randomRoadCell(this.rng);
    if (!cell) return;
    return this.push({
      kind: 'police',
      cell,
      label: streetOf(this.town, cell),
      text: `Police called to a disturbance on ${streetOf(this.town, cell)}.`,
      sceneText: `Officers settle the disturbance.`,
      clearText: `The street is quiet again.`
    });
  }

  lightFlames(building) {
    this.dropFlames();
    const g = flameMarker();
    const e = building.matrix.elements;
    const y = this.town.grid.heightAtWorld(e[12], e[14]) + (building.height || 1.6);
    g.position.set(e[12], y, e[14]);
    this.group.add(g);
    this.flames = g;
    this.flameFor = this.list[this.list.length - 1];
    g.visible = true;
  }

  dropFlames() {
    if (!this.flames) return;
    this.group.remove(this.flames);
    this.flames.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.flames = null;
    this.flameFor = null;
  }

  /** Nearest open call this unit can answer. */
  takeFor(agent) {
    const kind = agent.type === 'ambulance' ? 'medical' : agent.type === 'fire' ? 'fire' : 'police';
    const open = this.list.find((i) => i.kind === kind && !i.takenBy);
    if (!open) return null;
    open.takenBy = agent;
    return open;
  }

  release(incident) {
    if (incident) incident.takenBy = null;
  }

  /**
   * Explicitly hand a claim back (P-E01/P-E02): the unit lets go of the call,
   * stops running lights to it, and stands down. The call itself stays on the
   * board for someone else, unless the board was the one dropping it.
   */
  abandonCall(vehicle, reason = 'released') {
    const inc = vehicle.incident;
    vehicle.incident = null;
    vehicle.sirens = false;
    vehicle.lights = false;
    if (vehicle.status === 'enroute') vehicle.status = 'patrol';
    vehicle.cooldown = 6;
    if (inc) {
      inc.takenBy = null;
      if (reason === 'expired') inc.cancelled = true;
    }
    return inc;
  }

  /** The unit is at the scene: drop the call, say so, and say how long it stays. */
  onScene(agent, rng) {
    const inc = agent.incident;
    agent.incident = null;
    if (!inc) return rng.float(...rules.sceneWindows.resolved.police);
    const live = this.list.includes(inc);
    if (live) this.list = this.list.filter((i) => i !== inc);
    if (this.flameFor === inc) this.dropFlames();
    // A call that is no longer on the board was cancelled while this unit was
    // still driving: log the arrival, but never as a live resolution and
    // never with the resolution text (P-E02).
    if (!live) {
      inc.cancelled = true;
      if (inc.takenBy === agent) inc.takenBy = null;
      const range = inc.kind === 'fire' ? rules.sceneWindows.cancelled.fire : rules.sceneWindows.cancelled.other;
      return rng.float(...range);
    }
    if (inc.sceneText) events.emit('log', { text: inc.sceneText });
    const range = rules.sceneWindows.resolved[inc.kind] || rules.sceneWindows.resolved.police;
    return rng.float(...range);
  }

  onClear(agent, rng) {
    const inc = agent.lastIncident;
    if (inc?.clearText && !inc.cancelled && rng.chance(rules.clearChance)) events.emit('log', { kind: 'event', text: inc.clearText });
    agent.lastIncident = null;
  }

  stats() {
    const byKind = {};
    const byState = {};
    for (const i of this.list) {
      byKind[i.kind] = (byKind[i.kind] || 0) + 1;
      const s = this.ageState(i);
      byState[s] = (byState[s] || 0) + 1;
    }
    return {
      open: this.list.length,
      byKind,
      byState,
      taken: this.list.filter((i) => i.takenBy).length,
      emergency: !!this.emergency
    };
  }
}

export const INCIDENT_KIND_LABEL = { medical: 'Medical call', fire: 'Fire', police: 'Police call' };
export { KIND_UNIT };
