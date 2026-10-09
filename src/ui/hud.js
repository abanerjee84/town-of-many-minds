import { events } from '../core/events.js';
import { SPEEDS } from '../core/config.js';
import performanceRules from '../data/performance.json' with { type: 'json' };
// Phase 29 (S19a) — one shared escaper; this file's own copy did not cover `'`.
import { esc } from './escape.js';

const $ = (id) => document.getElementById(id);

const RES_COLOR = {
  water: '#58a6ff',
  energy: '#e3b341',
  food: '#7ee787',
  fuel: '#f0883e'
};

/**
 * The glyph in the clock's medallion — one per stretch of the day, so the
 * panel reads as a time of day rather than as decoration. It lives in its own
 * element instead of being prepended to `#stat-day` on purpose: that string is
 * read back as plain text by the UI checks, and a clock label that suddenly
 * began with a code point above U+2200 would fail the glyph audit the HUD has
 * had since Phase 37.
 */
function phaseEmoji(hour) {
  const h = hour ?? 0;
  if (h < 5) return '🌙'; // night
  if (h < 11) return '🌅'; // morning
  if (h < 16) return '☀️'; // day
  if (h < 20) return '🌇'; // evening
  return '🌙'; // night
}

/**
 * Compact gauges for the primary resources — one per `resourceKit.ORDER` row,
 * so a new resource shows up without touching this file.
 *
 * Phase 37 (S19g) — two facts the tile was conflating:
 *
 *   1. The bar is percent of **STORE** and the line under it is **FLOW**
 *      (produced / used per day). `55%` next to `+0 / −303` reads as one
 *      number, but it is two different questions, so the bar is now labelled.
 *   2. A resource with **no production at all** is a different fact from a
 *      resource that is merely low. It used to get the same `warn` amber as a
 *      thin store, and its flow line `+0 / −303` has the same shape as a
 *      surplus. That is now the loudest state a tile can be in.
 */
function renderResources(res) {
  if (!res || !res.types) return '';
  return Object.keys(res.types)
    .map((k) => {
      const t = res.types[k];
      if (!t) return '';
      // No output at all beats every other reading: the town is drawing the
      // store down and nothing is putting it back.
      const dead = t.production <= 0 && t.demand > 0;
      const cls = dead ? 'dead' : t.shortage || t.percent < 15 ? 'low' : t.deficit || t.percent < 40 ? 'warn' : '';
      const pct = Math.max(0, Math.min(100, t.percent));
      const flow = dead
        ? 'no output'
        : `${t.production > 0 ? '+' : ''}${t.production} / −${t.demand} ${t.flowUnit}`;
      const tip =
        `${t.label}: ${t.production} ${t.flowUnit} produced, ${t.demand} ${t.flowUnit} used/day · ` +
        `${t.level}/${t.capacity} ${t.unit} in store · ${t.sites} site(s), ${t.storage} storage`;
      // The tile is ~66px wide: the percent is in the header row and the
      // level/capacity are in the tooltip and the inspector, so all that fits
      // here is the word that says WHICH quantity the bar is.
      return `<div class="res ${cls}" title="${esc(tip)}">
        <div class="n"><span>${esc(t.label)}</span><b>${t.percent}%</b></div>
        <div class="cap"><span>store</span></div>
        <div class="bar"><i style="width:${pct}%;background:${RES_COLOR[k] || '#8b949e'}"></i></div>
        <div class="f">${esc(flow)}</div>
      </div>`;
    })
    .join('');
}


