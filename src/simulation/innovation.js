import { events } from '../core/events.js';
import { CELL_KIND } from '../core/config.js';
import { ORDER } from '../kits/resources/resourceKit.js';
import { civicLoads, worstCivicLoad, edgeCell, EDGE_RING } from './growth.js';
import researchRules from '../data/researchRules.json' with { type: 'json' };

/**
 * Innovation (Phase 17 — A4).
 *
 * Three funding buckets, a daily accrual, and a ladder whose every rung is
 * DERIVED from the town's own weakest number. There is no authored story text
 * in this file: `bottlenecks()` scores six live metrics, `nextInnovation()`
 * picks the lowest, and the milestone it applies is composed from that score.
 * Change the town's weakest metric and the next rung changes with it.
 *
 * Milestones apply through ONE registry — `LEVERS` — the same shape the Phase
 * 15 policy interpreter uses: each lever names a live field and the consuming
 * system reads it where it already reads that parameter. A milestone is
 * `{ label, lever, amount }` and nothing more; adding a lever is a row here
 * and a read at one call site.
 */

/* ------------------------------------------------------------------ buckets */

/** The three buckets, and how much research each dollar buys. */
export const BUCKETS = Object.freeze({
  academia: { ...researchRules.buckets.academia, source: (town) => pupilsIn(town) },
  companies: { ...researchRules.buckets.companies, source: (town) => worksIn(town) },
  exploration: { ...researchRules.buckets.exploration, source: (town) => frontierIn(town) }
});

export const BUCKET_IDS = Object.keys(BUCKETS);

const students = (town) => {
  let n = 0;
  for (const c of town.pedestrians.citizens) {
    const a = c.p.age;
    if (a >= 3 && a <= 17) n++;
  }
  return n;
};
const pupilsIn = (town) => {
  let n = 0;
  for (const b of town.buildings) {
    if (b.kind === 'civic' && b.capacityKind === 'pupils' && b.capacity) n += b.capacity;
  }
  return n;
};
// Read straight off the town rather than through another system's method, so
// a bucket's capacity is a fact about the town, not a call that can be stubbed.
const worksIn = (town) =>
  town.buildings.filter((b) => b.purpose === 'industrial').length;
const frontierIn = (town) => (town.research ? town.research.frontier().length : 0);

/* ------------------------------------------------------------------- levers */

/**
 * The milestone registry. `get`/`set` are the same contract as the Phase 15
 * policy modifiers, so a research gain and a statute are the same shape of
 * thing landing on the same live parameter.
 */
const LEVER_DATA = researchRules.levers;
export const LEVERS = {
  yield: {
    ...LEVER_DATA.yield,
    get: (t) => t.resources?.yieldBonus || 0,
    set: (t, v) => {
      if (t.resources) t.resources.yieldBonus = v;
    }
  },
  output: {
    ...LEVER_DATA.output,
    get: (t) => t.industry?.outputBonus || 0,
    set: (t, v) => {
      if (t.industry) t.industry.outputBonus = v;
    }
  },
  crew: {
    ...LEVER_DATA.crew,
    get: (t) => t.economy?.staffBonus || 0,
    set: (t, v) => {
      if (t.economy) t.economy.staffBonus = v;
    }
  },
  service: {
    ...LEVER_DATA.service,
    get: (t) => t.growth?.serviceBonus || 0,
    set: (t, v) => {
      if (t.growth) t.growth.serviceBonus = v;
    }
  },
  survey: {
    ...LEVER_DATA.survey,
    get: (t) => t.research?.surveyBonus || 0,
    set: (t, v) => {
      if (t.research) t.research.surveyBonus = v;
    }
  }
};

export const LEVER_IDS = Object.keys(LEVERS);

/* -------------------------------------------------------------- bottlenecks */

