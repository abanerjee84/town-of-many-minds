/**
 * Council persona (Phase 19 — A0).
 *
 * The rule this file exists to keep: the council's voice is a FUNCTION of what
 * it has done, and nothing else. There is no trait list, no adjective table
 * and no archetype to pick. `DecisionLedger` counts; `persona()` composes
 * sentences from those counts, so:
 *
 *   • a consistent history always produces the same voice, and
 *   • a different history produces a different one,
 *
 * with no way to author a personality directly. The probe asserts the first by
 * feeding a ledger twice, and the second by feeding three scripted councils.
 *
 * Every sentence below is a template with numbers in it. `PERSONA_LINES` is a
 * table of CLOSURES — the phrases a sentence can end with — keyed by which
 * measured fact they report, so adding a fact means adding a row, never
 * rewriting the prose.
 */

import { INTENT_FAMILY } from './actionRegistry.js';

/**
 * Intents that work on a building which already stands. They bucket as `build`
 * in the registry (they are construction) but the ledger has always counted them
 * separately as `improve`, and the council's voice distinguishes "commissions new
 * work" from "improves what is there".
 */
const IMPROVE_INTENTS = new Set(['UPGRADE_BUILDING', 'RENOVATE', 'WING', 'IMAGINE_ARCHETYPE']);

/**
 * The decision families the ledger counts.
 *
 * GROUPED FROM `INTENT_FAMILY` IN THE ACTION REGISTRY, not hand-authored. This
 * table used to be a literal with a comment claiming it was "derived from
 * INTENTS, not authored", and it had drifted: `BUILD_OFFICE` was in no family at
 * all, so an office commission bucketed to `other`, was excluded by no filter, and
 * the council's own voice described itself as "commissions work on 100% of its
 * motions" while reporting the office under `other`.
 *
 * It is now built from the registry's derived map, so an intent cannot be added
 * without being placed. The buckets are the registry's; only the grouping into
 * the ledger's vocabulary is local.
 */
export const FAMILIES = Object.freeze(
  Object.entries(INTENT_FAMILY).reduce((acc, [intent, family]) => {
    // `improve` is the ledger's name for work on a building that already stands.
    const bucket = family === 'build' && IMPROVE_INTENTS.has(intent) ? 'improve' : family;
    (acc[bucket] ||= []).push(intent);
    return acc;
  }, {})
);

/** Statuses that count as the council having ACTED on something. */
const ACTED = new Set(['done', 'started', 'queued']);
/** Statuses that count as a refusal to spend. */
const REFUSED = new Set(['blocked', 'rejected']);
/** Statuses that are a deliberate hold. */
const HELD = new Set(['noop']);

/**
 * Why a motion was refused, read from the decision's own detail text. A small
 * closed vocabulary so the ledger can COUNT the reasons — the persona reports a
 * number, never quotes a sentence it invented.
 */
const REFUSAL_REASONS = [
  ['budget', /treasury|over budget|funds|below \d|reserve/i],
  ['no site', /no free plot|no room|plot|site|lot/i],
  ['already', /already|nothing to|no programme|no law|full height|no corridor|no gap/i],
  ['spec', /spec rejected|unknown|needs /i],
  ['not needed', /does not need/i]
];
export const REASONS = REFUSAL_REASONS.map(([id]) => id);

function reasonOf(decision) {
  if (!REFUSED.has(decision.status)) return null;
  const text = String(decision.detail || '');
  for (const [id, re] of REFUSAL_REASONS) if (re.test(text)) return id;
  return 'other';
}

const familyOf = (intent) => {
  for (const [name, ids] of Object.entries(FAMILIES)) {
    if (ids.includes(intent)) return name;
  }
  return intent === 'NO_ACTION' ? 'hold' : 'other';
};

/**
 * A rolling count of what the council has done. Bounded, because a persona
 * derived from an unbounded log would stop being about the recent past.
 */
export class DecisionLedger {
  constructor(limit = 40) {
    this.limit = limit;
    this.reset();
  }

  reset() {
    this.total = 0;
    this.spent = 0;
    this.acted = 0;
    this.refused = 0;
    this.held = 0;
    this.rejected = 0;
    this.byFamily = {};
    this.spendByFamily = {};
    this.byReason = {};
    this.sources = {};
    this.entries = [];
    return this;
  }

