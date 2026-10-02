import * as THREE from 'three';
import { CELL, CELL_KIND, SIM, FOUNDING_POPULATION } from '../core/config.js';
import { findPath, randomWalkableCell } from '../core/pathfinding.js';
import { buildCitizen, animateWalk } from '../kits/citizens/citizenKit.js';
import {
  moodFrom,
  pickSurname,
  familyAge,
  qualifies,
  jobById
} from '../kits/citizens/personality.js';
import { createProfile, scheduleAt, setJob } from '../kits/citizens/citizenProfile.js';
import { resourceStress, SITE_CREW } from '../kits/resources/resourceKit.js';
import { roadRoute, sampleAt } from './routes.js';
import { events } from '../core/events.js';
import { disposeObject } from '../world/scene.js';

const tmp = new THREE.Vector3();

function walkableRoad(x, y, grid) {
  return grid.kindAt(x, y) === CELL_KIND.ROAD;
}

/**
 * Travel axis of a one-cell route. Must match what pedestrianRoute feeds
 * roadRoute, or the chosen pavement side lands in a lane.
 */
function singleCellDir(grid, cell) {
  const m = grid.roadAt(cell[0], cell[1]);
  const horizontal = (m & 2 || m & 8) && !(m & 1 || m & 4);
  return horizontal ? [1, 0] : [0, 1];
}

function endpointSide(grid, path, point, atStart) {
  let dirX;
  let dirZ;
  if (path.length < 2) {
    [dirX, dirZ] = singleCellDir(grid, path[0]);
  } else {
    const a = atStart ? path[0] : path[path.length - 2];
    const b = atStart ? path[1] : path[path.length - 1];
    dirX = b[0] - a[0];
    dirZ = b[1] - a[1];
  }
  const len = Math.hypot(dirX, dirZ) || 1;
  const rightX = -dirZ / len;
  const rightZ = dirX / len;
  const cell = atStart ? path[0] : path[path.length - 1];
  const center = grid.cellToWorld(cell[0], cell[1]);
  return (point.x - center.x) * rightX + (point.z - center.z) * rightZ >= 0 ? 1 : -1;
}

function singleCellPavement(grid, cell, side) {
  const [dx, dz] = singleCellDir(grid, cell);
  const c = grid.cellToWorld(cell[0], cell[1]);
  return new THREE.Vector3(
    c.x - dz * SIM.walkOffset * side,
    grid.cellHeight(cell[0], cell[1]),
    c.z + dx * SIM.walkOffset * side
  );
}

function pushDistinct(out, point, crossingCell = null) {
  const last = out[out.length - 1];
  if (last && last.distanceToSquared(point) < 0.0025) {
    if (crossingCell) last.crossingCell = crossingCell;
    return;
  }
  const p = point.clone();
  if (crossingCell) p.crossingCell = crossingCell;
  out.push(p);
}

/**
 * The shortest walking route from `from` to `to` that crosses the carriageway at
 * a real junction.
 *
 * Pedestrians may not step off the pavement, so a route that cannot change sides
 * mid-street has to pass through a junction (degree ≥ 3) where the pavement
 * exists on both sides. This used to try EVERY junction with TWO independent A*
 * searches — one into it and one out of it — with no early exit, so the cost was
 * `O(junctions x component)`. `maxNodes: 9000` could not bound it either,
 * because the whole grid is 1,920 cells: every search fully explored its
 * component and allocated three typed arrays of that size. Measured on the same
 * code path: 0.36 ms with 4 junctions, **14.0 ms with 205**.
 *
 * Two changes make it linear in the number of junctions instead:
 *
 *   - a cheap LOWER BOUND (Manhattan distance) discards a junction the moment
 *     the best route found so far cannot beat it, so most junctions are never
 *     searched at all;
 *   - once the inward search at a junction fails, that junction is unreachable
 *     from `from` and is skipped without a second search entirely.
 *
 * The result is identical — same path, same `crossIdx` — because both are
 * exact computations; only the wasted work is gone.
 */
function nearestCrossingPath(grid, from, to) {
  let best = null;
  const legFrom = (j) => Math.abs(j[0] - from[0]) + Math.abs(j[1] - from[1]);
  const legTo = (j) => Math.abs(j[0] - to[0]) + Math.abs(j[1] - to[1]);
  grid.forEach((x, y, g) => {
    if (!g.isRoad(x, y) || g.roadDegree(x, y) < 3) return;
    const junction = [x, y];
    // Both legs cost at least their Manhattan distance, so this cannot beat what
    // we already have and the junction is never searched.
    if (best && legFrom(junction) + legTo(junction) >= best.score) return;
    const a = findPath(g, from, junction, { walkable: walkableRoad, maxNodes: 9000 });
    if (!a) return;
    // The inward leg is now known exactly; only the outward one is open.
    if (best && a.length + legTo(junction) >= best.score) return;
    const b = findPath(g, junction, to, { walkable: walkableRoad, maxNodes: 9000 });
    if (!b) return;
    const score = a.length + b.length;
    if (!best || score < best.score) best = { path: a.concat(b.slice(1)), crossIdx: a.length - 1, score };
  });
  return best;
}

function pavementAccessPoint(grid, path, target) {
  if (!path.length) return target.clone();
  const end = path[path.length - 1];
  const center = grid.cellToWorld(end[0], end[1]);
  let dx = 0;
  let dz = 1;
  if (path.length > 1) {
    const prev = path[path.length - 2];
    dx = end[0] - prev[0];
    dz = end[1] - prev[1];
  } else {
    const mask = grid.roadAt(end[0], end[1]);
    if (mask & 2 || mask & 8) {
      dx = 1;
      dz = 0;
    }
  }
  const len = Math.hypot(dx, dz) || 1;
  const rx = -dz / len;
  const rz = dx / len;
  const a = new THREE.Vector3(center.x + rx * SIM.walkOffset, grid.cellHeight(end[0], end[1]), center.z + rz * SIM.walkOffset);
  const b = new THREE.Vector3(center.x - rx * SIM.walkOffset, grid.cellHeight(end[0], end[1]), center.z - rz * SIM.walkOffset);
  return a.distanceToSquared(target) <= b.distanceToSquared(target) ? a : b;
}

/**
 * Build a pavement route. Side changes happen only across a marked junction;
 * when both buildings face the same pavement there is no road crossing at all.
 */
