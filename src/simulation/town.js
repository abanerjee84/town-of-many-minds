import * as THREE from 'three';
import { CELL, CELL_KIND, ZONE, MAX_FLOORS, EXTENT, SIM } from '../core/config.js';
import { Grid, ROAD_FEATURE, DIRS } from '../core/grid.js';
import { makeRng } from '../core/rng.js';
import { RoadKit } from '../kits/roads/roadKit.js';
import { straightAxis, classify } from '../kits/roads/components.js';
import { classIndex, classFromCode } from '../kits/roads/crossSection.js';
import { disposeObject } from '../world/scene.js';
import { merge } from '../kits/geometry.js';
import { sharedWindowGlow, pruneGlows } from '../kits/glow.js';
import { makeSign } from '../kits/sign.js';
import { TrafficSystem } from './traffic.js';
import { VehicleRegistry } from './vehicleRegistry.js';
import { IncidentBoard } from './incidents.js';
import { CitizenSystem } from './pedestrians.js';
import { LifecycleSystem } from './lifecycle.js';
import { EconomySystem } from './economy.js';
import { GrowthSystem, MAX_BRIDGE_GAP } from './growth.js';
import { StreetGlow } from './streetGlow.js';
import { GovernanceSystem } from './governance.js';
import { IndustrySystem } from './industry.js';
import { PolicySystem } from './policy.js';
import { ResearchSystem } from './innovation.js';
import { PerimeterSystem } from './perimeter.js';
import { PublicTransportSystem } from './publicTransport.js';
import { SocietySystem } from './society.js';
import { civicVerticalCap, CIVIC_ORDER } from '../kits/civic/civicKit.js';
import {
  placeInitialTown, layoutLots, rebuildZone, createBuilding, isAdjacentToRoad
} from '../placement/startPlacement.js';
import { ParcelKit } from '../placement/parcels.js';
import { ParkingRegistry } from '../placement/parking.js';
import { rebuildHouse, expandHouse, changedRoles } from '../kits/houses/houseKit.js';
import { UtilitySystem } from '../kits/utilities/utilityKit.js';
import { ResourceSystem, resourceStress } from '../kits/resources/resourceKit.js';
import { publicSpaceStats, publicSpaceUse } from '../kits/publicspace/publicKit.js';
import { ForestSystem } from './forest.js';
import { WeatherSystem } from './weather.js';
import { validateTown } from '../placement/validator.js';
import { planConnectedRoad, splitsNetwork, hasNetworkAccess, planFootway } from '../placement/placementController.js';
import { agriculturalSetbackConflict, resourceSetbackConflict, educationCampusConflict } from '../placement/siteRules.js';
import { events } from '../core/events.js';
import { exportIntegrityState, importIntegrityState } from './integrityState.js';
import { BUILTIN_KIT_REGISTRY } from '../kits/kitRuntime.js';
import { recordPriceHistory, priceHistory } from './priceChart.js';

export const GRID_W = EXTENT.w;
export const GRID_H = EXTENT.h;

/** Lumber credited to the storehouse for every tree a cell carried. */
const TIMBER_PER_TREE = 4;

/**
 * The rebuild scope for a change that only moves decoration.
 *
 * `layoutLots` reads `customProps`, so the lot layer genuinely has to be re-laid.
 * Nothing else does: a tree is not a road, a zone boundary, a utility run or a
 * resource site, so the road kit, the road mask, the road-graph version, both
 * utility builds and the town validation are all untouched by it.
 */
const PROP_ONLY = { roads: false, lots: true, validate: false };

export class Town {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'town';
    scene.add(this.root);

    this.roadsGroup = new THREE.Group();
    this.lotsGroup = new THREE.Group();
    this.buildingsGroup = new THREE.Group();
    this.root.add(this.roadsGroup, this.lotsGroup, this.buildingsGroup);

    this.grid = new Grid(GRID_W, GRID_H);
    this.rng = makeRng(1);
    this.seed = 1;
    this.entityIds = { building: 1, household: 1 };
    this.roadKit = new RoadKit(this.grid, this.rng);
    this.buildings = [];
    this.pickables = [];
    this.leisureSpots = [];
    this.customProps = new Map();
    this.civicNames = new Map();
    this.parkFeature = false;
    this.parcels = new ParcelKit();
    this.parking = new ParkingRegistry();
    this.roadGraphVersion = 0;
    // Road-network connectivity, rebuilt only when the graph version moves.
    this._roadComp = null;
    this._roadCompVersion = -1;
    // Phase 8 — cells the council paved for parking. layoutLots renders a bay
    // on every one of them regardless of its own roll, so the order survives
    // every rebuild; the bulldozer (or a build landing on the cell) drops it.
    this.parkingPlanned = new Set();
    // EXTEND_STREET's afterglow: the tiles a street order just paved, lit for
    // five game hours (see streetGlow.js).
    this.streetGlow = new StreetGlow(this);
    this.utilities = new UtilitySystem();
    this.resources = new ResourceSystem();
    this.forest = new ForestSystem(this);
    this.weather = new WeatherSystem(this);
    this.publicPlan = null;
    this.pipeline = null;
    this.pipelineSummary = null;
    this.validation = null;
    this.priceHistory = [];

