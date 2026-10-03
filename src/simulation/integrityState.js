/** Versioned persistence for the integrity refactor's durable mechanic fields.
 * Apply to an already restored/generated town with matching stable entities. */
export const INTEGRITY_STATE_VERSION = 2;

const siteKey = (site) => site.id || `${site.kind}:${(site.cells || []).map((cell) => cell.join(',')).join(';')}`;
const plain = (value) => JSON.parse(JSON.stringify(value));

function kitSignature(report) {
  return (report?.kits || [])
    .map((kit) => `${kit.id}@${kit.version}:api${kit.apiVersion}:ctx${kit.contextApiVersion}`)
    .sort();
}

/** Stable identity for a vehicle across ordinary rebuilds (P-F08): spawn order
 * and uid are not stable, but type, unit, home pad and driver name are. */
function vehicleKey(v) {
  return `${v.type || ''}|${v.unit || ''}|${v.homeKey || ''}|${v.driver?.name || ''}`;
}

function exportTransport(town) {
  const t = town.traffic;
  if (!t || !Array.isArray(t.vehicles)) return null;
  return {
    tripStarts: t.tripStarts || 0,
    tripCompletions: t.tripCompletions || 0,
    tripCancellations: t.tripCancellations || 0,
    congestion: Number(t.congestion) || 0,
    fuelDispensed: Number(t.fuelDispensed) || 0,
    vehicles: t.vehicles.map((v) => ({
      key: vehicleKey(v),
      type: v.type,
      role: v.role,
      fuel: Math.max(0, Math.min(v.fuelCapacity || 45, Number(v.fuel) || 0)),
      fuelCapacity: v.fuelCapacity || 45,
      status: v.status,
      stranded: !!v.stranded,
      strandedReason: v.strandedReason || null,
      distanceDriven: Number(v.distanceDriven) || 0,
      parkKey: v.parkSpace ? (v.parkSpace.key || `${v.parkSpace.cell?.join(',')}`) : null,
      trip: v.trip ? {
        purpose: v.trip.purpose || null,
        destinationId: v.trip.destination?.id ?? null,
        cell: v.trip.destination?.cell ? [...v.trip.destination.cell] : null,
        state: v.trip.state || 'driving',
        reached: !!v.trip.reached,
        startedDay: v.trip.startedDay ?? null
      } : null
    }))
  };
}

function importTransport(town, saved) {
  const t = town.traffic;
  if (!t || !Array.isArray(t.vehicles)) return;
  const rows = new Map(((saved && saved.vehicles) || []).filter((row) => row && row.key).map((row) => [row.key, row]));
  for (const v of t.vehicles) {
    const row = rows.get(vehicleKey(v));
    if (!row) continue;
    if (Number.isFinite(row.fuel)) v.fuel = Math.max(0, Math.min(v.fuelCapacity || 45, row.fuel));
    if (Number.isFinite(row.distanceDriven)) v.distanceDriven = row.distanceDriven;
    v.stranded = !!row.stranded;
    v.strandedReason = row.stranded ? (row.strandedReason || 'restored') : null;
    // A restored trip keeps its purpose and destination when the building is
    // still there; otherwise it is cancelled rather than left to drive at a
    // ghost (DRV-04).
    if (v.trip && row.trip) {
      const dest = (row.trip.destinationId != null && town.buildings.find((b) => b.id === row.trip.destinationId))
        || (row.trip.cell && town.buildings.find((b) => b.cell && b.cell[0] === row.trip.cell[0] && b.cell[1] === row.trip.cell[1]))
        || null;
      if (dest) {
        v.trip.destination = dest;
        if (row.trip.state) v.trip.state = row.trip.state;
        v.trip.reached = !!row.trip.reached;
      } else if (typeof v.cancelTrip === 'function') {
        v.cancelTrip('restored-destination');
      } else {
        v.trip = null;
      }
    } else if (v.trip && typeof v.cancelTrip === 'function') {
      v.cancelTrip('restored-destination');
    }
    if (!v.parkSpace && row.parkKey && town.parking?.spaces) {
      const space = town.parking.spaces.find((s) => s.key === row.parkKey || `${s.cell?.join(',')}` === row.parkKey);
      if (space && !space.taken && typeof town.parking.bind === 'function') town.parking.bind(v, space);
    }
  }
  if (saved) {
    if (Number.isFinite(saved.tripStarts)) t.tripStarts = saved.tripStarts;
    if (Number.isFinite(saved.tripCompletions)) t.tripCompletions = saved.tripCompletions;
    if (Number.isFinite(saved.tripCancellations)) t.tripCancellations = saved.tripCancellations;
    if (Number.isFinite(saved.congestion)) t.congestion = saved.congestion;
    if (Number.isFinite(saved.fuelDispensed)) t.fuelDispensed = saved.fuelDispensed;
  }
}

/**
 * Export the town's long-run state.
 *
 * Returns a RESULT rather than throwing. It used to throw
 * `'Finish active construction before exporting integrity state'` whenever
 * `growth.projects` was non-empty — which is most of the time, since a project
 * is live for as long as it takes to build — and `importIntegrityState` threw
 * again on a version or seed mismatch. With no caller and no UI, the net effect
 * was an API that could not be run at all, which is the worst state to leave a
 * save system in: it looks available.
 *
 * A caller that cannot export now gets `{ ok: false, reason }` and can say so,
 * and the refusal is a normal answer rather than an exception.
 */
