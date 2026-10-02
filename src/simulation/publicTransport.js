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
    // a usable line by selecting two separated road cells near civic sites.
    if (stops.length < 2 && this.town.buildings.some((b) => ['busdepot', 'transit'].includes(b.facility))) {
      const roads = g.roadCells();
      for (const c of roads) {
        if (!stops.some((s) => s[0] === c[0] && s[1] === c[1])) stops.push(c);
        if (stops.length >= 2) break;
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
    if (!stateBus.length && this.town.economy?.treasury >= 45000) {
      const paid = this.town.economy.transfer({ from: 'government', to: 'external', amount: 45000, category: 'public_investment', metadata: { vehicle: 'bus', reason: 'public transport' } });
      if (paid.ok) {
        const slot = this.town.vehicles.seedFleet('bus', { homeCell: this.stops[0], homeLabel: 'Transit network' });
        stateBus = [slot];
        events.emit('log', { text: 'A city bus enters service on the new public transport line.' });
      }
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
    if (clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      this.rebuild();
      const citizens = this.town.pedestrians?.citizens || [];
      const eligible = citizens.filter((c) => c.p.preferences?.transport === 'bus' || c.p.preferences?.transport === 'walk');
      this.ridership = Math.round(eligible.length * Math.min(1, this.coverage) * 0.45);
      this.dailyRides = this.ridership * 2;
    }
    const pop = this.town.pedestrians?.citizens?.length || 0;
    this.coverage = pop ? Math.min(1, (this.stops.length * 4) / Math.max(1, pop)) : 0;
    this.ensureFleet();
  }

  stats() {
    return { stops: this.stops.length, routeTiles: this.route.length, fleet: this.fleet, ridership: this.ridership, dailyRides: this.dailyRides, coverage: Math.round(this.coverage * 100) / 100, ready: this.networkReady };
  }
}
