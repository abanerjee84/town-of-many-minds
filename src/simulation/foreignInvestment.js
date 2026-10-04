import rules from '../data/foreignInvestment.json' with { type: 'json' };
import { planFor } from './growth.js';
import { FACTORY_TYPES } from './industry.js';

const round = (value) => Math.round(Number(value) || 0);

/**
 * External capital and concessions are kept in a small ledger of their own,
 * while the actual construction still travels through GrowthSystem and
 * EconomySystem. That gives foreign projects real sites, bills, staff and
 * production instead of a second shadow economy.
 */
export class ForeignInvestmentSystem {
  constructor(town) {
    this.town = town;
    this.rules = rules;
    this.reset();
  }

  reset() {
    this.offers = [];
    this.projects = [];
    this.nextOffer = 1;
    this.nextProject = 1;
    this.lastOfferDay = -Infinity;
    this.lastTickDay = null;
    this.lastError = null;
    this.totals = {
      capitalCommitted: 0,
      capitalInflow: 0,
      taxRevenue: 0,
      repatriated: 0,
      jobsCreated: 0,
      infrastructure: 0,
      completed: 0,
      declined: 0,
      blocked: 0
    };
  }

  _state() {
    const t = this.town;
    const population = t.pedestrians?.citizens?.length || 0;
    const economy = t.economy?.stats?.() || {};
    const society = t.society?.stats?.() || {};
    const industry = t.industry?.stats?.() || {};
    const pressures = Object.values(industry.commodities || {}).map((row) => 1 - (Number(row.percent) || 0) / 100);
    return {
      population,
      treasury: Number(economy.treasury) || 0,
      approval: Number(society.approvalRate) || 0,
      industryPressure: pressures.length ? Math.max(...pressures) : 0,
      congestion: Number(t.traffic?.congestion) || 0,
      active: this.projects.filter((p) => p.status === 'under-construction' || p.status === 'operating').length,
      frontier: t.perimeter?.frontierCells?.(1)?.length || 0
    };
  }

  _eligible() {
    const s = this._state();
    const trigger = this.rules.triggers;
    return {
      ok: s.population >= trigger.minPopulation &&
        s.treasury >= trigger.minTreasury &&
        s.approval >= trigger.minApproval,
      state: s,
      reasons: [
        s.population < trigger.minPopulation ? `population ${s.population} < ${trigger.minPopulation}` : null,
        s.treasury < trigger.minTreasury ? `treasury ${round(s.treasury)} < ${trigger.minTreasury}` : null,
        s.approval < trigger.minApproval ? `approval ${Math.round(s.approval * 100)}% < ${Math.round(trigger.minApproval * 100)}%` : null
      ].filter(Boolean)
    };
  }

  _factoryId() {
    const urgent = this.town.industry?.mostUrgentProducer?.();
    const product = typeof urgent === 'string' ? urgent : urgent?.product;
    return FACTORY_TYPES.find((row) => row.product === product)?.id || FACTORY_TYPES.find((row) => row.id === 'steelworks')?.id || FACTORY_TYPES[0]?.id;
  }

  _templatePlan(template, offer) {
    const t = this.town;
    if (template.planType === 'factory') {
      return planFor(t, 'factory', {
        factory: offer.factoryType,
        owner: 'private',
        acquire: false,
        need: 1
      });
    }
    if (template.planType === 'road') return planFor(t, 'road', {});
    if (template.planType === 'transit') {
      return planFor(t, 'civic', { facility: 'busdepot', acquire: false });
    }
    if (template.planType === 'power') return planFor(t, 'power', {});
    return null;
  }

