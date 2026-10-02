import { events } from '../core/events.js';
import { needsAverage } from '../kits/citizens/citizenProfile.js';

const NAMES = ['Northbank', 'Civic Quarter', 'East Fields', 'West End', 'South Market', 'Station Ward', 'Riverside', 'Foundry Ward', 'Garden Quarter'];
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));

/** Neighbourhood, safety, justice, mood, approval and election ledger. */
export class SocietySystem {
  constructor(town) {
    this.town = town;
    this.rng = town.rng.fork(9191);
    this.reset();
  }

  reset() {
    this.neighbourhoods = new Map();
    this.crimes = [];
    this.cases = [];
    this.laws = [{ id: 'public-order', label: 'Public order code', active: true, effect: 0.04 }];
    this.elections = [];
    this.mayor = null;
    this.approvalRate = 0.5;
    this.lastDay = -1;
    this.lastElectionDay = 0;
    this.seq = 1;
    this.lastDemolition = null;
  }

  neighbourhoodId(cell) {
    const g = this.town.grid;
    const qx = Math.min(2, Math.floor((cell?.[0] || 0) / Math.max(1, g.w / 3)));
    const qy = Math.min(2, Math.floor((cell?.[1] || 0) / Math.max(1, g.h / 3)));
    return `n-${qx}-${qy}`;
  }

  rebuild() {
    const rows = new Map();
    for (const b of this.town.buildings || []) {
      const id = this.neighbourhoodId(b.cell);
      if (!rows.has(id)) rows.set(id, { id, name: NAMES[rows.size % NAMES.length], cells: [], population: 0, mood: 0.5, crime: 0, safety: 1, approval: 0.5 });
      rows.get(id).cells.push(b.cell);
    }
    for (const c of this.town.pedestrians?.citizens || []) {
      const row = rows.get(this.neighbourhoodId(c.home?.cell));
      if (row) row.population++;
    }
    this.neighbourhoods = rows;
    return [...rows.values()];
  }

  syncLaws() {
    const statutes = this.town.policy?.laws;
    if (!Array.isArray(statutes)) return;
    const publicOrder = this.laws.find((l) => l.id === 'public-order') || { id: 'public-order', label: 'Public order code', active: true, effect: 0.04 };
    this.laws = [publicOrder, ...statutes.map((l) => ({
      id: l.id, label: l.label, active: true, effect: Number(l.effects?.moodTarget || 0)
    }))];
  }

  rowForCitizen(c) { return this.neighbourhoods.get(this.neighbourhoodId(c.home?.cell)); }

  moodProfile(c) {
    const eco = this.town.economy?.stats?.() || {};
    const row = this.rowForCitizen(c);
    const needs = needsAverage(c.p);
    const transport = this.town.transport?.stats?.() || {};
    const safety = row?.safety ?? 0.75;
    const services = clamp(0.45 + (this.town.buildings.filter((b) => b.kind === 'civic').length / Math.max(1, (this.town.pedestrians?.citizens?.length || 1) / 10)) * 0.12);
    const economy = clamp(0.45 + (c.p.employmentStatus === 'employed' ? 0.2 : -0.12) + (eco.unemployment < 12 ? 0.08 : -0.08));
    const belonging = clamp(0.42 + (c.p.preferences?.community || 0) * 0.25 + (c.p.relationships?.friends?.length || 0) * 0.02);
    const transit = transport.ready ? clamp(0.35 + transport.coverage * 0.5) : 0.35;
    const overall = clamp(needs * 0.24 + safety * 0.22 + services * 0.16 + economy * 0.16 + belonging * 0.12 + transit * 0.1 + (c.p.optimism || 0) * 0.08);
    return { overall, safety, services, economy, belonging, transport: transit, needs };
  }

  updateMoods() {
    if (!this.neighbourhoods.size) this.rebuild();
    for (const row of this.neighbourhoods.values()) {
      const residents = (this.town.pedestrians?.citizens || []).filter((c) => this.rowForCitizen(c) === row);
      row.mood = residents.length ? residents.reduce((s, c) => s + (c.p.mood?.overall ?? c.mood ?? 0.5), 0) / residents.length : 0.5;
      const crime = this.crimes.filter((x) => x.neighbourhood === row.id && x.day >= (this.lastDay - 6)).length;
      row.crime = crime;
      row.safety = clamp(0.86 - crime * 0.07 + (this.laws.some((l) => l.id === 'public-order' && l.active) ? 0.04 : 0));
      row.approval = clamp(row.mood * 0.65 + row.safety * 0.35);
    }
    for (const c of this.town.pedestrians?.citizens || []) {
      c.p.mood = this.moodProfile(c);
      c.mood = c.p.mood.overall;
    }
  }

