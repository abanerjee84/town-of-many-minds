import SCHEME_DATA from '../data/council_schemes.json' with { type: 'json' };
import { CELL_KIND } from '../core/config.js';
import { events } from '../core/events.js';
import { roadComponents, hasNetworkAccess } from '../placement/placementController.js';

/**
 * Policy (Phase 15 — A1 schemes + A2 law & jurisdiction).
 *
 * Two things live here, and they share ONE mechanism:
 *
 *   • **Schemes** — timed, paid-per-day interventions read from
 *     `data/council_schemes.json`.
 *   • **Laws** — permanent, one-off-cost interventions from `LAWS` below.
 *
 * Both name the same generic effect keys. `MODIFIERS` is the whole vocabulary:
 * every key is a DELTA on a named live parameter, and the consuming system
 * reads it where it already reads that parameter. Nothing in this file — and
 * nothing in the scheme/law *data* — branches on a scheme or law id, so a new
 * row is a data edit: the board, the parser, the prompt and the report all
 * pick it up from the same table.
 *
 * The word "delta" is load-bearing. A scheme saying `spendingScale: -0.15`
 * does not set spending to -0.15; it shaves 15% off whatever SLASH_SPENDING
 * already chose, and lifting the scheme restores the old value exactly
 * because the aggregate is recomputed from the active set and pushed out on
 * every change — never written into the target and subtracted back out.
 */

/** The scheme catalogue, straight from the data file. */
export const SCHEMES = SCHEME_DATA.schemes;
export const SCHEME_IDS = SCHEMES.map((s) => s.id);
export const schemeById = (id) => SCHEMES.find((s) => s.id === id) || null;

/** A2 — the statute book. Same effect vocabulary as a scheme, but permanent. */
export const LAWS = [
  {
    id: 'right_to_roofs',
    label: 'Right to roofs',
    cost: 18000,
    effects: { buildCost: -0.1, buildHours: -0.1, immigrationPull: 0.1 }
  },
  {
    id: 'living_wage',
    label: 'Living wage',
    cost: 22000,
    effects: { staffPay: 0.15, staffingFloor: 0.3, moodDrift: 0.003 }
  },
  {
    id: 'green_belt',
    label: 'Green belt',
    cost: 12000,
    effects: { moodDrift: 0.006, moodTarget: 0.04, emigrationPull: -0.25 }
  },
  {
    id: 'market_levy',
    label: 'Market levy',
    cost: 9000,
    effects: { taxScale: 0.12, businessRevenue: -0.06, propertyTaxBase: 0.15 }
  },
  {
    id: 'open_borders',
    label: 'Open borders',
    cost: 15000,
    effects: { immigrationPull: 0.3, emigrationPull: -0.4, moodTarget: -0.03 }
  },
  {
    id: 'charter',
    label: 'Research charter',
    cost: 26000,
    effects: { researchRate: 0.75, buildCost: -0.06 }
  }
];
export const LAW_IDS = LAWS.map((l) => l.id);
export const lawById = (id) => LAWS.find((l) => l.id === id) || null;

/**
 * The effect vocabulary — the whole interpreter. One row per key: where the
 * delta lands, how to write it, and the sentence the prompt quotes so the
 * model knows what it is buying.
 */