function pedestrianRoute(grid, directPath, start, end) {
  let path = directPath;
  let startSide = endpointSide(grid, path, start, true);
  let endSide = endpointSide(grid, path, end, false);
  let crossIdx = -1;

  if (startSide !== endSide) {
    crossIdx = path.findIndex((c, i) => i > 0 && i < path.length - 1 && grid.roadDegree(c[0], c[1]) >= 3);
    if (crossIdx < 0) {
      const detour = nearestCrossingPath(grid, path[0], path[path.length - 1]);
      if (!detour) return null;
      path = detour.path;
      crossIdx = detour.crossIdx;
      startSide = endpointSide(grid, path, start, true);
      endSide = endpointSide(grid, path, end, false);
    }
  }

  const out = [];
  pushDistinct(out, start);
  if (crossIdx < 0) {
    // roadRoute assumes a north-south axis for a lone cell; on an east-west
    // street that offset lands in the lane, so place the kerb point here.
    const leg = path.length === 1
      ? [singleCellPavement(grid, path[0], startSide)]
      : roadRoute(grid, path, SIM.walkOffset * startSide, { smooth: false });
    for (const p of leg) pushDistinct(out, p);
  } else {
    const before = roadRoute(grid, path.slice(0, crossIdx + 1), SIM.walkOffset * startSide, { smooth: false });
    const after = roadRoute(grid, path.slice(crossIdx), SIM.walkOffset * endSide, { smooth: false });
    for (const p of before) pushDistinct(out, p);
    const from = out[out.length - 1];
    const to = after[0];
    const cell = path[crossIdx];
    const crossingCell = `${cell[0]},${cell[1]}`;
    const pieces = Math.max(2, Math.ceil(from.distanceTo(to) / 0.65));
    for (let i = 1; i <= pieces; i++) {
      pushDistinct(out, from.clone().lerp(to, i / pieces), crossingCell);
    }
    for (let i = 1; i < after.length; i++) pushDistinct(out, after[i]);
  }
  pushDistinct(out, end);

  // Orthogonal pavement legs need the physical kerb corner between them.
  // A single diagonal otherwise cuts across the triangular middle of a lane.
  const cornered = [out[0]];
  const pavementScore = (p) => {
    const c = grid.worldToCell(p.x, p.z);
    // Off-road cells are lots and buildings: never a kerb corner.
    if (!grid.isRoad(c.x, c.y)) return -1;
    const center = grid.cellToWorld(c.x, c.y);
    return Math.max(Math.abs(p.x - center.x), Math.abs(p.z - center.z));
  };
  for (let i = 1; i < out.length; i++) {
    const prev = cornered[cornered.length - 1];
    const p = out[i];
    const dx = Math.abs(p.x - prev.x);
    const dz = Math.abs(p.z - prev.z);
    if (!prev.crossingCell && !p.crossingCell && dx > 0.65 && dz > 0.65) {
      const a = new THREE.Vector3(prev.x, (prev.y + p.y) * 0.5, p.z);
      const b = new THREE.Vector3(p.x, (prev.y + p.y) * 0.5, prev.z);
      const corner = pavementScore(a) >= pavementScore(b) ? a : b;
      if (pavementScore(corner) > pavementScore(prev.clone().lerp(p, 0.5)) + 0.15) {
        pushDistinct(cornered, corner);
      }
    }
    pushDistinct(cornered, p, p.crossingCell || null);
  }
  out.length = 0;
  out.push(...cornered);

  // Continuing along a pavement through a junction still traverses a
  // crosswalk across the side street, even when the citizen never changes
  // pavement side. Only a sample that lands inside the junction counts: a
  // route that merely runs alongside one must not keep asking it to be
  // clear long after it has been left behind.
  for (let i = 1; i < out.length; i++) {
    const p = out[i];
    if (p.crossingCell) continue;
    const prev = out[i - 1];
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const x = prev.x + (p.x - prev.x) * t;
      const z = prev.z + (p.z - prev.z) * t;
      const c = grid.worldToCell(x, z);
      if (grid.roadDegree(c.x, c.y) < 3) continue;
      p.crossingCell = `${c.x},${c.y}`;
      break;
    }
  }
  return out;
}

export class CitizenAgent {
  constructor(town, rig, personality, home, rng) {
    this.town = town;
    this.rig = rig;
    this.group = rig.group;
    this.p = personality;
    this.home = home;
    this.work = null;
    this.points = [];
    this.idx = 0;
    // P-E03: every timer that steers when a citizen decides something is drawn
    // from the seeded stream, never from Math.random(). Cosmetic animation can
    // differ freely; a replan or a stroll start may not.
    this.rng = rng || town.pedestrians?.agentRng || town.rng;
    this.phase = this.rng.float(0, 6);
    this.state = 'inside';
    this.mood = 0.7;
    this.speed = 0;
    this.target = null;
    this.targetKind = null;
    this.chatTimer = 0;
    this.chatWith = null;
    this.think = this.rng.float(0, 2);
    this.strollTimer = 30 + this.rng.float(0, 90);
    this.routeGoalKey = null;
    this.tripBegan = null;
    this.groundY = 0;
    this.inCrossing = false;
    this.blockT = 0;
    this.crossWaitT = 0;
    this.replanT = 0;
    this.targetBuilding = null;
    // Indoor occupancy is its own flag, never inferred from `state` or from
    // the current want: a citizen inside a building is hidden, out of the
    // street simulation, and counted as "in" by every statistic.
    this.indoors = true;
    this.insideBuilding = home || null;
    this.leftBuilding = null;
  }

  doorWorld(building) {
    if (building.doorWorld) return building.doorWorld.clone();
    if (!building.doorLocal || !building.matrix) return new THREE.Vector3();
    return building.doorLocal.clone().applyMatrix4(building.matrix);
  }

  /** The road cell a building's front door opens onto. */
  frontRoad(building) {
    const g = this.town.grid;
    if (building?.cell && building.face) {
      const x = building.cell[0] + building.face.x;
      const y = building.cell[1] + building.face.z;
      if (g.isRoad(x, y)) return [x, y];
    }
    return building?.cell ? this.town.nearestRoadCell(building.cell[0], building.cell[1]) : null;
  }

  /**
   * Where a walk to or from a building begins and ends. The door approach
   * point sits 1.15 m in front of the facade, which on a shallow setback is
   * already in the traffic lane; clamp it to the building-side pavement so a
   * trip never starts or ends in the carriageway.
   */
  doorStep(building) {
    const door = this.doorWorld(building);
    const g = this.town.grid;
    if (!building?.cell || !building.face) return door;
    const c = g.cellToWorld(building.cell[0], building.cell[1]);
    const fx = building.face.x;
    const fz = building.face.z;
    const along = (door.x - c.x) * fx + (door.z - c.z) * fz;
    const lat = (door.x - c.x) * -fz + (door.z - c.z) * fx;
    const pavement = CELL - SIM.walkOffset;
    const a = Math.min(along, pavement);
    const l = Math.max(-1.5, Math.min(1.5, lat));
    const x = c.x + fx * a - fz * l;
    const z = c.z + fz * a + fx * l;
    return new THREE.Vector3(x, g.heightAtWorld(x, z), z);
  }

  insideWorld(building) {
    if (!building?.cell) return this.doorWorld(building);
    const p = this.town.grid.cellToWorld(building.cell[0], building.cell[1]);
    return new THREE.Vector3(p.x, this.town.grid.heightAtWorld(p.x, p.z), p.z);
  }

  buildingLabel(building) {
    if (!building) return 'a building';
    if (building.name) return building.name;
    return building.kind === 'house'
      ? 'Home'
      : building.kind === 'shop'
        ? 'Shop'
        : building.kind === 'civic'
          ? 'Civic building'
          : building.kind === 'park'
            ? 'Park'
            : 'Building';
  }

  goalLabel(kind = this.routeGoalKey) {
    return kind === 'home'
      ? 'home'
      : kind === 'work'
        ? 'work'
        : kind === 'school'
          ? 'school'
          : kind === 'food'
            ? 'the shops'
            : 'the park';
  }

  /** Human-readable inside/outside status for panels and stats. */
  statusLabel() {
    if (this.indoors) return `Inside · ${this.buildingLabel(this.insideBuilding)}`;
    if (this.state === 'chatting') return 'Outside · Talking with a neighbour';
    if (this.state === 'waiting-crossing' && this.crossWaitT > 1.5) return 'Outside · Waiting to cross';
    if (this.state === 'walking' || this.state === 'waiting-crossing') return `Outside · On the way to ${this.goalLabel()}`;
    return 'Outside · Out and about';
  }

