/**
 * The sundial set piece (DESIGN.md section 38): a clock dial etched round a tower, twelve Roman
 * numerals on a ring, gems set into three of them, and the tower's three spires as the hands.
 * Their shadows are tiles Foundry draws and the GM turns; a gem lights when the hand it answers
 * to (the GM's secret) rests on it. Seen from below (the vestibule under the dial) the numerals
 * run the other way, and the time device and the carved face stand in the room.
 *
 * Everything here is geometry in squares; the street map converts its metres first.
 */

import type { AssetRecord } from "../assets/model";
import { Cell, LAYER, makeCtx, place, rectAt, rotationFor, type DressInput, type DressResult, type Grid, type Placed } from "./dress";
import type { CastMember, GemColor, Hand, SundialPlan } from "./plan";

export const HANDS: readonly Hand[] = ["hour", "minute", "second"];
export const GEM_COLORS: readonly GemColor[] = ["ruby", "sapphire", "topaz", "emerald", "amethyst"];
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

/** Each gem's colour on the map and in Foundry's light. */
export const GEM_RGB: Record<GemColor, string> = { ruby: "#b3202e", sapphire: "#2b55b8", topaz: "#e0a31f", emerald: "#2f9a55", amethyst: "#8a3fb3" };

/** A hand's shadow: how far it reaches from the tower and how wide it is (squares), and how dark. */
export interface SundialHand {
  hand: Hand;
  /** The numeral it points at (1..12). */
  numeral: number;
  length: number;
  width: number;
  alpha: number;
}

export interface SundialGem {
  numeral: number;
  color: GemColor;
  /** The hand whose shadow lights it: the GM's secret. */
  hand: Hand;
  at: [number, number];
  rgb: string;
}

/** A numeral cut into the ground: text, its centre, its turn (radians, clockwise on screen) and its height. */
export interface SundialEtching {
  text: string;
  at: [number, number];
  rot: number;
  size: number;
}

/** Someone frozen on the floor of the vestibule (a token in Foundry), in squares. */
export interface SundialCast extends CastMember {
  x: number;
  y: number;
  facing: [number, number];
}

/** What a built map knows about its dial: for the renderer (etchings) and for Foundry (tiles, lights, the door, the cast). */
export interface SundialOut {
  /** Shared by the plaza and the vestibule under it, so the GM's crank turns both. */
  key?: string;
  /** The pivot (the tower's centre), squares. */
  at: [number, number];
  radius: number;
  /** Seen from below: numerals run the other way round. */
  mirrored: boolean;
  stopped: Record<Hand, number>;
  hands: SundialHand[];
  gems: SundialGem[];
  etchings: SundialEtching[];
  /** The hour shadow's tip: where the way down lies (plaza only). */
  door?: [number, number];
  /** The place built below the dial (its pin goes on the door). */
  belowPlace?: string;
  cast?: SundialCast[];
}

/** Direction of numeral n (1..12) on screen: XII up, then clockwise; mirrored, anticlockwise. */
export function numeralDir(n: number, mirrored = false): [number, number] {
  const a = (n % 12) * (Math.PI / 6) - Math.PI / 2;
  return [Math.cos(a) * (mirrored ? -1 : 1), Math.sin(a)];
}

/** A hand's turn in degrees for Foundry (clockwise), 0 at XII. */
export function handRotation(numeral: number, mirrored = false): number {
  const deg = (numeral % 12) * 30;
  return mirrored ? (360 - deg) % 360 : deg;
}

