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
  assert.equal(hotspotChoice, null, 'a same-component shortcut may not be justified by a hotspot alone');

  const flowing = new Map([[g.idx(3, 5), { visits: 120, delay: 0 }]]);
  assert.equal(chooseRoadExtension(g, [longSpur], { cells: flowing, trips: [] }, roadComponents(g)), null,
    'throughput without delay must not create a hotspot street');
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

  const measuredRun = { cells: [[3, 2], [3, 3], [3, 4]], joins: true, junctionDelta: 2 };
  const measured = new Map([[g.idx(3, 1), { visits: 4, delay: 8 }]]);
  const hotspotChoice = chooseRoadExtension(g, [shortcut, measuredRun], { cells: measured, trips: [] }, roadComponents(g));
  assert.deepEqual(hotspotChoice.cells, measuredRun.cells,
    'a measured delayed corridor outranks a generic component join when OD history is sparse');
  assert.equal(hotspotChoice.reason, 'relieves measured queue');
}

{
  // A delayed road cell in the middle of a straight corridor may justify one
  // carefully aligned bypass, but only when the run reconnects to another
  // street. This is the demand-directed exception to the road-end rule.
  const g = new Grid(14, 12);
  for (let x = 1; x <= 10; x++) {
    g.setKind(x, 3, CELL_KIND.ROAD);
    g.setKind(x, 8, CELL_KIND.ROAD);
  }
  g.computeRoadMask();
  const demand = { cells: new Map([[g.idx(4, 3), { visits: 5, delay: 10 }]]), trips: [] };
  const town = {
    grid: g,
    roadGraphVersion: 1,
    buildingAt: () => null,
    resources: { ownsCell: () => false },
    traffic: { roadDemandSnapshot: () => demand }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.claims = new Set();
  const branchRuns = growth.roadRuns([4, 4], { demand, allowMeasuredBranches: true });
  const branch = branchRuns.find((run) => run.measuredBranch);
  assert.ok(branch, 'a measured middle-corridor bypass must reconnect to a street');
  assert.equal(branch.junctionDelta, 2, 'the bypass records both deliberate junctions');
  assert.deepEqual(chooseRoadExtension(g, [branch], demand, roadComponents(g)).cells, branch.cells,
    'the planner can select the demand-directed bypass');
  const selected = growth.selectRoadExtension();
  assert.deepEqual(selected?.cells, branch.cells,
    'the live growth selector forwards measured pressure into road-run generation');
  assert.equal(growth.roadSelectionValid(selected), true,
    'the final construction validator preserves the measured bypass quote');
  assert.equal(growth.roadRuns([4, 4]).length, 0,
    'the same middle branch remains unavailable without measured demand');
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
  // A corridor-middle branch is never a valid extension, even when the
  // middle cell has a large observed queue. Growth must start at an end.
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
  assert.equal(runs.length, 0,
    'a side branch from a corridor middle is rejected before demand scoring');

  const endpointGrid = new Grid(10, 8);
  for (let x = 1; x <= 3; x++) endpointGrid.setKind(x, 3, CELL_KIND.ROAD);
  endpointGrid.computeRoadMask();
  const endpointTown = {
    grid: endpointGrid,
    roadGraphVersion: 1,
    buildingAt: () => null,
    resources: { ownsCell: () => false }
  };
  growth.town = endpointTown;
  const endpointRuns = growth.roadRuns([4, 3]);
  assert.ok(endpointRuns.length > 0, 'a road-end continuation remains eligible');
  assert.ok(endpointRuns.every((run) => run.cells.every(([, y]) => y === 3)),
    'a legal endpoint extension stays aligned with its source street');
  assert.equal(growth.roadRuns([3, 4]).filter((run) => !run.joins).length, 0,
    'an unmeasured ninety-degree turn from a road end cannot start a U-shaped loop');
  endpointTown.perimeter = { isAcquired: () => false };
  assert.equal(growth.roadRuns([4, 3]).length, 0,
    'frontier cells must be acquired before a street can enter them');
}

{
  const g = new Grid(9, 8);
  // Two parallel streets with a short vertical gap. Both ends of the gap are
  // already junctions, so closing it would create the dense ladder of crossings
  // seen in the long-run visual regression rather than a logical extension.
  for (let x = 2; x <= 6; x++) {
    g.setKind(x, 1, CELL_KIND.ROAD);
    g.setKind(x, 5, CELL_KIND.ROAD);
  }
  g.setKind(3, 0, CELL_KIND.ROAD);
  g.setKind(3, 6, CELL_KIND.ROAD);
  g.computeRoadMask();
  const town = {
    grid: g,
    buildingAt: () => null,
    resources: { ownsCell: () => false }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.claims = new Set();
  assert.equal(growth.roadRuns([3, 2]).length, 0,
    'a four-tile closure between busy junctions is rejected');
}

{
  // A U-shaped road has two open ends in the same component. The gap is
  // locally legal, but filling it would make a small loop around one block.
  // A hotspot at the endpoint must not be enough evidence to close it.
  const g = new Grid(10, 10);
  for (let x = 2; x <= 6; x++) g.setKind(x, 2, CELL_KIND.ROAD);
  for (let y = 2; y <= 6; y++) {
    g.setKind(2, y, CELL_KIND.ROAD);
    g.setKind(6, y, CELL_KIND.ROAD);
  }
  g.computeRoadMask();
  const town = {
    grid: g,
    buildingAt: () => null,
    resources: { ownsCell: () => false }
  };
  const growth = Object.create(GrowthSystem.prototype);
  growth.town = town;
  growth.claims = new Set();
  const runs = growth.roadRuns([3, 6]);
  assert.ok(runs.some((run) => run.joins), 'the U-gap remains detectable for measured OD evaluation');
  const loop = chooseRoadExtension(g, runs, {
    cells: new Map([[g.idx(2, 6), { visits: 24, delay: 18 }]]),
    trips: []
  }, roadComponents(g));
  assert.equal(loop, null, 'a same-component U-gap loop is rejected without OD evidence');
  const rawLoop = runs.find((run) => run.joins);
  town.roadGraphVersion = 1;
  assert.equal(growth.roadSelectionValid({ ...rawLoop, version: 1, benefit: 3, reason: 'relieves measured queue' }), false,
    'the final construction validator also rejects a forged hotspot-only loop');
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
