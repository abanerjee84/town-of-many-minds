/** Stable, serializable contracts shared by kit manifests and adapters. */
export const KIT_CONTRACT_VERSION = 1;

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function serializable(value) {
  if (ArrayBuffer.isView(value)) return Array.from(value, serializable);
  if (Array.isArray(value)) return value.map(serializable);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = serializable(child);
  return out;
}

export function catalogueContract(row, owner = 'unknown') {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) {
    throw new Error(`kit ${owner} has an invalid catalogue row ID`);
  }
  const footprint = row.footprint === undefined ? undefined : [...row.footprint];
  if (footprint && (footprint.length !== 2 || footprint.some((n) => !Number.isInteger(n) || n < 1))) {
    throw new Error(`kit ${owner} catalogue row ${row.id} has an invalid footprint`);
  }
  return freeze({
    ...row,
    contractVersion: KIT_CONTRACT_VERSION,
    footprint,
    modules: row.modules ? [...row.modules] : []
  });
}

export function buildingContract(record = {}) {
  if (!record.id) throw new Error('building contract requires an id');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    id: String(record.id),
    kitId: String(record.kitId || record.kind || 'unknown'),
    kind: record.kind || null,
    facility: record.facility || null,
    cell: record.cell ? [...record.cell] : null,
    footprint: (record.footprint || []).map((cell) => [...cell]),
    floors: Math.max(1, Math.round(finite(record.floors, 1))),
    capacity: Math.max(0, finite(record.capacity)),
    blockId: record.blockId || null,
    ownerType: record.ownerType || null
  });
}

export function projectContract(record = {}) {
  if (!record.projectId) throw new Error('project contract requires a projectId');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    projectId: String(record.projectId),
    kitId: String(record.kitId || 'unknown'),
    intent: record.intent || null,
    planType: record.planType || null,
    footprint: (record.footprint || []).map((cell) => [...cell]),
    cost: Math.max(0, finite(record.cost)),
    buildHours: Math.max(0, finite(record.buildHours)),
    status: record.status || 'planned'
  });
}

export function demandSignal(record = {}) {
  if (!record.kind) throw new Error('demand signal requires a kind');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    producer: record.producer || 'unknown',
    kind: String(record.kind),
    value: finite(record.value),
    threshold: Number.isFinite(Number(record.threshold)) ? Number(record.threshold) : null,
    priority: Math.max(0, finite(record.priority)),
    reason: String(record.reason || '')
  });
}

export function resourceFlow(record = {}) {
  if (!record.resource) throw new Error('resource flow requires a resource');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    producer: record.producer || 'unknown',
    resource: String(record.resource),
    amount: finite(record.amount),
    unit: String(record.unit || 'units'),
    from: record.from || null,
    to: record.to || null,
    entityId: record.entityId || null,
    rollbackToken: record.rollbackToken || null
  });
}

export function serviceCoverage(record = {}) {
  if (!record.kind) throw new Error('service coverage requires a kind');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    producer: record.producer || 'unknown',
    entityId: record.entityId || null,
    kind: String(record.kind),
    capacity: Math.max(0, finite(record.capacity)),
    served: Math.max(0, finite(record.served)),
    radius: Math.max(0, finite(record.radius)),
    coverage: Math.max(0, Math.min(1, finite(record.coverage))),
    rollbackToken: record.rollbackToken || null
  });
}

export function vehicleAssignment(record = {}) {
  if (!record.vehicleId) throw new Error('vehicle assignment requires a vehicleId');
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    producer: record.producer || 'unknown',
    vehicleId: String(record.vehicleId),
    role: record.role || null,
    routeId: record.routeId || null,
    stationId: record.stationId || null,
    ownerType: record.ownerType || null,
    rollbackToken: record.rollbackToken || null
  });
}

/** Renderer boundary: scene nodes stay owned by the renderer and are never
 * deep-frozen, while inspection/accounting metadata remains serializable. */
export function rendererContract(record = {}) {
  if (!record.buildingId) throw new Error('renderer contract requires a buildingId');
  return Object.freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    kitId: String(record.kitId || 'unknown'),
    buildingId: String(record.buildingId),
    scene: record.scene || null,
    inspection: serializable(record.inspection || {}),
    capacity: Math.max(0, finite(record.capacity)),
    staffing: Math.max(0, finite(record.staffing)),
    production: serializable(record.production || {}),
    dispose: typeof record.dispose === 'function' ? record.dispose : null
  });
}

export function kitStats(record = {}) {
  return freeze({
    contractVersion: KIT_CONTRACT_VERSION,
    kitId: String(record.kitId || 'unknown'),
    generatedAt: record.generatedAt ?? null,
    values: serializable(record.values || {})
  });
}
