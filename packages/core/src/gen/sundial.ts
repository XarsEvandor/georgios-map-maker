/**
 * The sundial set piece (DESIGN.md section 38): a clock dial etched round a tower on a street map,
 * twelve Roman numerals on a ring, gems set into some of them, and the tower's one shadow, which
 * ignores the sun: a tile Foundry draws and the GM turns, one numeral at a time. The shadow has to
 * rest on the gems in their order (the GM's secret); then the gate to the stair opens. The tower
 * itself is shown cut open, as street maps show every building: the time device in the middle, the
 * carved face by the door, the stair behind its locked gate, and the cast frozen on the floor.
 *
 * Everything here is geometry in squares; the street map converts its metres first.
 */

import type { AssetRecord } from "../assets/model";
import { LAYER, place, rotationFor, type Ctx } from "./dress";
import type { CastMember, GemColor, SundialPlan } from "./plan";

export const GEM_COLORS: readonly GemColor[] = ["ruby", "sapphire", "topaz", "emerald", "amethyst"];
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

/** Each gem's colour on the map and in Foundry's light. */
export const GEM_RGB: Record<GemColor, string> = { ruby: "#b3202e", sapphire: "#2b55b8", topaz: "#e0a31f", emerald: "#2f9a55", amethyst: "#8a3fb3" };

type Vec = [number, number];

export interface SundialGem {
  numeral: number;
  color: GemColor;
  at: Vec;
  rgb: string;
}

/** A numeral cut into the ground: text, its centre, its turn (radians, clockwise on screen) and its height. */
export interface SundialEtching {
  text: string;
  at: Vec;
  rot: number;
  size: number;
}

/** The tower's shadow: from the tower's wall (`from`) out to its tip (`length`), both measured from the pivot; its width at the wall; how dark. */
export interface SundialShadow {
  from: number;
  length: number;
  width: number;
  alpha: number;
}

/** Someone frozen on the tower's floor (a token in Foundry), in squares. */
export interface SundialCast extends CastMember {
  x: number;
  y: number;
  facing: Vec;
}

/** What a built map knows about its dial: for the renderer (etchings) and for Foundry (the shadow tile, the gem lights, the cast). */
export interface SundialOut {
  /** The pivot (the tower's centre), squares. */
  at: Vec;
  /** The ring's radius. */
  radius: number;
  /** The numeral the shadow stands on to begin with. */
  stopped: number;
  shadow: SundialShadow;
  /** In the order the shadow has to rest on them. */
  gems: SundialGem[];
  etchings: SundialEtching[];
  cast?: SundialCast[];
}

/** Direction of numeral n (1..12) on screen: XII up, then clockwise. */
export function numeralDir(n: number): Vec {
  const a = (n % 12) * (Math.PI / 6) - Math.PI / 2;
  return [Math.cos(a), Math.sin(a)];
}

/** The shadow's turn in degrees for Foundry (clockwise), 0 at XII. */
export function shadowRotation(numeral: number): number {
  return (((numeral % 12) + 12) % 12) * 30;
}

/** The dial's geometry round a pivot: numerals on the ring, the gems a square inside it, the shadow from the tower's wall (`towerR`) out past the ring. */
export function dialGeometry(spec: SundialPlan, at: Vec, radius: number, towerR: number): Omit<SundialOut, "cast"> {
  const R = radius;
  const point = (n: number, r: number): Vec => {
    const d = numeralDir(n);
    return [at[0] + d[0] * r, at[1] + d[1] * r];
  };
  const etchings: SundialEtching[] = ROMAN.map((text, i) => {
    const n = i + 1;
    const d = numeralDir(n);
    // The numeral's foot points at the tower: readable walking round the ring.
    return { text, at: point(n, R), rot: Math.atan2(d[1], d[0]) + Math.PI / 2, size: Math.max(0.7, Math.min(1.4, R * 0.14)) };
  });
  const gems: SundialGem[] = spec.gems.map((g) => ({ numeral: g.numeral, color: g.color, at: point(g.numeral, R - 1), rgb: GEM_RGB[g.color] }));
  const from = Math.max(0.5, Math.min(towerR, R - 1.5));
  const shadow: SundialShadow = { from, length: R + 1.3, width: Math.max(1.2, from * 1.7), alpha: 0.55 };
  return { at, radius: R, stopped: spec.stopped, shadow, gems, etchings };
}

export type RestEvent = "none" | "lit" | "wrong" | "done";

/**
 * What happens when the shadow comes to rest on `numeral`, with `progress` gems lit so far: the next
 * gem in order lights ("lit", or "done" when it was the last); a gem out of its turn puts them all
 * out ("wrong"); a plain numeral, or a gem already lit, changes nothing.
 */
