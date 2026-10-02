import * as THREE from 'three';
import { CELL, CELL_KIND, SIM } from '../core/config.js';
import { findPath, randomWalkableCell } from '../core/pathfinding.js';
import { buildVehicle, CIVILIAN_VEHICLE_TYPES, vehicleFootprint, typeLabel, setBeaconState } from '../kits/vehicles/vehicleKit.js';
import { baseValue } from './vehicleRegistry.js';
import { fleetPlan, fleetSummary } from '../kits/vehicles/fleetKit.js';
import { createPersonality } from '../kits/citizens/personality.js';
import { roadRoute, sampleAt, curvatureAt } from './routes.js';
import { events } from '../core/events.js';
import { disposeObject } from '../world/scene.js';

const forwardVec = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
let uidSeq = 0;

// Lane centres are 1.6 m apart, so the lateral margin must stay small or two
// wide vehicles in opposing lanes "collide" while passing.
const COLLISION_MARGIN = 0.1;
const COLLISION_MARGIN_LAT = 0.03;

/** Exact-enough 2D SAT for the yaw-only vehicle boxes used by the sim. */
function vehicleBoxesOverlap(a, ax, az, ayaw, b, margin = COLLISION_MARGIN, marginLat = COLLISION_MARGIN_LAT) {
  const bx = b.group.position.x;
  const bz = b.group.position.z;
  const byaw = b.group.rotation.y;
  const dx = bx - ax;
  const dz = bz - az;
  const afx = Math.sin(ayaw);
  const afz = Math.cos(ayaw);
  const arx = -afz;
  const arz = afx;
  const bfx = Math.sin(byaw);
  const bfz = Math.cos(byaw);
  const brx = -bfz;
  const brz = bfx;
  const ahl = a.spec.length * 0.5 + margin;
  const ahw = a.spec.width * 0.5 + marginLat;
  const bhl = b.spec.length * 0.5 + margin;
  const bhw = b.spec.width * 0.5 + marginLat;
  for (const [ux, uz] of [[afx, afz], [arx, arz], [bfx, bfz], [brx, brz]]) {
    const center = Math.abs(dx * ux + dz * uz);
    const ra = ahl * Math.abs(afx * ux + afz * uz) + ahw * Math.abs(arx * ux + arz * uz);
    const rb = bhl * Math.abs(bfx * ux + bfz * uz) + bhw * Math.abs(brx * ux + brz * uz);
    if (center >= ra + rb) return false;
  }
  return true;
}

function walkableRoad(x, y, grid) {
  return grid.kindAt(x, y) === CELL_KIND.ROAD;
}

/**
 * Congestion window, in simulated seconds. A vehicle counts as delayed only
 * after it has held station this long without covering 0.8 m (INV-T03). The
 * same window feeds `congestion`, `queueLength`, `avgWaitSec` and `delaySec`,
 * so the reported numbers describe one interval rather than an undocumented
 * threshold that differs per metric.
 */
const CONGESTION_WINDOW = 2;

// Road investment is evaluated by the council on a six-hour cadence, while a
// completed trip is recorded only when it actually arrives. The old 120-second
// retention therefore erased nearly every trip before the next road sitting;
// long runs stayed congested but could never reach the planner's evidence
// gate. Keep the high-frequency delay buckets short, but retain OD completions
// in the existing bounded 128-entry history so the extension planner can see
// demand at its own cadence without growing memory without limit.

/** Wait kinds that mean the vehicle is standing in a queue, not just paused. */
const QUEUE_WAIT_KINDS = new Set(['queue', 'junction', 'collision', 'exit', 'dock', 'backing', 'ped']);

/**
 * Wait kinds that are NOT congestion.
 *
 * `sampleRoadDemand` excluded signal, giveway, bay, dock, fuel and ped — the
 * waits that are a red light, a give-way rule, a shortage of kerbside parking or
 * a refuelling stop rather than anything to do with the state of the traffic.
 * `computeCongestion` excluded only signal and giveway, so `bay`, `dock` and
 * `fuel` counted as congestion there — the exact inversion of the module's own
 * rule at the top of this file ("a full car park can never freeze a live lane —
 * congestion must stay a measure of traffic, not of bay scarcity"), and the
 * metric then drives every moving vehicle's target speed. Measured: five cars
 * waiting for a bay, nothing else moving, no collisions, no signals gave
 * congestion 0.556 and slowed the rest of the town by ~31 %.
 *
 * One set, used by both, so the two metrics can never disagree about what the
 * word means.
 */
const NON_CONGESTION_WAITS = new Set(['signal', 'giveway', 'bay', 'dock', 'fuel', 'ped']);

/**
 * Fuel reserve (litres). Below this a vehicle stops starting new legs and
 * heads for a pump; at zero it becomes a stranded vehicle awaiting recovery
 * rather than a dead body parked in a live lane (SRS P-F04).
 */
const FUEL_RESERVE = 6;
/**
 * How long a vehicle waits at a pump that had nothing to give, in seconds of
 * parked time. Long enough for the town's fuel production to have a real chance
 * of arriving, short enough that the fleet does not look frozen.
 */
const FUEL_EMPTY_PATIENCE = 45;

/** Seconds a dry vehicle waits for a normal pump run before forced recovery. */
const STRANDED_RETRY = 120;

/**
 * A vehicle at its destination with no bay in reach may hold the kerb for
 * this long before it drives to a reachable free bay instead (P-D03), and
 * only this many re-searches before it gives up on parking entirely and gets
 * moving again. Both bounds exist so a full car park can never freeze a live
 * lane — congestion must stay a measure of traffic, not of bay scarcity.
 *
 * The wait is a grace period for a bay that is about to free, not a queue:
 * a civilian dwells 4-16 s and an emergency unit 8-20 s, so twelve seconds
 * covers the vehicle that is about to pull out. Anything longer just stands
 * a car in a working lane waiting for a bay it already knows is not there.
 */
const BAY_WAIT_MAX = 12;
const BAY_GIVE_UP = 6;


/** A citizen traffic must respect: on the asphalt, or actively stepping onto a crossing. */
function pedInRoad(p, grid, half = 1.55) {
  if (!p.rig?.group?.visible) return false;
  if (p.inCrossing && p.speed > 0.2) return true;
  return grid.isCarriageway(p.group.position.x, p.group.position.z, half);
}

function streetName(town, rng) {
  const streets = [];
  for (const v of town.roadKit?.cellInfo?.values() || []) {
    if (v?.street && !streets.includes(v.street)) streets.push(v.street);
  }
  if (!streets.length) return 'the high street';
  return streets[rng.int(0, streets.length - 1)];
}

export class VehicleAgent {
  constructor(town, rig, driver) {
    this.uid = ++uidSeq;
    this.town = town;
    this.rig = rig;
    this.group = rig.group;
    this.spec = rig.spec;
    this.driver = driver;
    this.driverCitizen = null;
    this.trip = null;
    this.fuelCapacity = 45;
    this.fuel = 45;
    this.fuelStop = null;
    this.awaitingBay = false;
    this.bayWaitT = 0;
    this.bayHopeful = undefined;
    this.baySearches = 0;
    this.distanceDriven = 0;
    this.points = [];
    this.idx = 0;
    this.speed = 0;
    this.stuckTime = 0;
    this.honked = false;
    this.routeId = 0;
    // Kept as a public diagnostic field. Vehicles never disable avoidance.
    this.ignoreBlocking = false;
    this.type = rig.type;
    this.role = rig.spec.role || 'civilian';
    this.unit = rig.spec.unit || null;
    this.status = 'patrol';
    // Idle ambulance/fire units hold their station bay until a call is both
    // assigned and routable. This avoids a release/reclaim animation for an
    // open incident that the unit cannot reach.
    this.stationHold = false;
    this.stationWakeT = 0;
    this.serviceHold = false;
    this.serviceWakeT = 0;
    this.sirens = false;
    this.lights = false;
    this.cooldown = 0;
    this.sceneT = 0;
    this.incident = null;
    this.lastIncident = null;
    this.beaconT = 0;
    this.beaconMode = 'off';
    this.bluePhase = false;
    this.homeLabel = null;
    this.homeCell = null;
    this.homeKey = null;
    this.homeBuilding = null;
    this.parkTimer = 0;
    this.parkSpace = null;
    this.parkGen = 0;
    this.docking = null;
    this.dockRetryT = 0;
    this.dockSearchT = 0;
    this.postSearches = 0;
    this.errands = [];
    this.errandIdx = 0;
    this.errandKind = null;
    this.waitSignal = false;
    this.nearSignal = false;
    this.routeDestination = null;
    this.rerouteT = 0;
    this.claimedJunction = null;
    this.waitJunction = false;
    this.collisionBlocked = false;
    // Jam handling state (see TrafficSystem.resolveJams).
    this.holdT = 0;
    this.anchor = null;
    this.waits = [];
    this.waitingOn = null;
    this.waitKind = null;
    this.pedWaitT = 0;
    this.backing = null;
    this.giveWay = null;
    this.passVehicle = null;
    this.passT = 0;
    this.yieldCount = 0;
    this.resolveT = 0;
    this.jamLevel = 0;
    this.jamState = null;
    // Parking recovery (P-B01): set when the bay under this vehicle vanished
    // during a rebuild. The vehicle drives off the pad and claims a legal bay
    // again; it never keeps a claim it no longer occupies.
    this.parkingLost = false;
    this.recoveringBay = false;
    this.dockDwell = null;
    // Fuel (P-F04 / P-F06): a dry tank strands the vehicle, and the reason
    // stays readable for reporting instead of being inferred from a stall.
    this.stranded = false;
    this.strandedReason = null;
    this.strandedWaitT = 0;
    // Private trips that never completed are counted, not silently dropped (P-D03).
    this.tripReaches = 0;
    this.nightEligible = ['taxi', 'bus'].includes(rig.type);
    this.bayRefused = false;
  }

  assignErrands(rng) {
    const t = this.town;
    const stops = [];

    if (this.unit === 'Refuse') {
      const homes = t.buildings.filter((b) => b.kind === 'house');
      for (let i = 0; i < Math.min(5, homes.length); i++) {
        stops.push({ cell: homes[(i * 3 + 1) % homes.length].cell, kind: 'work' });
      }
      if (this.homeBuilding) stops.push({ cell: this.homeBuilding.cell, kind: 'home' });
      this.errands = stops;
      this.errandIdx = 0;
      return stops.length > 0;
    }
    if (this.unit === 'Utility') {
      const work = t.buildings.filter((b) => b.kind === 'shop' || b.kind === 'civic');
      for (let i = 0; i < Math.min(4, work.length); i++) {
        stops.push({ cell: work[(i * 2 + 1) % work.length].cell, kind: 'work' });
      }
      if (this.homeBuilding) stops.push({ cell: this.homeBuilding.cell, kind: 'home' });
      this.errands = stops;
      this.errandIdx = 0;
      return stops.length > 0;
    }

    const home = this.homeBuilding || t.pickBuilding(['house'], rng);
    const work = t.pickBuilding(['shop', 'civic'], rng);
    const shop = t.pickBuilding(['shop'], rng);
    const amenity = t.pickBuilding(['civic', 'house'], rng);
    if (home) stops.push({ cell: home.cell, kind: 'home' });
    if (work) stops.push({ cell: work.cell, kind: 'work' });
    if (shop) stops.push({ cell: shop.cell, kind: 'shop' });
    if (amenity && amenity !== home && amenity !== work && amenity !== shop) {
      stops.push({ cell: amenity.cell, kind: 'errand' });
    }
    this.errands = stops;
    this.errandIdx = stops.length ? rng.int(0, stops.length - 1) : 0;
    return stops.length > 0;
  }

  nextErrand(rng) {
    if (this.role === 'civilian' && this.driverCitizen && !this.recoveringBay) return false;

    if (!this.errands || !this.errands.length) {
      if (this.tryDock(rng)) return true;
      return this.planRoute(rng);
    }
    const stop = this.errands[this.errandIdx % this.errands.length];
    this.errandIdx++;
    if (this.planRoute(rng, stop.cell)) {
      this.errandKind = stop.kind;
      return true;
    }
    return this.tryDock(rng) || this.planRoute(rng);
  }

  currentCell() {
    const { x, y } = this.town.grid.worldToCell(this.group.position.x, this.group.position.z);
    if (this.town.grid.isRoad(x, y)) return [x, y];
    return this.town.nearestRoadCell(x, y);
  }

  /** Keep an active trip from visually drifting into an unmarked plot. */
  recoverUnmarkedPosition(rng) {
    const grid = this.town.grid;
    if (this.docking || this.sceneT > 0 || this.parkTimer > 0) return true;
    const here = grid.worldToCell(this.group.position.x, this.group.position.z);
    if (grid.isRoad(here.x, here.y) || (this.town.parking?.at(here.x, here.y) || []).length) return true;
    const road = this.town.nearestRoadCell(here.x, here.y);
    if (!road) return false;
    const pose = this.town.traffic?.spawnPose(road, this.spec);
    const p = pose || (() => {
      const w = grid.cellToWorld(road[0], road[1]);
      return { cell: road, x: w.x, z: w.z, yaw: this.group.rotation.y };
    })();
    this.group.position.set(p.x, grid.heightAtWorld(p.x, p.z), p.z);
    this.group.rotation.set(0, p.yaw, 0);
    this.points = [];
    this.idx = 0;
    this.routeCells = [];
    this.awaitingBay = false;
    this.bayHopeful = undefined;
    this.speed = 0;
    // Preserve the measured destination when it is still known; otherwise the
    // normal next-leg chooser will select a legal road destination.
    this.planRoute(rng, this.routeDestination || null);
    return true;
  }

  planRoute(rng, to = null, opts = {}) {
    const grid = this.town.grid;
    const from = this.currentCell();
    if (!from || !grid.isRoad(from[0], from[1])) return false;
    let dest = to;
    if (to) {
      // RTE-02: an entrance is only feasible when it is reachable from where
      // the vehicle actually stands. A disconnected segment next door is not
      // an entrance, and with no reachable frontage the trip is refused.
      dest = this.town.roadAccessCell
        ? this.town.roadAccessCell(from, to[0], to[1])
        : to;
      if (!dest) return false;
    }
    if (!dest) dest = randomWalkableCell(grid, walkableRoad, rng, from, 12);
    if (!dest) return false;
    if (dest[0] === from[0] && dest[1] === from[1]) return false;
    const occ = this.town.traffic?.occupancyMap(this);
    const avoid = opts.avoid || null;
    const hx = Math.sin(this.group.rotation.y);
    const hz = Math.cos(this.group.rotation.y);
    // Turning back sweeps both lanes; only do it into clear road.
    const uturnCost = this.uTurnClear() ? 12 : 200;
    const path = findPath(grid, from, dest, {
      walkable: walkableRoad,
      // Soft costs: stalled vehicles weigh far more than moving ones, cells
      // of a known jam are strongly avoided, and turning back costs extra.
      // Wider road classes carry more before they cost the same, so routes
      // gain a real class benefit instead of treating every cell alike (P-D02).
      cost: (x, y, g, cx, cy) => {
        const cap = this.classCapacity(x, y, g);
        let c = (1 + (occ?.get(y * g.w + x) || 0)) / cap;
        if (avoid && avoid.has(`${x},${y}`)) c += 60;
        if (cx === from[0] && cy === from[1] && (x - cx) * hx + (y - cy) * hz < -0.5) c += uturnCost;
        return c;
      }
    });
    if (!path || path.length < 2) return false;
    if (opts.strict && avoid && path.some(([x, y]) => avoid.has(`${x},${y}`))) return false;
    const start = this.group.position.clone();
    const routed = this.routeOnRoad(grid, path, start);
    // A route may begin on a house/parking pad. The first transition still
    // has to stay on a marked parking cell or asphalt; silently accepting a
    // spline whose first segment crosses an empty plot is visible as a car
    // cutting across the town. Refuse it and let the normal retry/parking
    // logic find a legal access route.
    if (!routed) return false;
    this.points = routed;
    this.idx = this.points.length > 2 ? 1 : 0;
    this.routeId++;
    this.routeDestination = dest.slice();
    this.routeCells = path;
    this.routeVersion = this.town.roadGraphVersion;
    // Demand is NOT recorded here. A plan is an intention, and an intention that
    // is re-planned, abandoned or never arrives is not traffic. `routeDestination`
    // is kept so a completed trip can be recorded against where it really
    // started — see `recordTripCompleted`.
    this.routeFrom = from.slice();
    this.total = 0;
    this.bayRefused = false;
    return true;
  }

