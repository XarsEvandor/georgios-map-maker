/**
 * Townsfolk for building-level maps, standing where the furniture says they would be: patrons
 * on a tavern's chairs, stools and benches, a barkeep behind the bar, a cook at the oven, a
 * sleeper in a guest bed at night; worshippers on the pews and a priest at the altar; guards at a
 * keep's door and nobles at its table; a wizard at the desk; on street maps, vendors under the
 * market stalls with shoppers in front, guards at the gates in the city wall, sailors on the
 * ships, dockworkers at the cargo and passers-by at house doors. Busy by day and busier in the
 * evening, few at night. Nobody stands in a wall, a building, the water, a piece of furniture
 * or another person. Positions are in squares; deterministic for a seed.
 */

import { PX_PER_SQUARE } from "../assets/model";
import { parseVector2, parseVector2Array } from "../ddmap/godot";
import type { Placed } from "./dress";
import type { Layout, LayoutZone } from "./layout";
import { Rng } from "./rng";
import { TRADES, type Trade } from "../city/shops";

export type PersonKind = "commoner" | "noble" | "guard" | "knight" | "veteran" | "thug" | "priest" | "acolyte" | "mage" | "apprentice" | "minstrel";

export interface Person {
  kind: PersonKind;
  /** What they are doing here: "patron", "barkeep", "worshipper"... */
  role: string;
  name: string;
  /** Centre, in squares. */
  x: number;
  y: number;
  /** The way they face (unit vector, screen axes). */
  facing: [number, number];
  asleep?: boolean;
}

export interface PeopleInput {
  layout: Layout;
  placed: Placed[];
  /** The Dungeondraft map: walls, doors, water and piers. */
  map: Record<string, any>;
  /** Node id -> what the element is (water, piers, city walls, houses). */
  elements: Record<string, { kind: string; key: string }>;
  seed: string | number;
  time?: "day" | "dusk" | "night";
  /** At most this many (default 40). */
  max?: number;
}

type V = [number, number];
type Time = "day" | "dusk" | "night";

/** Given names, for the token labels. */
const NAMES = (
  "Aldric Ambrose Anselm Arnulf Baldwin Bartram Benedict Bertram Cedric Clement Conrad Cuthbert Drogo Edmund Elias Emeric Eustace Fulk Gerard Gilbert Giles Godric Hamon Hugh Ivo Jasper " +
  "Jocelin Lambert Leofric Lionel Manfred Milo Odo Osric Piers Ralf Reynard Roger Rolf Simon Tancred Theobald Tobin Ulric Walter Warin Wystan Adela Agatha Agnes Alys Amice Avice Beatrix " +
  "Berta Cecily Clarice Constance Edith Elva Emma Ermina Felicia Gisela Hawise Helewise Ida Isolde Joan Juliana Lettice Mabel Margery Maud Millicent Muriel Nesta Petronel Rohese Rosamund " +
  "Sabine Sybil Theophania Ursula Wenna Ysolde"
).split(" ");

/** Pieces nobody bumps into: floor marks, rugs, things on tables, things on walls or overhead. */
const OPEN = new Set([
  "rug", "runner", "stain", "dirt", "grime", "cobweb", "puddle", "crack", "groundcover", "grass", "flowers", "leaves", "crops", "straw", "bones", "blood", "scorch", "mushroom",
  "paper_scatter", "scroll", "debris", "sconce", "chandelier", "painting", "tree", "plate", "mug", "cutlery", "food", "bottle", "candle", "book", "trinket", "skull", "cookware", "rope",
]);
/** Roof art on street maps: the walls already say where a building stands. */
const ROOFS = new Set(["house", "tavern", "warehouse", "church", "keep", "guildhall", "stable", "gate"]);
const SHIPS: Record<string, number> = { ship_large: 3, ship_medium: 2, ship_small: 1, barge: 1 };

const busy: Record<Time, number> = { day: 0.5, dusk: 0.8, night: 0.3 };

