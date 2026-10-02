import { civicFacility } from '../civic/civicKit.js';

export const FLEET_CAP = 8;

const ROSTER = [
  { type: 'police', homes: ['police'], each: 2, max: 2 },
  { type: 'fire', homes: ['fire'], each: 1, max: 1 },
  { type: 'ambulance', homes: ['hospital', 'clinic'], each: 1, max: 2 },
  { type: 'utility', homes: ['townhall', 'government'], each: 1, max: 2 }
];

export function civicSites(town) {
  const g = town.grid;
  const sites = [];
  for (const [idx, id] of town.civicIndex || new Map()) {
    const x = idx % g.w;
    const y = Math.floor(idx / g.w);
    sites.push({ id, label: town.civicNames?.get(idx) || civicFacility(id).label, cell: [x, y] });
  }
  return sites;
}

function tally(plan, type) {
  let n = 0;
  for (const r of plan) if (r.type === type) n++;
  return n;
}

export function fleetPlan(town, rng) {
  const sites = civicSites(town);
  const plan = [];
  for (const row of ROSTER) {
    for (const home of sites) {
      if (!row.homes.includes(home.id)) continue;
      for (let i = 0; i < row.each; i++) {
        if (plan.length >= FLEET_CAP || tally(plan, row.type) >= row.max) break;
        const road = town.nearestRoadCell(home.cell[0], home.cell[1]);
        if (!road) continue;
        plan.push({
          type: row.type,
          homeLabel: home.label,
          homeCell: road,
          cell: road,
          stationKey: `${home.cell[0]},${home.cell[1]}`
        });
      }
    }
  }
  const shops = town.buildings.filter((b) => b.kind === 'shop').length;
  if (shops >= 4 && plan.length < FLEET_CAP) {
    plan.push({ type: 'refuse', homeLabel: 'Depot', homeCell: null, cell: town.randomRoadCell(rng) });
  }
  return plan;
}

export function fleetSummary(vehicles) {
  const out = { emergency: 0, service: 0, civilian: 0, units: {} };
  for (const v of vehicles) {
    if (v.role === 'emergency') out.emergency++;
    else if (v.role === 'service') out.service++;
    else out.civilian++;
    if (v.unit) out.units[v.unit] = (out.units[v.unit] || 0) + 1;
  }
  return out;
}