  /**
   * Move the citizen indoors: hidden, no street simulation, counted as in.
   * Cancels any trip or chat in progress.
   */
  enterBuilding(building) {
    if (this.chatWith) this.endChat();
    const inside = this.insideWorld(building);
    this.group.position.copy(inside);
    this.groundY = inside.y;
    this.points = [];
    this.idx = 0;
    this.speed = 0;
    this.inCrossing = false;
    this.blockT = 0;
    this.crossWaitT = 0;
    this.target = null;
    this.targetBuilding = null;
    this.indoors = true;
    this.insideBuilding = building || null;
    this.leftBuilding = null;
    this.state = 'inside';
    this.group.visible = false;
  }

  /**
   * Step out through the front door. The interior point is never a route
   * waypoint: a trip begins at the door, so nobody walks through a wall.
   */
  exitBuilding() {
    const building = this.insideBuilding;
    const door = building ? this.doorStep(building) : this.group.position.clone();
    this.group.position.copy(door);
    this.groundY = this.town.grid.heightAtWorld(door.x, door.z);
    this.leftBuilding = building || null;
    this.indoors = false;
    this.insideBuilding = null;
    if (this.state === 'inside') this.state = 'idle';
    this.group.visible = true;
  }

  currentCell() {
    const g = this.town.grid;
    const { x, y } = g.worldToCell(this.group.position.x, this.group.position.z);
    if (g.kindAt(x, y) === CELL_KIND.ROAD) return [x, y];
    // No road anywhere nearby means there is no route to plan, not a licence
    // to start one at a hard-coded corner of the map (TR-12).
    return this.town.nearestRoadCell(x, y);
  }

  desiredKey(clock) {
    const h = clock.hour;
    const works = this.p.job.work !== 'home';
    const student = this.p.job && this.p.job.id === 'student';
    if (h >= 22 || h < 6.5) return { key: 'home', kind: 'home' };
    // Infants are students on paper but skip the school trip: two park
    // outings a day (mirrors the infant schedule in scheduleFor) keep
    // newborns visible instead of hidden inside the school all day.
    if (this.p.stage === 'infant') {
      if (h >= 10 && h < 12) return { key: 'park-am', kind: 'leisure' };
      if (h >= 15.5 && h < 18) return { key: 'park-pm', kind: 'leisure' };
      return { key: 'home', kind: 'home' };
    }
    if (student && h >= 7.5 && h < 15) return { key: 'school', kind: 'school' };
    if (h >= 6.5 && h < 8.5 && works) return { key: 'work', kind: 'work' };
    if (h >= 12 && h < 13) return { key: 'lunch', kind: 'food' };
    if (h >= 17 && h < 19.5) return { key: 'leisure', kind: 'leisure' };
    if (h >= 19.5 && h < 22) return { key: 'home', kind: 'home' };
    if (works) return { key: 'work', kind: 'work' };
    if (this.strollTimer <= 0) return { key: 'stroll', kind: 'leisure' };
    return { key: 'home', kind: 'home' };
  }

  facilityAt(id) {
    const town = this.town;
    if (!town.civicIndex) return null;
    for (const b of town.buildings) {
      if (b.kind !== 'civic') continue;
      const key = town.grid.idx(b.cell[0], b.cell[1]);
      if (town.civicIndex.get(key) === id) return b;
    }
    return null;
  }

  resolveTarget(kind) {
    const town = this.town;
    this.targetBuilding = null;
    if (kind === 'home' && this.home) {
      this.targetBuilding = this.home;
      return this.doorStep(this.home);
    }
    if (kind === 'work' && this.work) {
      this.targetBuilding = this.work;
      return this.doorStep(this.work);
    }
    if (kind === 'school') {
      const school = this.facilityAt('school') || this.facilityAt('library');
      if (school) {
        this.targetBuilding = school;
        return this.doorStep(school);
      }
    }
    if (kind === 'food') {
      const b = town.pickBuilding(['shop'], this.town.rng);
      if (b) {
        this.targetBuilding = b;
        return this.doorStep(b);
      }
    }
    if (kind === 'leisure') {
      const spot = town.pickLeisureSpot(this.town.rng);
      if (spot) return spot;
    }
    if (this.home) {
      this.targetBuilding = this.home;
      return this.doorStep(this.home);
    }
    return null;
  }

  planRoute(target) {
    const grid = this.town.grid;
    const here = grid.worldToCell(this.group.position.x, this.group.position.z);
    // Off the road means we are on a doorstep: leave by that building's own
    // front road. The nearest road cell can be the street behind the house or
    // a diagonal corner, which sends the first leg straight through a wall.
    if (grid.isRoad(here.x, here.y)) this.leftBuilding = null;
    const from = !grid.isRoad(here.x, here.y) && this.leftBuilding
      ? this.frontRoad(this.leftBuilding)
      : this.currentCell();
    const tc = grid.worldToCell(target.x, target.z);
    const to = this.targetBuilding
      ? this.frontRoad(this.targetBuilding)
      : grid.kindAt(tc.x, tc.y) === CELL_KIND.ROAD
        ? [tc.x, tc.y]
        : this.town.nearestRoadCell(tc.x, tc.y);
    if (!from || !to) return false;
    const path = findPath(grid, from, to, { walkable: walkableRoad, maxNodes: 9000 });
    if (!path || path.length === 0) return false;
    const start = this.group.position.clone();
    let end = new THREE.Vector3(target.x, target.y ?? 0, target.z);
    // Door meshes and leisure anchors can sit a few centimetres over the
    // road-cell boundary. Trips terminate on the nearest pavement access;
    // building occupants are then placed inside, never walked through a lane.
    const endCell = grid.worldToCell(end.x, end.z);
    if (grid.isRoad(endCell.x, endCell.y)) end = pavementAccessPoint(grid, path, end);
    const pts = pedestrianRoute(grid, path, start, end);
    if (!pts || pts.length < 2) return false;
    this.points = pts;
    this.routeCells = path;
    this.routeVersion = this.town.roadGraphVersion;
    this.idx = 1;
    const current = grid.worldToCell(start.x, start.z);
    this.inCrossing = grid.roadDegree(current.x, current.y) >= 3;
    return true;
  }

  /**
   * Close out a walk that is not going to arrive (P-D03). A cancelled trip is
   * counted as cancelled — it never inflates the completion total, and the
   * running duration is not recorded as if the citizen had got there.
   */
  abandonTrip(system) {
    if (this.tripBegan == null) return false;
    if (system) system.tripCancellations++;
    this.tripBegan = null;
    return true;
  }

  arrive(system) {
    const goal = this.routeGoalKey;
    const building = this.targetBuilding;
    this.points = [];
    this.idx = 0;
    this.speed = 0;
    this.inCrossing = false;
    this.blockT = 0;
    this.crossWaitT = 0;
    this.replanT = 0;
    this.target = null;
    this.targetBuilding = null;
    if (building) {
      this.enterBuilding(building);
    } else {
      this.indoors = false;
      this.insideBuilding = null;
      this.state = 'idle';
      this.group.visible = true;
      // Arrived at an open-air spot: stay a while before the next decision.
      this.replanT = 20 + this.rng.float(0, 40);
    }
    // A stroll ends where it lands; schedule the next one instead of
    // wanting "leisure" for the rest of the day.
    if (goal === 'leisure') this.strollTimer = 90 + this.rng.float(0, 180);
    if (system && this.tripBegan != null) {
      system.tripTimes.push(system.time - this.tripBegan);
      if (system.tripTimes.length > 60) system.tripTimes.shift();
      system.tripCompletions++;
      this.tripBegan = null;
    }
  }