  /**
   * Occupancy capacity of a road class, in units of a local road (1 … 1.8).
   * Wider classes absorb more traffic before a cell starts costing the same as
   * a congested alley — the route benefit of upgrading a road (P-D02).
   */
  classCapacity(x, y, grid) {
    const g = grid || this.town.grid;
    if (!g.inBounds(x, y)) return 1;
    const code = g.roadClass ? g.roadClass[g.idx(x, y)] : 0;
    return 1 + 0.2 * code;
  }

  /**
   * Speed bonus of the road class under the vehicle: a boulevard genuinely
   * moves faster than an alley (P-D02).
   */
  classSpeedBonus(x, y) {
    const g = this.town.grid;
    if (!g.inBounds(x, y)) return 1;
    const code = g.roadClass ? g.roadClass[g.idx(x, y)] : 0;
    return 1 + 0.03 * code;
  }

  /**
   * Lane polyline for `path`. The smoothed spline is preferred while every
   * interior sample still sits on road or a parking cell; a corner-cutting
   * curve that leaves the drivable network falls back to the polyline
   * (SRS P-C04).
   */
  routeOnRoad(grid, path, start) {
    const drivable = (x, y) => grid.isRoad(x, y) || !!(this.town.parking?.at(x, y) || []).length;
    const segmentLegal = (a, b) => {
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(d / (CELL * 0.35)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const c = grid.worldToCell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (!drivable(c.x, c.y)) return false;
      }
      return true;
    };
    const routeLegal = (points) => {
      if (!points.length) return false;
      for (let i = 1; i < points.length; i++) {
        if (!segmentLegal(points[i - 1], points[i])) return false;
      }
      return true;
    };
    const smooth = roadRoute(grid, path, SIM.laneOffset, { start });
    if (smooth.length >= 3) {
      let ok = true;
      for (let i = 1; i < smooth.length; i++) {
        const p = smooth[i];
        const c = grid.worldToCell(p.x, p.z);
        if (grid.isRoad(c.x, c.y)) continue;
        if ((this.town.parking?.at(c.x, c.y) || []).length) continue;
        ok = false;
        break;
      }
      if (ok && routeLegal(smooth)) return smooth;
    }
    const straight = roadRoute(grid, path, SIM.laneOffset, { start, smooth: false });
    return routeLegal(straight) ? straight : null;
  }


  /** Drifted across the centre line (after a turn or bay exit)? Insert a waypoint back in our own lane. */
  snapToLane() {
    const g = this.town.grid;
    const p = this.group.position;
    const c = g.worldToCell(p.x, p.z);
    if (!g.isRoad(c.x, c.y) || g.roadDegree(c.x, c.y) >= 3) return false;
    const t = this.points[Math.min(this.idx + 2, this.points.length - 1)];
    if (!t) return false;
    let dx = t.x - p.x;
    let dz = t.z - p.z;
    if (Math.abs(dx) > Math.abs(dz)) { dx = Math.sign(dx); dz = 0; } else { dz = Math.sign(dz); dx = 0; }
    if (!dx && !dz) return false;
    const cw = g.cellToWorld(c.x, c.y);
    const laneX = cw.x - dz * SIM.laneOffset;
    const laneZ = cw.z + dx * SIM.laneOffset;
    const off = dx ? Math.abs(p.z - laneZ) : Math.abs(p.x - laneX);
    if (off < 0.35) return false;
    const lx = dx ? p.x + dx * 1.2 : laneX;
    const lz = dz ? p.z + dz * 1.2 : laneZ;
    this.points.splice(this.idx, 0, new THREE.Vector3(lx, p.y, lz));
    return true;
  }

  /** Is the opposite lane (and just ahead) free for a turn-around here? */
  uTurnClear() {
    const list = this.town.traffic?.vehicles;
    if (!list) return true;
    const p = this.group.position;
    const fx = Math.sin(this.group.rotation.y);
    const fz = Math.cos(this.group.rotation.y);
    for (const o of list) {
      if (o === this || o.parkTimer > 0) continue;
      const dx = o.group.position.x - p.x;
      const dz = o.group.position.z - p.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      const along = dx * fx + dz * fz;
      const left = dx * fz - dz * fx;
      if (Math.abs(along) < 5 && left > 0.4 && left < 3) return false;
      if (along > 0 && along < 3 && Math.abs(left) <= 0.4) return false;
    }
    return true;
  }

  reroute(rng, opts = {}) {
    if (!this.routeDestination || this.docking) return false;
    return this.planRoute(rng, this.routeDestination, opts);
  }

  abortDock(retry = 8) {
    this.town.parking?.release(this);
    this.docking = null;
    this.dockRetryT = retry;
    this.points = [];
    this.idx = 0;
  }

  /**
   * Leave a jam: keep the destination but route around the given cells, or
   * (when `newDest`) give up on this trip and head somewhere else.
   */
  rerouteAround(rng, avoid, newDest = false) {
    if (this.docking) {
      if (!newDest) return false;
      this.abortDock();
    }
    const keepDest = !newDest || (this.role === 'emergency' && this.status !== 'patrol');
    if (keepDest && this.routeDestination) {
      return this.planRoute(rng, this.routeDestination, { avoid, strict: !newDest });
    }
    // A fresh destination abandons the *route*, not the trip: the vehicle is
    // still driving, and the trip is measured when it next docks. Only a
    // rescue that physically relocates the vehicle (rescueStuck) cancels it.
    return this.planRoute(rng, null, { avoid });
  }

  pickDispatchTarget(rng) {
    const grid = this.town.grid;
    const from = this.homeCell || this.currentCell();
    return (
      randomWalkableCell(grid, walkableRoad, rng, from, 8) ||
      randomWalkableCell(grid, walkableRoad, rng, from, 4)
    );
  }

  /**
   * Emergency units answer calls, they do not invent them: a unit with an
   * open call matching it (ambulance for the sick, fire for a fire, police
   * for a disturbance) rolls out with lights on; between calls police patrol
   * the streets and the rest hold at their station bay.
   */
  callKind() {
    return this.type === 'ambulance' ? 'medical' : this.type === 'fire' ? 'fire' : 'police';
  }

  nextEmergency(rng) {
    const board = this.town.incidents;
    if (this.status === 'return') {
      if (this.homeCell && this.planRoute(rng, this.homeCell)) return true;
      this.status = 'patrol';
      this.cooldown = rng.float(6, 14);
      return this.planRoute(rng);
    }

    // Holding a call (P-E01): re-planning from wherever we now are must never
    // take a second call or drop this one silently. Re-route to it, or if it
    // is no longer live, hand it back and stand down.
    if (this.incident) {
      if (!board || !board.list.includes(this.incident)) {
        board?.abandonCall(this, 'vanished');
        this.incident = null;
      } else {
        const at = this.town.grid.worldToCell(this.group.position.x, this.group.position.z);
        const cell = this.incident.cell;
        if (at.x === cell[0] && at.y === cell[1]) {
          this.onArrive(rng);
          return true;
        }
        if (this.planRoute(rng, this.incident.cell)) {
          this.status = 'enroute';
          this.sirens = true;
          this.lights = true;
          this.errandKind = 'call';
          return true;
        }
        board.abandonCall(this, 'unreachable');
        this.incident = null;
      }
    }

    const call = board ? board.takeFor(this) : null;
    if (call && this.planRoute(rng, call.cell)) {
      this.status = 'enroute';
      this.sirens = true;
      this.lights = true;
      this.incident = call;
      this.errandKind = 'call';
      return true;
    }
    if (call) board.release(call);

    if (this.type === 'police') {
      if (this.cooldown <= 0) {
        const target = this.pickDispatchTarget(rng);
        if (target && this.planRoute(rng, target)) {
          this.status = 'patrol';
          this.sirens = false;
          this.lights = false;
          this.cooldown = rng.float(14, 28);
          return true;
        }
        this.cooldown = rng.float(6, 12);
      }
      if (this.tryDock(rng)) {
        this.errandKind = 'call';
        return true;
      }
      return this.planRoute(rng);
    }

    // Ambulance and fire wait at the station until their own kind of call.
    if (this.tryDock(rng, { maxDistance: 4 })) {
      this.errandKind = 'call';
      this.postSearches = 0;
      return true;
    }
    this.sirens = false;
    this.lights = false;
    // A bay search is rate-limited and a failed leg holds its own retry, so a
    // single `false` here is not evidence that the post is unusable. Take a
    // second and a half of honest attempts before doing anything else.
    this.postSearches = (this.postSearches || 0) + 1;
    if (this.postSearches < 6) {
      this.speed = 0;
      return false;
    }
    const at = this.currentCell();
    const home = this.homeCell;
    if (home && (!at || at[0] !== home[0] || at[1] !== home[1])) {
      // Stranded off-post with nothing to answer: go back to the post rather
      // than invent a town-wide trip.
      this.postSearches = 0;
      if (this.planRoute(rng, home)) return true;
    }
    if (this.postSearches < 24) {
      // At the post with no bay free: hold it. Roaming the streets with no
      // call is what police patrol is for, and every such trip used to show
      // up as a journey with no purpose behind it.
      this.speed = 0;
      return false;
    }
    this.postSearches = 0;
    // The forecourt has stayed full through a stretch of searches: the nearest
    // free bay anywhere beats standing in the station approach.
    if (this.routeToBay(rng)) {
      this.awaitingBay = false;
      return true;
    }
    this.speed = 0;
    return false;
  }

  nextLeg(rng) {
    if (this.role === 'emergency') return this.nextEmergency(rng);
    if (this.role === 'civilian' && this.driverCitizen && !this.recoveringBay) return false;
    return this.nextErrand(rng);
  }


  privateDestination(clock, rng) {
    const citizen = this.driverCitizen;
    if (!citizen?.home || !this.town.buildings.includes(citizen.home)) return null;
    const purpose = citizen.desiredKey(clock).kind;
    const current = citizen.insideBuilding;
    let building = purpose === 'home' ? citizen.home
      : purpose === 'work' ? citizen.work
      : purpose === 'food' ? this.town.pickBuilding(['shop'], rng)
      : purpose === 'leisure' ? this.town.pickBuilding(['civic', 'shop'], rng)
      : null;
    if (building?.door) building = this.town.buildings.find((b) => b.doorWorld === building.doorWorld) || null;
    if (!building || building === current || !building.cell || !this.town.buildings.includes(building)) return null;
    return { building, purpose };
  }

  beginPrivateTrip(clock, rng) {
    const citizen = this.driverCitizen;
    if (!citizen || citizen.driving || !citizen.indoors || !citizen.insideBuilding) return false;
    const destination = this.privateDestination(clock, rng);
    if (!destination) return false;
    const tripToken = `${clock.day}:${destination.purpose}`;
    if (this.lastPrivateTripToken === tripToken) return false;
    // P-F03: after dark only the run home goes out — night trips belong to the
    // units built for them (taxi, bus) and to emergency and service roles.
    if (!this.nightEligible && (clock.hour >= 22 || clock.hour < 6.5) && destination.purpose !== 'home') {
      return false;
    }
    if (!this.planRoute(rng, destination.building.cell)) return false;

    this.town.parking?.release(this);
    this.parkTimer = 0;
    this.trip = { purpose: destination.purpose, destination: destination.building,
      origin: citizen.insideBuilding, state: 'driving', startedDay: clock.day };
    this.lastPrivateTripToken = tripToken;
    citizen.driving = this;
    citizen.points = [];
    citizen.idx = 0;
    citizen.indoors = false;
    citizen.insideBuilding = null;
    citizen.group.visible = false;
    this.town.traffic.tripStarts++;
    if (this.fuel <= 12) this.beginFuelStop(rng);
    return true;
  }

  beginFuelStop(rng) {
    if (this.fuelStop || (this.town.resources?.levels?.fuel || 0) <= 0) return false;
    const pumps = (this.town.resources?.operatingGasSites?.() || [])
      .map((site) => ({ site, bay: this.town.parking?.spaces.find((space) => space.siteId === site.id && !space.taken) }))
      .filter((row) => row.bay)
      .sort((a, b) => {
        const p = this.group.position;
        return Math.hypot(a.bay.entry.x - p.x, a.bay.entry.z - p.z)
          - Math.hypot(b.bay.entry.x - p.x, b.bay.entry.z - p.z);
      });
    for (const { site, bay } of pumps) {
      const road = this.town.grid.worldToCell(bay.entry.x, bay.entry.z);
      const resume = this.routeDestination?.slice() || null;
      if (!this.town.grid.isRoad(road.x, road.y)) continue;
      const here = this.currentCell();
      if (here?.[0] === road.x && here?.[1] === road.y) {
        this.points = [];
        this.idx = 0;
        this.routeDestination = [road.x, road.y];
      } else if (!this.planRoute(rng, [road.x, road.y])) continue;
      this.fuelStop = { site, resume };
      this.errandKind = 'refuel';
      if (!this.points.length) this.onArrive(rng);
      return true;
    }
    return false;
  }

  finishFuelStop() {
    const stop = this.fuelStop;
    if (!stop) return;
    const amount = this.town.resources?.dispenseFuel?.(stop.site, this.fuelCapacity - this.fuel) || 0;
    if (amount <= 0) {
      // The pump had nothing. `dispenseFuel` returns 0 whenever the store is
      // empty, and the candidate filter never checked that the site could
      // actually dispense — so the vehicle parked for three seconds, drove off
      // the pump with a still-empty tank, became `stranded`, waited
      // STRANDED_RETRY, and was routed straight back to the same empty pump.
      // For ever, with no terminal state and nothing logged: measured 2 station
      // round trips in 600 s and zero litres after 600 s.
      //
      // No fuel is ever INVENTED here — that invariant still holds. What changes
      // is that the vehicle stops pretending it is making progress: it waits,
      // and the wait is honest, until the town has fuel again.
      this.fuelStop = null;
      this.errandKind = 'parked';
      this.parkTimer = Math.max(this.parkTimer, FUEL_EMPTY_PATIENCE);
      this.town.traffic.fuelDispensed += 0;
      return;
    }
    this.fuel = Math.min(this.fuelCapacity, this.fuel + amount);
    this.parkTimer = Math.max(3, Math.min(9, amount * 0.25));
    this.errandKind = 'refuel';
    this.town.traffic.fuelDispensed += amount;
  }

  finishPrivateTrip() {
    const trip = this.trip;
    const citizen = this.driverCitizen;
    if (!trip || !citizen) return;
    citizen.driving = null;
    citizen.enterBuilding(trip.destination);
    // The trip actually happened, so it is real demand: recorded HERE, on
    // completion, rather than when the route was planned. See
    // `recordTripCompleted` — recording on planning let every re-plan of a car
    // that never arrived write an origin–destination pair, and those pairs are
    // what the council reads to decide where to build a street.
    const from = this.routeFrom;
    const cell = this.currentCell();
    if (from && cell) this.town.traffic.recordTripCompleted(from, cell);
    this.trip = null;
    this.awaitingBay = false;
    this.baySearches = 0;
    this.parkTimer = Infinity;
    this.town.traffic.tripCompletions++;
  }

