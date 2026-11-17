/**
 * The city at night, seen from above: where its lights burn. Lit windows in the houses (most
 * houses in town, fewer outside the walls), street lamps along every street (just outside the
 * house fronts that face open ground) and the main roads, lamps round the squares and fires on
 * them, torches on the wall's towers and fires at its gates, lanterns on piers and bridges, and
 * more light in the great buildings (keep, temple, taverns, inns, mansions, garrison). Metres, as
 * the city. The companion draws them as tiny glows on a darkened copy of the city image.
 */

import { Rng } from "../gen/rng";
import { area, bboxOf, centroid, inside, type City, type Pt, type Ring } from "./city";
import { allHotSpots } from "./places";

export type NightLightKind = "window" | "lamp" | "fire" | "tower";

export interface NightLight {
  at: Pt;
  kind: NightLightKind;
  /** Glow radius, metres. */
  r: number;
  /** Brightness, 0 to 1. */
  i: number;
}

/** Street lamps keep this far apart (metres). */
const LAMP_GAP = 14;

export function cityNightLights(city: City): NightLight[] {
  const rng = new Rng(`${city.url}:night`);
  const out: NightLight[] = [];
  // The town wall: the wall round most of the houses (as street maps decide it).
  const town = city.walls.find((x) => city.buildings.filter((b) => inside(centroid(b), x.ring)).length > city.buildings.length / 3);
  const inTown = (p: Pt) => (town ? inside(p, town.ring) : true);

  // Buildings by grid cell, to test "inside a building" quickly.
  const CELL = 40;
  const cells = new Map<string, Ring[]>();
  for (const b of city.buildings) {
    const bb = bboxOf(b);
    for (let x = Math.floor(bb.x / CELL); x <= Math.floor((bb.x + bb.w) / CELL); x++) for (let y = Math.floor(bb.y / CELL); y <= Math.floor((bb.y + bb.h) / CELL); y++) {
      const k = `${x},${y}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(b);
    }
  }
  const built = (p: Pt) => (cells.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []).some((b) => inside(p, b));
  const nearHouse = (p: Pt) => {
    const x = Math.floor(p[0] / CELL), y = Math.floor(p[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (cells.has(`${x + dx},${y + dy}`)) return true;
    return false;
  };
  const inWater = (p: Pt) => city.water.some((w) => inside(p, w));

  // Lamps keep their distance: a grid of the lamps placed so far.
  const lamps = new Map<string, Pt[]>();
  const lampFree = (p: Pt, gap: number) => {
    const x = Math.floor(p[0] / gap), y = Math.floor(p[1] / gap);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of lamps.get(`${x + dx},${y + dy}`) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < gap) return false;
    return true;
  };
  const lamp = (p: Pt, kind: NightLightKind, r: number, i: number, gap = LAMP_GAP) => {
    if (!lampFree(p, gap)) return;
    const k = `${Math.floor(p[0] / gap)},${Math.floor(p[1] / gap)}`;
    (lamps.get(k) ?? lamps.set(k, []).get(k)!).push(p);
    out.push({ at: p, kind, r, i });
  };
  const points = (r: Ring, n: number, tries = n * 8): Pt[] => {
    const bb = bboxOf(r);
    const got: Pt[] = [];
    for (let t = 0; t < tries && got.length < n; t++) {
      const p: Pt = [bb.x + rng.range(0, bb.w), bb.y + rng.range(0, bb.h)];
      if (inside(p, r)) got.push(p);
    }
    return got;
  };
  const walk = (pts: Pt[], step: number, at: (p: Pt, dir: Pt, k: number) => void, closed = false) => {
    let acc = 0, k = 0;
    const n = closed ? pts.length : pts.length - 1;
    for (let j = 0; j < n; j++) {
      const a = pts[j]!, b = pts[(j + 1) % pts.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (let t = 0; t < len; t += 1, acc += 1) if (acc % step === 0) at([a[0] + dir[0] * t, a[1] + dir[1] * t], dir, k++);
    }
  };

  // The great buildings burn the most light: a fire at the door of a tavern or inn, torches round a keep.
  for (const hs of allHotSpots(city)) {
    const b = hs.building;
    if (hs.kind === "tavern" || hs.kind === "inn") out.push({ at: hs.at, kind: "fire", r: 7, i: 0.95 });
    if (!b || !["keep", "temple", "tavern", "inn", "mansion", "garrison", "wizard"].includes(hs.kind)) continue;
    for (const p of points(b, Math.min(14, Math.max(3, Math.round(area(b) / 50))))) out.push({ at: p, kind: "window", r: rng.range(2.6, 3.8), i: rng.range(0.7, 1) });
    if (hs.kind === "keep" || hs.kind === "garrison") for (const v of b) out.push({ at: v, kind: "tower", r: 4.5, i: 0.85 });
  }

  // Lit windows: most houses in town, a few out in the country; one to six to a house by its size.
  for (const b of city.buildings) {
    const t = inTown(centroid(b));
    if (rng.next() > (t ? 0.72 : 0.3)) continue;
    const n = Math.max(1, Math.min(6, Math.round((area(b) / 110) * rng.range(0.5, 1.3))));
    for (const p of points(b, n)) out.push({ at: p, kind: "window", r: rng.range(2.2, 3.4), i: rng.range(0.45, 0.9) });
  }

  // The town wall: a torch on every tower, fires either side of every gate.
  for (const wl of city.walls) for (const v of wl.ring) out.push({ at: v, kind: "tower", r: 4.5, i: 0.8 });
  for (const wl of city.walls) for (let j = 0; j < wl.ring.length; j++) {
    const a = wl.ring[j]!, b = wl.ring[(j + 1) % wl.ring.length]!;
    for (const road of city.roads) for (let i = 0; i + 1 < road.points.length; i++) {
      const g = cross(road.points[i]!, road.points[i + 1]!, a, b);
      if (!g) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const d: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (const s of [-1, 1]) out.push({ at: [g[0] + d[0] * s * (road.width / 2 + 2.5), g[1] + d[1] * s * (road.width / 2 + 2.5)], kind: "fire", r: 8, i: 1 });
    }
  }

  // Squares: lamps round the edge, a fire or two out in the open.
  for (const sqr of city.squares) {
    const c = centroid(sqr);
    walk(sqr, 12, (p) => {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
      const at: Pt = [p[0] + ((c[0] - p[0]) / d) * 2, p[1] + ((c[1] - p[1]) / d) * 2];
      if (!built(at)) lamp(at, "lamp", 5.5, 0.85, 10);
    }, true);
    for (const p of points(sqr, Math.max(1, Math.round(area(sqr) / 900)))) out.push({ at: p, kind: "fire", r: 7, i: 0.9 });
  }

  // Main roads: a lamp on alternate sides in town.
  for (const road of city.roads) walk(road.points, 16, (p, dir, k) => {
    const s = k % 2 ? 1 : -1;
    const at: Pt = [p[0] - dir[1] * s * (road.width / 2 + 1.2), p[1] + dir[0] * s * (road.width / 2 + 1.2)];
    if (inTown(at) && nearHouse(at) && !built(at) && !inWater(at)) lamp(at, "lamp", 6, 0.85);
  });

  // Every other street: a lamp just outside the house fronts that face open ground.
  for (const b of city.buildings) {
    if (!inTown(centroid(b))) continue;
    for (let j = 0; j < b.length; j++) {
      const a = b[j]!, q = b[(j + 1) % b.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 4) continue;
      let n: Pt = [-(q[1] - a[1]) / len, (q[0] - a[0]) / len];
      const mid: Pt = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
      if (inside([mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5], b)) n = [-n[0], -n[1]];
      const at: Pt = [mid[0] + n[0] * 1.8, mid[1] + n[1] * 1.8];
      if (!built(at) && !inWater(at) && !built([mid[0] + n[0] * 4, mid[1] + n[1] * 4])) lamp(at, "lamp", 5, 0.75);
    }
  }

  // Piers and bridges: a lantern every twelve metres.
  for (const pl of city.planks) walk(pl.points, 12, (p, dir, k) => {
    const s = k % 2 ? 1 : -1;
    const at: Pt = [p[0] - dir[1] * s * Math.max(0.5, pl.width / 2 - 0.6), p[1] + dir[0] * s * Math.max(0.5, pl.width / 2 - 0.6)];
    if (!built(at)) out.push({ at, kind: "lamp", r: 4.5, i: 0.8 });
  });

  return out;
}

function cross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined {
  const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : undefined;
}