export const MODIFIERS = {
  moodDrift: {
    field: 'pedestrians.moodDrift',
    hint: 'citizens grow more or less optimistic each day',
    get: (t) => t.pedestrians?.moodDrift || 0,
    set: (t, v) => {
      if (t.pedestrians) t.pedestrians.moodDrift = v;
    }
  },
  moodTarget: {
    field: 'pedestrians.moodTarget',
    hint: 'the mood citizens settle toward',
    get: (t) => t.pedestrians?.moodTarget || 0,
    set: (t, v) => {
      if (t.pedestrians) t.pedestrians.moodTarget = v;
    }
  },
  patienceDrift: {
    field: 'pedestrians.patienceDrift',
    hint: 'citizens lose their temper more or less quickly',
    get: (t) => t.pedestrians?.patienceDrift || 0,
    set: (t, v) => {
      if (t.pedestrians) t.pedestrians.patienceDrift = v;
    }
  },
  immigrationPull: {
    field: 'lifecycle.pullBonus',
    hint: 'how far below its target a town must fall before newcomers arrive',
    get: (t) => t.lifecycle?.pullBonus || 0,
    set: (t, v) => {
      if (t.lifecycle) t.lifecycle.pullBonus = v;
    }
  },
  emigrationPull: {
    field: 'lifecycle.leaveBonus',
    hint: 'how readily the unhappy drift away',
    get: (t) => t.lifecycle?.leaveBonus || 0,
    set: (t, v) => {
      if (t.lifecycle) t.lifecycle.leaveBonus = v;
    }
  },
  spendingScale: {
    field: 'economy.policySpending',
    hint: 'what services cost the treasury',
    get: (t) => t.economy?.policySpending || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policySpending = v;
    }
  },
  taxScale: {
    field: 'economy.policyTax',
    hint: 'the take from every tax band',
    get: (t) => t.economy?.policyTax || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policyTax = v;
    }
  },
  staffPay: {
    field: 'economy.policyStaffPay',
    hint: 'what employers pay their crews',
    get: (t) => t.economy?.policyStaffPay || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policyStaffPay = v;
    }
  },
  staffingFloor: {
    field: 'economy.policyStaffFloor',
    hint: 'the crew a business must keep before it counts as staffed',
    get: (t) => t.economy?.policyStaffFloor || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policyStaffFloor = v;
    }
  },
  trainingCapacity: {
    field: 'lifecycle.trainingCapacity',
    hint: 'unemployed residents entering a government training cohort each day',
    get: (t) => t.lifecycle?.trainingCapacity || 0,
    set: (t, v) => {
      if (t.lifecycle) t.lifecycle.trainingCapacity = Math.max(0, v);
    }
  },
  businessRevenue: {
    field: 'economy.policyRevenue',
    hint: 'trade takings across the town',
    get: (t) => t.economy?.policyRevenue || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policyRevenue = v;
    }
  },
  propertyTaxBase: {
    field: 'economy.policyPropertyBase',
    hint: 'the assessed value property tax is charged on',
    get: (t) => t.economy?.policyPropertyBase || 0,
    set: (t, v) => {
      if (t.economy) t.economy.policyPropertyBase = v;
    }
  },
  resourceBuffer: {
    field: 'resources.bufferBonus',
    hint: 'how much water, power, food and fuel the town can hold',
    get: (t) => t.resources?.bufferBonus || 0,
    set: (t, v) => {
      if (t.resources) t.resources.bufferBonus = v;
    }
  },
  buildCost: {
    field: 'growth.policyCost',
    hint: 'what every commission costs the treasury',
    get: (t) => t.growth?.policyCost || 0,
    set: (t, v) => {
      if (t.growth) t.growth.policyCost = v;
    }
  },
  buildHours: {
    field: 'growth.policyHours',
    hint: 'how long the crews take',
    get: (t) => t.growth?.policyHours || 0,
    set: (t, v) => {
      if (t.growth) t.growth.policyHours = v;
    }
  },
  researchRate: {
    field: 'research.rateBonus',
    hint: 'the innovation ladder (Phase 17 reads this)',
    get: (t) => t.research?.rateBonus || 0,
    set: (t, v) => {
      if (t.research) t.research.rateBonus = v;
    }
  }
};

export const EFFECT_KEYS = Object.keys(MODIFIERS);
const ALLOWED = new Set(EFFECT_KEYS);

/** Effect keys a row uses that the registry has never heard of. */
export function unknownEffects(effects) {
  if (!effects) return [];
  return Object.keys(effects).filter((k) => !ALLOWED.has(k));
}

