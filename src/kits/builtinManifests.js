import { CONSTRUCTION_BLOCKS, constructionBlock, constructionBlockDemand, constructionBlockQuote } from './constructionBlocks.js';
import { publicSpaceStats, renderPublicSpaces } from './publicspace/publicKit.js';
import { buildHouse } from './houses/houseKit.js';
import { buildTree, buildPine, buildBush, buildLamp } from './props/propKit.js';
import { buildVehicle } from './vehicles/vehicleKit.js';

const rowsFor = (kit) => CONSTRUCTION_BLOCKS.filter((row) => row.kit === kit);
const catalogueOperations = {
  quote: ({ id, town, area }) => constructionBlockQuote(id, { town, area }),
  demand: ({ id, town }) => constructionBlockDemand(id, town),
  inspect: ({ id }) => constructionBlock(id)
};

function buildingRenderer({ building, options = {} }) {
  const scene = buildHouse(options.params || {});
  return {
    scene,
    inspection: {
      kind: building.kind,
      floors: scene.floors,
      footprint: building.footprint || [],
      modules: scene.modules.map((module) => module.kind)
    },
    capacity: scene.capacity,
    staffing: Number(options.staffing) || 0,
    production: options.production || {}
  };
}

function simpleStats(systemName) {
  return ({ town }) => town[systemName]?.stats?.() || null;
}

function roadSceneRenderer({ town }) {
  const scene = town.roadKit?.build?.() || null;
  return { scene, inspection: { kind: 'road-network', tiles: town.roadKit?.stats?.tiles || 0 } };
}

function utilitySceneRenderer({ town, options = {} }) {
  const system = town.utilities;
  if (!system?.build) return { scene: null, inspection: { kind: 'utility-network', available: false } };
  system.build(town, options.rng || town.rng?.fork?.(4409));
  return { scene: system.group, inspection: { kind: 'utility-network', stats: system.stats?.() || null } };
}

function resourceSceneRenderer({ town, options = {} }) {
  const system = town.resources;
  if (!system?.build) return { scene: null, inspection: { kind: 'resource-sites', available: false } };
  system.build(town, options.rng || town.rng?.fork?.(5501));
  return { scene: system.group, inspection: { kind: 'resource-sites', stats: system.stats?.() || null } };
}

function publicSpaceSceneRenderer({ town, input = {}, options = {} }) {
  if (input.batch) renderPublicSpaces(town, input.plan || town.publicPlan, input.batch, options.rng || town.rng?.fork?.(7712));
  return { scene: input.batch?.group || null, inspection: publicSpaceStats(town) };
}

function propSceneRenderer({ input = {}, options = {} }) {
  const rng = options.rng || input.rng;
  const type = input.type || 'tree';
  const scale = Number.isFinite(Number(input.scale)) ? Number(input.scale) : 1;
  const scene = type === 'pine' ? buildPine(rng, scale)
    : type === 'bush' ? buildBush(rng, scale)
      : type === 'lamp' ? buildLamp()
        : buildTree(rng, scale);
  return { scene, inspection: { kind: 'prop', type } };
}

function vehicleSceneRenderer({ input = {}, options = {} }) {
  const rig = buildVehicle({ ...(input.params || {}), type: input.type || input.params?.type || 'sedan', rng: options.rng || input.params?.rng });
  return { scene: rig.group, payload: rig, inspection: { kind: 'vehicle', type: rig.type, footprint: rig.spec, wheels: rig.wheels?.length || 0 } };
}

/**
 * Compatibility manifests for the current built-in kits. These adapters do
 * not replace the old public APIs yet; they make ownership, catalogue rows,
 * intent routes, and diagnostics discoverable before the deeper Town migration.
 */
