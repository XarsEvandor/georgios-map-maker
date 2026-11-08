/**
 * Hip roofs over building outlines, the way Dungeondraft and 2MT draw town roofs: one sloped
 * face per wall, rising to hips and a ridge. Convex outlines get their straight skeleton
 * (each wall's face is the ground nearer to it than to any other wall); concave outlines are
 * cut into convex pieces first, each with its own roof, which reads as wings of one house.
 */

import type { Pt, Ring } from "./city";

export interface RoofFace {
  /** The face's outline, starting with its eave. */
  ring: Ring;
  /** The eave (the wall edge the face slopes down to). */
  eave: [Pt, Pt];
  /** Unit vector pointing down the slope, away from the roof (the wall's outward normal). */
  down: Pt;
  /** The eave's direction in radians, for laying the tile rows along it. */
  angle: number;
}

export interface Roof {
  faces: RoofFace[];
  /** Lines from a corner up to the ridge. */
  hips: Array<[Pt, Pt]>;
  /** Lines along the top, between two inner points. */
  ridges: Array<[Pt, Pt]>;
}

const EPS = 1e-7;

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drops repeated points, the closing point, and corners that are nearly straight. */
export function cleanRing(r0: Ring, tol = 0.05): Ring {
  let r = r0.filter((p, i) => {
    const q = r0[(i + 1) % r0.length]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > tol;
  });
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i + r.length - 1) % r.length]!, b = r[i]!, c = r[(i + 1) % r.length]!;
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < tol || lv < tol || Math.abs(ux * vy - uy * vx) / (lu * lv) < 0.02) {
        r = r.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return r;
}

function isConvex(r: Ring): boolean {
  let sgn = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!, c = r[(i + 2) % r.length]!;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < EPS) continue;
    const s = Math.sign(cr);
    if (sgn && s !== sgn) return false;
    sgn = s;
  }
  return true;
}

/** Convex hull (monotone chain), counter-clockwise in the ring's own frame. */
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= EPS) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= EPS) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

interface Line {
  n: Pt;
  c: number;
}

/** The point and time where three wavefront lines (each moving inward at unit speed) meet. */
function meet(a: Line, b: Line, c: Line): { p: Pt; t: number } | undefined {
  // n·x - t = c for each line.
  const m = [[a.n[0], a.n[1], -1], [b.n[0], b.n[1], -1], [c.n[0], c.n[1], -1]];
  const v = [a.c, b.c, c.c];
  const det = (q: number[][]) => q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) - q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) + q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return undefined;
  const col = (i: number) => m.map((row, r) => row.map((x, j) => (j === i ? v[r]! : x)));
  return { p: [det(col(0)) / d, det(col(1)) / d], t: det(col(2)) / d };
}