    this.traffic = new TrafficSystem(this);
    // The vehicle register. TrafficSystem owns the BEHAVIOUR of whatever is
    // driving; this owns the durable ASSET — who holds the title, who is
    // using it, what it is worth. Every agent in `traffic` is bound to a slot
    // here, and a slot exists whether or not anybody is currently driving it.
    this.vehicles = new VehicleRegistry(this);
    this.pedestrians = new CitizenSystem(this);
    this.lifecycle = new LifecycleSystem(this);
    this.economy = new EconomySystem(this);
    this.growth = new GrowthSystem(this);
    this.governance = new GovernanceSystem(this);
    this.industry = new IndustrySystem(this);
    this.incidents = new IncidentBoard(this);
    this.perimeter = new PerimeterSystem(this);
    this.transport = new PublicTransportSystem(this);
    this.society = new SocietySystem(this);
    // Kit registry is the compatibility boundary for the gradual plugin
    // migration. Existing systems keep their public APIs while ownership,
    // catalogue rows, intent routes, and versions become discoverable here.
    this.kits = BUILTIN_KIT_REGISTRY;
    // Phase 15 — schemes, statutes and jurisdiction. One interpreter, read by
    // economy, lifecycle, pedestrians, growth and the resources.
    this.policy = new PolicySystem();
    this.policy.townRef = this;
    this.policy.recompute();
    this.research = new ResearchSystem();
    this.research.townRef = this;
    this.root.add(
      this.traffic.group,
      this.pedestrians.group,
      this.utilities.group,
      this.resources.group,
      this.incidents.group
    );
    this._kitClockDay = null;
    this.kits?.invoke?.('create', this, { clock: null });
  }

  generate(seed) {
    this.clearTown();
    // Treat a numeric seed entered in the browser the same as the numeric
    // seed used by headless probes. Without this normalization, `1337` and
    // `"1337"` hash through different RNG paths and produce two different
    // founding footprints, which makes visual audits and regressions disagree.
    const normalizedSeed = typeof seed === 'string' && /^[-+]?\d+$/.test(seed.trim())
      ? Number(seed)
      : seed;
    this.seed = normalizedSeed;
    this.kits?.invalidateContext?.(this);
    this._kitClockDay = null;
    this.entityIds = { building: 1, household: 1 };
    this.rng = makeRng(normalizedSeed);
    this.forest.reset(normalizedSeed);
    this.weather.reset(normalizedSeed);
    this.priceHistory = [];
    this.swapGrid();
    this.roadKit = new RoadKit(this.grid, this.rng);
    this.parcels = new ParcelKit();
    this.utilities = new UtilitySystem();
    this.incidents?.resetRng(this.rng);
    this.perimeter.reset();
    this.transport.rng = this.rng.fork(8181);
    this.transport.manualStops = new Set();
    this.transport.reset();
    this.society.rng = this.rng.fork(9191);
    this.society.reset();
    this.publicPlan = null;
    this.pipeline = null;
    this.pipelineSummary = null;
    this.validation = null;
    this.traffic.rng = this.rng.fork(11);
    this.pedestrians.rng = this.rng.fork(29);
    this.pedestrians.agentRng = this.rng.fork(2903);
    this.lifecycle.rng = this.rng.fork(501);
    this.lifecycle.reset();
    this.economy.rng = this.rng.fork(4407);
    this.economy.reset();
    // Reset the register before founding, so the founding fleet is seeded into
    // a clean one. The registry has no RNG of its own — it draws from the town's
    // — so there is nothing else to re-seed here.
    this.vehicles.reset();
    this.growth.rng = this.rng.fork(9111);
    this.growth.reset();
    this.governance.rng = this.rng.fork(6006);
    this.governance.reset();
    this.industry.rng = this.rng.fork(3701);
    this.industry.reset();
    this.policy.townRef = this;
    this.policy.reset();
    this.policy.recompute();
    this.research.townRef = this;
    this.research.reset();
    this.kits?.invoke?.('reset', this, { seed: normalizedSeed });
    placeInitialTown(this, this.rng);
    this.perimeter.seed();
    // Seed after the serviced envelope is known so the dense woodland hugs the
    // founding edge and the rest of the build plate reads as wooded frontier.
    this.forest.seedInitial();
    this.society.rebuild();
    this.transport.rebuild();
    this.economy.rebuild();
    this.kits?.invoke?.('generate', this, { seed: normalizedSeed });
    // Now that every founding citizen's opening cash has been reconciled against
    // the outside world, give each household a savings account — so a household
    // has deposits to spend on day one and "can I afford this?" is a real
    // question from the first minute. After `rebuild` on purpose: see the note
    // in the `agents` pipeline step.
    for (const citizen of this.pedestrians.citizens) this.economy.openFirstAccount(citizen);
    // Then open the private vehicle market. The town starts with as many
    // vehicles as its thirty residents are entitled to — no more — and the
    // households that can afford one buy it. Nobody is handed a car.
    this.vehicles.releaseToMarket();
    this.vehicles.settleMarket({ onlyBuyers: true });
  }

  fullReset(seed) {
    this.customProps.clear();
    this.forest?.reset(this.seed || 1);
    this.civicNames = new Map();
    this.parkFeature = false;
    this.playCount = 0;
    this.generate(seed);
  }

  /** Give registered kits one disposal boundary before the scene is torn down. */
  dispose() {
    this.kits?.dispose?.(this);
    this.clearTown();
    this.scene?.remove?.(this.root);
  }

  /** Stable monotonic identities; never derived from an array position. */
  nextEntityId(kind) {
    const value = this.entityIds[kind] || 1;
    this.entityIds[kind] = value + 1;
    return `${kind}-${value}`;
  }

  exportIntegrityState() { return exportIntegrityState(this); }
  importIntegrityState(saved) { return importIntegrityState(this, saved); }

  placeTransitStop(x, y) {
    const result = this.transport?.placeStop?.(x, y) || { ok: false, reason: 'transport_unavailable' };
    if (result.ok) {
      this.roadKit.manualStops = new Set(this.transport.manualStops);
      this.rebuildStatic({ roads: true, lots: false, validate: false });
      this.transport.rebuild();
    }
    return result;
  }

  removeTransitStop(x, y) {
    const result = this.transport?.removeStop?.(x, y) || { ok: false, reason: 'transport_unavailable' };
    if (result.ok) {
      this.roadKit.manualStops = new Set(this.transport.manualStops);
      this.rebuildStatic({ roads: true, lots: false, validate: false });
      this.transport.rebuild();
    }
    return result;
  }

  roadHeightAt(worldX, worldZ) {
    const { x, y } = this.grid.worldToCell(worldX, worldZ);
    if (!this.grid.inBounds(x, y)) return 0;
    return this.grid.cellHeight(x, y);
  }

  describeUtility(x, y) {
    return this.utilities ? this.utilities.describe(x, y) : null;
  }

  describeResource(x, y) {
    return this.resources ? this.resources.describe(x, y) : null;
  }

  publicSpaceAt(x, y) {
    return publicSpaceUse(this, x, y);
  }

  clearTown() {
    this.traffic.clear();
    this.pedestrians.clear();
    // Drop glow materials whose owner has gone. The registry is a strong
    // reference, so without this it is a permanent leak across regenerations —
    // and it was walked EVERY FRAME by `setGlowLevel`, so the per-frame cost
    // grew with session length too. Run after the populations are cleared, so
    // the citizens and vehicles that used those materials are already detached.
    pruneGlows(this.scene);
    if (this.lifecycle) this.lifecycle.reset();
    if (this.economy) this.economy.reset();
    if (this.growth) this.growth.reset();
    if (this.governance) this.governance.reset();
    if (this.industry) this.industry.reset();    if (this.policy) {
      this.policy.townRef = this;
      this.policy.reset();
      this.policy.recompute();
    }
    if (this.research) {
      this.research.townRef = this;
      this.research.reset();
    }
    for (const b of this.buildings.slice()) this.removeBuilding(b, false);
    this.buildings.length = 0;
    this.pickables.length = 0;
    this.leisureSpots.length = 0;
    this.customProps.clear();
    this.utilities.clear();
    this.resources.clear();
    this.parking?.clear();
    this.parkingPlanned?.clear();
    this.streetGlow?.clear();
    this.incidents?.clear();
    this.perimeter?.reset();
    this.transport?.reset();
    this.society?.reset();
    this.weather?.reset(this.seed || 1);
    this.publicPlan = null;
    this.clearGroup(this.roadsGroup);
    this.clearGroup(this.lotsGroup);
    this.clearGroup(this.buildingsGroup);
    this.swapGrid();
    this.roadKit = new RoadKit(this.grid, this.rng);
    this.roadKit.manualStops = new Set(this.transport?.manualStops || []);
  }

  /**
   * Replace the grid, and invalidate everything derived from it.
   *
   * Swapping the grid without doing the second half left the road-components
   * cache describing the PREVIOUS town. `roadComponents()` gates purely on
   * `_roadCompVersion === roadGraphVersion`, and `clearTown` did neither — so
   * after a reset it answered with the old town's component sizes against a
   * brand-new grid with zero road cells, and reported itself valid. The window
   * is narrow in practice (founding bumps the version quickly) but anything that
   * threw or returned early inside it left the cache wrong, and `roadComponents`
   * is read from the growth site search and `stats()`.
   *
   * Bumping the version and dropping the cache together makes "the cache belongs
   * to a particular grid" true by construction rather than by ordering.
   */
  swapGrid() {
    this.grid = new Grid(GRID_W, GRID_H);
    this.roadGraphVersion = (this.roadGraphVersion || 0) + 1;
    this._roadComp = null;
    this._roadCompVersion = -1;
    return this.grid;
  }

  clearGroup(group) {
    const kids = [...group.children];
    for (const k of kids) {
      group.remove(k);
      disposeObject(k);
    }
  }

  /**
   * Rebuild the town layers that depend on the grid.
   *
   * Costs ~120 ms, of which `layoutLots` is ~74 ms and `roadKit.build` ~33 ms —
   * and it was called, in full, from about fifteen single-CELL mutators. Adding
   * one decorative tree measured **112.7 ms**: `addProp` touches `customProps`,
   * which only `layoutLots` reads, and the tree paid for a fresh road kit, a
   * road-mask recompute, a road-graph version bump, two utility builds and a
   * full town validation.
   *
   * So the scope is now stated rather than implied. A change that only affects
   * the lot layer says so, and skips work it does not invalidate. The default is
   * still everything: callers that change roads get the full path and must keep
   * asking for it.
   */
  rebuildStatic({ roads = true, lots = true, validate = true } = {}) {
    // A few specialist planners (notably resource-site access) write road
    // cells directly instead of going through paintRoad. Remove any stale
    // foliage before layoutLots can turn custom props into meshes. This is a
    // cheap map over the prop cells and makes the no-tree-on-infrastructure
    // invariant hold even after a savepoint restore or an older plan.
    this.sanitizeInfrastructureProps();
    const oldSignalsTime = this.roadKit?.signals?.t || 0;
    if (roads) {
      this.grid.computeRoadMask();
      this.clearGroup(this.roadsGroup);
      this.roadKit = new RoadKit(this.grid, this.rng.fork(5));
      this.roadKit.manualStops = new Set(this.transport?.manualStops || []);
      const renderedRoads = this.kits?.renderScene?.(this, 'roads', { id: 'road-layer' }, { rng: this.rng.fork(5) });
      this.roadsGroup.add(renderedRoads?.ok && renderedRoads.result?.scene ? renderedRoads.result.scene : this.roadKit.build());
      if (this.roadKit.signals) { this.roadKit.signals.t = oldSignalsTime; this.roadKit.signals.sync(true); }
    }
    if (lots) {
      this.clearGroup(this.lotsGroup);
      layoutLots(this, this.rng);
      rebuildZone(this);
    }
    if (roads) {
      const renderedUtilities = this.kits?.renderScene?.(this, 'utilities', { id: 'utility-layer' }, { rng: this.rng.fork(4409) });
      if (!renderedUtilities?.ok) this.utilities.build(this, this.rng.fork(4409));
      const renderedResources = this.kits?.renderScene?.(this, 'resources', { id: 'resource-layer' }, { rng: this.rng.fork(5501) });
      if (!renderedResources?.ok) this.resources.build(this, this.rng.fork(5501));
      this.roadGraphVersion++;
      this.traffic?.onRoadGraphChanged?.();
    }
    if (validate) this.validation = validateTown(this);
  }

  rebuildBuildings() {
    this.clearGroup(this.buildingsGroup);
    const bodyGeos = [];
    const glowGeos = [];

    for (const b of this.buildings) {
      for (const geo of b.house.body) bodyGeos.push(geo.clone().applyMatrix4(b.matrix));
      for (const geo of b.house.glow) glowGeos.push(geo.clone().applyMatrix4(b.matrix));

      if (b.house.signText) {
        const sign = makeSign(b.house.signText, {
          width: b.house.signW,
          bg: b.house.signBg
        });
        sign.position.set(0, b.house.signY, b.size.d / 2 + 0.16);
        sign.updateMatrix();
        sign.applyMatrix4(b.matrix);
        this.buildingsGroup.add(sign);
      }
    }

    const bodyGeo = merge(bodyGeos);
    if (bodyGeo) {
      const mesh = new THREE.Mesh(
        bodyGeo,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'buildings-body';
      this.buildingsGroup.add(mesh);
    }

    const glowGeo = merge(glowGeos);
    if (glowGeo) {
      const mesh = new THREE.Mesh(glowGeo, sharedWindowGlow);
      mesh.castShadow = false;
      mesh.name = 'buildings-glow';
      this.buildingsGroup.add(mesh);
    }
  }

  rebuildAll() {
    this.rebuildBuildings();
    this.rebuildStatic();
  }

  sanitizeInfrastructureProps() {
    const g = this.grid;
    const stale = [];
    for (const idx of this.customProps.keys()) {
      const y = Math.floor(idx / g.w);
      const x = idx - y * g.w;
      if (g.isRoad(x, y) || g.isPath(x, y) || g.isWater(x, y) ||
          this.buildingAt(x, y) || this.resources?.ownsCell(x, y)) stale.push([x, y]);
    }
    let felled = 0;
    for (const [x, y] of stale) felled += this.clearProps(x, y);
    return felled;
  }

  /** Re-author one building from its recorded spec plus overrides. */
  rebuildBuilding(rec, overrides = {}) {
    if (!rec) return null;
    const next = rebuildHouse(rec.house, overrides);
    this.applyHouse(rec, next);
    this.rebuildBuildings();
    return rec;
  }

  /**
   * Phase 5 — lift a building one rung of the budget ladder (1 → 2 adds a
   * cornice band, 2 → 3 adds corner pilasters). Returns how far it climbed
   * plus the part roles the re-author actually changed.
   */
  renovateBuilding(rec, { budget = 3 } = {}) {
    if (!rec || !rec.house) return { changed: [], budgetDelta: 0, rec: null };
    const cur = rec.budget ?? rec.house.spec?.budget ?? 1;
    const nextTier = Math.max(1, Math.min(3, Math.round(budget)));
    if (nextTier <= cur) return { changed: [], budgetDelta: 0, rec };
    const prev = rec.house;
    const house = rebuildHouse(rec.house, { budget: nextTier });
    this.applyHouse(rec, house);
    this.rebuildBuildings();
    return { changed: changedRoles(prev, house), budgetDelta: nextTier - cur, rec };
  }

  /**
   * Phase 5 — lift a shop one commerce rung: capacity is the rung's, so the
   * customer split (economy.update) gives it a bigger share of the day's
   * footfall. `tier` is recorded for display/replay; the rung is chosen by
   * the planner from the SHOP_TIERS ladder, never in here.
   */
  tierupBuilding(rec, rung) {
    if (!rec || !rec.house || !rung) return { changed: [], tierDelta: false, rec: null };
    if (rung.capacity <= (rec.capacity || 0)) return { changed: [], tierDelta: false, rec };
    const prev = rec.house;
    const cells = rec.footprint && rec.footprint.length
      ? rec.footprint.length
      : Math.max(1, Math.round(((rec.house.spec?.w || rec.size?.w || CELL) * (rec.house.spec?.d || rec.size?.d || CELL)) / (CELL * CELL)));
    const baseArea = Math.min(...(rung.sizes || [[1, 1]]).map(([cols, rows]) => cols * rows));
    // The rung's authored capacity is for its smallest canonical lot. Scale
    // the per-floor target to this shop's actual footprint, then let the house
    // kit multiply it by all existing floors. This keeps tier-ups from wiping
    // out horizontal capacity or giving a two-storey shop one-storey seats.
    const capacityPerFloor = Math.max(1, Math.round(rung.capacity * cells / Math.max(1, baseArea)));
    const house = rebuildHouse(rec.house, { capacityPerFloor });
    this.applyHouse(rec, house);
    rec.tier = rung.id;
    this.rebuildBuildings();
    return { changed: changedRoles(prev, house), tierDelta: true, rec };
  }

  /**
   * Phase 6 — a wing: claim one full side of this building's footprint (a
   * strip the planner already priced, and reserved, as plan.cells) and grow
   * the house the same way a fresh multi-cell build is sized — block-filling
   * width, depth along the road axis, mesh re-centred on the grown rect.
   * Returns the strip it claimed plus the part roles the re-author touched.
   */
  wingBuilding(rec, strip) {
    const miss = { changed: [], wing: null, rec: rec || null };
    if (!rec || !rec.house || !Array.isArray(strip) || !strip.length) return miss;
    const g = this.grid;
    const cells0 = rec.footprint && rec.footprint.length ? rec.footprint : [rec.cell];
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (const [cx, cy] of cells0) {
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return miss;
      ax = Math.min(ax, cx); ay = Math.min(ay, cy);
      bx = Math.max(bx, cx); by = Math.max(by, cy);
    }
    const sxs = strip.map((c) => c[0]);
    const sys = strip.map((c) => c[1]);
    const sx0 = Math.min(...sxs), sx1 = Math.max(...sxs);
    const sy0 = Math.min(...sys), sy1 = Math.max(...sys);
    const nCols = bx - ax + 1;
    const nRows = by - ay + 1;
    let cols = nCols, rows = nRows, nx = ax, ny = ay;
    if (sy0 === sy1 && sx0 === ax && sx1 === bx && sy0 === by + 1) rows = nRows + 1;
    else if (sy0 === sy1 && sx0 === ax && sx1 === bx && sy0 === ay - 1) { rows = nRows + 1; ny = ay - 1; }
    else if (sx0 === sx1 && sy0 === ay && sy1 === by && sx0 === bx + 1) cols = nCols + 1;
    else if (sx0 === sx1 && sy0 === ay && sy1 === by && sx0 === ax - 1) { cols = nCols + 1; nx = ax - 1; }
    else return miss;
    const cells = [];
    for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < cols; dx++) cells.push([nx + dx, ny + dy]);
    for (const [cx, cy] of strip) {
      if (!g.inBounds(cx, cy)) return miss;
      const k = g.kindAt(cx, cy);
      if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return miss;
      const occ = this.buildingAt(cx, cy);
      if (occ && occ !== rec) return miss;
    }
    // Size it exactly like createBuilding sizes a multi-cell block.
    const face = rec.face || { x: 0, z: 1 };
    const along = face.x !== 0 ? cols : rows;
    const lateral = face.x !== 0 ? rows : cols;
    const w = Math.max(2.5, lateral * CELL - 0.6);
    const d = Math.max(2.5, along * CELL - 0.6);
    const prev = rec.house;
    const areaScale = cells.length / Math.max(1, cells0.length);
    const capacityPatch = rec.house.spec?.capacityPerFloor != null
      ? { capacityPerFloor: rec.house.spec.capacityPerFloor * areaScale }
      : { capacity: Math.max(1, Math.round((rec.capacity || 1) * areaScale)) };
    const house = rebuildHouse(rec.house, {
      w,
      d,
      porch: false,
      garage: false,
      ...capacityPatch
    });
    const center = g.cellToWorld(nx + (cols - 1) / 2, ny + (rows - 1) / 2);
    const parcel = this.parcels?.at(nx, ny) || null;
    const setback = parcel && parcel.buildable ? parcel.setback : 0.2;
    const centerZ = (along * CELL) / 2 - setback - house.size.d / 2;
    const pos = new THREE.Vector3().setFromMatrixPosition(rec.matrix);
    pos.x = center.x + face.x * centerZ;
    pos.z = center.z + face.z * centerZ;
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(face.x, face.z), 0));
    rec.matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
    this.unindexBuilding(rec);
    rec.cell = [nx, ny];
    rec.footprint = cells.length > 1 ? cells : null;
    rec.setback = setback;
    rec.driveway = null;
    if (parcel) rec.parcelId = parcel.id;
    this.applyHouse(rec, house);
    for (const [cx, cy] of cells) {
      g.setKind(cx, cy, CELL_KIND.LOT);
      g.zone[g.idx(cx, cy)] = rec.zone;
      g.owner[g.idx(cx, cy)] = rec;
    }
    if (rec.kind === 'civic') {
      this.civicIndex ||= new Map();
      this.civicNames ||= new Map();
      const idx = g.idx(nx, ny);
      this.civicIndex.set(idx, rec.facility || rec.house.spec?.facility || 'townhall');
      this.civicNames.set(idx, rec.name || rec.house.signText || rec.house.spec?.facility || 'Civic building');
    }
    this.rebuildBuildings();
    this.rebuildStatic();
    return { changed: changedRoles(prev, house), wing: strip, cells, rec };
  }

  /**
   * Grow a building by whole floors (Phase 5 construction). Re-derives only
   * what the change actually touched and reports the affected part roles.
   */
  expandBuilding(rec, { floors = 1 } = {}) {
    if (!rec) return { changed: [], floorsDelta: 0, rec: null };
    const beforeFloors = rec.floors || rec.house?.floors || 1;
    let { house, changed, floorsDelta } = expandHouse(rec.house, { floors });
    if (floorsDelta === 0) return { changed: [], floorsDelta: 0, rec };
    // New commerce builds carry capacityPerFloor, which expandHouse already
    // multiplies by the added floors. Keep the ratio patch only for legacy
    // shops that predate that field; applying both would double their capacity
    // on every vertical upgrade.
    if (rec.kind === 'shop' && house.spec?.capacityPerFloor == null) {
      house = rebuildHouse(house, {
        capacity: Math.round((rec.capacity || 0) * (1 + floorsDelta / Math.max(1, rec.floors || 1)))
      });
    }
    this.applyHouse(rec, house);
    this.rebuildBuildings();
    if (beforeFloors < 10 && rec.floors >= 10) {
      rec.milestones ||= {};
      rec.milestones.skyscraperDay = this.clockDay || 0;
      events.emit('log', {
        kind: 'event',
        text: `${rec.name || 'A town building'} reaches the skyscraper milestone at ${rec.floors} storeys.`
      });
    }
    return { changed, floorsDelta, rec };
  }

  applyHouse(rec, house) {
    rec.house = house;
    rec.size = house.size;
    rec.floors = house.floors;
    rec.style = house.style;
    rec.height = house.height;
    rec.purpose = house.purpose;
    rec.capacity = house.capacity;
    rec.capacityPerFloor = house.spec?.capacityPerFloor ?? null;
    rec.budget = house.budget;
    rec.modules = house.modules;
    if (house.name) rec.name = house.name;
    rec.doorWorld = house.doorLocal.clone().applyMatrix4(rec.matrix);
    return rec;
  }

  removePickable(obj) {
    const i = this.pickables.indexOf(obj);
    if (i >= 0) this.pickables.splice(i, 1);
  }

  nearestRoadCell(x, y) {
    const g = this.grid;
    for (let r = 1; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (g.isRoad(nx, ny)) return [nx, ny];
        }
      }
    }
    return null;
  }

  /**
   * Connected components of the road network, cached per graph version.
   * Routing reads this so an entrance is chosen by reachability rather than
   * by ring order alone (SRS P-C02 / RTE-02).
   */
  roadComponents() {
    if (this._roadComp && this._roadCompVersion === this.roadGraphVersion) return this._roadComp;
    const g = this.grid;
    const comp = new Int32Array(g.w * g.h).fill(-1);
    const size = [];
    let id = 0;
    for (const cell of g.roadCells()) {
      const sIdx = g.idx(cell[0], cell[1]);
      if (comp[sIdx] >= 0) continue;
      const stack = [cell];
      comp[sIdx] = id;
      let n = 0;
      while (stack.length) {
        const [x, y] = stack.pop();
        n++;
        for (const d of DIRS) {
          if (!(g.roadAt(x, y) & d.bit)) continue;
          const nx = x + d.dx;
          const ny = y + d.dy;
          if (!g.isRoad(nx, ny)) continue;
          const ni = g.idx(nx, ny);
          if (comp[ni] >= 0) continue;
          comp[ni] = id;
          stack.push([nx, ny]);
        }
      }
      size.push(n);
      id++;
    }
    let main = -1;
    for (let i = 0; i < size.length; i++) if (main < 0 || size[i] > size[main]) main = i;
    // This cache is a drop-in for placementController's `roadComponents(g)`:
    // the same `label`/`sizes`/`main`/`count` names, so any caller can be moved
    // across without translating the result. That matters because the uncached
    // one allocates a fresh w*h Int32Array and re-labels every component on
    // every call, and it was being called once per candidate cell from the
    // growth site search and once per rendered frame from `stats()`.
    this._roadComp = {
      label: comp,
      comp,
      sizes: size,
      size,
      main,
      count: size.length,
      version: this.roadGraphVersion
    };
    this._roadCompVersion = this.roadGraphVersion;
    return this._roadComp;
  }

  roadComponentAt(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y) || !g.isRoad(x, y)) return -1;
    return this.roadComponents().comp[g.idx(x, y)];
  }

  /**
   * Best entrance onto the road network for a destination at (x, y), given the
   * cell a route starts from. Candidates are still gathered ring by ring —
   * they are the frontage cells of the destination — but a ring cell only wins
   * when the vehicle can actually reach it. A disconnected segment next door is
   * not a feasible entrance, and with no reachable frontage at all the trip is
   * refused instead of silently rerouted elsewhere (P-C02, RTE-02).
   */
  roadAccessCell(from, x, y, opts = {}) {
    const g = this.grid;
    const maxRing = opts.maxRing || 16;
    const comps = this.roadComponents();
    const fromOn = !!from && g.inBounds(from[0], from[1]) && g.isRoad(from[0], from[1]);
    const fromComp = fromOn ? comps.comp[g.idx(from[0], from[1])] : -1;
    // A cell that is already road is its own entrance when it is reachable;
    // when it is not, no neighbouring cell on the same disconnected segment is
    // a substitute, so the trip is refused rather than silently relocated.
    if (g.inBounds(x, y) && g.isRoad(x, y)) {
      if (fromComp < 0) return [x, y];
      return comps.comp[g.idx(x, y)] === fromComp ? [x, y] : null;
    }
    let nearest = null;
    for (let r = 1; r <= maxRing; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!g.isRoad(nx, ny)) continue;
          if (!nearest) nearest = [nx, ny];
          if (fromComp >= 0 && comps.comp[g.idx(nx, ny)] === fromComp) return [nx, ny];
        }
      }
    }
    if (fromComp >= 0) return null;
    if (nearest) return nearest;
    return this.nearestRoadCell(x, y);
  }

  /**
   * One shared fixed simulation step for traffic, signals, incidents and
   * pedestrians (SRS P-E04). Both agent systems sub-divide the frame into the
   * same micro-steps and run interleaved, so a collision or crossing decision
   * no longer depends on how many frames the renderer happened to produce.
   */
  advance(dt, clock = null) {
    this.weather?.update(clock);
    this.traffic.runShared(dt, clock);
    this.streetGlow?.update(dt);
    if (clock?.day != null && clock.day !== this._kitClockDay) {
      this._kitClockDay = clock.day;
      recordPriceHistory(this, clock.day);
      this.kits?.invoke?.('updateDay', this, { dt, clock });
    }
    // Registered kits own their declared update hooks. This is the first
    // runtime migration away from a hand-maintained Town update list; the
    // transport, society, and forest adapters above remain available through
    // their existing public systems for compatibility.
    this.kits?.invoke('updateHour', this, { dt, clock });
  }

  randomRoadCell(rng = this.rng) {
    const cells = this.grid.roadCells();
    if (!cells.length) return null;
    return cells[Math.floor(rng.next() * cells.length)];
  }

  pickBuilding(kinds, rng = this.rng) {
    const list = this.buildings.filter((b) => kinds.includes(b.kind));
    if (!list.length) return null;
    return list[Math.floor(rng.next() * list.length)];
  }

  pickLeisureSpot(rng = this.rng) {
    if (!this.leisureSpots.length) return null;
    const v = this.leisureSpots[Math.floor(rng.next() * this.leisureSpots.length)].clone();
    v.x += rng.float(-1.3, 1.3);
    v.z += rng.float(-1.3, 1.3);
    v.y = 0;
    return v;
  }

  buildingAt(x, y) {
    if (!this.grid.inBounds(x, y)) return null;
    return this.grid.owner[this.grid.idx(x, y)] || null;
  }

  residentsOf(building) {
    return this.pedestrians.citizens.filter((c) => c.home === building);
  }

  /** Remove civic lookup entries for every cell a building used to own. */
  unindexBuilding(building) {
    if (!building || building.kind !== 'civic' || !this.civicIndex) return;
    const cells = building.footprint && building.footprint.length ? building.footprint : [building.cell];
    const owned = new Set(cells.map(([x, y]) => this.grid.idx(x, y)));
    for (const [idx, id] of this.civicIndex) {
      if (!owned.has(idx)) continue;
      this.civicIndex.delete(idx);
      this.civicNames?.delete(idx);
    }
  }

  removeBuilding(b, rebuild = true) {
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    this.unindexBuilding(b);
    for (const [bx, by] of b.footprint || [b.cell]) {
      const idx = this.grid.idx(bx, by);
      if (this.grid.owner[idx] === b) {
        this.grid.owner[idx] = null;
        this.grid.setKind(bx, by, CELL_KIND.EMPTY);
      }
    }
    for (const c of this.pedestrians.citizens) {
      if (c.home === b) c.home = null;
      if (c.work === b) c.work = null;
    }
    this.pedestrians.dropHome(b);
    if (this.economy && b.businessId) this.economy.syncEntities();
    if (rebuild) this.rebuildAll();
  }

  roadNeighborOf(x, y) {
    const g = this.grid;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      // Road OR footway: both give a cell access to the network, which is
      // what the build tools ask about.
      if (g.isRoad(x + dx, y + dy) || g.isPath(x + dx, y + dy)) return [x + dx, y + dy];
    }
    return null;
  }

  /**
   * Lay a footway chain from an anchor cell to the nearest street (or an
   * existing footway) and re-front the parcels, so landlocked lots become
   * buildable the moment the path lands.
   */
  paintFootway(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    if (g.kindAt(x, y) !== CELL_KIND.EMPTY) return false;
    if (g.isWater(x, y) || this.resources?.ownsCell(x, y)) return false;
    if (this.buildingAt(x, y)) return false;
    const cells = planFootway(g, x, y);
    if (!cells || !cells.length) return false;
    let felled = 0;
    for (const [cx, cy] of cells) {
      if (this.perimeter && !this.perimeter.isAcquired(cx, cy)) return false;
      this.clearCell(cx, cy);
      felled += this.clearProps(cx, cy);
      g.setKind(cx, cy, CELL_KIND.PATH);
    }
    if (felled) {
      events.emit('log', {
        text: `The footway clears ${felled} tree${felled === 1 ? '' : 's'} — ${felled * TIMBER_PER_TREE} lumber to the storehouse.`
      });
    }
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    return true;
  }

  clearCell(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    const b = this.buildingAt(x, y);
    if (b) {
      this.unindexBuilding(b);
      const i = this.buildings.indexOf(b);
      if (i >= 0) this.buildings.splice(i, 1);
      for (const c of this.pedestrians.citizens) {
        if (c.home === b) c.home = null;
        if (c.work === b) c.work = null;
      }
      this.pedestrians.dropHome(b);
      // A footprint building frees every cell it covered, not just this one.
      for (const [bx, by] of b.footprint || [b.cell]) {
        if (!g.inBounds(bx, by)) continue;
        const bi = g.idx(bx, by);
        if (g.owner[bi] !== b) continue;
        g.setKind(bx, by, CELL_KIND.EMPTY);
        g.owner[bi] = null;
        g.zone[bi] = null;
      }
      return true;
    }
    const idx = g.idx(x, y);
    g.setKind(x, y, CELL_KIND.EMPTY);
    g.owner[idx] = null;
    g.zone[idx] = null;
    return true;
  }

  paintRoad(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    if (g.kindAt(x, y) === CELL_KIND.ROAD) return false;
    if (g.isWater(x, y)) return false;
    if (this.resources?.ownsCell(x, y)) return false;
    // Auto-connect: a new road always joins the main network, paving the
    // shortest free-land link when the clicked cell does not touch it.
    const cells = planConnectedRoad(g, x, y);
    if (!cells) return false;
    let felled = 0;
    for (const [cx, cy] of cells) {
      if (this.perimeter && !this.perimeter.isAcquired(cx, cy)) return false;
      this.clearCell(cx, cy);
      felled += this.clearProps(cx, cy);
      g.setKind(cx, cy, CELL_KIND.ROAD);
    }
    if (felled) {
      events.emit('log', {
        text: `The new street fells ${felled} tree${felled === 1 ? '' : 's'} — ${felled * TIMBER_PER_TREE} lumber to the storehouse.`
      });
    }
    // Re-number the parcels: every tile this street now fronts turns into a
    // free plot, which is what lets the town keep growing outwards. Without
    // this the new frontage stays unbuildable and growth is stuck with the
    // plots the founding grid happened to create.
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    // EXTEND_STREET's result is otherwise just more grey tarmac: light the run
    // the crews paved (auto-connect cells included) for the next few hours.
    this.streetGlow?.mark(cells);
    return true;
  }

  /**
   * Phase 7 — the ladder class a road cell currently renders as: the code
   * stored on an upgraded cell, else the class the last cross-section roll
   * derived from its segment (junction/special included, so the caller can
   * tell an upgradable run from a structure).
   */
  roadClassAt(x, y) {
    const code = this.grid.roadClassCode(x, y);
    if (code) return classFromCode(code);
    const xs = this.roadKit && this.roadKit.xsByCell ? this.roadKit.xsByCell.get(`${x},${y}`) : null;
    return xs ? xs.cls : null;
  }

  /**
   * Phase 7 — raise a set of straight road cells to `toClass` in one step.
   * Every cell must still be a road, still be a plain straight run (not a
   * junction, bridge, ramp, tunnel or dead end) and still sit BELOW the
   * target — otherwise nothing is written and nothing is rebuilt, so a stale
   * plan can never charge for work that did not happen.
   */
  upgradeRoadRun(cells, toClass) {
    const g = this.grid;
    const to = classIndex(toClass);
    if (to < 1) return { ok: false, reason: 'unknown road class' };
    if (!Array.isArray(cells) || !cells.length) return { ok: false, reason: 'no road cells' };
    let axis = null;
    const rungs = [];
    for (const [x, y] of cells) {
      if (!g.isRoad(x, y)) return { ok: false, reason: 'cell is no longer a road' };
      const cellAxis = straightAxis(g.roadAt(x, y));
      if (!cellAxis) return { ok: false, reason: 'cell is not part of a straight run' };
      if (classify(g, x, y) !== 'straight') return { ok: false, reason: 'cell is a structure, not a road run' };
      const cur = classIndex(this.roadClassAt(x, y));
      if (cur < 0) return { ok: false, reason: 'cell has no upgradeable class' };
      if (cur >= to) return { ok: false, reason: 'that class is already reached' };
      if (axis && cellAxis !== axis) return { ok: false, reason: 'run crosses two axes' };
      axis = cellAxis;
      rungs.push(to - cur);
    }
    for (const [x, y] of cells) g.setRoadClassCode(x, y, to + 1);
    this.rebuildStatic();
    // Phase 13 (C4) — the class now flowing past each lot changes what the
    // frontage owes the street: re-derive the parcel setbacks from the fresh
    // cross-sections, pull the road-adjacent buildings back to match, and
    // lift the land value of the cells the wider street now serves.
    this.parcels?.reclassSetbacks?.(this);
    const refit = this.refitFrontage(cells);
    this.economy?.bumpFrontage?.(cells.map((c, i) => [c[0], c[1], rungs[i]]));
    return { ok: true, cells: cells.slice(), to: toClass, count: cells.length, refit };
  }

  /**
   * Phase 13 — re-centre the buildings whose footprint fronts the given road
   * cells so their face honours the parcel's (possibly grown) setback. The
   * lateral offset a driveway gave them is preserved; nothing else moves.
   * Returns how many buildings actually shifted.
   */
  refitFrontage(upCells) {
    const g = this.grid;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const up = new Set(upCells.map(([x, y]) => `${x},${y}`));
    let moved = 0;
    for (const b of this.buildings) {
      const fp = b.footprint && b.footprint.length ? b.footprint : [b.cell];
      let front = false;
      for (const [x, y] of fp) {
        for (const [dx, dy] of DIRS) {
          if (up.has(`${x + dx},${y + dy}`)) { front = true; break; }
        }
        if (front) break;
      }
      if (!front) continue;
      const face = b.face || { x: 0, z: 1 };
      let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
      for (const [cx, cy] of fp) {
        ax = Math.min(ax, cx); ay = Math.min(ay, cy);
        bx = Math.max(bx, cx); by = Math.max(by, cy);
      }
      const cols = bx - ax + 1;
      const rows = by - ay + 1;
      const along = face.x !== 0 ? cols : rows;
      // A garage house fills to the lot line on its own terms — its fixed
      // 1.45 setback is a property of the garage, not of the street.
      const garageFixed = (b.setback || 0) >= 1.4;
      const parcel = this.parcels?.at(b.cell[0], b.cell[1]);
      const setback = garageFixed
        ? b.setback
        : parcel && parcel.buildable
          ? parcel.setback
          : 0.2;
      const frontHalf = (along * CELL) / 2;
      const d = b.size.d;
      const oldSetback = b.setback ?? 0.2;
      const newZ = frontHalf - setback - d / 2;
      const oldZ = frontHalf - oldSetback - d / 2;
      if (Math.abs(newZ - oldZ) < 1e-6) continue;
      const center = g.cellToWorld(ax + (cols - 1) / 2, ay + (rows - 1) / 2);
      const oldPos = new THREE.Vector3().setFromMatrixPosition(b.matrix);
      const lat = {
        x: oldPos.x - (center.x + face.x * oldZ),
        z: oldPos.z - (center.z + face.z * oldZ)
      };
      const pos = new THREE.Vector3(
        center.x + face.x * newZ + lat.x,
        oldPos.y,
        center.z + face.z * newZ + lat.z
      );
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(face.x, face.z), 0));
      b.matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
      b.setback = setback;
      b.doorWorld = b.house.doorLocal.clone().applyMatrix4(b.matrix);
      moved++;
    }
    if (moved) this.rebuildBuildings();
    return moved;
  }

  /**
   * Town expansion (called by GrowthSystem when no free plot is left):
   * pave a street link at `x,y`, drop any props it crosses, rebuild the
   * parcel map so neighbouring cells gain road frontage, re-render.
   * Returns the cells it paved (so the order that asked for them can be
   * charged for them), or false when the carve is impossible (water / too
   * far / busy).
   */
  expandTown(x, y, opts = {}) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    if (g.kindAt(x, y) !== CELL_KIND.EMPTY) return false;
    if (g.isWater(x, y) || this.resources?.ownsCell(x, y)) return false;
    if (this.buildingAt(x, y)) return false;
    const cells = planConnectedRoad(g, x, y);
    if (!cells || !cells.length) return false;
    const acquired = this.perimeter?.acquire(cells, {
      reason: opts.reason || 'street extension',
      charge: opts.chargeLand !== false
    });
    if (acquired && !acquired.ok) return false;
    let felled = 0;
    for (const [cx, cy] of cells) {
      this.clearCell(cx, cy);
      felled += this.clearProps(cx, cy);
      g.setKind(cx, cy, CELL_KIND.ROAD);
    }
    if (felled) {
      events.emit('log', {
        text: `Street crews fell ${felled} tree${felled === 1 ? '' : 's'} — ${felled * TIMBER_PER_TREE} lumber to the storehouse.`
      });
    }
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    return cells;
  }

  /**
   * Phase 9 — throw a steel deck across a water gap: every cell must still
   * be water and the run can never exceed MAX_BRIDGE_GAP, so a stale plan
   * can neither build on land nor span half a lake. The cells become roads
   * carrying the bridge feature (the land cells either side render as ramps
   * from the neighbouring feature), and the road mask/graph pick them up on
   * the rebuild. Steel is the plan's business — planFor prices it and
   * startProject takes it — this painter only builds.
   */
  buildBridge(cells) {
    const g = this.grid;
    if (!Array.isArray(cells) || !cells.length || cells.length > MAX_BRIDGE_GAP) return false;
    for (const [x, y] of cells) {
      if (!g.inBounds(x, y) || !g.isWater(x, y)) return false;
    }
    for (const [x, y] of cells) {
      const i = g.idx(x, y);
      g.setKind(x, y, CELL_KIND.ROAD);
      g.zone[i] = null;
      g.owner[i] = null;
      g.setFeature(x, y, ROAD_FEATURE.BRIDGE);
    }
    this.rebuildAll();
    return true;
  }

  demolishRoad(x, y) {
    const g = this.grid;
    if (!g.isRoad(x, y)) return false;
    if (g.roadDegree(x, y) >= 3) return false;
    if (splitsNetwork(g, x, y)) return false;
    g.setKind(x, y, CELL_KIND.EMPTY);
    this.rebuildAll();
    return true;
  }

  placeBuilding(x, y, zone = null, opts = {}) {
    const g = this.grid;
    if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isPath(x, y) || g.isWater(x, y)) return null;
    if (this.resources?.ownsCell(x, y)) return null;
    const cols = Math.max(1, Math.round(opts.footprint?.cols || 1));
    const rows = Math.max(1, Math.round(opts.footprint?.rows || 1));
    // Growth keeps `x,y` as the street-facing parcel anchor so the building
    // inherits that parcel's setback and budget tier. A multi-cell project may
    // therefore have an anchor inside the reserved block rather than at its
    // top-left corner. Carry the exact reserved cells through to the final
    // mutation instead of reconstructing a shifted rectangle from the anchor.
    const explicitCells = Array.isArray(opts.footprintCells) && opts.footprintCells.length
      ? opts.footprintCells.map(([cx, cy]) => [Math.round(cx), Math.round(cy)])
      : null;
    const cells = explicitCells || [];
    if (!explicitCells) {
      for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < cols; dx++) cells.push([x + dx, y + dy]);
    }
    if (cells.length !== cols * rows || !cells.some(([cx, cy]) => cx === x && cy === y)) return null;
    // Hoisted out of the per-cell loop. `hasNetworkAccess` defaults `comps` to
    // `roadComponents(g)`, which allocates a fresh w*h label array and re-labels
    // every road component on every call — nine allocations and nine full-grid
    // floods for a 3x3 placement. Every other caller in the codebase passes the
    // cached set; this one was left calling the default inside a loop.
    const comps = this.roadComponents();
    let frontage = false;
    for (const [cx, cy] of cells) {
      if (!g.inBounds(cx, cy) || g.isRoad(cx, cy) || g.isPath(cx, cy) || g.isWater(cx, cy)) return null;
      if (this.resources?.ownsCell(cx, cy)) return null;
      if (this.perimeter && !opts.allowUnacquired && !this.perimeter.isAcquired(cx, cy)) return null;
      // Occupied cells block unless this build acquires them (the caller has
      // already paid the owner — createBuilding clears them).
      if (!opts.acquire && this.buildingAt(cx, cy)) return null;
      if (hasNetworkAccess(g, cx, cy, comps)) frontage = true;
    }
    if (!frontage) return null;
    // Keep ordinary development out of working fields and paddocks. Resource
    // sites are deliberately sited first and can grow horizontally later, so
    // this check belongs at the final placement boundary as well as in the
    // council survey. The founding layout runs before resources are created;
    // an explicit override remains available for a scenario that intentionally
    // co-locates a specialist facility.
    if (!opts.allowAgriculturalAdjacency && agriculturalSetbackConflict(this.resources, cells)) return null;
    // Production/storage yards need a wider public/residential buffer than a
    // normal lot. Industrial works are intentionally exempt so a factory can
    // share a supply corridor; fuel stations are omitted by the shared rule
    // because they are public-facing civic infrastructure.
    if (!opts.allowResourceAdjacency && resourceSetbackConflict(this.resources, cells, {
      zone,
      kind: opts.kind
    })) return null;
    // A campus is a district-scale civic investment. Enforce its separation
    // at the final mutation boundary as well as in GrowthSystem's survey so a
    // player or an LLM cannot bypass the catchment buffer by pinning a cell.
    let requestedFacility = opts.facility || opts.subtype || this.civicIndex?.get(g.idx(x, y)) || null;
    if (!requestedFacility && zone === ZONE.CIVIC) {
      // Generic civic orders use the same catalogue cursor as createBuilding.
      // Predict its next facility here so a late college/university cannot
      // bypass the campus buffer merely because the plan omitted `facility=`.
      const built = new Set(this.civicIndex?.values?.() || []);
      requestedFacility = CIVIC_ORDER.find((id) => !built.has(id)) || 'townhall';
    }
    if (!opts.allowCampusAdjacency && educationCampusConflict(this, cells, requestedFacility)) return null;
    // Construction replaces whatever decoration stood on its cell — timber
    // from felled trees goes to the storehouse.
    for (const [cx, cy] of cells) this.clearProps(cx, cy);
    const rec = createBuilding(this, x, y, zone, { rng: this.rng.fork(x * 73 + y), ...opts, footprintCells: cells });
    if (!rec) return null;
    this.rebuildAll();
    return rec;
  }

  setPark(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isWater(x, y)) return false;
    this.clearCell(x, y);
    g.setKind(x, y, CELL_KIND.PARK);
    g.zone[g.idx(x, y)] = ZONE.PARK;
    this.rebuildAll();
    return true;
  }

  /**
   * Phase 8 — pave a civic square. A free street-fronting cell (or a cell
   * beside a square already there, so a plaza can grow) becomes PLAZA — the
   * same kind the seeded town-hall square uses, so the plaza renderer, the
   * public-parcel type and the event venues all pick it up.
   */
  paintPlaza(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    if (g.isWater(x, y) || g.isRoad(x, y) || g.isPath(x, y)) return false;
    if (this.resources?.ownsCell(x, y) || this.buildingAt(x, y)) return false;
    let front = false;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inBounds(nx, ny)) continue;
      if (g.isRoad(nx, ny) || g.isPath(nx, ny) || g.kindAt(nx, ny) === CELL_KIND.PLAZA) front = true;
    }
    if (!front) return false;
    this.clearCell(x, y);
    this.clearProps(x, y);
    g.setKind(x, y, CELL_KIND.PLAZA);
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    return true;
  }

  /**
   * Phase 8 — reserve a kerb-side cell for parking. Nothing changes kind:
   * the cell stays free land, and layoutLots marks two bays on every cell the
   * council planned (station/lot rolls still get first refusal).
   */
  paintParking(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    if (g.isWater(x, y) || g.isRoad(x, y) || g.isPath(x, y)) return false;
    const k = g.kindAt(x, y);
    if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return false;
    if (g.owner[g.idx(x, y)] || this.buildingAt(x, y)) return false;
    if (this.resources?.ownsCell(x, y)) return false;
    if (!isAdjacentToRoad(g, x, y)) return false;
    const key = `${x},${y}`;
    if (this.parkingPlanned.has(key)) return false;
    this.parkingPlanned.add(key);
    this.rebuildStatic();
    return true;
  }

  /** Phase 8 — clear a standing building; its land keeps its zoning. */
  clearLot(rec) {
    if (!rec) return false;
    const cells = rec.footprint || [rec.cell];
    this.removeBuilding(rec, false);
    for (const [bx, by] of cells) {
      if (!this.grid.inBounds(bx, by)) continue;
      const idx = this.grid.idx(bx, by);
      this.grid.owner[idx] = null;
      this.grid.setKind(bx, by, CELL_KIND.EMPTY);
      this.grid.setDensity(bx, by, 0);
    }
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    return true;
  }

  /** Replace a standing building on its existing footprint with a denser
   * version. Demolition is explicit and occupants are re-homed before the new
   * record is authored, so restructuring cannot leave ghost ownership behind.
   */
  restructureBuilding(rec, opts = {}) {
    if (!rec || !this.buildings.includes(rec)) return null;
    const cell = rec.cell?.slice();
    const footprint = rec.footprint?.length
      ? { cols: Math.max(...rec.footprint.map((c) => c[0])) - Math.min(...rec.footprint.map((c) => c[0])) + 1,
          rows: Math.max(...rec.footprint.map((c) => c[1])) - Math.min(...rec.footprint.map((c) => c[1])) + 1 }
      : null;
    const zone = rec.zone;
    const floorCap = rec.kind === 'civic' ? civicVerticalCap(rec) : MAX_FLOORS;
    if ((rec.floors || 1) >= floorCap) return null;
    const nextFloors = Math.min(floorCap, Math.max((rec.floors || 1) + 1, opts.floors || 1));
    this.society?.noteDemolition(rec);
    if (!this.clearLot(rec)) return null;
    const next = this.placeBuilding(cell[0], cell[1], zone, {
      footprint,
      floors: nextFloors,
      factory: rec.house?.spec?.factoryType || undefined,
      factoryModules: rec.house?.spec?.factoryModules || undefined,
      facility: rec.facility || undefined,
      kind: rec.kind === 'office' ? 'office' : undefined,
      acquire: false,
      name: rec.name ? `${rec.name} renewal` : undefined
    });
    if (!next) return null;
    events.emit('log', { kind: 'event', text: `${next.name || 'The building'} is restructured to ${next.floors} floors.` });
    return next;
  }

  /** Replace a same-area civic facility with its next authored progression. */
  upgradeCivicBuilding(rec, { facility } = {}) {
    if (!rec || rec.kind !== 'civic' || !facility || !this.buildings.includes(rec)) return null;
    const cells = rec.footprint?.length ? rec.footprint.map((cell) => cell.slice()) : [rec.cell.slice()];
    const footprint = rec.footprint?.length
      ? {
          cols: Math.max(...cells.map((cell) => cell[0])) - Math.min(...cells.map((cell) => cell[0])) + 1,
          rows: Math.max(...cells.map((cell) => cell[1])) - Math.min(...cells.map((cell) => cell[1])) + 1
        }
      : null;
    const origin = rec.cell?.slice();
    if (!origin || !this.clearLot(rec)) return null;
    const next = this.placeBuilding(origin[0], origin[1], ZONE.CIVIC, {
      footprint,
      footprintCells: cells,
      floors: Math.max(1, rec.floors || 1),
      facility,
      acquire: false,
      name: rec.name ? `${rec.name} ${facility}` : undefined
    });
    if (!next) return null;
    next.upgradedFrom = rec.facility || null;
    events.emit('log', { kind: 'event', text: `${next.name || 'The civic building'} evolves from ${rec.facility || 'its former use'} into a ${facility}.` });
    return next;
  }

  /**
   * Phase 8 — repaint the zoning of a brush of cells (REZONE and ANNEX_EDGE
   * both land here). Green space and the network keep their use, and the
   * parcels are rebuilt so every parcel type follows its land.
   */
  rezone(cells, zone) {
    const g = this.grid;
    if (!cells || !cells.length || !zone) return 0;
    let n = 0;
    for (const [x, y] of cells) {
      if (!g.inBounds(x, y)) continue;
      const k = g.kindAt(x, y);
      if (k === CELL_KIND.ROAD || k === CELL_KIND.WATER || k === CELL_KIND.PATH) continue;
      if (k === CELL_KIND.PARK || k === CELL_KIND.PLAZA) continue;
      if (this.resources?.ownsCell(x, y)) continue;
      const idx = g.idx(x, y);
      if (g.zone[idx] === zone) continue;
      g.zone[idx] = zone;
      n++;
    }
    if (!n) return 0;
    this.parcels.build(this, this.rng.fork(2027));
    this.rebuildAll();
    return n;
  }

  /**
   * Phase 8 — raise the density of a brush of cells. Two effects: the land
   * is marked upzoned, so the next house built on it starts at three floors,
   * and the houses already standing on the brush go up a floor now.
   */
  upzone(cells) {
    const g = this.grid;
    if (!cells || !cells.length) return { cells: 0, raised: 0 };
    let marked = 0;
    for (const [x, y] of cells) {
      if (!g.inBounds(x, y)) continue;
      const k = g.kindAt(x, y);
      if (k === CELL_KIND.ROAD || k === CELL_KIND.WATER || k === CELL_KIND.PATH) continue;
      if (k === CELL_KIND.PARK || k === CELL_KIND.PLAZA) continue;
      if (this.resources?.ownsCell(x, y)) continue;
      if (g.densityAt(x, y)) continue;
      g.setDensity(x, y, 1);
      marked++;
    }
    return { cells: marked, raised: 0 };
  }

  addProp(x, y, type = 'tree', { rebuild = true, source = 'plantation' } = {}) {
    if (type === 'tree' || type === 'pine') {
      return this.forest
        ? this.forest.plant(x, y, { rebuild, source, type })
        : false;
    }
    const g = this.grid;
    if (!g.inBounds(x, y) || g.isRoad(x, y) || g.isWater(x, y)) return false;
    const idx = g.idx(x, y);
    const list = this.customProps.get(idx) || [];
    if (list.length >= 6) return false;
    list.push(type);
    this.customProps.set(idx, list);
    // A decorative prop changes only what `layoutLots` draws. It does not touch
    // a road, a zone boundary, a utility run or a resource site, so it must not
    // pay to rebuild them — planting one tree measured 112.7 ms, almost all of it
    // work this call cannot invalidate.
    if (rebuild) this.rebuildStatic(PROP_ONLY);
    return true;
  }

  /**
   * Drop every prop a cell carries; each felled tree is credited to the
   * storehouse (industry.refund caps at capacity, so surplus timber beyond
   * the limit is lost). Returns the number of trees felled.
   */
  clearProps(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return 0;
    const idx = g.idx(x, y);
    const list = this.customProps.get(idx);
    if (!list) return 0;
    this.customProps.delete(idx);
    const felled = list.filter((p) => this.forest?.isTreeProp(p) || p === 'tree').length;
    if (felled) {
      if (this.forest) this.forest.recordCleared(felled);
      else if (this.industry) this.industry.refund({ lumber: felled * TIMBER_PER_TREE });
    }
    return felled;
  }

  removeProp(x, y) {
    const idx = this.grid.idx(x, y);
    if (!this.customProps.has(idx)) return false;
    this.clearProps(x, y);
    this.rebuildStatic(PROP_ONLY);
    return true;
  }

  demolish(x, y) {
    const g = this.grid;
    if (!g.inBounds(x, y)) return false;
    // The lake is terrain, not something the bulldozer can clear.
    if (g.isWater(x, y)) return false;
    if (this.buildingAt(x, y)) {
      const building = this.buildingAt(x, y);
      this.society?.noteDemolition(building);
      this.removeBuilding(building);
      return 'building';
    }
    if (g.isRoad(x, y)) return this.demolishRoad(x, y) ? 'road' : false;
    if (this.customProps.has(g.idx(x, y))) {
      this.removeProp(x, y);
      return 'prop';
    }
    // A planned parking bay is a marking, not a kind: the bulldozer lifts it.
    if (this.parkingPlanned && this.parkingPlanned.has(`${x},${y}`)) {
      this.parkingPlanned.delete(`${x},${y}`);
      this.rebuildStatic();
      return 'parking';
    }
    if (g.kindAt(x, y) !== CELL_KIND.EMPTY) {
      g.setKind(x, y, CELL_KIND.EMPTY);
      g.zone[g.idx(x, y)] = null;
      this.rebuildAll();
      return 'land';
    }
    return false;
  }

  pick(raycaster) {
    const agents = [...this.pedestrians.group.children, ...this.traffic.group.children];
    const hits = raycaster.intersectObjects(agents, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj && !obj.userData?.pick) obj = obj.parent;
      if (obj?.userData?.pick) {
        return { kind: 'agent', pick: obj.userData.pick, object: obj, point: hit.point };
      }
    }
    return null;
  }

  cellFromGround(raycaster) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, pt)) return null;
    const { x, y } = this.grid.worldToCell(pt.x, pt.z);
    if (!this.grid.inBounds(x, y)) return null;
    return { x, y, point: pt };
  }

  stats() {
    let houses = 0;
    let shops = 0;
    let civic = 0;
    for (const b of this.buildings) {
      if (b.kind === 'house') houses++;
      else if (['shop', 'office', 'hotel', 'resort'].includes(b.kind) || b.purpose === 'commercial') shops++;
      else civic++;
    }
    // `resources.stats()` used to be evaluated TWICE in the object literal below —
    // once for the report and again inside `resourceStress`. It is a pure
    // recomputation of `sites x levels` with no caching, it is the most expensive
    // leaf in this function, and `stats()` is on the render loop's frame path.
    // One call, one value.
    const resourceStats = this.resources ? this.resources.stats() : null;
    const height = this.buildings.reduce((out, b) => {
      const floors = b.floors || b.house?.floors || 1;
      out.maxFloors = Math.max(out.maxFloors, floors);
      out.maxFootprint = Math.max(out.maxFootprint, b.footprint?.length || 1);
      if (floors >= 10 && out.firstSkyscraperDay == null) out.firstSkyscraperDay = b.milestones?.skyscraperDay ?? null;
      return out;
    }, { maxFloors: 0, maxFootprint: 0, firstSkyscraperDay: null });
    return {
      roads: this.grid.roadCount,
      houses,
      shops,
      civic,
      buildings: this.buildings.length,
      population: this.pedestrians.citizens.length,
      households: this.pedestrians.households.length,
      vehicles: this.traffic.vehicles.length,
      vehicleStock: this.vehicles ? this.vehicles.stats() : null,
      fleet: this.traffic.fleetStats(),
      visible: this.pedestrians.visibleCount(),
      outside: this.pedestrians.outsideCount(),
      inside: this.pedestrians.insideCount(),
      mood: this.pedestrians.averageMood(),
      lifecycle: this.lifecycle ? this.lifecycle.stats() : null,
      economy: this.economy ? this.economy.stats() : null,
      industry: this.industry ? this.industry.stats() : null,
      forest: this.forest ? this.forest.stats() : null,
      weather: this.weather ? this.weather.stats() : null,
      growth: this.growth ? this.growth.stats() : null,
      progression: {
        ...height,
        skyscraperFloors: 10,
        populationCap: SIM.maxCitizens
      },
      perimeter: this.perimeter ? this.perimeter.stats() : null,
      transport: this.transport ? this.transport.stats() : null,
      priceHistory: priceHistory(this),
      society: this.society ? this.society.stats() : null,
      governance: this.governance ? this.governance.stats() : null,
      mobility: this.traffic ? this.traffic.mobilityStats() : null,
      components: this.roadKit.stats.components || {},
      graph: this.roadKit.stats.graph || null,
      parcels: this.parcels.stats(),
      utilities: this.utilities.stats(),
      resources: resourceStats,
      resourceStress: resourceStats ? resourceStress(resourceStats) : null,
      policy: this.policy ? this.policy.stats() : null,
      research: this.research ? this.research.stats() : null,
      kits: this.kits ? this.kits.compatibilityReport() : null,
      kitStats: this.kits?.kitStats?.(this) || null,
      publicSpace: publicSpaceStats(this),
      pipeline: this.pipelineSummary || null,
      validation: this.validation || null,
      civic: this.civicIndex
        ? [...this.civicIndex.values()].map((id) => id)
        : []
    };
  }

  get roadGraph() {
    return this.roadKit.graph;
  }
}

export { CELL, CELL_KIND };