  beginChat(other) {
    // A citizen with a trip in hand keeps it: wiping their waypoints used to
    // strand them outdoors under a stale goal, invisible to the plan loop.
    if (other.indoors || (other.points.length > 0 && other.idx < other.points.length)) return false;
    this.chatWith = other;
    this.chatTimer = 3 + this.p.chattiness * 6;
    this.state = 'chatting';
    other.chatWith = this;
    other.chatTimer = 3 + other.p.chattiness * 6;
    other.state = 'chatting';
    other.points = [];
    this.rig.bubble.visible = true;
    other.rig.bubble.visible = true;
    if (this.rng.chance(0.35)) {
      events.emit('log', { text: `${this.p.name} and ${other.p.name} stop for a chat.` });
    }
    return true;
  }

  endChat() {
    if (this.chatWith) {
      const o = this.chatWith;
      o.chatWith = null;
      o.chatTimer = 0;
      o.state = 'idle';
      o.rig.bubble.visible = false;
    }
    this.chatWith = null;
    this.chatTimer = 0;
    this.rig.bubble.visible = false;
    this.state = 'idle';
  }

  syncProfile(clock) {
    const p = this.p;
    if (!p) return;
    // Labels are derived from one stable place-state each tick. "On the move"
    // is reserved for an actual trip: a pause at a kerb must not reschedule
    // the citizen back to "Work" and flicker the panel.
    if (this.indoors) {
      p.activity = scheduleAt(p.schedule, clock.hour);
    } else if (this.state === 'chatting') {
      p.activity = 'Talking with a neighbour';
    } else if (this.state === 'waiting-crossing' && this.crossWaitT > 1.5) {
      // A brief kerb pause is still part of the trip; only a real wait is news.
      p.activity = 'Waiting to cross';
    } else if (this.state === 'walking' || this.state === 'waiting-crossing') {
      p.activity = 'On the move';
    } else {
      p.activity = 'Out and about';
    }
    p.location = {
      place: this.indoors
        ? this.buildingLabel(this.insideBuilding)
        : this.routeGoalKey || 'outdoors',
      x: Math.round(this.group.position.x * 10) / 10,
      z: Math.round(this.group.position.z * 10) / 10
    };
  }

  update(dt, clock, system) {
    this.syncProfile(clock);
    if (this.vehicle) {
      if (this.driving) {
        this.group.position.copy(this.vehicle.group.position);
        this.indoors = false;
        this.insideBuilding = null;
        this.state = 'driving';
        this.p.activity = 'Driving';
        this.p.location = { place: 'vehicle', detail: this.vehicle.trip?.purpose || 'travel' };
      }
      this.group.visible = false;
      return;
    }
    if (this.routeVersion !== this.town.roadGraphVersion && this.routeCells?.length) {
      this.routeVersion = this.town.roadGraphVersion;
      if (!this.routeCells.every(([x, y]) => this.town.grid.isRoad(x, y))) {
        if (!this.target || !this.planRoute(this.target)) { this.points = []; this.idx = 0; }
      }
    }
    // Phase 15 — `moodTarget` is a live bias on the mood a citizen settles
    // toward, read here where the mood is derived. The trait drifts
    // (moodDrift/patienceDrift) happen once a day in CitizenSystem.policyTick.
    const baseMood = moodFrom(this.p, this.state, system && system.stress ? system.stress.overall : 0) + (system?.moodTarget || 0);
    const civicMood = this.p.mood?.overall;
    this.mood = Math.max(0, Math.min(1, Number.isFinite(civicMood) ? baseMood * 0.45 + civicMood * 0.55 : baseMood));
    this.strollTimer -= dt * (1 + this.p.traits.openness);
    // Occupancy is the only thing that decides visibility: an indoor citizen
    // is hidden no matter what they want or how their trip is going.
    this.group.visible = !this.indoors;

    const ground = this.town.grid.heightAtWorld(
      this.group.position.x,
      this.group.position.z
    );
    this.groundY += (ground - this.groundY) * Math.min(1, dt * 6);

    if (this.state === 'chatting') {
      this.chatTimer -= dt;
      if (this.chatTimer <= 0) this.endChat();
      if (this.chatWith) {
        const other = this.chatWith.group.position;
        const want = Math.atan2(other.x - this.group.position.x, other.z - this.group.position.z);
        let d = want - this.group.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.group.rotation.y += d * Math.min(1, dt * 5);
        animateWalk(this.rig, this.phase, 0, false, this.groundY);
      }
      return;
    }

    if (this.replanT > 0) this.replanT -= dt;

    const desire = this.desiredKey(clock);
    let moving = this.points.length > 0 && this.idx < this.points.length;
    if (moving && this.state === 'idle') this.state = 'walking';

    // A changed want abandons the walk in progress. A citizen told to go
    // home at 22:00 must not keep heading for work for ever, and a trip that
    // never finishes is exactly what a crowded crossing produces. Never
    // break off inside the junction: finish the road, then change course.
    if (desire.kind !== this.routeGoalKey && this.routeGoalKey && moving && !this.inCrossing) {
      this.points = [];
      this.idx = 0;
      moving = false;
      if (this.state === 'walking' || this.state === 'waiting-crossing') this.state = 'idle';
      // The walk was given up before it arrived: a citizen sent home at 22:00
      // abandoning a trip to work is not a trip to work that happened.
      this.abandonTrip(system);
    }

    if (desire.kind !== this.routeGoalKey && !moving && this.replanT <= 0) {
      this.routeGoalKey = desire.kind;
      const target = this.resolveTarget(desire.kind);
      if (target && this.indoors && this.targetBuilding === this.insideBuilding) {
        // The want points at the building we are already in: stay indoors.
        this.targetBuilding = null;
        this.target = null;
        this.abandonTrip(system);
      } else if (target) {
        this.target = target;
        const wasIndoors = this.indoors;
        const prevBuilding = this.insideBuilding;
        // A trip starts at the front door, never at the interior point.
        if (wasIndoors) this.exitBuilding();
        if (this.planRoute(target)) {
          this.state = 'walking';
          if (system) {
            // A start closes whatever walk was still open, so one trip is
            // never counted under two headings (P-D03).
            this.abandonTrip(system);
            system.trips[desire.key] = (system.trips[desire.key] || 0) + 1;
            system.tripStarts++;
            this.tripBegan = system.time;
          }
        } else if (wasIndoors) {
          // No way out right now: step back inside and retry shortly rather
          // than loitering on the doorstep.
          this.enterBuilding(prevBuilding);
          this.routeGoalKey = null;
          this.replanT = 2;
          this.abandonTrip(system);
        } else {
          // No route from here right now. Forgetting the goal lets us try
          // again shortly instead of standing in the street until dawn.
          this.routeGoalKey = null;
          this.replanT = 1.5;
          this.state = 'idle';
          this.abandonTrip(system);
        }
      }
    }

    // The plan above may have just filled `points`; refresh so a fresh trip
    // is not immediately demoted back to idle by the block below.
    moving = this.points.length > 0 && this.idx < this.points.length;

    if (!moving) {
      if (this.state === 'walking') this.state = 'idle';
      animateWalk(this.rig, this.phase, 0, false, this.groundY);
      if (this.indoors) return;
      this.tryChat(system, dt);
      return;
    }

    const target = this.points[this.idx];
    tmp.set(target.x - this.group.position.x, 0, target.z - this.group.position.z);
    const dist = tmp.length();
    const last = this.idx >= this.points.length - 1;
    // The door step is generous on purpose: a parked car on the threshold
    // must not keep a citizen from ever finishing the trip.
    if (dist < (last ? 1.1 : 0.4)) {
      this.idx++;
      if (this.idx >= this.points.length) {
        this.arrive(system);
        animateWalk(this.rig, this.phase, 0, false, this.groundY);
        return;
      }
    }
    tmp.normalize();

    if (target.crossingCell) {
      if (!this.inCrossing && !this.crossingSafe(target)) {
        // Hold the step but not the label: crossing safety is re-evaluated
        // every frame, and a single flicker used to flap the activity line
        // between "On the move" and a scheduled task once per second.
        this.crossWaitT += dt;
        this.speed = 0;
        this.makeWay(dt);
        animateWalk(this.rig, this.phase, 0, false, this.groundY);
        if (this.crossWaitT > 0.4) this.state = 'waiting-crossing';
        return;
      }
      this.inCrossing = true;
      this.crossWaitT = 0;
      this.state = 'walking';
    } else if (this.inCrossing) {
      this.inCrossing = false;
      this.crossWaitT = 0;
    }

    const base = SIM.walkSpeed.min + (SIM.walkSpeed.max - SIM.walkSpeed.min) * ((this.p.pace - 0.8) / 0.6);
    this.speed += (base - this.speed) * Math.min(1, dt * 4);
    const step = Math.min(this.speed * dt, dist + 0.01);

    let mx = tmp.x;
    let mz = tmp.z;
    let detoured = false;
    if (this.vehicleBlocked(this.group.position.x + mx * step, this.group.position.z + mz * step)) {
      const around = this.pavementDetour(mx, mz, step, this.inCrossing ? target.crossingCell : null);
      if (around) {
        mx = around[0];
        mz = around[1];
        detoured = true;
        this.blockT = 0;
      } else {
      this.blockT += dt;
      this.speed = 0;
      this.makeWay(dt);
      // Still on the pavement: we have not entered the road, so traffic
      // must not keep yielding to us while a body blocks our way.
      if (this.inCrossing && !this.town.grid.isCarriageway(this.group.position.x, this.group.position.z)) {
        this.inCrossing = false;
        this.state = 'waiting-crossing';
      }
      animateWalk(this.rig, this.phase, 0, false, this.groundY);
      // Wedged on the doorstep of the destination: go through the door rather
      // than shuffling on the step for ever.
      if (this.targetBuilding && this.idx >= this.points.length - 1 && this.blockT > 2.5) {
        this.arrive(system);
        return;
      }
      // A parked obstruction can change while we wait. Rebuilding the same
      // legal pavement route is safe; walking through or around the body is not.
      if (this.blockT > 4 && this.target) {
        this.planRoute(this.target);
        this.blockT = 0;
      }
      return;
      }
    } else {
      this.blockT = 0;
    }

    this.group.position.x += mx * step;
    this.group.position.z += mz * step;

    if (detoured && this.inCrossing && target.crossingCell) {
      const c = this.town.grid.worldToCell(this.group.position.x, this.group.position.z);
      if (`${c.x},${c.y}` !== target.crossingCell && this.town.grid.roadDegree(c.x, c.y) < 3) {
        // A local avoidance step may retreat to the kerb. Rebuild from that
        // safe pavement position so crossingSafe() arbitrates the next entry.
        // Only a detour counts: a committed walker is normally still in the
        // approach cell for most of the leg, and treating that as a retreat
        // cancelled every crossing one step in and replanned for ever.
        this.inCrossing = false;
        if (this.target) this.planRoute(this.target);
      }
    }

    const want = Math.atan2(mx, mz);
    let d = want - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * Math.min(1, dt * 7);

    this.phase += dt * this.speed * 3.1;
    animateWalk(this.rig, this.phase, this.speed / 1.8, true, this.groundY);

    this.tryChat(system, dt);
  }

