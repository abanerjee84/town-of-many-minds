/**
 * Town pipeline (Phase 2): the ordered, named stages that turn a seed into a
 * live town. The order is the single source of truth — `startPlacement.js`
 * supplies one handler per id, so a stage cannot silently appear or disappear.
 *
 * Steps run in order and record duration; the first failure aborts the run and
 * the remaining stages are reported as `not-run`.
 */
export const TOWN_PIPELINE = [
  { id: 'seed', label: 'Seed', hint: 'Rng fork and town identity' },
  { id: 'mainRoads', label: 'Main roads', hint: 'Recursive block subdivision grid' },
  { id: 'roadFeatures', label: 'Secondary roads & water', hint: 'River, tunnel, roundabout, dead end' },
  { id: 'roadMask', label: 'Road mask', hint: 'Per-cell road neighbour mask + road graph' },
  { id: 'zoning', label: 'Zoning', hint: 'Residential / commercial / park by distance' },
  { id: 'civic', label: 'Civic services', hint: 'School, clinic, police, fire, …' },
  { id: 'parcels', label: 'Parcels', hint: 'Block subdivision, setbacks, frontage' },
  { id: 'buildings', label: 'Buildings', hint: 'Houses and shops from the Building Kit' },
  { id: 'resources', label: 'Primary resources', hint: 'Lake, wind, solar, farms, storage + access roads' },
  { id: 'roadKit', label: 'Road kit', hint: 'Cross-sections, markings, props' },
  { id: 'lots', label: 'Public spaces & lots', hint: 'Pads, driveways, parks, paths, pitches' },
  { id: 'zoneModel', label: 'Zone model', hint: 'Propagates zone into the height/colour model' },
  { id: 'utilities', label: 'Utilities', hint: 'Power, water, sewage networks + plants' },
  { id: 'agents', label: 'Population & traffic', hint: 'Households, citizens, vehicles' },
  { id: 'validation', label: 'Validation', hint: 'Town Validator' }
];

export const PIPELINE_IDS = TOWN_PIPELINE.map((s) => s.id);

/**
 * @param {object} town
 * @param {object} rng
 * @param {Record<string, (ctx: {town: object, rng: object}) => void>} handlers
 * @param {(step: object) => void} [onStep]
 * @returns {{id: string, label: string, status: string, ms: number, error: string|null}[]}
 */
export function runTownPipeline(town, rng, handlers, onStep) {
  const declaredIds = TOWN_PIPELINE.map((stage) => stage.id);
  if (new Set(declaredIds).size !== declaredIds.length)
    throw new Error('town pipeline contains duplicate stage ids');
  const ctx = { town, rng };
  const steps = [];
  let aborted = false;

  for (const meta of TOWN_PIPELINE) {
    const fn = handlers[meta.id];

    if (aborted) {
      const step = { ...meta, status: 'not-run', ms: 0, error: null };
      steps.push(step);
      onStep?.(step);
      continue;
    }

    if (typeof fn !== 'function') {
      const step = { ...meta, status: 'missing', ms: 0, error: 'no handler' };
      steps.push(step);
      onStep?.(step);
      aborted = true;
      continue;
    }

    const t0 = now();
    let status = 'ok';
    let error = null;
    try {
      fn(ctx);
    } catch (e) {
      status = 'failed';
      error = (e && e.message) || String(e);
      aborted = true;
    }
    const step = { ...meta, status, ms: Math.round((now() - t0) * 10) / 10, error };
    steps.push(step);
    onStep?.(step);
  }

  if (steps.length !== TOWN_PIPELINE.length)
    throw new Error(`town pipeline recorded ${steps.length} stages, expected ${TOWN_PIPELINE.length}`);
  const recordedIds = steps.map((step) => step.id);
  if (recordedIds.some((id, index) => id !== declaredIds[index]))
    throw new Error('town pipeline stage order changed while running');

  return steps;
}

export function pipelineSummary(steps) {
  const counts = { ok: 0, failed: 0, missing: 0, 'not-run': 0 };
  let ms = 0;
  for (const s of steps) {
    counts[s.status] = (counts[s.status] || 0) + 1;
    ms += s.ms || 0;
  }
  return {
    steps: steps.length,
    ok: counts.ok,
    failed: counts.failed,
    missing: counts.missing,
    notRun: counts['not-run'],
    ms: Math.round(ms * 10) / 10,
    slowest: steps.reduce((a, b) => (!a || b.ms > a.ms ? b : a), null)?.id || null
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
