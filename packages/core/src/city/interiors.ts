/**
 * House interiors for street maps. Each building's walls (any shape, at any angle) are framed
 * along their long side; the frame is cut into a grid of rooms (one to three across a house,
 * two rows in a deep one, rooms about nine squares a side in a keep or a hall); a tree of doors
 * joins them, and the ordinary room engine (gen/dress.ts) furnishes them in that frame. The
 * furniture and the inner walls are then turned back onto the street map.
 *
 * What a building holds follows what it is: homes by size, a smithy or a weaver now and then,
 * a bar in the tavern, pews in the church, a hall, dining room, kitchen and chambers in the
 * keep, stores in the warehouse, hay in the stable.
 */

import type { Catalog } from "../gen/catalog";
import { dress, type Placed } from "../gen/dress";
import type { DoorPlacement, Layout, LayoutZone, Segment } from "../gen/layout";
import type { ScenePlan, Side } from "../gen/plan";
import { Rng } from "../gen/rng";
import type { Style } from "../gen/style";
import type { Landmark } from "./houses";
import { TRADES, type Trade } from "./shops";

type V = [number, number];

export type BuildingKind = "house" | "rural" | Landmark;

export interface InteriorInput {
  /** Unique within the map; prefixes every key. */
  key: string;
  /** The wall line, street-map squares (a closed ring, either winding). */
  shape: V[];
  /** The outer door's centre on that line, if the building has one. */
  door?: V;
  kind: BuildingKind;
  /** A shop: its trade (the shop takes the room with the street door). */
  trade?: Trade;
  /** The street map's plan (seed, mood). */
  plan: ScenePlan;
  cat: Catalog;
  /** Indoor furniture style; its wall sets how far furniture keeps from the walls. */
  style: Style;
  /** Zone id the furniture is filed under on the street map. */
  zone: string;
}

export interface InteriorWall {
  a: V;
  b: V;
  /** Door centres on this wall. */
  doors: V[];
  /** Which of those doors are locked (gaol cells). */
  locked?: boolean[];
}

export interface Interior {
  /** Furniture, street-map squares. */
  placed: Placed[];
  /** Walls between the rooms, street-map squares. */
  walls: InteriorWall[];
  /** The room types, main room first. */
  rooms: string[];
  /** What the floor is: wood in homes, stone in halls, smithies and stores, earth in stables. */
  floor: "wood" | "stone" | "dirt";
}

const MARGIN = 1;
const MIN_ROOM = 2.6;

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function polyArea(r: V[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function inPoly(p: V, poly: V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

/** The smallest box round the ring, long side along u; v is u turned a quarter clockwise on screen. */
function frameOf(r: V[]): { u: V; v: V; x0: number; y0: number; L: number; D: number } {
  let best: { u: V; v: V; x0: number; y0: number; L: number; D: number } | undefined;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    for (const turn of [0, 1]) {
      let u: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      if (turn) u = [-u[1], u[0]];
      const v: V = [-u[1], u[0]];
      const xs = r.map((p) => dot(p, u)), ys = r.map((p) => dot(p, v));
      const x0 = Math.min(...xs), y0 = Math.min(...ys), L = Math.max(...xs) - x0, D = Math.max(...ys) - y0;
      if (L + 1e-6 < D) continue;
      if (!best || L * D < best.L * best.D - 1e-6) best = { u, v, x0, y0, L, D };
    }
  }
  return best!;
}

/** The parts of a cut line inside the polygon: x = t when `vertical`, else y = t; as [from, to] along the line. */
function spansAt(poly: V[], t: number, vertical: boolean): Array<[number, number]> {
  const k = vertical ? 0 : 1, o = vertical ? 1 : 0;
  const hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if ((a[k] <= t && b[k] > t) || (b[k] <= t && a[k] > t)) hits.push(a[o] + ((t - a[k]) / (b[k] - a[k])) * (b[o] - a[o]));
  }
  hits.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i]!, hits[i + 1]!]);
  return out;
}

/** The longest piece of [from, to] that lies inside the given spans. */
function overlap(spans: Array<[number, number]>, from: number, to: number): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (const [s0, s1] of spans) {
    const a = Math.max(s0, from), b = Math.min(s1, to);
    if (b > a && (!best || b - a > best[1] - best[0])) best = [a, b];
  }
  return best;
}