  /** Would this footprint land inside a vehicle? Bumper box, yaw and all. */
  vehicleBlocked(x, z) {
    const list = this.town.traffic?.vehicles;
    if (!list || !list.length) return false;
    for (const v of list) {
      const dx = x - v.group.position.x;
      const dz = z - v.group.position.z;
      if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
      const yaw = v.group.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const margin = 0.28;
      const halfW = v.spec.width * 0.5 + margin;
      const halfL = v.spec.length * 0.5 + margin;
      // Courtesy: a vehicle that has already waited for people gets a clear
      // zone in front of its nose that walkers may not ENTER, so a stream of
      // them cannot starve it. Anyone already inside may carry on.
      const courtesy = (v.pedWaitT || 0) > 2;
      const front = courtesy ? 1.6 : 0;
      const side = courtesy ? 0.9 : 0;
      const inBody = (ax, az) => Math.abs(ax) < halfW && Math.abs(az) < halfL;
      const inZone = (ax, az) => Math.abs(ax) < halfW + side && az > -halfL - side && az < halfL + front;
      if (inZone(lx, lz)) {
        const oldDx = this.group.position.x - v.group.position.x;
        const oldDz = this.group.position.z - v.group.position.z;
        const oldLx = oldDx * c - oldDz * s;
        const oldLz = oldDx * s + oldDz * c;
        // Inside the courtesy zone: only moves that back away from the vehicle.
        if (!inBody(lx, lz) && inZone(oldLx, oldLz) && Math.hypot(dx, dz) > Math.hypot(oldDx, oldDz) + 0.0001) continue;
        // Already touching the body: only steps that increase separation.
        if (inBody(oldLx, oldLz) && Math.hypot(dx, dz) > Math.hypot(oldDx, oldDz) + 0.0001) continue;
        return true;
      }
    }
    return false;
  }