  _draftOffer(investor, template, day, index) {
    const t = this.town;
    const offer = {
      id: `fdi-offer-${day}-${index}`,
      investorId: investor.id,
      investor: investor.label,
      projectId: template.id,
      project: template.label,
      kind: template.kind,
      investment: template.investment,
      jobs: template.jobs,
      taxPerDay: template.taxPerDay,
      infrastructure: template.infrastructure,
      factoryType: template.planType === 'factory' ? this._factoryId() : null,
      status: 'offered',
      createdDay: day,
      expiresDay: day + this.rules.triggers.offerExpiryDays,
      risk: investor.risk,
      taxRate: investor.taxRate,
      repatriationRate: investor.repatriationRate
    };
    const plan = this._templatePlan(template, offer);
    if (!plan) {
      offer.feasible = false;
      offer.reason = 'project type is not available in this build';
      return offer;
    }
    plan.commissionedBy = 'developer';
    plan.financingSector = 'developer';
    plan.foreignInvestorId = investor.id;
    plan.foreignProjectId = offer.id;
    const quoted = t.growth?.quote?.(plan);
    offer.feasible = !!quoted?.ok;
    offer.reason = quoted?.ok ? '' : quoted?.reason || t.growth?.lastBlock || 'no legal site or capacity';
    if (quoted?.ok) {
      offer.quotedCost = round(quoted.quote?.finalCost || plan.cost);
      offer.buildHours = round(quoted.quote?.buildHours || plan.hours);
    }
    return offer;
  }

  refresh(day = this.town.clockDay || 0, { force = false } = {}) {
    const currentDay = Number(day) || 0;
    const cadence = this.rules.triggers.offerCadenceDays;
    this.offers = this.offers.filter((offer) => offer.status !== 'offered' || offer.expiresDay >= currentDay);
    if (this.offers.some((offer) => offer.status === 'offered')) return this.offers;
    if (!force && currentDay - this.lastOfferDay < cadence) return this.offers;
    if (!force && this.projects.filter((p) => ['under-construction', 'operating'].includes(p.status)).length >= this.rules.triggers.maxActive) return this.offers;
    const eligible = this._eligible();
    if (!force && !eligible.ok) return this.offers;
    const offerNumber = this.nextOffer++;
    let offer = null;
    // Prefer a legal, measurable project. A single infeasible template must
    // never occupy the only offer slot for a sitting (the old round-robin
    // would repeatedly present a logistics hub when no congestion corridor
    // existed, making FDI look broken even though an industrial or utility
    // project could start).
    const state = eligible.state;
    const score = (template) => {
      if (template.kind === 'industry') return state.industryPressure * 3;
      if (template.kind === 'infrastructure') return state.congestion * 3;
      if (template.kind === 'transit') return state.congestion * 2 + state.population / 500;
      if (template.kind === 'utility') {
        const strained = this.town.resources?.stats?.()?.strained?.length || 0;
        return strained * 2 + state.population / 1000;
      }
      return 0;
    };
    const templates = this.rules.projects
      .map((template, index) => ({ template, index }))
      .sort((a, b) => score(b.template) - score(a.template) || a.index - b.index);
    for (let i = 0; i < templates.length; i++) {
      const template = templates[i].template;
      const investor = this.rules.investors.find((row) => row.sectors?.includes(template.kind))
        || this.rules.investors[(offerNumber + i) % this.rules.investors.length];
      const candidate = this._draftOffer(investor, template, currentDay, offerNumber);
      if (!offer || candidate.feasible) offer = candidate;
      if (candidate.feasible) break;
    }
    this.offers.push(offer);
    this.lastOfferDay = currentDay;
    return this.offers;
  }

  availableOffers({ force = false } = {}) {
    this.refresh(this.town.clockDay || 0, { force });
    return this.offers.filter((offer) => offer.status === 'offered').map((offer) => ({ ...offer }));
  }

  solicit(params = {}) {
    const offers = this.availableOffers();
    const selected = params.offerId
      ? offers.find((offer) => offer.id === params.offerId)
      : offers.find((offer) => offer.feasible) || offers[0];
    if (!selected) return { ok: false, reason: this._eligible().reasons.join('; ') || 'no investor offer available' };
    return {
      ok: true,
      offer: selected,
      detail: `${selected.investor} offers ${selected.project}${selected.factoryType ? ` (${selected.factoryType})` : ''}; ${selected.feasible ? 'ready for approval' : `blocked: ${selected.reason}`}`
    };
  }