interface Program {
  /** The room with the street door. */
  main: string;
  /** The other rooms in the order they are handed out (nearest the main room first). */
  rest: string[];
  /** Rooms for any cells left over. */
  filler: string[];
  /** Room side the grid aims at (squares). */
  side: number;
  /** Most rooms across and deep. */
  maxCols: number;
  maxRows: number;
}

/** What rooms a building has. */
function program(kind: BuildingKind, area: number, rng: Rng, trade?: Trade): Program {
  const P = (main: string, rest: string[], filler: string[], side: number, maxCols = 6, maxRows = 4): Program => ({ main, rest, filler, side, maxCols, maxRows });
  if (trade && TRADES[trade].rooms) {
    // Services and the like: their own rooms behind the main one.
    const t = TRADES[trade], r = t.rooms!;
    if (area < 26) return P(t.room, [], [], 99, 1, 1);
    if (area < 60) return P(t.room, r.rest.slice(0, 1), [], 99, 2, 1);
    return P(t.room, r.rest, r.filler ?? [], r.side ?? 6.5, 4, 3);
  }
  if (trade) {
    // The shop at the front; a store and the family's rooms behind it.
    const shop = TRADES[trade].room;
    if (area < 26) return P(shop, [], [], 99, 1, 1);
    if (area < 60) return P(shop, [rng.next() < 0.5 ? "tavern.storage" : "house.home"], [], 99, 2, 1);
    return P(shop, ["tavern.storage", "house.living", "house.bedroom"], ["house.bedroom"], 6.5, 3, 2);
  }
  switch (kind) {
    case "church": case "chapel": case "parish":
      // One nave; a vestry off the far end of a long church.
      return P("gothic.nave", ["gothic.vestry"], ["gothic.vestry"], area > 110 ? 18 : 99, 2, 1);
    case "tavern": case "inn":
      return P("tavern.common_room", ["tavern.kitchen", "tavern.storage", "tavern.guest_room", "tavern.guest_room"], ["tavern.guest_room", "tavern.storage"], area > 160 ? 9 : 11, 3, 2);
    case "keep": case "castle":
      return P("gothic.hall", ["gothic.dining", "tavern.kitchen", "gothic.study", "gothic.bedroom", "tavern.storage", "gothic.bedroom", "gothic.vault"], ["gothic.bedroom", "tavern.storage", "gothic.study", "gothic.vault"], 9);
    case "mansion":
      return P("gothic.hall", ["gothic.dining", "tavern.kitchen", "gothic.study", "gothic.bedroom", "gothic.bedroom", "tavern.storage", "gothic.bedroom", "gothic.vault"], ["gothic.bedroom", "gothic.study", "tavern.storage"], Math.max(5, Math.min(8, Math.sqrt(area) / 3.2)), 5, 4);
    case "garrison":
      return P("guard.mess", ["guard.barracks", "guard.armoury", "guard.office", "guard.barracks", "gaol.cell", "tavern.kitchen", "tavern.storage", "guard.barracks"], ["guard.barracks", "tavern.storage"], 7, 5, 3);
    case "guildhall":
      return P("gothic.dining", ["gothic.hall", "gothic.study", "tavern.storage"], ["gothic.study", "tavern.storage"], 10, 3, 2);
    case "warehouse":
      return P("tavern.storage", [], ["tavern.storage"], 9, 4, 2);
    case "stable":
      return P("house.stable", [], ["house.stable"], 12, 2, 1);
    case "wizard":
      return P("gothic.study", ["gothic.vault", "gothic.bedroom"], ["gothic.vault"], 7, 2, 2);
    default: {
      if (area < 7) return P("tavern.storage", [], [], 99, 1, 1);
      if (area < 28) return P("house.home", [], [], 99, 1, 1);
      const trade = rng.weighted<[string, number]>([["house.workroom", 3], ["tavern.storage", 2], ["house.smithy", 1], ["house.weaver", 1]], (x) => x[1])[0];
      if (area < 60) return P("house.living", [rng.next() < 0.75 ? "house.bedroom" : trade], [], 99, 2, 1);
      return P("house.living", ["house.bedroom", trade], ["house.bedroom", "tavern.storage"], 6.5, 3, 2);
    }
  }
}

const STONE_SHOPS = new Set(["shop.blacksmith", "shop.butcher", "shop.fishmonger", "house.smithy", "gaol.guardroom", "guard.post", "service.bath", "craft.tannery", "craft.brewery", "craft.mason", "underworld.contraband", "underworld.squat"]);