  pavementDetour(mx, mz, step, crossingCell = null) {
    const crossing = crossingCell ? crossingCell.split(',').map(Number) : null;
    for (const angle of [0.45, -0.45, 0.8, -0.8, 1.1, -1.1, 2.2, -2.2, Math.PI]) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const dx = mx * c - mz * s;
      const dz = mx * s + mz * c;
      const x = this.group.position.x + dx * step;
      const z = this.group.position.z + dz * step;
      const cell = this.town.grid.worldToCell(x, z);
      if (crossing) {
        const stillCrossing = cell.x === crossing[0] && cell.y === crossing[1];
        if (stillCrossing && !this.vehicleBlocked(x, z)) return [dx, dz];
      }
      if (this.town.grid.isRoad(cell.x, cell.y)) {
        const center = this.town.grid.cellToWorld(cell.x, cell.y);
        const lx = Math.abs(x - center.x);
        const lz = Math.abs(z - center.z);
        const mask = this.town.grid.roadAt(cell.x, cell.y);
        const vertical = !!(mask & 1) || !!(mask & 4);
        const horizontal = !!(mask & 2) || !!(mask & 8);
        const onPavement =
          (vertical && !horizontal && lx >= 1.5) ||
          (horizontal && !vertical && lz >= 1.5) ||
          (vertical && horizontal && Math.max(lx, lz) >= 1.5);
        if (!onPavement) continue;
      }
      if (!this.vehicleBlocked(x, z)) return [dx, dz];
    }
    return null;
  }

  /**
   * A vehicle that has been waiting on us gets room: step along the pavement
   * (never into the carriageway) away from it. Returns true if we moved.
   */
  makeWay(dt) {
    const pos = this.group.position;
    let v = null;
    for (const o of this.town.traffic?.vehicles || []) {
      if (o.collisionBlocker?.agent === this && (o.pedWaitT || 0) > 1.5) {
        v = o;
        break;
      }
    }
    if (!v) return false;
    const grid = this.town.grid;
    const step = 1.3 * dt;
    const d0 = Math.hypot(pos.x - v.group.position.x, pos.z - v.group.position.z);
    let best = null;
    let gain = 0.0005;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = pos.x + dx * step;
      const z = pos.z + dz * step;
      if (grid.isCarriageway(x, z, 1.4) && !grid.isCarriageway(pos.x, pos.z, 1.4)) continue;
      const c = grid.worldToCell(x, z);
      if (!grid.isRoad(c.x, c.y)) continue;
      if (this.vehicleBlocked(x, z)) continue;
      const g = Math.hypot(x - v.group.position.x, z - v.group.position.z) - d0;
      if (g > gain) {
        gain = g;
        best = [x, z];
      }
    }
    if (!best) return false;
    pos.x = best[0];
    pos.z = best[1];
    return true;
  }

  crossingSafe(target) {
    const [cx, cy] = target.crossingCell.split(',').map(Number);
    const grid = this.town.grid;
    const center = grid.cellToWorld(cx, cy);
    const signal = this.town.roadKit?.signals?.at(cx, cy);
    if (signal) {
      const dx = target.x - this.group.position.x;
      const dz = target.z - this.group.position.z;
      const crossingAxis = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
      const trafficAxis = crossingAxis === 'x' ? 'z' : 'x';
      if (this.town.roadKit.signals.stateFor(signal.group, trafficAxis) !== 'red') return false;
    }
    // A rolling vehicle committed to the junction still wins - a phase only
    // holds the arms that observe it. Everything else is not our problem: a
    // car already past, one parked at the kerb, or one that has been waiting
    // for us must not hold the crossing, or walker and driver wait on each
    // other for ever.
    const reach = signal ? 3.6 : 7;
    for (const v of this.town.traffic?.vehicles || []) {
      if (v.parkTimer > 0 || v.docking || v.speed <= 0.35) continue;
      const dx = center.x - v.group.position.x;
      const dz = center.z - v.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const fx = Math.sin(v.group.rotation.y);
      const fz = Math.cos(v.group.rotation.y);
      const along = dx * fx + dz * fz;
      if (along < -0.5) continue;
      if (signal || along / Math.max(v.speed, 1) < 2.5) return false;
    }
    return true;
  }

  tryChat(system, dt) {
    // Social stops are pavement-only. A citizen previously could begin a
    // chat between two route samples while still inside a marked crossing,
    // leaving a correctly yielding vehicle with no way to proceed.
    if (this.indoors || this.inCrossing || (this.points.length > 0 && this.idx < this.points.length) || this.state !== 'idle') return;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.6 + this.rng.float(0, 0.8);
    if (this.p.sociability < 0.45) return;
    if (!this.rng.chance(this.p.sociability * 0.45)) return;
    const other = system.nearestNeighbor(this, SIM.chatDistance);
    if (!other) return;
    if (other.indoors || other.state === 'walking' || other.state === 'chatting' || other.state === 'waiting-crossing') return;
    if (other.points.length > 0 && other.idx < other.points.length) return;
    if (other.p.sociability < 0.35) return;
    this.beginChat(other);
  }
}

export class CitizenSystem {
  constructor(town) {
    this.town = town;
    this.citizens = [];
    this.households = [];
    this.group = new THREE.Group();
    this.group.name = 'citizens';
    this.rng = town.rng.fork(29);
    // P-E03: per-agent timers and chat rolls run on their own stream so they
    // never shuffle the family/work assignments the system stream is about to
    // make. Generation stays bit-identical; only the walking decisions move.
    this.agentRng = town.rng.fork(2903);
    this.time = 0;
    this.trips = {};
    this.tripTimes = [];
    // P-D03 — pedestrian trip counters, kept apart from the per-purpose map.
    this.tripStarts = 0;
    this.tripCompletions = 0;
    this.tripCancellations = 0;
    // Last clock seen. Headless callers (checks, tools) advance traffic
    // without one; those still get a coherent day/hour rather than a crash.
    this.clock = { day: 1, hour: 7.5 };
    // Resource pressure felt by every citizen (mood, needs, illness) —
    // recomputed at most twice a second of wall time.
    this.stress = null;
    this.stressAcc = 99;
    // Phase 15 — written only by PolicySystem; zero here because a new town
    // carries no statutes.
    this.moodDrift = 0;
    this.moodTarget = 0;
    this.patienceDrift = 0;
    this.policyDay = null;
  }

  tripStats() {
    const total = Object.values(this.trips).reduce((s, n) => s + n, 0);
    const avg = this.tripTimes.length
      ? this.tripTimes.reduce((a, b) => a + b, 0) / this.tripTimes.length
      : 0;
    return {
      total,
      mode: 'walk',
      trips: { ...this.trips },
      // P-D03: starts, completions and cancellations are separate counts, so a
      // walk given up half way can never be read as one that arrived.
      starts: this.tripStarts,
      completions: this.tripCompletions,
      cancellations: this.tripCancellations,
      avgTripMin: Math.round((avg / SIM.secondsPerGameMinute) * 10) / 10
    };
  }

  assignWork(agent) {
    const workKind = agent.p.job.work;
    if (workKind === 'farm' || workKind === 'power' || workKind === 'fuel')
      agent.work = this.town.resources?.workplace(workKind) || null;
    else if (workKind === 'shop') agent.work = this.pickGapBuilding(['shop', 'office'], agent);
    else if (workKind === 'office') agent.work = this.pickGapBuilding(['office'], agent);
    // Civic credentials belong at a public facility. Falling back to a shop
    // made teachers and nurses appear employed while every school or clinic
    // still showed an open post, so the council could never close the civic
    // staffing gap it was shown.
    else if (workKind === 'civic') agent.work = this.pickGapBuilding(['civic'], agent);
    else if (workKind === 'park') agent.work = this.pickGapBuilding(['park'], agent);
    else if (workKind === 'industry') agent.work = this.pickGapBuilding(['factory'], agent);
    else agent.work = null;
    agent.p.employmentStatus = agent.work ? 'employed' :
      (agent.p.age < 18 || agent.p.age >= 66 || agent.p.job.id === 'retired' ? 'not_in_labor_force' : 'unemployed');
    agent.routeGoalKey = null;
    return agent.work;
  }

  /**
   * Place a worker toward the LARGEST staffing gap (C1): count who already
   * stands at each candidate, rank `staffNeeded − placed`, and take the worst
   * short — ties break by rng. Never a uniform random building: a new hire
   * lands where the crew is thinnest, and once everything is full the least
   * loaded still wins (all gaps ≤ 0, the max is the least negative).
   */
  pickGapBuilding(kinds, agent) {
    const list = this.town.buildings.filter((b) => kinds.includes(b.kind));
    if (!list.length) return null;
    const eco = this.town.economy;
    const needOf = (b) => (eco && eco.staffNeeded ? eco.staffNeeded(b) : 4);
    const placed = new Map();
    for (const c of this.citizens) {
      // Only someone who can actually hold a post counts against a gap — a
      // child spawned beside a shop is not crew.
      if (c === agent || !c.work) continue;
      if (c.p.age < 18 || c.p.age >= 66 || c.p.job?.id === 'retired') continue;
      placed.set(c.work, (placed.get(c.work) || 0) + 1);
    }
    let best = [];
    let bestGap = -Infinity;
    for (const b of list) {
      const gap = needOf(b) - (placed.get(b) || 0);
      if (gap > bestGap) {
        bestGap = gap;
        best = [b];
      } else if (gap === bestGap) best.push(b);
    }
    if (bestGap <= 0) return null;
    return best[Math.floor(this.town.rng.next() * best.length)];
  }

