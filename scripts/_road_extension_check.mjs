import assert from 'node:assert/strict';
import { Grid } from '../src/core/grid.js';
import { CELL_KIND } from '../src/core/config.js';
import { roadComponents } from '../src/placement/placementController.js';
import { chooseRoadExtension } from '../src/simulation/roadExtensionPlanner.js';
import { GrowthSystem, planFor } from '../src/simulation/growth.js';
import { TrafficSystem } from '../src/simulation/traffic.js';

const makeGrid = (linked) => {
  const g = new Grid(12, 10);
  for (let x = 1; x <= 10; x++) g.setKind(x, 1, CELL_KIND.ROAD);
  for (let x = 1; x <= 10; x++) g.setKind(x, 5, CELL_KIND.ROAD);
  if (linked) for (let y = 2; y <= 4; y++) g.setKind(1, y, CELL_KIND.ROAD);
  g.computeRoadMask();
  return g;
};
const shortcut = { cells: [[9, 2], [9, 3], [9, 4]], joins: true, junctionDelta: 2 };
const longSpur = { cells: [[3, 6], [3, 7], [3, 8], [3, 9]], joins: false, junctionDelta: 1 };
const trips = (from, to) => Array.from({ length: 8 }, () => ({ from, to, weight: 1 }));

{
  const g = new Grid(3, 3);
  g.setKind(1, 1, CELL_KIND.ROAD);
  const traffic = new TrafficSystem({ grid: g, rng: { fork: () => ({}) } });
  traffic.vehicles = [
    { parkTimer: 0, currentCell: () => [1, 1], holdT: 3, waitKind: 'collision' },
    { parkTimer: 0, currentCell: () => [1, 1], holdT: 3, waitKind: 'signal' }
  ];
  traffic.recordRoadTrip([1, 1], [2, 1]);
  traffic.computeCongestion(1);
  const snapshot = traffic.roadDemandSnapshot();
  assert.ok(snapshot.cells.get(g.idx(1, 1)).visits >= 2, 'live vehicles add a bounded pressure sample');
  assert.ok(snapshot.cells.get(g.idx(1, 1)).delay >= 1, 'signal waits do not erase measured road delay');
  assert.equal(snapshot.trips.length, 1);
  traffic.vehicles = [];
  traffic.sampleRoadDemand(121);
  assert.equal(traffic.roadDemandSnapshot().trips.length, 1, 'completed OD demand remains in the bounded road-history window');
}

{
  const g = makeGrid(true);
  const demand = { cells: new Map(), trips: trips([9, 1], [9, 5]) };
  const runs = [longSpur, shortcut];
  const first = chooseRoadExtension(g, runs, demand, roadComponents(g));
  assert.deepEqual(first.cells, shortcut.cells, 'sampled trips should prefer the shortcut');
  assert.equal(first.reason, 'shortens trips');
  assert.deepEqual(chooseRoadExtension(g, runs, demand, roadComponents(g)).cells, first.cells);
  assert.equal(chooseRoadExtension(g, [shortcut], {
    cells: new Map(), trips: trips([9, 1], [10, 1])
  }, roadComponents(g)), null, 'redundant road has no component bonus');
  assert.equal(chooseRoadExtension(g, runs, { cells: new Map(), trips: [] }, roadComponents(g)), null,
    'small samples must wait for measured demand instead of choosing geometry');

  const hotspot = new Map([[g.idx(9, 1), { visits: 20, delay: 12 }]]);
  const hotspotChoice = chooseRoadExtension(g, runs, { cells: hotspot, trips: [] }, roadComponents(g));
  assert.deepEqual(hotspotChoice.cells, shortcut.cells, 'a measured hotspot may justify a legal local extension without completed OD pairs');
  assert.equal(hotspotChoice.reason, 'relieves measured queue');
}

{
  const g = makeGrid(false);
  const orphanFirst = { ...shortcut, cells: shortcut.cells.slice().reverse() };
  const choice = chooseRoadExtension(g, [orphanFirst, shortcut], {
    cells: new Map(), trips: trips([9, 1], [9, 5])
  }, roadComponents(g));
  assert.deepEqual(choice.cells, shortcut.cells, 'joining components makes trips reachable');
  assert.equal(choice.reason, 'connects trips');
  assert.equal(chooseRoadExtension(g, [longSpur, shortcut], { cells: new Map(), trips: [] },
    roadComponents(g)).reason, 'joins networks');
}

