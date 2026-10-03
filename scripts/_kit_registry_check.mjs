import assert from 'node:assert/strict';
import { KitRegistry } from '../src/kits/kitRegistry.js';
import { registerBuiltinKits } from '../src/kits/builtinManifests.js';
import { buildingContract, projectContract, demandSignal, resourceFlow, serviceCoverage, vehicleAssignment, kitStats } from '../src/kits/kitContracts.js';
import { importIntegrityState } from '../src/simulation/integrityState.js';

const registry = registerBuiltinKits(new KitRegistry());
const report = registry.compatibilityReport();
assert.equal(report.valid, true);
assert(report.kits.length >= 14, `expected built-in kits, got ${report.kits.length}`);
assert.equal(registry.ownerOfCatalogue('civic.college'), 'civic');
assert.equal(registry.ownerOfCatalogue('industry.steelworks'), 'industry');
assert.equal(registry.catalogue({ kit: 'industry' }).length >= 10, true);
assert.equal(registry.resolveIntent('BUILD_TRANSIT')?.kitId, 'transport');
assert.equal(registry.resolveIntent('EXTEND_STREET')?.kitId, 'roads');
assert.equal(registry.resolveIntent('IMAGINE_ARCHETYPE')?.kitId, 'construction');
assert(report.intentRoutes.BUILD_FACTORY === 'industry');
assert(report.intentPlanTypes.UPGRADE_RESOURCE === 'resource');
assert(report.catalogueRoutes['industry.steelworks'] === 'industry');

const town = {
  seed: 1337,
  buildings: [{ id: 'b-1', kind: 'house', cell: [2, 3], footprint: [[2, 3]], floors: 2, capacity: 6 }],
  pedestrians: { citizens: [{ id: 'c-1' }] },
  grid: {
    w: 8,
    h: 8,
    inBounds: (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8,
    kindAt: (x, y) => (x === 2 && y === 3 ? 1 : 0),
    isRoad: (x, y) => x === 2 && y === 3,
    isWater: () => false,
    idx: (x, y) => y * 8 + x,
    owner: []
  },
  perimeter: { isAcquired: (x, y) => x < 4 && y < 4, acquiredBounds: () => ({ minX: 0, minY: 0, maxX: 3, maxY: 3 }) },
  rng: { fork: () => ({ float: () => 0.5 }) },
  nextEntityId: (kind) => `${kind}-1`
};
const context = registry.contextFor(town, 'houses');
assert.equal(context.apiVersion, 1);
assert.equal(context.read.population(), 1);
assert.equal(context.read.buildings()[0].id, 'b-1');
assert.throws(() => context.read.buildings().push({ id: 'mutate' }), TypeError);
assert.equal(context.read.grid.isRoad(2, 3), true);
assert.equal(context.read.acquired(3, 3), true);
assert.equal(buildingContract({ id: 'b-1', kind: 'house', floors: 2 }).contractVersion, 1);
assert.equal(projectContract({ projectId: 'p-1', kitId: 'houses', cost: 10 }).status, 'planned');
assert.equal(demandSignal({ producer: 'fixture', kind: 'housing', value: 2 }).priority, 0);
assert.equal(resourceFlow({ producer: 'fixture', resource: 'steel', amount: 3 }).contractVersion, 1);
assert.equal(serviceCoverage({ producer: 'fixture', kind: 'clinic', capacity: 4 }).served, 0);
assert.equal(vehicleAssignment({ producer: 'fixture', vehicleId: 'v-1', role: 'bus' }).role, 'bus');
assert.equal(kitStats({ kitId: 'fixture', values: { ok: true } }).values.ok, true);
let mutable = 1;
const tx = context.services.transaction({
  name: 'fixture-mutation',
  snapshot: () => mutable,
  restore: (value) => { mutable = value; }
}, () => {
  mutable = 9;
  throw new Error('fixture failure');
});
assert.equal(tx.ok, false);
assert.equal(mutable, 1);

const fixture = new KitRegistry();
fixture.register({ id: 'fixture.base', version: '1.0.0', apiVersion: 1, catalogue: [{ id: 'fixture.base.block', footprint: [1, 1] }] });
let restoredMarker = null;
fixture.register({
  id: 'fixture.demo', version: '1.0.0', apiVersion: 1, dependencies: ['fixture.base'],
  intents: ['TEST_FIXTURE'], planTypes: ['fixture'], catalogue: [{ id: 'fixture.demo.block', footprint: [2, 1] }],
  capabilities: { build: true }, hooks: {
    stats: () => ({ ok: true }),
    serialize: () => ({ marker: 'fixture-state' }),
    restore: ({ state }) => { restoredMarker = state?.marker || null; return { restored: restoredMarker }; }
  }
});
assert.deepEqual(fixture.validate().order, ['fixture.base', 'fixture.demo']);
assert.equal(fixture.resolveIntent('TEST_FIXTURE').kitId, 'fixture.demo');
assert.deepEqual(fixture.stats({}), { 'fixture.base': null, 'fixture.demo': { ok: true } });
const fixtureState = fixture.serialize({ seed: 1337, buildings: [], pedestrians: {}, grid: {} });
assert.equal(fixtureState.kits['fixture.demo'].marker, 'fixture-state');
assert.equal(fixture.restore({ seed: 1337, buildings: [], pedestrians: {}, grid: {} }, fixtureState).ok, true);
assert.equal(restoredMarker, 'fixture-state');
assert.throws(() => fixture.register({ id: 'fixture.demo', version: '1.0.0', apiVersion: 1 }), /already registered/);

const hookCalls = { transport: 0, society: 0, forest: 0 };
registry.invoke('updateHour', {
  transport: { update: () => { hookCalls.transport++; } },
  society: { update: () => { hookCalls.society++; } },
  forest: { update: () => { hookCalls.forest++; } }
}, { dt: 1, clock: { day: 0 } });
assert.deepEqual(hookCalls, { transport: 1, society: 1, forest: 1 });
const incompatible = importIntegrityState({ seed: 1337, kits: registry }, {
  seed: 1337,
  kitCompatibility: { kits: [{ id: 'foreign', version: '9.0.0', apiVersion: 1, contextApiVersion: 1 }] }
});
assert.equal(incompatible.reason, 'kit_compatibility_mismatch');

const cycle = new KitRegistry();
cycle.register({ id: 'cycle.a', version: '1.0.0', apiVersion: 1, dependencies: ['cycle.b'] });
cycle.register({ id: 'cycle.b', version: '1.0.0', apiVersion: 1, dependencies: ['cycle.a'] });
assert.throws(() => cycle.validate(), /dependency cycle/);

console.log(`KIT REGISTRY OK: ${report.kits.length} built-ins, ${Object.keys(report.intentRoutes).length} intent routes, fixture lifecycle/rollback boundary validated`);