  /**
   * Move a citizen into a home, creating its household if it has none.
   *
   * The capacity check lives HERE, in the one place a citizen joins a
   * household, rather than in each of the three callers. `giveBirth` and
   * `immigrate` both enforce it; `moveToHome` did not, so partnership — the
   * third path — was the one that could overfill a house. A 5-bed home reached
   * 6 and then 7 members and never recovered, because nothing would ever empty
   * it. The town-wide total check did not see it either:
   * `totalResidentialCapacity` sums raw fractional capacities, so the band never
   * looked at any individual house.
   *
   * `floor` because capacity is `HOUSEHOLD.avgSize × floors` and carries a
   * fractional part nobody can sleep in.
   */
  moveToHome(agent, building) {
    if (!building || agent.home === building) return;
    const capacity = Math.floor(building.capacity || 2);
    const existing = building.household;
    const alreadyIn = existing?.members?.includes(agent);
    if (!alreadyIn && (existing?.members?.length || 0) >= capacity) return false;
    const old = agent.home;
    if (old && old.household) {
      old.household.members = old.household.members.filter((m) => m !== agent);
      old.household.size = old.household.members.length;
      if (old.household.members.length === 0) old.household = null;
    }
    agent.home = building;
    if (!building.household) {
      const surname = agent.p.last || agent.p.surname || pickSurname(this.rng);
      const household = { id: this.town.nextEntityId('household'), surname, home: building, members: [], size: 0 };
      building.household = household;
      this.households.push(household);
    }
    const h = building.household;
    if (!h.members.includes(agent)) h.members.push(agent);
    h.size = h.members.length;
    agent.household = h;
    agent.routeGoalKey = null;
    agent.enterBuilding(building);
    return true;
  }

  /**
   * Drop a household once its last member has gone.
   *
   * Shared by every path a person can leave — death, emigration, and the generic
   * `remove`. Emigration only filtered the departing member and left the empty
   * household registered with its building still pointing at it, so the HUD's
   * household count, `traffic`'s `households.length * 0.6` demand estimate and
   * the economy's property accounting all kept counting a household with nobody
   * in it. It stayed bounded only because `vacantHomes` re-adopted the husk.
   */
  releaseHousehold(household) {
    if (!household) return false;
    this.town.buildings.forEach((b) => {
      if (b.household === household) b.household = null;
    });
    this.households = this.households.filter((x) => x !== household);
    return true;
  }

  addCitizen(personality, home) {
    if (this.citizens.length >= SIM.maxCitizens) return null;
    if (!home) return null;
    const rig = buildCitizen(personality);
    const agent = new CitizenAgent(this.town, rig, personality, home);
    this.assignWork(agent);

    rig.group.rotation.y = (this.agentRng || this.rng).float(0, Math.PI * 2);
    agent.enterBuilding(home);
    rig.group.userData.pick = {
      type: 'citizen',
      title: personality.name,
      agent
    };
    this.group.add(rig.group);
    this.citizens.push(agent);
    this.town.pickables.push(rig.group);
    if (home.household && !agent.household) {
      agent.household = home.household;
      home.household.members.push(agent);
      home.household.size = home.household.members.length;
    }
    return agent;
  }

  dropHome(building) {
    this.households = this.households.filter((h) => h.home !== building);
    for (const c of this.citizens) if (c.home === building) c.household = null;
  }

  linkHousehold(members) {
    const adults = members.filter((m) => m.p.age >= 18);
    if (adults.length >= 2 && Math.abs(adults[0].p.age - adults[1].p.age) < 14) {
      adults[0].p.relationships.partner = adults[1].p.name;
      adults[1].p.relationships.partner = adults[0].p.name;
    }
    const parents = adults.slice(0, 2);
    for (const child of members) {
      if (child.p.age >= 18) continue;
      child.p.relationships.parents = parents.map((a) => a.p.id);
      for (const a of parents) a.p.relationships.children.push(child.p.id);
    }
  }

  spawnFamilies(popCap = FOUNDING_POPULATION) {
    const homes = this.town.buildings.filter((b) => b.kind === 'house');
    this.households = [];
    // Founding crew first: connected work sites need hands on day one, and
    // with zero spare beds no crew can move in afterwards — so the crew is
    // drawn from the founding population itself. One crew member heads each of
    // the first houses (a pinned job bumps its own credential, so schooling
    // never blocks); the rest of each household fills in around them. Crew
    // beyond the house count cannot be housed and is dropped — beds are exact.
    const res = this.town.resources;
    const crewJobs = [];
    if (res) {
      for (const s of res.sites || []) {
        if (!s.work || !s.connected) continue;
        const need = res.siteCrew ? res.siteCrew(s) : 0;
        const job = jobById(SITE_CREW[s.work]?.job);
        for (let i = 0; i < need && job; i++) crewJobs.push(job);
      }
    }
    let crewIdx = 0;
    for (const home of homes) {
      if (this.citizens.length >= SIM.maxCitizens) break;
      if (this.citizens.length >= popCap) break;
      const surname = pickSurname(this.rng);
      // Founding rule — just sufficient housing, no extra: every house is
      // filled to its rated capacity, so beds equal population from day one
      // (no empty houses, zero homelessness). Residential capacity is three
      // residents per tiled footprint per floor, and a partial place cannot move in — so the size
      // is floored and members never exceed capacity. The founding pipeline
      // pairs this with even-floor houses (whole beds), so the cap binds
      // exactly at popCap with zero usable spare. Later growth (births,
      // move-ins, crew hires) must earn its beds by building.
      const size = Math.min(
        Math.floor(home.capacity || 4),
        SIM.maxCitizens - this.citizens.length,
        popCap - this.citizens.length
      );
      if (size <= 0) break;
      const members = [];
      let start = 0;
      if (crewIdx < crewJobs.length && size >= 1) {
        const p = createProfile(this.rng, {
          surname,
          age: this.rng.int(24, 52),
          job: crewJobs[crewIdx]
        });
        const agent = this.addCitizen(p, home);
        if (agent) {
          members.push(agent);
          start = 1;
          crewIdx++;
        }
      }
      for (let i = start; i < size; i++) {
        const age = familyAge(this.rng, i, size);
        const p = createProfile(this.rng, { surname, age });
        const agent = this.addCitizen(p, home);
        if (!agent) break;
        members.push(agent);
      }
      if (!members.length) continue;
      const household = { id: this.town.nextEntityId('household'), surname, home, members, size: members.length };
      home.household = household;
      for (const m of members) m.household = household;
      this.linkHousehold(members);
      this.households.push(household);
    }
    this.staffWorkforce();
  }

  /**
   * Farms and power stations need crews. The job roll alone will not reliably
   * land enough of them, so top every sited workplace up to its crew size —
   * but never by shuffling a townsfolk out of their own job (the user rule):
   * take an UNPLACED local whose schooling covers the role, else hire a
   * newcomer through the same door `governance.hire()` uses.
   */
  staffWorkforce() {
    const resources = this.town.resources;
    if (!resources) return;
    const want = Object.values(SITE_CREW);
    for (const w of want) {
      const sites = resources.sites.filter((s) => s.work === w.work && s.connected);
      if (!sites.length) continue;
      // Tier-aware: a ranch needs more hands than a paddock, so the target is
      // the sum of each site's own crew, not sites × the flat rate.
      const target = sites.reduce((n, s) => n + (resources.siteCrew ? resources.siteCrew(s) : w.crew), 0);
      let have = this.citizens.filter((c) => c.p.job.work === w.work).length;
      let guard = 0;
      while (have < target && guard++ < 50) {
        // A jobless local (adult student — the codebase's jobless) whose
        // schooling covers the role; a placed worker is never touched.
        const recruit = this.citizens.find(
          (c) =>
            c.p.age >= 18 &&
            c.p.age < 66 &&
            c.p.job.id === 'student' &&
            qualifies(c.p.education?.level, w.job)
        );
        if (recruit) {
          if (!setJob(recruit.p, w.job, this.rng)) break;
          this.assignWork(recruit);
          have++;
        } else {
          const job = jobById(w.job);
          if (!job || !this.town.lifecycle?.immigrate?.({ job })) break;
          have++;
        }
      }
    }
  }