/** The preconditions `needs` may name, and how each is read off the town. */
const NEEDS = {
  spareBeds: (t) =>
    Math.max(0, Math.round(t.growth.inputs().capacity - t.growth.inputs().pop)),
  strained: (t) => (t.resources.stats().strained || []).length > 0,
  unemployment: (t) => t.economy.stats().unemployment / 100,
  treasury: (t) => (t.economy.treasury > 0 ? 1 : 0)
};

export const NEED_KEYS = Object.keys(NEEDS);

/** Which of a row's `needs` are not met right now, by name. */
export function unmetNeeds(row, town) {
  const needs = row && row.needs ? row.needs : {};
  return Object.keys(needs).filter((k) => {
    const read = NEEDS[k];
    if (!read) return true; // a condition nobody can read is never met
    const v = read(town);
    return typeof v === 'number' ? v < needs[k] : v !== needs[k];
  });
}

export class PolicySystem {
  constructor() {
    this.townRef = null;
    this.active = []; // { id, label, daysLeft, per, cost, effects }
    this.enacted = []; // { id, label, day, cost }
    this.laws = []; // { id, label, cost, effects }
    this.modifiers = Object.fromEntries(EFFECT_KEYS.map((k) => [k, 0]));
    this.jurisdiction = null;
    this.jurisdictionSig = null;
    this.lastSpend = 0;
    this.lastDay = null;
  }

  reset() {
    this.active = [];
    this.enacted = [];
    this.laws = [];
    this.modifiers = Object.fromEntries(EFFECT_KEYS.map((k) => [k, 0]));
    this.jurisdiction = null;
    this.jurisdictionSig = null;
    this.lastSpend = 0;
    this.lastDay = null;
    return this;
  }

  /** The summed delta for one effect key across every active scheme and law. */
  get(key) {
    return this.modifiers[key] || 0;
  }

  /** Live rows a scheme and a law both feed: the active set plus the statutes. */
  rows() {
    const byId = new Map();
    for (const l of this.laws) byId.set(l.id, { ...l, source: 'law', days: null });
    for (const s of this.active) byId.set(s.id, { ...s, source: 'scheme' });
    return [...byId.values()];
  }

  /**
   * Recompute the aggregate from the active set and push it into each target
   * system. Recomputing (rather than add-then-subtract) is what makes ending a
   * scheme restore exactly the value it found.
   */
  recompute() {
    // The `refreshPolicy` call below guards `townRef` with optional chaining, but
    // the `MODIFIERS[*].set` loop does not, and every one of those dereferences
    // `townRef.<system>` unguarded — so an unwired `PolicySystem` threw on the
    // first key. That asymmetry is a live trap for any second instance (a
    // scenario, a replay, a headless probe).
    if (!this.townRef) return this.modifiers;
    const totals = Object.fromEntries(EFFECT_KEYS.map((k) => [k, 0]));
    for (const row of this.rows()) {
      for (const [k, v] of Object.entries(row.effects || {})) {
        if (k in totals) totals[k] += Number(v) || 0;
      }
    }
    // One row of `modifiers` is both the report's view and the value every
    // consumer reads, so the two can never disagree.
    for (const k of EFFECT_KEYS) {
      const v = Math.round(totals[k] * 1e6) / 1e6;
      this.modifiers[k] = v;
      MODIFIERS[k].set(this.townRef, v);
    }
    // Storage is a capacity rather than a rate, so the one modifier that moves
    // a stored figure needs pushing through the system's own recompute.
    this.townRef?.resources?.refreshPolicy?.();
    return this.modifiers;
  }