  /**
   * End a private trip that will never complete (P-D03). The driver is put
   * back where the trip started, the vehicle keeps no phantom `trip`, and the
   * cancellation is counted so an abandoned trip is distinguishable from one
   * that arrived.
   */
  cancelTrip(reason = 'abandoned') {
    const trip = this.trip;
    if (!trip) return false;
    const citizen = this.driverCitizen;
    this.trip = null;
    this.awaitingBay = false;
    this.cancelledReason = reason;
    this.town.traffic.tripCancellations++;
    if (citizen) {
      if (citizen.driving === this) citizen.driving = null;
      citizen.points = [];
      citizen.idx = 0;
      const back = trip.origin && this.town.buildings.includes(trip.origin)
        ? trip.origin
        : citizen.home;
      if (back) {
        citizen.indoors = true;
        citizen.insideBuilding = back;
        citizen.group.visible = false;
      }
    }
    if (this.parkSpace) this.town.parking?.release(this);
    this.parkTimer = 0;
    return true;
  }


  /**
   * Pull off the street into a bay: claim a space and drive the last few metres
   * from the kerb to it. Returns false when every space nearby is taken, in
   * which case the vehicle keeps moving - it never stops in a lane.
   */
  tryDock(rng, opts = {}) {
    const parking = this.town.parking;
    if (!parking || this.docking || this.parkSpace || this.dockRetryT > 0) return false;
    // P-D01 asks for measured parking demand, not a busy-loop. A bay frees up
    // on the dwelling vehicle's clock, not on this one's tick, so one scan per
    // quarter second of sim time answers everything a per-micro-step scan did
    // at a fiftieth of the cost.
    if (this.dockSearchT > 0) return false;
    const current = this.currentCell();
    if (!current) return false;
    const [cx, cy] = current;
    // Docking is only the final off-road manoeuvre. A previous global search
    // could claim a free bay on the far side of town and then draw one direct
    // line through roads, buildings and other vehicles to reach it.
    const traffic = this.town.traffic;
    if (traffic) traffic.dockTries++;
    this.dockSearchT = 0.25;
    const space = parking.claimFor(this, [cx, cy], {
      homeKey: opts.homeKey ?? (this.trip?.purpose === 'home' ? this.homeKey : null),
      maxDistance: opts.maxDistance ?? 2,
      pumpSiteId: opts.pumpSiteId,
      // Never take a bay whose previous occupant is still pulling out.
      accept: (s) => (!opts.accept || opts.accept(s)) &&
        (!traffic || (traffic.spotFree(this, s.pos.x, s.pos.z, s.yaw) && traffic.spotFree(this, s.entry.x, s.entry.z, s.yaw)))
    });
    if (!space) {
      // Measured denial: this search found no free bay of the right size
      // within reach. Counted once per search episode, not once per frame, and
      // reported alongside the forecast demand rather than folded into it (P-D04).
      if (!this.bayRefused && traffic) {
        this.bayRefused = true;
        traffic.bayRefusals++;
      }
      if (traffic && traffic.bayStats) traffic.bayStats.refuse++;
      return false;
    }
    if (!this.dockLegLegal(space)) {
      if (traffic) { traffic.dockLegMisses++; if (traffic.bayStats) traffic.bayStats.legMiss++; }
      parking.release(this);
      this.dockRetryT = 1.5;
      return false;
    }
    if (traffic && traffic.bayStats) traffic.bayStats.dockOk++;
    this.bayRefused = false;
    this.errandKind = this.errandKind || 'parked';
    if (this.recoveringBay) this.recoveringBay = false;
    return true;
  }