  /**
   * Add a citizen outright. This is the player's "+ Citizen" tool, and the
   * founding path's neighbour.
   *
   * The arrival is announced to the economy, exactly as `lifecycle.immigrate`
   * does. Without that, `createProfile` set an opening balance straight onto
   * `p.cash` and nothing ever issued it: the money was on the roster but not in
   * the ledger, so it was conjured rather than funded. It took an audit check
   * comparing household cash against the conservation memo to find — the
   * household's wallet grew by the opening balance on every press of the
   * button, and only surfaced when the population got large enough for the
   * memo and the roster to be compared.
   */
  spawn(count = 1) {
    const homes = this.town.buildings.filter((b) => b.kind === 'house');
    if (homes.length === 0) return null;
    let last = null;
    for (let i = 0; i < count; i++) {
      const personality = createProfile(this.rng, {});
      const home = this.rng.pick(homes);
      const agent = this.addCitizen(personality, home);
      if (!agent) break;
      // The opening balance is re-issued from outside the town through the
      // ledger, so it is funded rather than created.
      this.town.economy?.recordMigration(agent, 'in');
      last = agent;
    }
    return last;
  }

  nearestNeighbor(agent, radius) {
    let best = null;
    let bd = radius * radius;
    const p = agent.group.position;
    for (const o of this.citizens) {
      if (o === agent) continue;
      if (!o.rig.group.visible) continue;
      const dx = o.group.position.x - p.x;
      const dz = o.group.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * P-E04 — pedestrians share the traffic micro-step. `beginFrame` only
   * records the frame's clock; every clock advance happens inside `step`, so
   * the total simulated pedestrian time is the sum of the micro-steps and is
   * unchanged when the renderer hands over a different frame size.
   */
  beginFrame(dt, clock) {
    void dt;
    if (clock) this.clock = clock;
  }

  /** One fixed micro-step, interleaved with the vehicle micro-steps. */
  step(stepDt, clock) {
    const clk = clock || this.clock;
    this.time += stepDt;
    this.stressAcc += stepDt;
    if (this.stressAcc >= 0.5) {
      this.stressAcc = 0;
      this.stress = this.town.resources && this.town.resources.stats
        ? resourceStress(this.town.resources.stats())
        : null;
      // Empty shelves worry citizens too — goods shortages join the mix
      // (harmless no-op while the storehouse is stocked: gs === 0).
      const gs = this.town.industry ? this.town.industry.goodsStress() : 0;
      if (this.stress && gs > 0) {
        this.stress = {
          ...this.stress,
          goods: gs,
          overall: Math.min(1, this.stress.overall * 0.75 + gs * 0.25)
        };
      }
    }
    for (const c of this.citizens) c.update(stepDt, clk, this);
    if (clk && clk.day !== this.policyDay) {
      this.policyDay = clk.day;
      this.policyTick();
    }
  }

  /**
   * End of the rendered frame. Pedestrians keep no per-frame state, so this is
   * a seam rather than a workload — it exists so the shared step has a defined
   * bookkeeping point on both sides of the micro-step loop.
   */
  endFrame() {}

  update(dt, clock) {
    this.beginFrame(dt, clock);
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) this.step(stepDt, clock);
    this.endFrame();
  }

  /**
   * Phase 15 — a scheme's `moodDrift` / `patienceDrift` nudge the underlying
   * traits once a day, exactly like HOST_EVENT's optimism lift: the effect
   * persists in the citizens themselves, so it is still felt after the scheme
   * ends (the town remembers a good summer). `moodTarget` is deliberately NOT
   * applied here — it is a live bias on the derived mood, read at recompute.
   */
  policyTick() {
    const dMood = this.moodDrift || 0;
    const dPatience = this.patienceDrift || 0;
    if (!dMood && !dPatience) return;
    for (const c of this.citizens) {
      if (dMood) c.p.optimism = Math.max(0, Math.min(1, c.p.optimism + dMood));
      if (dPatience) c.p.patience = Math.max(0, Math.min(1, c.p.patience + dPatience));
    }
  }

  averageMood() {
    if (this.citizens.length === 0) return 0.5;
    let s = 0;
    for (const c of this.citizens) s += c.mood;
    return s / this.citizens.length;
  }

  /** Citizens currently outdoors — the ones on the street. */
  outsideCount() {
    let n = 0;
    for (const c of this.citizens) if (!c.indoors) n++;
    return n;
  }

  insideCount() {
    let n = 0;
    for (const c of this.citizens) if (c.indoors) n++;
    return n;
  }

  visibleCount() {
    return this.outsideCount();
  }

  remove(agent) {
    // A citizen can be removed while behind the wheel. Break both halves of
    // that link before the object goes, or the vehicle keeps driving a ghost
    // and the inspector reports an occupant who no longer exists.
    if (agent.driving) agent.driving.cancelTrip('driver-removed');
    if (agent.driving) agent.driving.driverCitizen = null;
    if (agent.vehicle && agent.vehicle.driverCitizen === agent) agent.vehicle.driverCitizen = null;
    agent.driving = null;
    // The vehicle outlives its driver. Take it off the road and hand the asset
    // back to the register, where it goes on sale — it is not destroyed, and it
    // does not go on driving errands with nobody holding its title. This used to
    // leave the car in the traffic pool permanently, which meant every death
    // quietly added an ownerless vehicle to the town's streets.
    const car = agent.vehicle;
    agent.vehicle = null;
    if (car) this.town.traffic?.remove(car);
    if (agent.household) {
      const h = agent.household;
      h.members = h.members.filter((m) => m !== agent);
      h.size = h.members.length;
      // A household whose last member has left is released here too, so the
      // cleanup does not depend on which of the removal paths the caller took.
      if (h.members.length === 0) this.releaseHousehold(h);
      agent.household = null;
    }
    if (agent.chatWith) agent.endChat();
    // Close out the estate: savings stop being the bank's liability, and any
    // wallet cash nobody inherited leaves the town with its owner. Without this
    // the money total silently drops, because a removed citizen's balance stops
    // being counted while `expectedMoney` still expects it. Normally a no-op,
    // since `inherit` has already settled the estate by this point.
    this.town.economy?.settleEstate(agent.p, 'citizen-removed');
    const i = this.citizens.indexOf(agent);
    if (i >= 0) this.citizens.splice(i, 1);
    this.town.removePickable(agent.group);
    this.group.remove(agent.group);
    // Dispose. `traffic.remove()` has always done this for vehicle rigs;
    // pedestrians did not, so every citizen removal — which `clear()` does for
    // the whole population on every reset — orphaned its geometry. Measured:
    // +57 `renderer.info.memory.geometries` per regeneration, growing perfectly
    // linearly, while the scene-graph node count stayed FLAT. The buffers belong
    // to nothing in the scene and Three.js only decrements the counter on
    // `dispose()`, so they are unreclaimable without losing the GL context.
    disposeObject(agent.group);
  }

  clear() {
    for (const c of this.citizens.slice()) this.remove(c);
    this.citizens.length = 0;
    this.households.length = 0;
    this.trips = {};
    this.tripTimes.length = 0;
    this.tripStarts = 0;
    this.tripCompletions = 0;
    this.tripCancellations = 0;
    this.time = 0;
  }
}

export { randomWalkableCell };