/** Storehouse trade rows: stock level plus manual buy/sell buttons. */
function renderSparkline(values, color = '#79c0ff') {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '<span class="sparkline empty">—</span>';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = Math.max(1, hi - lo);
  const points = nums.map((v, i) => `${(i / (nums.length - 1)) * 48},${15 - ((v - lo) / span) * 13}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 48 16" aria-label="recent price trend" role="img"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke" /></svg>`;
}

function renderTrade(ind, history = []) {
  if (!ind || !ind.commodities) return '';
  return Object.entries(ind.commodities)
    .map(
      ([key, c]) => `<div class="trade-row" title="${esc(c.label)}: ${c.stock}/${c.capacity} in store${esc((() => { const row = ind.demandBoard?.find((item) => item.product === key); return row ? `; demand ${row.demand}/day, usable ${row.effectiveCapacity}/day, ${row.coverDays ?? '—'} stock days; ${row.reason}` : ''; })())}">
        <span class="t-name">${esc(c.label)}</span>
        <b class="t-stock">${c.stock}/${c.capacity}</b>
        ${renderSparkline(history.map((row) => row.commodities?.[key]).filter((v) => v != null))}
        <button data-trade="buy:${key}" title="Import 50 ${esc(c.label.toLowerCase())} for $${(
        c.buy * 50
      ).toLocaleString('en-US')}">↑$${c.buy}</button>
        <button data-trade="sell:${key}" title="Export 50 ${esc(c.label.toLowerCase())} for $${(
        c.sell * 50
      ).toLocaleString('en-US')}">↓$${c.sell}</button>
      </div>`
    )
    .join('');
}

export class Hud {
  constructor(clock, town = null) {
    this.clock = clock;
    this.town = town;
    this.el = {
      pop: $('stat-pop'),
      hhd: $('stat-hhd'),
      veh: $('stat-veh'),
      bld: $('stat-bld'),
      road: $('stat-road'),
      mood: $('stat-mood'),
      // Phase 37 (S19g) — the numbers the council actually governs. Money and
      // labour were reachable only by opening the inspector and scrolling past
      // the pipeline profiler, while RAISE_TAX / HIRE_WORKERS / SUBSIDY /
      // BOND_ISSUE / ATTRACT_SETTLERS all exist to move them.
      treasury: $('stat-treasury'),
      tax: $('stat-tax'),
      jobs: $('stat-jobs'),
      beds: $('stat-beds'),
      debt: $('stat-debt'),
      traffic: $('stat-traffic'),
      time: $('stat-time'),
      day: $('stat-day'),
      period: $('stat-period'),
      season: $('stat-season'),
      weather: $('stat-weather'),
      phase: $('stat-phase'),
      comps: $('stat-comps'),
      res: $('stat-res'),
      trade: $('stat-trade'),
      tradeBox: $('trade'),
      tradeToggle: $('trade-toggle'),
      tradeSummary: $('trade-summary'),
      log: $('log'),
      councilList: $('council-list'),
      councilState: $('council-state'),
      councilSittings: $('council-sittings'),
      councilHistory: $('council-history'),
      councilThought: $('council-thought'),
      councilLearning: $('council-learning'),
      councilFeedbackAge: $('council-feedback-age'),
      resourceFeedback: $('resource-feedback'),
      societyFeedbackApproval: $('society-feedback-approval'),
      societyFeedbackSummary: $('society-feedback-summary'),
      societyFeedbackDetail: $('society-feedback-detail'),
      societyFeedbackElection: $('society-feedback-election')
    };
    this.entries = [];
    // Phase 37 (S19g) — the log is two tiers. It was one 6-slot FIFO for
    // everything, so five lines of "leans on the horn" evicted a council refusal
    // within seconds. `kind: 'note'` lines expire; anything else is a decision,
    // a refusal or an event and persists.
    this.LOG_LIMIT = 6;
    this.PINNED_LIMIT = 4;
    // Phase 37 (S19g) — the storehouse started collapsed because it was 181px
    // of a 531px panel. Phase 40: it is no longer part of the scrolled stats —
    // it is pinned between the scroll and the view controls — so being open
    // costs the panel nothing but the fixed height it already has, and it is
    // ON by default. `?storehouse=0` collapses it for a probe that wants the
    // collapsed read.
    this.storehouseOpen = new URLSearchParams(location.search).get('storehouse') !== '0';
    this.councilRows = [];
    this.lastCouncilSittingId = null;
    this.speeds = SPEEDS;
    this.speedButtons = this.speeds.map((s, i) => {
      const btn = $(`speed-${s}`);
      btn.dataset.speed = String(s);
      btn.addEventListener('click', () => {
        this.clock.speed = s;
        this.syncSpeed();
      });
      return btn;
    });

    events.on('log', (e) => this.log(e.text, e.kind));
    events.on('council', (e) => this.council(e));
    // Private commissioning is a separate simulation channel. It is rendered
    // in the unified history for observability, but never enters Governance's
    // Council ledger or sitting count.
    events.on('developer-action', (e) => this.developerAction(e));
    events.on('resource-update', (e) => this.resourceUpdate(e));
    // Trade buttons: one delegated listener, results announced in the log.
    if (this.el.trade) {
      this.el.trade.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-trade]');
        if (!btn || !this.town?.industry) return;
        const [act, key] = btn.dataset.trade.split(':');
        const ind = this.town.industry;
        const res = act === 'buy' ? ind.manualBuy(key, 50) : ind.manualSell(key, 50);
        const c = ind.stats().commodities[key];
        const name = c ? c.label.toLowerCase() : key;
        if (res.ok) {
          events.emit('log', {
            kind: 'trade',
            text: `Trade: ${res.qty} ${name} ${act === 'buy' ? 'imported' : 'exported'} for $${res.cost.toLocaleString('en-US')}.`
          });
          events.emit('council', {
            source: 'player',
            actor: 'You',
            action: act === 'buy' ? 'TRADE_BUY' : 'TRADE_SELL',
            status: 'done',
            detail: `you ${act === 'buy' ? 'imported' : 'exported'} ${res.qty} ${name} to ${act === 'buy' ? 'restock' : 'clear a surplus'} the storehouse`,
            cost: res.cost
          });
          this._trade = ''; // force a re-render with the new stock level
        } else {
          events.emit('log', { kind: 'trade',
            text: `Trade refused: ${name} — ${res.reason}.` });
        }
      });
    }
    this._acc = 1;
    this.resourceFeedback = null;
    this.resourceFeedbackTimer = null;
    this._lastGovernance = null;
    this.syncSpeed();
    this.applyStorehouse();
    if (this.el.tradeToggle) {
      this.el.tradeToggle.addEventListener('click', () => {
        this.storehouseOpen = !this.storehouseOpen;
        this.applyStorehouse();
        this._trade = ''; // re-render at the new width
      });
    }
    // Phase 37 (S19g) — the council card carries the motions, so it should be
    // where the history opens from. It delegated to the inspector's own modal
    // entry point rather than duplicating the renderer.
    if (this.el.councilHistory) {
      this.el.councilHistory.addEventListener('click', () => {
        document.querySelector('[data-modal="council"]')?.click();
      });
    }
  }

  /** Collapsed/expanded state of the storehouse, in one place. */
  applyStorehouse() {
    const box = this.el.tradeBox;
    const btn = this.el.tradeToggle;
    if (!box) return;
    box.classList.toggle('collapsed', !this.storehouseOpen);
    if (btn) btn.setAttribute('aria-expanded', this.storehouseOpen ? 'true' : 'false');
  }

  /**
   * Council card: the last three motions, newest first.
   *
   * Phase 37 (S19g) — two corrections in opposite directions, both from looking
   * at it. It showed a `detail` column that was a verbatim repeat of the log
   * line 700px away, and it showed **no sitting count and no cost**. So the
   * routine half of the row is now compact (intent · status · cost), and the
   * reason is kept exactly where it is load-bearing: a row that was **refused**
   * or **blocked** carries its detail, because a refusal with no reason is
   * useless and that is the row a reader most needs to understand. A `started`
   * row's label is ceremony — the log already has it.
   */
  /**
   * Unified decisions feed: council motions AND every other actor that changes
   * the town — the player, the private developer, and automatic town systems
   * (fuel imports, deficit-driven site growth, storehouse trades). Each row
   * carries who (actor), what (action), and why (detail), so the top strip
   * reads as a decision log rather than a council-only ticker.
   *
   * Incoming shapes:
   *   council: {intent, status, source:'llm'|'rules', detail, cost, substituted}
   *   generic: {actor, action, status, why, cost, source}
   * Both are normalised into {actor, action, status, why, cost, source, sub}.
   */
  static ACTOR_OF(source, actor) {
    if (actor) return actor;
    if (source === 'llm') return 'Council';
    if (source === 'rules') return 'Rules';
    if (source === 'player') return 'You';
    if (source === 'developer') return 'Developer';
    return 'Town';
  }

  council(decision) {
    if (decision === null) {
      this.councilRows = [];
      this.feedFull = [];
      this.councilSittings = 0;
      this.lastCouncilSittingId = null;
      this.renderCouncil();
      return;
    }
    if (!decision || (!decision.intent && !decision.action)) return;
    const isCouncil = decision.source === 'llm' || decision.source === 'rules' || (!decision.source && decision.intent);
    const sittingId = decision.sittingId || null;
    if (isCouncil && sittingId !== this.lastCouncilSittingId) {
      this.councilSittings = (this.councilSittings || 0) + 1;
      this.lastCouncilSittingId = sittingId;
    }
    const row = {
      t: this.clock.timeString,
      day: this.clock.day,
      actor: Hud.ACTOR_OF(decision.source, decision.actor),
      action: decision.action || decision.intent,
      status: decision.status || 'done',
      source: decision.source || (isCouncil ? 'llm' : 'town'),
      sittingId,
      department: decision.department || null,
      departmentLabel: decision.departmentLabel || null,
      mayor: decision.mayor || null,
      cost: Number(decision.cost) || 0,
      funding: decision.funding || null,
      why: decision.why ?? decision.detail ?? '',
      // Phase 30 (S19b) — when the planner answered in place of the model, say
      // so on the card rather than showing only the substitute.
      sub: decision.substituted ? decision.substituted.intent : (decision.sub || null)
    };
    this.councilRows.unshift(row);
    if (this.councilRows.length > 3) this.councilRows.pop();
    this.feedFull = this.feedFull || [];
    this.feedFull.unshift(row);
    if (this.feedFull.length > 30) this.feedFull.pop();
    this.renderCouncil();
  }

  developerAction(decision) {
    if (!decision) return;
    this.council({ ...decision, source: 'developer' });
  }

  /** Surface a resource upgrade immediately, before the next HUD tick. */
  resourceUpdate(feedback) {
    if (!feedback) return;
    const label = feedback.siteLabel || feedback.kind || 'resource site';
    const level = `L${feedback.fromLevel} → L${feedback.toLevel}`;
    this.resourceFeedback = {
      text: `UPDATE_RESOURCE · ${label} ${level} · ${feedback.cells} tiles`,
      crowded: !!feedback.crowded
    };
    this.renderCouncilFeedback(this._lastGovernance);
    if (this.resourceFeedbackTimer) clearTimeout(this.resourceFeedbackTimer);
    this.resourceFeedbackTimer = setTimeout(() => {
      this.resourceFeedback = null;
      this.renderCouncilFeedback(this._lastGovernance);
    }, 5200);
  }

  /** Render the council's latest reply and delayed outcome evidence. */
  renderCouncilFeedback(governance) {
    this._lastGovernance = governance || this._lastGovernance;
    const g = this._lastGovernance;
    if (this.el.councilThought) {
      const reply = String(g?.lastReply || '').replace(/\s+/g, ' ').trim();
      const last = g?.last;
      const base = g?.pending
        ? 'Considering the current town report…'
        : reply || (last ? `${last.intent || 'Decision'} · ${last.status || 'recorded'}${last.detail ? ` — ${last.detail}` : ''}` : 'Waiting for the first sitting.');
      const remedy = g?.requiredAction
        ? `Required next: ${g.requiredAction.intent}${g.requiredAction.resource ? ` resource=${g.requiredAction.resource}` : ''}`
        : '';
      this.el.councilThought.textContent = remedy ? `${base} · ${remedy}` : base;
      this.el.councilThought.title = remedy || reply || '';
    }
    if (this.el.councilLearning) {
      const learning = g?.learning;
      const lessons = learning?.lessons || [];
      const pending = Number(learning?.pending) || 0;
      const latest = lessons[lessons.length - 1];
      this.el.councilLearning.textContent = lessons.length || pending
        ? `${lessons.length} lesson${lessons.length === 1 ? '' : 's'} · ${pending} pending${latest ? ` · last ${latest.score >= 0 ? '+' : ''}${Number(latest.score).toFixed(2)} ${latest.summary || ''}` : ''}`
        : 'No measured outcomes yet.';
      this.el.councilLearning.title = g?.manner?.lines?.join('; ') || '';
    }
    if (this.el.councilFeedbackAge) {
      const day = Number(g?.last?.day);
      this.el.councilFeedbackAge.textContent = Number.isFinite(day) && day > 0 ? `day ${day}` : '';
    }
    if (this.el.resourceFeedback) {
      const f = this.resourceFeedback;
      this.el.resourceFeedback.hidden = !f;
      this.el.resourceFeedback.className = `feedback-event${f?.crowded ? ' crowded' : ''}`;
      this.el.resourceFeedback.textContent = f?.text || '';
    }
  }

  /** Render the measured social state beside the council's evidence card. */
  renderSocietySummary(society) {
    const approval = Number(society?.approvalRate);
    const mood = Number(society?.mood);
    const pct = (value, fallback = '—') => Number.isFinite(value) ? `${Math.round(value * 100)}%` : fallback;
    const neighbourhoods = Array.isArray(society?.neighbourhoods) ? society.neighbourhoods : [];
    const crimes = society?.crimes || {};
    const elections = Array.isArray(society?.elections) ? society.elections : [];
    if (this.el.societyFeedbackApproval) {
      this.el.societyFeedbackApproval.textContent = `approval ${pct(approval)}`;
      this.flag(this.el.societyFeedbackApproval, Number.isFinite(approval) && approval < 0.45 ? 'bad' : Number.isFinite(approval) && approval < 0.6 ? 'warn' : '');
    }
    if (this.el.societyFeedbackSummary) {
      this.el.societyFeedbackSummary.textContent = `${neighbourhoods.length} neighbourhood${neighbourhoods.length === 1 ? '' : 's'} · mood ${pct(mood)}`;
      this.el.societyFeedbackSummary.title = neighbourhoods.map((n) => `${n.name} ${pct(n.mood)}`).join(' · ');
    }
    if (this.el.societyFeedbackDetail) {
      this.el.societyFeedbackDetail.textContent = `${crimes.open || 0} open crime${crimes.open === 1 ? '' : 's'} · ${crimes.backlog || 0} court backlog · ${(society?.laws || []).length} laws`;
      this.el.societyFeedbackDetail.title = `Reported ${crimes.reported || 0} · resolved ${crimes.resolved || 0}`;
    }
    if (this.el.societyFeedbackElection) {
      const latest = elections[elections.length - 1];
      this.el.societyFeedbackElection.textContent = latest
        ? `Mayor ${latest.winner} · election day ${latest.day}`
        : 'No election held yet.';
      this.el.societyFeedbackElection.title = latest ? `${latest.turnout || 0} adult voters` : '';
    }
  }

  renderCouncil() {
    const el = this.el.councilList;
    if (!el) return;
    if (this.el.councilSittings) {
      // "0 sittings" is noise before anything has happened.
      this.el.councilSittings.textContent = this.councilSittings
        ? `${this.councilSittings} sitting${this.councilSittings === 1 ? '' : 's'}`
        : '';
    }
    el.innerHTML = this.councilRows.length
      ? this.councilRows
          .map((r) => {
            const actorCls = r.actor === 'You' ? 'you' : r.actor === 'Developer' ? 'dev' : r.actor === 'Rules' ? 'rules' : r.actor === 'Council' ? 'council' : 'town';
            const why = (r.why || '').trim();
            return (
              `<div class="c-row multi"><div class="c-line">` +
              `<span class="c-time">${esc(r.t)}</span>` +
              `<span class="c-actor ${actorCls}">${esc(r.actor)}</span>` +
              // Keep the actionable intent on the first line. The department
              // is supporting context and belongs below the explanation so a
              // narrow council card never hides the thing the Council chose.
              `<span class="c-intent${r.source === 'rules' ? ' muted' : ''}" title="Intent: ${esc(r.action)}">${esc(r.action)}</span>` +
              `<span class="c-status ${esc(r.status)}">${esc(r.status)}</span>` +
              (r.sub ? `<span class="c-sub" title="the council asked for this; the planner answered instead">↩ ${esc(r.sub)}</span>` : '') +
              (r.cost ? `<span class="c-cost">$${Math.round(r.cost).toLocaleString('en-US')}${r.funding?.label ? ` · ${esc(r.funding.label)}` : ''}</span>` : '') +
              `</div>` +
              (why ? `<div class="c-why">${esc(why.length > 160 ? why.slice(0, 160) + '…' : why)}</div>` : '') +
              (r.departmentLabel ? `<div class="c-department">${esc(r.departmentLabel)}</div>` : '') +
              `</div>`
            );
          })
          .join('')
      : '<div class="c-empty">Waiting for the first decision.</div>';
  }

  syncSpeed() {
    this.speedButtons.forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === this.clock.speed);
    });
  }

  /**
   * The log. Phase 37 (S19g) — two tiers instead of one 6-slot FIFO.
   *
   * Ambient pedestrian chatter and a council refusal used to compete for the same
   * six slots, so "Kaya Delacroix leans on the horn" evicted
   * `Council [llm] BUILD_LANDMARK: rejected — treasury 900 below 299000` within
   * seconds. `kind: 'note'` (the default) expires; anything else — a decision, a
   * refusal, a trade, a reset, a validator failure — is pinned and survives the
   * churn, up to `PINNED_LIMIT` of them.
   */
  log(text, kind) {
    if (!text) return;
    const pinned = kind && kind !== 'note';
    this.entries.unshift({ t: this.clock.timeString, text, pinned });
    this.trimLog();
    this.renderLog();
  }

  trimLog() {
    let notes = 0;
    let pins = 0;
    // Newest first, so counting down the list counts what survives.
    const kept = [];
    for (const e of this.entries) {
      if (e.pinned) {
        if (pins >= this.PINNED_LIMIT) continue;
        pins++;
      } else {
        if (notes >= this.LOG_LIMIT) continue;
        notes++;
      }
      kept.push(e);
    }
    this.entries = kept;
  }

  renderLog() {
    // Phase 29 (S19a) — `e.text` is untrusted: `governance.record()` logs
    // `decision.detail`, which embeds `plan.label`, which embeds the council's
    // own `name=` spec. It was interpolated raw here, so a model-authored name
    // could reach the DOM as markup. `e.t` is `clock.timeString`, generated.
    this.el.log.innerHTML = this.entries
      .map(
        (e) =>
          `<div class="entry${e.pinned ? ' pinned' : ''}"><span class="t">${esc(e.t)}</span>${esc(e.text)}</div>`
      )
      .join('');
  }

  clearLog() {
    this.entries = [];
    this.el.log.innerHTML = '';
  }

  /** Colour a stat value by severity. `cls` is '', 'warn' or 'bad'. */
  flag(el, cls) {
    if (!el) return;
    if (el.className !== cls) el.className = cls;
  }

  moodLabel(v) {
    if (v > 0.78) return 'Thriving';
    if (v > 0.66) return 'Content';
    if (v > 0.52) return 'Settled';
    if (v > 0.4) return 'Restless';
    return 'Grumbling';
  }

  /** Advance the UI scheduler without constructing a deep town snapshot. */
  needsUpdate(dt) {
    this._acc += Math.max(0, Number(dt) || 0);
    return this._acc >= performanceRules.ui.statsIntervalSeconds;
  }

  update(stats, dt = null) {
    // Keep the throttled public API for external callers. The main loop calls
    // needsUpdate() first, then passes a snapshot with no dt on due frames.
    if (dt != null) {
      this._acc += Math.max(0, Number(dt) || 0);
      if (this._acc < performanceRules.ui.statsIntervalSeconds) return false;
    }
    this._acc = 0;
    if (!stats) return false;
    const inside = stats.inside ?? (stats.population - stats.visible);
    this.el.pop.textContent = `${stats.population} (${stats.visible} out · ${inside} in)`;
    if (this.el.hhd) this.el.hhd.textContent = String(stats.households ?? 0);
    this.el.veh.textContent = String(stats.vehicles);
    this.el.bld.textContent = `${stats.buildings} · ${stats.houses} homes`;
    this.el.road.textContent = String(stats.roads);
    this.el.mood.textContent = this.moodLabel(stats.mood);
    this.el.time.textContent = this.clock.timeString;
    // The clock is two lines with the DAY count on top of them: how far into
    // the run the town is matters more at a glance than what hour it is, and a
    // single `Day 12 · Afternoon` line could never be set at a size that said
    // so. `#stat-day` therefore carries the count alone and the period sits
    // with the time underneath it.
    this.el.day.textContent = `Day ${this.clock.day}`;
    if (this.el.period) this.el.period.textContent = this.clock.period;
    const weather = stats.weather;
    if (weather) {
      if (this.el.season) this.el.season.textContent = `${weather.seasonIcon || ''} ${weather.seasonLabel || weather.season}`.trim();
      if (this.el.weather) {
        this.el.weather.textContent = `${weather.icon || ''} ${weather.weatherLabel || weather.weather}`.trim();
        this.el.weather.title = `${weather.temperature}°C · precipitation ${Math.round((weather.precipitation || 0) * 100)}% · changes day ${weather.nextChangeDay}`;
      }
    }
    if (this.el.phase) {
      const glyph = phaseEmoji(this.clock.hour);
      if (glyph !== this._phase) {
        this._phase = glyph;
        this.el.phase.textContent = glyph;
      }
    }

    // Phase 37 (S19g) — the economy and labour block. These are the numbers the
    // council governs, and until now they were reachable only by opening the
    // inspector and scrolling past the pipeline profiler. `warn`/`bad` are set
    // from the same gates the systems themselves use, so a row that needs
    // attention is coloured rather than having to be read.
    const eco = stats.economy;
    if (this.el.treasury) {
      const debt = eco?.debt || 0;
      this.el.treasury.textContent = `$${Math.round(eco?.treasury ?? 0).toLocaleString('en-US')}`;
      // A treasury that cannot cover the council's own reserve floor is the one
      // money state that stops every build in the sim.
      this.flag(this.el.treasury, (eco?.treasury ?? 0) < 50000 ? 'bad' : debt > (eco?.treasury ?? 0) ? 'warn' : '');
    }
    if (this.el.tax) this.el.tax.textContent = `${eco ? Math.round(eco.taxRate) : 100}%`;
    if (this.el.jobs) {
      const u = eco?.unemployment;
      this.el.jobs.textContent = u == null ? '—' : `${Math.round(u)}%`;
      // UNEMPLOYMENT_GATE is 0.1 — the same fraction `growth.wanted('shop')`
      // tests, quoted as a percent here rather than a second constant.
      this.flag(this.el.jobs, u == null ? '' : u > 25 ? 'bad' : u > 10 ? 'warn' : '');
    }
    if (this.el.beds) {
      const beds = Math.round(stats.growth?.capacity ?? 0);
      this.el.beds.textContent = `${stats.population} / ${beds}`;
      this.flag(this.el.beds, stats.population > beds ? 'bad' : beds - stats.population < 5 ? 'warn' : '');
    }
    if (this.el.debt) {
      const debt = Math.round(eco?.debt ?? 0);
      this.el.debt.textContent = debt ? `$${debt.toLocaleString('en-US')}` : '—';
      this.flag(this.el.debt, !debt ? '' : debt > (eco?.gdp ?? 0) * 0.5 ? 'bad' : debt > (eco?.gdp ?? 0) * 0.2 ? 'warn' : '');
    }
    if (this.el.traffic) {
      const jam = Math.round((stats.mobility?.congestion ?? 0) * 100);
      this.el.traffic.textContent = `${jam}%`;
      this.flag(this.el.traffic, jam > 60 ? 'bad' : jam > 34 ? 'warn' : '');
    }

    if (this.el.councilState) {
      const g = stats.governance;
      this.renderCouncilFeedback(g);
      // `rulesOnly` is retained as a provider-failure diagnostic for old saves,
      // but Council-only mode does not commission work through that path.
      const s =
        !g || g.available === null
          ? 'idle'
          : g.pending
            ? 'thinking…'
            : g.rulesOnly
              ? `Council paused · ${g.consecutiveFailures} failures`
              : g.available
                ? 'connected'
                : 'offline · awaiting Council';
      if (s !== this._cs) {
        this._cs = s;
        this.el.councilState.textContent = s;
        this.el.councilState.className = 'c-state ' + (s === 'connected' ? 'on' : s === 'idle' ? '' : 'off');
      }
      // Surface why it is offline (e.g. 404 = page served without the /lm proxy,
      // i.e. opened via Live Server instead of `npm run dev`).
      this.el.councilState.title =
        g.available === null || g.available
          ? ''
          : `${g.endpoint}${g.lastError ? ' — ' + g.lastError : ''}${g.staleReplies ? ` · ${g.staleReplies} reply(s) discarded after a regen` : ''}`;
    }
    this.renderSocietySummary(stats.society);
    if (this.el.res) {
      const html = renderResources(stats.resources);
      if (html !== this._res) {
        this._res = html;
        this.el.res.innerHTML = html;
      }
    }
    if (this.el.trade) {
      const ind = stats.industry;
      // Phase 37 (S19g) — the collapsed summary line. The table is hidden, so
      // the row has to carry the one fact worth having at a glance: what is in
      // store, and whether anything is running out.
      if (this.el.tradeSummary && ind && ind.commodities) {
        const rows = Object.values(ind.commodities);
        const total = rows.reduce((n, c) => n + (c.stock || 0), 0);
        const cap = rows.reduce((n, c) => n + (c.capacity || 0), 0);
        const pct = cap ? Math.round((total / cap) * 100) : 0;
        const worst = rows.slice().sort((a, b) => a.percent - b.percent)[0];
        this.el.tradeSummary.textContent = worst
          ? `${pct}% of ${cap.toLocaleString('en-US')} · lowest ${worst.label.toLowerCase()} ${worst.percent}%`
          : `${pct}% full`;
        this.flag(this.el.tradeSummary, pct < 15 ? 'bad' : pct < 40 ? 'warn' : '');
      }
      // The table itself is only rendered when the block is open — rendering 7
      // rows of HTML into a `display:none` element 4× a second is work for
      // nothing.
      if (this.storehouseOpen) {
        const html = renderTrade(stats.industry, stats.priceHistory || []);
        if (html !== this._trade) {
          this._trade = html;
          this.el.trade.innerHTML = html;
        }
      } else if (this._trade) {
        this._trade = '';
      }
    }
    if (this.el.comps) {
      const comps = Object.entries(stats.components || {});
      const html = comps.map(([k, v]) => `<span class="tag">${k} ${v}</span>`).join('');
      if (html !== this._comps) {
        this._comps = html;
        this.el.comps.innerHTML = html;
      }
    }
    return true;
  }
}
