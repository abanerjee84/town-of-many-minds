import { CONSTRUCTION_BLOCKS } from './constructionBlocks.js';
import { publicSpaceStats } from './publicspace/publicKit.js';

const rowsFor = (kit) => CONSTRUCTION_BLOCKS.filter((row) => row.kit === kit);

function simpleStats(systemName) {
  return ({ town }) => town[systemName]?.stats?.() || null;
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
      routes: { IMAGINE_ARCHETYPE: 'archetype' }, planTypes: ['archetype'],
      capabilities: { catalogue: true, quote: true, demand: true }
    },
    {
      id: 'houses', version: '1.0.0', apiVersion: 1, domains: ['housing', 'commerce'],
      catalogue: rowsFor('houses'),
      routes: { DEVELOP_HOUSING: 'house', OPEN_SHOP: 'shop', BUILD_OFFICE: 'office', TIERUP: 'tierup', UPGRADE_BUILDING: 'upgrade', RENOVATE: 'renovate', WING: 'wing', RESTRUCTURE_BUILDING: 'restructure' },
      planTypes: ['house', 'shop', 'office', 'tierup', 'upgrade', 'renovate', 'wing', 'restructure'],
      capabilities: { catalogue: true, build: true, upgrade: true, staffing: true },
      hooks: { stats: ({ town }) => ({ buildings: (town.buildings || []).filter((b) => b.kind === 'house' || b.purpose === 'commercial').length }) }
    },
    {
      id: 'industry', version: '1.0.0', apiVersion: 1, domains: ['industry'],
      routes: { BUILD_FACTORY: 'factory' }, planTypes: ['factory'],
      capabilities: { production: true, staffing: true, catalogue: true },
      hooks: { stats: simpleStats('industry') }
    },
    {
      id: 'civic', version: '1.0.0', apiVersion: 1, domains: ['civic'],
      catalogue: rowsFor('civic'),
      routes: { BUILD_CIVIC: 'civic', EXPAND_CLINIC: 'civic', BUILD_LANDMARK: 'landmark', EXPAND_LANDMARK: 'wing' },
      planTypes: ['civic', 'landmark', 'wing'],
      capabilities: { catalogue: true, build: true, upgrade: true, serviceDemand: true },
      hooks: { stats: ({ town }) => ({ facilities: [...(town.civicIndex?.values?.() || [])] }) }
    },
    {
      id: 'resources', version: '1.0.0', apiVersion: 1, domains: ['resource'],
      catalogue: rowsFor('resources'),
      routes: { UPGRADE_RESOURCE: 'resource' }, planTypes: ['resource'],
      capabilities: { catalogue: true, production: true, storage: true, placement: true },
      hooks: { stats: simpleStats('resources') }
    },
    {
      id: 'utilities', version: '1.0.0', apiVersion: 1, domains: ['utility'],
      catalogue: rowsFor('utilities'),
      routes: { EXPAND_POWER: 'power', EXPAND_WATER: 'water', EXPAND_SEWAGE: 'sewage' }, planTypes: ['power', 'water', 'sewage'],
      capabilities: { catalogue: true, networks: true, placement: true },
      hooks: { stats: simpleStats('utilities') }
    },
    {
      id: 'roads', version: '1.0.0', apiVersion: 1, domains: ['mobility'],
      catalogue: rowsFor('roads'),
      routes: { EXTEND_STREET: 'road', EXTEND_FOOTWAY: 'footway', UPGRADE_ROAD: 'roadup', BUILD_BRIDGE: 'bridge', ADD_PARKING: 'parking' },
      planTypes: ['road', 'footway', 'roadup', 'bridge', 'parking'],
      capabilities: { catalogue: true, planning: true, placement: true },
      hooks: { stats: ({ town }) => town.roadKit?.stats || null }
    },
    {
      id: 'publicspace', version: '1.0.0', apiVersion: 1, domains: ['public'],
      catalogue: rowsFor('publicspace'),
      routes: { PARK_LAND: 'park', PAVE_PLAZA: 'plaza' }, planTypes: ['park', 'plaza'],
      capabilities: { catalogue: true, placement: true },
      hooks: { stats: ({ town }) => publicSpaceStats(town) }
    },
    {
      id: 'props', version: '1.0.0', apiVersion: 1, domains: ['public', 'mobility'],
      catalogue: rowsFor('props'),
      routes: { PLANT_TREES: 'prop-tree', INSTALL_LAMP: 'prop-lamp' }, planTypes: ['prop-tree', 'prop-lamp'],
      capabilities: { catalogue: true, placement: true }
    },
    {
      id: 'vehicles', version: '1.0.0', apiVersion: 1, domains: ['transport', 'emergency'],
      routes: { DISPATCH_UNITS: null }, planTypes: [],
      capabilities: { catalogue: true, fleet: true, procurement: true },
      hooks: { stats: simpleStats('vehicles') }
    },
    {
      id: 'transport', version: '1.0.0', apiVersion: 1, domains: ['transport'],
      routes: { BUILD_TRANSIT: 'civic' }, planTypes: ['civic'],
      capabilities: { routing: true, stops: true, fleet: true },
      hooks: {
        updateHour: ({ town, dt, clock }) => town.transport?.update(dt, clock),
        stats: simpleStats('transport')
      }
    },
    {
      id: 'perimeter', version: '1.0.0', apiVersion: 1, domains: ['land'],
      routes: { ACQUIRE_LAND: 'land', ANNEX_EDGE: 'annex' }, planTypes: ['land', 'annex'],
      capabilities: { survey: true, acquisition: true },
      hooks: { stats: simpleStats('perimeter') }
    },
    {
      id: 'governance', version: '1.0.0', apiVersion: 1, domains: ['council', 'policy', 'economy'],
      routes: Object.fromEntries([
        'RAISE_TAX', 'CUT_TAX', 'KEEP_TAX', 'HIRE_WORKERS', 'ATTRACT_SETTLERS', 'FUND_INNOVATION',
        'TRADE_BUY', 'TRADE_SELL', 'SET_ASIDE_RESERVE', 'BOND_ISSUE', 'SUBSIDY', 'SLASH_SPENDING',
        'HOST_EVENT', 'DECLARE_EMERGENCY', 'STUDY_ROAD', 'STUDY_ECONOMY', 'STUDY_DEMOGRAPHICS',
        'STUDY_TRAFFIC', 'STUDY_INCIDENTS', 'ENACT_SCHEME', 'END_SCHEME', 'PASS_LAW', 'REPEAL_LAW', 'NO_ACTION'
      ].map((intent) => [intent, null])),
      planTypes: [],
      capabilities: { council: true, policy: true, finance: true },
      hooks: { stats: simpleStats('governance') }
    },
    {
      id: 'planning', version: '1.0.0', apiVersion: 1, domains: ['planning', 'zoning'],
      routes: { BUILD_DISTRICT: 'district', REZONE: 'rezone', UPZONE: 'upzone', CLEAR_LOT: 'clear' },
      planTypes: ['district', 'rezone', 'upzone', 'clear'],
      capabilities: { zoning: true, districtPlanning: true, clearance: true }
    },
    {
      id: 'society', version: '1.0.0', apiVersion: 1, domains: ['society'],
      intents: [], planTypes: [], capabilities: { mood: true, crime: true, justice: true, elections: true },
      hooks: {
        updateHour: ({ town, dt, clock }) => town.society?.update(dt, clock),
        stats: simpleStats('society')
      }
    },
    {
      id: 'forest', version: '1.0.0', apiVersion: 1, domains: ['ecology'],
      intents: [], planTypes: [], capabilities: { planting: true, deforestation: true, naturalFall: true },
      hooks: { updateHour: ({ town, clock }) => town.forest?.update(clock), stats: simpleStats('forest') }
    },
    {
      id: 'citizens', version: '1.0.0', apiVersion: 1, domains: ['citizens'],
      intents: [], planTypes: [], capabilities: { lifecycle: true, staffing: true, mood: true },
      hooks: { stats: simpleStats('lifecycle') }
    }
  ];
  for (const manifest of manifests) registry.register(manifest);
  return registry;
}