  /**
   * Start a scheme. Charges the entry cost; the daily `per` is the running cost,
   * taken by `daily()`.
   *
   * An id that names a STATUTE is routed to `passLaw` rather than refused: a
   * model that writes "ENACT_SCHEME law=<a statute id>" has said what it means,
   * and the parser deliberately accepts either spelling for either intent. The
   * returned `row` is the same shape either way. (Deliberately no real id in
   * this comment — the probe audits the source for id mentions, and an example
   * would be indistinguishable from a branch.)
   */
  enactScheme(id, day = 0) {
    if (!id) return { ok: false, reason: 'no scheme named' };
    const row = schemeById(id);
    if (!row) {
      if (lawById(id)) return this.passLaw(id);
      return { ok: false, reason: `no scheme called "${id}"` };
    }
    if (this.active.some((s) => s.id === id)) return { ok: false, reason: `${row.label} is already running` };
    const bad = unknownEffects(row.effects);
    if (bad.length) return { ok: false, reason: `unknown effect${bad.length > 1 ? 's' : ''} ${bad.join(', ')}` };
    const t = this.townRef;
    const short = unmetNeeds(row, t);
    if (short.length) return { ok: false, reason: `${row.label} needs ${short.join(' and ')}` };
    const cost = row.cost || 0;
    if (t && t.economy && t.economy.treasury < cost) {
      return { ok: false, reason: `treasury ${Math.round(t.economy.treasury)} below ${cost} — ${row.label} costs ${cost}` };
    }
    if (t && t.economy && cost) t.economy.transfer({
      from: 'government', to: 'contractor', amount: cost,
      category: 'government_procurement', metadata: { purpose: 'scheme', schemeId: row.id }
    });
    this.active.push({
      id: row.id,
      label: row.label,
      daysLeft: row.days,
      per: row.per || 0,
      cost,
      effects: { ...row.effects }
    });
    this.enacted.push({ id: row.id, label: row.label, day, cost });
    this.recompute();
    events.emit('log', { kind: 'event',
      text: `${row.label} — a ${row.days}-day programme, from today.` });
    return { ok: true, row, cost };
  }

  /** End one running scheme by id, or every running scheme when id is blank. */
  endScheme(id) {
    if (!id) {
      const n = this.active.length;
      this.active = [];
      this.recompute();
      if (n) events.emit('log', { kind: 'event', text: `All ${n} running programmes are wound up.` });
      return { ok: n > 0, count: n, reason: n ? '' : 'no programme is running' };
    }
    const i = this.active.findIndex((s) => s.id === id);
    if (i < 0) return { ok: false, reason: 'no programme is running' };
    const [row] = this.active.splice(i, 1);
    this.recompute();
    events.emit('log', { kind: 'event', text: `${row.label} is wound up early.` });
    return { ok: true, row };
  }

  /** A2 — pass a statute. Once passed it holds until repealed. */
  passLaw(id) {
    const row = lawById(id);
    if (!row) return { ok: false, reason: `no law called "${id}"` };
    if (this.laws.some((l) => l.id === id)) return { ok: false, reason: `${row.label} is already law` };
    const bad = unknownEffects(row.effects);
    if (bad.length) return { ok: false, reason: `unknown effect${bad.length > 1 ? 's' : ''} ${bad.join(', ')}` };
    const t = this.townRef;
    const cost = row.cost || 0;
    if (t && t.economy && t.economy.treasury < cost) {
      return { ok: false, reason: `treasury ${Math.round(t.economy.treasury)} below ${cost} — ${row.label} costs ${cost}` };
    }
    if (t && t.economy && cost) t.economy.transfer({
      from: 'government', to: 'contractor', amount: cost,
      category: 'government_procurement', metadata: { purpose: 'law', lawId: row.id }
    });
    this.laws.push({ id: row.id, label: row.label, cost, effects: { ...row.effects } });
    this.recompute();
    events.emit('log', { kind: 'event', text: `${row.label} passes into law.` });
    // `isLaw` so the caller's report line can describe what it actually did.
    // `enactScheme` routes an `ENACT_SCHEME law=<statute>` here (the cross-family
    // routing at :313), and a LAW row has no `days` or `per` — so the caller
    // printed "undefined days at $undefined/day" for a law.
    return { ok: true, row, cost, isLaw: true };
  }

  repealLaw(id) {
    const i = this.laws.findIndex((l) => l.id === id);
    if (i < 0) return { ok: false, reason: 'no such law is in force' };
    const [row] = this.laws.splice(i, 1);
    this.recompute();
    events.emit('log', { kind: 'event', text: `${row.label} is repealed.` });
    return { ok: true, row };
  }

