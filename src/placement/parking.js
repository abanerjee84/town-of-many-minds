/**
 * Off-street parking: every space in town lives here.
 *
 * Spaces are created while the lots are laid out (driveway strips beside the
 * houses, marked bays in parking cells, station bays for the fleet) and are
 * claimed by vehicles when they arrive somewhere instead of idling in a lane.
 * There is no kerbside parking: a vehicle with nowhere to go keeps driving,
 * which is what `parkingPressure` reports.
 */

const keyOf = (x, y) => `${x},${y}`;
const identity = (s) => `${s.kind}:${keyOf(...s.cell)}:${s.pos.x.toFixed(3)},${s.pos.z.toFixed(3)}`;

/** Distance below which two bay pads are the same physical bay after a rebuild. */
const SHIFT_TOLERANCE = 2.25;

export const PARKING_KIND = {
  DRIVEWAY: 'driveway',
  GARAGE: 'garage',
  LOT: 'lot',
  STATION: 'station',
  PUMP: 'pump'
};

export const PARKING_KIND_LABEL = {
  driveway: 'Driveway',
  garage: 'Garage',
  lot: 'Parking lot',
  station: 'Station bay',
  pump: 'Fuel pump'
};

export class ParkingRegistry {
  constructor() {
    this.spaces = [];
    this.index = new Map();
    this.generation = 0;
    this.pendingClaims = new Map();
    this.lastRebuild = { recovered: 0, lost: 0 };
  }

  clear() {
    this.pendingClaims = new Map();
    for (const s of this.spaces) {
      if (s.taken) this.pendingClaims.set(identity(s), { agent: s.taken, from: s });
    }
    this.spaces = [];
    this.index = new Map();
    this.generation++;
  }

  add(space) {
    space.id = this.spaces.length;
    const pending = this.pendingClaims.get(identity(space)) || null;
    const oldAgent = pending ? pending.agent : null;
    space.taken = oldAgent;
    if (oldAgent) {
      this.bind(oldAgent, space);
      this.pendingClaims.delete(identity(space));
    }
    this.spaces.push(space);
    const k = keyOf(space.cell[0], space.cell[1]);
    if (!this.index.has(k)) this.index.set(k, []);
    this.index.get(k).push(space);
    return space;
  }

  /** One claim bound to one bay: agent and registry always agree. */
  bind(agent, space) {
    space.taken = agent;
    agent.parkSpace = space;
    agent.parkGen = this.generation;
    if (agent.docking) agent.docking = space;
    agent.parkingLost = false;
  }

  /**
   * After every bay has been re-added: first try to re-bind a claim whose bay
   * only *moved* (frontage refit, driveway re-strip) so a pad the rebuild
   * published under a new identity is not offered twice, then explicitly
   * release the claims whose bay is genuinely gone. Finally, any bay a
   * stationary vehicle still physically sits on is re-claimed rather than
   * published free (INV-T02).
   */
  finalizeRebuild(agents = []) {
    const leftovers = [...this.pendingClaims.values()];
    this.pendingClaims.clear();
    let recovered = 0;
    let lost = 0;
    for (const row of leftovers) {
      if (this.reattach(row.agent, row.from)) recovered++;
      else {
        lost++;
        this.releaseLost(row.agent);
      }
    }
    let occupied = 0;
    for (const s of this.spaces) {
      if (s.taken) continue;
      const body = agents.find((a) =>
        !a.parkSpace &&
        a.group &&
        (a.parkTimer > 0 || a.docking || a.parkingLost) &&
        Math.hypot(a.group.position.x - s.pos.x, a.group.position.z - s.pos.z) <
          Math.min(s.length, s.width) * 0.5 + 0.4
      );
      if (!body) continue;
      this.bind(body, s);
      occupied++;
    }
    this.lastRebuild = { recovered, lost, occupied };
    return this.lastRebuild;
  }

  /** Same physical bay under a new identity — keep the claim, never the ghost. */
  reattach(agent, from) {
    if (!agent || agent.parkSpace) return false;
    const w = agent.spec.width;
    const l = agent.spec.length;
    let best = null;
    let bestD = SHIFT_TOLERANCE;
    for (const s of this.spaces) {
      if (s.taken) continue;
      if (s.kind !== from.kind && !(s.kind === PARKING_KIND.LOT || from.kind === PARKING_KIND.LOT)) continue;
      if (s.width + 0.2 < w || s.length + 0.25 < l) continue;
      const d = Math.hypot(s.pos.x - from.pos.x, s.pos.z - from.pos.z);
      if (d > bestD) continue;
      bestD = d;
      best = s;
    }
    if (!best) return false;
    this.bind(agent, best);
    return true;
  }

