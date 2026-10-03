import { events } from '../core/events.js';
import { findPath } from '../core/pathfinding.js';
import { CELL_KIND } from '../core/config.js';

const walkable = (x, y, grid) => grid.kindAt(x, y) === CELL_KIND.ROAD;

/**
 * Small, deterministic bus network. Stops come from the road kit's bus-stop
 * markings; a commissioned depot or hub unlocks the first vehicle. Buses use
 * the normal traffic collision and routing system, while citizens contribute
 * demand through their transport preference and receive a measurable access
 * benefit in the society system.
 */
export class PublicTransportSystem {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(8181);
    this.reset();
  }

  reset() {
    this.stops = [];
    this.route = [];
    this.ridership = 0;
    this.dailyRides = 0;
    this.coverage = 0;
    this.lastDay = -1;
    this.fleet = 0;
    this.networkReady = false;
  }

  rebuild() {
    const g = this.town.grid;
    const stops = [];
    for (const [key, info] of this.town.roadKit?.cellInfo || []) {
      if (!info?.bus) continue;
      const [x, y] = key.split(',').map(Number);
      if (g.isRoad(x, y)) stops.push([x, y]);
    }
    // A small town may have no marked stop yet. A transit hub/depot still gets
    // a usable line by selecting separated road cells near civic sites. The
    // old fallback took the first two cells in grid order, which often meant
    // adjacent stops at one corner and a route that covered nothing useful.
    if (stops.length < 2 && this.town.buildings.some((b) => ['busdepot', 'transit'].includes(b.facility))) {
      const roads = g.roadCells();
      const addStop = (c) => {
        if (c && g.isRoad(c[0], c[1]) && !stops.some((s) => s[0] === c[0] && s[1] === c[1])) stops.push(c);
      };
      const anchors = this.town.buildings
        .filter((b) => b.cell && ['house', 'shop', 'office', 'civic', 'site'].includes(b.kind))
        .map((b) => this.town.nearestRoadCell?.(b.cell[0], b.cell[1]))
        .filter(Boolean);
      for (const c of anchors) {
        addStop(c);
        if (stops.length >= 2) break;
      }
      if (stops.length < 2 && roads.length) addStop(roads[0]);
      if (stops.length < 2 && roads.length) {
        const first = stops[0] || roads[0];
        const farthest = roads
          .filter((c) => c[0] !== first[0] || c[1] !== first[1])
          .sort((a, b) => {
            const da = Math.abs(a[0] - first[0]) + Math.abs(a[1] - first[1]);
            const db = Math.abs(b[0] - first[0]) + Math.abs(b[1] - first[1]);
            return db - da;
          })[0];
        addStop(farthest);
      }
    }
    this.stops = stops.slice(0, 12);
    this.route = [];
    if (this.stops.length >= 2) {
      for (let i = 0; i < this.stops.length - 1; i++) {
        const leg = findPath(g, this.stops[i], this.stops[i + 1], { walkable, maxNodes: 9000 });
        if (!leg) continue;
        this.route.push(...(this.route.length ? leg.slice(1) : leg));
      }
      const back = findPath(g, this.stops[this.stops.length - 1], this.stops[0], { walkable, maxNodes: 9000 });
      if (back) this.route.push(...back.slice(1));
    }
    this.networkReady = this.route.length > 1;
    this.ensureFleet();
  }

  ensureFleet() {
    if (!this.networkReady || !this.town.buildings.some((b) => ['busdepot', 'transit'].includes(b.facility))) {
      this.fleet = this.town.vehicles?.slots?.filter((s) => s.type === 'bus' && !s.scrapped && s.owner?.sector === 'government').length || 0;
      return;
    }
    const slots = this.town.vehicles?.slots || [];
    let stateBus = slots.filter((s) => s.type === 'bus' && !s.scrapped && s.owner?.sector === 'government');
    // Public transport is a population service, not a one-time founding prop.
    // Keep roughly one bus per 120 residents, bounded so a small network does
    // not drain the treasury. Procurement uses the vehicle registry so the
    // asset, station, ledger entry, and live traffic agent stay in sync.
    const pop = this.town.pedestrians?.citizens?.length || 0;
    const required = Math.min(8, Math.max(1, Math.ceil(pop / 120)));
    while (stateBus.length < required) {
      const result = this.town.vehicles?.procure?.('bus', {
        reason: `public transport coverage for ${pop} residents`,
        homeCell: this.stops[0],
        homeLabel: 'Transit network',
        stationKey: 'transit'
      });
      if (!result?.ok) break;
      stateBus.push(result.slot);
      if (stateBus.length === 1) events.emit('log', { text: 'A city bus enters service on the new public transport line.' });
    }
    // A registry slot is only the title to the vehicle; it becomes visible in
    // the world through TrafficSystem.spawn. Seed the agent after the route is
    // known so its first leg can be planned immediately instead of leaving a
    // bus permanently parked with an unbound slot.
    for (const slot of stateBus) {
      if (slot.agent || !this.stops.length) continue;
      const agent = this.town.traffic?.spawn(1, this.stops[0], {
        type: 'bus', slot, homeCell: this.stops[0], homeLabel: 'Transit network', stationKey: 'transit'
      });
      if (agent) {
        agent.transitRoute = this.route;
        agent.transitStopIndex = 0;
        agent.homeCell = this.stops[0];
        agent.homeLabel = 'Transit network';
        agent.nextLeg(this.town.traffic.rng);
      }
    }
    for (const agent of this.town.traffic?.vehicles || []) {
      if (agent.type !== 'bus') continue;
      agent.transitRoute = this.route;
      agent.transitStopIndex = agent.transitStopIndex || 0;
      agent.homeCell = this.stops[0] || agent.homeCell;
      agent.homeLabel = 'Transit network';
    }
    this.fleet = stateBus.length;
  }

  update(_dt, clock) {
    if (!clock) return;
    const pop = this.town.pedestrians?.citizens?.length || 0;
    if (clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      this.rebuild();
      this.coverage = pop ? Math.min(1, (this.stops.length * 4) / Math.max(1, pop)) : 0;
      const citizens = this.town.pedestrians?.citizens || [];
      const eligible = citizens.filter((c) => c.p.preferences?.transport === 'bus' || c.p.preferences?.transport === 'walk');
      this.ridership = Math.round(eligible.length * Math.min(1, this.coverage) * 0.45);
      this.dailyRides = this.ridership * 2;
    }
    this.coverage = pop ? Math.min(1, (this.stops.length * 4) / Math.max(1, pop)) : 0;
    this.ensureFleet();
  }

  stats() {
    return { stops: this.stops.length, routeTiles: this.route.length, fleet: this.fleet, ridership: this.ridership, dailyRides: this.dailyRides, coverage: Math.round(this.coverage * 100) / 100, ready: this.networkReady };
  }
}