/** Who lies in the beds and sits at the tables of a room inside a building on a street map. */
interface Folk { kinds: Array<[PersonKind, number]>; role: string; p: Record<Time, number> }
const IN_BEDS: Record<string, Folk> = {
  "service.infirmary": { kinds: [["commoner", 6], ["guard", 1]], role: "patient", p: { day: 0.5, dusk: 0.5, night: 0.6 } },
  "guard.barracks": { kinds: [["guard", 1]], role: "guard", p: { day: 0.15, dusk: 0.3, night: 0.7 } },
  "gaol.cell": { kinds: [["thug", 2], ["commoner", 2]], role: "prisoner", p: { day: 0.75, dusk: 0.75, night: 0.8 } },
  "underworld.squat": { kinds: [["commoner", 1]], role: "beggar", p: { day: 0.4, dusk: 0.6, night: 0.8 } },
  "underworld.hideout": { kinds: [["thug", 1]], role: "thief", p: { day: 0.4, dusk: 0.2, night: 0.3 } },
  "gothic.bedroom": { kinds: [["noble", 1]], role: "noble", p: { day: 0, dusk: 0, night: 0.6 } },
};
const AT_TABLES: Record<string, Folk> = {
  "underworld.den": { kinds: [["thug", 3], ["commoner", 1]], role: "thief", p: { day: 0.35, dusk: 0.6, night: 0.6 } },
  "underworld.gambling": { kinds: [["commoner", 3], ["thug", 2], ["noble", 1]], role: "gambler", p: { day: 0.3, dusk: 0.7, night: 0.7 } },
  "guard.mess": { kinds: [["guard", 4], ["veteran", 1]], role: "guard", p: { day: 0.35, dusk: 0.6, night: 0.1 } },
  "guard.post": { kinds: [["guard", 1]], role: "guard", p: { day: 0.6, dusk: 0.6, night: 0.6 } },
  "gaol.guardroom": { kinds: [["guard", 1]], role: "gaoler", p: { day: 0.6, dusk: 0.6, night: 0.5 } },
  "guard.office": { kinds: [["veteran", 1], ["knight", 1]], role: "captain", p: { day: 0.7, dusk: 0.4, night: 0 } },
  "gothic.dining": { kinds: [["noble", 1]], role: "noble", p: { day: 0.15, dusk: 0.6, night: 0 } },
  "gothic.study": { kinds: [["noble", 1]], role: "noble", p: { day: 0.5, dusk: 0.3, night: 0 } },
  "tavern.common_room": { kinds: [["commoner", 8], ["thug", 1], ["guard", 1]], role: "patron", p: { day: 0.2, dusk: 0.55, night: 0.4 } },
};
const SEAT_TYPES = new Set(["chair", "stool", "bench", "armchair", "sofa"]);
/** The trade whose main room this is (a counter there gets its keeper). */
const TRADE_OF_ROOM = new Map((Object.entries(TRADES) as Array<[Trade, (typeof TRADES)[Trade]]>).map(([t, info]) => [info.room, t]));
const BED_TYPES = new Set(["bed_single", "bed_double", "cot", "mat"]);

interface Box { p: Placed; cx: number; cy: number; ux: number; uy: number; hw: number; hh: number }

/** The piece's own rectangle (its footprint is the box around it after rotation). */
function boxOf(p: Placed, shrink = 1): Box {
  const [W, H] = p.footprint;
  const c = Math.abs(Math.cos(p.rotation)), s = Math.abs(Math.sin(p.rotation)), det = c * c - s * s;
  let w = W, h = H;
  if (Math.abs(det) > 0.25) { w = (c * W - s * H) / det; h = (c * H - s * W) / det; }
  if (!(w > 0.05 && h > 0.05)) w = h = Math.sqrt(W * H);
  const [cx, cy] = p.center ?? [p.x, p.y];
  return { p, cx, cy, ux: Math.cos(p.rotation), uy: Math.sin(p.rotation), hw: (w / 2) * shrink, hh: (h / 2) * shrink };
}

const local = (b: Box, x: number, y: number): V => { const dx = x - b.cx, dy = y - b.cy; return [dx * b.ux + dy * b.uy, -dx * b.uy + dy * b.ux]; };
const boxDist = (b: Box, x: number, y: number) => { const [a, c] = local(b, x, y); return Math.hypot(Math.max(Math.abs(a) - b.hw, 0), Math.max(Math.abs(c) - b.hh, 0)); };
const world = (b: Box, a: number, c: number): V => [b.cx + a * b.ux - c * b.uy, b.cy + a * b.uy + c * b.ux];

/** Half the piece's depth along its facing, and the unit across it. */
function frontOf(b: Box): { f: V; depth: number; across: V; length: number } {
  const f = (b.p.facing ?? [b.ux, b.uy]) as V;
  const alongU = Math.abs(f[0] * b.ux + f[1] * b.uy) > 0.7;
  return { f, depth: alongU ? b.hw : b.hh, across: [-f[1], f[0]], length: alongU ? b.hh : b.hw };
}