/**
 * The six things research can be spent on. Each returns a 0..1 score where 1
 * is "nothing left to fix" and 0 is "badly broken", plus the numbers it was
 * read from so the ladder rung can quote them. Nothing here is a story: each
 * row is a query against a subsystem that already exists.
 */
export const BOTTLENECKS = {
  supply: {
    label: 'primary supply',
    hint: 'the resource the town is furthest behind on',
    measure(town) {
      const rs = town.resources && town.resources.stats ? town.resources.stats() : null;
      if (!rs) return { score: 1, detail: 'no resource system' };
      let worst = null;
      for (const k of ORDER) {
        const t = rs.types[k];
        if (!t) continue;
        const ratio = t.demand > 0 ? Math.min(1.5, t.production / t.demand) : 1.5;
        if (!worst || ratio < worst.ratio) worst = { k, ratio, t };
      }
      if (!worst) return { score: 1, detail: 'no resources' };
      // score 0 at half of demand, 1 at demand.
      return {
        score: Math.max(0, Math.min(1, (worst.ratio - 0.5) / 0.5)),
        detail: `${worst.k} ${worst.t.production}/${worst.t.demand}`,
        key: worst.k
      };
    }
  },
  throughput: {
    label: 'works throughput',
    hint: 'goods output against the town’s appetite for them',
    measure(town) {
      const ind = town.industry;
      if (!ind || !ind.stats) return { score: 1, detail: 'no works' };
      const st = ind.stats();
      const n = st.factories || 0;
      if (!n) return { score: 0, detail: 'no works at all' };
      const goods = st.goods || {};
      const factor = Math.max(0, Math.min(1, (goods.factor || 0) / 1.5));
      return {
        score: factor,
        detail: `${n} works · goods factor ×${(goods.factor || 0).toFixed?.(2) ?? goods.factor}`
      };
    }
  },
  crew: {
    label: 'staff efficiency',
    hint: 'how fully the businesses are crewed',
    measure(town) {
      const eco = town.economy;
      if (!eco || !eco.businesses || !eco.businesses.length) return { score: 1, detail: 'no businesses' };
      let have = 0;
      let need = 0;
      for (const z of eco.businesses) {
        need += z.staffNeed ?? (eco.staffNeeded ? eco.staffNeeded(z.building) : 1);
        have += Math.min(z.staffNeed ?? need, z.employees || 0);
      }
      const ratio = need > 0 ? have / need : 1;
      return { score: Math.max(0, Math.min(1, ratio)), detail: `${Math.round(have)}/${Math.round(need)} posts filled` };
    }
  },
  civic: {
    label: 'civic service',
    hint: 'the worst-loaded facility',
    measure(town) {
      const load = worstCivicLoad(town);
      if (!load) return { score: 1, detail: 'no facilities' };
      const worst = civicLoads(town).reduce((a, l) => (l.load > (a ? a.load : 0) ? l : a), null);
      return {
        score: Math.max(0, Math.min(1, 1 - (load - 1) / 0.75)),
        detail: worst ? `${worst.kind} at ${Math.round(worst.load * 100)}% load` : `worst ${Math.round(load * 100)}%`
      };
    }
  },
  frontier: {
    label: 'the frontier',
    hint: 'how much of the map edge is still unmapped',
    measure(town) {
      const f = town.research ? town.research.frontier() : [];
      if (!f.length) return { score: 1, detail: 'the map is fully surveyed' };
      const surveyed = town.research.surveyed.size;
      return {
        score: Math.max(0, Math.min(1, surveyed / f.length)),
        detail: `${surveyed}/${f.length} edge cells mapped`
      };
    }
  },
  housing: {
    label: 'housing',
    hint: 'spare beds per head',
    measure(town) {
      const pop = town.pedestrians.citizens.length || 1;
      let beds = 0;
      for (const b of town.buildings) if (b.kind === 'house') beds += b.capacity || 2;
      const spare = Math.max(0, beds - town.pedestrians.citizens.length) / pop;
      return { score: Math.max(0, Math.min(1, spare / 0.5)), detail: `${Math.round(spare * 100)}% spare beds per head` };
    }
  }
};