export function registerBuiltinKits(registry) {
  const manifests = [
    {
      id: 'construction', version: '1.0.0', apiVersion: 1, domains: ['construction'],
      catalogueSchemaVersion: '1',
      routes: { IMAGINE_ARCHETYPE: 'archetype' }, planTypes: ['archetype'],
      capabilities: { catalogue: true, quote: true, demand: true }
    },
    {
      id: 'houses', version: '1.0.0', apiVersion: 1, domains: ['housing', 'commerce'],
      catalogueSchemaVersion: '1', zones: ['residential', 'commercial'],
      catalogue: rowsFor('houses'),
      routes: { DEVELOP_HOUSING: 'house', OPEN_SHOP: 'shop', BUILD_OFFICE: 'office', TIERUP: 'tierup', UPGRADE_BUILDING: 'upgrade', RENOVATE: 'renovate', WING: 'wing', RESTRUCTURE_BUILDING: 'restructure' },
      planTypes: ['house', 'shop', 'office', 'tierup', 'upgrade', 'renovate', 'wing', 'restructure'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true, build: true, upgrade: true, staffing: true },
      operations: catalogueOperations,
      hooks: {
        render: buildingRenderer,
        stats: ({ town }) => ({ buildings: (town.buildings || []).filter((b) => b.kind === 'house' || b.purpose === 'commercial').length })
      }
    },
    {
      id: 'industry', version: '1.0.0', apiVersion: 1, domains: ['industry'],
      catalogueSchemaVersion: '1', catalogue: rowsFor('industry'), zones: ['industrial'],
      routes: { BUILD_FACTORY: 'factory' }, planTypes: ['factory'],
      capabilities: { production: true, staffing: true, catalogue: true, builder: true, quote: true, placement: true, build: true },
      operations: catalogueOperations,
      hooks: { render: buildingRenderer, stats: simpleStats('industry') }
    },
    {
      id: 'civic', version: '1.0.0', apiVersion: 1, domains: ['civic'],
      catalogueSchemaVersion: '1', zones: ['civic'],
      catalogue: rowsFor('civic'),
      routes: { BUILD_CIVIC: 'civic', EXPAND_CLINIC: 'civic', BUILD_LANDMARK: 'landmark', EXPAND_LANDMARK: 'wing' },
      planTypes: ['civic', 'landmark', 'wing'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true, build: true, upgrade: true, serviceDemand: true },
      operations: catalogueOperations,
      hooks: { render: buildingRenderer, stats: ({ town }) => ({ facilities: [...(town.civicIndex?.values?.() || [])] }) }
    },
    {
      id: 'resources', version: '1.0.0', apiVersion: 1, domains: ['resource'],
      catalogueSchemaVersion: '1', zones: ['resource'],
      catalogue: rowsFor('resources'),
      routes: { UPGRADE_RESOURCE: 'resource' }, planTypes: ['resource'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true, production: true, storage: true },
      operations: catalogueOperations,
      hooks: { renderScene: resourceSceneRenderer, stats: simpleStats('resources') }
    },
    {
      id: 'utilities', version: '1.0.0', apiVersion: 1, domains: ['utility'],
      catalogueSchemaVersion: '1', zones: ['utility'],
      catalogue: rowsFor('utilities'),
      routes: { EXPAND_POWER: 'power', EXPAND_WATER: 'water', EXPAND_SEWAGE: 'sewage' }, planTypes: ['power', 'water', 'sewage'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true, networks: true },
      operations: catalogueOperations,
      hooks: { renderScene: utilitySceneRenderer, stats: simpleStats('utilities') }
    },
    {
      id: 'roads', version: '1.0.0', apiVersion: 1, domains: ['mobility'],
      catalogueSchemaVersion: '1', zones: ['mobility'],
      catalogue: rowsFor('roads'),
      routes: { EXTEND_STREET: 'road', EXTEND_FOOTWAY: 'footway', UPGRADE_ROAD: 'roadup', BUILD_BRIDGE: 'bridge', ADD_PARKING: 'parking' },
      planTypes: ['road', 'footway', 'roadup', 'bridge', 'parking'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true, planning: true },
      operations: catalogueOperations,
      hooks: { renderScene: roadSceneRenderer, stats: ({ town }) => town.roadKit?.stats || null }
    },
    {
      id: 'publicspace', version: '1.0.0', apiVersion: 1, domains: ['public'],
      catalogueSchemaVersion: '1', zones: ['public'],
      catalogue: rowsFor('publicspace'),
      routes: { PARK_LAND: 'park', PAVE_PLAZA: 'plaza' }, planTypes: ['park', 'plaza'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true },
      operations: catalogueOperations,
      hooks: { renderScene: publicSpaceSceneRenderer, stats: ({ town }) => publicSpaceStats(town) }
    },
    {
      id: 'props', version: '1.0.0', apiVersion: 1, domains: ['public', 'mobility'],
      catalogueSchemaVersion: '1', zones: ['public', 'mobility'],
      catalogue: rowsFor('props'),
      routes: { PLANT_TREES: 'prop-tree', INSTALL_LAMP: 'prop-lamp' }, planTypes: ['prop-tree', 'prop-lamp'],
      capabilities: { catalogue: true, builder: true, quote: true, placement: true },
      operations: catalogueOperations,
      hooks: { renderScene: propSceneRenderer }
    },
    {
      id: 'vehicles', version: '1.0.0', apiVersion: 1, domains: ['transport', 'emergency'],
      catalogueSchemaVersion: '1',
      routes: { DISPATCH_UNITS: null }, planTypes: [],
      capabilities: { catalogue: true, fleet: true, procurement: true },
      hooks: { renderScene: vehicleSceneRenderer, stats: simpleStats('vehicles') }
    },
    {
      id: 'transport', version: '1.0.0', apiVersion: 1, domains: ['transport'],
      catalogueSchemaVersion: '1',
      routes: { BUILD_TRANSIT: 'civic' }, planTypes: ['civic'],
      capabilities: { routing: true, stops: true, fleet: true },
      hooks: {
        updateHour: ({ town, dt, clock }) => town.transport?.update(dt, clock),
        stats: simpleStats('transport'),
        serialize: ({ town }) => town.transport?.serialize?.() || null,
        restore: ({ town, state }) => town.transport?.restore?.(state || {}) || { ok: false, reason: 'transport_unavailable' }
      }
    },
    {
      id: 'perimeter', version: '1.0.0', apiVersion: 1, domains: ['land'],
      catalogueSchemaVersion: '1',
      routes: { ACQUIRE_LAND: 'land', ANNEX_EDGE: 'annex' }, planTypes: ['land', 'annex'],
      capabilities: { survey: true, acquisition: true },
      hooks: { stats: simpleStats('perimeter') }
    },
    {
      id: 'governance', version: '1.0.0', apiVersion: 1, domains: ['council', 'policy', 'economy'],
      catalogueSchemaVersion: '1',
      routes: Object.fromEntries([
        'RAISE_TAX', 'CUT_TAX', 'KEEP_TAX', 'HIRE_WORKERS', 'ATTRACT_SETTLERS', 'FUND_INNOVATION',
        'TRADE_BUY', 'TRADE_SELL', 'SET_ASIDE_RESERVE', 'BOND_ISSUE', 'SUBSIDY', 'SLASH_SPENDING',
        'HOST_EVENT', 'DECLARE_EMERGENCY', 'STUDY_ROAD', 'STUDY_ECONOMY', 'STUDY_DEMOGRAPHICS',
        'STUDY_TRAFFIC', 'STUDY_INCIDENTS', 'SOLICIT_FDI', 'APPROVE_CONCESSION',
        'ENACT_SCHEME', 'END_SCHEME', 'PASS_LAW', 'REPEAL_LAW', 'NO_ACTION'
      ].map((intent) => [intent, null])),
      planTypes: [],
      capabilities: { council: true, policy: true, finance: true },
      hooks: { stats: simpleStats('governance') }
    },
    {
      id: 'planning', version: '1.0.0', apiVersion: 1, domains: ['planning', 'zoning'],
      catalogueSchemaVersion: '1',
      routes: { BUILD_DISTRICT: 'district', REZONE: 'rezone', UPZONE: 'upzone', CLEAR_LOT: 'clear' },
      planTypes: ['district', 'rezone', 'upzone', 'clear'],
      capabilities: { zoning: true, districtPlanning: true, clearance: true }
    },
    {
      id: 'society', version: '1.0.0', apiVersion: 1, domains: ['society'],
      catalogueSchemaVersion: '1',
      intents: [], planTypes: [], capabilities: { mood: true, crime: true, justice: true, elections: true },
      hooks: {
        updateHour: ({ town, dt, clock }) => town.society?.update(dt, clock),
        stats: simpleStats('society')
      }
    },
    {
      id: 'forest', version: '1.0.0', apiVersion: 1, domains: ['ecology'],
      catalogueSchemaVersion: '1',
      intents: [], planTypes: [], capabilities: { planting: true, deforestation: true, naturalFall: true },
      hooks: { updateHour: ({ town, clock }) => town.forest?.update(clock), stats: simpleStats('forest') }
    },
    {
      id: 'citizens', version: '1.0.0', apiVersion: 1, domains: ['citizens'],
      catalogueSchemaVersion: '1',
      intents: [], planTypes: [], capabilities: { lifecycle: true, staffing: true, mood: true },
      hooks: { stats: simpleStats('lifecycle') }
    }
  ];
  for (const manifest of manifests) registry.register(manifest);
  return registry;
}
