/**
 * Evidence memory for the council.
 *
 * This is deliberately not a personality or a reward-shaped virtue list. It
 * stores only a bounded before/after measurement of choices the council has
 * actually enacted. The next sitting may use that evidence, but it cannot
 * change the action registry, parser, construction gates, or accounting rules.
 */

const LIMIT = 24;
const PENDING_LIMIT = 16;
const MIN_AGE_DAYS = 1;

const clamp = (n, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, Number(n) || 0));
const round = (n, digits = 2) => {
  const p = 10 ** digits;
  return Math.round((Number(n) || 0) * p) / p;
};

function economy(town) {
  try { return town?.economy?.stats?.() || {}; } catch { return {}; }
}

function growth(town) {
  try { return town?.growth?.stats?.() || {}; } catch { return {}; }
}

function mobility(town) {
  try { return town?.traffic?.mobilityStats?.() || {}; } catch { return {}; }
}

function utilities(town) {
  try { return town?.utilities?.stats?.() || {}; } catch { return {}; }
}

function utilityStrainCount(ut) {
  if (Array.isArray(ut?.strained)) return ut.strained.length;
  return Object.values(ut?.types || {}).filter((x) => x?.saturated || x?.deficit || (Number(x?.demand) || 0) > (Number(x?.capacity) || 0)).length;
}

function resources(town) {
  try { return town?.resources?.stats?.() || {}; } catch { return {}; }
}

function deficitCount(town) {
  const r = resources(town);
  const utility = r.types ? Object.values(r.types).filter((x) => x?.deficit || x?.saturated).length : 0;
  const strained = Array.isArray(r.strained) ? r.strained.length : 0;
  return utility + strained;
}

/** A small, serialisable view of outcomes visible to the council. */
export function measureCouncilState(town) {
  const eco = economy(town);
  const gr = growth(town);
  const mb = mobility(town);
  const ut = utilities(town);
  const citizens = town?.pedestrians?.citizens || [];
  const pop = citizens.length;
  const mood = town?.pedestrians?.averageMood
    ? Number(town.pedestrians.averageMood()) || 0
    : (citizens.length ? citizens.reduce((sum, c) => sum + (Number(c.mood) || 0), 0) / citizens.length : 0);
  const homes = (town?.buildings || []).filter((b) => b.kind === 'house');
  const capacity = homes.reduce((sum, b) => sum + (Number(b.capacity) || 0), 0);
  const publicBuildings = (town?.buildings || []).filter((b) => b.kind === 'civic' || b.purpose === 'commercial');
  const accessibleBuildings = publicBuildings.filter((b) =>
    b.constructionFlags?.accessible === true || b.accessible === true || b.house?.spec?.accessible === true
  ).length;
  const society = (() => {
    try { return town?.society?.stats?.() || {}; } catch { return {}; }
  })();
  return {
    treasury: Number(eco.treasury) || 0,
    reserve: Number(eco.reserve) || 0,
    population: pop,
    spareBeds: Math.max(0, capacity - pop),
    mood,
    approval: Number(society.approvalRate) || 0,
    accessibility: publicBuildings.length ? accessibleBuildings / publicBuildings.length : 0,
    designs: Number(gr.built?.archetype) || 0,
    unemployment: Number(eco.unemployment) || 0,
    congestion: Number(mb.congestion) || 0,
    utilityStrain: utilityStrainCount(ut),
    deficits: deficitCount(town),
    offNetwork: Number(gr.connectivity?.offNetwork) || 0,
    built: Number(gr.total) || Number(town?.buildings?.length) || 0,
    day: Number(town?.clockDay) || 0
  };
}

const DIRECTIONS = Object.freeze({
  treasury: 1,
  reserve: 1,
  population: 1,
  spareBeds: 1,
  mood: 1,
  approval: 1,
  accessibility: 1,
  designs: 1,
  unemployment: -1,
  congestion: -1,
  utilityStrain: -1,
  deficits: -1,
  offNetwork: -1,
  built: 1
});

function delta(before, after) {
  const out = {};
  for (const [key, direction] of Object.entries(DIRECTIONS)) {
    const a = Number(after?.[key]) || 0;
    const b = Number(before?.[key]) || 0;
    // Relative changes make $ and percentages comparable. The floor keeps a
    // move from zero meaningful without allowing one large treasury swing to
    // drown every other observation.
    const scale = key === 'treasury' || key === 'reserve'
      ? Math.max(1000, Math.abs(b))
      : key === 'mood' || key === 'unemployment' || key === 'congestion'
        ? 1
        : Math.max(1, Math.abs(b));
    out[key] = round(clamp(((a - b) / scale) * direction));
  }
  return out;
}

