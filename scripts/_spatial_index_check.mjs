import assert from 'node:assert/strict';
import { SpatialIndex } from '../src/core/spatialIndex.js';
import { cachedRoadPath } from '../src/simulation/roadPathCache.js';

const list = Array.from({ length: 1000 }, (_, i) => ({ group: { position: {
  x: (i % 40) * 4 - 80, z: Math.floor(i / 40) * 4 - 50
} } }));
const index = new SpatialIndex(8);
index.rebuild(list);
const check = (x, z, radius) => {
  const candidates = index.near(x, z, radius);
  const exact = a => Math.abs(a.group.position.x - x) <= radius && Math.abs(a.group.position.z - z) <= radius;
  assert.deepEqual(candidates.filter(exact), list.filter(exact), 'nearby candidates must preserve the live scan and roster order');
  return candidates;
};
for (const radius of [0, 2, 5, 7, 8, 31]) {
  for (const point of [[0,0],[-8,-8],[-80,-50],[7.99,15.99]]) check(...point,radius);
}
assert(check(0,0,5).length < list.length / 10, 'dense-town broad phase must bound candidate work');
// A cached bucket list stays safe for within-bucket moves, and invalidates
// immediately when a vehicle crosses a bucket boundary during a shared step.
check(0,0,5);
list[0].group.position = { x: 1, z: 1 }; index.update(list[0]); check(0,0,5);
list[0].group.position = { x: 7, z: 7 }; index.update(list[0]); check(0,0,5);
const removed = list.splice(1,1)[0]; index.remove(removed); check(0,0,5);
const added = { group: { position: { x: -1, z: 0 } } }; list.push(added); index.rebuild(list); check(0,0,5);

const road = new Set(['0,0','1,0','2,0']);
const grid = { w: 3, h: 2, inBounds: (x,y) => x>=0 && x<3 && y>=0 && y<2,
  isRoad: (x,y) => road.has(`${x},${y}`) };
const town = { grid, roadGraphVersion: 1 };
const first = cachedRoadPath(town,[0,0],[2,0]);
assert.deepEqual(first,[[0,0],[1,0],[2,0]]);
assert.equal(cachedRoadPath(town,[0,0],[2,0]),first);
assert.throws(() => first[1][0] = 9, TypeError);
road.delete('1,0'); town.roadGraphVersion++;
assert.equal(cachedRoadPath(town,[0,0],[2,0]),null,'road deletion must invalidate paths');
town.grid = { ...grid, isRoad: () => true };
assert.deepEqual(cachedRoadPath(town,[0,0],[2,0]),[[0,0],[1,0],[2,0]],'grid replacement must invalidate negative paths');
console.log('Spatial candidate coverage, live movement/order, roster changes and road cache invalidation passed.');