  approve(offerId = null) {
    const day = Number(this.town.clockDay) || 0;
    this.refresh(day);
    const offer = this.offers.find((row) => row.status === 'offered' && (!offerId || row.id === offerId));
    if (!offer) return { ok: false, reason: 'no matching FDI offer' };
    if (!offer.feasible) {
      this.totals.blocked++;
      return { ok: false, reason: offer.reason || 'offer has no legal project site' };
    }
    if (this.projects.filter((p) => ['under-construction', 'operating'].includes(p.status)).length >= this.rules.triggers.maxActive)
      return { ok: false, reason: 'foreign project cap reached' };
    const template = this.rules.projects.find((row) => row.id === offer.projectId);
    const plan = this._templatePlan(template, offer);
    if (!plan) return { ok: false, reason: 'project plan unavailable' };
    plan.commissionedBy = 'developer';
    plan.financingSector = 'developer';
    plan.foreignInvestorId = offer.investorId;
    plan.foreignProjectId = offer.id;
    const quoted = this.town.growth?.quote?.(plan);
    if (!quoted?.ok) {
      offer.feasible = false;
      offer.reason = quoted?.reason || this.town.growth?.lastBlock || 'site became unavailable';
      this.totals.blocked++;
      return { ok: false, reason: offer.reason };
    }
    const capital = Math.max(offer.investment, round(quoted.quote?.finalCost || plan.cost));
    const eco = this.town.economy;
    const funding = eco.transfer({
      from: 'external', to: 'developer', amount: capital, category: 'foreign_investment',
      metadata: { foreignInvestorId: offer.investorId, foreignProjectId: offer.id, projectType: template.planType }
    });
    if (!funding.ok) return { ok: false, reason: funding.reason || 'foreign capital transfer failed' };
    const permit = eco.transfer({
      from: 'external', to: 'government', amount: Math.max(1, round(capital * 0.08)), category: 'permit_fee',
      metadata: { foreignInvestorId: offer.investorId, foreignProjectId: offer.id, projectType: template.planType }
    });
    if (!permit.ok) {
      eco.transfer({ from: 'developer', to: 'external', amount: capital, category: 'project_reversal', metadata: { foreignProjectId: offer.id } });
      return { ok: false, reason: permit.reason || 'concession fee failed' };
    }
    const applied = this.town.growth.apply(plan);
    if (!applied) {
      eco.transfer({ from: 'developer', to: 'external', amount: capital, category: 'project_reversal', metadata: { foreignProjectId: offer.id } });
      eco.transfer({ from: 'government', to: 'external', amount: permit.transaction.amount, category: 'project_reversal', metadata: { foreignProjectId: offer.id } });
      this.totals.blocked++;
      offer.reason = this.town.growth.lastBlock || 'project could not start';
      return { ok: false, reason: offer.reason };
    }
    offer.status = 'approved';
    const project = {
      id: `fdi-project-${this.nextProject++}`,
      offerId: offer.id,
      investorId: offer.investorId,
      investor: offer.investor,
      project: offer.project,
      kind: offer.kind,
      planType: template.planType,
      factoryType: offer.factoryType,
      capital,
      jobs: offer.jobs,
      taxPerDay: offer.taxPerDay,
      infrastructure: offer.infrastructure,
      status: applied.status === 'started' ? 'under-construction' : 'operating',
      constructionProjectId: plan.projectId || null,
      approvedDay: day,
      taxPaid: 0,
      repatriated: 0
    };
    this.projects.push(project);
    this.totals.capitalCommitted += capital;
    this.totals.capitalInflow += capital;
    this.totals.jobsCreated += offer.jobs;
    this.totals.infrastructure += offer.infrastructure;
    return { ok: true, offer, project, applied };
  }