export function shadowRests(gems: ReadonlyArray<{ numeral: number }>, progress: number, numeral: number): { progress: number; event: RestEvent } {
  const i = gems.findIndex((g) => ((g.numeral % 12) + 12) % 12 === ((numeral % 12) + 12) % 12);
  if (i < 0 || i < progress) return { progress, event: "none" };
  if (i === progress) {
    const p = progress + 1;
    return { progress: p, event: p === gems.length ? "done" : "lit" };
  }
  return { progress: 0, event: "wrong" };
}

/** Which gems burn with `progress` of them lit: the first ones in order. */
export function litGems(gems: ReadonlyArray<unknown>, progress: number): boolean[] {
  return gems.map((_, i) => i < progress);
}

export interface TowerInput {
  ctx: Ctx;
  zone: string;
  /** The tower's wall line, squares (a closed ring). */
  ring: Vec[];
  /** The tower's centre: the dial's pivot. */
  centre: Vec;
  /** The street door's centre on the wall line. */
  door: Vec;
  cast?: CastMember[];
}

export interface TowerOut {
  /** A wall across the far side of the tower, with the locked gate to the stair in it (squares). */
  gate?: { a: Vec; b: Vec; door: Vec; width: number };
  cast: SundialCast[];
  notes: string[];
}

const unit = (v: Vec): Vec => {
  const d = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / d, v[1] / d];
};
const inRing = (p: Vec, ring: Vec[]): boolean => {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
};
/** Where the line through `p` along `dir` leaves the ring, forward and back (the chord's ends). */
function chordEnds(ring: Vec[], p: Vec, dir: Vec): [Vec, Vec] | undefined {
  let fwd = Infinity, back = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
    const u = ((a[0] - p[0]) * dir[1] - (a[1] - p[1]) * dir[0]) / den;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (t >= 0 && t < fwd) fwd = t;
    if (t < 0 && t > back) back = t;
  }
  if (!Number.isFinite(fwd) || !Number.isFinite(back)) return undefined;
  return [[p[0] + dir[0] * fwd, p[1] + dir[1] * fwd], [p[0] + dir[0] * back, p[1] + dir[1] * back]];
}

/**
 * The inside of the tower: the time device in the middle (a brass gear let into the floor, the
 * orrery on it, the great wheel beside it, three levers before it, toward the door), the carved
 * face just inside the door looking in, the stair up behind a wall across the far side with the
 * locked gate in it, and the cast frozen on the free floor round the machine, facing it, out of
 * the doorway (deterministic for the seed).
 */
