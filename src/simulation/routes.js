import * as THREE from 'three';
import { CELL, SIM } from '../core/config.js';
import { ROAD_FEATURE } from '../core/grid.js';

export function travelDir(from, to) {
  return { x: to[0] - from[0], z: to[1] - from[1] };
}

export function rightOf(dir) {
  return { x: -dir.z, z: dir.x };
}

function unit(d) {
  const len = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / len, z: d.z / len };
}

function roundaboutArc(center, from, to, y, out) {
  const R = SIM.roundaboutOffset;
  const a0 = Math.atan2(-from.z, -from.x);
  const a1 = Math.atan2(to.z, to.x);
  let sweep = a1 - a0;
  sweep -= Math.ceil(sweep / (Math.PI * 2)) * (Math.PI * 2);
  if (sweep > -0.05) sweep = -Math.PI;
  const steps = 7;
  for (let k = 0; k <= steps; k++) {
    const a = a0 + sweep * (k / steps);
    out.push(new THREE.Vector3(center.x + Math.cos(a) * R, y, center.z + Math.sin(a) * R));
  }
}

export function roadRoute(grid, path, offset = 0, opts = {}) {
  if (!path || path.length === 0) return [];
  const pts = [];
  const heightOf = (x, y) => (opts.y ?? grid.cellHeight(x, y));

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const p = grid.cellToWorld(x, y);
    const prev = path[i - 1];
    const next = path[i + 1];
    let dir;
    if (prev && next) dir = { x: next[0] - prev[0], z: next[1] - prev[1] };
    else if (next) dir = travelDir([x, y], next);
    else if (prev) dir = travelDir(prev, [x, y]);
    else dir = { x: 0, z: 1 };
    dir = unit(dir);

    const hy = heightOf(x, y);

    if (grid.featureAt(x, y) === ROAD_FEATURE.ROUNDABOUT && prev && next) {
      roundaboutArc(p, unit(travelDir(prev, [x, y])), unit(travelDir([x, y], next)), hy, pts);
      continue;
    }

    // Keep lane/pavement separation through junctions. Collapsing every
    // route to the tile centre made all vehicles and pedestrians converge on
    // one point, which was the root cause of intersection pile-ups.
    const o = offset;

    const r = rightOf(dir);
    pts.push(new THREE.Vector3(p.x + r.x * o, hy, p.z + r.z * o));
  }

  if (opts.start && pts.length) pts[0] = opts.start.clone();
  if (opts.end && pts.length) pts[pts.length - 1] = opts.end.clone();

  if (opts.smooth !== false && pts.length >= 3) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const samples = Math.max(pts.length * 5, 12);
    return curve.getSpacedPoints(samples);
  }
  return pts;
}

export function densify(points, step = 1.2) {
  if (points.length < 2) return points.slice();
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = a.distanceTo(b);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) {
      out.push(a.clone().lerp(b, k / n));
    }
  }
  out.push(points[points.length - 1].clone());
  return out;
}

export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += points[i - 1].distanceTo(points[i]);
  return d;
}

export function sampleAt(points, distance, target = new THREE.Vector3()) {
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = a.distanceTo(b);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return target.copy(a).lerp(b, t);
    }
    remaining -= seg;
  }
  return target.copy(points[points.length - 1]);
}

export function curvatureAt(points, index, lookahead = 6) {
  const i0 = Math.max(0, index - lookahead);
  const i1 = Math.min(points.length - 1, index + lookahead);
  const a = points[i0];
  const b = points[index];
  const c = points[i1];
  const v1 = new THREE.Vector2(b.x - a.x, b.z - a.z);
  const v2 = new THREE.Vector2(c.x - b.x, c.z - b.z);
  if (v1.lengthSq() < 1e-5 || v2.lengthSq() < 1e-5) return 0;
  const ang = Math.abs(v1.angleTo(v2));
  return ang;
}

export const CELL_SIZE = CELL;