export const BOTTLENECK_IDS = Object.keys(BOTTLENECKS);

/** Points needed for one rung. Flat: the ladder's difficulty is not the story. */
export const POINTS_PER_RUNG = 100;

/**
 * `ANNEX_SURVEY_DISCOUNT` lives in growth.js — it is a price, and growth is the
 * module this file already imports. Re-exported so callers have one import site
 * for the research vocabulary.
 */
export { ANNEX_SURVEY_DISCOUNT } from './growth.js';

export class ResearchSystem {
  constructor() {
    this.townRef = null;
    this.points = 0;
    this.funding = { academia: 0, companies: 0, exploration: 0 };
    this.surveyed = new Set();
    this.milestones = []; // { rung, key, label, lever, amount, day }
    this.bonuses = Object.fromEntries(LEVER_IDS.map((k) => [k, 0]));
    this.surveyBonus = 0;
    this.rateBonus = 0; // written by PolicySystem (`researchRate`)
    this.lastDay = null;
    this.lastSurveyed = 0;
    this.totalSpend = 0;
  }

  reset() {
    this.points = 0;
    this.funding = { academia: 0, companies: 0, exploration: 0 };
    this.surveyed = new Set();
    this.milestones = [];
    this.bonuses = Object.fromEntries(LEVER_IDS.map((k) => [k, 0]));
    this.surveyBonus = 0;
    this.rateBonus = 0;
    this.lastDay = null;
    this.lastSurveyed = 0;
    this.totalSpend = 0;
    return this;
  }

  /* ------------------------------------------------------------ the frontier */

  /**
   * The unmapped frontier: buildable land in the outer ring of the map that no
   * site or parcel owner has claimed. Procedural from the grid — there is no
   * authored map and no frontier table.
   *
   * "Outer ring" is `edgeCell()`'s own test, NOT a bounding box around the
   * roads: the network already reaches most of the map (site spurs and
   * secondary streets), so a road-box definition left 125 cells in the middle
   * and none of the land `ANNEX_EDGE` can actually take. Sharing the one test
   * is what makes the exploration bucket's discount reach the annex brush.
   */
  frontier() {
    const t = this.townRef;
    if (!t) return [];
    const g = t.grid;
    const out = [];
    // Only the outer EDGE_RING can qualify — that is what `edgeCell` tests —
    // so walk the ring instead of the whole grid. This is called from `stats()`,
    // which the render loop invokes every frame, and a full-grid scan here was
    // three quarters of the entire per-frame HUD cost. Same predicate, same
    // result, a compact local search: on a 100x100 extent the ring stays near
    // the active neighbourhood rather than scanning the full plate.
    // out of 1920.
    const ring = Math.max(1, EDGE_RING);
    const test = (x, y) => {
      if (!g.inBounds(x, y)) return;
      const k = g.kindAt(x, y);
      if (k !== CELL_KIND.EMPTY && k !== CELL_KIND.LOT) return;
      if (t.resources && t.resources.ownsCell(x, y)) return;
      if (this.surveyed.has(`${x},${y}`)) return;
      if (!edgeCell(g, x, y)) return;
      out.push([x, y]);
    };
    // d = 0 is the outermost ring, d = 1 the next one in — and EDGE_RING is 2,
    // so d runs 0..ring-1 and covers exactly the cells `edgeCell` accepts. Each
    // ring is drawn as the border of the rect [d, w-1-d] x [d, h-1-d]: the two
    // rows, then the two columns with the corners left off, so no cell is
    // pushed twice.
    for (let d = 0; d < ring; d++) {
      if (g.w - 1 - d <= d || g.h - 1 - d <= d) break;
      for (let i = d; i < g.w - d; i++) {
        test(i, d);
        test(i, g.h - 1 - d);
      }
      for (let j = d + 1; j < g.h - d - 1; j++) {
        test(d, j);
        test(g.w - 1 - d, j);
      }
    }
    return out;
  }