export function dressTower(inp: TowerInput): TowerOut {
  const { ctx, zone, ring, centre: c, door } = inp;
  const { cat } = ctx;
  const notes: string[] = [];
  const R = ring.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / ring.length;
  const inward = unit([c[0] - door[0], c[1] - door[1]]);
  const side: Vec = [-inward[1], inward[0]];
  // Positions along the door-to-far-wall axis (x, from the centre) and across it (y).
  const at = (x: number, y: number): Vec => [c[0] + inward[0] * x + side[0] * y, c[1] + inward[1] * x + side[1] * y];
  const find = (name: RegExp, pack?: RegExp): AssetRecord | undefined => cat.index.assets.find((a) => a.kind === "object" && !a.error && name.test(a.name) && (!pack || pack.test(cat.packs.get(a.pack)?.name ?? "")));
  const put = (asset: AssetRecord, role: string, p: Vec, rot: number, scale: number, layer: number, key: string, occupy: "force" | "low" = "force") =>
    place(ctx, { asset, role, at: p, rot, scale, layer, zone, feature: "sundial", key, occupy, light: false });
  /** Floor the pieces take, as boxes in (x, y) along the axes above, for the cast to keep off. */
  const taken: Array<{ x: number; y: number; w: number; h: number }> = [];
  const take = (x: number, y: number, w: number, h: number) => taken.push({ x, y, w, h });
  const facing = Math.atan2(inward[1], inward[0]);

  const gear = find(/^Gear 3 - Brass$/, /Clockwork Construction/);
  const orrery = find(/^Feature - Orrery - Huge - Gold$/, /Furniture Map Assets/);
  const wheel = find(/^Wheel - Large 1 - 1x2$/, /Caravan Bastion/);
  const levers = [find(/^Lever - Switch 1$/, /Crystal Crypts/), find(/^Lever - Switch 2$/, /Crystal Crypts/), find(/^Lever - Switch 3$/, /Crystal Crypts/)];
  if (gear) put(gear, "gear", c, 0, 1.1, LAYER.rug, "sundial/gear", "low");
  if (orrery) put(orrery, "device", c, 0, 1.15, LAYER.furniture, "sundial/device");
  else notes.push("sundial: no orrery in the library for the device");
  take(0, 0, 3.6, 3.6);
  if (wheel) {
    put(wheel, "wheel", at(0, 2.5), facing, 1.3, LAYER.furniture, "sundial/wheel");
    take(0, 2.5, 2.4, 2.4);
  }
  levers.forEach((lv, i) => {
    if (!lv) return;
    put(lv, "lever", at(-2.6, (i - 1) * 1.1), facing + Math.PI / 2, 1.2, LAYER.furniture, `sundial/lever#${i + 1}`);
    take(-2.6, (i - 1) * 1.1, 1, 1);
  });
  const bust = find(/^Statue - Bust 2A$/, /1900s Misc/);
  if (bust) {
    put(bust, "face", at(-(R - 1.0), 1.7), rotationFor(bust, inward), 1.9, LAYER.furniture, "sundial/face");
    take(-(R - 1.0), 1.7, 1.2, 1.2);
  } else notes.push("sundial: no bust in the library for the face");

  // The gate: a wall across the far side, as far back as the machine allows, the locked door in the middle of it.
  let gate: TowerOut["gate"];
  const far = chordEnds(ring, c, inward);
  const depthAll = far ? Math.hypot(far[0][0] - c[0], far[0][1] - c[1]) : R;
  const d = Math.max(2.7, Math.min(depthAll - 1.6, R - 2.4));
  const ends = chordEnds(ring, at(d, 0), side);
  if (ends && depthAll - d >= 1.2) {
    const chord = Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]);
    const width = Math.min(1.6, Math.max(1, chord - 1.2));
    gate = { a: ends[0], b: ends[1], door: at(d, 0), width };
    const depth = depthAll - d;
    const spiral = find(/^Spiral Staircase - Brass$/, /Clockwork Construction/);
    const straight = find(/^Stairs - Up 1 - 3x2$/, /Buildings Pack/) ?? cat.index.assets.find((a) => a.kind === "object" && !a.error && /stairs?\b.*\bup\b/i.test(a.name));
    const stair = depth >= 2.2 && spiral ? spiral : straight ?? spiral;
    if (stair) {
      const size = Math.max(...(stair.footprint ?? [1, 1]));
      const scale = Math.min(1, (depth - 0.3) / size);
      put(stair, "stairs", at(d + depth / 2 + 0.05, 0), stair === spiral ? 0 : rotationFor(stair, [-inward[0], -inward[1]]), Math.max(0.6, scale), LAYER.furniture, "sundial/stair");
    } else notes.push("sundial: no stair in the library");
  } else notes.push("sundial: the tower is too small for the gate and the stair");

  // The cast, frozen where they stood: on free floor round the machine, out of the doorway and the alcove, facing the machine.
  const cast: SundialCast[] = [];
  const spots: Vec[] = [];
  const clear = (p: Vec, x: number, y: number) =>
    inRing(p, ring)
    && Math.hypot(p[0] - door[0], p[1] - door[1]) >= 1.7
    && ring.every((q, i) => {
      const r = ring[(i + 1) % ring.length]!;
      const ex = r[0] - q[0], ey = r[1] - q[1];
      const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * ex + (p[1] - q[1]) * ey) / (ex * ex + ey * ey || 1)));
      return Math.hypot(p[0] - q[0] - ex * t, p[1] - q[1] - ey * t) >= 0.75;
    })
    && (!gate || x < d - 1.1)
    && taken.every((b) => Math.abs(x - b.x) >= b.w / 2 + 0.6 || Math.abs(y - b.y) >= b.h / 2 + 0.6)
    && spots.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) >= 1.05);
  for (const m of inp.cast ?? []) {
    let found: Vec | undefined, fx = 0, fy = 0;
    for (let k = 0; k < 60 && !found; k++) {
      const r = ctx.rng.range(2.6, Math.max(2.7, R - 0.9)), th = ctx.rng.range(0, Math.PI * 2);
      const x = Math.cos(th) * r, y = Math.sin(th) * r;
      const p = at(x, y);
      if (clear(p, x, y)) [found, fx, fy] = [p, x, y];
    }
    if (!found) {
      notes.push(`sundial: no floor left for ${m.name}`);
      continue;
    }
    void fx; void fy;
    spots.push(found);
    cast.push({ ...m, x: found[0], y: found[1], facing: unit([c[0] - found[0], c[1] - found[1]]) });
  }
  return { gate, cast, notes };
}