  /**
   * A2 — jurisdiction. Property tax is charged on the built land the town has
   * actually taken responsibility for: annexed (zoned) AND road-connected, so
   * `ANNEX_EDGE` finally buys something concrete — land outside the band stops
   * paying. Read from the grid, never from a counter.
   *
   * `stats()` reads it every HUD frame, so the answer is cached against a
   * signature of everything that can move it (day, building and site counts,
   * road cells) and only recomputed when one of those actually changes.
   */
  computeJurisdiction(force = false) {
    const t = this.townRef;
    if (!t) return null;
    const g = t.grid;
    const sig = [
      this.lastDay ?? -1,
      t.buildings.length,
      (t.resources && t.resources.sites ? t.resources.sites.length : 0),
      g.roadCells().length
    ].join(':');
    if (!force && this.jurisdiction && this.jurisdictionSig === sig) return this.jurisdiction;
    this.jurisdictionSig = sig;

    const built = new Set();
    const note = (cells) => {
      for (const [x, y] of cells || []) built.add(`${x},${y}`);
    };
    for (const b of t.buildings) note(b.footprint && b.footprint.length ? b.footprint : [b.cell]);
    for (const s of (t.resources && t.resources.sites) || []) note(s.cells);
    if (!built.size) {
      this.jurisdiction = { built: 0, held: 0, zoned: 0, ratio: 0 };
      return this.jurisdiction;
    }

    const comps = roadComponents(g);
    let held = 0;
    let zoned = 0;
    for (const k of built) {
      const [x, y] = k.split(',').map(Number);
      if (!g.inBounds(x, y)) continue;
      // Annexed = the council has zoned the cell the building stands in, or it
      // sits on a lot the town laid out. Occupied-but-unzoned ground is not
      // governed, and does not pay.
      if (g.zone[g.idx(x, y)] || g.kindAt(x, y) === CELL_KIND.LOT) zoned++;
      else continue;
      if (this.fronts(g, x, y, comps)) held++;
    }
    this.jurisdiction = {
      built: built.size,
      held,
      zoned,
      ratio: Math.round((held / built.size) * 100) / 100
    };
    return this.jurisdiction;
  }

  /** Road-connected within two cells — the validator's frontage rule, widened. */
  fronts(g, x, y, comps) {
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (g.isRoad(x + dx, y + dy)) return true;
        }
      }
    }
    return hasNetworkAccess(g, x, y, comps);
  }

  /** Daily tick: charge the running cost, age every scheme, expire what ends. */
  daily() {
    const t = this.townRef;
    const eco = t && t.economy;
    let spend = 0;
    for (const s of this.active) spend += s.per || 0;
    this.lastSpend = spend;
    if (eco && spend) eco.transfer({
      from: 'government', to: 'contractor', amount: spend,
      category: 'government_procurement', metadata: { purpose: 'programme_operations' }
    });

    const ended = [];
    for (const s of this.active) {
      s.daysLeft -= 1;
      if (s.daysLeft <= 0) ended.push(s);
    }
    if (ended.length) {
      this.active = this.active.filter((s) => !ended.includes(s));
      this.recompute();
      for (const s of ended) {
        events.emit('log', { kind: 'event', text: `${s.label} runs its course.` });
      }
    }
    return { spend, ended: ended.map((s) => s.id) };
  }

  /** The report line: what is running, what is law, what it is all worth. */
  stats() {
    return {
      schemes: this.active.map((s) => ({
        id: s.id,
        label: s.label,
        daysLeft: s.daysLeft,
        per: s.per,
        cost: s.cost
      })),
      laws: this.laws.map((l) => ({ id: l.id, label: l.label, cost: l.cost })),
      enacted: this.enacted.length,
      modifiers: { ...this.modifiers },
      jurisdiction: this.jurisdiction || { built: 0, held: 0, zoned: 0, ratio: 0 }
    };
  }
}