function score(changes) {
  const values = Object.values(changes);
  return round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
}

function describe(changes) {
  const labels = {
    treasury: 'treasury', reserve: 'reserve', population: 'population',
    spareBeds: 'beds', mood: 'mood', approval: 'approval', accessibility: 'accessibility', designs: 'designs', unemployment: 'jobs',
    congestion: 'traffic', utilityStrain: 'utilities', deficits: 'shortages',
    offNetwork: 'connectivity', built: 'buildings'
  };
  const rows = Object.entries(changes)
    .filter(([, value]) => Math.abs(value) >= 0.04)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([key, value]) => `${labels[key]} ${value >= 0 ? '+' : ''}${value.toFixed(2)}`);
  return rows.length ? rows.join(', ') : 'no material movement';
}

export class CouncilLearning {
  constructor(limit = LIMIT) {
    this.limit = limit;
    this.reset();
  }

  reset() {
    this.pending = [];
    this.lessons = [];
    this.byIntent = {};
    return this;
  }

  /** Queue a decision for observation after the town has had time to react. */
  track(decision, before, after) {
    if (!decision?.intent || decision.intent === 'NO_ACTION') return;
    const baseline = before || after;
    if (!baseline) return;
    this.pending.push({
      decisionId: decision.decisionId || null,
      intent: decision.intent,
      source: decision.source || 'unknown',
      status: decision.status || 'unknown',
      day: Number(decision.day) || Number(baseline.day) || 0,
      before: { ...baseline },
      immediate: { ...(after || baseline) }
    });
    if (this.pending.length > PENDING_LIMIT) this.pending.shift();
  }

  /** Close old observations and update empirical action estimates. */
  observe(town, day = town?.clockDay || 0, force = false) {
    if (!this.pending.length) return [];
    const now = measureCouncilState(town);
    const completed = [];
    const keep = [];
    for (const item of this.pending) {
      const age = Math.max(0, Number(day) - item.day);
      if (!force && age < MIN_AGE_DAYS) {
        keep.push(item);
        continue;
      }
      const changes = delta(item.before, now);
      const lesson = {
        decisionId: item.decisionId,
        intent: item.intent,
        source: item.source,
        status: item.status,
        ageDays: age,
        score: score(changes),
        changes,
        summary: describe(changes)
      };
      const row = this.byIntent[item.intent] ||= { count: 0, mean: 0, last: 0, changes: {} };
      row.count++;
      row.mean = round(row.mean + (lesson.score - row.mean) / row.count);
      row.last = lesson.score;
      for (const [key, value] of Object.entries(changes)) {
        const prev = Number(row.changes[key]) || 0;
        row.changes[key] = round(prev + (value - prev) / row.count);
      }
      this.lessons.push(lesson);
      if (this.lessons.length > this.limit) this.lessons.shift();
      completed.push(lesson);
    }
    this.pending = keep;
    return completed;
  }

  /** Compact evidence for the next prompt. Values are measurements, not rules. */
  promptLine() {
    const rows = Object.entries(this.byIntent)
      .filter(([, row]) => row.count > 0)
      .sort((a, b) => b[1].count - a[1].count || b[1].mean - a[1].mean)
      .slice(0, 4)
      .map(([intent, row]) => `${intent} n=${row.count} mean=${row.mean.toFixed(2)} last=${row.last.toFixed(2)}`);
    const recent = this.lessons.slice(-3).map((l) => `${l.intent}[${l.status}] → ${l.score >= 0 ? '+' : ''}${l.score.toFixed(2)} (${l.summary})`);
    if (!rows.length && !recent.length) return 'Learning record: no measured outcomes yet; treat every action as an experiment and establish a baseline.';
    return `Learning record (measured after decisions; descriptive, not a command): ${rows.join(' · ') || 'no repeated actions'}. Recent: ${recent.join(' · ') || 'none'}. Do not infer causation from one result; prefer repeated evidence and the current report.`;
  }

  snapshot() {
    return {
      pending: this.pending.length,
      lessons: this.lessons.slice(-this.limit).map((l) => ({ ...l, changes: { ...l.changes } })),
      byIntent: Object.fromEntries(Object.entries(this.byIntent).map(([k, v]) => [k, { ...v, changes: { ...v.changes } }]))
    };
  }
}

export const COUNCIL_LEARNING_LIMIT = LIMIT;
