import * as THREE from 'three';
import { findPath } from '../core/pathfinding.js';
import performanceRules from '../data/performance.json' with { type: 'json' };

/** A bounded pavement/crosswalk detour around a physical vehicle obstacle. */
export function obstacleDetour(agent) {
  const rules = performanceRules.agents.pedestrianAvoidance;
  const spacing = rules?.spacing || 0.4;
  const radius = rules?.radius || 7;
  const half = Math.ceil(radius / spacing);
  const size = half * 2 + 1;
  const origin = agent.group.position;
  const grid = agent.town.grid;
  const crossings = new Set();
  const current = grid.worldToCell(origin.x, origin.z);
  if (grid.roadDegree(current.x, current.y) >= 3) crossings.add(`${current.x},${current.y}`);
  const limit = Math.min(agent.points.length, agent.idx + 10);
  for (let i = agent.idx; i < limit; i++) {
    if (agent.points[i].crossingCell) crossings.add(agent.points[i].crossingCell);
  }
  const world = (x, y) => ({ x: origin.x + (x-half)*spacing, z: origin.z + (y-half)*spacing });
  const legal = (x, y) => {
    const p = world(x,y), c = grid.worldToCell(p.x,p.z);
    if (!grid.isRoad(c.x,c.y)) return false;
    if (grid.isCarriageway(p.x,p.z,1.5) && !crossings.has(`${c.x},${c.y}`)) return false;
    return !agent.vehicleBlocked(p.x,p.z);
  };
  // An intermediate route sample may lie inside the bus. Join the first legal
  // later waypoint rather than trying to reach that impossible point forever.
  for (let i = agent.idx; i < limit; i++) {
    const target = agent.points[i];
    const gx = Math.round((target.x-origin.x)/spacing)+half;
    const gy = Math.round((target.z-origin.z)/spacing)+half;
    if (gx < 0 || gy < 0 || gx >= size || gy >= size || !legal(gx,gy)) continue;
    const local = { w:size, h:size, inBounds:(x,y)=>x>=0 && y>=0 && x<size && y<size };
    const path = findPath(local,[half,half],[gx,gy],{
      walkable:legal, allowStart:true, maxNodes:rules?.maxNodes || 900
    });
    if (!path || path.length < 2) continue;
    const points = path.slice(1).map(([x,y]) => {
      const p = world(x,y), c = grid.worldToCell(p.x,p.z);
      const point = new THREE.Vector3(p.x,grid.heightAtWorld(p.x,p.z),p.z);
      if (crossings.has(`${c.x},${c.y}`)) point.crossingCell = `${c.x},${c.y}`;
      return point;
    });
    points.push(target.clone());
    if (target.crossingCell) points[points.length-1].crossingCell=target.crossingCell;
    return { points, resumeIndex:i+1 };
  }
  return null;
}