  _operate(project, day) {
    if (project.status !== 'operating') return;
    const tax = Math.max(0, Number(project.taxPerDay) || 0);
    if (tax) {
      const paid = this.town.economy.transfer({
        from: 'external', to: 'government', amount: tax, category: 'foreign_tax',
        metadata: { foreignInvestorId: project.investorId, foreignProjectId: project.id }
      });
      if (paid.ok) { project.taxPaid += tax; this.totals.taxRevenue += tax; }
    }
    // Repatriation is bounded by actual developer cash. It models the return
    // expected by an investor without allowing an external dividend to mint
    // a second local balance or starve construction payroll.
    if (day > project.approvedDay && day % 7 === 0) {
      const investor = this.rules.investors.find((row) => row.id === project.investorId);
      const desired = Math.min(project.taxPerDay * (investor?.repatriationRate || 0), Math.max(0, this.town.economy.accounts.developer.cash - 50000));
      if (desired > 0) {
        const paid = this.town.economy.transfer({ from: 'developer', to: 'external', amount: desired, category: 'dividend', metadata: { foreignInvestorId: project.investorId, foreignProjectId: project.id } });
        if (paid.ok) { project.repatriated += desired; this.totals.repatriated += desired; }
      }
    }
  }

  update(_dt, clock = null) {
    const day = Number(clock?.day ?? this.town.clockDay) || 0;
    if (this.lastTickDay === day) return;
    this.lastTickDay = day;
    for (const project of this.projects) {
      if (project.status === 'under-construction' && project.constructionProjectId) {
        const state = this.town.growth.projectState(project.constructionProjectId);
        if (state?.state === 'COMPLETED') {
          project.status = 'operating';
          this.totals.completed++;
        }
        else if (state?.state?.startsWith('FAILED')) project.status = 'failed';
      }
      this._operate(project, day);
    }
    this.refresh(day);
  }

  stats() {
    const offers = this.offers.filter((offer) => offer.status === 'offered');
    const active = this.projects.filter((project) => ['under-construction', 'operating'].includes(project.status));
    return {
      enabled: true,
      offers: offers.map((offer) => ({ ...offer })),
      active: active.map((project) => ({ ...project })),
      completed: this.totals.completed,
      investors: this.rules.investors.map((investor) => ({ id: investor.id, label: investor.label })),
      capitalCommitted: round(this.totals.capitalCommitted),
      capitalInflow: round(this.totals.capitalInflow),
      taxRevenue: round(this.totals.taxRevenue),
      repatriated: round(this.totals.repatriated),
      jobsCreated: round(this.totals.jobsCreated),
      infrastructure: round(this.totals.infrastructure),
      activeProjects: active.length,
      maxActive: this.rules.triggers.maxActive,
      lastError: this.lastError
    };
  }

  serialize() {
    return { offers: this.offers, projects: this.projects, nextOffer: this.nextOffer, nextProject: this.nextProject, lastOfferDay: this.lastOfferDay, lastTickDay: this.lastTickDay, totals: this.totals };
  }

  restore(saved = {}) {
    this.offers = Array.isArray(saved.offers) ? saved.offers.map((row) => ({ ...row })) : [];
    this.projects = Array.isArray(saved.projects) ? saved.projects.map((row) => ({ ...row })) : [];
    this.nextOffer = Math.max(1, Number(saved.nextOffer) || 1);
    this.nextProject = Math.max(1, Number(saved.nextProject) || 1);
    this.lastOfferDay = Number.isFinite(saved.lastOfferDay) ? saved.lastOfferDay : -Infinity;
    this.lastTickDay = Number.isFinite(saved.lastTickDay) ? saved.lastTickDay : null;
    this.totals = { ...this.totals, ...(saved.totals || {}) };
    return { ok: true };
  }
}