  raiseCrime(day) {
    const rows = [...this.neighbourhoods.values()].filter((r) => r.population > 0);
    if (!rows.length) return null;
    const eco = this.town.economy?.stats?.() || {};
    const risk = clamp(0.12 + (eco.unemployment || 0) / 100 * 0.5 + (1 - this.town.pedestrians.averageMood()) * 0.35 - (this.town.traffic?.mobilityStats?.().congestion || 0) * 0.08);
    if (!this.rng.chance(Math.min(0.55, risk * 0.16))) return null;
    const row = rows[this.rng.int(0, rows.length - 1)];
    const crime = { id: `crime-${this.seq++}`, day, kind: this.rng.chance(0.55) ? 'theft' : 'disturbance', severity: this.rng.chance(0.2) ? 2 : 1, neighbourhood: row.id, status: 'reported', resolvedDay: null, incident: null };
    this.crimes.push(crime);
    const cell = row.cells[0] || this.town.randomRoadCell(this.rng);
    const road = cell ? this.town.nearestRoadCell(cell[0], cell[1]) : null;
    if (road) {
      crime.incident = this.town.incidents?.push({ kind: 'police', cell: road, label: row.name, crimeId: crime.id, text: `A ${crime.kind} is reported in ${row.name}.`, sceneText: `Officers investigate the ${crime.kind}.`, clearText: `The ${crime.kind} case in ${row.name} is closed.` });
    }
    events.emit('log', { kind: 'event', text: `Neighbourhood watch reports a ${crime.kind} in ${row.name}.` });
    return crime;
  }

  resolveCases(day) {
    for (const crime of this.crimes) {
      if (crime.status === 'resolved') continue;
      if (crime.incident && this.town.incidents?.list.includes(crime.incident)) continue;
      const court = this.town.buildings.some((b) => b.facility === 'courthouse');
      crime.status = court || crime.severity === 1 ? 'resolved' : 'backlog';
      if (crime.status === 'resolved') {
        crime.resolvedDay = day;
        this.cases.push({ ...crime, court: court ? 'courthouse' : 'police caution' });
      }
    }
    if (this.crimes.length > 80) this.crimes.splice(0, this.crimes.length - 80);
    if (this.cases.length > 80) this.cases.splice(0, this.cases.length - 80);
  }

  runElection(day) {
    if (day - this.lastElectionDay < 30) return null;
    const adults = (this.town.pedestrians?.citizens || []).filter((c) => c.p.age >= 18);
    if (!adults.length) return null;
    const pool = adults.slice().sort((a, b) => ((b.p.optimism + b.p.intelligence) - (a.p.optimism + a.p.intelligence))).slice(0, 3);
    const votes = pool.map((c) => ({ candidate: c.p.name, votes: 0, platform: c.p.preferences?.community > 0.65 ? 'neighbourhoods' : c.p.traits?.conscientiousness > 0.6 ? 'order' : 'growth' }));
    for (const voter of adults) {
      let best = 0; let score = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i].p;
        const s = candidate.intelligence * 0.25 + candidate.optimism * 0.25 + candidate.traits.conscientiousness * 0.2 + candidate.traits.sociability * 0.15 + this.rng.float(-0.12, 0.12);
        if (s > score) { score = s; best = i; }
      }
      votes[best].votes++;
    }
    const winner = votes.slice().sort((a, b) => b.votes - a.votes)[0];
    this.mayor = winner?.candidate || this.mayor;
    this.lastElectionDay = day;
    const result = { day, winner: this.mayor, votes, turnout: adults.length };
    this.elections.push(result);
    if (this.elections.length > 12) this.elections.shift();
    events.emit('log', { kind: 'event', text: `${this.mayor} wins the town election.` });
    return result;
  }

  update(_dt, clock) {
    if (!clock || clock.day === this.lastDay) return;
    this.lastDay = clock.day;
    this.syncLaws();
    this.rebuild();
    this.raiseCrime(clock.day);
    this.resolveCases(clock.day);
    this.updateMoods();
    const all = [...this.neighbourhoods.values()];
    this.approvalRate = all.length ? clamp(all.reduce((s, r) => s + r.approval, 0) / all.length) : 0.5;
    this.runElection(clock.day);
  }

  noteDemolition(building) {
    this.lastDemolition = { day: this.town.economy?.lastDay || 1, building: building?.name || building?.kind || 'building', cell: building?.cell || null };
    events.emit('log', { kind: 'event', text: `${this.lastDemolition.building} is demolished and its occupants are relocated.` });
  }

  stats() {
    this.syncLaws();
    return {
      approvalRate: Math.round(this.approvalRate * 100) / 100,
      mayor: this.mayor,
      neighbourhoods: [...this.neighbourhoods.values()].map((r) => ({ ...r })),
      crimes: { open: this.crimes.filter((c) => c.status !== 'resolved').length, reported: this.crimes.length, resolved: this.crimes.filter((c) => c.status === 'resolved').length, backlog: this.crimes.filter((c) => c.status === 'backlog').length },
      laws: this.laws.filter((l) => l.active).map((l) => l.id),
      elections: this.elections.slice(-4),
      mood: this.town.pedestrians?.citizens?.length ? this.town.pedestrians.citizens.reduce((s, c) => s + c.mood, 0) / this.town.pedestrians.citizens.length : 0.5,
      lastDemolition: this.lastDemolition
    };
  }
}