  /** Is this cell mapped? A surveyed cell annexes more cheaply (Phase 8). */
  isSurveyed(x, y) {
    return this.surveyed.has(`${x},${y}`);
  }

  /** The discount a surveyed frontier cell earns on an annex. */
  surveyBonusAt(x, y) {
    return this.isSurveyed(x, y) ? 1 + this.surveyBonus : 0;
  }

  /**
   * Survey the frontier with today's exploration money. Returns how many cells
   * were mapped; the bonus lever widens how far the day's money reaches.
   */
  survey() {
    const spend = this.funding.exploration || 0;
    if (spend <= 0) return 0;
    const f = this.frontier();
    if (!f.length) return 0;
    const reach = Math.max(1, Math.round((spend / BUCKETS.exploration.perCell) * (1 + this.surveyBonus)));
    let n = 0;
    for (const [x, y] of f) {
      if (n >= reach) break;
      this.surveyed.add(`${x},${y}`);
      n++;
    }
    this.lastSurveyed = n;
    return n;
  }

  /* ----------------------------------------------------------------- funding */

  /** How much a bucket can absorb today, from the subsystem that backs it. */
  bucketCeiling(id) {
    const t = this.townRef;
    if (!t) return 0;
    const row = BUCKETS[id];
    if (!row) return 0;
    if (id === 'academia') return Math.round(pupilsIn(t) * row.perPupil);
    if (id === 'companies') return Math.round(worksIn(t) * row.perUnit);
    return Math.round(frontierIn(t) * row.perCell);
  }

  /** The ceiling's own basis, for the refusal wording. */
  bucketBasis(id) {
    const t = this.townRef;
    if (!t) return '';
    if (id === 'academia') return `${pupilsIn(t)} pupil places`;
    if (id === 'companies') return `${worksIn(t)} works`;
    return `${frontierIn(t)} unmapped edge cells`;
  }

  /** Set one bucket's daily funding, capped by its ceiling. */
  fund(id, amount) {
    const row = BUCKETS[id];
    if (!row) return { ok: false, reason: `no research bucket called "${id}"` };
    const ceiling = this.bucketCeiling(id);
    const next = Math.max(0, Math.min(ceiling, Math.round(Number(amount) || 0)));
    this.funding[id] = next;
    return { ok: true, amount: next, ceiling };
  }

  /** Headroom on each bucket — used by the report and the bare intent. */
  headroom() {
    const out = {};
    for (const id of BUCKET_IDS) {
      const ceiling = this.bucketCeiling(id);
      out[id] = { label: BUCKETS[id].label, funding: this.funding[id] || 0, ceiling, basis: this.bucketBasis(id) };
    }
    return out;
  }

  /* ------------------------------------------------------------------ ladder */

  /** Every bottleneck, scored 0..1, worst first. */
  bottlenecks() {
    const t = this.townRef;
    const rows = BOTTLENECK_IDS.map((id) => {
      const m = BOTTLENECKS[id].measure(t);
      return {
        id,
        label: BOTTLENECKS[id].label,
        hint: BOTTLENECKS[id].hint,
        score: Math.max(0, Math.min(1, Number(m.score) || 0)),
        detail: m.detail || '',
        key: m.key || null
      };
    });
    rows.sort((a, b) => a.score - b.score);
    return rows;
  }