function inPoly(p: V, poly: V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

function segDist(p: V, a: V, b: V): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function crosses(a: V, b: V, c: V, d: V): boolean {
  const o = (p: V, q: V, r: V) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

const unit = (v: V): V => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k];

export function placePeople(inp: PeopleInput): Person[] {
  const time: Time = inp.time ?? "day";
  const rng = new Rng(`${inp.seed}:people`);
  const max = inp.max ?? 40;
  const { w: W, h: H } = inp.layout.map;
  const level = inp.map.world?.levels?.["0"] ?? {};
  const k = 1 / PX_PER_SQUARE;
  const toSq = (p: readonly [number, number]): V => [p[0] * k, p[1] * k];
  const keyOf = (id: unknown) => inp.elements[String(id)]?.key ?? "";

  // Walls (as segments), buildings (closed house walls), doors.
  const segs: Array<[V, V]> = [];
  const houses: V[][] = [];
  const cityWalls: V[][] = [];
  const doors: Array<{ at: V; dir: V; house?: V[] }> = [];
  for (const wl of level.walls ?? []) {
    const pts = parseVector2Array(wl.points).map(toSq);
    const n = wl.loop ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) segs.push([pts[i]!, pts[(i + 1) % pts.length]!]);
    const key = keyOf(wl.node_id);
    const closed = wl.loop || (pts.length > 3 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < 0.05);
    if (key.startsWith("house") && closed) houses.push(pts);
    if (key.startsWith("citywall")) cityWalls.push(pts);
    for (const pt of wl.portals ?? []) {
      if (/window/i.test(pt.texture ?? "")) continue;
      doors.push({ at: toSq(parseVector2(pt.position)), dir: pt.direction ? unit(parseVector2(pt.direction) as V) : [1, 0], house: key.startsWith("house") && closed ? pts : undefined });
    }
  }
  // Water, less the piers and the wharf over it.
  const water: V[][] = [], decks: V[][] = [];
  for (const pt of level.patterns ?? []) {
    const key = keyOf(pt.node_id);
    if (!/^(water|pier|wharf)/.test(key)) continue;
    const off = pt.position ? toSq(parseVector2(pt.position)) : [0, 0];
    const poly = parseVector2Array(pt.points).map((q) => add(toSq(q), off as V));
    (key.startsWith("water") ? water : decks).push(poly);
  }
  const wet = (p: V) => water.some((w) => inPoly(p, w)) && !decks.some((d) => inPoly(p, d));

  const blockers: Box[] = inp.placed
    .filter((p) => p.layer >= 300 && !OPEN.has(p.type) && !ROOFS.has(p.type))
    .map((p) => boxOf(p, p.type === "tower" ? 0.6 : 1));
  const people: Person[] = [];
  const zoneById = new Map(inp.layout.zones.map((z) => [z.id, z]));
  let names = rng.shuffle([...NAMES]);
  const nameOf = () => { if (!names.length) names = rng.shuffle([...NAMES]); return names.pop()!; };

  const spaced = (p: V, gap = 0.8) => !people.some((q) => Math.hypot(q.x - p[0], q.y - p[1]) < gap);
  /** A spot a person can stand on. */
  const free = (p: V, o: { zone?: LayoutZone; ignore?: Placed; from?: V; tol?: number; indoors?: V[] } = {}): boolean => {
    if (p[0] < 0.5 || p[1] < 0.5 || p[0] > W - 0.5 || p[1] > H - 0.5) return false;
    if (!spaced(p)) return false;
    if (o.zone && !o.zone.outdoor) {
      const r = o.zone.rect;
      if (p[0] < r.x + 0.4 || p[1] < r.y + 0.4 || p[0] > r.x + r.w - 0.4 || p[1] > r.y + r.h - 0.4) return false;
    }
    if (segs.some(([a, b]) => segDist(p, a, b) < 0.4)) return false;
    if (blockers.some((b) => b.p !== o.ignore && boxDist(b, p[0], p[1]) < (o.tol ?? 0.3))) return false;
    // Out of the houses, unless placing someone inside this one.
    if (o.indoors ? !inPoly(p, o.indoors) || houses.some((hs) => hs !== o.indoors && inPoly(p, hs)) : houses.some((hs) => inPoly(p, hs))) return false;
    if (wet(p)) return false;
    if (o.from && segs.some(([a, b]) => crosses(o.from!, p, a, b))) return false;
    return true;
  };
  const add1 = (kind: PersonKind, role: string, p: V, facing: V, asleep = false) => {
    if (people.length >= max) return false;
    people.push({ kind, role, name: nameOf(), x: Math.round(p[0] * 100) / 100, y: Math.round(p[1] * 100) / 100, facing: unit(facing), ...(asleep ? { asleep } : {}) });
    return true;
  };
  const mix = (weights: Array<[PersonKind, number]>) => rng.weighted(weights, (x) => x[1])[0];
  const towards = (from: V, to: V): V => unit([to[0] - from[0], to[1] - from[1]]);
  const randomDir = (): V => { const a = rng.range(0, Math.PI * 2); return [Math.cos(a), Math.sin(a)]; };
  /** A free spot round a piece, facing it. */
  const beside = (b: Box, zone: LayoutZone | undefined, gap = 0.75): V | undefined => {
    const r = Math.max(b.hw, b.hh) + gap;
    const start = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 12; i++) {
      const a = start + (i * Math.PI) / 6;
      const lp = world(b, Math.cos(a) * (b.hw + gap), Math.sin(a) * (b.hh + gap));
      const p = Math.hypot(lp[0] - b.cx, lp[1] - b.cy) > r ? add([b.cx, b.cy], unit([lp[0] - b.cx, lp[1] - b.cy]), r) : lp;
      if (free(p, { zone, ignore: b.p, from: [b.cx, b.cy] })) return p;
    }
    return undefined;
  };
  /** Seats along a bench, pew or sofa (one per square or so). */
  const seats = (b: Box): V[] => {
    const { length } = frontOf(b);
    const n = Math.max(1, Math.floor((length * 2) / 0.95));
    const alongU = Math.abs((b.p.facing?.[0] ?? b.ux) * b.ux + (b.p.facing?.[1] ?? b.uy) * b.uy) > 0.7;
    return Array.from({ length: n }, (_, i) => { const t = (i - (n - 1) / 2) * ((length * 2) / n); return alongU ? world(b, 0, t) : world(b, t, 0); });
  };
  const pieces = (zone: string, types: string[]) => inp.placed.filter((p) => p.zone === zone && types.includes(p.type)).map((p) => boxOf(p));
  const sit = (b: Box, chance: number, who: () => [PersonKind, string]) => {
    const many = ["bench", "pew", "sofa"].includes(b.p.type);
    for (const s of many ? seats(b) : [[b.cx, b.cy] as V]) {
      if (rng.next() >= chance || !spaced(s, 0.7)) continue;
      const [kind, role] = who();
      add1(kind, role, s, (b.p.facing ?? [0, 1]) as V);
    }
  };
  /** Someone standing in the open in a room, near one of the given pieces if any. */
  const standing = (zone: LayoutZone, kind: PersonKind, role: string, near: Box[], face?: V) => {
    for (const b of rng.shuffle([...near])) {
      const p = beside(b, zone, 0.8);
      if (p) return add1(kind, role, p, face ?? towards(p, [b.cx, b.cy]));
    }
    const r = zone.rect;
    for (let i = 0; i < 30; i++) {
      const p: V = [rng.range(r.x + 0.8, r.x + r.w - 0.8), rng.range(r.y + 0.8, r.y + r.h - 0.8)];
      if (free(p, { zone })) return add1(kind, role, p, face ?? towards(p, [r.x + r.w / 2, r.y + r.h / 2]));
    }
    return false;
  };
  /** Behind a counter or altar (the side away from its front), else in front of it. */
  const behind = (b: Box, zone: LayoutZone, kind: PersonKind, role: string, frontToo = true) => {
    const { f, depth, across, length } = frontOf(b);
    const offs = [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4].filter((o) => Math.abs(o) <= Math.max(0, length - 0.4));
    // Behind a bar there is often only a narrow strip: standing against the barrels is fine.
    for (const tol of [0.3, 0.02]) for (const d of [0.5, 0.7]) for (const o of offs) {
      const p = add(add([b.cx, b.cy], f, -(depth + d)), across, o);
      if (free(p, { zone, ignore: b.p, tol })) return add1(kind, role, p, f);
    }
    if (frontToo) for (const o of offs) {
      const p = add(add([b.cx, b.cy], f, depth + 0.6), across, o);
      if (free(p, { zone, ignore: b.p })) return add1(kind, role, p, f);
    }
    return false;
  };
  /** Behind a bar, measured from the customers' edge (bars come straight or L-shaped). */
  const behindBar = (b: Box, zone: LayoutZone) => {
    const { f, depth, across, length } = frontOf(b);
    const offs = [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4].filter((o) => Math.abs(o) <= Math.max(0, length - 0.4));
    for (const tol of [0.3, 0.02]) for (const d of [1.6, 1.45, 1.8, 2.1]) for (const o of offs) {
      const p = add(add([b.cx, b.cy], f, depth - d), across, o);
      if (free(p, { zone, ignore: b.p, tol })) return add1("commoner", "barkeep", p, f);
    }
    return false;
  };
  /** In front of a piece, facing it (a cook at the oven). */
  const atFront = (b: Box, zone: LayoutZone, kind: PersonKind, role: string) => {
    const { f, depth } = frontOf(b);
    for (const o of [0, 0.5, -0.5]) {
      const p = add(add([b.cx, b.cy], f, depth + 0.55), [-f[1], f[0]], o);
      if (free(p, { zone, ignore: b.p, from: [b.cx, b.cy] })) return add1(kind, role, p, [-f[0], -f[1]]);
    }
    return standing(zone, kind, role, [b]);
  };
  const sleep = (zone: string, kind: PersonKind, role: string, chance: number) => {
    for (const b of pieces(zone, ["bed_double", "bed_single"])) if (rng.next() < chance && spaced([b.cx, b.cy])) add1(kind, role, [b.cx, b.cy], (b.p.facing ?? [0, 1]) as V, true);
  };

  const hasHall = inp.layout.zones.some((z) => z.type === "gothic.hall");
  const patron = (): [PersonKind, string] => [mix([["commoner", 72], ["thug", 10], ["guard", 7], ["noble", 6], ["veteran", 5]]), "patron"];
  const B = busy[time];

  for (const z of inp.layout.zones) {
    const t = z.type;
    if (t === "tavern.common_room") {
      for (const b of pieces(z.id, ["bar_counter"])) behindBar(b, z);
      for (const b of rng.shuffle(pieces(z.id, ["chair", "stool", "bench", "armchair"]))) sit(b, b.p.feature === "bar" ? B * 0.8 : B, patron);
      const tables = pieces(z.id, ["table_small", "table_medium", "table_long", "table_set"]);
      if (B >= 0.5 && tables.length) standing(z, "commoner", "server", tables);
      if (people.filter((p) => p.role === "patron").length > 12) standing(z, "commoner", "server", tables);
      if (rng.next() < (time === "day" ? 0.25 : 0.65)) standing(z, "minstrel", "minstrel", pieces(z.id, ["fireplace", "instrument_large"]));
    } else if (t === "tavern.kitchen") {
      const ovens = pieces(z.id, ["oven", "fireplace", "stove"]);
      if (ovens[0]) atFront(ovens[0], z, "commoner", "cook");
      else standing(z, "commoner", "cook", pieces(z.id, ["workbench", "counter"]));
      if (rng.next() < 0.5) standing(z, "commoner", "kitchen hand", pieces(z.id, ["workbench", "counter", "pot_large"]));
    } else if (t === "tavern.storage" || t === "tavern.cellar") {
      if (rng.next() < 0.25) standing(z, "commoner", "cellarman", pieces(z.id, ["barrel", "crate", "sack"]));
    } else if (t === "tavern.guest_room") {
      if (time === "night") sleep(z.id, "commoner", "guest, asleep", 0.8);
      else if (rng.next() < 0.25) standing(z, "commoner", "guest", pieces(z.id, ["side_table", "table_small", "chest"]));
    } else if (t === "gothic.nave") {
      const altar = pieces(z.id, ["altar"])[0];
      if (altar && time !== "night") behind(altar, z, "priest", "priest");
      const extras = pieces(z.id, ["lectern", "font", "candelabra", "statue"]);
      for (let i = 0; i < (time === "night" ? 1 : 2); i++) standing(z, "acolyte", "acolyte", extras);
      const pray = { day: 0.3, dusk: 0.45, night: 0.08 }[time];
      for (const b of pieces(z.id, ["pew", "bench", "chair"])) sit(b, pray, () => [mix([["commoner", 85], ["noble", 10], ["guard", 5]]), "worshipper"]);
    } else if (t === "gothic.vestry") {
      if (rng.next() < 0.4) standing(z, "acolyte", "acolyte", pieces(z.id, ["chest", "wardrobe", "cabinet"]));
    } else if (t === "gothic.hall") {
      const door = inp.layout.doors.find((d) => d.main) ?? inp.layout.doors.find((d) => d.between.includes("outside") && d.between.includes(z.id));
      if (door) {
        const n: V = [-door.dir[1], door.dir[0]];
        const r = z.rect, mid: V = [r.x + r.w / 2, r.y + r.h / 2];
        const into: V = (mid[0] - door.at[0]) * n[0] + (mid[1] - door.at[1]) * n[1] > 0 ? n : [-n[0], -n[1]];
        const half = (door.width ?? 1) / 2 + 0.55;
        for (const s of [1, -1]) {
          const inside = add(add(door.at, door.dir, s * half), into, 0.8);
          if (free(inside, { zone: z })) add1("guard", "guard", inside, into);
          for (const d of [0.9, 1.3]) {
            const out = add(add(door.at, door.dir, s * half), into, -d);
            if (free(out)) { add1("guard", "guard at the door", out, [-into[0], -into[1]]); break; }
          }
        }
      }
      if (rng.next() < 0.6) standing(z, mix([["knight", 1], ["veteran", 1]]), "captain of the guard", pieces(z.id, ["statue", "bench", "candelabra"]));
      if (time !== "night") standing(z, "commoner", "servant", []);
    } else if (t === "gothic.dining") {
      const fill = { day: 0.3, dusk: 0.7, night: 0.15 }[time];
      for (const b of rng.shuffle(pieces(z.id, ["chair", "bench", "armchair"]))) sit(b, fill, () => [mix([["noble", 6], ["knight", 2], ["commoner", 2]]), "at table"]);
      if (people.some((p) => p.role === "at table")) standing(z, "commoner", "servant", pieces(z.id, ["cabinet", "table_long", "dresser"]));
    } else if (t === "gothic.study") {
      const who: [PersonKind, string] = hasHall ? ["noble", "lord of the house"] : ["mage", "wizard"];
      if (time !== "night" || !hasHall) {
        const chair = inp.placed.filter((p) => p.zone === z.id && p.type === "chair").map((p) => boxOf(p))[0];
        if (chair && rng.next() < 0.7) add1(who[0], who[1], [chair.cx, chair.cy], (chair.p.facing ?? [0, 1]) as V);
        else standing(z, who[0], who[1], pieces(z.id, ["bookshelf", "globe", "desk"]));
      }
      if (!hasHall && rng.next() < 0.6) standing(z, "apprentice", "apprentice", pieces(z.id, ["bookshelf", "globe", "desk", "table_small"]));
    } else if (t === "gothic.bedroom") {
      if (time === "night") sleep(z.id, hasHall ? "noble" : "mage", hasHall ? "lord of the house, asleep" : "wizard, asleep", 1);
      else if (rng.next() < 0.25) standing(z, "commoner", "servant", pieces(z.id, ["dresser", "wardrobe", "washbasin"]));
    } else if (t === "gothic.ballroom") {
      if (time === "day") standing(z, "commoner", "servant", pieces(z.id, ["table_long", "display_case"]));
      else {
        for (const b of pieces(z.id, ["sofa", "armchair", "chair"])) sit(b, 0.6, () => [mix([["noble", 8], ["knight", 2]]), "guest"]);
        for (let i = 0; i < rng.int(2, 5); i++) standing(z, "noble", "guest", []);
        standing(z, "minstrel", "minstrel", pieces(z.id, ["instrument_large"]));
      }
    } else if (t === "street.area") {
      street(z);
    }
  }

  function street(z: LayoutZone) {
    const pVend = { day: 0.85, dusk: 0.4, night: 0 }[time];
    const pShop = { day: 0.55, dusk: 0.3, night: 0 }[time];
    // Gates in the city wall: the gaps between wall ends, with a guard on each side.
    const ends: V[] = [];
    for (const wl of cityWalls) for (const e of [wl[0]!, wl[wl.length - 1]!]) if (e[0] > 1 && e[1] > 1 && e[0] < W - 1 && e[1] < H - 1) ends.push(e);
    const used = new Set<number>();
    for (let i = 0; i < ends.length; i++) {
      if (used.has(i)) continue;
      let best = -1, bd = Infinity;
      for (let j = 0; j < ends.length; j++) if (j !== i && !used.has(j)) { const d = Math.hypot(ends[i]![0] - ends[j]![0], ends[i]![1] - ends[j]![1]); if (d < bd) { bd = d; best = j; } }
      if (best < 0 || bd < 1.5 || bd > 12) continue;
      used.add(i).add(best);
      const a = ends[i]!, b = ends[best]!, v = unit([b[0] - a[0], b[1] - a[1]]), n: V = [-v[1], v[0]];
      for (const [e, s, side] of [[a, 1, 1], [b, -1, -1]] as Array<[V, number, number]>) {
        for (const d of [0.9, 1.4, 2]) {
          const p = add(add(e, v, s * 0.9), n, side * d);
          if (free(p)) { add1(time === "night" ? mix([["guard", 3], ["veteran", 1]]) : "guard", "gate guard", p, [n[0] * side, n[1] * side]); break; }
        }
      }
      const mid: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (let k2 = 0; k2 < { day: rng.int(1, 3), dusk: rng.int(0, 1), night: 0 }[time]; k2++) {
        const side = rng.next() < 0.5 ? 1 : -1;
        const p = add(add(mid, n, side * rng.range(2.5, 7)), v, rng.range(-1, 1));
        if (free(p)) add1(mix([["commoner", 8], ["noble", 1], ["acolyte", 1]]), "traveller", p, [-n[0] * side, -n[1] * side]);
      }
    }
    // Shops (street maps show houses from inside): the keeper behind the counter, the smith at the
    // anvil, the carpenter at the bench; a customer or two in front by day. Shut at night.
    if (time !== "night") {
      const work = inp.placed.filter((p) => !!p.room && TRADE_OF_ROOM.has(p.room) && (p.feature === "counter" || (p.room === "shop.blacksmith" && p.feature === "anvil") || (p.room === "shop.carpenter" && p.feature === "bench")));
      const served = new Set<string>();
      for (const p of work) {
        const trade = TRADE_OF_ROOM.get(p.room!)!;
        if (served.has(p.key.split("/")[0]!)) continue;
        const b = boxOf(p);
        const home = houses.find((hs) => inPoly([b.cx, b.cy], hs));
        if (!home) continue;
        const keeper = TRADES[trade]?.keeper ?? "shopkeeper";
        const kind: PersonKind = trade === "armourer" ? "veteran" : trade === "jeweller" || trade === "moneylender" ? "noble" : trade === "fence" ? "thug" : "commoner";
        const { f, depth, across, length } = frontOf(b);
        const offs = [0, 0.6, -0.6, 1.2, -1.2].filter((o) => Math.abs(o) <= Math.max(0, length - 0.3));
        let done = false;
        if (p.feature === "counter") {
          for (const tol of [0.3, 0.05]) for (const d of [0.5, 0.75, 1]) for (const o of offs) {
            const q = add(add([b.cx, b.cy], f, -(depth + d)), across, o);
            if (!done && free(q, { ignore: p, tol, indoors: home })) done = add1(kind, keeper, q, f);
          }
        }
        if (!done) {
          for (let i = 0; i < 12 && !done; i++) {
            const a = (i * Math.PI) / 6, r = Math.max(b.hw, b.hh) + 0.6;
            const q: V = [b.cx + Math.cos(a) * r, b.cy + Math.sin(a) * r];
            if (free(q, { ignore: p, indoors: home })) done = add1(kind, keeper, q, towards(q, [b.cx, b.cy]));
          }
        }
        if (!done) continue;
        served.add(p.key.split("/")[0]!);
        for (let k2 = 0, n = p.feature === "counter" ? rng.int(0, time === "day" ? 2 : 1) : 0; k2 < n; k2++) {
          const q = add(add([b.cx, b.cy], f, depth + rng.range(0.6, 1)), across, rng.range(-0.8, 0.8));
          if (free(q, { ignore: p, indoors: home })) add1(mix([["commoner", 80], ["noble", 8], ["guard", 6], ["acolyte", 6]]), "customer", q, [-f[0], -f[1]]);
        }
      }
    }
    // Inside the other buildings, by room: patients and a healer, guards in their bunks and at the
    // mess table, prisoners in the cells, thieves and gamblers at their tables, beggars on their
    // cots, nobles at dinner and in bed, bathers in the tubs. A few to a building.
    const perHouse = new Map<string, number>();
    const room = (p: Placed) => p.room ?? "";
    const houseKey = (p: Placed) => p.key.split("/")[0]!;
    const take = (p: Placed) => { const k = houseKey(p); const n = perHouse.get(k) ?? 0; if (n >= 8) return false; perHouse.set(k, n + 1); return true; };
    for (const p of rng.shuffle(inp.placed.filter((x) => BED_TYPES.has(x.type) && IN_BEDS[room(x)]))) {
      const f = IN_BEDS[room(p)]!;
      if (rng.next() >= f.p[time]) continue;
      const b = boxOf(p);
      if (!spaced([b.cx, b.cy], 0.7) || !take(p)) continue;
      add1(mix(f.kinds), f.role, [b.cx, b.cy], (p.facing ?? [0, 1]) as V, time === "night" || room(p) !== "underworld.squat" ? true : rng.next() < 0.5);
    }
    for (const p of rng.shuffle(inp.placed.filter((x) => SEAT_TYPES.has(x.type) && AT_TABLES[room(x)]))) {
      const f = AT_TABLES[room(p)]!;
      const b = boxOf(p);
      const many = ["bench", "sofa"].includes(p.type);
      for (const seat of many ? seats(b) : [[b.cx, b.cy] as V]) {
        if (rng.next() >= f.p[time] || !spaced(seat, 0.7) || !take(p)) continue;
        add1(mix(f.kinds), f.role, seat, (p.facing ?? [0, 1]) as V);
      }
    }
    // The healer at a patient's bedside; bathers in the tubs by day.
    if (time !== "night") {
      for (const p of inp.placed.filter((x) => BED_TYPES.has(x.type) && room(x) === "service.infirmary").slice(0, 1)) {
        const b = boxOf(p);
        const home = houses.find((hs) => inPoly([b.cx, b.cy], hs));
        for (let i = 0; i < 12 && home; i++) {
          const a = (i * Math.PI) / 6, r = Math.max(b.hw, b.hh) + 0.5;
          const q: V = [b.cx + Math.cos(a) * r, b.cy + Math.sin(a) * r];
          if (free(q, { ignore: p, indoors: home })) { add1(rng.next() < 0.6 ? "acolyte" : "priest", "healer", q, towards(q, [b.cx, b.cy])); break; }
        }
      }
      for (const p of inp.placed.filter((x) => x.type === "bathtub" && room(x) === "service.bath")) {
        const b = boxOf(p);
        if (rng.next() < 0.35 && spaced([b.cx, b.cy], 0.7) && take(p)) add1(mix([["commoner", 6], ["noble", 2]]), "bather", [b.cx, b.cy], (p.facing ?? [0, 1]) as V);
      }
    }
    // Market stalls: a vendor under the awning, a shopper in front.
    let vendors = 0, shoppers = 0;
    for (const b of rng.shuffle(pieces(z.id, ["stall"]))) {
      if (vendors >= 16 || rng.next() >= pVend) continue;
      const { f, depth, across } = frontOf(b);
      const v = add([b.cx, b.cy], f, -depth * 0.25);
      if (!spaced(v) || houses.some((hs) => inPoly(v, hs)) || wet(v)) continue;
      add1(mix([["commoner", 9], ["thug", 1]]), "vendor", v, f);
      vendors++;
      if (shoppers < 14 && rng.next() < pShop) {
        const s = add(add([b.cx, b.cy], f, depth + 0.75), across, rng.range(-0.8, 0.8));
        if (free(s)) { add1(mix([["commoner", 80], ["noble", 8], ["guard", 6], ["acolyte", 6]]), "shopper", s, [-f[0], -f[1]]); shoppers++; }
      }
    }
    // Ships: sailors on deck.
    for (const b of pieces(z.id, Object.keys(SHIPS))) {
      const reach = { ship_large: 2.5, ship_medium: 1.5, ship_small: 0, barge: 1 }[b.p.type] ?? 0;
      const f = (b.p.facing ?? [b.ux, b.uy]) as V;
      for (let i = 0; i < SHIPS[b.p.type]!; i++) {
        if (rng.next() >= { day: 0.75, dusk: 0.5, night: 0.2 }[time]) continue;
        const p = add(add([b.cx, b.cy], f, rng.range(-reach, reach)), [-f[1], f[0]], rng.range(-0.5, 0.5));
        if (spaced(p)) add1(mix([["commoner", 3], ["thug", 1]]), "sailor", p, randomDir());
      }
    }
    // Dockworkers at the cargo.
    const cargo = rng.shuffle(inp.placed.filter((p) => p.zone === z.id && ["crate", "barrel", "sack", "rope"].includes(p.type) && /cargo|pier_gear/.test(p.feature)).map((p) => boxOf(p)));
    for (let i = 0, n = { day: 6, dusk: 3, night: 0 }[time]; i < cargo.length && n > 0; i++) {
      const p = beside(cargo[i]!, undefined, 0.6);
      if (p && add1(mix([["commoner", 4], ["thug", 1]]), "dockworker", p, towards(p, [cargo[i]!.cx, cargo[i]!.cy]))) n--;
    }
    // A fountain or trough draws a few.
    for (const b of pieces(z.id, ["fountain", "trough", "well"])) {
      for (let i = 0; i < { day: rng.int(1, 3), dusk: 1, night: 0 }[time]; i++) {
        const p = beside(b, undefined, 0.6);
        if (p) add1(mix([["commoner", 9], ["acolyte", 1]]), "townsfolk", p, towards(p, [b.cx, b.cy]));
      }
    }
    // Passers-by at house doors; the watch at night.
    let left = { day: 8, dusk: 5, night: 2 }[time];
    for (const d of rng.shuffle(doors.filter((x) => x.house))) {
      if (left <= 0) break;
      if (rng.next() > (time === "night" ? 0.15 : 0.35)) continue;
      const n: V = [-d.dir[1], d.dir[0]];
      const out: V = inPoly(add(d.at, n, 0.5), d.house!) ? [-n[0], -n[1]] : n;
      const p = add(add(d.at, out, 1), d.dir, rng.range(-0.5, 0.5));
      if (!free(p)) continue;
      const kind = time === "night" ? "guard" : mix([["commoner", 80], ["guard", 8], ["noble", 7], ["acolyte", 5]]);
      const face: V = rng.next() < 0.4 ? [-out[0], -out[1]] : rng.next() < 0.5 ? d.dir : [-d.dir[0], -d.dir[1]];
      if (add1(kind, kind === "guard" ? (time === "night" ? "the watch" : "guard on patrol") : "passer-by", p, face)) left--;
    }
  }

  return people;
}
