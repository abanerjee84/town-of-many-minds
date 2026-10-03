import * as THREE from 'three';
import { CELL_KIND } from '../../core/config.js';
import { box, cyl, cone, buildMesh } from '../geometry.js';
import { events } from '../../core/events.js';
import { basePrice, quotePrice } from '../../simulation/priceChart.js';

const EXPANSION_COST = Object.freeze({
  power: basePrice('utility.power', 42000),
  water: basePrice('utility.water', 26000),
  sewage: basePrice('utility.sewage', 31000)
});

export const UTILITY = {
  POWER: 'power',
  WATER: 'water',
  SEWAGE: 'sewage'
};

export const UTILITY_LABEL = {
  power: 'Electricity',
  water: 'Water',
  sewage: 'Sewage'
};

export const UTILITY_UNIT = {
  power: 'kW',
  water: 'm³/day',
  sewage: 'm³/day'
};

const PLANT_LABEL = {
  power: 'Substation',
  water: 'Water tower',
  sewage: 'Sewage plant'
};

const RATING = {
  power: 2600,
  water: 460,
  sewage: 340
};

function inSet(kind, i) {
  if (kind === UTILITY.POWER) return i % 3 !== 2;
  if (kind === UTILITY.WATER) return i % 3 !== 1;
  return i % 3 !== 0;
}

function demandOf(town, kind) {
  if (kind === UTILITY.POWER) {
    let d = 0;
    for (const b of town.buildings) {
      d += b.purpose === 'commercial' ? 12 + b.capacity * 0.7
        : b.purpose === 'civic' ? 22 + b.capacity * 0.5
        : 4 + b.capacity * 1.1;
    }
    return Math.round(d);
  }
  const pop = town.pedestrians?.citizens?.length || 0;
  const shops = town.buildings.filter((b) => b.purpose === 'commercial').length;
  if (kind === UTILITY.WATER) return Math.round(pop * 1.5 + shops * 7);
  return Math.round(pop * 1.3 + shops * 5);
}

function nearestRoadNode(graph, gx, gy) {
  if (!graph) return null;
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const id = graph.nodeAt(gx + dx, gy + dy);
        if (id !== null && id !== undefined) return id;
      }
    }
  }
  return null;
}

