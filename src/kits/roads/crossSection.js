import { CELL, ROAD } from '../../core/config.js';

export const XS_CLASS = {
  ALLEY: 'alley',
  LOCAL: 'local',
  STREET: 'street',
  AVENUE: 'avenue',
  BOULEVARD: 'boulevard',
  JUNCTION: 'junction',
  SPECIAL: 'special'
};

export const XS_CLASS_LABEL = {
  alley: 'Alley',
  local: 'Local road',
  street: 'Street',
  avenue: 'Avenue',
  boulevard: 'Boulevard',
  junction: 'Junction',
  special: 'Special structure'
};

/** The upgrade ladder, bottom rung first (Phase 7). Exported so the planner,
 *  the council spec and the prompt all read one list. */
export const XS_CLASS_ORDER = ['alley', 'local', 'street', 'avenue', 'boulevard'];

/** Ladder index of a class (alley 0 … boulevard 4); -1 for junction/special. */
export function classIndex(cls) {
  return XS_CLASS_ORDER.indexOf(cls);
}

/** Storage code → class name; 0/unknown means "derive it from the segment". */
export function classFromCode(code) {
  return XS_CLASS_ORDER[(code | 0) - 1] || null;
}

/** Class name → storage code; unknown classes store as 0 (derived). */
export function classToCode(cls) {
  const i = XS_CLASS_ORDER.indexOf(cls);
  return i < 0 ? 0 : i + 1;
}

const SPECIAL = ['bridge', 'ramp', 'tunnel', 'roundabout', 'deadend', 'isolated'];
const JUNCTIONS = ['curve', 'tjunction', 'cross'];
const DRAIN = ['straight', 'curve', 'tjunction', 'cross'];

function walkWidthAt(xs, side) {
  if (!xs.sidewalk) return 0;
  const narrow = xs.cycle === side || xs.parking === side;
  return narrow ? ROAD.narrowSidewalk : ROAD.sidewalkW;
}

export function kerbOffset(xs, side) {
  return CELL / 2 - walkWidthAt(xs, side);
}

export function edgeOffset(xs, side) {
  const base = xs ? kerbOffset(xs, side) - 0.06 : ROAD.edgeLine;
  return Math.min(1.34, Math.max(0.9, base));
}

function finalize(xs) {
  const width = CELL - walkWidthAt(xs, -1) - walkWidthAt(xs, 1);
  xs.width = Math.round(width * 1000) / 1000;
  xs.edge = Math.round(Math.max(edgeOffset(xs, -1), edgeOffset(xs, 1)) * 1000) / 1000;
  xs.label = XS_CLASS_LABEL[xs.cls] || xs.cls;
  xs.order = XS_CLASS_ORDER.indexOf(xs.cls);
  return xs;
}

/**
 * Phase 7 — force one ladder class onto a straight cell (an upgraded run).
 * Sidewalks stay a property of the SEGMENT — a bridge or ramp never has one
 * and a plain straight cell always does — so the class only re-rolls what an
 * upgrade may buy: lanes, a median and a cycle lane. Deterministic in the
 * run hash, so every cell of one run renders identically.
 */
function applyClass(base, cls, rh) {
  base.cls = cls;
  base.median = cls === XS_CLASS.AVENUE || cls === XS_CLASS.BOULEVARD;
  base.cycle =
    cls === XS_CLASS.STREET || cls === XS_CLASS.BOULEVARD ? ((rh >> 3) & 1 ? 1 : -1) : 0;
  base.parking = 0;
  base.lanes = cls === XS_CLASS.ALLEY ? 1 : cls === XS_CLASS.BOULEVARD ? 3 : 2;
  return base;
}

/**
 * Declarative cross-section for one road tile: which lanes and verge
 * components are present, and how wide the carriageway consequently is.
 * Everything else (geometry, counts, graph edges) reads from this object
 * instead of re-rolling its own dice.
 *
 * `c.clsOverride` (the ladder CODE stored on the cell, 0 = none) wins over
 * the derived class for straight cells only — junctions and structures keep
 * their own class, which is why an upgrade never writes a code onto them.
 */
export function composeCrossSection(c) {
  const { seg, axis, run } = c;
  const sidewalk = seg !== 'bridge' && seg !== 'ramp';

  const base = {
    cls: XS_CLASS.LOCAL,
    seg,
    axis,
    sidewalk,
    lanes: 2,
    median: false,
    cycle: 0,
    parking: 0,
    drainage: DRAIN.includes(seg)
  };

  if (SPECIAL.includes(seg)) {
    base.cls = XS_CLASS.SPECIAL;
    base.lanes = seg === 'roundabout' ? 1 : 2;
    base.drainage = false;
    return finalize(base);
  }

  if (JUNCTIONS.includes(seg)) {
    base.cls = XS_CLASS.JUNCTION;
    return finalize(base);
  }

  if (seg !== 'straight' || !axis || !run) return finalize(base);

  const rh = run.hash;
  const forced = classFromCode(c.clsOverride);
  if (forced) return finalize(applyClass(base, forced, rh));

  base.median = run.total >= 5 && rh % 3 === 0;
  if (run.total >= 4 && rh % 4 === 1) base.cycle = (rh >> 3) & 1 ? 1 : -1;
  // Kerbside parking is never generated: all parking is off-street (driveways,
  // garages and lots). `parking` stays a legal value so callers keep working.

  if (!sidewalk) base.cls = XS_CLASS.ALLEY;
  else if (base.median && (base.cycle || base.parking)) base.cls = XS_CLASS.BOULEVARD;
  else if (base.median) base.cls = XS_CLASS.AVENUE;
  else if (base.cycle || base.parking) base.cls = XS_CLASS.STREET;
  else base.cls = XS_CLASS.LOCAL;

  if (base.cls === XS_CLASS.ALLEY) base.lanes = 1;
  if (base.cls === XS_CLASS.BOULEVARD) base.lanes = 3;

  return finalize(base);
}

export function crossSectionSummary(xs) {
  if (!xs) return '';
  const parts = [`${xs.lanes} lane${xs.lanes === 1 ? '' : 's'}`];
  if (xs.median) parts.push('median');
  if (xs.cycle) parts.push('cycle');
  if (xs.parking) parts.push('parking');
  if (xs.sidewalk) parts.push('sidewalk');
  if (xs.drainage) parts.push('drainage');
  return `${xs.label} · ${xs.width.toFixed(2)} m · ${parts.join(' + ')}`;
}
