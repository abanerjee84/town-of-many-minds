import { SIM, FOUNDING_POPULATION } from '../core/config.js';
import { events } from '../core/events.js';
import {
  createProfile,
  refreshStage,
  pushHistory,
  needsTick,
  stageLabel,
  scheduleFor,
  setJob
} from '../kits/citizens/citizenProfile.js';
import { rollJob } from '../kits/citizens/personality.js';
import { ageScale } from '../kits/citizens/citizenKit.js';
import { resourceStress, SITE_CREW, CREW_ROLES } from '../kits/resources/resourceKit.js';
import { civicLoads } from './growth.js';
import rules from '../data/lifecycleRules.json' with { type: 'json' };

const MIN_AGE_WORK = rules.age.work;
const MIN_AGE_PARTNER = rules.age.partner;
const MIN_AGE_PARENT = rules.age.parent;
const MAX_AGE_PARENT = rules.age.maxParent;
const RETIRE_AGE = rules.age.retire;

/**
 * A7 — the housing target. 0.9, not 1.0: a town that fills every last bed has
 * no room for the household forming, and the Day-81 churn came from a target
 * that could be overshot and then bled.
 */
const BED_FILL = rules.housing.bedFill;
/** Spare beds per head that saturate the "there is room here" term. */
const ROOM_PULL = rules.housing.roomPull;
/** Open posts per head that saturate the "there is work here" term. */
const WORK_PULL = rules.housing.workPull;
/** The most who may arrive in a day, however loud the campaign. */
const MAX_ARRIVALS = rules.maxArrivals;

function hasHigherEducation(town) {
  const load = civicLoads(town).find((row) => row.kind === 'tertiary');
  // A tertiary building is a real progression resource: a cohort can graduate
  // while the campus has headroom, but the council must add seats before the
  // next cohort is admitted. Existing adult profiles may already carry a
  // tertiary credential from before the first campus was built.
  return !!load && load.capacity > 0 && load.load < 1.15;
}