function reachable(graph, edges, start) {
  const seen = new Set();
  if (start === null || start === undefined) return seen;
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const n = stack.pop();
    const node = graph.nodes[n];
    if (!node) continue;
    for (const eid of node.links || []) {
      const e = edges[eid];
      if (!e) continue;
      for (const nb of [e.a, e.b]) {
        if (nb === null || nb === undefined || seen.has(nb)) continue;
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen;
}

/**
 * Utility Kit (1.7): electricity, water and sewage networks laid out along the
 * road corridor as greenfield graphs, with plant sites, per-network capacity,
 * demand and coverage. Phase 4 economy/infrastructure reads `stats()`.
 */
export class UtilitySystem {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'utilities';
    this.networks = {};
    this.expansionLevels = { power: 0, water: 0, sewage: 0 };
    this.plants = [];
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.townRef = null;
    this.lastDay = null;
  }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.networks = {};
    this.plants = [];
    this.nodeCount = 0;
    this.edgeCount = 0;
  }

  build(town, rng) {
    this.clear();
    this.townRef = town;
    this.lastDay = null;
    const g = town.grid;
    const graph = town.roadKit?.graph;
    const edges = graph?.edges || [];
    if (!edges.length) return this;

    const sites = this.pickSites(g, rng);
    const geos = [];

    [UTILITY.POWER, UTILITY.WATER, UTILITY.SEWAGE].forEach((kind, ki) => {
      const site = sites[ki] || sites[0];
      const net = {
        kind,
        label: UTILITY_LABEL[kind],
        plant: site ? { x: site[0], y: site[1] } : null,
        plantNode: site ? nearestRoadNode(graph, site[0], site[1]) : null,
        edgeIds: [],
        capacity: RATING[kind] + (this.expansionLevels[kind] || 0) * Math.round(RATING[kind] * 0.5),
        expanded: this.expansionLevels[kind] || 0,
        demand: demandOf(town, kind),
        coverage: 0,
        saturated: false
      };

      edges.forEach((e, i) => {
        if (inSet(kind, i) || (this.expansionLevels[kind] || 0) > 0) net.edgeIds.push(e.id);
      });

      const owned = net.edgeIds.map((id) => edges[id]).filter(Boolean);
      const reached = reachable(graph, edges, net.plantNode);
      const connectedEdges = (this.expansionLevels[kind] || 0) > 0
        // The first capacity expansion installs a feeder across every road
        // edge in the town. Keeping the old plant-node reachability filter
        // after that point left disconnected service at 88.9% forever, so the
        // planner repeatedly bought capacity that could never improve the
        // service factor. An expanded network is the model's explicit feeder
        // build-out and therefore serves all owned edges.
        ? owned
        : owned.filter(
            (e) =>
              (e.a !== null && reached.has(e.a)) ||
              (e.b !== null && reached.has(e.b)) ||
              (e.a === null && e.b === null)
          );

      const netEdgeIds = new Set(connectedEdges.map((e) => e.id));
      net.servedEdges = netEdgeIds;
      net.reached = reached;

      let hits = 0;
      let taps = 0;
      for (const b of town.buildings) {
        const p = town.parcels?.at(b.cell[0], b.cell[1]);
        const fronts =
          Array.isArray(p?.frontage) && p.frontage.length
            ? p.frontage.map((f) => [f.dx, f.dy])
            : [[0, -1], [1, 0], [0, 1], [-1, 0]];
        taps++;
        for (const [dx, dy] of fronts) {
          const e = graph.edgeAt(b.cell[0] + dx, b.cell[1] + dy);
          if (e && netEdgeIds.has(e.id)) {
            hits++;
            break;
          }
        }
      }
      net.coverage = taps ? Math.round((hits / taps) * 1000) / 10 : 0;
      net.saturated = net.demand > net.capacity;

      if (site) {
        geos.push(...this.plantGeometry(kind, g, site[0], site[1], net.expanded));
        this.plants.push({ kind, x: site[0], y: site[1], label: PLANT_LABEL[kind] });
      }
      geos.push(...this.conductorGeometry(kind, g, connectedEdges));

      this.networks[kind] = net;
    });

    this.nodeCount = graph.nodes.length;
    this.edgeCount = edges.length;

    const mesh = buildMesh(geos, { roughness: 0.8 });
    if (mesh) {
      mesh.name = 'utilities';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return this;
  }

  pickSites(g, rng) {
    const cands = [];
    const cx = g.w / 2;
    const cy = g.h / 2;
    g.forEach((x, y, grid) => {
      if (grid.kindAt(x, y) !== CELL_KIND.EMPTY) return;
      if (grid.zone[grid.idx(x, y)]) return;
      let road = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (grid.isRoad(x + dx, y + dy)) road++;
      }
      if (road < 1 || road > 2) return;
      cands.push([x, y, Math.hypot(x - cx, y - cy) + rng.float(-2, 2)]);
    });
    cands.sort((a, b) => a[2] - b[2]);
    const out = [];
    for (const c of cands) {
      if (out.some((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) < 9)) continue;
      out.push([c[0], c[1]]);
      if (out.length >= 3) break;
    }
    return out;
  }

  plantGeometry(kind, g, x, y, level = 0) {
    const p = g.cellToWorld(x, y);
    const out = [];
    if (kind === UTILITY.POWER) {
      out.push(box(2.4, 0.28, 2.0, 0x9b968c, p.x, 0.14, p.z));
      out.push(box(1.9, 1.0, 1.4, 0xb9b3a6, p.x, 0.78, p.z));
      for (const s of [-1, 1]) {
        out.push(cyl(0.42, 0.42, 0.9, 0x8d949c, p.x + s * 0.55, 1.7, p.z, 12));
        out.push(cyl(0.16, 0.16, 0.5, 0x6f767e, p.x + s * 0.55, 2.3, p.z, 8));
      }
      out.push(box(2.6, 0.9, 0.06, 0x7d848c, p.x, 0.6, p.z + 1.1));
      // Expansion levels add a visible storage bay, so a utility upgrade reads
      // as a construction block instead of only a changed number in the HUD.
      for (let i = 0; i < level; i++) {
        const bx = p.x - 0.82 + i * 0.55;
        out.push(box(0.42, 0.72, 0.56, 0x5f7280, bx, 0.55, p.z - 1.0));
        out.push(box(0.3, 0.08, 0.44, 0x8fb6c5, bx, 0.95, p.z - 1.0));
      }
    } else if (kind === UTILITY.WATER) {
      out.push(box(2.2, 0.24, 2.2, 0xa8a294, p.x, 0.12, p.z));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          out.push(cyl(0.1, 0.13, 2.6, 0x7f858c, p.x + sx * 0.7, 1.5, p.z + sz * 0.7, 8));
        }
      }
      out.push(cyl(1.0, 1.0, 1.15, 0x5f93a8, p.x, 3.35, p.z, 16));
      out.push(cone(1.02, 0.5, 0x4d7a8c, p.x, 4.17, p.z, 16));
      out.push(cyl(0.09, 0.09, 0.6, 0x7f858c, p.x, 4.7, p.z, 6));
      if (level > 0) {
        out.push(cyl(0.48, 0.48, 0.44, 0x87b7c9, p.x - 1.0, 0.5, p.z + 0.9, 12));
        out.push(cyl(0.18, 0.18, 0.14, 0x5f93a8, p.x - 1.0, 0.73, p.z + 0.9, 12));
      }
    } else {
      out.push(box(2.5, 0.3, 2.1, 0x938e84, p.x, 0.15, p.z));
      out.push(box(1.7, 0.8, 1.5, 0xa9a396, p.x - 0.3, 0.7, p.z));
      for (const s of [-1, 1]) {
        out.push(cyl(0.72, 0.72, 0.5, 0x7d8a86, p.x + 0.3, 0.55, p.z + s * 0.62, 16));
        out.push(cyl(0.5, 0.5, 0.16, 0x5d6a66, p.x + 0.3, 0.86, p.z + s * 0.62, 16));
      }
      if (level > 0) {
        out.push(cyl(0.62, 0.62, 0.1, 0x8da9a1, p.x - 0.9, 0.42, p.z, 16));
        out.push(cyl(0.48, 0.48, 0.08, 0x4f7568, p.x - 0.9, 0.52, p.z, 16));
      }
    }
    return out;
  }

  conductorGeometry(kind, g, connEdges) {
    const out = [];
    for (const e of connEdges) {
      const cells = e.cells || [];
      if (!cells.length) continue;
      if (kind === UTILITY.POWER) {
        for (let i = 0; i < cells.length; i += 2) {
          const [x, y] = cells[i];
          const nx = cells[Math.min(i + 1, cells.length - 1)];
          const dx = Math.sign(nx[0] - x);
          const dy = Math.sign(nx[1] - y);
          const p = g.cellToWorld(x, y);
          const ox = dy !== 0 ? 1.55 : 0;
          const oz = dx !== 0 ? 1.55 : 0;
          out.push(cyl(0.07, 0.09, 3.4, 0x6b5a45, p.x + ox, 1.7, p.z + oz, 8));
          const alongX = dx !== 0;
          out.push(
            box(alongX ? 1.1 : 0.1, 0.1, alongX ? 0.1 : 1.1, 0x6b5a45, p.x + ox, 3.2, p.z + oz)
          );
        }
      } else if (kind === UTILITY.SEWAGE) {
        for (let i = 0; i < cells.length; i += 3) {
          const [x, y] = cells[i];
          const p = g.cellToWorld(x, y);
          out.push(cyl(0.34, 0.34, 0.07, 0x4f545a, p.x, 0.17, p.z, 14));
          out.push(cyl(0.3, 0.3, 0.04, 0x666b72, p.x, 0.21, p.z, 14));
        }
      } else {
        for (let i = 1; i < cells.length; i += 4) {
          const [x, y] = cells[i];
          const p = g.cellToWorld(x, y);
          out.push(box(0.34, 0.24, 0.34, 0x4a7d54, p.x, 0.28, p.z));
          out.push(box(0.26, 0.05, 0.26, 0x3b6444, p.x, 0.42, p.z));
        }
      }
    }
    return out;
  }

  update(clock) {
    if (!clock) return;
    if (this.lastDay === null || this.lastDay === undefined) {
      this.lastDay = clock.day;
      return;
    }
    if (clock.day === this.lastDay) return;
    this.lastDay = clock.day;
    this.refresh(this.townRef);
  }

  refresh(town) {
    if (!town) return;
    const out = [];
    for (const kind of [UTILITY.POWER, UTILITY.WATER, UTILITY.SEWAGE]) {
      const n = this.networks[kind];
      if (!n) continue;
      const was = n.saturated;
      n.demand = demandOf(town, kind);
      n.saturated = n.demand > n.capacity;
      if (n.saturated !== was) out.push(kind);
      if (n.saturated && !was) {
        events.emit('log', {
          text: `${UTILITY_LABEL[kind]} demand outruns supply — ${n.demand}/${n.capacity} ${UTILITY_UNIT[kind]}.`
        });
      } else if (!n.saturated && was) {
        events.emit('log', { text: `${UTILITY_LABEL[kind]} supply recovers.` });
      }
    }
    return out;
  }

  expansionCost(kind) {
    return quotePrice(`utility.${kind}`, this.townRef, { fallback: EXPANSION_COST[kind] || 30000 });
  }

  expand(kind) {
    const n = this.networks[kind];
    if (!n) return false;
    this.expansionLevels[kind] = (this.expansionLevels[kind] || 0) + 1;
    n.capacity += Math.round(RATING[kind] * 0.5);
    n.expanded = this.expansionLevels[kind];
    n.saturated = n.demand > n.capacity;
    // An expansion installs conductors along the reachable road network as
    // well as raising transformer/pump capacity. Rebuild applies both effects.
    this.townRef?.rebuildStatic?.();
    events.emit('log', {
      text: `Crews extend ${UTILITY_LABEL[kind].toLowerCase()} capacity and coverage — capacity now ${n.capacity} ${UTILITY_UNIT[kind]}.`
    });
    return true;
  }

  /** Demand right now for one network, recomputed on read. */
  electricityState() {
    const network = this.stats().types.power;
    const generation = this.townRef?.resources?.stats?.().types.energy;
    const generationFactor = generation ? Math.min(1, generation.production / Math.max(1, generation.demand)) : 1;
    const distributionFactor = network ? Math.min(1, network.capacity / Math.max(1, network.demand)) : 1;
    const coverageFactor = network ? Math.min(1, network.coverage / 100) : 1;
    const factors = { generation: generationFactor, distribution: distributionFactor, coverage: coverageFactor };
    return {
      generationCapacity: generation?.production || 0, currentGeneration: generation?.production || 0,
      demand: generation?.demand || network?.demand || 0,
      distributionCapacity: network?.capacity || 0, coveragePct: network?.coverage || 0,
      generationFactor, distributionFactor, coverageFactor,
      serviceFactor: Math.min(...Object.values(factors)),
      limiting: Object.entries(factors).sort((a, b) => a[1] - b[1])[0][0]
    };
  }
  liveDemand(kind) {
    const n = this.networks[kind];
    if (!n) return null;
    return this.townRef ? demandOf(this.townRef, kind) : n.demand;
  }

  /**
   * Read-side view of the networks. Phase 7: demand and saturation are
   * recomputed here rather than copied from the last daily `refresh()`, so
   * the report never quotes a figure the town has already outgrown.
   * `n.demand`/`n.saturated` are deliberately left alone — only refresh()
   * and expand() may change them, so saturation events still fire exactly
   * once per crossing instead of on every read.
   */
  stats() {
    const out = { plants: this.plants.length, nodes: this.nodeCount, edges: this.edgeCount, types: {} };
    for (const k of [UTILITY.POWER, UTILITY.WATER, UTILITY.SEWAGE]) {
      const n = this.networks[k];
      if (!n) continue;
      const demand = this.liveDemand(k);
      // An expansion is the feeder build-out: it makes the network available
      // to the town's existing lots even when the seed graph had a few
      // unreachable frontage taps. Keeping the pre-expansion graph percentage
      // here made the planner buy the same capacity forever without changing
      // service, which drained developer capital and halted factories.
      const coverage = (n.expanded || 0) > 0 ? 100 : n.coverage;
      out.types[k] = {
        label: n.label,
        capacity: n.capacity,
        demand,
        unit: UTILITY_UNIT[k],
        coverage,
        saturated: demand > n.capacity,
        expanded: n.expanded || 0,
        headroom: Math.round(n.capacity - demand),
        edges: n.edgeIds.length,
        served: n.servedEdges ? n.servedEdges.size : 0
      };
    }
    out.strained = Object.entries(out.types)
      // Rated capacity alone is not enough: an unserved network can have
      // plenty of headroom on paper while its coverage factor is zero. The
      // council needs that failure in the same strain channel as saturation
      // so expansion is ordered before factories and households stall.
      .filter(([, t]) => t.saturated || (t.coverage < 90 && t.demand > 100))
      .map(([k]) => k);
    return out;
  }

  describe(x, y) {
    const plants = this.plants.filter((p) => p.x === x && p.y === y);
    if (!plants.length) return null;
    const p = plants[0];
    const n = this.networks[p.kind];
    const demand = this.liveDemand(p.kind);
    return {
      kind: p.kind,
      label: p.label,
      utility: UTILITY_LABEL[p.kind],
      capacity: n?.capacity,
      demand,
      unit: UTILITY_UNIT[p.kind],
      coverage: n?.coverage,
      saturated: n ? demand > n.capacity : undefined
    };
  }
}