/** The dial's geometry round a pivot: numerals, gems, hands and the door, in squares. */
export function dialGeometry(spec: SundialPlan, at: [number, number], radius: number, mirrored: boolean): Omit<SundialOut, "cast" | "belowPlace" | "key"> {
  const R = radius;
  const point = (n: number, r: number): [number, number] => {
    const d = numeralDir(n, mirrored);
    return [at[0] + d[0] * r, at[1] + d[1] * r];
  };
  const etchings: SundialEtching[] = ROMAN.map((text, i) => {
    const n = i + 1;
    const d = numeralDir(n, mirrored);
    // The numeral's foot points at the tower: readable walking round the ring.
    return { text, at: point(n, R), rot: Math.atan2(d[1], d[0]) + Math.PI / 2, size: Math.max(0.7, Math.min(1.4, R * 0.14)) };
  });
  const gems: SundialGem[] = spec.gems.map((g) => ({ numeral: g.numeral, color: g.color, hand: g.hand, at: point(g.numeral, R - 1), rgb: GEM_RGB[g.color] }));
  const hands: SundialHand[] = [
    { hand: "hour", numeral: spec.stopped.hour, length: R - 0.3, width: 1, alpha: 0.55 },
    { hand: "minute", numeral: spec.stopped.minute, length: R + 0.15, width: 0.55, alpha: 0.5 },
    { hand: "second", numeral: spec.stopped.second, length: R + 0.6, width: 0.22, alpha: 0.6 },
  ];
  return { at, radius: R, mirrored, stopped: { ...spec.stopped }, hands, gems, etchings, ...(mirrored ? {} : { door: point(spec.stopped.hour, R - 0.35) }) };
}

/** Which gems light up when the hands stand at `hands` (numeral per hand): the ones under their own hand. */
export function litGems(gems: Array<{ numeral: number; hand: Hand }>, hands: Record<Hand, number>): boolean[] {
  return gems.map((g) => ((hands[g.hand] % 12) + 12) % 12 === g.numeral % 12);
}

type Vec = [number, number];

/**
 * The room under the dial (plan.sundial.zone), after its furniture is placed: the numerals show
 * through the ceiling the other way round (the renderer etches them on the floor), the time device
 * stands in the middle (a brass gear let into the floor, the orrery on it, the great wheel beside it
 * and three levers before it), the carved face waits beside the stair, and the cast (plan.cast)
 * stands frozen between the stair and the machine, each a step into the room.
 */