/** Straight-skeleton hip roof of a convex outline. */
function convexRoof(r: Ring): Roof {
  const n = r.length;
  const ccw = signedArea(r) > 0;
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = r[i]!, b = r[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = ccw ? -(b[1] - a[1]) / len : (b[1] - a[1]) / len;
    const ny = ccw ? (b[0] - a[0]) / len : -(b[0] - a[0]) / len;
    lines.push({ n: [nx, ny], c: nx * a[0] + ny * a[1] });
  }
  const facePts: Pt[][] = r.map((a, i) => [a, r[(i + 1) % n]!]);
  const hips: Array<[Pt, Pt]> = [], ridges: Array<[Pt, Pt]> = [];
  // Active edges and, for each, the vertex at its start (between it and the previous edge).
  let edges = r.map((_, i) => i);
  let starts: Array<{ p: Pt; corner: boolean }> = r.map((p) => ({ p, corner: true }));
  let t = 0;
  const arc = (from: { p: Pt; corner: boolean }, to: Pt, left: number, right: number) => {
    if (Math.hypot(to[0] - from.p[0], to[1] - from.p[1]) > 1e-6) (from.corner ? hips : ridges).push([from.p, to]);
    facePts[left]!.push(from.p, to);
    facePts[right]!.push(from.p, to);
  };
  let guard = 0;
  while (edges.length > 3 && guard++ < 200) {
    const m = edges.length;
    let best: { j: number; p: Pt; t: number } | undefined;
    for (let j = 0; j < m; j++) {
      const e = meet(lines[edges[(j + m - 1) % m]!]!, lines[edges[j]!]!, lines[edges[(j + 1) % m]!]!);
      if (!e || e.t < t - 1e-6) continue;
      if (!best || e.t < best.t) best = { j, ...e };
    }
    if (!best) break;
    const j = best.j;
    const prev = edges[(j + m - 1) % m]!, cur = edges[j]!, next = edges[(j + 1) % m]!;
    arc(starts[j]!, best.p, prev, cur);
    arc(starts[(j + 1) % m]!, best.p, cur, next);
    // The edge is gone; one vertex now stands where it closed, between its two neighbours.
    const nextStart = (j + 1) % m;
    starts[nextStart] = { p: best.p, corner: false };
    edges = edges.filter((_, i) => i !== j);
    starts = starts.filter((_, i) => i !== j);
    t = best.t;
  }
  if (edges.length === 3) {
    const [e0, e1, e2] = edges as [number, number, number];
    const e = meet(lines[e0]!, lines[e1]!, lines[e2]!);
    if (e) {
      arc(starts[0]!, e.p, e2, e0);
      arc(starts[1]!, e.p, e0, e1);
      arc(starts[2]!, e.p, e1, e2);
    }
  }
  const faces: RoofFace[] = [];
  for (let i = 0; i < n; i++) {
    const a = r[i]!, b = r[(i + 1) % n]!;
    const h = hull(facePts[i]!);
    if (h.length < 3) continue;
    // Start the ring at the eave.
    const k = h.findIndex((p) => Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-6);
    const ring = k >= 0 ? h.slice(k).concat(h.slice(0, k)) : h;
    const ln = lines[i]!;
    faces.push({ ring, eave: [a, b], down: [-ln.n[0], -ln.n[1]], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return { faces, hips, ridges };
}

/** Ear-clipping triangulation of a simple ring, as index triples. */
function triangulate(r: Ring): number[][] {
  const ccw = signedArea(r) > 0;
  const idx = r.map((_, i) => i);
  const tris: number[][] = [];
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p: Pt, a: Pt, b: Pt, c: Pt) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return ccw ? d1 > EPS && d2 > EPS && d3 > EPS : d1 < -EPS && d2 < -EPS && d3 < -EPS;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!;
      const a = r[ia]!, b = r[ib]!, c = r[ic]!;
      const cr = cross(a, b, c);
      if (ccw ? cr <= EPS : cr >= -EPS) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inTri(r[j]!, a, b, c))) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([...idx]);
  return tris;
}

/** Merges triangles across shared edges while the union stays convex (Hertel-Mehlhorn). */
function convexPieces(r: Ring): Ring[] {
  let polys = triangulate(r);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i]!, B = polys[j]!;
      for (let a = 0; a < A.length; a++) {
        const u = A[a]!, v = A[(a + 1) % A.length]!;
        const b = B.findIndex((x, k) => x === v && B[(k + 1) % B.length] === u);
        if (b < 0) continue;
        // Join: A up to u, then B's other vertices from u round to v.
        const rest: number[] = [];
        for (let k = 2; k < B.length; k++) rest.push(B[(b + k) % B.length]!);
        const joined = [...A.slice(0, a + 1), ...rest, ...A.slice(a + 1)];
        if (!isConvex(joined.map((x) => r[x]!))) continue;
        polys = polys.filter((_, k) => k !== i && k !== j).concat([joined]);
        merged = true;
        break outer;
      }
    }
  }
  return polys.map((p) => p.map((x) => r[x]!));
}

/** The hip roof over a building outline (any simple polygon). */
export function hipRoof(outline: Ring): Roof {
  const r = cleanRing(outline);
  if (r.length < 3 || Math.abs(signedArea(r)) < 0.05) return { faces: [], hips: [], ridges: [] };
  const pieces = isConvex(r) ? [r] : convexPieces(r);
  const out: Roof = { faces: [], hips: [], ridges: [] };
  for (const p of pieces) {
    const roof = convexRoof(cleanRing(p));
    out.faces.push(...roof.faces);
    out.hips.push(...roof.hips);
    out.ridges.push(...roof.ridges);
  }
  return out;
}

/** How bright a face is under a sun shining from `sun` (unit vector toward the sun): 0.55 to 1. */
export function faceLight(face: RoofFace, sun: Pt = [-Math.SQRT1_2, -Math.SQRT1_2]): number {
  const d = face.down[0] * sun[0] + face.down[1] * sun[1];
  return 0.78 + 0.22 * d;
}