  record(decision) {
    if (!decision) return this;
    const fam = familyOf(decision.intent);
    const cost = Number(decision.cost) || 0;
    const reason = reasonOf(decision);
    this.total++;
    this.spent += cost;
    if (ACTED.has(decision.status)) this.acted++;
    if (REFUSED.has(decision.status)) this.refused++;
    if (HELD.has(decision.status)) this.held++;
    if (decision.status === 'rejected') this.rejected++;
    if (reason) this.byReason[reason] = (this.byReason[reason] || 0) + 1;
    this.byFamily[fam] = (this.byFamily[fam] || 0) + 1;
    this.spendByFamily[fam] = (this.spendByFamily[fam] || 0) + cost;
    this.sources[decision.source || 'unknown'] = (this.sources[decision.source || 'unknown'] || 0) + 1;
    this.entries.push({ intent: decision.intent, family: fam, status: decision.status, cost, reason, source: decision.source,
      projectId: decision.projectId || null });
    if (this.entries.length > this.limit) {
      const gone = this.entries.shift();
      this.total--;
      this.spent -= gone.cost;
      this.byFamily[gone.family] = Math.max(0, (this.byFamily[gone.family] || 1) - 1);
      this.spendByFamily[gone.family] = Math.max(0, (this.spendByFamily[gone.family] || 0) - gone.cost);
      if (gone.reason) this.byReason[gone.reason] = Math.max(0, (this.byReason[gone.reason] || 1) - 1);
    }
    return this;
  }

  reviseProject(projectId, status, cost = 0) {
    const entry = this.entries.findLast((item) => item.projectId === projectId);
    if (!entry) return;
    const delta = cost - entry.cost;
    this.spent += delta;
    this.spendByFamily[entry.family] = (this.spendByFamily[entry.family] || 0) + delta;
    if (ACTED.has(entry.status) && !ACTED.has(status)) this.acted--;
    entry.cost = cost;
    entry.status = status;
  }

  /** The families the council actually spent on, dearest first. */
  topFamilies(n = 2) {
    return Object.keys(this.byFamily)
      .filter((f) => f !== 'hold' && this.byFamily[f] > 0)
      .sort((a, b) => (this.spendByFamily[b] || 0) - (this.spendByFamily[a] || 0) || this.byFamily[b] - this.byFamily[a])
      .slice(0, n);
  }
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
/** Thousands, with a leading sign so "spent" reads as an amount. */
const cash = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

/**
 * The sentences. Each is a pure function of the ledger, chosen by the MEASURED
 * fact it reports — so the text cannot claim something the counts do not
 * support, and the counts alone decide the voice.
 */
const LINE_BUILDERS = {
  /** How the council answers at all. */
  posture(led) {
    if (!led.total) return 'no sittings recorded yet';
    const buildShare = pct(
      (led.byFamily.build || 0) + (led.byFamily.infrastructure || 0),
      led.total
    );
    const actShare = pct(led.acted, led.total);
    const holdShare = pct(led.held, led.total);
    if (actShare >= 70) {
      return `commissions work on ${actShare}% of its motions, and holds on ${holdShare}%`;
    }
    if (holdShare >= 40) {
      return `holds on ${holdShare}% of its motions and commissions on ${actShare}%`;
    }
    if (led.refused >= led.acted && led.refused > 0) {
      return `refuses more often than it acts — ${led.refused} blocked or rejected against ${led.acted} carried out`;
    }
    return `commissions work on ${actShare}% of its motions`;
  },

  /** What it spends its money on, by family. */
  appetite(led) {
    const top = led.topFamilies(2);
    if (!top.length) return 'nothing yet';
    const parts = top.map((f) => `${f} (${cash(led.spendByFamily[f] || 0)})`);
    return `${parts.join(' and ')} of ${cash(led.spent)} spent`;
  },

  /** How it handles its own limits. */
  limits(led) {
    if (!led.refused) return 'no motion has been refused yet';
    const share = pct(led.refused, led.total);
    const top = Object.entries(led.byReason).sort((a, b) => b[1] - a[1])[0];
    const why = top ? `, most often on ${top[0]} (${top[1]})` : '';
    return `${led.refused} of ${led.total} motions (${share}%) stopped on its own limits${why}, ${cash(led.spent)} committed in total`;
  },

  /** How the ledger is read: consensus, or a single voice. */
  process(led) {
    const sources = Object.entries(led.sources);
    if (sources.length <= 1) return 'a single voice so far';
    const [topName, topN] = sources.sort((a, b) => b[1] - a[1])[0];
    return `${topName} has spoken for ${pct(topN, led.total)}% of its motions`;
  }
};

/**
 * The persona: a neutral line for an empty ledger, otherwise one sentence per
 * measured fact, all interpolated from the counts. Never a trait word.
 */
export function persona(led) {
  if (!led || !led.total) {
    return { lines: ['A new council: no decisions on record, so no manner to report.'], empty: true, ledger: null };
  }
  const lines = [
    LINE_BUILDERS.posture(led),
    LINE_BUILDERS.appetite(led),
    LINE_BUILDERS.limits(led),
    LINE_BUILDERS.process(led)
  ];
  return {
    lines,
    empty: false,
    ledger: {
      total: led.total,
      acted: led.acted,
      refused: led.refused,
      held: led.held,
      spent: Math.round(led.spent),
      byFamily: { ...led.byFamily },
      spendByFamily: { ...led.spendByFamily },
      byReason: { ...led.byReason },
      sources: { ...led.sources }
    }
  };
}