  /**
   * The next rung, DERIVED from the town's worst score. Its amount scales with
   * how bad that score is, and its label quotes the numbers it was read from —
   * so the same code produces a different rung for a different town, and a
   * different rung again once the first one has been bought.
   */
  nextInnovation() {
    const worst = this.bottlenecks()[0];
    if (!worst) return null;
    const severity = 1 - worst.score;
    // Which lever answers this bottleneck is a ROW, not a branch: a bottleneck
    // that is not listed here simply has no rung (nothing to buy).
    const lever = LEVER_FOR[worst.id];
    if (!lever) return { ...worst, lever: null, amount: 0, label: `${worst.label} has no research programme yet` };
    const amount = Math.round((0.06 + 0.16 * severity) * 100) / 100;
    return {
      ...worst,
      lever,
      amount,
      points: POINTS_PER_RUNG - (this.points % POINTS_PER_RUNG),
      label: `${worst.label}: ${LEVERS[lever].label} +${Math.round(amount * 100)}% — ${worst.detail}`
    };
  }

  /** Buy the pending rung if the town can pay for it. */
  applyMilestone(day = 0) {
    const next = this.nextInnovation();
    if (!next || !next.lever) return null;
    if (this.points < POINTS_PER_RUNG) return null;
    this.points -= POINTS_PER_RUNG;
    this.milestones.push({
      rung: this.milestones.length + 1,
      key: next.id,
      label: next.label,
      lever: next.lever,
      amount: next.amount,
      day
    });
    // Bonuses add: successive gains on the same lever compound.
    this.bonuses[next.lever] = Math.round((this.bonuses[next.lever] + next.amount) * 100) / 100;
    LEVERS[next.lever].set(this.townRef, this.bonuses[next.lever]);
    events.emit('log', { kind: 'event',
      text: `Research paid off — ${next.label}` });
    return this.milestones[this.milestones.length - 1];
  }

  /* -------------------------------------------------------------------- tick */

  /** Daily: charge the buckets, accrue points, survey, buy a rung if due. */
  daily() {
    const t = this.townRef;
    if (!t) return null;
    let spend = 0;
    let earned = 0;
    for (const id of BUCKET_IDS) {
      const f = this.funding[id] || 0;
      if (f <= 0) continue;
      spend += f;
      earned += f * BUCKETS[id].rate;
    }
    if (spend && t.economy) t.economy.transfer({
      from: 'government', to: 'contractor', amount: spend,
      category: 'government_procurement', metadata: { purpose: 'research' }
    });
    this.totalSpend += spend;
    // Phase 15's `researchRate` law/scheme scales the whole programme.
    const rate = 1 + (this.rateBonus || 0);
    this.points = Math.max(0, this.points + earned * rate);
    const mapped = this.survey();
    const bought = this.applyMilestone(this.day || 0);
    return { spend, earned: Math.round(earned * rate * 10) / 10, mapped, bought };
  }

  setDay(day) {
    this.day = day;
  }

  /* ------------------------------------------------------------------ report */

  stats() {
    const next = this.nextInnovation();
    const rows = this.bottlenecks();
    const funding = BUCKET_IDS.reduce((n, id) => n + (this.funding[id] || 0), 0);
    return {
      points: Math.round(this.points),
      completed: this.milestones.length,
      funding,
      perDay: BUCKET_IDS.map((id) => `${BUCKETS[id].label} ${this.funding[id] || 0}/${this.bucketCeiling(id)}`),
      next: next ? { label: next.label, lever: next.lever, points: next.points, score: next.score } : null,
      worst: rows[0] ? { label: rows[0].label, score: rows[0].score, detail: rows[0].detail } : null,
      ranked: rows.map((r) => ({ id: r.id, label: r.label, score: r.score, detail: r.detail })),
      bonuses: { ...this.bonuses },
      frontier: this.frontier().length,
      surveyed: this.surveyed.size,
      milestones: this.milestones.slice(-4).map((m) => m.label),
      totalSpend: Math.round(this.totalSpend)
    };
  }
}

/**
 * Which lever answers which bottleneck. A row, not a branch — and a bottleneck
 * missing from this table simply has no programme, which the ladder says out
 * loud rather than silently skipping.
 */
const LEVER_FOR = {
  supply: 'yield',
  throughput: 'output',
  crew: 'crew',
  civic: 'service',
  frontier: 'survey',
  housing: 'service'
};