{
  const g = new Grid(5, 5);
  g.kind.fill(CELL_KIND.WATER);
  g.setKind(1, 2, CELL_KIND.ROAD);
  g.setKind(2, 2, CELL_KIND.EMPTY);
  g.setKind(3, 2, CELL_KIND.EMPTY);
  g.computeRoadMask();
  const town = {
    grid: g, roadGraphVersion: 1, buildingAt: () => null,
    resources: { ownsCell: () => false },
    traffic: { roadDemandSnapshot: () => ({ cells: new Map(), trips: trips([1, 2], [3, 2]) }) }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.claims = new Set();
  assert.equal(growth.selectRoadExtension(), null, 'a detached two-cell nub is ineligible');
  g.setKind(3, 2, CELL_KIND.ROAD);
  g.setKind(2, 1, CELL_KIND.EMPTY);
  g.setKind(2, 3, CELL_KIND.EMPTY);
  g.computeRoadMask();
  growth.claims.add('2,1');
  town.resources.ownsCell = (x, y) => x === 2 && y === 3;
  assert.deepEqual(growth.selectRoadExtension()?.cells, [[2, 2]],
    'claims and resources cannot be included in a run');
  town.buildingAt = (x, y) => x === 2 && y === 2 ? {} : null;
  town.roadGraphVersion++;
  assert.equal(growth.selectRoadExtension(), null, 'a building blocks the last eligible cell');
}

{
  const g = new Grid(8, 8);
  for (let x = 1; x <= 6; x++) g.setKind(x, 3, CELL_KIND.ROAD);
  // This empty cell is beside a road junction, but the proposed run would
  // leave sideways from the junction instead of continuing a road end.
  const town = {
    grid: g,
    roadGraphVersion: 1,
    buildingAt: () => null,
    resources: { ownsCell: () => false },
    traffic: { roadDemandSnapshot: () => ({ cells: new Map([[g.idx(2, 3), { visits: 20, delay: 12 }]]), trips: [] }) }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.claims = new Set();
  const runs = growth.roadRuns([2, 2]);
  assert.ok(runs.length > 0, 'a straight road-end continuation remains eligible');
  assert.ok(runs.every((run) => run.cells.every(([x]) => x === 2)),
    'a side branch from a junction is rejected before demand scoring');
}

{
  const g = makeGrid(true);
  let funded = 0;
  const town = {
    grid: g, roadGraphVersion: 1,
    buildingAt: () => null,
    resources: { ownsCell: () => false },
    traffic: { roadDemandSnapshot: () => ({ cells: new Map(), trips: trips([9, 1], [9, 5]) }) },
    economy: {
      resolveProjectFinance: () => ({ affordable: true }),
      fundProject: () => { funded++; return { ok: true }; }
    }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.projects = [];
  growth.claims = new Set();
  growth.policyCost = 0;
  growth.policyHours = 0;
  growth.rng = { getState: () => 0, setState: () => {} };
  town.growth = growth;
  const quoted = growth.quote(planFor(town, 'road'));
  assert.equal(quoted.ok, true);
  assert.equal(quoted.quote.finalCost, quoted.plan.cells.length * 2000);
  assert.deepEqual(quoted.cell, quoted.plan.cells[0]);
  const repeated = growth.quote(planFor(town, 'road'));
  assert.deepEqual(repeated.plan.cells, quoted.plan.cells);
  assert.equal(repeated.quote.finalCost, quoted.quote.finalCost);
  town.traffic.roadDemandSnapshot = () => ({ cells: new Map(), trips: trips([9, 1], [10, 1]) });
  assert.equal(growth.quote(planFor(town, 'road')).reason, 'no eligible street extension',
    'sufficient demand without a useful run must block the road order');
  town.roadGraphVersion++;
  assert.equal(growth.apply(quoted.plan), false, 'stale selection must fail');
  assert.equal(growth.lastBlock, 'selected street is no longer available');
  assert.equal(funded, 0, 'stale selection must fail before payment');
}

console.log('road extension planner checks passed');
