import rules from '../data/kpiRules.json';

const DECISION_LIMIT = Math.max(64, Number(rules.retention?.decisionRecords) || 512);
const SNAPSHOT_LIMIT = Math.max(30, Number(rules.retention?.snapshots) || 365);
const SUCCESS = new Set(['done', 'started', 'advisory', 'noop']);
const FAILURE = new Set(['blocked', 'rejected', 'error', 'unparsed', 'failed_rolled_back', 'failed']);
const PRIORITY_INTENTS = new Set([
  'ACQUIRE_LAND', 'UPGRADE_RESOURCE', 'EXPAND_POWER', 'EXPAND_WATER', 'EXPAND_SEWAGE',
  'EXTEND_STREET', 'UPGRADE_ROAD', 'BUILD_FACTORY', 'DEVELOP_HOUSING', 'BUILD_HOUSING',
  'HIRE_WORKERS', 'TRADE_BUY', 'BUILD_TRANSIT', 'BUILD_CIVIC'
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const round = (value, places = 3) => {
  const p = 10 ** places;
  return Math.round(finite(value) * p) / p;
};

function safeCall(fn, fallback = null) {
  try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; }
}

function foodReserve(town) {
  const row = safeCall(() => town.resources?.stats?.()?.types?.food, null);
  return row ? clamp01((finite(row.level) / Math.max(1, finite(row.capacity))) || 0) : null;
}

/**
 * Evaluator-facing measurements deliberately read stable system fields rather
 * than Town.stats(), so adding a KPI snapshot cannot recurse through the HUD
 * snapshot cache or repeat every expensive diagnostic leaf.
 */
function measureTown(town) {
  const economy = town?.economy;
  const citizens = town?.pedestrians?.citizens || [];
  const eco = safeCall(() => economy?.stats?.(), null);
  const mobility = safeCall(() => town.traffic?.mobilityStats?.(), null);
  const society = safeCall(() => town.society?.stats?.(), null);
  const beds = safeCall(() => town.lifecycle?.stats?.(), null);
  const housingCapacity = (town?.buildings || [])
    .filter((building) => building.kind === 'house')
    .reduce((sum, building) => sum + finite(building.capacity ?? building.house?.capacity, 0), 0);
  const population = citizens.length;
  const treasury = finite(eco?.treasury ?? economy?.treasury);
  const reserveTarget = Math.max(1, finite(eco?.operatingReserve ?? eco?.reserveTarget, 1));
  return {
    day: finite(economy?.lastDay, 0),
    population,
    buildings: town?.buildings?.length || 0,
    treasury: round(treasury, 2),
    treasurySafety: round(clamp01(treasury / reserveTarget), 3),
    unemployment: round(finite(eco?.unemployment) / 100, 3),
    approval: round(finite(society?.approvalRate ?? town.society?.approvalRate, 0.5), 3),
    mood: round(finite(society?.mood ?? safeCall(() => town.pedestrians?.averageMood?.(), 0.5), 0.5), 3),
    congestion: round(finite(mobility?.congestion ?? town.traffic?.congestion), 3),
    foodReserve: foodReserve(town),
    beds: housingCapacity || finite(beds?.beds ?? beds?.capacity, 0),
    bedPressure: round(population / Math.max(1, housingCapacity || finite(beds?.beds ?? beds?.capacity, population || 1)), 3),
    reserveTarget: round(reserveTarget, 2)
  };
}

function isPriority(decision, before, town) {
  if (decision?.priority === true || finite(decision?.priority) >= 0.7) return true;
  if (decision?.requiredAction) return true;
  if (!PRIORITY_INTENTS.has(String(decision?.intent || '').toUpperCase())) return false;
  const emergency = safeCall(() => town.growth?.resourceEmergency?.(), null);
  if (emergency?.intent === decision.intent) return true;
  const unemployment = finite(before?.unemployment);
  const congestion = finite(before?.congestion);
  const food = before?.foodReserve;
  return unemployment >= 0.2 || congestion >= 0.5 || (food != null && food < 0.25);
}

export class KpiSystem {
  constructor(town) {
    this.town = town;
    this.reset(town?.seed || 1);
  }

  reset(seed = this.town?.seed || 1) {
    this.seed = seed;
    this.day = -1;
    this.decisions = [];
    this.snapshots = [];
    this.counters = {
      attempted: 0, accepted: 0, completed: 0, blocked: 0, rejected: 0, failed: 0,
      priorityActions: 0, priorityRemedies: 0, repeatBlocked: 0, totalSpend: 0,
      minTreasury: null
    };
    this._lastByIntent = new Map();
    this._lastSnapshot = null;
  }

  recordDecision(decision = {}, before = null, after = null) {
    const status = String(decision.status || 'unknown').toLowerCase();
    const intent = String(decision.intent || 'UNKNOWN').toUpperCase();
    const priority = isPriority(decision, before, this.town);
    const previous = this._lastByIntent.get(intent);
    if (previous && (previous.status === 'blocked' || previous.status === 'rejected')) this.counters.repeatBlocked++;
    this._lastByIntent.set(intent, { status, day: finite(decision.day, this.day) });
    this.counters.attempted++;
    if (SUCCESS.has(status)) this.counters.accepted++;
    if (status === 'done') this.counters.completed++;
    if (status === 'blocked') this.counters.blocked++;
    if (status === 'rejected' || status === 'unparsed') this.counters.rejected++;
    if (FAILURE.has(status) && status !== 'blocked' && status !== 'rejected' && status !== 'unparsed') this.counters.failed++;
    if (priority) {
      this.counters.priorityActions++;
      if (SUCCESS.has(status)) this.counters.priorityRemedies++;
    }
    this.counters.totalSpend += Math.max(0, finite(decision.actualSpend ?? decision.cost));
    const treasury = finite(after?.treasury ?? safeCall(() => this.town.economy?.treasury, 0));
    this.counters.minTreasury = this.counters.minTreasury == null
      ? treasury : Math.min(this.counters.minTreasury, treasury);
    this.decisions.push({
      id: decision.decisionId || null,
      day: finite(decision.day, this.day),
      intent,
      status,
      source: decision.source || 'system',
      origin: decision.origin || null,
      priority,
      spend: round(decision.actualSpend ?? decision.cost, 2),
      detail: String(decision.detail || decision.reason || '').slice(0, 240),
      before: before ? { unemployment: round(before.unemployment), congestion: round(before.congestion), foodReserve: before.foodReserve } : null,
      after: after ? { unemployment: round(after.unemployment), congestion: round(after.congestion), foodReserve: after.foodReserve } : null
    });
    if (this.decisions.length > DECISION_LIMIT) this.decisions.splice(0, this.decisions.length - DECISION_LIMIT);
  }

  updateDay(clock = null) {
    const day = finite(clock?.day, finite(this.town?.economy?.lastDay, 0));
    if (day === this.day) return this._lastSnapshot;
    this.day = day;
    const current = measureTown(this.town);
    const previous = this._lastSnapshot;
    const congestionRelief = previous ? clamp01((previous.congestion - current.congestion) / Math.max(0.05, previous.congestion)) : 0;
    const snapshot = {
      ...current,
      day,
      deltaPopulation: previous ? current.population - previous.population : 0,
      deltaApproval: previous ? round(current.approval - previous.approval) : 0,
      congestionRelief: round(congestionRelief),
      priorityIntents: safeCall(() => (this.town.growth?.ranked?.() || []).slice(0, 5).map((row) => row.type || row.intent).filter(Boolean), [])
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > SNAPSHOT_LIMIT) this.snapshots.splice(0, this.snapshots.length - SNAPSHOT_LIMIT);
    this._lastSnapshot = snapshot;
    if (this.counters.minTreasury == null || current.treasury < this.counters.minTreasury) this.counters.minTreasury = current.treasury;
    return snapshot;
  }

  scores() {
    const c = this.counters;
    return {
      constraintCompliance: c.attempted ? round(c.accepted / c.attempted) : null,
      actionThroughput: c.accepted ? round(c.completed / c.accepted) : null,
      priorityResponseRate: c.priorityActions ? round(c.priorityRemedies / c.priorityActions) : null,
      blockedRepeatRate: c.blocked ? round(c.repeatBlocked / c.blocked) : 0,
      treasurySafety: this._lastSnapshot ? this._lastSnapshot.treasurySafety : null,
      congestionRelief: this._lastSnapshot ? this._lastSnapshot.congestionRelief : null
    };
  }

  stats() {
    const current = this._lastSnapshot || measureTown(this.town);
    return {
      schemaVersion: 1,
      run: {
        seed: this.seed,
        day: this.day,
        provider: this.town?.governance?.provider?.id || this.town?.governance?.provider?.name || 'rules',
        model: this.town?.governance?.provider?.model || null
      },
      counters: { ...this.counters },
      scores: this.scores(),
      targets: rules.targets,
      current,
      decisions: this.decisions.slice(-30),
      snapshots: this.snapshots.slice(-30)
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      seed: this.seed,
      day: this.day,
      counters: { ...this.counters },
      decisions: this.decisions.slice(-DECISION_LIMIT),
      snapshots: this.snapshots.slice(-SNAPSHOT_LIMIT)
    };
  }

  restore(saved = null) {
    if (!saved || typeof saved !== 'object') return;
    this.reset(saved.seed ?? this.town?.seed ?? 1);
    this.day = finite(saved.day, -1);
    this.counters = { ...this.counters, ...(saved.counters || {}) };
    this.decisions = Array.isArray(saved.decisions) ? saved.decisions.slice(-DECISION_LIMIT) : [];
    this.snapshots = Array.isArray(saved.snapshots) ? saved.snapshots.slice(-SNAPSHOT_LIMIT) : [];
    this._lastSnapshot = this.snapshots.at(-1) || null;
    this._lastByIntent = new Map(this.decisions.map((row) => [row.intent, row]));
  }

  export() { return { ...this.stats(), decisions: this.decisions, snapshots: this.snapshots }; }
}

export { measureTown };