export function dressSundial(input: DressInput, inside: DressResult & { grid: Grid }): { placed: Placed[]; sundial: SundialOut; notes: string[] } | undefined {
  const { plan, layout, cat } = input;
  const spec = plan.sundial;
  if (!spec?.zone) return undefined;
  const z = layout.zones.find((x) => x.id === spec.zone);
  if (!z) return undefined;
  const ctx = makeCtx(input, inside.grid, "sundial");
  const notes: string[] = [];
  const r = z.rect;
  const c: Vec = [r.x + r.w / 2, r.y + r.h / 2];
  const R = spec.radius ?? Math.max(3, Math.min(r.w, r.h) / 2 - 2.4);
  const geo = dialGeometry(spec, c, R, true);
  const find = (name: RegExp, pack?: RegExp): AssetRecord | undefined => cat.index.assets.find((a) => a.kind === "object" && !a.error && name.test(a.name) && (!pack || pack.test(cat.packs.get(a.pack)?.name ?? "")));
  const toward = (from: Vec, to: Vec): Vec => {
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [(to[0] - from[0]) / d, (to[1] - from[1]) / d];
  };
  const entry = layout.doors.find((d) => d.between[0] === z.id && d.between[1] === "outside") ?? layout.doors.find((d) => d.between[1] === "outside");
  const inward: Vec = entry ? toward(entry.at, c) : [0, -1];
  const side: Vec = [-inward[1], inward[0]];
  const put = (asset: AssetRecord, role: string, at: Vec, rot: number, scale: number, layer: number, key: string, occupy: "force" | "low" = "force") =>
    place(ctx, { asset, role, at, rot, scale, layer, zone: z.id, feature: "sundial", key, occupy, light: false });
  const solid = (at: Vec, size: Vec) => ctx.grid.mark(rectAt(at, size), Cell.Solid);

  const gear = find(/^Gear 3 - Brass$/, /Clockwork Construction/);
  const orrery = find(/^Feature - Orrery - Huge - Gold$/, /Furniture Map Assets/);
  const wheel = find(/^Wheel - Large 1 - 1x2$/, /Caravan Bastion/);
  const levers = [find(/^Lever - Switch 1$/, /Crystal Crypts/), find(/^Lever - Switch 2$/, /Crystal Crypts/), find(/^Lever - Switch 3$/, /Crystal Crypts/)];
  const facing = Math.atan2(inward[1], inward[0]);
  if (gear) put(gear, "gear", c, 0, 1.1, LAYER.rug, "sundial/gear", "low");
  if (orrery) put(orrery, "device", c, 0, 1.15, LAYER.furniture, "sundial/device");
  else notes.push("sundial: no orrery in the library for the device");
  solid(c, [3.6, 3.6]);
  if (wheel) {
    const at: Vec = [c[0] + side[0] * 2.5, c[1] + side[1] * 2.5];
    put(wheel, "wheel", at, facing, 1.3, LAYER.furniture, "sundial/wheel");
    solid(at, [1.5, 2.3]);
  }
  levers.forEach((lv, i) => {
    if (!lv) return;
    const at: Vec = [c[0] - inward[0] * 2.7 + side[0] * (i - 1) * 1.1, c[1] - inward[1] * 2.7 + side[1] * (i - 1) * 1.1];
    put(lv, "lever", at, facing + Math.PI / 2, 1.2, LAYER.furniture, `sundial/lever#${i + 1}`);
    solid(at, [1, 1]);
  });
  const bust = find(/^Statue - Bust 2A$/, /1900s Misc/);
  if (bust && entry) {
    const at: Vec = [entry.at[0] + inward[0] * 1.3 + side[0] * 1.5, entry.at[1] + inward[1] * 1.3 + side[1] * 1.5];
    put(bust, "face", at, rotationFor(bust, inward), 1.9, LAYER.furniture, "sundial/face");
    solid(at, [1.2, 1.2]);
  } else if (!bust) notes.push("sundial: no bust in the library for the face");

  const cast: SundialCast[] = [];
  const n = plan.cast?.length ?? 0;
  const from: Vec = entry ? [entry.at[0] + inward[0] * 2, entry.at[1] + inward[1] * 2] : [c[0] - inward[0] * (R - 1), c[1] - inward[1] * (R - 1)];
  const to: Vec = [c[0] - inward[0] * 3.6, c[1] - inward[1] * 3.6];
  plan.cast?.forEach((m, i) => {
    const t = n > 1 ? 0.12 + (0.76 * i) / (n - 1) : 0.5;
    const lateral = (i % 2 === 0 ? 1 : -1) * (0.7 + ((i >> 1) % 3) * 1.2);
    let at: Vec | undefined;
    for (let k = 0; k < 24 && !at; k++) {
      const jx = k === 0 ? 0 : ctx.rng.range(-1.6, 1.6), jy = k === 0 ? 0 : ctx.rng.range(-1.6, 1.6);
      const p: Vec = [from[0] + (to[0] - from[0]) * t + side[0] * lateral + jx, from[1] + (to[1] - from[1]) * t + side[1] * lateral + jy];
      if (p[0] < r.x + 0.7 || p[1] < r.y + 0.7 || p[0] > r.x + r.w - 0.7 || p[1] > r.y + r.h - 0.7) continue;
      if (!ctx.grid.fits(rectAt(p, [0.9, 0.9]), (cv) => cv === Cell.Free)) continue;
      at = p;
    }
    if (!at) {
      notes.push(`sundial: no floor left for ${m.name}`);
      return;
    }
    solid(at, [0.9, 0.9]);
    cast.push({ ...m, x: at[0], y: at[1], facing: toward(at, c) });
  });
  return { placed: ctx.placed, sundial: { ...geo, key: spec.key, ...(cast.length ? { cast } : {}) }, notes };
}
