import { ROAD_FEATURE } from '../core/grid.js';
import { CELL_KIND, ZONE } from '../core/config.js';

/**
 * Produce a compact, human-readable town map for inspection. This is a
 * diagnostic export only: Governance emits it before a sitting, but never
 * includes it in a provider message.
 */

const LEGEND = [
  '. frontier/unacquired', '_ acquired vacant', 'r residential', 'c commercial',
  'i industrial', 'u civic/service', 'f food/farm', 'e energy', 'g fuel',
  'w water/resource', 'p park', 'P plaza', '~ water', '# street',
  '+ 4-lane street', 'o roundabout', 't transit stop', ': footway',
  '! pressure overlay'
];

const ROAD_STOP_KEYS = (town) => new Set([
  ...(town.transport?.stops || []).map(([x, y]) => `${x},${y}`),
  ...(town.transport?.manualStops || [])
]);

function buildingSymbol(building) {
  if (!building) return null;
  if (building.kind === 'house') return 'r';
  if (building.kind === 'factory' || building.purpose === 'industrial') return 'i';
  if (building.kind === 'shop' || building.kind === 'office' ||
      building.kind === 'hotel' || building.kind === 'resort' ||
      building.purpose === 'commercial') return 'c';
  if (building.kind === 'civic' || building.purpose === 'civic') return 'u';
  return 'u';
}

function resourceSymbol(site) {
  const id = String(site?.resource || site?.work || site?.kind || '').toLowerCase();
  if (id.includes('food') || id.includes('farm') || id.includes('agri')) return 'f';
  if (id.includes('energy') || id.includes('power')) return 'e';
  if (id.includes('fuel') || id.includes('gas')) return 'g';
  if (id.includes('water') || id.includes('sewage')) return 'w';
  return 'w';
}

function resourceAt(town, x, y) {
  const sites = town.resources?.sites || [];
  for (const site of sites) {
    const cells = site.cells || (site.cell ? [site.cell] : []);
    if (cells.some(([sx, sy]) => sx === x && sy === y)) return site;
  }
  return null;
}

function roadSymbol(town, x, y, stops) {
  const grid = town.grid;
  const feature = grid.roadFeature?.[grid.idx(x, y)];
  if (stops.has(`${x},${y}`)) return 't';
  if (feature === ROAD_FEATURE.ROUNDABOUT) return 'o';
  if ((grid.roadClass?.[grid.idx(x, y)] || 0) >= 4) return '+';
  return '#';
}

function cellSymbol(town, x, y, stops, pressure = null) {
  const grid = town.grid;
  if (!grid.inBounds(x, y)) return ' ';
  if (pressure?.delay > 0.5 || pressure?.visits > 3) return '!';
  if (grid.isRoad(x, y)) return roadSymbol(town, x, y, stops);
  if (grid.isWater(x, y)) return '~';
  const resource = resourceAt(town, x, y);
  if (resource) return resourceSymbol(resource);
  const building = town.buildingAt(x, y);
  const built = buildingSymbol(building);
  if (built) return built;
  const kind = grid.kindAt(x, y);
  if (kind === CELL_KIND.PATH) return ':';
  if (kind === CELL_KIND.PARK) return 'p';
  if (kind === CELL_KIND.PLAZA) return 'P';
  if (town.perimeter?.isAcquired(x, y)) {
    const zone = grid.zone?.[grid.idx(x, y)];
    if (zone === ZONE.RESIDENTIAL) return 'r';
    if (zone === ZONE.COMMERCIAL) return 'c';
    if (zone === ZONE.INDUSTRIAL) return 'i';
    if (zone === ZONE.CIVIC) return 'u';
    return '_';
  }
  return '.';
}

function demandIndex(town) {
  const cells = new Map();
  for (const bucket of town.traffic?.demandBuckets || []) {
    for (const [idx, value] of bucket.cells || []) {
      const row = cells.get(idx) || { visits: 0, delay: 0 };
      row.visits += Number(value.visits) || 0;
      row.delay += Number(value.delay) || 0;
      cells.set(idx, row);
    }
  }
  return cells;
}

function boundsFor(town) {
  const g = town.grid;
  const b = town.perimeter?.stats?.().bounds || { minX: 0, minY: 0, maxX: g.w - 1, maxY: g.h - 1 };
  return {
    minX: Math.max(0, b.minX - 1),
    minY: Math.max(0, b.minY - 1),
    maxX: Math.min(g.w - 1, b.maxX + 1),
    maxY: Math.min(g.h - 1, b.maxY + 1)
  };
}

function coarseMap(town, bounds, scale, pressure, stops) {
  const rows = [];
  const width = Math.ceil((bounds.maxX - bounds.minX + 1) / scale);
  for (let by = bounds.minY; by <= bounds.maxY; by += scale) {
    let line = '';
    for (let bx = bounds.minX; bx <= bounds.maxX; bx += scale) {
      const counts = new Map();
      for (let y = by; y < Math.min(bounds.maxY + 1, by + scale); y++) {
        for (let x = bx; x < Math.min(bounds.maxX + 1, bx + scale); x++) {
          const idx = town.grid.idx(x, y);
          const symbol = cellSymbol(town, x, y, stops, pressure.get(idx));
          counts.set(symbol, (counts.get(symbol) || 0) + 1);
        }
      }
      const symbol = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ' ';
      line += symbol;
    }
    rows.push(`y${String(by).padStart(2, '0')} ${line}`);
  }
  return { rows, width };
}