function floorOf(kind: BuildingKind, main: string): Interior["floor"] {
  if (["church", "chapel", "parish", "keep", "castle", "warehouse", "garrison"].includes(kind)) return "stone";
  if (kind === "stable" || main === "house.stable") return "dirt";
  return STONE_SHOPS.has(main) ? "stone" : "wood";
}

/** Cut positions splitting [a, a + len] into n parts, the parts a little uneven. */
function cutsOf(a: number, len: number, n: number, rng: Rng): number[] {
  const w = Array.from({ length: n }, () => rng.range(0.85, 1.15));
  const sum = w.reduce((s, x) => s + x, 0);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < n; i++) { acc += w[i]!; out.push(a + (len * acc) / sum); }
  return out;
}

/** Furnishes one building. Deterministic for the plan's seed and the key. */
export function furnishBuilding(inp: InteriorInput): Interior {
  const rng = new Rng(`${inp.plan.seed}:interior:${inp.key}`);
  const f = frameOf(inp.shape);
  const toLocal = (p: V): V => [dot(p, f.u) - f.x0 + MARGIN, dot(p, f.v) - f.y0 + MARGIN];
  const toWorld = (p: V): V => {
    const a = p[0] - MARGIN + f.x0, b = p[1] - MARGIN + f.y0;
    return [f.u[0] * a + f.v[0] * b, f.u[1] * a + f.v[1] * b];
  };
  const theta = Math.atan2(f.u[1], f.u[0]);
  const poly = inp.shape.map(toLocal);
  const area = polyArea(poly);
  const door = inp.door ? toLocal(inp.door) : undefined;
  const prog = program(inp.kind, area, rng, inp.trade);
  const wanted = 1 + prog.rest.length;

  // The grid: columns along the long side, rows across it.
  let cols = Math.max(1, Math.min(prog.maxCols, Math.round(f.L / prog.side), Math.floor(f.L / MIN_ROOM)));
  let rows = Math.max(1, Math.min(prog.maxRows, Math.round(f.D / prog.side), Math.floor(f.D / MIN_ROOM)));
  // Houses: as many rooms as the program, no more.
  if (prog.side >= 99) { cols = Math.max(1, Math.min(wanted, Math.floor(f.L / MIN_ROOM))); rows = 1; }
  else if (prog.side < 7 && cols * rows > wanted + 1) cols = Math.max(1, Math.ceil(wanted / rows));
  const xs = [MARGIN, ...cutsOf(MARGIN, f.L, cols, rng), MARGIN + f.L];
  const ys = [MARGIN, ...cutsOf(MARGIN, f.D, rows, rng), MARGIN + f.D];

  // Cells and how much of each lies inside the walls (a cross-shaped keep leaves corners empty).
  interface Cell { i: number; j: number; id: string; rect: { x: number; y: number; w: number; h: number }; inside: number; type?: string }
  const cells: Cell[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const rect = { x: xs[i]!, y: ys[j]!, w: xs[i + 1]! - xs[i]!, h: ys[j + 1]! - ys[j]! };
    let n = 0, k = 0;
    for (let y = rect.y + 0.25; y < rect.y + rect.h; y += 0.5) for (let x = rect.x + 0.25; x < rect.x + rect.w; x += 0.5) { k++; if (inPoly([x, y], poly)) n++; }
    if (k && n / k >= 0.2) cells.push({ i, j, id: `r${i}_${j}`, rect, inside: n / k });
  }
  const at = (i: number, j: number) => cells.find((c) => c.i === i && c.j === j);

  // Neighbours share a stretch of wall inside the building long enough for a door.
  interface Link { a: Cell; b: Cell; door: V; vertical: boolean; t: number }
  const links: Link[] = [];
  for (const c of cells) {
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      const d = at(c.i + di, c.j + dj);
      if (!d) continue;
      const vertical = di === 1;
      const t = vertical ? xs[c.i + 1]! : ys[c.j + 1]!;
      const along = vertical ? [c.rect.y, c.rect.y + c.rect.h] : [c.rect.x, c.rect.x + c.rect.w];
      const piece = overlap(spansAt(poly, t, vertical), along[0]! + 0.3, along[1]! - 0.3);
      if (!piece || piece[1] - piece[0] < 1.3) continue;
      const m = (piece[0] + piece[1]) / 2 + rng.range(-0.3, 0.3) * Math.max(0, piece[1] - piece[0] - 1.6);
      links.push({ a: c, b: d, door: vertical ? [t, m] : [m, t], vertical, t });
    }
  }

  // The main room holds the street door; the rest go out nearest first along a tree of doors.
  const centre = (c: Cell): V => [c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2];
  const main = (door && cells.find((c) => door[0] >= c.rect.x - 0.3 && door[0] <= c.rect.x + c.rect.w + 0.3 && door[1] >= c.rect.y - 0.3 && door[1] <= c.rect.y + c.rect.h + 0.3 && inPoly(centre(c), poly)))
    ?? (door ? cells.slice().sort((p, q) => Math.hypot(...(centre(p).map((x, k) => x - door[k]!) as V)) - Math.hypot(...(centre(q).map((x, k) => x - door[k]!) as V)))[0] : undefined)
    ?? cells.slice().sort((p, q) => q.inside * q.rect.w * q.rect.h - p.inside * p.rect.w * p.rect.h)[0]!;
  const tree: Link[] = [];
  const reached = new Set<Cell>([main]);
  const queue: Cell[] = [main];
  let r = 0, fi = 0;
  main.type = prog.main;
  while (queue.length) {
    const c = queue.shift()!;
    for (const l of rng.shuffle(links.filter((x) => x.a === c || x.b === c))) {
      const d = l.a === c ? l.b : l.a;
      if (reached.has(d)) continue;
      reached.add(d);
      queue.push(d);
      tree.push(l);
      d.type = r < prog.rest.length ? prog.rest[r++]! : prog.filler.length ? prog.filler[fi++ % prog.filler.length]! : prog.main;
    }
  }
  // Cells no door reaches are left out (furniture there could never be got at).
  const rooms = cells.filter((c) => reached.has(c));

  // Inner walls: every cut line where it runs between two rooms, in one piece per span.
  const pieces: Array<{ a: V; b: V; doors: V[]; locked: boolean[] }> = [];
  const wallOf = (l: Link) => pieces.findIndex((p) => (l.vertical ? Math.abs(p.a[0] - l.t) < 1e-6 && Math.abs(p.b[0] - l.t) < 1e-6 && l.door[1] > Math.min(p.a[1], p.b[1]) && l.door[1] < Math.max(p.a[1], p.b[1]) : Math.abs(p.a[1] - l.t) < 1e-6 && Math.abs(p.b[1] - l.t) < 1e-6 && l.door[0] > Math.min(p.a[0], p.b[0]) && l.door[0] < Math.max(p.a[0], p.b[0])));
  const live = (i: number, j: number) => rooms.some((c) => c.i === i && c.j === j);
  for (let i = 1; i < cols; i++) {
    // Only where a room lies on at least one side of the cut.
    for (let j = 0; j < rows; j++) {
      if (!live(i - 1, j) && !live(i, j)) continue;
      for (const s of spansAt(poly, xs[i]!, true)) {
        const piece = overlap([s], ys[j]!, ys[j + 1]!);
        if (piece && piece[1] - piece[0] > 0.3) pieces.push({ a: [xs[i]!, piece[0]], b: [xs[i]!, piece[1]], doors: [], locked: [] });
      }
    }
  }
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!live(i, j - 1) && !live(i, j)) continue;
      for (const s of spansAt(poly, ys[j]!, false)) {
        const piece = overlap([s], xs[i]!, xs[i + 1]!);
        if (piece && piece[1] - piece[0] > 0.3) pieces.push({ a: [piece[0], ys[j]!], b: [piece[1], ys[j]!], doors: [], locked: [] });
      }
    }
  }
  const doors: DoorPlacement[] = [];
  for (const l of tree) {
    const wi = wallOf(l);
    if (wi < 0) continue;
    pieces[wi]!.doors.push(l.door);
    // Cell doors are locked.
    const cell = l.a.type === "gaol.cell" || l.b.type === "gaol.cell";
    pieces[wi]!.locked.push(cell);
    doors.push({ at: l.door, wall: wi, between: [l.a.id, l.b.id], dir: l.vertical ? [0, 1] : [1, 0], ...(cell ? { state: "locked" as const } : {}) });
  }
  if (door) {
    // The street door, put on the main room's nearest side so the room keeps its threshold clear.
    const R = main.rect;
    const clampX = Math.min(Math.max(door[0], R.x + 0.6), R.x + R.w - 0.6), clampY = Math.min(Math.max(door[1], R.y + 0.6), R.y + R.h - 0.6);
    const sides: Array<{ at: V; dir: V; d: number }> = [
      { at: [clampX, R.y], dir: [1, 0], d: Math.abs(door[1] - R.y) },
      { at: [clampX, R.y + R.h], dir: [1, 0], d: Math.abs(door[1] - (R.y + R.h)) },
      { at: [R.x, clampY], dir: [0, 1], d: Math.abs(door[0] - R.x) },
      { at: [R.x + R.w, clampY], dir: [0, 1], d: Math.abs(door[0] - (R.x + R.w)) },
    ];
    const s = sides.sort((a, b) => a.d - b.d)[0]!;
    doors.push({ at: s.at, wall: "outer", between: [main.id, "outside"], dir: s.dir, main: true });
  }

  const zones: LayoutZone[] = rooms.map((c) => ({ id: c.id, type: c.type!, rect: c.rect }));
  const exterior: Layout["exterior"] = {};
  for (const c of rooms) {
    const out: Side[] = [];
    if (c.j === 0 || !live(c.i, c.j - 1)) out.push("north");
    if (c.j === rows - 1 || !live(c.i, c.j + 1)) out.push("south");
    if (c.i === 0 || !live(c.i - 1, c.j)) out.push("west");
    if (c.i === cols - 1 || !live(c.i + 1, c.j)) out.push("east");
    exterior[c.id] = out;
  }
  const interiorWalls: Segment[] = pieces.map((p) => ({ a: p.a, b: p.b }));
  const W = Math.ceil(f.L + 2 * MARGIN), H = Math.ceil(f.D + 2 * MARGIN);
  const layout: Layout = {
    map: { w: W, h: H },
    building: { x: MARGIN, y: MARGIN, w: f.L, h: f.D },
    outline: [[MARGIN, MARGIN], [MARGIN + f.L, MARGIN], [MARGIN + f.L, MARGIN + f.D], [MARGIN, MARGIN + f.D]],
    zones,
    interiorWalls,
    doors,
    windows: [],
    exterior,
    front: "south",
  };
  const plan: ScenePlan = {
    id: `${inp.plan.id}/${inp.key}`.slice(0, 64),
    title: inp.key,
    seed: hash(`${inp.plan.seed}:${inp.key}`),
    genre: "medieval",
    size: { w: W, h: H },
    mood: inp.plan.mood,
    versions: { count: 1, picked: "v1" },
    levels: [{ id: "ground", zones: zones.map(({ rect: _r, ...z }) => z) }],
  };
  const res = dress({ plan, layout, cat: inp.cat, style: inp.style, styles: [inp.style], locked: [], mask: poly, maskPad: 0.18 });

  // Back onto the street map: move, turn, rename.
  const c = Math.cos(theta), s = Math.sin(theta);
  const turn = (v: V): V => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const pre = `${inp.key}/`;
  const roomType = new Map(zones.map((z) => [z.id, z.type]));
  const placed: Placed[] = res.placed.map((p) => {
    const [fw, fh] = p.footprint;
    const pos = toWorld([p.x, p.y]);
    return {
      ...p,
      key: pre + p.key,
      zone: inp.zone,
      room: roomType.get(p.zone),
      x: pos[0],
      y: pos[1],
      rotation: p.rotation + theta,
      footprint: [Math.abs(fw * c) + Math.abs(fh * s), Math.abs(fw * s) + Math.abs(fh * c)] as [number, number],
      ...(p.center ? { center: toWorld(p.center) } : {}),
      ...(p.facing ? { facing: turn(p.facing as V) } : {}),
      ...(p.parent ? { parent: pre + p.parent } : {}),
    };
  });
  const walls: InteriorWall[] = pieces.map((p) => ({ a: toWorld(p.a), b: toWorld(p.b), doors: p.doors.map(toWorld), ...(p.locked.some(Boolean) ? { locked: p.locked } : {}) }));
  return { placed, walls, rooms: [main.type!, ...rooms.filter((x) => x !== main).map((x) => x.type!)], floor: floorOf(inp.kind, main.type!) };
}
