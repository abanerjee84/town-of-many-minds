/**
 * Narrow context passed to registered kits.
 *
 * This is deliberately read-only at the boundary. A kit can inspect the town
 * through stable queries and use explicitly named services, but it cannot
 * mutate another kit's arrays by keeping a reference to Town itself.
 */
export const KIT_CONTEXT_API_VERSION = 1;
import { runKitTransaction } from './kitTransaction.js';
import { events } from '../core/events.js';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

function buildingSnapshot(building) {
  if (!building) return null;
  return freeze({
    id: building.id ?? null,
    kind: building.kind ?? null,
    facility: building.facility ?? null,
    purpose: building.purpose ?? null,
    zone: building.zone ?? null,
    cell: building.cell ? [...building.cell] : null,
    footprint: (building.footprint || []).map((cell) => [...cell]),
    floors: building.floors ?? building.house?.floors ?? 1,
    capacity: building.capacity ?? building.house?.capacity ?? 0,
    blockId: building.blockId ?? building.house?.spec?.blockId ?? null,
    factoryType: building.factoryType ?? building.house?.spec?.factoryType ?? null,
    tourism: building.tourism ? { ...building.tourism } : null
  });
}

function safeGrid(town) {
  const grid = town?.grid;
  return freeze({
    width: grid?.w ?? 0,
    height: grid?.h ?? 0,
    inBounds: (x, y) => !!grid?.inBounds?.(x, y),
    kindAt: (x, y) => grid?.kindAt?.(x, y) ?? null,
    isRoad: (x, y) => !!grid?.isRoad?.(x, y),
    isWater: (x, y) => !!grid?.isWater?.(x, y),
    ownerAt: (x, y) => grid?.owner?.[grid.idx?.(x, y)] ?? null
  });
}

/** Build a stable context for one kit invocation. */
export function createKitContext(town, { kitId = 'unknown', rng = null } = {}) {
  if (!town) throw new Error('KitContext requires a town');
  const random = rng || town.rng?.fork?.(`kit:${kitId}`) || town.rng || null;
  const read = {
    seed: () => town.seed,
    population: () => town.pedestrians?.citizens?.length || 0,
    buildings: () => freeze((town.buildings || []).map(buildingSnapshot)),
    building: (id) => buildingSnapshot((town.buildings || []).find((building) => building.id === id)),
    acquired: (x, y) => !!town.perimeter?.isAcquired?.(x, y),
    acquiredBounds: () => town.perimeter?.acquiredBounds?.() || null,
    roadCells: () => freeze((town.grid?.roadCells?.() || []).map((cell) => [...cell])),
    roadAccess: (x, y) => {
      const grid = town.grid;
      return !!grid && [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => grid.isRoad?.(x + dx, y + dy));
    },
    resources: () => freeze(town.resources?.stats?.() || {}),
    economy: () => freeze({
      treasury: Number(town.economy?.treasury) || 0,
      reserve: Number(town.economy?.reserve) || 0,
      debt: Number(town.economy?.debt) || 0
    }),
    grid: safeGrid(town)
  };
  const services = {
    rng: random,
    nextEntityId: (kind) => town.nextEntityId?.(kind),
    emit: (event, payload) => (town.events || events).emit?.(event, payload),
    treasury: {
      balance: () => Number(town.economy?.treasury) || 0,
      transfer: ({ to = 'contractor', amount = 0, category = 'kit_transfer', metadata = {} } = {}) => {
        if (!town.economy?.transfer) return { ok: false, reason: 'economy_unavailable' };
        return town.economy.transfer({ from: 'government', to, amount, category, metadata });
      }
    },
    transaction: (options, mutate) => runKitTransaction(options, mutate)
  };
  return freeze({ apiVersion: KIT_CONTEXT_API_VERSION, kitId, read, services });
}

export function kitData(value) {
  return freeze(value);
}