function exactWindow(town, center, radius, pressure, stops, label) {
  const g = town.grid;
  const minX = Math.max(0, center[0] - radius);
  const maxX = Math.min(g.w - 1, center[0] + radius);
  const minY = Math.max(0, center[1] - radius);
  const maxY = Math.min(g.h - 1, center[1] + radius);
  const rows = [`WINDOW ${label} CENTER=(${center[0]},${center[1]}) RANGE=x${minX}..${maxX},y${minY}..${maxY}`];
  rows.push(`    ${Array.from({ length: maxX - minX + 1 }, (_, i) => String((minX + i) % 10)).join('')}`);
  for (let y = minY; y <= maxY; y++) {
    let line = '';
    for (let x = minX; x <= maxX; x++) line += cellSymbol(town, x, y, stops, pressure.get(g.idx(x, y)));
    rows.push(`${String(y).padStart(3, '0')} ${line}`);
  }
  return rows;
}

function pressureRows(town, pressure) {
  const g = town.grid;
  return [...pressure.entries()]
    .map(([idx, value]) => ({ x: idx % g.w, y: Math.floor(idx / g.w), ...value }))
    .filter((row) => row.delay > 0 || row.visits > 0)
    .sort((a, b) => b.delay - a.delay || b.visits - a.visits)
    .slice(0, 8);
}

/** Return the inspection text written to MapNow/latest.map.txt. */
export function renderMapNow(town, { clock = null, scale = 2, windowRadius = 4 } = {}) {
  const stats = town.stats?.() || {};
  const bounds = boundsFor(town);
  const pressure = demandIndex(town);
  const stops = ROAD_STOP_KEYS(town);
  const coarse = coarseMap(town, bounds, scale, pressure, stops);
  const pressureRowsList = pressureRows(town, pressure);
  const frontier = town.perimeter?.frontierCells?.(6) || [];
  const windows = [];
  for (const row of pressureRowsList.slice(0, 2)) windows.push(exactWindow(town, [row.x, row.y], windowRadius, pressure, stops, `H${windows.length + 1}`));
  for (const cell of frontier.slice(0, Math.max(0, 3 - windows.length))) windows.push(exactWindow(town, cell, windowRadius, pressure, stops, `F${windows.length + 1}`));
  const mobility = stats.mobility || town.traffic?.mobilityStats?.() || {};
  const resources = stats.resources?.types || {};
  const resourceLine = Object.entries(resources).slice(0, 8).map(([key, row]) => `${key}=${row.percent ?? 0}%`).join(' ');
  const graph = stats.graph || town.roadKit?.stats?.graph || {};
  const roadComponents = stats.components?.count ?? graph.components ?? town.roadComponents?.()?.count ?? '?';
  const lines = [
    'TOMM-MAP/1',
    `DAY=${clock?.day ?? town.clockDay ?? '?'} TIME=${clock?.timeString || '?'} SEASON=${stats.weather?.season || '?'}`,
    `GRID=${town.grid.w}x${town.grid.h} CELL=4m SCALE=${scale}x${scale}`,
    `ACQUIRED_BOUNDS=x${bounds.minX}..${bounds.maxX},y${bounds.minY}..${bounds.maxY}`,
    `ACQUIRED_TILES=${stats.perimeter?.acquired ?? town.perimeter?.acquiredCells ?? '?'} BUILDINGS=${stats.buildings ?? town.buildings.length} POPULATION=${stats.population ?? town.pedestrians?.citizens?.length ?? 0}`,
    `CONGESTION=${Math.round((mobility.congestion || 0) * 100)}% QUEUE=${mobility.queueLength ?? 0} VEHICLES=${mobility.vehicles ?? town.traffic?.vehicles?.length ?? 0}`,
    '',
    'LEGEND',
    ...LEGEND,
    '',
    `COARSE_MAP width=${coarse.width} height=${coarse.rows.length}`,
    ...coarse.rows,
    '',
    'RESOURCE_PRESSURE',
    resourceLine || 'none',
    '',
    'ROAD_GRAPH',
    `nodes=${graph.nodes ?? '?'} edges=${graph.edges ?? '?'} components=${roadComponents}`,
    '',
    'PRESSURE_CELLS'
  ];
  if (pressureRowsList.length) {
    for (const row of pressureRowsList) lines.push(`(${row.x},${row.y}) visits=${row.visits.toFixed(1)} delay=${row.delay.toFixed(1)}`);
  } else lines.push('none');
  lines.push('', 'FRONTIER_CANDIDATES');
  if (frontier.length) frontier.forEach(([x, y], i) => lines.push(`F${i + 1}=(${x},${y}) acquired=false`));
  else lines.push('none');
  lines.push('', ...windows.flat(), '');
  lines.push('NOTE=diagnostic export only; this map is not included in Council provider prompts.');
  return lines.join('\n');
}