  /**
   * The road cells from which the last few metres onto `space` can legally be
   * driven: the entry cell when it is already on the road, plus any road
   * neighbour whose centre joins the entry in a straight, fully drivable
   * segment. Shared by `dockLegLegal` (which must enter from one) and
   * `routeToBay` (which must drive to one) so the two can never disagree
   * about whether a bay is reachable at all.
   *
   * A bay's `entry` sits half a cell INSIDE the lot, so it is almost never on
   * a road cell itself — testing `isRoad(entry)` alone reduced a whole town's
   * worth of parking to a single usable candidate.
   */
  bayApproachCells(space) {
    const grid = this.town.grid;
    const parking = this.town.parking;
    const drivable = (x, y) => grid.isRoad(x, y) || !!(parking && parking.at(x, y).length);
    const segDrivable = (ax, az, bx, bz) => {
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(d / (CELL * 0.4)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const c = grid.worldToCell(ax + (bx - ax) * t, az + (bz - az) * t);
        if (!drivable(c.x, c.y)) return false;
      }
      return true;
    };
    const ec = grid.worldToCell(space.entry.x, space.entry.z);
    const out = [];
    if (grid.isRoad(ec.x, ec.y)) out.push([ec.x, ec.y]);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = ec.x + dx;
      const y = ec.y + dy;
      if (!grid.isRoad(x, y)) continue;
      const c = grid.cellToWorld(x, y);
      if (!segDrivable(c.x, c.z, space.entry.x, space.entry.z)) continue;
      out.push([x, y]);
    }
    return out;
  }

  /**
   * No bay opened up within walking distance of where the vehicle stands, so
   * drive to the nearest REACHABLE free one (P-D03 / P-D02). The claim still
   * only happens through `tryDock` once the vehicle arrives, so `dockLegLegal`
   * and `spotFree` gate the final leg exactly as before — nothing here widens
   * a tolerance or claims a bay the vehicle has not reached. Work is bounded
   * to the eight nearest candidates.
   */
  routeToBay(rng, opts = {}) {
    const parking = this.town.parking;
    const grid = this.town.grid;
    if (!parking || this.docking || this.parkSpace) return false;
    const from = this.currentCell();
    if (!from) return false;
    const traffic = this.town.traffic;
    const candidates = [];
    const seen = new Set();
    for (const s of parking.spaces) {
      if (s.taken) continue;
      // The same kind/size rules the claim will be judged by — routing to a
      // bay this vehicle may never have only buys it a refusal on arrival.
      if (!parking.claimable(s, this, opts)) continue;
      if (traffic && !(traffic.spotFree(this, s.pos.x, s.pos.z, s.yaw) &&
        traffic.spotFree(this, s.entry.x, s.entry.z, s.yaw))) continue;
      for (const a of this.bayApproachCells(s)) {
        // Already standing on the way in: driving there would be a no-op, and
        // `tryDock` has already had its chance at this cell.
        if (a[0] === from[0] && a[1] === from[1]) continue;
        const key = `${a[0]},${a[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ cell: a, d: Math.abs(a[0] - from[0]) + Math.abs(a[1] - from[1]) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const limit = Math.min(candidates.length, 8);
    for (let i = 0; i < limit; i++) {
      if (this.planRoute(rng, candidates[i].cell)) return true;
    }
    return false;
  }

  /**
   * Build the last few metres onto `space` and refuse it when those metres
   * leave the drivable network (SRS P-C03). The kerb entry, the pad and the
   * line joining them must sit on road or parking, and the approach must reach
   * the bay by road rather than by cutting across whatever lies in between —
   * otherwise the claim is released and the vehicle keeps looking.
   */
  dockLegLegal(space) {
    const grid = this.town.grid;
    const parking = this.town.parking;
    const here = this.currentCell();
    if (!here) return false;
    const drivable = (x, y) => grid.isRoad(x, y) || !!(parking && parking.at(x, y).length);
    const segDrivable = (ax, az, bx, bz) => {
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(d / (CELL * 0.4)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const c = grid.worldToCell(ax + (bx - ax) * t, az + (bz - az) * t);
        if (!drivable(c.x, c.y)) return false;
      }
      return true;
    };
    const ec = grid.worldToCell(space.entry.x, space.entry.z);
    const pc = grid.worldToCell(space.pos.x, space.pos.z);
    if (!drivable(ec.x, ec.y) || !drivable(pc.x, pc.y)) return false;
    // The kerb-to-pad manoeuvre itself never crosses anything solid.
    if (!segDrivable(space.entry.x, space.entry.z, space.pos.x, space.pos.z)) return false;

    const h = (x, z) => grid.heightAtWorld(x, z);
    const approach = new THREE.Vector3(space.entry.x, h(space.entry.x, space.entry.z), space.entry.z);
    const bay = new THREE.Vector3(space.pos.x, h(space.pos.x, space.pos.z), space.pos.z);
    const finish = (points, cells, idx) => {
      this.points = points;
      this.idx = idx;
      this.routeCells = cells;
      this.routeId++;
      this.routeVersion = this.town.roadGraphVersion;
      this.docking = space;
      return true;
    };

    if (grid.isRoad(ec.x, ec.y)) {
      if (here[0] === ec.x && here[1] === ec.y) return finish([approach, bay], [[ec.x, ec.y]], 0);
      const p = this.group.position;
      if (segDrivable(p.x, p.z, space.entry.x, space.entry.z)) {
        return finish([approach, bay], [[ec.x, ec.y]], 0);
      }
    }

    // Reach a road cell that can legally enter the bay, by road.
    const approaches = this.bayApproachCells(space);
    let best = null;
    for (const a of approaches) {
      if (a[0] === here[0] && a[1] === here[1]) { best = [a]; break; }
      const path = findPath(grid, here, a, { walkable: walkableRoad });
      if (!path || path.length < 2) continue;
      if (!best || path.length < best.length) best = path;
    }
    if (!best) return false;
    const leg = this.routeOnRoad(grid, best, this.group.position.clone());
    if (!leg) return false;
    return finish([...leg, approach, bay], best, leg.length > 3 ? 1 : 0);
  }


  /** Snap onto the bay and hold there for a while. */
  dockNow(rng, dwell) {
    const space = this.docking;
    this.docking = null;
    if (!space) return;
    const y = this.town.grid.heightAtWorld(space.pos.x, space.pos.z);
    this.group.position.set(space.pos.x, y, space.pos.z);
    this.group.rotation.y = space.yaw;
    this.group.rotation.z = 0;
    this.speed = 0;
    this.parkTimer = dwell;
    this.points = [];
    this.idx = 0;
    this.stuckTime = 0;
    this.honked = false;
  }

  onArrive(rng) {
    if (this.docking) {
      // A recovery leg names its own dwell (home and station bays hold); a
      // normal arrival rolls one.
      // Idle ambulance/fire units must stay in their station bay until a
      // matching call opens. The old finite 8–20 second dwell sent an inactive
      // unit out of the bay, immediately re-claimed the same station space,
      // and produced the visible parked -> reverse -> park loop. Active calls
      // and return legs retain a finite dwell so they can resume normally.
      const idleEmergencyStation = this.role === 'emergency' &&
        this.status !== 'enroute' && !this.incident &&
        (this.town.incidents?.openCount(this.callKind()) || 0) === 0;
      this.stationHold = idleEmergencyStation;
      this.stationWakeT = 0;
      this.serviceHold = this.role === 'service' && this.errandKind === 'parked';
      this.serviceWakeT = 0;
      const dwell = this.dockDwell ?? (idleEmergencyStation
        ? Infinity
        : this.role === 'emergency' ? rng.float(8, 20) : rng.float(4, 16));
      this.dockDwell = null;
      this.dockNow(rng, dwell);
      if (this.fuelStop) { this.finishFuelStop(); return; }
      if (this.trip && !this.fuelStop) { this.finishPrivateTrip(); return; }
      if (this.role !== 'emergency' && this.errandKind !== 'parked' && rng.chance(0.4)) {
        this.logServiceStop(rng);
      }
      return;
    }
    if (this.fuelStop) {
      if (this.tryDock(rng, { pumpSiteId: this.fuelStop.site.id })) return;
      this.awaitingBay = true;
      this.bayEpisodes = (this.bayEpisodes || 0) + 1;
      this.bayWaitT = 0;
      this.bayHopeful = undefined;
      this.speed = 0;
      return;
    }
    if (this.role !== 'emergency') {
      if (this.recoveringBay) {
        // Lost its pad in a rebuild: reach the road, then take any legal bay.
        if (this.tryDock(rng, { maxDistance: 4 })) return;
        if (this.planRoute(rng, null)) return;
        this.recoveringBay = false;
      }
      if (this.trip) {
        // The route snaps a non-road destination to the kerb cell beside it,
        // so the pad it belongs to can sit a little further off than the usual
        // kerb-side radius — search the whole block before giving up (P-F02).
        if (this.tryDock(rng, { maxDistance: 4 })) return;
        // The vehicle is at its destination but has nowhere legal to stand:
        // record the arrival so the trip is measured as reached, not lost.
        // Counted once — a later re-arrival while hunting a bay is the same
        // arrival, not a second one.
        if (!this.trip.reached) {
          this.trip.reached = true;
          this.tripReaches++;
        }
        this.awaitingBay = true;
        this.bayEpisodes = (this.bayEpisodes || 0) + 1;
        this.bayWaitT = 0;
        this.bayHopeful = undefined;
        this.speed = 0;
        return;
      }
      if (this.tryDock(rng)) return;
      this.nextLeg(rng);
      return;
    }

    if (this.status === 'enroute') {
      const board = this.town.incidents;
      this.lastIncident = this.incident;
      this.sceneT = board ? board.onScene(this, rng) : rng.float(6, 12);
      this.status = 'onscene';
      this.sirens = false;
      this.lights = true;
      this.points = [];
      this.idx = 0;
      this.errandKind = 'call';
      return;
    }
    if (this.status === 'onscene') {
      this.status = 'return';
      this.sirens = false;
      this.lights = false;
      return;
    }
    if (this.status === 'return') {
      this.status = 'patrol';
      this.cooldown = rng.float(8, 18);
      this.sirens = false;
      this.lights = false;
      this.town.incidents?.onClear(this, rng);
      if (rng.chance(0.5)) events.emit('log', { text: `${this.unit} unit backs at the station.` });
    }
  }

  logServiceStop(rng) {
    const kind = this.errandKind;
    if (this.unit === 'Refuse' && kind === 'work') {
      events.emit('log', { text: `Refuse crew empties bins along ${streetName(this.town, rng)}.` });
    } else if (this.unit === 'Utility' && kind === 'work') {
      events.emit('log', { text: `Utility van checks a meter on ${streetName(this.town, rng)}.` });
    } else if (kind === 'home') {
      events.emit('log', { text: `${this.driver.name} pulls into the drive.` });
    }
  }

  animateBeacon(dt) {
    const b = this.rig.beacon;
    if (!b) return;
    let mode;
    if (b.amber) {
      this.beaconT += dt;
      mode = this.beaconT % 0.8 < 0.4 ? 'blink' : 'off';
    } else if (this.lights) {
      this.beaconT += dt;
      if (this.beaconT >= 0.3) {
        this.beaconT = 0;
        this.bluePhase = !this.bluePhase;
      }
      mode = this.bluePhase ? 'blue' : 'red';
    } else {
      mode = 'off';
      this.beaconT = 0;
    }
    if (mode !== this.beaconMode) {
      this.beaconMode = mode;
      setBeaconState(b, mode);
    }
  }

  /**
   * First vehicle inside this vehicle's swept corridor along its own route.
   * Following the route polyline (not a straight ray to the next point)
   * keeps a turning vehicle from mistaking oncoming traffic in the other
   * lane for a queue ahead.
   */
  blockedBy(others) {
    const px = this.group.position.x;
    const pz = this.group.position.z;
    const braking = (this.speed * this.speed) / 24;
    const gapBase = 1.4 + this.speed * 0.35 + braking;
    const myL = this.spec.length;
    const myHW = this.spec.width * 0.5;
    const look = gapBase + myL * 0.5 + 3.5;
    const segs = [];
    let ax = px;
    let az = pz;
    let s = 0;
    for (let i = this.idx; i < this.points.length && s < look; i++) {
      const p = this.points[i];
      const len = Math.hypot(p.x - ax, p.z - az);
      if (len < 1e-3) continue;
      segs.push([ax, az, (p.x - ax) / len, (p.z - az) / len, len, s]);
      s += len;
      ax = p.x;
      az = p.z;
    }
    if (!segs.length) {
      segs.push([px, pz, Math.sin(this.group.rotation.y), Math.cos(this.group.rotation.y), look, 0]);
    }
    let best = null;
    let bestAhead = Infinity;
    let bestGap = 0;
    for (const o of others) {
      if (o === this) continue;
      if (this.passT > 0 && o === this.passVehicle) continue;
      const ox = o.group.position.x;
      const oz = o.group.position.z;
      if (Math.abs(ox - px) > look + 3 || Math.abs(oz - pz) > look + 3) continue;
      const ofx = Math.sin(o.group.rotation.y);
      const ofz = Math.cos(o.group.rotation.y);
      const oHL = o.spec.length * 0.5;
      const oHW = o.spec.width * 0.5;
      for (const [sx, sz, ux, uz, len, s0] of segs) {
        const qx = ox - sx;
        const qz = oz - sz;
        const along = qx * ux + qz * uz;
        const extLong = oHL * Math.abs(ofx * ux + ofz * uz) + oHW * Math.abs(ofz * ux - ofx * uz);
        if (along < -extLong || along > len + extLong) continue;
        const lat = Math.abs(qx * -uz + qz * ux);
        const extLat = oHL * Math.abs(ofx * -uz + ofz * ux) + oHW * Math.abs(ofz * uz + ofx * ux);
        if (lat >= myHW + extLat + 0.06) continue;
        const ahead = s0 + Math.max(0, Math.min(len, along));
        if (ahead < 0.15 && s0 === 0 && along < 0) break;
        if (ahead > gapBase + myL * 0.5 + extLong) break;
        if (ahead < bestAhead) {
          bestAhead = ahead;
          best = o;
          // Leave a real bumper gap; the SAT guard remains the hard boundary.
          bestGap = myL * 0.5 + extLong + 0.3;
        }
        break;
      }
    }
    return best ? { vehicle: best, distance: bestAhead, gap: bestGap } : null;
  }

  /**
   * Anyone stepping into the road ahead: slow for them rather than walk
   * through them. Distances are bumper-to-person, so a van stops clear of
   * the crossing instead of on top of it. Citizens on the pavement sit
   * outside this cone and are left alone.
   */
  yieldToPeds() {
    const peds = this.town.pedestrians?.citizens;
    if (!peds || !peds.length) return null;
    const px = this.group.position.x;
    const pz = this.group.position.z;
    const target = this.points[this.idx];
    let fx = Math.sin(this.group.rotation.y);
    let fz = Math.cos(this.group.rotation.y);
    if (target) {
      const len = Math.hypot(target.x - px, target.z - pz);
      if (len > 0.05) {
        fx = (target.x - px) / len;
        fz = (target.z - pz) / len;
      }
    }
    const nose = this.spec.length * 0.5;
    const reach = nose + 1.4 + this.speed * 0.45;
    // The pavement is close to the kerb; keep the cone to the actual body
    // width so a person safely walking beside the lane does not stop traffic.
    const wide = this.spec.width * 0.5 + 0.18;
    let hit = null;
    const grid = this.town.grid;
    for (const c of peds) {
      if (!c.rig?.group?.visible) continue;
      // Pavement users - including people waiting at the kerb - are not
      // hazards; only someone on the asphalt or stepping onto a crossing is.
      // A docking vehicle crosses the pavement, so it respects everyone.
      if (!this.docking && !pedInRoad(c, grid)) continue;
      // Someone standing at the kerb waiting for us is not a reason to wait for them.
      if (c.state === 'waiting-crossing' && c.speed < 0.1) continue;
      const dx = c.group.position.x - px;
      const dz = c.group.position.z - pz;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead < -nose * 0.5 || ahead > reach) continue;
      const lateral = Math.abs(dx * -fz + dz * fx);
      if (lateral > wide) continue;
      const gap = nose + 0.7;
      if (hit === null || ahead < hit.distance) hit = { distance: ahead, gap };
    }
    return hit;
  }

  /**
   * What the signal ahead means for this vehicle: `stop` is the distance at
   * which a red (or amber) phase must be honoured, `queued` marks that a
   * signalised junction is close enough that a stop here is normal traffic
   * rather than a jam. A vehicle already inside the junction clears it, and a
   * red never applies to an approach the junction does not signal.
   */
  signalGate(target, dist) {
    const sig = this.town.roadKit?.signals;
    if (!sig) return null;
    const g = this.town.grid;
    const cur = g.worldToCell(this.group.position.x, this.group.position.z);
    const tgt = g.worldToCell(target.x, target.z);
    const info = sig.at(tgt.x, tgt.y);
    const queued = !!info && dist < 9;
    if (this.sirens) return { stop: null, queued };
    if (!info || (cur.x === tgt.x && cur.y === tgt.y)) return { stop: null, queued };
    if (sig.hasSignal(cur.x, cur.y)) return { stop: null, queued };
    // The approach axis is the direction of travel *into* the junction, taken
    // from the cell delta rather than the world-space vector. A waypoint swung
    // sideways by lane offset or smoothing must not make an east/west approach
    // read as north/south (SRS P-C04).
    const cellDx = tgt.x - cur.x;
    const cellDz = tgt.y - cur.y;
    const wx = target.x - this.group.position.x;
    const wz = target.z - this.group.position.z;
    let axis;
    if (cellDx !== 0 && (cellDz === 0 || Math.abs(cellDx) >= Math.abs(cellDz))) axis = 'x';
    else if (cellDz !== 0) axis = 'z';
    else axis = Math.abs(wx) > Math.abs(wz) ? 'x' : 'z';
    if (!info.axes.includes(axis)) return { stop: null, queued };
    const state = sig.stateFor(info.group, axis);
    if (state === 'green') return { stop: null, queued };
    if (state === 'amber' && dist < 1.7) return { stop: null, queued };
    return { stop: dist, queued };
  }

  update(dt, others, rng) {
    if (this.rig.driverCue) this.rig.driverCue.visible = this.role === 'civilian'
      ? !!this.driverCitizen?.driving : this.parkTimer <= 0;
    this.stuckTime = Math.max(0, this.stuckTime);
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.rerouteT > 0) this.rerouteT -= dt;
    if (this.dockRetryT > 0) this.dockRetryT -= dt;
    if (this.dockSearchT > 0) this.dockSearchT -= dt;
    if (this.stationWakeT > 0) this.stationWakeT -= dt;
    if (this.serviceWakeT > 0) this.serviceWakeT -= dt;
    if (this.passT > 0 && (this.passT -= dt) <= 0) this.passVehicle = null;
    if (this.resolveT > 0) this.resolveT -= dt;
    if (this.yieldCount > 0) this.yieldCount = Math.max(0, this.yieldCount - dt / 30);
    this.animateBeacon(dt);
    this.trackProgress(dt);
    this.recoverUnmarkedPosition(rng);
    this.waits.length = 0;
    this.waitingOn = null;
    this.waitKind = null;

    if (this.parkTimer > 0) {
      if (this.role === 'emergency' && this.stationHold) {
        // `openCount` alone is insufficient: taking an unreachable call,
        // failing planRoute, and falling back to tryDock made a unit leave and
        // immediately re-claim the same station bay. Release only after the
        // call has been assigned and a legal route was produced.
        const board = this.town.incidents;
        if (board && this.stationWakeT <= 0 && board.openCount(this.callKind()) > 0) {
          const call = board.takeFor(this);
          if (call && this.planRoute(rng, call.cell)) {
            this.stationHold = false;
            this.parkTimer = 0;
            this.town.parking?.release(this);
            this.incident = call;
            this.status = 'enroute';
            this.sirens = true;
            this.lights = true;
            this.errandKind = 'call';
            this.speed = 0;
            return;
          }
          if (call) board.release(call);
          this.stationWakeT = 5;
        }
        this.speed = 0;
        return;
      }
      if (this.role === 'service' && this.serviceHold) {
        // A service vehicle that failed every reachable work stop must keep
        // its current bay while it retries. Calling nextLeg while still
        // claimed lets a newly reachable stop release the bay atomically;
        // a failed retry leaves the vehicle exactly where it was.
        if (this.serviceWakeT <= 0) {
          const started = this.nextLeg(rng);
          if (started && this.points.length) {
            this.serviceHold = false;
            this.parkTimer = 0;
            this.town.parking?.release(this);
            this.speed = 0;
            return;
          }
          this.serviceWakeT = 5;
        }
        this.speed = 0;
        return;
      }
      if (this.role === 'civilian' && this.driverCitizen && !this.trip) {
        // A car parked at home with a dry tank must be able to REACH a pump, and
        // the fuel check lived below this early return, inside a block the
        // parked path never reached: a civilian's normal state is
        // `parkTimer = Infinity`, so the branch below fired every frame for ever
        // and the fuel logic was never consulted. `stranded` is only set further
        // down, and `recoverStranded` is gated on `strandedWaitT`, which is only
        // ever incremented further down — so a home-parked dry vehicle could be
        // neither rescued nor even reported as stranded. Verified: with
        // `parkTimer > 0` and `fuel === 0` the vehicle sat at fuel 0, stranded
        // and invisible, while the same vehicle on the road was refuelled.
        if (this.fuel <= FUEL_RESERVE && !this.fuelStop && this.town.resources?.levels?.fuel > 0) {
          if (this.beginFuelStop(rng)) {
            this.parkTimer = 0;
            this.town.parking?.release(this);
            this.speed = 0;
            return;
          }
        }
        if (this.town.traffic.clock) this.beginPrivateTrip(this.town.traffic.clock, rng);
        this.speed = 0;
        return;
      }
      this.parkTimer -= dt;
      if (this.role === 'emergency' && !this.stationHold && this.town.incidents?.openCount(this.callKind()) > 0) {
        this.parkTimer = 0;
      }
      this.speed = 0;
      if (this.parkTimer <= 0) {
        this.parkTimer = 0;
        this.town.parking?.release(this);
        this.errandKind = null;
        if (this.fuelStop) {
          const resume = this.fuelStop.resume;
          this.fuelStop = null;
          if (resume && !this.planRoute(rng, resume) && this.trip) this.onArrive(rng);
        }
      }
      return;
    }

    // On scene: held at the incident until the board says the job is done.
    if (this.sceneT > 0) {
      this.sceneT -= dt;
      this.speed = 0;
      if (this.sceneT <= 0) {
        this.sceneT = 0;
        this.status = 'return';
        this.sirens = false;
        this.lights = false;
        this.points = [];
        this.idx = 0;
      }
      return;
    }

    if (this.backing) {
      this.stepBacking(dt);
      return;
    }

    if (this.awaitingBay) {
      this.speed = 0;
      // P-D01: a hold has to name what it is waiting for. Without this the
      // stand counts towards congestion as an unexplained stall.
      this.waitKind = 'bay';
      const parking = this.town.parking;
      const opts = this.fuelStop
        ? { pumpSiteId: this.fuelStop.site.id }
        : (this.trip ? { maxDistance: 4 } : {});
      if (this.tryDock(rng, opts)) {
        this.awaitingBay = false;
        this.bayWaitT = 0;
        this.baySearches = 0;
        return;
      }
      // P-E01: a unit with a live call outranks a bay. Drop the wait, keep the
      // claim and keep driving; an empty tank is handled by the fuel block
      // below as the stranding it is, not as an invisible hold in a lane.
      if (this.role === 'emergency' && this.status === 'enroute') {
        this.awaitingBay = false;
        this.bayWaitT = 0;
        if (!this.points.length) {
          const cell = this.incident?.cell || null;
          if (!this.planRoute(rng, cell)) this.town.incidents?.abandonCall(this, 'unreachable');
        }
        return;
      }
      // A bay in range can still free up, so the grace is worth serving. One
      // this vehicle is not allowed to use never will be, and standing out
      // the full grace for it is what turns a pass-by kerb into a visible
      // stand — so when nothing here is claimable, try to drive elsewhere at
      // once. Attempts after that keep the usual cadence: they are a retry
      // budget, not a free-for-all.
      if (this.bayHopeful === undefined) {
        const c = this.currentCell();
        this.bayHopeful = !c || !parking
          || parking.claimableInRange(this, c, opts.maxDistance ?? 2, opts);
      }
      this.bayWaitT += dt;
      const grace = this.bayHopeful || this.baySearches > 0 ? BAY_WAIT_MAX : 0;
      if (this.bayWaitT < grace) return;
      // P-D03: the kerb never produced a bay, so drive to the nearest
      // reachable free one instead of holding the street indefinitely.
      this.bayWaitT = 0;
      if (this.routeToBay(rng, opts)) {
        if (this.town.traffic?.bayStats) this.town.traffic.bayStats.rtOk++;
        this.awaitingBay = false;
        this.baySearches = 0;
        return;
      }
      if (this.town.traffic?.bayStats) this.town.traffic.bayStats.rtFail++;
      this.baySearches = (this.baySearches || 0) + 1;
      if (this.baySearches < BAY_GIVE_UP) return;
      // Nothing reachable at all: get back into circulation rather than
      // freezing a live lane on the spot.
      if (this.town.traffic?.bayStats) this.town.traffic.bayStats.giveUp++;
      this.baySearches = 0;
      this.awaitingBay = false;
      if (!this.planRoute(rng, null)) this.planRoute(rng, this.homeCell || null);
      return;
    }

    // Fuel (P-F04): below the reserve the vehicle diverts to a pump instead of
    // drying out mid-route. Reaching zero *strands* it — held, reported and
    // recovered by TrafficSystem.recoverStranded — never a permanent dead end
    // in a live lane. Emergency units enroute to a call do not divert at the
    // reserve, but an empty tank still stops them.
    const emergencyRun = this.role === 'emergency' && this.status === 'enroute';
    const canRefuel = !this.fuelStop && !this.docking && !this.awaitingBay;
    if (canRefuel && (emergencyRun ? this.fuel <= 0 : this.fuel <= FUEL_RESERVE)) {
      if (this.beginFuelStop(rng)) {
        this.stranded = false;
        this.strandedReason = null;
        this.strandedWaitT = 0;
      } else {
        this.strandedWaitT += dt;
      }
    }
    if (this.fuel <= 0) {
      this.stranded = true;
      if (!this.strandedReason) this.strandedReason = emergencyRun ? 'ran-dry-on-call' : 'dry-tank';
    }
    if (this.stranded) {
      this.waitKind = 'fuel';
      this.speed = 0;
      if (this.fuelStop || this.docking) {
        this.stranded = false;
        this.strandedReason = null;
        this.strandedWaitT = 0;
      } else {
        return;
      }
    }


    if (this.points.length === 0 || this.idx >= this.points.length) {
      if (!this.nextLeg(rng)) {
        // P-D01: a stop has to name itself. A civilian that ran out of road
        // has not stalled - it is either between trips or still hunting a bay,
        // and both must be said out loud and kept retrying rather than left
        // standing in a live lane with nothing to report.
        if (this.role === 'civilian' && this.driverCitizen && !this.trip) {
          const clock = this.town.traffic?.clock;
          if (clock && this.beginPrivateTrip(clock, rng)) return;
        }
        if (this.trip && !this.docking && !this.awaitingBay) {
          this.awaitingBay = true;
          this.bayEpisodes = (this.bayEpisodes || 0) + 1;
          this.bayWaitT = 0;
          this.bayHopeful = undefined;
          this.speed = 0;
          return;
        }
        return;
      }
    }

    const target = this.points[this.idx];
    const pos = this.group.position;
    tmpVec.set(target.x - pos.x, 0, target.z - pos.z);
    const dist = tmpVec.length();

    if (dist < 0.55) {
      if (this.idx === this.points.length - 1 && this.docking) {
        const s = this.docking;
        if (!this.town.traffic.poseClear(this, s.pos.x, s.pos.z, s.yaw)) {
          this.speed = 0;
          this.waitKind = 'dock';
          if (this.collisionBlocker?.kind === 'vehicle') this.addWait(this.collisionBlocker.agent);
          return;
        }
      }
      this.idx++;
      if (this.idx >= this.points.length) {
        this.points = [];
        this.onArrive(rng);
        return;
      }
    }

    tmpVec.normalize();
    const curvature = curvatureAt(this.points, Math.min(this.idx, this.points.length - 1), 5);
    let desired = this.spec.maxSpeed * (0.9 + this.driver.traits.extraversion * 0.35 - this.driver.traits.conscientiousness * 0.12);
    desired *= 1 - Math.min(0.72, curvature * 0.85);
    if (this.sirens) desired *= 1.3;
    else {
      const congestion = this.town.traffic ? this.town.traffic.congestion : 0;
      // Wider classes shed congestion pressure faster (P-D02): a boulevard is
      // not slowed as hard as an alley carrying the same jam.
      const g = this.town.grid;
      const cell = g.worldToCell(this.group.position.x, this.group.position.z);
      const code = g.roadClass ? g.roadClass[g.idx(cell.x, cell.y)] : 0;
      desired *= 1 - 0.55 * congestion * (1 - 0.06 * code);
    }
    // Road class genuinely buys speed (P-D02).
    {
      const g = this.town.grid;
      const cell = g.worldToCell(this.group.position.x, this.group.position.z);
      if (g.isRoad(cell.x, cell.y)) desired *= this.classSpeedBonus(cell.x, cell.y);
    }

    const blocker = this.blockedBy(others);
    if (blocker) {
      const slow = Math.max(0, (blocker.distance - blocker.gap) * 2.4);
      desired = Math.min(desired, slow);
      if (desired < 0.15) desired = 0;
      if (blocker.distance - blocker.gap < 0.6) this.addWait(blocker.vehicle, 'queue');
    }
    const ped = this.yieldToPeds();
    if (ped) {
      const slow = Math.max(0, (ped.distance - ped.gap) * 2.6);
      desired = Math.min(desired, slow);
      if (desired < 0.35) desired = 0;
      this.yielding = ped.distance < 3;
      if (desired === 0 && !this.waitKind) this.waitKind = 'ped';
    } else {
      this.yielding = false;
    }

    const gate = this.signalGate(target, dist);
    this.waitSignal = !!(gate && gate.stop != null);
    this.nearSignal = !!(gate && gate.queued);
    if (gate && gate.stop != null) {
      const slow = Math.max(0, (gate.stop - 0.35) * 3.2);
      desired = Math.min(desired, slow);
      if (desired < 0.3) desired = 0;
      if (desired === 0) this.waitKind = 'signal';
    }
    let junction = null;
    if (this.giveWay) {
      // Voluntarily holding so a deadlocked partner can pass: no junction
      // claims, no forward motion, and no wait-for edge (it is not blocked).
      const gw = this.giveWay;
      gw.t -= dt;
      const to = gw.to;
      const gone =
        !to.group.parent ||
        to.parkTimer > 0 ||
        Math.hypot(to.group.position.x - gw.x, to.group.position.z - gw.z) > 4.5 ||
        Math.hypot(to.group.position.x - pos.x, to.group.position.z - pos.z) > 10;
      if (gw.t <= 0 || gone) this.giveWay = null;
      else {
        desired = 0;
        this.waitKind = 'giveway';
      }
    }
    if (!this.giveWay) {
      junction = this.town.traffic?.junctionGate(this, target, !!(gate && gate.stop != null));
    }
    this.waitJunction = !!junction?.stop;
    if (junction?.stop) {
      const clearance = junction.clearance ?? (dist - 0.5);
      desired = Math.min(desired, Math.max(0, clearance * 3));
      if (desired < 0.35) desired = 0;
      this.nearSignal = true;
      if (desired === 0) {
        if (junction.vehicle) this.addWait(junction.vehicle, junction.downstream ? 'exit' : 'junction');
        else if (junction.pedestrian) this.waitKind = this.waitKind || 'ped';
      }
    }
    if (this.docking) desired = Math.min(desired, 2.8);

    const accel = desired > this.speed ? 7.5 : 16;
    const delta = Math.min(Math.abs(desired - this.speed), accel * dt);
    this.speed += Math.sign(desired - this.speed) * delta;
    if (this.speed < 0) this.speed = 0;

    if (this.yielding && this.speed < 0.3) this.pedWaitT += dt;

    if (this.holdT > 6 && !this.honked && this.waitKind !== 'signal' && this.waitKind !== 'giveway') {
      this.honked = true;
      if (this.sirens) {
        events.emit('log', { kind: 'event', text: `Sirens wail as the ${this.unit} unit is held up.` });
      } else if (this.driver.traits.neuroticism > 0.55 || this.driver.traits.extraversion > 0.7) {
        events.emit('log', { text: `${this.driver.name} leans on the horn.` });
      }
    }

    if (
      blocker?.vehicle.docking &&
      this.docking &&
      this.uid > blocker.vehicle.uid &&
      this.holdT > 1
    ) {
      // Two reserved parking approaches can cross even though their bays do
      // not. The deterministic yielder releases its reservation and takes a
      // short circulation lap before trying again.
      this.abortDock(8);
      return;
    }

    let step = Math.min(this.speed * dt, dist + 0.01);
    tmpVec2.set(tmpVec.x * step, 0, tmpVec.z * step);
    const targetYaw = Math.atan2(tmpVec.x, tmpVec.z);
    let turnDiff = targetYaw - this.group.rotation.y;
    while (turnDiff > Math.PI) turnDiff -= Math.PI * 2;
    while (turnDiff < -Math.PI) turnDiff += Math.PI * 2;
    const predictedYaw = this.group.rotation.y + turnDiff * Math.min(1, dt * 4.5);
    const nextX = pos.x + tmpVec2.x;
    const nextZ = pos.z + tmpVec2.z;
    this.collisionBlocker = null;
    if (
      step > 0 &&
      (this.town.traffic?.wouldCollide(this, nextX, nextZ, predictedYaw, others) ||
        this.town.traffic?.wouldHitPed(this, nextX, nextZ, predictedYaw))
    ) {
      // Hard stop only. Who backs up (if anyone) is decided centrally by
      // TrafficSystem.resolveJams from the wait-for graph.
      this.speed = 0;
      this.collisionBlocked = true;
      const hb = this.collisionBlocker;
      if (hb?.kind === 'vehicle') this.addWait(hb.agent, 'collision');
      else if (hb) {
        this.waitKind = 'ped';
        this.pedWaitT += dt;
      }
      step = 0;
      tmpVec2.set(0, 0, 0);
    } else {
      this.collisionBlocked = false;
      pos.x = nextX;
      pos.z = nextZ;
      this.distanceDriven += step;
      this.fuel = Math.max(0, this.fuel - step * 0.02);
    }

    const groundY = this.town.grid.heightAtWorld(pos.x, pos.z);
    pos.y += (groundY - pos.y) * Math.min(1, dt * 6);

    const diff = turnDiff;
    // Never swing a stationary body through a neighbour. Heading changes
    // are applied only with validated forward movement.
    if (step > 0) this.group.rotation.y += diff * Math.min(1, dt * 4.5);
    if (Math.abs(this.group.rotation.y) > 6.2832) {
      this.group.rotation.y = Math.atan2(Math.sin(this.group.rotation.y), Math.cos(this.group.rotation.y));
    }

    const spin = (this.speed * dt) / (this.spec.wheelRadius || 0.26);
    for (const w of this.rig.wheels) w.rotation.x += spin;

    const lean = -diff * Math.min(0.06, this.speed * 0.006);
    this.group.rotation.z += (lean - this.group.rotation.z) * Math.min(1, dt * 5);
  }

  /** Hold time = seconds since the vehicle last made 0.8 m of real progress. */
  trackProgress(dt) {
    const p = this.group.position;
    if (!this.anchor || this.parkTimer > 0 || this.sceneT > 0) {
      this.anchor = { x: p.x, z: p.z };
      this.holdT = 0;
      this.jamLevel = 0;
      this.honked = false;
      return;
    }
    if (Math.hypot(p.x - this.anchor.x, p.z - this.anchor.z) > 0.8) {
      this.anchor.x = p.x;
      this.anchor.z = p.z;
      this.holdT = 0;
      this.jamLevel = 0;
      this.honked = false;
      this.jamState = null;
      this.pedWaitT = 0;
    } else {
      this.holdT += dt;
    }
    this.stuckTime = this.holdT;
  }

  addWait(vehicle, kind = null) {
    if (!vehicle || vehicle === this) return;
    if (!this.waits.includes(vehicle)) this.waits.push(vehicle);
    if (!this.waitingOn || kind === 'collision') this.waitingOn = vehicle;
    if (kind && (!this.waitKind || kind === 'collision' || this.waitKind === 'ped')) this.waitKind = kind;
  }

  /** Reverse along the body axis under full collision checks. */
  stepBacking(dt) {
    const b = this.backing;
    // A backing command must never outlive a parking claim. This is a safety
    // net for restored state or a same-tick deadlock edge; normal resolution
    // excludes docking agents in waitEdges().
    if (this.docking || this.parkSpace) {
      this.backing = null;
      this.abortDock(8);
      return;
    }
    const pos = this.group.position;
    const yaw = this.group.rotation.y;
    b.t = (b.t || 0) + dt;
    this.speed = 0;
    this.waitKind = 'backing';
    const step = Math.min(1.4 * dt, b.remaining);
    const nx = pos.x - Math.sin(yaw) * step;
    const nz = pos.z - Math.cos(yaw) * step;
    if (step <= 1e-4 || b.t > 4 || !this.town.traffic.canOccupy(this, nx, nz, yaw)) {
      this.backing = null;
      return;
    }
    pos.x = nx;
    pos.z = nz;
    pos.y += (this.town.grid.heightAtWorld(nx, nz) - pos.y) * Math.min(1, dt * 6);
    b.remaining -= step;
    const spin = step / (this.spec.wheelRadius || 0.26);
    for (const w of this.rig.wheels) w.rotation.x -= spin;
    if (b.remaining <= 1e-3) this.backing = null;
  }

  nearestPointIndex() {
    if (!this.points.length) return 0;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const d = tmpVec.copy(this.points[i]).distanceToSquared(this.group.position);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}

export class TrafficSystem {
  constructor(town) {
    this.town = town;
    this.vehicles = [];
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    this.rng = town.rng.fork(11);
    this.congestion = 0;
    // Recent road demand for extension siting. Buckets bound both memory and
    // the age of observations; quotes only read a copied snapshot.
    this.demandTime = 0;
    this.demandBuckets = [];
    this.demandTrips = [];
    this.trips = 0;
    this.tripStarts = 0;
    this.tripCompletions = 0;
    this.tripCancellations = 0;
    this.fuelDispensed = 0;
    // Measured parking denials (P-D04), reported next to the forecast demand.
    this.bayRefusals = 0;
    this.dockTries = 0;
    this.dockLegMisses = 0;
    this.bayStats = { enter: 0, dockOk: 0, refuse: 0, legMiss: 0, rtOk: 0, rtFail: 0, giveUp: 0, longWait: 0 };
    // Why a founding car did not appear (P-F01 / P-D04 measured counts).
    this.spawnFailures = { noEligible: 0, noPose: 0, noBay: 0 };
    // Live mobility diagnostics (P-D01).
    this.queueLength = 0;
    this.avgWaitSec = 0;
    this.delaySec = 0;
    this.strandedCount = 0;
    this.strandedOldest = 0;
    this.clock = null;
    this.junctionClaims = new Map();
    this.jamLogT = 0;
    // Last-resort tow for total gridlock: its own RNG stream (forks capture
    // state without consuming draws) so rescue poses never perturb the town
    // or traffic sequences, plus a cooldown between rescues.
    this.teleportRng = town.rng.fork(77);
    this.teleportT = 0;
    // Fixed-step accumulator for the shared simulation step (P-E04).
    this.acc = 0;
  }

  /** Completed private trips, kept as a plain field for existing readers. */
  get tripCount() {
    return this.tripCompletions;
  }


  cellOccupancy(x, y, except = null) {
    let count = 0;
    for (const v of this.vehicles) {
      if (v === except || v.parkTimer > 0) continue;
      const c = this.town.grid.worldToCell(v.group.position.x, v.group.position.z);
      if (c.x === x && c.y === y) count++;
    }
    return count;
  }

  wouldCollide(agent, x, z, yaw, list = this.vehicles) {
    for (const other of list) {
      if (other === agent) continue;
      if (Math.abs(other.group.position.x - x) > 7 || Math.abs(other.group.position.z - z) > 7) continue;
      if (!vehicleBoxesOverlap(agent, x, z, yaw, other)) continue;
      // If legacy/generated state starts with an overlap, allow only motion
      // that increases separation. This lets the agents drive clear without
      // ever applying an artificial displacement impulse.
      const already = vehicleBoxesOverlap(
        agent,
        agent.group.position.x,
        agent.group.position.z,
        agent.group.rotation.y,
        other
      );
      const oldD = Math.hypot(
        agent.group.position.x - other.group.position.x,
        agent.group.position.z - other.group.position.z
      );
      const newD = Math.hypot(x - other.group.position.x, z - other.group.position.z);
      if (!already || newD <= oldD + 0.001) {
        agent.collisionBlocker = { kind: 'vehicle', agent: other };
        return true;
      }
    }
    return false;
  }

  wouldHitPed(agent, x, z, yaw) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const halfL = agent.spec.length * 0.5 + 0.28;
    const halfW = agent.spec.width * 0.5 + 0.28;
    for (const p of this.town.pedestrians?.citizens || []) {
      if (!p.rig?.group?.visible) continue;
      // The stylised vehicle box slightly overhangs the narrow rendered
      // kerb. A citizen waiting on that pavement must not be treated as if
      // they were standing in the lane; crossing pedestrians remain hard
      // collision obstacles.
      // Hard stop only for people clearly on the asphalt; kerb-edge walkers
      // step around vehicle bodies themselves and would otherwise starve a
      // vehicle.
      if (!agent.docking && !pedInRoad(p, this.town.grid, 1.4)) continue;
      const dx = p.group.position.x - x;
      const dz = p.group.position.z - z;
      if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
      if (Math.abs(dx * fx + dz * fz) >= halfL || Math.abs(dx * rx + dz * rz) >= halfW) continue;
      const oldDx = p.group.position.x - agent.group.position.x;
      const oldDz = p.group.position.z - agent.group.position.z;
      const oldFx = Math.sin(agent.group.rotation.y);
      const oldFz = Math.cos(agent.group.rotation.y);
      const oldRx = -oldFz;
      const oldRz = oldFx;
      const already =
        Math.abs(oldDx * oldFx + oldDz * oldFz) < halfL &&
        Math.abs(oldDx * oldRx + oldDz * oldRz) < halfW;
      if (!already || Math.hypot(dx, dz) <= Math.hypot(oldDx, oldDz) + 0.001) {
        agent.collisionBlocker = { kind: 'pedestrian', agent: p };
        agent.yielding = true;
        return true;
      }
    }
    return false;
  }

  poseClear(agent, x, z, yaw) {
    return !this.wouldCollide(agent, x, z, yaw) && !this.wouldHitPed(agent, x, z, yaw);
  }

  /** Routing cost per cell: stalled vehicles weigh far more than moving ones. */
  occupancyMap(except = null) {
    const g = this.town.grid;
    const m = new Map();
    for (const v of this.vehicles) {
      if (v === except || v.parkTimer > 0) continue;
      const c = g.worldToCell(v.group.position.x, v.group.position.z);
      const k = c.y * g.w + c.x;
      m.set(k, (m.get(k) || 0) + (v.speed < 0.3 && v.holdT > 3 ? 8 : 1.5));
    }
    return m;
  }

  /** No other vehicle near a pose (bay / bay entry), with a generous margin. */
  spotFree(agent, x, z, yaw) {
    for (const o of this.vehicles) {
      if (o === agent) continue;
      if (Math.abs(o.group.position.x - x) > 7 || Math.abs(o.group.position.z - z) > 7) continue;
      if (vehicleBoxesOverlap(agent, x, z, yaw, o, 0.3, 0.3)) return false;
    }
    return true;
  }

  /** Side-effect-free pose test used for reversing: clear of traffic and people, rear on road/bay. */
  canOccupy(agent, x, z, yaw) {
    const saved = [agent.collisionBlocker, agent.yielding];
    const ok = this.poseClear(agent, x, z, yaw);
    [agent.collisionBlocker, agent.yielding] = saved;
    if (!ok) return false;
    const g = this.town.grid;
    const cur = g.worldToCell(agent.group.position.x, agent.group.position.z);
    const drivable = (x, y) => g.isRoad(x, y) || !!this.town.parking?.at(x, y)?.length;
    // A backing manoeuvre may leave a marked bay, but it may not begin from
    // or enter an arbitrary empty cell. The old `c === cur` exception let a
    // vehicle already one cell off the network continue reversing through a
    // free plot, which showed up as rare unmarked off-road traffic in horizon
    // traces.
    if (!drivable(cur.x, cur.y)) return false;
    const half = agent.spec.length * 0.5;
    const rx = x - Math.sin(yaw) * half;
    const rz = z - Math.cos(yaw) * half;
    for (const [px, pz] of [[x, z], [rx, rz]]) {
      const c = g.worldToCell(px, pz);
      if (!drivable(c.x, c.y)) return false;
    }
    return true;
  }

  canBack(agent, d = 0.8) {
    const yaw = agent.group.rotation.y;
    const p = agent.group.position;
    return this.canOccupy(agent, p.x - Math.sin(yaw) * d, p.z - Math.cos(yaw) * d, yaw);
  }

  releaseClaimsOf(agent) {
    for (const [key, claim] of this.junctionClaims) {
      if (claim.vehicle === agent) this.junctionClaims.delete(key);
    }
    agent.claimedJunction = null;
  }

  jamLog(text) {
    if (this.jamLogT > 0) return;
    this.jamLogT = 8;
    events.emit('log', { text });
  }

  cellKeyOf(v) {
    const c = this.town.grid.worldToCell(v.group.position.x, v.group.position.z);
    return `${c.x},${c.y}`;
  }

  /** Edges of the wait-for graph: only stationary vehicles actually held. */
  waitEdges(v) {
    // A docking vehicle owns a legal bay and is executing the final off-road
    // leg. It must never become a wait-for graph node: cycle breaking used to
    // reverse it out of the bay and then send it through the same docking route
    // again (the visible parked -> reverse -> park glitch).
    if (v.parkTimer > 0 || v.sceneT > 0 || v.docking || v.backing || v.giveWay) return [];
    if (v.speed > 0.3 || v.holdT < 1) return [];
    return v.waits.filter((w) => w.group.parent && w.parkTimer <= 0);
  }

  findCycles() {
    const color = new Map();
    const stack = [];
    const cycles = [];
    const visit = (v) => {
      color.set(v, 1);
      stack.push(v);
      for (const w of this.waitEdges(v)) {
        const c = color.get(w) || 0;
        if (c === 0) visit(w);
        else if (c === 1) cycles.push(stack.slice(stack.indexOf(w)));
      }
      stack.pop();
      color.set(v, 2);
    };
    for (const v of this.vehicles) if (!color.get(v)) visit(v);
    return cycles;
  }

  /**
   * Break one deadlock. The yielder is the member that can most cheaply get
   * out of the way: civilians before service before emergency, outside a
   * junction box before inside, room behind before boxed in; repeated
   * yielders are spared so the burden rotates.
   */
  breakCycle(cyc) {
    if (cyc.some((v) => v.backing || v.giveWay || v.resolveT > 0)) return;
    const g = this.town.grid;
    let best = -1;
    let bestScore = Infinity;
    const canBack = cyc.map((v) => this.canBack(v));
    cyc.forEach((v, i) => {
      const c = g.worldToCell(v.group.position.x, v.group.position.z);
      let s = v.sirens ? 100 : v.role === 'emergency' ? 20 : v.role === 'service' ? 10 : 0;
      if (g.roadDegree(c.x, c.y) >= 3) s += 30;
      if (canBack[i]) s -= 50;
      s += v.yieldCount * 15;
      s += -v.uid * 1e-3;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    });
    const y = cyc[best];
    const to = cyc[(best - 1 + cyc.length) % cyc.length];
    this.yieldTo(y, to, canBack[best]);
  }

  yieldTo(y, to, canBack) {
    // Parking owns the vehicle during the last metres into a bay. If an older
    // wait edge still reaches a docking agent after a route rebuild, release
    // the claim and retry the docking leg rather than backing through the bay.
    if (y.docking) {
      y.abortDock(8);
      y.jamState = 'released blocked bay';
      this.jamLog(`${y.driver.name} releases a blocked parking bay.`);
      return;
    }
    this.releaseClaimsOf(y);
    y.resolveT = 5;
    y.yieldCount += 1;
    to.passVehicle = y;
    to.passT = 5;
    const dyaw = Math.abs(Math.atan2(Math.sin(y.group.rotation.y - to.group.rotation.y), Math.cos(y.group.rotation.y - to.group.rotation.y)));
    const headOn = dyaw > 2.4;
    if (headOn && y.yieldCount < 2 && y.snapToLane()) {
      y.giveWay = null;
      y.jamState = `steering into lane for #${to.uid}`;
      return;
    }

    if (canBack && y.yieldCount < 4) {
      y.backing = { remaining: 2.2 };
      y.giveWay = { to, t: 4.5, x: to.group.position.x, z: to.group.position.z };
      y.jamState = `backing for #${to.uid}`;
      this.jamLog(`${y.driver.name} backs up to let the ${typeLabel(to.type)} through.`);
      return;
    }
    // Boxed in or nose-to-nose: turn away instead of waiting forever.
    const avoid = new Set([this.cellKeyOf(to)]);
    const t = y.points[y.idx];
    if (t) {
      const c = this.town.grid.worldToCell(t.x, t.z);
      if (`${c.x},${c.y}` !== this.cellKeyOf(y)) avoid.add(`${c.x},${c.y}`);
    }
    if (y.rerouteAround(this.rng, avoid) || y.rerouteAround(this.rng, avoid, true)) {
      y.rerouteT = 4;
      y.jamState = `rerouted around #${to.uid}`;
      this.jamLog(`${y.driver.name} turns off to clear a jam.`);
    } else {
      y.giveWay = { to, t: 3, x: to.group.position.x, z: to.group.position.z };
      y.jamState = `holding for #${to.uid}`;
    }
  }

  /** Follow primary wait edges to the vehicle actually causing a queue. */
  chainOf(v) {
    const chain = [v];
    let cur = v.waitingOn;
    while (cur && chain.length < 16 && !chain.includes(cur)) {
      chain.push(cur);
      cur = cur.waitingOn;
    }
    return chain;
  }

  /** A red light, or a queue whose head is moving/only briefly stopped. */
  legitWait(v, chain) {
    const root = chain[chain.length - 1];
    const cyclic = root.waitingOn && chain.includes(root.waitingOn);
    if (cyclic || root.parkTimer > 0) return false;
    if (root.waitKind === 'signal' || root.waitKind === 'giveway' || root.backing) return v.holdT < 45;
    if (root !== v && (root.speed > 0.5 || root.holdT < 4)) return v.holdT < 45;
    if (root.waitKind === 'ped' && root.holdT < 12) return true;
    // Waiting to park, to dock, or to refuel. Same reasoning as the guard in
    // `escalate`: these are self-declared non-jams (the road-demand sampler
    // excludes them too) and can legitimately outlast any deadlock threshold.
    if (NON_CONGESTION_WAITS.has(root.waitKind) && root.waitKind !== 'signal' && root.waitKind !== 'giveway') {
      return v.holdT < 90;
    }
    return false;
  }

  /** Long holds that are not a deadlock: route around, then give up the trip. */
  escalate(v) {
    if (v.parkTimer > 0 || v.sceneT > 0 || v.backing || v.giveWay) return;
    // Looking for a kerb, and queueing for a pump, are the vehicle doing the only
    // thing it can do. A bay hold can legitimately last BAY_GIVE_UP ×
    // BAY_WAIT_MAX = 72 s, and every one of those seconds used to be escalated as
    // a deadlock: 13 re-plans, 2 uncommanded reverses down a live lane and 6
    // silent destination changes in 90 s for a single car in a street with no
    // other traffic in it (measured). The trip was left pointing at the original
    // shop while the car drove elsewhere, so `finishPrivateTrip` eventually
    // deposited the driver 56 m from where the trip said they were going and
    // counted it a success. `legitWait` now covers these, and so does this
    // explicit guard, because the two are different questions: one asks whether
    // the hold is a queue, the other refuses to escalate a vehicle that is
    // waiting to park.
    if (v.awaitingBay || v.docking || v.fuelStop) return;
    if (v.holdT < (v.sirens ? 3 : 8) || v.rerouteT > 0) return;
    const chain = this.chainOf(v);
    if (this.legitWait(v, chain)) return;
    v.rerouteT = 4;
    v.jamLevel++;
    const avoid = new Set();
    for (const o of chain.slice(1)) avoid.add(this.cellKeyOf(o));
    const t = v.points[v.idx];
    if (t && chain.length === 1) {
      const c = this.town.grid.worldToCell(t.x, t.z);
      if (`${c.x},${c.y}` !== this.cellKeyOf(v)) avoid.add(`${c.x},${c.y}`);
    }
    if (v.holdT < 20) {
      if (v.rerouteAround(this.rng, avoid)) {
        v.jamState = 'rerouted';
        this.jamLog(`${v.driver.name} takes another street to avoid a hold-up.`);
      }
      return;
    }
    if (v.docking) {
      v.abortDock(10);
      v.jamState = 'gave up bay';
      return;
    }
    if (v.jamLevel % 2 === 0 && this.canBack(v)) {
      this.releaseClaimsOf(v);
      v.backing = { remaining: 1.5 };
      v.jamState = 'backing out';
      return;
    }
    if (v.rerouteAround(this.rng, avoid, true)) {
      v.jamState = 'new destination';
      this.jamLog(`${v.driver.name} gives up and heads elsewhere.`);
    }
  }

  resolveJams(dt) {
    if (this.jamLogT > 0) this.jamLogT -= dt;
    for (const cyc of this.findCycles()) this.breakCycle(cyc);
    for (const v of this.vehicles) this.escalate(v);
  }

  /**
   * Last-resort tow for a total logjam. Recovery — cycle-breaking, reroutes,
   * backing out, giving up trips (resolveJams/escalate) — gets a full game
   * hour of sim time; only if the vehicle STILL has not made 0.8 m of
   * progress is it teleported to a random free road pose and re-routed from
   * there. Parked, scene and long-dwell vehicles are never candidates, and
   * at most one tow happens per cooldown so a jam unwinds gradually.
   */
  rescueStuck(dt) {
    if (this.teleportT > 0) this.teleportT -= dt;
    const HOUR = 60 * SIM.secondsPerGameMinute;
    let worst = null;
    for (const v of this.vehicles) {
      if (v.parkTimer > 0 || v.sceneT > 0 || v.holdT < HOUR) continue;
      if (!worst || v.holdT > worst.holdT) worst = v;
    }
    if (!worst || this.teleportT > 0) return;
    const pose = this.spawnPose(this.town.randomRoadCell(this.teleportRng), worst.spec);
    if (!pose) return; // every lane is occupied — retry after the cooldown
    if (worst.docking) worst.abortDock(30);
    if (worst.trip) worst.cancelTrip('gridlock');
    // Drop every wait/claim tied to the hopeless position.
    this.releaseClaimsOf(worst);
    for (const o of this.vehicles) {
      if (o === worst) continue;
      const i = o.waits.indexOf(worst);
      if (i >= 0) o.waits.splice(i, 1);
      if (o.waitingOn === worst) o.waitingOn = null;
    }
    worst.waits.length = 0;
    worst.waitingOn = null;
    worst.waitKind = null;
    worst.collisionBlocker = null;
    worst.yielding = false;
    worst.giveWay = null;
    worst.backing = null;
    worst.jamState = null;
    worst.jamLevel = 0;
    worst.honked = false;
    worst.resolveT = 0;
    worst.yieldCount = 0;
    const g = this.town.grid;
    worst.group.position.set(pose.x, g.heightAtWorld(pose.x, pose.z), pose.z);
    worst.group.rotation.set(0, pose.yaw, 0);
    worst.anchor = { x: pose.x, z: pose.z };
    worst.speed = 0;
    worst.holdT = 0;
    worst.stuckTime = 0;
    worst.nextLeg(this.teleportRng);
    this.teleportT = 4;
    events.emit('log', {
      kind: 'event',
          text: `Traffic control tows ${worst.driver.name}'s ${typeLabel(worst.type)} out of the gridlock.`
    });
  }

  /**
   * Only one vehicle may occupy a junction box at a time. Signals still
   * decide when an approach may proceed; this reservation prevents turning
   * and through movements from entering the same physical space together.
   */
  junctionGate(agent, target, signalStopped = false) {
    const grid = this.town.grid;
    let next = grid.worldToCell(target.x, target.z);
    if (grid.roadDegree(next.x, next.y) < 3) {
      let found = null;
      const limit = Math.min(agent.points.length, agent.idx + 10);
      for (let i = agent.idx + 1; i < limit; i++) {
        const p = agent.points[i];
        const c = grid.worldToCell(p.x, p.z);
        if (grid.roadDegree(c.x, c.y) >= 3) {
          found = c;
          break;
        }
      }
      if (!found) return null;
      next = found;
    }
    const key = `${next.x},${next.y}`;
    const current = grid.worldToCell(agent.group.position.x, agent.group.position.z);
    const inside = current.x === next.x && current.y === next.y;
    const junctionCenter = grid.cellToWorld(next.x, next.y);
    const clearance = Math.hypot(
      agent.group.position.x - junctionCenter.x,
      agent.group.position.z - junctionCenter.z
    ) - (CELL * 0.5 + agent.spec.length * 0.5 + 0.3);
    if (!inside && clearance > 2.5) return null;
    if (!inside) {
      const pedestrianInCrossing = (this.town.pedestrians?.citizens || []).some((p) => {
        if (!pedInRoad(p, grid)) return false;
        const c = grid.worldToCell(p.group.position.x, p.group.position.z);
        return c.x === next.x && c.y === next.y;
      });
      if (pedestrianInCrossing) return { stop: true, key, pedestrian: true, clearance };
    }
    const pass = agent.passT > 0 ? agent.passVehicle : null;
    let claim = this.junctionClaims.get(key);
    if (claim && claim.vehicle !== agent && claim.vehicle === pass && !claim.entered) {
      // Deadlock resolution gave us priority over this holder.
      this.junctionClaims.delete(key);
      if (pass.claimedJunction === key) pass.claimedJunction = null;
      claim = null;
    }
    if (claim && claim.vehicle !== agent) return { stop: true, key, vehicle: claim.vehicle, clearance };
    if (signalStopped && !inside) return { stop: false, key };
    if (!inside) {
      // Do not block the box: reserve a junction only when the vehicle's
      // first pose beyond it is physically available. A reservation alone
      // prevents crossing conflicts, but without this exit check a stopped
      // queue could still strand its owner across every approach.
      let exitPoint = null;
      for (let i = agent.idx + 1; i < agent.points.length; i++) {
        const p = agent.points[i];
        const c = grid.worldToCell(p.x, p.z);
        if (c.x !== next.x || c.y !== next.y) {
          exitPoint = p;
          break;
        }
      }
      if (exitPoint) {
        const center = grid.cellToWorld(next.x, next.y);
        const exitYaw = Math.atan2(exitPoint.x - center.x, exitPoint.z - center.z);
        const exitBlocker = this.vehicles.find((other) =>
          other !== agent &&
          other !== pass &&
          vehicleBoxesOverlap(agent, exitPoint.x, exitPoint.z, exitYaw, other, 0.35, 0.05)
        );
        if (exitBlocker) {
          // Never sit on a reservation we cannot use: others may have a free exit.
          if (claim && claim.vehicle === agent && !claim.entered) {
            this.junctionClaims.delete(key);
            agent.claimedJunction = null;
          }
          return { stop: true, key, downstream: true, vehicle: exitBlocker, clearance };
        }
      }
    }
    if (!claim) this.junctionClaims.set(key, { vehicle: agent, entered: inside });
    else if (inside) claim.entered = true;
    agent.claimedJunction = key;
    return { stop: false, key };
  }

  releaseJunctions() {
    const grid = this.town.grid;
    for (const [key, claim] of this.junctionClaims) {
      const v = claim.vehicle;
      if (!this.vehicles.includes(v) || v.parkTimer > 0 || !v.group.parent) {
        this.junctionClaims.delete(key);
        continue;
      }
      const [x, y] = key.split(',').map(Number);
      const cell = grid.worldToCell(v.group.position.x, v.group.position.z);
      if (cell.x === x && cell.y === y) {
        claim.entered = true;
        continue;
      }
      if (!claim.entered && v.speed < 0.2 && v.holdT > 2.5) {
        // Use it or lose it: a stalled vehicle must not lock the box for others.
        this.junctionClaims.delete(key);
        if (v.claimedJunction === key) v.claimedJunction = null;
        continue;
      }
      if (!claim.entered) {
        let stillApproaching = false;
        const limit = Math.min(v.points.length, v.idx + 10);
        for (let i = v.idx; i < limit; i++) {
          const target = v.points[i];
          const tc = grid.worldToCell(target.x, target.z);
          if (tc.x === x && tc.y === y) {
            stillApproaching = true;
            break;
          }
        }
        if (!stillApproaching) {
          this.junctionClaims.delete(key);
          if (v.claimedJunction === key) v.claimedJunction = null;
        }
        continue;
      }
      const p = grid.cellToWorld(x, y);
      const clear = CELL * 0.5 + v.spec.length * 0.5 + 0.25;
      if (Math.hypot(v.group.position.x - p.x, v.group.position.z - p.z) > clear) {
        this.junctionClaims.delete(key);
        if (v.claimedJunction === key) v.claimedJunction = null;
      }
    }
  }

  /**
   * Citizens who could take a car right now (P-F01): an adult of driving age
   * with a job, actually indoors at their own home, with no car of their own
   * and — because a household has exactly ONE pad — a free driveway or garage
   * the drawn rig physically fits in.
   */
  spawnPool(rigSpec, rejected) {
    return (this.town.pedestrians?.citizens || []).filter((c) => this.canTakeVehicle(c, rigSpec, rejected));
  }

  /**
   * The single definition of "this citizen could take this vehicle right now".
   *
   * Exists so the vehicle market can ask the question BEFORE a sale completes.
   * The market used to buy first and discover the answer afterwards, when the
   * vehicle failed to spawn and rolled back — and a vehicle that keeps failing
   * to spawn gets bought again the next day, by somebody else, forever. One
   * truck did 2,070 phantom sales in 300 days that way. The pad test alone is
   * not enough: a citizen also has to be of driving age, employed, and actually
   * indoors at their own home, and all of that has to hold at the moment of the
   * sale.
   */
  canTakeVehicle(c, rigSpec, rejected = new Set()) {
    return !!(
      c.p?.age >= 18 && c.p.age < 66 && c.home && c.work &&
      this.town.buildings.includes(c.work) && !c.vehicle && !rejected.has(c) &&
      c.indoors && c.insideBuilding === c.home &&
      this.homePadFree(c.home, rigSpec)
    );
  }

  /** Diagnostic: how the P-F01 candidate pool filtered down, for one rig. */
  eligibilityReport(spec) {
    const cs = this.town.pedestrians?.citizens || [];
    const r = { adults: 0, age: 0, home: 0, work: 0, owned: 0, indoors: 0, padFree: 0, pass: 0 };
    for (const c of cs) {
      if (!(c.p?.age >= 18 && c.p.age < 66)) continue;
      r.adults++;
      if (!c.home) continue;
      r.home++;
      if (!c.work || !this.town.buildings.includes(c.work)) continue;
      r.work++;
      if (c.vehicle) continue;
      r.owned++;
      if (!(c.indoors && c.insideBuilding === c.home)) continue;
      r.indoors++;
      if (!this.homePadFree(c.home, spec)) continue;
      r.padFree++;
      r.pass++;
    }
    return r;
  }

  /**
   * Can this house still take a car? One pad per household, so a sibling
   * whose driveway is already taken is not eligible — and `claimFor` also
   * rejects a pad the rig physically does not fit in, which a large van or
   * truck would otherwise hit after the citizen had already been picked
   * (P-F01: the founding fleet must actually form).
   */
  homePadFree(building, spec) {
    if (!building || !this.town.parking?.spaces) return false;
    const key = `${building.cell[0]},${building.cell[1]}`;
    return this.town.parking.spaces.some((s) => {
      if (s.taken || s.key !== key) return false;
      if (s.kind !== 'driveway' && s.kind !== 'garage') return false;
      if (spec && s.width != null && s.width + 0.2 < spec.width) return false;
      if (spec && s.length != null && s.length + 0.25 < spec.length) return false;
      return true;
    });
  }

  spawnPose(preferred, spec) {
    const grid = this.town.grid;
    const cells = grid.roadCells();
    if (!cells.length) return null;
    const origin = preferred || cells[this.rng.int(0, cells.length - 1)];
    cells.sort((a, b) => {
      const da = Math.abs(a[0] - origin[0]) + Math.abs(a[1] - origin[1]);
      const db = Math.abs(b[0] - origin[0]) + Math.abs(b[1] - origin[1]);
      return da - db;
    });
    const probe = { spec };
    for (const cell of cells) {
      const mask = grid.roadAt(cell[0], cell[1]);
      const dirs = [];
      if (mask & 1) dirs.push([0, -1]);
      if (mask & 2) dirs.push([1, 0]);
      if (mask & 4) dirs.push([0, 1]);
      if (mask & 8) dirs.push([-1, 0]);
      const p = grid.cellToWorld(cell[0], cell[1]);
      for (const dir of dirs) {
        const right = { x: -dir[1], z: dir[0] };
        const x = p.x + right.x * SIM.laneOffset;
        const z = p.z + right.z * SIM.laneOffset;
        const yaw = Math.atan2(dir[0], dir[1]);
        let blocked = false;
        for (const other of this.vehicles) {
          if (Math.abs(other.group.position.x - x) > 8 || Math.abs(other.group.position.z - z) > 8) continue;
          if (vehicleBoxesOverlap(probe, x, z, yaw, other, 0.2)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return { cell, x, z, yaw };
      }
    }
    return null;
  }

  /**
   * Congestion and the delay metrics that back it (SRS P-D01). Everything here
   * reads one window — CONGESTION_WINDOW — so `congestion`, `queueLength`,
   * `avgWaitSec` and `delaySec` describe the same interval instead of each
   * keeping its own threshold.
   */
  /**
   * Record a COMPLETED origin–destination pair, for the road-extension planner.
   *
   * Only trips a vehicle actually finishes are demand. This used to be called
   * from `planRoute`, so every re-plan counted: a car waiting at a kerb for a
   * bay had its route re-planned 13 times in 60 s and wrote 33 demand records
   * for a journey it never made (measured). Those records feed
   * `roadDemandSnapshot`, which is what the council reads to decide where to lay a
   * new street — so a phantom queue was steering capital expenditure.
   *
   * Called from `finishPrivateTrip`, on arrival.
   */
  recordTripCompleted(from, to) {
    if (!from || !to || (from[0] === to[0] && from[1] === to[1])) return;
    this.demandTrips.push({ from: from.slice(), to: to.slice(), at: this.demandTime, weight: 1 });
    if (this.demandTrips.length > 128) this.demandTrips.shift();
  }

  /** @deprecated superseded by `recordTripCompleted`; kept for callers. */
  recordRoadTrip(from, to) {
    this.recordTripCompleted(from, to);
  }

  roadDemandSnapshot() {
    const cells = new Map();
    for (const bucket of this.demandBuckets) {
      for (const [idx, value] of bucket.cells) {
        const total = cells.get(idx) || { visits: 0, delay: 0 };
        total.visits += value.visits;
        total.delay += value.delay;
        cells.set(idx, total);
      }
    }
    // The council may inspect demand only every six hours, while a completed
    // trip can be rare in a small settlement. Include a bounded live sample so
    // a presently occupied/delayed road remains visible even after the short
    // delay buckets have rolled over; routes still have to pass the planner's
    // legal-run and measured-hotspot checks.
    for (const vehicle of this.vehicles) {
      const cell = vehicle.currentCell?.();
      if (!cell || !this.town.grid.isRoad(cell[0], cell[1])) continue;
      const idx = this.town.grid.idx(cell[0], cell[1]);
      const total = cells.get(idx) || { visits: 0, delay: 0 };
      total.visits += 1;
      if (vehicle.holdT > CONGESTION_WINDOW && !NON_CONGESTION_WAITS.has(vehicle.waitKind)) {
        total.delay += Math.min(30, vehicle.holdT);
      }
      cells.set(idx, total);
    }
    return {
      cells,
      trips: this.demandTrips.map((trip) => ({
        from: trip.from.slice(), to: trip.to.slice(), weight: trip.weight
      }))
    };
  }

  sampleRoadDemand(dt) {
    if (!(dt > 0)) return;
    this.demandTime += dt;
    const slot = Math.floor(this.demandTime / 10);
    let bucket = this.demandBuckets[this.demandBuckets.length - 1];
    if (!bucket || bucket.slot !== slot) {
      bucket = { slot, cells: new Map() };
      this.demandBuckets.push(bucket);
    }
    for (const v of this.vehicles) {
      if (v.parkTimer > 0) continue;
      const cell = v.currentCell();
      if (!cell) continue;
      const idx = this.town.grid.idx(cell[0], cell[1]);
      const value = bucket.cells.get(idx) || { visits: 0, delay: 0 };
      value.visits += dt;
      if (v.holdT > CONGESTION_WINDOW && !NON_CONGESTION_WAITS.has(v.waitKind)) {
        value.delay += dt;
      }
      bucket.cells.set(idx, value);
    }
    const oldest = this.demandTime - 120;
    while (this.demandBuckets.length && this.demandBuckets[0].slot * 10 < oldest) this.demandBuckets.shift();
  }

  computeCongestion(dt = 0) {
    const counts = new Map();
    let live = 0;
    for (const v of this.vehicles) {
      if (v.parkTimer > 0) continue;
      live++;
      const c = v.currentCell();
      if (!c) continue;
      const k = c[0] * 100 + c[1];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let over = 0;
    for (const c of counts.values()) if (c > 1) over += c - 1;

    let held = 0;
    let queued = 0;
    let waitSum = 0;
    let delayedSum = 0;
    for (const v of this.vehicles) {
      if (v.parkTimer > 0) continue;
      if (v.holdT > CONGESTION_WINDOW) {
        waitSum += v.holdT;
        delayedSum += v.holdT;
        if (!NON_CONGESTION_WAITS.has(v.waitKind)) held++;
        if (QUEUE_WAIT_KINDS.has(v.waitKind)) queued++;
      } else {
        waitSum += v.holdT;
      }
    }
    this.congestion = live ? Math.min(1, (over + held) / live) : 0;
    this.queueLength = queued;
    this.avgWaitSec = live ? Math.round((waitSum / live) * 10) / 10 : 0;
    this.delaySec = held ? Math.round((delayedSum / held) * 10) / 10 : 0;
    this.sampleRoadDemand(dt);
    return { live, over, held, queued };
  }

  /**
   * P-F04 recovery: a vehicle whose tank ran dry is routed to a working
   * station — first through its own normal pump run, and once that has had
   * STRANDED_RETRY seconds to succeed, by clearing a path to the station kerb
   * even when every pump bay is busy. No fuel is ever invented: the vehicle
   * still has to reach a pump to receive any.
   */
  recoverStranded(dt) {
    this.strandedCount = 0;
    this.strandedOldest = 0;
    let recovering = 0;
    for (const v of this.vehicles) {
      if (!v.stranded) continue;
      this.strandedCount++;
      this.strandedOldest = Math.max(this.strandedOldest, v.strandedWaitT || 0);
      if (v.fuelStop || v.docking || v.awaitingBay) {
        v.stranded = false;
        v.strandedReason = null;
        v.strandedWaitT = 0;
        continue;
      }
      if ((v.strandedWaitT || 0) < STRANDED_RETRY) continue;
      if (this.routeStrandedToStation(v)) {
        v.strandedWaitT = 0;
        recovering++;
      } else {
        v.strandedWaitT = 0; // no station yet — retry on the next window
      }
    }
    return recovering;
  }

  /** Point a dry vehicle at the nearest working station, bay or no bay. */
  routeStrandedToStation(v) {
    const parking = this.town.parking;
    const sites = this.town.resources?.operatingGasSites?.() || [];
    if (!parking || !sites.length) return false;
    const p = v.group.position;
    let best = null;
    let bestD = Infinity;
    for (const site of sites) {
      for (const space of parking.spaces) {
        if (space.kind !== 'pump' || space.siteId !== site.id) continue;
        const d = Math.hypot(space.entry.x - p.x, space.entry.z - p.z);
        if (d >= bestD) continue;
        bestD = d;
        best = { site, space };
      }
    }
    if (!best) return false;
    const grid = this.town.grid;
    const road = grid.worldToCell(best.space.entry.x, best.space.entry.z);
    if (!grid.isRoad(road.x, road.y)) return false;
    const resume = v.routeDestination ? v.routeDestination.slice() : null;
    const here = v.currentCell();
    if (here && here[0] === road.x && here[1] === road.y) {
      v.points = [];
      v.idx = 0;
      v.routeDestination = [road.x, road.y];
    } else if (!v.planRoute(this.rng, [road.x, road.y])) {
      return false;
    }
    v.fuelStop = { site: best.site, resume };
    v.errandKind = 'refuel';
    v.stranded = false;
    v.strandedReason = null;
    if (!v.points.length) v.onArrive(this.rng);
    return true;
  }


  onRoadGraphChanged() {
    const g = this.town.grid;
    const parking = this.town.parking;
    for (const v of this.vehicles) {
      // INV-T01: a claim whose pad vanished is released and the vehicle is
      // routed back onto the road and into a legal bay — never left holding a
      // generation that no longer exists.
      if (v.parkingLost) this.recoverParking(v);
      // A bay whose kerb entry stopped being road can no longer be docked into.
      if (v.docking) {
        const e = g.worldToCell(v.docking.entry.x, v.docking.entry.z);
        const stillBay = parking && parking.at(e.x, e.y).includes(v.docking);
        if (!g.isRoad(e.x, e.y) && !stillBay) v.abortDock(4);
      }
      if (!v.routeCells || v.routeCells.every(([x, y]) => g.isRoad(x, y))) {
        v.routeVersion = this.town.roadGraphVersion;
        continue;
      }
      this.releaseClaimsOf(v);
      if (v.docking) v.abortDock();
      if (!v.reroute(this.rng)) {
        v.points = [];
        v.idx = 0;
        v.speed = 0;
        v.routeCells = [];
      }
    }
  }

  /**
   * P-B01 / P-B02: the pad under `v` disappeared in a rebuild. Pull it off
   * the lot under its own wheels and let it claim a legal bay once it reaches
   * the road — no teleport, no stale claim, no waiting for a jam rescue.
   */
  recoverParking(v) {
    v.parkingLost = false;
    v.awaitingBay = false;
    v.parkTimer = 0;
    v.dockRetryT = 0;
    v.dockSearchT = 0;
    if (v.parkSpace) return;
    if (v.docking) v.abortDock(0);
    if (v.role !== 'civilian') return;
    v.recoveringBay = true;
    if (!v.planRoute(this.rng, null)) {
      v.recoveringBay = false;
      v.parkingLost = true; // nothing to route to — try again on the next graph change
    }
  }


  mobilityStats() {
    const list = this.vehicles;
    let moving = 0;
    let parked = 0;
    let speedSum = 0;
    for (const v of list) {
      if (v.parkTimer > 0) parked++;
      else if (v.speed > 0.4) moving++;
      speedSum += v.speed;
    }
    const supply = this.town.parking ? this.town.parking.supply() : 0;
    const free = this.town.parking ? this.town.parking.free() : 0;
    const demand = list.length + this.town.pedestrians.households.length * 0.6;
    const ped = this.town.pedestrians.tripStats ? this.town.pedestrians.tripStats() : null;
    const purposes = {};
    let bayWaits = 0;
    for (const v of list) {
      const k = v.errandKind || (v.role === 'emergency' ? 'call' : 'idle');
      purposes[k] = (purposes[k] || 0) + 1;
      if (v.awaitingBay) bayWaits++;
    }
    return {
      vehicles: list.length,
      moving,
      parked,
      purposes,
      congestion: Math.round(this.congestion * 100) / 100,
      avgSpeed: Math.round((speedSum / Math.max(1, list.length)) * 3.6 * 10) / 10,
      parkingSupply: supply,
      // P-D04: demand is a forecast, never an observed occupancy. The observed
      // side is reported separately so the two are never conflated.
      parkingDemand: Math.round(demand * 10) / 10,
      parkingDemandBasis: 'forecast: vehicles + 0.6 per household',
      parkingTaken: supply - free,
      parkingFree: free,
      parkingDenied: this.bayRefusals,
      parkingSearchTries: this.dockTries,
      parkingLegRefusals: this.dockLegMisses,
      parkingBayWaits: bayWaits,
      parkingPressure: supply ? Math.round((demand / supply) * 100) / 100 : 1,
      // P-D01: delay and queue read the same window as congestion.
      queueLength: this.queueLength,
      avgWaitSec: this.avgWaitSec,
      delaySec: this.delaySec,
      // P-F04 / P-F06: strays are named and counted, not inferred from a stall.
      strandedVehicles: this.strandedCount,
      strandedOldestSec: Math.round(this.strandedOldest),
      trips: ped ? ped.total : 0,
      vehicleTripsStarted: this.tripStarts,
      vehicleTripsCompleted: this.tripCompletions,
      vehicleTripsCancelled: this.tripCancellations,
      vehicleTripsReached: list.reduce((s, v) => s + v.tripReaches, 0),
      fuelDispensed: Math.round(this.fuelDispensed * 10) / 10,
      tripPurposes: ped ? ped.trips : {},
      avgTripMin: ped ? ped.avgTripMin : 0
    };
  }


  /**
   * Put a vehicle on the road.
   *
   * The only way a `VehicleAgent` comes into existence. It REQUIRES a slot from
   * the vehicle register (`opts.slot`) and refuses without one: a vehicle that
   * nobody owns, and that no amount of population is entitled to, cannot be
   * created here. The old `SIM.maxVehicles` check was a throttle on how many
   * could exist at once, not a statement about where they came from — anyone
   * reaching it got a free car. Title and use now come from the register.
   */
  spawn(count = 1, cell = null, opts = {}) {
    const before = this.vehicles.length;
    const registry = this.town.vehicles;
    // P-F01: a candidate that cannot be given a road pose or its own home pad
    // is skipped and remembered, so one awkward driveway can never abort the
    // whole batch (and leave a town with no private cars at all).
    const rejected = new Set();
    for (let i = 0; i < count; i++) {
      // No slot, no vehicle. This is the invariant that makes the fleet a
      // function of the population rather than of anybody's clicking.
      let slot = opts.slot || registry?.idle?.[0];
      if (!slot) break;
      let type = opts.type || slot.type;
      const civilian = CIVILIAN_VEHICLE_TYPES.some((v) => v.id === type);
      let rigSpec = civilian ? vehicleFootprint(type) : null;
      let eligible = civilian ? this.spawnPool(rigSpec, rejected) : [];
      // P-F01: a bus or a lorry fits in no driveway, so one unlucky type draw
      // must not cost the town its whole founding fleet — redraw until the
      // chosen type actually has somewhere to live. The slot follows the
      // redraw: the register's record is of a vehicle, and a vehicle that
      // changed type is a different vehicle, so take a fresh one from the pool.
      for (let redraws = 0; !opts.type && civilian && !eligible.length && redraws < 16; redraws++) {
        const next = registry.idle.find((s) => s.role === 'civilian');
        if (!next) break;
        type = next.type;
        rigSpec = vehicleFootprint(type);
        eligible = this.spawnPool(rigSpec, rejected);
        if (eligible.length) { slot = next; break; }
      }

      // A slot with a holder is a LEASE: the renter is entitled to the car, so
      // they are the driver, not whoever the RNG would otherwise pick. Falling
      // back to the pool is still correct behaviour (it happens if the renter
      // cannot actually be placed), but the holder must not then be overwritten
      // with a different name — that is what left `runDaily` billing a renter
      // for a car somebody else was driving.
      const holderCitizen = slot.holder?.sector === 'household'
        ? (this.town.pedestrians?.citizens || []).find((c) => c.p.id === slot.holder.id) || null
        : null;
      const citizen = civilian
        ? (holderCitizen && !rejected.has(holderCitizen) && eligible.includes(holderCitizen)
            ? holderCitizen
            : this.rng.pick(eligible)) || null
        : null;
      if (civilian && !citizen) {
        this.spawnFailures.noEligible++;
        this.spawnFailures.lastEligibility = this.eligibilityReport(rigSpec);
        break;
      }
      const rig = buildVehicle({ rng: this.rng, type });
      const driver = citizen?.p || createPersonality(this.rng);
      const agent = new VehicleAgent(this.town, rig, driver);
      if (citizen) { agent.driverCitizen = citizen; citizen.vehicle = agent; }
      // NOTE: the registry bind happens AFTER the pose test below, not here.
      // Binding first and `continue`ing on `noPose` left `slot.agent` pointing at
      // an agent that was never added to `this.vehicles` — and since `idle` is
      // `slots.filter(s => !s.agent)`, that vehicle could never be offered again
      // and `trimToEntitlement` could never reclaim it either (it has a holder).
      // One failed pose permanently removed a car from the town.
      agent.homeLabel = opts.homeLabel || null;
      agent.homeCell = opts.homeCell || null;
      agent.homeKey = opts.stationKey || null;
      if (agent.role === 'civilian') {
        const home = citizen.home;
        if (home) {
          agent.homeBuilding = home;
          if (!agent.homeKey) agent.homeKey = `${home.cell[0]},${home.cell[1]}`;
        }
      }

      const start = cell || (agent.homeBuilding && this.town.nearestRoadCell(...agent.homeBuilding.cell)) || this.town.randomRoadCell(this.rng);
      const pose = start ? this.spawnPose(start, agent.spec) : null;
      if (!pose) {
        // The vehicle exists and the slot is still free — it simply could not be
        // put on the road this instant. The slot must go back on the market
        // untouched, and the geometry just built has to be disposed: this rig is
        // never added to the scene graph, so nothing else will ever release it.
        registry.releaseToMarketFrom(slot);
        disposeObject(rig.group);
        this.spawnFailures.noPose++;
        if (citizen) citizen.vehicle = null;
        if (citizen) rejected.add(citizen);
        continue;
      }
      // Committed: the durable asset now belongs to this agent. The mesh, the
      // driver and the title are three separate facts that happen to line up —
      // the agent can be scrapped tomorrow and the vehicle stays on the register.
      registry.bind(agent, slot);
      // Only a vehicle with no holder yet needs one: a purchase's holder is
      // decided by the sale, and a lease's holder is the renter. Overwriting
      // either with the driver is what made possession and use two different
      // parties.
      if (citizen && !slot.holder) registry.assign(slot, { sector: 'household', id: citizen.p.id });
      rig.group.position.set(
        pose.x,
        this.town.grid.heightAtWorld(pose.x, pose.z),
        pose.z
      );
      rig.group.rotation.y = pose.yaw;
      rig.group.userData.pick = {
        type: 'vehicle',
        title: `${typeLabel(rig.type)} · ${driver.name}`,
        agent
      };
      this.group.add(rig.group);
      this.vehicles.push(agent);
      this.town.pickables.push(rig.group);
      if (agent.role === 'emergency') agent.cooldown = this.rng.float(0, 6);
      else if (agent.role === 'civilian') {
        const bay = this.town.parking?.claimFor(agent, agent.homeBuilding.cell, {
          homeKey: agent.homeKey, maxDistance: 1,
          accept: (s) => s.key === agent.homeKey && (s.kind === 'driveway' || s.kind === 'garage')
        });
        if (!bay) {
          this.spawnFailures.noBay++;
          this.spawnFailures.lastBayMiss = {
            homeKey: agent.homeKey,
            homeCell: agent.homeBuilding?.cell || null,
            spaces: (this.town.parking?.spaces || [])
              .filter((s) => s.key === agent.homeKey)
              .map((s) => ({ kind: s.kind, taken: !!s.taken, cell: s.cell }))
          };
          if (citizen) rejected.add(citizen);
          this.remove(agent);
          continue;
        }
        rig.group.position.set(bay.pos.x, this.town.grid.heightAtWorld(bay.pos.x, bay.pos.z), bay.pos.z);
        rig.group.rotation.y = bay.yaw;
        agent.parkTimer = Infinity;
      } else agent.assignErrands(this.rng);
      if (agent.role !== 'civilian') agent.nextLeg(this.rng);
      if (cell) break;
    }
    return this.vehicles.length > before ? this.vehicles[this.vehicles.length - 1] : null;
  }

  /**
   * The founding fleet, funded by the treasury and registered as town assets.
   *
   * Each unit is a slot in the vehicle register BEFORE it is a mesh on the
   * road, and the treasury is charged for it, so the state fleet is a real
   * balance-sheet item from the first minute. The cost is debited directly here
   * rather than through `procure`, because procurement is a decision made in
   * response to a shortfall and the founding fleet is not one — it is the town
   * opening with the minimum viable public service.
   */
  spawnFleet() {
    const plan = fleetPlan(this.town, this.rng);
    const registry = this.town.vehicles;
    const economy = this.town.economy;
    const spawned = [];
    for (const req of plan) {
      const value = baseValue(req.type);
      // The town cannot open a service it cannot pay for. Skipping is visible —
      // the charter records the shortfall — rather than quietly minting a van.
      if (economy.treasury < value) {
        registry.note(`Treasury cannot fund a ${req.type} for ${req.homeLabel} yet.`);
        continue;
      }
      economy.transfer({
        from: 'government',
        to: 'external',
        amount: value,
        category: 'public_investment',
        metadata: { vehicle: req.type, founding: true }
      });
      const slot = registry.seedFleet(req.type, {
        homeCell: req.homeCell,
        homeLabel: req.homeLabel,
        stationKey: req.stationKey
      });
      const agent = this.spawn(1, req.cell, {
        type: req.type,
        slot,
        homeLabel: req.homeLabel,
        homeCell: req.homeCell,
        stationKey: req.stationKey
      });
      if (agent) spawned.push(agent);
    }
    return spawned;
  }

  fleetStats() {
    return { ...fleetSummary(this.vehicles), spawnFailures: { ...this.spawnFailures } };
  }

  /**
   * One shared fixed simulation step (SRS P-E04). Signals, incidents and the
   * per-frame bookkeeping run once against the caller's frame; traffic and
   * pedestrians sub-divide that frame into the SAME fixed micro-steps and run
   * interleaved, so collision, crossing and signal decisions no longer depend
   * on how many frames the renderer happened to produce. Short frames simply
   * accumulate until a full micro-step is available instead of shrinking it.
   */
  runShared(dt, clock = null) {
    if (clock) this.clock = clock;
    this.town.roadKit?.signals?.update(dt);
    this.town.incidents?.update(dt);

    const peds = this.town.pedestrians;
    peds?.beginFrame?.(dt, clock);

    const FIXED = 0.05;
    // A catch-up BUDGET in agent-time, not a step count. The old `MAX_STEPS = 64`
    // was 3.2 s of simulation per frame, which sounds generous until you notice
    // what `dt` is: `main.js` passes `simDt = dt * speed`, so at the default 100×
    // the system is offered 5.0 s of agent-time per frame and silently consumes
    // 3.2. Above ~15.6 fps that clamp binds PERMANENTLY — the clock, economy,
    // lifecycle, signals, incidents and congestion all advance the full 5 s while
    // vehicles and pedestrians advance 3.2, a steady-state 64/100 ratio with no
    // indication anything is wrong. Measured: `runShared(5.0)` advanced
    // pedestrian time 3.2 s and dropped 1.8.
    //
    // The budget is now explicit, the overflow is reported rather than
    // discarded, and the step count is derived from it — so the loss is a
    // visible number instead of a silent divergence.
    const STEP_BUDGET = 0.8;      // agent-seconds of catch-up per frame
    const wanted = Math.max(0, this.acc + dt);
    const usable = Math.min(wanted, STEP_BUDGET);
    this.acc = usable - Math.floor(usable / FIXED) * FIXED;
    this.droppedSeconds = (wanted - usable);
    if (this.droppedSeconds > 0.01) this.timeDroppedTotal = (this.timeDroppedTotal || 0) + this.droppedSeconds;
    const steps = Math.floor(usable / FIXED);
    if (steps > 0) {
      const stepDt = FIXED;
      const list = this.vehicles;
      for (let i = 0; i < steps; i++) {
        this.releaseJunctions();
        for (const v of list) v.update(stepDt, list, this.rng);
        peds?.step?.(stepDt, clock);
      }
    }

    this.releaseJunctions();
    this.resolveJams(dt);
    this.rescueStuck(dt);
    this.recoverStranded(dt);
    this.computeCongestion(dt);
    peds?.endFrame?.(dt, clock);
    this.trips = this.tripCompletions;
  }

  update(dt, clock = null) {
    this.runShared(dt, clock);
  }


  /**
   * Take a vehicle off the road.
   *
   * This removes the AGENT — the mesh, the driver, the bay claim. It does not
   * destroy the vehicle: the register keeps the asset, unbinds it from this
   * agent and leaves it on the market, so the next person to buy or rent it
   * gets the same car. A failed spawn rolls back through here, which is why the
   * distinction matters: the car was never really here, but it still exists.
   */
  remove(agent) {
    const i = this.vehicles.indexOf(agent);
    if (i >= 0) this.vehicles.splice(i, 1);
    // Hand the asset back before the driver link is cut, so the register still
    // knows who it belonged to. `releaseToMarketFrom` runs first because
    // `unbind` clears `agent.slot`.
    const slot = this.town.vehicles?.unbind(agent);
    this.town.vehicles?.releaseToMarketFrom(slot);
    if (agent.driverCitizen) {
      if (agent.driverCitizen.driving === agent) agent.driverCitizen.enterBuilding(agent.driverCitizen.home);
      agent.driverCitizen.driving = null;
      agent.driverCitizen.vehicle = null;
    }
    this.town.parking?.release(agent);
    this.town.removePickable(agent.group);
    this.group.remove(agent.group);
    for (const [key, claim] of this.junctionClaims) {
      if (claim.vehicle === agent) this.junctionClaims.delete(key);
    }
    agent.group.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    });
  }

  clear() {
    for (const v of this.vehicles.slice()) this.remove(v);
    this.vehicles.length = 0;
    this.junctionClaims.clear();
    this.demandTime = 0;
    this.demandBuckets = [];
    this.demandTrips = [];
  }
}