/** A3 — ATTRACT_SETTLERS. A campaign is a dated multiplier on `pull()`. */
export const CAMPAIGN = Object.freeze({ ...rules.campaign });

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class LifecycleSystem {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(501);
    // One day per year aged everyone a full year per game day: founders died
    // of old age inside ~80 days and the fertile window (partner at 20, parent
    // until 45) lasted days, so age-deaths outran births (Day-81: 39 died vs
    // 21 born) and only immigration kept the town alive. A quarter year per
    // day keeps generational turnover visible without the death wave.
    this.yearsPerDay = rules.yearsPerDay;
    this.pendingYears = 0;
    this.lastDay = 1;
    this.tallies = { born: 0, died: 0, movedIn: 0, movedOut: 0, partnered: 0, retired: 0 };
    this.recent = [];
    this.illnessHours = 0;
    // Resource pressure: mood target, need drain and illness odds all read it.
    this.resStress = null;
    this.stressAcc = 99;
  }

  reset() {
    this.pendingYears = 0;
    this.lastDay = 1;
    this.tallies = { born: 0, died: 0, movedIn: 0, movedOut: 0, partnered: 0, retired: 0 };
    this.recent = [];
    this.illnessHours = 0;
    this.resStress = null;
    this.stressAcc = 99;
    // Phase 15 — written only by PolicySystem; zero here because a new town
    // carries no statutes.
    this.pullBonus = 0;
    this.leaveBonus = 0;
    // A3 — the settler campaign, dated against the game's own day counter.
    this.campaignDays = 0;
    this.campaignMult = 1;
    this.campaignFrom = 0;
    this.campaignDay = 0;
    this.campaignsRun = 0;
  }

  note(text) {
    this.recent.push(text);
    if (this.recent.length > 8) this.recent.shift();
    events.emit('log', { text });
  }

  totalResidentialCapacity() {
    let cap = 0;
    for (const b of this.town.buildings) if (b.kind === 'house') cap += b.capacity || 2;
    return cap;
  }

  /**
   * Public-service posts are tied to the building's real floor area. Civic
   * capacity (students, patients, visitors) is not a payroll number, so it
   * must not be used as a staffing divisor. Keep one authoritative count of
   * adult workers standing at each civic building for the HUD, migration pull,
   * and HIRE_WORKERS to share.
   */
  civicStaffing() {
    const t = this.town;
    const eco = t.economy;
    const citizens = t.pedestrians?.citizens || [];
    const rows = [];
    for (const building of t.buildings || []) {
      if (building.kind !== 'civic') continue;
      const need = eco?.staffNeeded ? eco.staffNeeded(building) : 1;
      const have = citizens.filter((c) =>
        c.work === building &&
        c.p?.job?.work === 'civic' &&
        c.p?.job?.id !== 'student' &&
        c.p?.job?.id !== 'retired' &&
        c.p?.age >= MIN_AGE_WORK &&
        c.p?.age < RETIRE_AGE
      ).length;
      rows.push({
        building,
        facility: building.facility || building.house?.spec?.facility || 'civic',
        need,
        have,
        open: Math.max(0, need - have)
      });
    }
    const total = rows.reduce((n, row) => n + row.need, 0);
    const filled = rows.reduce((n, row) => n + Math.min(row.need, row.have), 0);
    return { rows, total, filled, open: Math.max(0, total - filled) };
  }

  /**
   * Posts on offer, COUNTED from the businesses and sited crews that already
   * exist — never estimated. Businesses and site crews are both staff-gap
   * driven (Phase 11), so this is the same number HIRE_WORKERS closes.
   * `filled` is how many of them are already taken.
   */
  jobPosts() {
    const t = this.town;
    let total = 0;
    let filled = 0;
    const eco = t.economy;
    if (eco && eco.businesses) {
      for (const z of eco.businesses) {
        // `??`, not `||`: a business whose need is genuinely ZERO must not
        // fall through to staffNeeded() and re-invent one.
        const need = z.staffNeed ?? (eco.staffNeeded ? eco.staffNeeded(z.building) : 0);
        total += need;
        filled += Math.min(need, z.employees || 0);
      }
    }
    const res = t.resources;
    if (res && res.staffCounts) {
      const want = Object.fromEntries(CREW_ROLES.map((r) => [r, 0]));
      for (const s of res.sites || []) {
        const rule = SITE_CREW[s.work];
        if (rule) want[s.work] += rule.crew;
      }
      const have = res.staffCounts();
      for (const r of CREW_ROLES) {
        total += want[r];
        filled += Math.min(want[r], have[r] || 0);
      }
    }
    const civic = this.civicStaffing();
    total += civic.total;
    filled += civic.filled;
    return { total, filled, open: Math.max(0, total - filled) };
  }

  /** Unfilled posts only — the gap HIRE_WORKERS closes. */
  jobOpenings() {
    return this.jobPosts().open;
  }

  /**
   * A7 — the population band, DERIVED from the town's own capacity. There is
   * no target number anywhere in this file: the ceilings below are each read
   * off a live subsystem, and the target is their minimum.
   *
   *   beds  — housing, at BED_FILL occupancy rather than a jammed 100%
   *   civic — the population at which the services sit exactly at capacity
   *           (pop × capacity ÷ demand); no demand yet means no ceiling
   *   SIM   — the hard population ceiling
   *
   * Work is NOT a ceiling: people commute. It is a *desirability* term in
   * `pull()` instead, which is the honest place for it.
   */
  stability() {
    const t = this.town;
    const pop = t.pedestrians.citizens.length;
    const beds = this.totalResidentialCapacity();
    const spareBeds = Math.max(0, beds - pop);
    const posts = this.jobPosts();

    let civicDemand = 0;
    let civicCapacity = 0;
    for (const l of civicLoads(t)) {
      civicDemand += l.demand;
      civicCapacity += l.capacity;
    }
    const civicCeiling = civicDemand > 0 ? Math.round((pop * civicCapacity) / civicDemand) : null;

    const bedCeiling = Math.round(beds * BED_FILL);
    const hard = Math.min(SIM.maxCitizens, bedCeiling, civicCeiling === null ? Infinity : civicCeiling);
    // The founding contract gives the hamlet exactly FOUNDING_POPULATION beds.
    // Applying the normal 90% fill band on day one immediately labelled that
    // valid state overcrowded (30 people against a 27-person target), causing
    // departures before the council had a chance to add housing. Keep the
    // founding floor until earned capacity moves the band above it; later
    // growth still uses BED_FILL and therefore retains breathing room.
    const target = Math.max(FOUNDING_POPULATION, Math.max(0, Math.round(hard)));
    const mood = t.pedestrians.averageMood ? t.pedestrians.averageMood() : 0.5;

    return {
      population: pop,
      target,
      beds,
      spareBeds,
      bedCeiling,
      civicCeiling: civicCeiling,
      civicDemand: Math.round(civicDemand),
      civicCapacity: Math.round(civicCapacity),
      posts: posts.total,
      openings: posts.open,
      mood: Math.round(mood * 100) / 100,
      // 1 well below the band, 0 at it, negative over it.
      headroom: target > 0 ? Math.round(((target - pop) / Math.max(1, target)) * 100) / 100 : 0,
      campaign: this.campaign,
      pull: this.pull()
    };
  }

  /**
   * A3 — the pull that already decides whether a stranger moves here, made
   * explicit so the council can act on it. Three desirability terms, each 0..1
   * and each read off live state, combined as the WEAKEST link (a town with
   * beds but no work is not attractive), then scaled by mood and by any
   * running campaign.
   *
   *   room    — spare beds, saturating at ROOM_PULL beds free per head
   *   work    — POSTS ON OFFER, saturating at WORK_PULL per head. Not
   *             vacancies: a mover asks whether there is work here, and a
   *             fully-employed town is a working town, not an unattractive one.
   *             (An earlier version used unfilled posts and deadlocked — a
   *             settled town has no vacancies, so its pull was permanently 0
   *             and nobody ever arrived.)
   *   service — civic headroom: 1 while every facility is under capacity,
   *             falling as the worst one goes over
   */
  pull() {
    const t = this.town;
    const pop = Math.max(1, t.pedestrians.citizens.length);
    const beds = this.totalResidentialCapacity();
    const room = Math.min(1, Math.max(0, beds - pop) / (pop * ROOM_PULL));
    const work = Math.min(1, this.jobPosts().total / (pop * WORK_PULL));

    const loads = civicLoads(t);
    let service = 1;
    if (loads.length) {
      const worst = Math.max(...loads.map((l) => l.load));
      // At or under capacity the town is as attractive as it can be; past it
      // each extra 1.0 of overload on the worst facility costs the pull.
      service = Math.max(0, 1 - Math.max(0, worst - 1));
    }

    const mood = t.pedestrians.averageMood ? t.pedestrians.averageMood() : 0.5;
    const base = Math.min(room, work, service) * (0.3 + 0.7 * mood);
    return Math.round(base * this.campaign * 100) / 100;
  }

  /**
   * A3 — ATTRACT_SETTLERS. A campaign is a paid, dated multiplier on the pull
   * above: it changes what newcomers hear about the town, not the housing.
   */
  startCampaign({ cost, days, multiplier }) {
    if (this.town.economy) {
      const paid = this.town.economy.transfer({
        from: 'government', to: 'contractor', amount: cost,
        category: 'government_procurement', metadata: { purpose: 'settler_campaign' }
      });
      if (!paid.ok) return { ok: false, reason: paid.reason };
    }
    this.campaignDays = days;
    this.campaignMult = multiplier;
    this.campaignFrom = this.campaignDay || 0;
    events.emit('log', { kind: 'event',
      text: `A ${days}-day settler campaign opens — the town is advertised ×${multiplier}.` });
    return { days, multiplier, cost };
  }

  endCampaign(why) {
    const had = this.campaignDays > 0;
    this.campaignDays = 0;
    this.campaignMult = 1;
    if (had) events.emit('log', { kind: 'event', text: why || 'The settler campaign closes.' });
    return had;
  }

  /** Campaign multiplier in force right now, from the calendar. */
  get campaign() {
    if (!this.campaignDays) return 1;
    if (this.campaignDay - this.campaignFrom >= this.campaignDays) return 1;
    return this.campaignMult || 1;
  }

  targetPopulation() {
    return this.stability().target;
  }

  vacantHomes() {
    // Residential capacities are whole family places (three residents per
    // tile per floor), but keep the floor guard for legacy saved towns whose
    // records may still contain fractional capacities.
    return this.town.buildings.filter(
      (b) => b.kind === 'house' && (!b.household || b.household.members.length < Math.floor(b.capacity || 2))
    );
  }

  update(dt, clock) {
    const hours = dt / (SIM.secondsPerGameMinute * 60);
    if (hours <= 0) return;

    // Refresh the resource-stress reading at least once an hour of game time.
    this.stressAcc += hours;
    if (this.stressAcc >= 1) {
      this.stressAcc = 0;
      this.resStress = this.town.resources && this.town.resources.stats
        ? resourceStress(this.town.resources.stats())
        : null;
      // Empty shelves worry citizens too — blend goods shortage into the
      // overall reading (a no-op while the storehouse is stocked).
      const gs = this.town.industry ? this.town.industry.goodsStress() : 0;
      if (this.resStress && gs > 0) {
        this.resStress = {
          ...this.resStress,
          goods: gs,
          overall: Math.min(1, this.resStress.overall * 0.75 + gs * 0.25)
        };
      }
    }
    const rs = this.resStress;

    for (const c of this.town.pedestrians.citizens) {
      needsTick(c.p, hours, rs);
      c.mood = clamp(
        c.mood * 0.9 + (0.35 + c.p.needs.energy * 0.3 + c.p.needs.fullness * 0.2 + c.p.sociability * 0.1 * c.p.needs.social - (rs ? rs.overall * 0.5 : 0)) * 0.1,
        0,
        1
      );
    }

    this.pendingYears += (hours / 24) * this.yearsPerDay;
    if (this.pendingYears >= 1) {
      const whole = Math.floor(this.pendingYears);
      this.pendingYears -= whole;
      this.tick(whole);
    }

    this.illnessHours += hours;
    if (this.illnessHours >= 4) {
      this.illnessHours -= 4;
      this.illnessTick();
    }

    if (clock && clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      this.onDay();
    }
  }

  tick(years = 1) {
    const citizens = this.town.pedestrians.citizens.slice();
    for (const c of citizens) {
      if (!c.p) continue;
      const before = c.p.age;
      c.p.age += years;
      this.progress(c, before, years);
      // Keep the rendered body in step with the birthday: newborns start at
      // half scale and grow to full size by 18.
      if (c.group) c.group.scale.setScalar(ageScale(c.p.age));
    }
    this.repopulate();
  }

  /**
   * A7 — one day of population movement. Every branch reads the derived band,
   * and the flows DAMP rather than switch:
   *
   *   over the band          → one departure
   *   well under the band    → arrivals, scaled by `pull()` and by how much
   *                            headroom is left (so the town eases in and
   *                            tapers off as it reaches the target)
   *   inside the band        → the ordinary turnover, thinned as the town
   *                            fills up
   *
   * The Day-81 churn (+32 in, 14 out against a target it kept overshooting) is
   * what the damping is for: a town now moves toward its band instead of
   * oscillating through it.
   */
  onDay() {
    const st = this.stability();
    const pop = st.population;
    this.campaignDay = (this.campaignDay || 0) + 1;
    if (this.campaign && this.campaign === 1 && this.campaignDays) {
      this.endCampaign('The settler campaign runs its course.');
    }

    if (pop > st.target * 1.15) {
      this.emigrate();
      return;
    }
    // Phase 15 — a scheme or statute with `immigrationPull` widens the gap the
    // town tolerates before it seeks newcomers.
    // Keep admitting while the town is approaching its measured capacity. The
    // old 75% gate permanently parked a healthy settlement at three quarters
    // of its own target, which is why long runs never reached the civic and
    // education milestones that the council had already earned.
    const gate = 0.98 - (this.pullBonus || 0);
    if (pop < st.target * gate) {
      this.admitSettlers(st);
      return;
    }
    this.emigrateDiscontent(st);
  }

  /**
   * How many arrive today: the pull, damped by the headroom left. Returns
   * `{ want, n, got }` — `want` is what the band asked for, `n` that figure
   * under the daily cap, and `got` what the town actually had room for. The
   * gap between `n` and `got` is usually the housing.
   */
  admitSettlers(st = this.stability()) {
    // Full while the town is a full fifth below its target, tapering to a
    // trickle as it arrives — so it eases in and does not slam the ceiling.
    const room = clamp((st.headroom * 5 + 0.2) / 1.2, 0, 1);
    const want = st.pull > 0 && st.headroom > 0
      ? Math.ceil(st.pull * (0.5 + 1.5 * room) * 2)
      : 0;
    const n = Math.max(0, Math.min(MAX_ARRIVALS, want));
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!this.immigrate()) break;
      got++;
    }
    this.lastAdmission = { want, n, got, day: this.campaignDay || 0 };
    return this.lastAdmission;
  }

  /**
   * Someone falls ill now and then: the condition is what the ambulance
   * watches for, and health slides while it lasts. Ticked every few game
   * hours so a call can turn up within the first day.
   */
  illnessTick() {
    const rng = this.rng;
    const s = this.resStress ? this.resStress.overall : 0;
    for (const c of this.town.pedestrians.citizens) {
      const p = c.p;
      if (!p) continue;
      const conds = p.conditions || (p.conditions = []);
      if (conds.includes('ill')) {
        // Scarcity weakens recovery — rationing keeps the sick sick longer.
        if (rng.chance(0.34 * (1 - 0.45 * s))) {
          p.conditions = conds.filter((x) => x !== 'ill');
          p.health = clamp(p.health + 0.18, 0, 1);
          pushHistory(p, 'Recovered.');
        } else {
          p.health = clamp(p.health - 0.05, 0, 1);
        }
        continue;
      }
      if (rng.chance(0.007 * (1 + 1.2 * s)) && p.health < 0.96) {
        conds.push('ill');
        p.health = clamp(p.health - 0.1, 0, 1);
        pushHistory(p, 'Fell ill.');
        this.note(`${p.name} has fallen ill.`);
      }
    }
  }

  progress(c, prevAge, years) {
    const p = c.p;
    const rng = this.rng;
    const crossed = (at) => prevAge < at && p.age >= at;

    if (p.age >= 6 && p.education.level === 'none') {
      p.education.level = 'primary';
      p.education.years = 5;
      pushHistory(p, 'Started school.');
      this.note(`${p.name} starts school.`);
    }
    if (p.education.level === 'primary' && p.age >= 13) {
      p.education.level = 'secondary';
      p.education.years = 12;
      pushHistory(p, p.age < 20 ? 'Began secondary school.' : 'Finished secondary school.');
    }
    if (
      p.education.level === 'secondary' &&
      p.age >= 22 &&
      hasHigherEducation(this.town) &&
      rng.chance(0.45 * years)
    ) {
      p.education.level = 'tertiary';
      p.education.years = 16;
      p.intelligence = clamp(p.intelligence + 0.1, 0, 1);
      p.skills.push({ id: 'analysis', level: rng.float(0.5, 0.95) });
      pushHistory(p, `Graduated college · ${p.education.field}.`);
      this.note(`${p.name} graduates college.`);
    }

    if (refreshStage(p)) {
      pushHistory(p, `Entered ${stageLabel(p.age).toLowerCase()} stage.`);
    }

    if (
      p.age >= MIN_AGE_WORK &&
      p.age < RETIRE_AGE &&
      p.education.level !== 'none' &&
      p.job.id === 'student'
    ) {
      this.findJob(c);
    }

    if (crossed(RETIRE_AGE) && p.job.id !== 'retired') {
      p.job = { id: 'retired', label: 'Retired', work: 'home' };
      p.schedule = scheduleFor(p.job.id, p.stage);
      p.income = Math.round(18000 * this.rng.float(0.7, 1.2));
      c.work = null;
      p.employmentStatus = 'not_in_labor_force';
      pushHistory(p, 'Retired from work.');
      this.tallies.retired++;
      this.note(`${p.name} retires after a lifetime of work.`);
    }

    if (p.age >= MIN_AGE_PARTNER && p.age < 60 && !p.relationships.partner) {
      const rate = p.age < 40 ? 0.14 : 0.05;
      if (rng.chance(rate * years)) this.formPartnership(c);
    }

    if (
      p.relationships.partner &&
      p.age >= MIN_AGE_PARENT &&
      p.age <= MAX_AGE_PARENT &&
      p.relationships.children.length < 2 &&
      rng.chance(0.16 * years)
    ) {
      this.giveBirth(c);
    }

    if (p.age > 60) {
      const decline = (p.age - 60) * 0.0016 * years * (1.35 - p.physicalTraits.fitness);
      p.health = clamp(p.health - decline, 0, 1);
      if (p.health < 0.45 && !p.conditions.includes('frail')) {
        p.conditions.push('frail');
        pushHistory(p, 'Health is failing.');
      }
    }

    if (p.age >= p.genetics.longevity || (p.age > 68 && p.health <= 0.05)) {
      this.die(c);
      return;
    }

    // Demographic ageing is intentionally independent from the economic
    // clock. Cash, income and saving settle in EconomySystem's daily tick.
  }

  findJob(c) {
    const p = c.p;
    // The job pool is the citizen's own education path — no fixed id list, no
    // flat 28000 wage (setJob derives income from the wage table).
    const job = rollJob(this.rng, p.education?.level || 'none');
    if (!job || !setJob(p, job.id, this.rng)) return false;
    this.town.pedestrians.assignWork(c);
    this.note(`${p.name} starts a new job as ${p.job.label}.`);
    return true;
  }

  formPartnership(c) {
    const p = c.p;
    const others = this.town.pedestrians.citizens.filter((o) => {
      if (o === c || !o.p.relationships) return false;
      if (o.p.relationships.partner || o.p.age < MIN_AGE_PARTNER || o.p.age > 62) return false;
      if (Math.abs(o.p.age - p.age) > 14) return false;
      if (o.household && o.household === c.household) return false;
      return true;
    });
    if (!others.length) return;
    const other = others[Math.floor(this.rng.next() * others.length)];
    p.relationships.partner = other.p.name;
    other.p.relationships.partner = p.name;
    p.relationships.friends.push(other.p.id);
    other.p.relationships.friends.push(p.id);
    this.tallies.partnered++;

    const keep = this.rng.chance(0.5) ? c : other;
    const move = keep === c ? other : c;
    if (move.home && keep.home) this.town.pedestrians.moveToHome(move, keep.home);

    pushHistory(p, `Moved in with ${other.p.name}.`);
    pushHistory(other.p, `Moved in with ${p.name}.`);
    this.note(`${p.name} and ${other.p.name} move in together.`);
  }

  giveBirth(c) {
    const ped = this.town.pedestrians;
    if (ped.citizens.length >= SIM.maxCitizens) return;
    const partner = ped.citizens.find((o) => o.p.name === c.p.relationships.partner);
    const home = c.home || (partner && partner.home);
    if (!home) return;
    if (home.household && home.household.members.length >= (home.capacity || 2)) return;

    const mother = partner && partner.p.age < c.p.age ? partner : c;
    const father = partner ? (mother === c ? partner : c) : null;
    const parents = father ? [mother.p, father.p] : null;
    const surname = mother.p.last || mother.p.surname;
    const profile = createProfile(this.rng, {
      age: 0,
      surname,
      parents
    });
    const baby = ped.addCitizen(profile, home);
    if (!baby) return;

    mother.p.relationships.children.push(profile.id);
    if (father) father.p.relationships.children.push(profile.id);
    profile.relationships.children = [];
    this.tallies.born++;

    const name = profile.first;
    pushHistory(mother.p, `Welcomed ${name}.`);
    if (father) pushHistory(father.p, `Welcomed ${name}.`);
    pushHistory(profile, 'Born into the world.');
    this.note(`${name} ${surname} is born — the household grows.`);
  }

  die(c) {
    const p = c.p;
    const ped = this.town.pedestrians;
    const partner = ped.citizens.find((o) => o.p.relationships && o.p.relationships.partner === p.name);
    if (partner) {
      if (this.town.economy) this.town.economy.inherit(c, partner);
      partner.p.relationships.partner = null;
      pushHistory(partner.p, `Lost ${p.name}.`);
    }
    for (const id of p.relationships.children || []) {
      const child = ped.citizens.find((o) => o.p.id === id);
      if (child) pushHistory(child.p, `Lost a parent.`);
    }
    if (!partner && this.town.economy) {
      const heir = (p.relationships.children || [])
        .map((id) => ped.citizens.find((other) => other.p.id === id))
        .find(Boolean);
      if (heir) this.town.economy.inherit(c, heir);
      else if ((p.cash || 0) > 0) {
        this.town.economy.transfer({
          from: { sector: 'household', id: p.id }, to: 'government', amount: p.cash,
          category: 'inheritance', metadata: { estateId: p.id, heirId: 'government' }
        });
      }
    }

    if (c.household) {
      const h = c.household;
      h.members = h.members.filter((m) => m !== c);
      h.size = h.members.length;
      if (h.members.length === 0) ped.releaseHousehold(h);
    }

    const at = p.age >= 70 ? 'passed away peacefully' : 'died too soon';
    this.tallies.died++;
    ped.remove(c);
    this.note(`${p.name}, ${Math.round(p.age)}, ${at}.`);
  }

  immigrate(opts = {}) {
    const ped = this.town.pedestrians;
    if (ped.citizens.length >= SIM.maxCitizens) return false;
    const homes = this.vacantHomes();
    if (!homes.length) return false;
    const home = homes[Math.floor(this.rng.next() * homes.length)];
    const profile = createProfile(this.rng, {
      age: opts.age || this.rng.int(19, 48),
      job: opts.job || undefined
    });
    const agent = ped.addCitizen(profile, home);
    if (!agent) return false;
    if (this.town.economy) {
      this.town.economy.recordMigration(agent, 'in');
      // An arriving household banks part of what it brought, same as a founding
      // one — otherwise newcomers would be the only households in town with no
      // savings, and could never buy anything.
      this.town.economy.openFirstAccount(agent);
    }
    this.tallies.movedIn++;
    pushHistory(
      profile,
      opts.job ? 'Moved to town for the work.' : 'Moved to town seeking a fresh start.'
    );
    this.note(`${profile.name} moves to town and settles at ${profile.last} Lane.`);
    return true;
  }

  emigrate(pool) {
    const ped = this.town.pedestrians;
    if (!pool) {
      pool = ped.citizens.filter(
        (c) =>
          c.p.age >= 18 &&
          c.p.age < 40 &&
          (!c.p.relationships.children || c.p.relationships.children.length === 0)
      );
      // Small towns rarely hold six childless young adults — without a
      // fallback movedOut could stay at zero forever.
      if (!pool.length) pool = ped.citizens.filter((c) => c.p.age >= 18 && c.p.age < 60);
    }
    if (!pool.length) return false;
    const c = pool[Math.floor(this.rng.next() * pool.length)];
    const name = c.p.name;
    if (this.town.economy) this.town.economy.recordMigration(c, 'out');
    if (c.p.relationships && c.p.relationships.partner) {
      const other = ped.citizens.find((o) => o.p.name === c.p.relationships.partner);
      if (other) other.p.relationships.partner = null;
    }
    if (c.household) {
      const h = c.household;
      h.members = h.members.filter((m) => m !== c);
      h.size = h.members.length;
      // An emptied household is RELEASED, not left registered. This path only
      // filtered the departing member, so the husk stayed in the registry with
      // its building still pointing at it — feeding the HUD's household count,
      // traffic's `households.length * 0.6` demand estimate and the property
      // accounting. `die()` already did this cleanup; emigration did not.
      if (h.members.length === 0) ped.releaseHousehold(h);
    }
    ped.remove(c);
    this.tallies.movedOut++;
    this.note(`${name} moves away in search of bigger horizons.`);
    return true;
  }

  /**
   * Daily turnover: the miserable and jobless leave quickly; content adults
   * still drift away at a small "bigger horizons" rate so movedOut never
   * stalls at zero in a healthy town. Childless-only — a parent leaving
   * would strand the household's child references.
   *
   * A7 — both rates are thinned by how full the town is: a town at its band
   * keeps churning a little, a town overshooting it churns more.
   */
  emigrateDiscontent(st = this.stability()) {
    const pool = this.town.pedestrians.citizens.filter((c) => {
      const p = c.p;
      if (!p || p.age < 18 || p.age >= 60) return false;
      return !p.relationships.children || p.relationships.children.length === 0;
    });
    if (!pool.length) return false;
    // Phase 15 — `emigrationPull` scales both leave rates: below 1 the town
    // holds on to its people, above 1 they drift out faster.
    const pull = 1 + (this.leaveBonus || 0);
    // A7 — fill damping: 1 at the band, rising as the town overshoots it.
    const fill = st && st.target > 0 ? clamp(1 + (st.population - st.target) / Math.max(1, st.target), 0, 2.5) : 1;
    const unhappy = pool.filter((c) => {
      const p = c.p;
      const jobless = p.age >= 22 && p.job.id === 'student';
      return (c.mood ?? 0.5) < 0.4 || jobless;
    });
    if (unhappy.length) {
      if (!this.rng.chance(Math.min(0.95, 0.35 * pull * fill))) return false;
      return this.emigrate(unhappy);
    }
    if (!this.rng.chance(Math.min(0.95, 0.08 * pull * fill))) return false;
    return this.emigrate(pool);
  }

  repopulate() {
    // The band's own admission path, so the yearly tick and the daily tick
    // cannot disagree about who is allowed to arrive.
    const st = this.stability();
    if (st.population < st.target * 0.85) this.admitSettlers(st);
    else if (st.population > st.target * 1.2) this.emigrate();
  }

  stats() {
    const ped = this.town.pedestrians;
    const stages = {};
    let ageSum = 0;
    for (const c of ped.citizens) {
      const s = c.p.stage || 'adult';
      stages[s] = (stages[s] || 0) + 1;
      ageSum += c.p.age;
    }
    const pop = ped.citizens.length;
    // A3/A7 — the whole band in one object: the derived target, the pull that
    // governs arrivals, and the campaign standing against it.
    const st = this.stability();
    return {
      population: pop,
      target: st.target,
      stability: st,
      pull: st.pull,
      campaign: this.campaign > 1 ? { daysLeft: Math.max(0, this.campaignDays - (this.campaignDay - this.campaignFrom)), multiplier: this.campaign } : null,
      medianAge: pop ? Math.round((ageSum / pop) * 10) / 10 : 0,
      stages,
      ...this.tallies,
      recent: this.recent.slice(-3)
    };
  }
}
