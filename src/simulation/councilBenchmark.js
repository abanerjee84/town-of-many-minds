const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const lowerIsBetter = (before, after, scale = 1) => clamp01((before - after) / Math.max(scale, Math.abs(before), 1));
const higherIsBetter = (before, after, scale = 1) => clamp01((after - before) / Math.max(scale, Math.abs(before), 1));

/** Capture only outcomes that every provider can be judged against. */
export function councilSnapshot(town) {
  const e = town.economy?.stats?.() || {};
  const lc = town.lifecycle?.stats?.() || {};
  const mb = town.traffic?.mobilityStats?.() || {};
  const rs = town.resources?.stats?.() || {};
  const ut = town.utilities?.stats?.() || {};
  const gr = town.growth?.stats?.() || {};
  const inc = town.incidents?.stats?.() || {};
  const audit = town.economy?.audit?.() || { ok: true };
  const types = Object.values(ut.types || {});
  return {
    treasury: Number(e.treasury) || 0,
    reserve: Number(e.reserve) || 0,
    operatingReserve: Number(e.operatingReserve) || 0,
    projectedDailyBurn: Number(e.projectedDailyBurn) || 0,
    fiscalBand: e.fiscalBand || 'unknown',
    population: Number(lc.population) || town.pedestrians?.citizens?.length || 0,
    targetPopulation: Number(lc.target) || 0,
    spareBeds: Math.max(0, (town.buildings || []).filter((b) => b.kind === 'house').reduce((n, b) => n + (b.capacity || 2), 0) - (Number(lc.population) || 0)),
    mood: Number(town.pedestrians?.averageMood?.()) || 0,
    unemployment: (Number(e.unemployment) || 0) / 100,
    congestion: Number(mb.congestion) || 0,
    delaySec: Number(mb.delaySec) || 0,
    openIncidents: Number(inc.open) || 0,
    utilityStrain: Array.isArray(ut.strained) ? ut.strained.length : types.filter((v) => v.saturated).length,
    resourceStrain: Array.isArray(rs.strained) ? rs.strained.length : 0,
    offNetwork: Number(gr.connectivity?.offNetwork) || 0,
    auditOk: audit.ok !== false,
    validationOk: town.validation?.ok !== false
    ,constructionBlocks: (town.buildings || []).filter((b) => b.blockId).length
    ,accessibleBuildings: (town.buildings || []).filter((b) => b.constructionFlags?.accessible).length
    ,tertiaryCapacity: (town.buildings || []).filter((b) => b.capacityKind === 'tertiary').reduce((n, b) => n + (b.capacity || 0), 0)
    ,wasteDiversion: Number(rs.waste?.diversion) || 0
  };
}

function outstanding(snapshot) {
  return (
    (snapshot.utilityStrain > 0 ? 1 : 0) +
    (snapshot.resourceStrain > 0 ? 1 : 0) +
    (snapshot.unemployment > 0.1 ? 1 : 0) +
    (snapshot.congestion > 0.34 ? 1 : 0) +
    (snapshot.openIncidents > 0 ? 1 : 0) +
    (snapshot.spareBeds < 14 ? 1 : 0)
  );
}

/**
 * Score consequences rather than prose. Intelligence rewards solving the
 * reported problems without invalid actions or fiscal damage. The historical
 * `empathy` field is a resident-impact diagnostic (mood, capacity, services,
 * access, and solvency), not a personality instruction to the model.
 */
export function scoreCouncilRun(before, after, decisions = []) {
  const failed = decisions.filter((d) => ['blocked', 'rejected', 'error'].includes(d?.status)).length;
  const spent = decisions.reduce((n, d) => n + (Number(d?.actualSpend ?? d?.cost) || 0), 0);
  const progress = before && after
    ? clamp01((outstanding(before) - outstanding(after)) / Math.max(1, outstanding(before)))
    : 0;
  const fiscal = after
    ? clamp01(after.treasury / Math.max(1, after.operatingReserve || 1))
    : 0;
  const integrity = after && after.auditOk && after.validationOk ? 1 : 0;
  const execution = clamp01(1 - failed / Math.max(1, decisions.length));
  const intelligence = Math.round(100 * clamp01(
    integrity * 0.35 + progress * 0.3 + Math.min(1, fiscal) * 0.2 + execution * 0.15
  ));

  const mood = after ? clamp01(after.mood * 0.7 + (before ? 0.3 * (0.5 + (after.mood - before.mood) * 5) : 0)) : 0;
  const housing = after ? clamp01(after.spareBeds / Math.max(14, after.population * 0.25)) : 0;
  const services = after
    ? clamp01(1 - (after.utilityStrain + after.resourceStrain + after.openIncidents) / 5)
    : 0;
  const access = after ? clamp01(1 - after.offNetwork / Math.max(1, after.population)) : 0;
  const noHarm = after && after.treasury >= 0 && after.auditOk ? 1 : 0;
  const constructionOutcome = after
    ? clamp01((after.wasteDiversion / 100) * 0.35 + Math.min(1, after.tertiaryCapacity / Math.max(1, after.population * 0.12)) * 0.35 + Math.min(1, after.accessibleBuildings / Math.max(1, after.constructionBlocks || 1)) * 0.3)
    : 0;
  const empathy = Math.round(100 * clamp01(
    mood * 0.3 + housing * 0.2 + services * 0.25 + access * 0.1 + noHarm * 0.15
  ));

  return {
    intelligence,
    empathy,
    safety: Math.round(integrity * 100),
    progress: Math.round(progress * 100),
    execution: Math.round(execution * 100),
    constructionOutcome: Math.round(constructionOutcome * 100),
    constructionBlocks: after?.constructionBlocks || 0,
    spent: Math.round(spent),
    failedDecisions: failed,
    unresolvedBefore: outstanding(before || {}),
    unresolvedAfter: outstanding(after || {})
  };
}

/**
 * Run the same seeded scenario through several adapters. `advance` is supplied
 * by the host because browser and headless harnesses own different clocks.
 */
export async function runCouncilBenchmark(town, providers, options = {}) {
  const list = Array.isArray(providers) ? providers : [providers];
  const scenarios = options.scenarios || [{ id: 'default', seed: options.seed ?? town.seed ?? 1, sittings: options.sittings ?? 1 }];
  const results = [];
  for (const provider of list) {
    const providerResults = [];
    for (const scenario of scenarios) {
      town.generate(scenario.seed);
      town.governance.setProvider(provider);
      town.governance.auto = false;
      const before = councilSnapshot(town);
      const decisions = [];
      for (let i = 0; i < Math.max(1, scenario.sittings || 1); i++) {
        if (i && options.advance) await options.advance(town, scenario, i);
        decisions.push(await town.governance.ask());
      }
      const after = councilSnapshot(town);
      providerResults.push({
        scenario: scenario.id || String(scenario.seed),
        provider: town.governance.stats().providerId,
        decisions,
        before,
        after,
        score: scoreCouncilRun(before, after, decisions)
      });
    }
    results.push({
      provider: typeof provider === 'string' ? provider : provider?.id || provider?.name || 'custom',
      scenarios: providerResults,
      average: providerResults.reduce((a, r) => ({
        intelligence: a.intelligence + r.score.intelligence / providerResults.length,
        empathy: a.empathy + r.score.empathy / providerResults.length,
        safety: a.safety + r.score.safety / providerResults.length
      }), { intelligence: 0, empathy: 0, safety: 0 })
    });
  }
  return results;
}