export function exportIntegrityState(town) {
  if (town.growth?.projects?.length) {
    return { ok: false, reason: 'construction_in_progress', projects: town.growth.projects.length };
  }
  return {
    version: INTEGRITY_STATE_VERSION,
    seed: town.seed ?? null,
    ownership: (town.buildings || []).map((building) => ({
      id: building.id, ownerType: building.ownerType, ownerId: building.ownerId,
      businessId: building.businessId || null
    })),
    utilityExpansionLevels: { ...town.utilities?.expansionLevels },
    resourceLevels: (town.resources?.sites || []).map((site) => ({ key: siteKey(site), level: site.level || 1 })),
    projects: [...(town.growth?.projectStates?.values() || [])].map((project) => plain(project)),
    districtQueue: town.growth?.districtQueue ? plain(town.growth.districtQueue) : null,
    lastDistrict: town.growth?.lastDistrict ? plain(town.growth.lastDistrict) : null,
    economy: town.economy ? {
      ids: { ...town.economy.ids },
      accounts: Object.fromEntries(Object.entries(town.economy.accounts).map(([key, account]) => [key, account.cash])),
      reserve: town.economy.reserve,
      capital: { ...town.economy.capital },
      businesses: [...town.economy.businessesById.values()].map((business) => ({
        id: business.id, equityInvestor: business.equityInvestor,
        retainedEarnings: business.retainedEarnings, lastDividend: business.lastDividend
      })),
      projectTransactions: town.economy.ledger.filter((tx) => tx.metadata?.projectId).map((tx) => plain(tx))
    } : null,
    // P-F08: driver/vehicle/trip/fuel survive the integrity overlay too.
    transport: exportTransport(town),
    kitCompatibility: town.kits?.compatibilityReport?.() || null,
    kitState: town.kits?.serialize?.(town) || null,
    ok: true
  };
}

/**
 * Apply a saved overlay. Returns `{ ok: false, reason }` for a state this build
 * cannot read, rather than throwing: a save from another seed or a newer version
 * is a normal thing for a caller to encounter and to report, not an exception it
 * has to wrap.
 */
export function importIntegrityState(town, saved = {}) {
  if (saved.version != null && saved.version > INTEGRITY_STATE_VERSION) {
    return { ok: false, reason: 'unsupported_version', version: saved.version, supported: INTEGRITY_STATE_VERSION };
  }
  if (saved.seed != null && town.seed != null && saved.seed !== town.seed) {
    return { ok: false, reason: 'seed_mismatch', saveSeed: saved.seed, townSeed: town.seed };
  }
  if (saved.kitCompatibility) {
    const current = town.kits?.compatibilityReport?.() || null;
    if (!current || JSON.stringify(kitSignature(saved.kitCompatibility)) !== JSON.stringify(kitSignature(current))) {
      return { ok: false, reason: 'kit_compatibility_mismatch', saved: kitSignature(saved.kitCompatibility), current: kitSignature(current) };
    }
  }
  const owners = new Map((saved.ownership || []).map((row) => [row.id, row]));
  for (const building of town.buildings || []) {
    const owner = owners.get(building.id);
    if (!owner) continue;
    building.ownerType = owner.ownerType || building.ownerType || (building.owner === 'state' ? 'government' : 'developer');
    building.ownerId = owner.ownerId || building.ownerId || (building.ownerType === 'government' ? 'government' : 'developer');
    building.owner = building.ownerType === 'government' ? 'state' : 'private';
    if (owner.businessId) building.businessId = owner.businessId;
  }
  const utilityLevels = saved.utilityExpansionLevels || {};
  if (town.utilities) {
    for (const kind of ['power', 'water', 'sewage'])
      town.utilities.expansionLevels[kind] = Math.max(0, Number(utilityLevels[kind] ?? town.utilities.expansionLevels[kind] ?? 0) || 0);
  }
  const levels = new Map((saved.resourceLevels || []).map((row) => [row.key, row.level]));
  for (const site of town.resources?.sites || []) site.level = Math.max(1, Number(levels.get(siteKey(site)) ?? site.level ?? 1) || 1);
  if (town.growth) {
    town.growth.projectStates = new Map((saved.projects || []).map((project) => [project.projectId, plain(project)]));
    town.growth.districtQueue = saved.districtQueue ? plain(saved.districtQueue) : null;
    town.growth.lastDistrict = saved.lastDistrict ? plain(saved.lastDistrict) : null;
  }
  if (saved.economy && town.economy) {
    const economy = town.economy;
    economy.ids = { ...economy.ids, ...(saved.economy.ids || {}) };
    for (const [key, cash] of Object.entries(saved.economy.accounts || {}))
      if (economy.accounts[key] && Number.isFinite(cash)) economy.accounts[key].cash = cash;
    economy.reserve = Number(saved.economy.reserve ?? economy.reserve) || 0;
    economy.capital = { ...economy.capital, ...(saved.economy.capital || {}) };
    for (const row of saved.economy.businesses || []) {
      const business = economy.businessesById.get(row.id);
      if (!business) continue;
      business.equityInvestor = row.equityInvestor ?? business.equityInvestor;
      business.retainedEarnings = Number(row.retainedEarnings ?? business.retainedEarnings) || 0;
      business.lastDividend = Number(row.lastDividend ?? business.lastDividend) || 0;
    }
    // Defensive on the shape: this reads a persisted blob, so a hand-edited or
    // truncated save must not be able to throw its way out of the loader.
    const projectTxs = Array.isArray(saved.economy.projectTransactions) ? saved.economy.projectTransactions : [];
    economy.ledger = economy.ledger.filter((tx) => !tx.metadata?.projectId)
      .concat(projectTxs.map((tx) => plain(tx)));
    economy.transactions = economy.ledger;
    economy._resetExpectedMoney();
  }
  town.rebuildStatic?.();
  importTransport(town, saved.transport);
  if (saved.kitState && town.kits?.restore) {
    const restored = town.kits.restore(town, saved.kitState);
    if (!restored.ok) return { ok: false, reason: 'kit_restore_failed', detail: restored };
  }
  return { ok: true, town };
}
