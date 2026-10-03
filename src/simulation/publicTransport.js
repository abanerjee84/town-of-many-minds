import { events } from '../core/events.js';
import { findPath } from '../core/pathfinding.js';
import { CELL_KIND } from '../core/config.js';
import transportRules from '../data/transportRules.json' with { type: 'json' };

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
    this.manualStops = new Set(this.manualStops || []);
    this.stops = [];
    this.route = [];
    this.ridership = 0;
    this.dailyRides = 0;
    this.coverage = 0;
    this.lastDay = -1;
    this.fleet = 0;
    this.networkReady = false;
  }

  stopKey(x, y) { return `${Math.round(x)},${Math.round(y)}`; }

  placeStop(x, y) {
    const gx = Math.round(x), gy = Math.round(y);
    if (!this.town.grid.inBounds(gx, gy) || !this.town.grid.isRoad(gx, gy)) return { ok: false, reason: 'road_required' };
    const key = this.stopKey(gx, gy);
    if (this.manualStops.has(key)) return { ok: false, reason: 'stop_exists' };
    if (this.manualStops.size >= transportRules.publicTransport.maxStops) return { ok: false, reason: 'stop_limit' };
    this.manualStops.add(key);
    if (this.town.roadKit) this.town.roadKit.manualStops = new Set(this.manualStops);
    this.rebuild();
    return { ok: true, cell: [gx, gy], key };
  }

  removeStop(x, y) {
    const key = this.stopKey(x, y);
    if (!this.manualStops.delete(key)) return { ok: false, reason: 'stop_missing' };
    if (this.town.roadKit) this.town.roadKit.manualStops = new Set(this.manualStops);
    this.rebuild();
    return { ok: true, key };
  }

  serialize() { return { manualStops: [...this.manualStops].sort() }; }

  restore(state = {}) {
    this.manualStops = new Set((state.manualStops || []).filter((key) => /^-?\d+,-?\d+$/.test(String(key))));
    if (this.town.roadKit) this.town.roadKit.manualStops = new Set(this.manualStops);
    this.rebuild();
    return { ok: true, stops: this.manualStops.size };
  }

  rebuild() {
    const g = this.town.grid;
    const stops = [];
    for (const key of this.manualStops) {
      const [x, y] = key.split(',').map(Number);
      if (g.inBounds(x, y) && g.isRoad(x, y)) stops.push([x, y]);
    }
    for (const [key, info] of this.town.roadKit?.cellInfo || []) {
      if (!info?.bus) continue;
      const [x, y] = key.split(',').map(Number);
      if (g.isRoad(x, y) && !stops.some((s) => s[0] === x && s[1] === y)) stops.push([x, y]);
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
    this.stops = stops.slice(0, transportRules.publicTransport.maxStops);
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

  /**
   * Return the civic parcel that owns the line. A literal `transit` station
   * key made the roster look valid even when a bus depot had moved or a hub
   * had been replaced. The station is resolved from the same buildings that
   * unlock the network, so fleet records and the visible civic map agree.
   */
  networkStation() {
    const candidates = (this.town.buildings || [])
      .filter((b) => b.cell && ['busdepot', 'transit'].includes(b.facility))
      .map((building) => {
        const cell = this.town.nearestRoadCell?.(building.cell[0], building.cell[1]) || building.cell;
        const stop = this.stops[0] || cell;
        const distance = Math.abs(cell[0] - stop[0]) + Math.abs(cell[1] - stop[1]);
        return { building, cell, distance };
      })
      .sort((a, b) => a.distance - b.distance || String(a.building.facility).localeCompare(String(b.building.facility)));
    const chosen = candidates[0];
    if (!chosen) return null;
    return {
      building: chosen.building,
      cell: chosen.cell,
      key: `${chosen.building.cell[0]},${chosen.building.cell[1]}`
    };
  }

  ensureFleet() {
    if (!this.networkReady || !this.town.buildings.some((b) => ['busdepot', 'transit'].includes(b.facility))) {
      this.fleet = this.town.vehicles?.slots?.filter((s) => s.type === 'bus' && !s.scrapped && s.owner?.sector === 'government').length || 0;
      return;
    }
    const slots = this.town.vehicles?.slots || [];
    let stateBus = slots.filter((s) => s.type === 'bus' && !s.scrapped && s.owner?.sector === 'government');
    // Public transport is a population service, not a one-time founding prop.
    // Keep roughly one bus per configured resident threshold, bounded so a small network does
    // not drain the treasury. Procurement uses the vehicle registry so the
    // asset, station, ledger entry, and live traffic agent stay in sync.
    const pop = this.town.pedestrians?.citizens?.length || 0;
    const required = Math.min(
      transportRules.publicTransport.maxBuses,
      Math.max(1, Math.ceil(pop / transportRules.publicTransport.residentsPerBus))
    );
    const station = this.networkStation();
    const stationCell = station?.cell || this.stops[0];
    const stationKey = station?.key || (stationCell ? `${stationCell[0]},${stationCell[1]}` : null);
    while (stateBus.length < required) {
      const result = this.town.vehicles?.procure?.('bus', {
        reason: `public transport coverage for ${pop} residents`,
        homeCell: stationCell,
        homeLabel: 'Transit network',
        stationKey
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
      if (stationCell) slot.stationCell = stationCell.slice();
      if (stationKey) slot.stationKey = stationKey;
      if (slot.agent || !this.stops.length) continue;
      const agent = this.town.traffic?.spawn(1, this.stops[0], {
        type: 'bus', slot, homeCell: stationCell || this.stops[0], homeLabel: 'Transit network', stationKey
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
      this.coverage = pop ? Math.min(1, (this.stops.length * transportRules.publicTransport.stopCoverageResidents) / Math.max(1, pop)) : 0;
      const citizens = this.town.pedestrians?.citizens || [];
      const eligible = citizens.filter((c) => c.p.preferences?.transport === 'bus' || c.p.preferences?.transport === 'walk');
      this.ridership = Math.round(eligible.length * Math.min(1, this.coverage) * transportRules.publicTransport.ridershipFactor);
      this.dailyRides = this.ridership * 2;
    }
    this.coverage = pop ? Math.min(1, (this.stops.length * transportRules.publicTransport.stopCoverageResidents) / Math.max(1, pop)) : 0;
    this.ensureFleet();
  }

  stats() {
    const buses = (this.town.vehicles?.slots || [])
      .filter((s) => s.type === 'bus' && !s.scrapped && s.owner?.sector === 'government');
    const operational = buses.filter((slot) => slot.agent?.transitRoute?.length > 1 && slot.stationKey).length;
    return {
      stops: this.stops.length,
      routeTiles: this.route.length,
      fleet: this.fleet,
      operationalFleet: operational,
      ridership: this.ridership,
      dailyRides: this.dailyRides,
      coverage: Math.round(this.coverage * 100) / 100,
      ready: this.networkReady
    };
  }
}