  /**
   * INV-T01: a claim whose bay vanished is cancelled outright and the vehicle
   * is flagged for a safe-road recovery; it never keeps a stale generation.
   */
  releaseLost(agent) {
    agent.parkSpace = null;
    agent.parkGen = 0;
    agent.docking = null;
    agent.parkTimer = 0;
    agent.points = [];
    agent.idx = 0;
    agent.dockRetryT = 0;
    agent.dockDwell = null;
    agent.parkingLost = true;
  }

  at(x, y) {
    return this.index.get(keyOf(x, y)) || [];
  }

  release(agent) {
    const space = agent.parkSpace;
    agent.parkSpace = null;
    if (!space) return;
    if (agent.parkGen !== this.generation) return;
    if (space.taken === agent) space.taken = null;
  }

  /**
   * The kind and size rules `claimFor` applies to a space, independent of
   * whether it is currently occupied.
   *
   * `routeToBay` has to ask exactly this question before it drives somewhere.
   * Left to its own checks it will happily send a civilian to a staffed
   * station bay the claim it is racing towards can never grant — the vehicle
   * arrives, is refused, waits, is routed to the same bay's other approach
   * cell, and repeats for as long as the trip lasts. Two components that must
   * agree should not each keep their own copy of the rule.
   */
  claimable(s, agent, opts = {}) {
    if (s.kind === PARKING_KIND.STATION && agent.role === 'civilian') return false;
    if (s.kind === PARKING_KIND.PUMP && s.siteId !== opts.pumpSiteId) return false;
    if (opts.pumpSiteId && s.kind !== PARKING_KIND.PUMP) return false;
    if (s.width + 0.2 < agent.spec.width || s.length + 0.25 < agent.spec.length) return false;
    return true;
  }

  /**
   * Is there anything at all where the agent stands that could become
   * claimable — a bay of the right kind and size within `maxDistance`,
   * whether or not somebody is in it right now? A false answer means waiting
   * cannot help: every bay in range is simply not this agent's to use.
   */
  claimableInRange(agent, cell, maxDistance = Infinity, opts = {}) {
    for (const s of this.spaces) {
      if (!this.claimable(s, agent, opts)) continue;
      const d = Math.abs(s.cell[0] - cell[0]) + Math.abs(s.cell[1] - cell[1]);
      if (d <= maxDistance) return true;
    }
    return false;
  }

  /**
   * Nearest space the agent fits in. Its own driveway (or station bay) wins,
   * then plain distance, with lots used only when nothing closer is free.
   */
  claimFor(agent, cell, opts = {}) {
    const homeKey = opts.homeKey;
    const maxDistance = opts.maxDistance ?? Infinity;
    let best = null;
    let bestScore = Infinity;
    for (const s of this.spaces) {
      if (s.taken) continue;
      if (!this.claimable(s, agent, opts)) continue;
      const d = Math.abs(s.cell[0] - cell[0]) + Math.abs(s.cell[1] - cell[1]);
      if (d > maxDistance) continue;
      if (opts.accept && !opts.accept(s)) continue;
      let score = d * 2;
      if (homeKey && s.key === homeKey) score -= 12;
      else if (s.kind === PARKING_KIND.STATION && homeKey && s.stationKey === homeKey) score -= 12;
      else if (s.kind === PARKING_KIND.LOT) score += 1;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return null;
    // One binding path: bind() also carries `docking` forward and clears
    // `parkingLost`, which the inline three-line version of this claim used to
    // drop — a vehicle claiming a bay here could keep a stale docking target
    // or a stale lost flag that finalizeRebuild then acted on.
    this.bind(agent, best);
    return best;
  }

  supply() {
    return this.spaces.length;
  }

  free() {
    let n = 0;
    for (const s of this.spaces) if (!s.taken) n++;
    return n;
  }

  stats() {
    const byKind = {};
    let taken = 0;
    for (const s of this.spaces) {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
      if (s.taken) taken++;
    }
    return { supply: this.spaces.length, taken, free: this.spaces.length - taken, byKind };
  }

  describe(x, y) {
    const list = this.at(x, y);
    if (!list.length) return null;
    const s = list[0];
    return {
      kind: s.kind,
      label: PARKING_KIND_LABEL[s.kind] || s.kind,
      bays: list.length,
      free: list.filter((v) => !v.taken).length
    };
  }
}
