/**
 * Dressing engine: furnishes rooms by running their recipe steps (recipes.ts) against an
 * occupancy grid. Pieces are oriented from their vision-tagged facing, placed by their
 * visible (trimmed) center, and grouped the way 2MT's artists group them: tables with
 * jittered chairs and things on top, walls lined with storage, rugs under groups, grime
 * along edges, lights everywhere. Units are squares; rotation is radians clockwise.
 */

import type { AssetRecord } from "../assets/model";
import { PX_PER_SQUARE } from "../assets/model";
import type { Catalog } from "./catalog";
import type { DoorPlacement, Layout, LayoutZone, Rect } from "./layout";
import type { Anchor, Directive, FreeDirective, ModifyDirective, PinDirective, RestyleDirective, ScenePlan, Side } from "./plan";
import { RECIPE_BY_TYPE, type ColonnadeStep, type RowsStep as RowsStepT, type AnchorStep, type BarStep, type CenterStep, type CornersStep, type DecalsStep, type GroupKind, type GroupsStep, type LineStep, type OverheadStep, type RowsStep, type ScatterStep, type SconcesStep, type Step, type SurfaceSpec, type Weighted } from "./recipes";
import { Rng } from "./rng";
import { dressGates, dressWrecks, runGallery, runRunner, type GateLeaf } from "./features";
import { specOf } from "./rooms";
import { poolFor, type PoolQuery, type Style, type Wear } from "./style";

export interface LightRule {
  range: number;
  color?: string;
  intensity?: number;
}

export interface Placed {
  key: string;
  zone: string;
  feature: string;
  /** Role (vision tag) of the piece. */
  type: string;
  asset: AssetRecord;
  /** Object position (image center) in squares. */
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** Extra scale along the image's x axis (a carpet stretched to fill a hall). */
  stretch?: number;
  layer: number;
  /** Axis-aligned footprint of the visible art after rotation and scale, in squares. */
  footprint: [number, number];
  /** Center of the visible art (differs from x, y when the image has uneven margins). */
  center?: [number, number];
  /** Direction the piece's front faces. */
  facing?: [number, number];
  directive?: string;
  light?: LightRule;
  customColor?: string;
  parent?: string;
  locked?: boolean;
  /** Street maps: the type of the room inside a building the piece stands in (city/interiors.ts). */
  room?: string;
}

export interface PathPlan {
  key: string;
  zone: string;
  points: Array<[number, number]>;
  use: "road" | "fence";
  width?: number;
}

export interface DressResult {
  placed: Placed[];
  paths: PathPlan[];
  /** Gates whose closed leaves Foundry draws from frame art. */
  gates?: GateLeaf[];
  /** Things the generator could not do, for Claude and the DM. */
  notes: string[];
}

type Vec = [number, number];

// Layers: Dungeondraft user layers 100-400; overhead above walls.
export const LAYER = { decal: 100, rug: 150, floorClutter: 200, furniture: 300, surface: 400, overhead: 700 } as const;
const RES = 4;
const INSET = 0.24; // half the wall thickness: interior lines sit this far inside the wall line

const Cell = { Free: 0, Solid: 1, Path: 2, Door: 3, Wall: 4 } as const;

class Grid {
  readonly cells: Uint8Array;
  readonly W: number;
  readonly H: number;
  constructor(w: number, h: number) {
    this.W = w * RES;
    this.H = h * RES;
    this.cells = new Uint8Array(this.W * this.H);
  }
  private span(r: Rect): [number, number, number, number] {
    return [Math.floor(r.x * RES + 1e-6), Math.floor(r.y * RES + 1e-6), Math.ceil((r.x + r.w) * RES - 1e-6), Math.ceil((r.y + r.h) * RES - 1e-6)];
  }
  /** True when every cell under r is allowed. */
  fits(r: Rect, allow: (c: number) => boolean): boolean {
    const [x0, y0, x1, y1] = this.span(r);
    if (x0 < 0 || y0 < 0 || x1 > this.W || y1 > this.H) return false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!allow(this.cells[y * this.W + x]!)) return false;
    return true;
  }
  /** Marks only cells that lie wholly inside r (no rounding outward). */
  markInside(r: Rect, v: number): void {
    const x0 = Math.ceil(r.x * RES - 1e-6), y0 = Math.ceil(r.y * RES - 1e-6), x1 = Math.floor((r.x + r.w) * RES + 1e-6), y1 = Math.floor((r.y + r.h) * RES + 1e-6);
    for (let y = Math.max(0, y0); y < Math.min(this.H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.W, x1); x++) this.cells[y * this.W + x] = v;
  }
  mark(r: Rect, v: number, onlyFree = false): void {
    const [x0, y0, x1, y1] = this.span(r);
    for (let y = Math.max(0, y0); y < Math.min(this.H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.W, x1); x++) {
      const i = y * this.W + x;
      if (!onlyFree || this.cells[i] === Cell.Free) this.cells[i] = v;
    }
  }
}

const SOLID_OK = (c: number) => c === Cell.Free;
const CLUTTER_OK = (c: number) => c === Cell.Free || c === Cell.Path;
const LOW_OK = (c: number) => c !== Cell.Wall;

const DIRS: Record<string, Vec> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0], none: [0, 1] };
const ang = (v: Vec) => Math.atan2(v[1], v[0]);
const rotate = (v: Vec, r: number): Vec => [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)];
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];
const norm = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));

/** Rotation that turns the asset's front toward `front`. */
export function rotationFor(a: AssetRecord, front: Vec): number {
  let facing = a.tag?.facing ?? "down";
  // Pieces without a front go long side across the front direction (along a wall).
  if (facing === "none") facing = (a.footprint?.[1] ?? 1) > (a.footprint?.[0] ?? 1) ? "right" : "down";
  const f = DIRS[facing] ?? DIRS.down!;
  return norm(ang(front) - ang(f));
}

/** Width along the front edge and depth front-to-back, in squares at scale 1. */
function frontSize(a: AssetRecord): { width: number; depth: number } {
  const [w, h] = a.footprint ?? [1, 1];
  const f = a.tag?.facing;
  if (f === "none") return { width: Math.max(w, h), depth: Math.min(w, h) };
  return f === "left" || f === "right" ? { width: h, depth: w } : { width: w, depth: h };
}

function aabb(a: AssetRecord, rot: number, scale: number): Vec {
  const [w, h] = a.footprint ?? [1, 1];
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  return [(w * c + h * s) * scale, (w * s + h * c) * scale];
}

/** Offset of the visible art's center from the image center, in squares (image axes). */
function artOffset(a: AssetRecord): Vec {
  if (!a.trim || !a.size[0]) return [0, 0];
  const [tx, ty, tw, th] = a.trim;
  return [((tx + tw / 2) - a.size[0] / 2) / PX_PER_SQUARE, ((ty + th / 2) - a.size[1] / 2) / PX_PER_SQUARE];
}

const rectAt = (c: Vec, size: Vec, pad = 0): Rect => ({ x: c[0] - size[0] / 2 - pad, y: c[1] - size[1] / 2 - pad, w: size[0] + 2 * pad, h: size[1] + 2 * pad });

const LIGHTS: Record<string, LightRule> = {
  candle: { range: 3.5, color: "ffffcf8a", intensity: 0.8 },
  candelabra: { range: 5, color: "ffffcf8a", intensity: 0.9 },
  lantern: { range: 5.5, color: "ffffd79a", intensity: 0.9 },
  torch: { range: 6.5, color: "ffffa95a", intensity: 0.95 },
  sconce: { range: 6, color: "ffffc27a", intensity: 0.9 },
  chandelier: { range: 10, color: "ffffd79a", intensity: 0.95 },
  fireplace: { range: 8, color: "ffff9a4a", intensity: 1 },
  firepit: { range: 8, color: "ffff9a4a", intensity: 1 },
  brazier: { range: 5, color: "ffff9a4a", intensity: 0.95 },
  campfire: { range: 6, color: "ffff9a4a", intensity: 1 },
  oven: { range: 3, color: "ffff9a4a", intensity: 0.8 },
  forge: { range: 5, color: "ffff8a3a", intensity: 1 },
  lamp_post: { range: 6, color: "ffffd79a", intensity: 0.9 },
};

/** Old type names (and casual words from chat) that map to roles. */
export const ROLE_ALIASES: Record<string, string[]> = {
  table: ["table_medium", "table_small", "table_long", "table_set"],
  tables: ["table_set", "table_medium", "table_small", "table_long"],
  tankard: ["mug"], cup: ["mug"], goblet: ["mug"], drink: ["mug", "bottle"],
  rug: ["rug", "runner", "fur", "mat"], carpet: ["rug", "runner"],
  bed: ["bed_double", "bed_single", "cot"],
  hearth: ["fireplace", "oven", "firepit"],
  bookcase: ["bookshelf"], books: ["book"],
  shelf: ["shelf", "shelf_wall"], shelves: ["shelf", "shelf_wall"],
  wardrobe: ["wardrobe", "dresser", "cabinet"],
  dish: ["plate"], bowl: ["plate"],
  light: ["candle", "lantern", "sconce", "chandelier", "torch", "candelabra"], lights: ["candle", "lantern", "sconce", "chandelier", "torch", "candelabra"],
  body: ["corpse"], bodies: ["corpse"], skeleton: ["bones", "corpse"],
  grave: ["gravestone", "grave"], tombstone: ["gravestone"], headstone: ["gravestone"],
  bar: ["bar_counter"], counter: ["counter", "bar_counter"],
  chairs: ["chair", "stool", "bench", "armchair"], seat: ["chair", "stool", "bench"],
  clutter: ["debris", "paper_scatter", "straw"], grime: ["grime", "dirt", "stain"], dirt: ["dirt", "grime"],
  web: ["cobweb"], webs: ["cobweb"], cobwebs: ["cobweb"],
  plant: ["plant"], plants: ["plant", "flowers"], tree: ["tree", "dead_tree"], trees: ["tree", "dead_tree"],
};

export function rolesFor(word: string): string[] {
  return ROLE_ALIASES[word] ?? [word];
}

interface WallSide {
  side: Side;
  origin: Vec;
  along: Vec;
  inward: Vec;
  length: number;
  exterior: boolean;
  /** Door openings and windows, as positions along the side. */
  doors: number[];
  windows: number[];
}

interface Room {
  zone: LayoutZone;
  inner: Rect;
  sides: WallSide[];
  doors: Array<DoorPlacement & { inward: Vec; side: Side }>;
  /** Door visitors come in by (to the outside or toward the main door). */
  entry?: DoorPlacement & { inward: Vec; side: Side };
  area: number;
}

interface Ctx {
  plan: ScenePlan;
  layout: Layout;
  cat: Catalog;
  style: Style;
  styles: Style[];
  grid: Grid;
  placed: Placed[];
  paths: PathPlan[];
  notes: string[];
  wear: Wear;
  directives: Directive[];
  rng: Rng;
  keys: Map<string, number>;
}

function nextKey(ctx: Ctx, base: string): string {
  const n = (ctx.keys.get(base) ?? 0) + 1;
  ctx.keys.set(base, n);
  return `${base}#${n}`;
}

function forbidden(ctx: Ctx, zone: string, role: string): boolean {
  return ctx.directives.some((d) => "forbid" in d && (!d.zone || d.zone === zone) && d.forbid.some((w) => w === role || rolesFor(w).includes(role)));
}

function modifiers(ctx: Ctx, zone: string, step: Step): ModifyDirective[] {
  const roles = new Set<string>(stepRoles(step));
  return ctx.directives.filter((d): d is ModifyDirective => "modify" in d && (!d.zone || d.zone === zone) && (d.modify === step.id || rolesFor(d.modify).some((r) => roles.has(r))));
}

function stepRoles(s: Step): string[] {
  switch (s.kind) {
    case "anchor": case "rows": case "center": case "sconces": case "overhead": return s.roles;
    case "bar": return ["bar_counter", "stool", ...s.back.map((x) => x[0])];
    case "groups": return ["table_set", "table_medium", "table_small", "table_long", "chair", "stool", "bench"];
    case "line": case "corners": case "decals": case "scatter": return s.roles.map((x) => x[0]);
    case "colonnade": return s.roles;
    case "runner": return ["runner"];
    case "gallery": return [...s.art, ...s.stands.map((x) => x[0]), ...s.lights];
  }
}

function restyleFor(ctx: Ctx, zone: string, role: string): Style | undefined {
  const list = ctx.directives.filter((d): d is RestyleDirective => "restyle" in d && rolesFor(d.restyle).includes(role));
  const d = list.find((x) => x.zone === zone) ?? list.find((x) => !x.zone);
  return d ? ctx.styles.find((s) => s.id === d.from) : undefined;
}

/** Picks a piece for a role from the style's pool; undefined when forbidden or none exists. */
function pick(ctx: Ctx, zone: string, role: string, q: Partial<PoolQuery> = {}, rng = ctx.rng): AssetRecord | undefined {
  if (forbidden(ctx, zone, role)) return undefined;
  const style = restyleFor(ctx, zone, role) ?? ctx.style;
  const pool = poolFor(ctx.cat, style, role, { genre: ctx.plan.genre, wear: ctx.wear, ...q });
  if (!pool.length) return undefined;
  return rng.pick(pool);
}

function pickWeighted(ctx: Ctx, zone: string, menu: Weighted, q: Partial<PoolQuery> = {}, rng = ctx.rng): { role: string; asset: AssetRecord } | undefined {
  const avail = menu.filter(([r]) => !forbidden(ctx, zone, r));
  for (let t = 0; t < 4 && avail.length; t++) {
    const [role] = rng.weighted(avail, (x) => x[1]);
    const a = pick(ctx, zone, role, q, rng);
    if (a) return { role, asset: a };
  }
  return undefined;
}

interface Put {
  asset: AssetRecord;
  role: string;
  /** Visible center. */
  at: Vec;
  /** Direction the front should face; ignored when rot is set. */
  front?: Vec;
  rot?: number;
  scale?: number;
  layer: number;
  zone: string;
  feature: string;
  key?: string;
  parent?: string;
  directive?: string;
  /** "solid" blocks furniture, "clutter" may sit on paths, "low" goes anywhere indoors, "force" skips checks. */
  occupy: "solid" | "clutter" | "low" | "force";
  pad?: number;
  light?: LightRule | false;
  /** Custom color for Colorable art (overrides the version's fabric color). */
  color?: string;
  /** Extra scale along the image's x axis. */
  stretch?: number;
}

/** Places a piece if it fits; marks the grid and records it. */
/** 2MT's red "tintable" pieces have greyscale Colorable twins; use the twin, tinted to the version. */
function tinted(ctx: Ctx, a: AssetRecord, colored = false): AssetRecord {
  if (a.colorable || (a.tag?.tone !== "tintable" && !colored)) return a;
  const twin = ctx.cat.twins.get(a.id);
  // Only when the twin is drawn the same size (some twins sit on a bigger canvas).
  if (!twin?.footprint || !a.footprint) return a;
  const same = Math.abs(twin.footprint[0] - a.footprint[0]) <= a.footprint[0] * 0.08 && Math.abs(twin.footprint[1] - a.footprint[1]) <= a.footprint[1] * 0.08;
  return same ? twin : a;
}

function place(ctx: Ctx, p0: Put): Placed | undefined {
  const p = { ...p0, asset: tinted(ctx, p0.asset, !!p0.color) };
  const scale = p.scale ?? 1;
  const st = p.stretch ?? 1;
  const rot = p.rot ?? (p.front ? rotationFor(p.asset, p.front) : 0);
  const size: Vec = st === 1 ? aabb(p.asset, rot, scale) : (() => {
    const [w, h] = p.asset.footprint ?? [1, 1];
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    return [(w * st * c + h * s) * scale, (w * st * s + h * c) * scale] as Vec;
  })();
  const r = rectAt(p.at, size);
  const allow = p.occupy === "solid" ? SOLID_OK : p.occupy === "clutter" ? CLUTTER_OK : LOW_OK;
  if (p.occupy !== "force" && !ctx.grid.fits(rectAt(p.at, size, -0.04), allow)) return undefined;
  if (p.occupy === "solid") ctx.grid.mark(rectAt(p.at, size, p.pad ?? 0), Cell.Solid);
  else if (p.occupy === "clutter") ctx.grid.mark(r, Cell.Solid, true);
  const ao = artOffset(p.asset);
  const off = rotate([ao[0] * st, ao[1]], rot);
  const pos: Vec = [p.at[0] - off[0] * scale, p.at[1] - off[1] * scale];
  let light: LightRule | undefined;
  if (p.light !== false) light = p.light ?? (p.asset.tag?.lit ? LIGHTS[p.role] ?? LIGHTS[p.asset.tag.role] ?? { range: 3, color: "ffffcf8a", intensity: 0.8 } : undefined);
  const placed: Placed = {
    key: p.key ?? nextKey(ctx, `${p.zone}/${p.feature}`),
    zone: p.zone,
    feature: p.feature,
    // Named goods ("food:fish") are filed under their role.
    type: p.role.split(":")[0]!,
    asset: p.asset,
    x: pos[0],
    y: pos[1],
    rotation: rot,
    scale,
    ...(st !== 1 ? { stretch: st } : {}),
    layer: p.layer,
    footprint: size,
    center: p.at,
    facing: rotate(DIRS[p.asset.tag?.facing ?? "down"] ?? [0, 1], rot),
    directive: p.directive,
    light,
    parent: p.parent,
    customColor: p.asset.colorable ? (p.color ?? (PLANTS.has(p.role) ? (ctx.plan.genre === "gothic" ? "ff6b7a52" : "ff7fa05a") : ctx.style.fabric)) : undefined,
  };
  ctx.placed.push(placed);
  return placed;
}

// ---------------------------------------------------------------------------------------
// Rooms

/**
 * How far a wall's painted band reaches into the room, in squares. Wall textures are drawn
 * centered on the wall line and often leave transparent space; the outline runs clockwise,
 * so an outer wall's texture top faces outdoors and only its lower part reaches inside.
 */
export function wallReach(wall: AssetRecord | undefined, outer: boolean): number {
  if (!wall?.trim || !wall.size[1]) return INSET;
  const H = wall.size[1];
  const top = (H / 2 - wall.trim[1]) / PX_PER_SQUARE;
  const bottom = (wall.trim[1] + wall.trim[3] - H / 2) / PX_PER_SQUARE;
  const r = outer ? bottom : Math.max(top, bottom);
  return Math.max(0.12, Math.min(0.7, r + 0.04));
}

function roomOf(layout: Layout, zone: LayoutZone, reach?: { outer: number; inner: number }): Room {
  const r = zone.rect;
  const ext = new Set(layout.exterior[zone.id] ?? []);
  const sideInset = (s: Side) => (reach ? (ext.has(s) ? reach.outer : reach.inner) : INSET);
  const inner: Rect = { x: r.x + sideInset("west"), y: r.y + sideInset("north"), w: r.w - sideInset("west") - sideInset("east"), h: r.h - sideInset("north") - sideInset("south") };
  const sides: WallSide[] = [
    { side: "north", origin: [inner.x, inner.y], along: [1, 0], inward: [0, 1], length: inner.w, exterior: ext.has("north"), doors: [], windows: [] },
    { side: "south", origin: [inner.x, inner.y + inner.h], along: [1, 0], inward: [0, -1], length: inner.w, exterior: ext.has("south"), doors: [], windows: [] },
    { side: "west", origin: [inner.x, inner.y], along: [0, 1], inward: [1, 0], length: inner.h, exterior: ext.has("west"), doors: [], windows: [] },
    { side: "east", origin: [inner.x + inner.w, inner.y], along: [0, 1], inward: [-1, 0], length: inner.h, exterior: ext.has("east"), doors: [], windows: [] },
  ];
  const sideAt = (p: Vec): WallSide | undefined => {
    if (Math.abs(p[1] - r.y) < 1e-6 && p[0] > r.x && p[0] < r.x + r.w) return sides[0];
    if (Math.abs(p[1] - (r.y + r.h)) < 1e-6 && p[0] > r.x && p[0] < r.x + r.w) return sides[1];
    if (Math.abs(p[0] - r.x) < 1e-6 && p[1] > r.y && p[1] < r.y + r.h) return sides[2];
    if (Math.abs(p[0] - (r.x + r.w)) < 1e-6 && p[1] > r.y && p[1] < r.y + r.h) return sides[3];
    return undefined;
  };
  const doors: Room["doors"] = [];
  for (const d of layout.doors) {
    if (!d.between.includes(zone.id)) continue;
    const s = sideAt(d.at);
    if (!s) continue;
    s.doors.push(s.along[0] ? d.at[0] - s.origin[0] : d.at[1] - s.origin[1]);
    doors.push({ ...d, inward: s.inward, side: s.side });
  }
  for (const w of layout.windows) {
    const s = sideAt(w.at);
    if (s) s.windows.push(s.along[0] ? w.at[0] - s.origin[0] : w.at[1] - s.origin[1]);
  }
  const entry = doors.find((d) => d.between[1] === "outside" && d.main) ?? doors.find((d) => d.between[1] === "outside") ?? doors[0];
  return { zone, inner, sides, doors, entry, area: r.w * r.h };
}

const sidePoint = (s: WallSide, t: number, depth: number): Vec => add(add(s.origin, s.along, t), s.inward, depth);

/** Keeps door fronts and walkways between doors clear of furniture. */
function reserveCirculation(ctx: Ctx, room: Room): void {
  const g = ctx.grid;
  // Small rooms get a shallower clear zone so a bed still fits beside the door.
  const short = Math.min(room.inner.w, room.inner.h);
  const deep = Math.max(0.9, Math.min(1.5, short * 0.32));
  for (const d of room.doors) {
    const c = add(d.at, d.inward, deep / 2 + 0.1);
    const horiz = d.dir[0] !== 0;
    const span = Math.max(1.6, (d.width ?? 1) + 0.6);
    g.mark(rectAt(c, horiz ? [span, deep] : [deep, span]), Cell.Door);
  }
}

function wallSidesOrdered(ctx: Ctx, room: Room, pref: AnchorStep["wall"]): WallSide[] {
  const e = room.entry;
  const dist = (s: WallSide) => (e ? Math.hypot(...(add(sidePoint(s, s.length / 2, 0), e.at, -1) as [number, number])) : 0);
  const list = ctx.rng.shuffle([...room.sides]).filter((s) => s.length >= 1.2);
  const score = (s: WallSide) => {
    let v = 0;
    if (pref === "far") v += dist(s);
    if (pref === "exterior") v += s.exterior ? 10 : 0;
    if (pref === "interior") v += s.exterior ? 0 : 10;
    if (e && s.side === e.side) v -= 5;
    v -= s.doors.length * 1.5;
    return v + ctx.rng.next() * 1.5;
  };
  return list.sort((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------------------------------
// Surfaces

function dressSurface(ctx: Ctx, parent: Placed, spec: SurfaceSpec | undefined, mult = 1, overrides?: Record<string, number>): void {
  if (!spec) return;
  const zone = parent.zone;
  const [fw, fh] = parent.footprint;
  const top: Rect = { x: parent.center![0] - fw * 0.36, y: parent.center![1] - fh * 0.36, w: fw * 0.72, h: fh * 0.72 };
  const area = top.w * top.h;
  if (area < 0.12) return;
  const spots: Vec[] = [];
  const free = (p: Vec, r: number) => spots.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) > r);
  const putItem = (role: string, asset: AssetRecord) => {
    for (let t = 0; t < 8; t++) {
      const p: Vec = [top.x + ctx.rng.next() * top.w, top.y + ctx.rng.next() * top.h];
      if (!free(p, 0.22)) continue;
      spots.push(p);
      place(ctx, { asset, role, at: p, rot: ctx.rng.range(-Math.PI, Math.PI), layer: LAYER.surface, zone, feature: parent.feature, parent: parent.key, key: nextKey(ctx, `${parent.key}/${role}`), occupy: "force", scale: ctx.rng.range(0.9, 1.05) });
      return;
    }
  };
  // Spilled pieces carry a splash that reads as a stain on the furniture.
  const small = { placement: ["surface"], maxSide: Math.max(0.35, Math.min(spec.fill ? 1.2 : 0.9, Math.min(fw, fh) * (spec.fill ?? 0.6))), avoid: /spill/i };
  const candleSlot = overrides?.candle;
  if (candleSlot !== 0 && spec.candle && ctx.rng.next() < spec.candle) {
    const c = pick(ctx, zone, "candle", { ...small, lit: true }) ?? pick(ctx, zone, "candle", small);
    if (c) putItem("candle", c);
  }
  const n = Math.max(0, Math.round(area * spec.density * mult * ctx.rng.range(0.6, 1.3)));
  for (let i = 0; i < n; i++) {
    const menu = spec.items.filter(([r]) => !(overrides && overrides[r] === 0) && !(r === "mug" && overrides?.tankard === 0));
    const got = pickWeighted(ctx, zone, menu, small);
    if (got) putItem(got.role, got.asset);
  }
  if (overrides) for (const [role, count] of Object.entries(overrides)) {
    if (count <= 0 || ["chair", "stool", "bench", "seat"].includes(role)) continue;
    for (const r of rolesFor(role)) {
      const a = pick(ctx, zone, r, small);
      if (a) { for (let k = 0; k < count; k++) putItem(r, a); break; }
    }
  }
}

// ---------------------------------------------------------------------------------------
// Groups (tables with seating)

interface GroupPlan {
  puts: Put[];
  /** Index of the table (surface) in puts. */
  table?: number;
}

function seatsAround(ctx: Ctx, zone: string, table: { at: Vec; size: Vec; round: boolean }, seatRoles: Weighted, count: number | undefined, feature: string): Put[] {
  const out: Put[] = [];
  const seatPick = pickWeighted(ctx, zone, seatRoles.filter(([r]) => r !== "bench"), { placement: ["free", "wall"], composite: false, maxSide: 1.3, minSide: 0.5 });
  if (!seatPick) return out;
  const seat = seatPick.asset;
  const { depth } = frontSize(seat);
  const [tw, th] = table.size;
  const spots: Array<{ at: Vec; front: Vec }> = [];
  if (table.round) {
    const r = Math.max(tw, th) / 2 + depth / 2 - 0.12;
    const fit = Math.max(1, Math.floor((2 * Math.PI * r) / (frontSize(seat).width + 0.25)));
    const n = Math.min(fit, count ?? ctx.rng.int(2, 4));
    const a0 = ctx.rng.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * 2 * Math.PI) / n + ctx.rng.range(-0.25, 0.25);
      const v: Vec = [Math.cos(a), Math.sin(a)];
      spots.push({ at: add(table.at, v, r), front: [-v[0], -v[1]] });
    }
  } else {
    // Seats along each side; long sides get two when there's room.
    const sides: Array<{ n: Vec; len: number; half: number }> = [
      { n: [0, -1], len: tw, half: th / 2 }, { n: [0, 1], len: tw, half: th / 2 },
      { n: [-1, 0], len: th, half: tw / 2 }, { n: [1, 0], len: th, half: tw / 2 },
    ];
    for (const s of sides) {
      const k = s.len >= 1.7 ? Math.min(3, Math.floor(s.len / 0.85)) : 1;
      for (let i = 0; i < k; i++) {
        const t = (i + 0.5) / k - 0.5;
        const along: Vec = [Math.abs(s.n[1]), Math.abs(s.n[0])];
        const at = add(add(table.at, s.n, s.half + depth / 2 - 0.15), along, t * s.len * 0.92);
        spots.push({ at, front: [-s.n[0], -s.n[1]] });
      }
    }
    if (count !== undefined) ctx.rng.shuffle(spots).splice(count);
  }
  const boxes: Rect[] = [];
  for (const s of spots) {
    // Lived-in rooms: a missing chair here and there, others pushed back and turned.
    if (count === undefined && ctx.rng.next() < (ctx.wear === "clean" ? 0.05 : 0.15)) continue;
    const pushed = ctx.rng.next() < 0.2 ? 0.15 : 0;
    const at = add(add(s.at, s.front, -pushed), [ctx.rng.range(-0.04, 0.04), ctx.rng.range(-0.04, 0.04)]);
    const rot = rotationFor(seat, s.front) + ctx.rng.range(-0.16, 0.16) + (pushed ? ctx.rng.range(-0.25, 0.25) : 0);
    // Seats never pile into each other.
    const box = rectAt(at, aabb(seat, rot, 1), -0.06);
    if (boxes.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) continue;
    boxes.push(box);
    out.push({ asset: seat, role: seatPick.role, at, rot, layer: LAYER.furniture, zone, feature, occupy: "solid" });
  }
  return out;
}

/** An artist-made table set that includes seating (food-only table composites don't count). */
function pickSeatedSet(ctx: Ctx, zone: string): AssetRecord | undefined {
  if (forbidden(ctx, zone, "table_set")) return undefined;
  const style = restyleFor(ctx, zone, "table_set") ?? ctx.style;
  const pool = poolFor(ctx.cat, style, "table_set", { genre: ctx.plan.genre, wear: ctx.wear, composite: true, maxSide: 3.4, seated: true });
  return pool.length ? ctx.rng.pick(pool) : undefined;
}

function planGroup(ctx: Ctx, zone: string, kind: GroupKind, step: { seats?: Weighted }, feature: string, seatCount?: number): GroupPlan | undefined {
  const seatRoles = step.seats ?? [["chair", 1]];
  if (kind === "composite") {
    if (seatCount !== undefined) return undefined;
    const a = pickSeatedSet(ctx, zone);
    if (!a) return undefined;
    const rot = ctx.rng.int(0, 3) * (Math.PI / 2) + ctx.rng.range(-0.1, 0.1);
    return { puts: [{ asset: a, role: "table_set", at: [0, 0], rot, layer: LAYER.furniture, zone, feature, occupy: "solid" }] };
  }
  if (kind === "lounge") return planLounge(ctx, zone, feature);
  if (kind === "pair") {
    const t = pick(ctx, zone, "table_small", { composite: false, maxSide: 1.3 }) ?? pick(ctx, zone, "table_medium", { composite: false, maxSide: 1.6 });
    const seatPick = pickWeighted(ctx, zone, (step.seats ?? [["chair", 1]]).filter(([r]) => r !== "bench"), { composite: false, maxSide: 1.1 });
    if (!t || !seatPick) return undefined;
    const ts = aabb(t, 0, 1);
    const d = frontSize(seatPick.asset).depth;
    const puts: Put[] = [{ asset: t, role: t.tag?.role ?? "table_small", at: [0, 0], rot: 0, layer: LAYER.furniture, zone, feature, occupy: "solid" }];
    for (const sgn of [-1, 1]) {
      const n: Vec = [sgn, 0];
      puts.push({ asset: seatPick.asset, role: seatPick.role, at: [sgn * (ts[0] / 2 + d / 2 - 0.12), ctx.rng.range(-0.08, 0.08)], rot: rotationFor(seatPick.asset, [-n[0], -n[1]]) + ctx.rng.range(-0.2, 0.2), layer: LAYER.furniture, zone, feature, occupy: "solid" });
    }
    return { puts, table: 0 };
  }
  const tableRole = kind === "long" ? "table_long" : kind === "round" ? "table_small" : kind === "desk" ? "desk" : "table_medium";
  const t = pick(ctx, zone, tableRole, { composite: false, placement: ["free", "wall"], maxSide: kind === "long" ? 4.5 : 2.4 }) ?? pick(ctx, zone, "table_medium", { composite: false, maxSide: 2.4 });
  if (!t) return undefined;
  const round = t.tag?.facing === "none" && Math.abs(t.footprint![0] - t.footprint![1]) < 0.15 && /round|circ/i.test(t.name) ? true : kind === "round" && t.tag?.facing === "none";
  const rot = round ? ctx.rng.range(0, Math.PI * 2) : ctx.rng.int(0, 1) * (Math.PI / 2) + ctx.rng.range(-0.05, 0.05);
  const size = aabb(t, Math.round(rot / (Math.PI / 2)) * (Math.PI / 2), 1);
  const puts: Put[] = [{ asset: t, role: tableRole, at: [0, 0], rot, layer: LAYER.furniture, zone, feature, occupy: "solid" }];
  if (kind === "long" && seatCount === undefined && ctx.rng.next() < 0.6) {
    // Benches along the two long sides.
    const bench = pick(ctx, zone, "bench", { composite: false, maxSide: Math.max(size[0], size[1]) + 0.3 });
    if (bench) {
      const horiz = size[0] >= size[1];
      const { depth } = frontSize(bench);
      for (const sgn of [-1, 1]) {
        const n: Vec = horiz ? [0, sgn] : [sgn, 0];
        const at = add([0, 0], n, (horiz ? size[1] : size[0]) / 2 + depth / 2 - 0.1);
        puts.push({ asset: bench, role: "bench", at, rot: rotationFor(bench, [-n[0], -n[1]]) + ctx.rng.range(-0.04, 0.04), layer: LAYER.furniture, zone, feature, occupy: "solid" });
      }
      return { puts, table: 0 };
    }
  }
  puts.push(...seatsAround(ctx, zone, { at: [0, 0], size, round }, seatRoles, seatCount, feature));
  return { puts, table: 0 };
}

/** A sitting group: a low table with a sofa on one side and armchairs turned toward it. */
function planLounge(ctx: Ctx, zone: string, feature: string): GroupPlan | undefined {
  const t = pick(ctx, zone, "table_small", { composite: false, maxSide: 1.4 }) ?? pick(ctx, zone, "side_table", { composite: false, maxSide: 1.4 });
  const sofa = pick(ctx, zone, "sofa", { composite: false, maxSide: 3 });
  const arm = pick(ctx, zone, "armchair", { composite: false, maxSide: 1.4 });
  if (!t || (!sofa && !arm)) return undefined;
  const ts = aabb(t, 0, 1);
  const puts: Put[] = [{ asset: t, role: t.tag?.role ?? "table_small", at: [0, 0], rot: 0, layer: LAYER.furniture, zone, feature, occupy: "solid" }];
  const dirs: Vec[] = ctx.rng.shuffle([[0, -1], [0, 1], [-1, 0], [1, 0]] as Vec[]);
  dirs.forEach((n, i) => {
    const seat = i === 0 && sofa ? sofa : arm;
    if (!seat || (i > 2) || (i === 2 && ctx.rng.next() < 0.5)) return;
    const half = n[0] ? ts[0] / 2 : ts[1] / 2;
    const at = add([0, 0], n, half + frontSize(seat).depth / 2 + 0.25);
    puts.push({ asset: seat, role: seat === sofa ? "sofa" : "armchair", at, rot: rotationFor(seat, [-n[0], -n[1]]) + ctx.rng.range(-0.07, 0.07), layer: LAYER.furniture, zone, feature, occupy: "solid" });
  });
  return { puts, table: 0 };
}

/** The same group turned 90 degrees about its center. */
function turnGroup(g: GroupPlan): GroupPlan {
  return { ...g, puts: g.puts.map((p) => ({ ...p, at: [-p.at[1], p.at[0]] as Vec, rot: (p.rot ?? 0) + Math.PI / 2 })) };
}

/** Places a planned group centered at `at`; all or nothing. */
/** True when every piece of the group fits at `at` with `pad` of aisle around the group. */
function groupFits(ctx: Ctx, g: GroupPlan, at: Vec, pad: number): boolean {
  const puts = g.puts.map((p) => ({ ...p, at: add(p.at, at) }));
  for (const p of puts) {
    const size = aabb(p.asset, p.rot ?? 0, p.scale ?? 1);
    if (!ctx.grid.fits(rectAt(p.at, size, -0.04), SOLID_OK)) return false;
  }
  const box = groupBox(puts);
  return ctx.grid.fits({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }, (c) => c !== Cell.Solid && c !== Cell.Wall);
}

/** Share of occupied cells in a ring around the group: high when it sits snug against walls and furniture. */
function contact(ctx: Ctx, g: GroupPlan, at: Vec, pad: number): number {
  const box = groupBox(g.puts.map((p) => ({ ...p, at: add(p.at, at) })));
  const outer = { x: box.x - pad - 0.6, y: box.y - pad - 0.6, w: box.w + 2 * pad + 1.2, h: box.h + 2 * pad + 1.2 };
  let hit = 0, all = 0;
  const step = 0.25;
  for (let y = outer.y; y < outer.y + outer.h; y += step) for (let x = outer.x; x < outer.x + outer.w; x += step) {
    const inside = x > box.x - pad && x < box.x + box.w + pad && y > box.y - pad && y < box.y + box.h + pad;
    if (inside) continue;
    all++;
    if (!ctx.grid.fits({ x, y, w: 0.01, h: 0.01 }, (c) => c === Cell.Free || c === Cell.Path)) hit++;
  }
  return all ? hit / all : 0;
}

function placeGroup(ctx: Ctx, g: GroupPlan, at: Vec, pad: number, key: string, directive?: string): Placed[] | undefined {
  if (!groupFits(ctx, g, at, pad)) return undefined;
  const puts = g.puts.map((p) => ({ ...p, at: add(p.at, at) }));
  const out: Placed[] = [];
  puts.forEach((p, i) => {
    const pl = place(ctx, { ...p, key: i === 0 ? key : `${key}/${p.role}#${i}`, parent: i === 0 ? undefined : key, directive, occupy: "force" });
    if (pl) {
      ctx.grid.mark(rectAt(p.at, pl.footprint), Cell.Solid);
      out.push(pl);
    }
  });
  return out;
}

function groupBox(puts: Put[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of puts) {
    const s = aabb(p.asset, p.rot ?? 0, p.scale ?? 1);
    x0 = Math.min(x0, p.at[0] - s[0] / 2); y0 = Math.min(y0, p.at[1] - s[1] / 2);
    x1 = Math.max(x1, p.at[0] + s[0] / 2); y1 = Math.max(y1, p.at[1] + s[1] / 2);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function rugUnder(ctx: Ctx, zone: string, box: Rect, feature: string, parent: string): void {
  const rug = pick(ctx, zone, "rug", { placement: ["rug"], composite: false });
  if (!rug) return;
  const [rw, rh] = rug.footprint!;
  const horiz = box.w >= box.h;
  const rot = (rw >= rh) === horiz ? 0 : Math.PI / 2;
  const s = aabb(rug, rot, 1);
  const scale = Math.max(0.6, Math.min(1.4, Math.min((box.w * 0.95) / s[0], (box.h * 0.95) / s[1]) * 1.05));
  place(ctx, { asset: rug, role: "rug", at: [box.x + box.w / 2, box.y + box.h / 2], rot: rot + ctx.rng.range(-0.04, 0.04), scale, layer: LAYER.rug, zone, feature, parent, key: nextKey(ctx, `${parent}/rug`), occupy: "low" });
}

/** Poisson-ish candidate points over a rect, in random order. */
function candidates(rng: Rng, r: Rect, spacing: number): Vec[] {
  const pts: Vec[] = [];
  for (let y = r.y + spacing / 2; y < r.y + r.h; y += spacing) for (let x = r.x + spacing / 2; x < r.x + r.w; x += spacing) {
    pts.push([x + rng.range(-spacing * 0.35, spacing * 0.35), y + rng.range(-spacing * 0.35, spacing * 0.35)]);
  }
  return rng.shuffle(pts);
}

function countFor(ctx: Ctx, room: Room, step: { perArea?: number; count?: [number, number] }, mods: ModifyDirective[], base?: number): number {
  let n = base ?? Math.round(room.area * (step.perArea ?? 0) * ctx.rng.range(0.85, 1.15));
  if (step.count) n = Math.max(step.count[0], Math.min(step.count[1], n));
  for (const m of mods) {
    if (typeof m.count === "number") n = m.count;
    else if (m.count) n = Math.max(m.count.min ?? 0, Math.min(m.count.max ?? 60, n));
  }
  return Math.max(0, Math.min(60, n));
}

// ---------------------------------------------------------------------------------------
// Steps

function runGroups(ctx: Ctx, room: Room, step: GroupsStep): void {
  const zone = room.zone.id;
  const mods = modifiers(ctx, zone, step);
  const n = Math.max(0, countFor(ctx, room, step, mods) - lockedRoots(ctx, zone, step));
  const slots = mods.find((m) => m.slots)?.slots;
  const seatCount = slots ? slots.chair ?? slots.seat ?? slots.stool : undefined;
  let made = 0, misses = 0;
  const kinds = step.kinds.filter(([k]) => !(seatCount !== undefined && k === "composite"));
  const { inner } = room;
  while (made < n && misses < 14) {
    // Late in the room, smaller groups: pairs fit where four-seat tables don't.
    const [kind] = misses >= 6 ? (["pair", 1] as [GroupKind, number]) : ctx.rng.weighted(kinds, (k) => k[1]);
    let g = planGroup(ctx, zone, kind, step, step.id, seatCount);
    if (!g) { misses++; continue; }
    // Best of many spots: the one that packs snugly against walls and other groups.
    let best: Vec | undefined, bestScore = -Infinity;
    // Try the group as planned and turned a quarter: thin leftover strips often fit one of them.
    const turned = turnGroup(g);
    let bestG = g;
    for (let k = 0; k < 110; k++) {
      const p: Vec = [inner.x + 0.6 + ctx.rng.next() * (inner.w - 1.2), inner.y + 0.6 + ctx.rng.next() * (inner.h - 1.2)];
      for (const cand of [g, turned]) {
        if (!groupFits(ctx, cand, p, step.aisle)) continue;
        const s = contact(ctx, cand, p, step.aisle) + ctx.rng.next() * 0.15;
        if (s > bestScore) { bestScore = s; best = p; bestG = cand; }
      }
    }
    if (!best) { misses++; continue; }
    const p = best;
    g = bestG;
    {
      const key = nextKey(ctx, `${zone}/${step.id}`);
      const res = placeGroup(ctx, g, p, step.aisle, key);
      if (!res) { misses++; continue; }
      made++;
      const table = res[0]!;
      if (step.rug && (ctx.rng.next() < step.rug || g.puts.some((q) => q.role === "sofa" || q.role === "armchair")) && !forbidden(ctx, zone, "rug")) rugUnder(ctx, zone, groupBox(g.puts.map((q) => ({ ...q, at: add(q.at, p) }))), step.id, key);
      if (table.type !== "table_set") dressSurface(ctx, table, step.surface, 1, slots);
      else if (step.surface && ctx.rng.next() < 0.5) dressSurface(ctx, { ...table, footprint: [table.footprint[0] * 0.45, table.footprint[1] * 0.45] }, { items: step.surface.items, density: 2 });
    }
  }
  if (made < (step.count?.[0] ?? 0)) ctx.notes.push(`${zone}: only ${made} of ${n} table groups fit`);
}

/** Places a single piece flush against a wall side at position t (center), facing into the room. */
function onWall(ctx: Ctx, room: Room, s: WallSide, t: number, asset: AssetRecord, role: string, feature: string, opts: { gap?: number; occupy?: Put["occupy"]; layer?: number; key?: string; parent?: string; directive?: string; jitter?: number } = {}): Placed | undefined {
  const { width, depth } = frontSize(asset);
  if (t - width / 2 < 0.05 || t + width / 2 > s.length - 0.05) return undefined;
  const at = sidePoint(s, t, depth / 2 + (opts.gap ?? 0) + 0.02);
  const rot = rotationFor(asset, s.inward) + (opts.jitter ? ctx.rng.range(-opts.jitter, opts.jitter) : 0);
  return place(ctx, { asset, role, at, rot, layer: opts.layer ?? LAYER.furniture, zone: room.zone.id, feature, key: opts.key, parent: opts.parent, directive: opts.directive, occupy: opts.occupy ?? "solid" });
}

/** Outdoor ground marks and effects that look wrong on an indoor floor. */
const INDOOR_DECAL_AVOID = /ribbon|forest|grass|road|path|impact|soil|colorable|dust edge|trail|patch|crater|leaf|leaves|snow/i;

const PLANTS = new Set(["bush", "tree", "dead_tree", "tree_canopy", "hedge", "grass", "flowers", "plant", "leaves", "moss", "crops", "mushroom", "stump", "log"]);

const TALL = new Set(["wardrobe", "bookshelf", "shelf", "cabinet", "display_case", "rack", "dresser", "armor_stand"]);
const CLUSTER_ROLES = new Set(["barrel", "crate", "sack", "basket", "pot_large", "keg", "bones"]);

function runLine(ctx: Ctx, room: Room, step: LineStep, only?: { side: WallSide; from: number; to: number; maxDepth?: number }): void {
  const zone = room.zone.id;
  const mods = modifiers(ctx, zone, step);
  let cov = ctx.rng.range(step.coverage[0], step.coverage[1]);
  for (const m of mods) {
    if (typeof m.count === "number") cov = Math.min(1, m.count / 10);
    else if (m.count?.max !== undefined) cov = Math.min(cov, m.count.max / 10);
  }
  const sides = only ? [only.side] : ctx.rng.shuffle(room.sides.filter((s) => (step.walls === "exterior" ? s.exterior : step.walls === "interior" ? !s.exterior : true)));
  const clusters = new Set(step.clusters ?? []);
  // Each repeat of a role makes it less likely, so one kind of piece doesn't take every wall.
  const used = new Map<string, number>();
  const menu = (): Weighted => step.roles.map(([r, w]) => [r, w / (1 + 1.5 * (used.get(r) ?? 0))] as [string, number]);
  for (const s of sides) {
    const from = only?.from ?? 0, to = only?.to ?? s.length;
    const target = (to - from) * cov;
    let covered = 0;
    let t = from + ctx.rng.range(0.05, 0.6);
    let guard = 0;
    while (t < to - 0.3 && covered < target && guard++ < 300) {
      // A few tries at this spot before moving on: big pieces often don't fit where small ones do.
      let done = 0;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const got = pickWeighted(ctx, zone, menu(), { placement: ["wall", "free", "corner"], composite: undefined, maxSide: attempt === 0 ? 3.2 : 1.8 });
        if (!got) break;
        const { asset, role } = got;
        used.set(role, (used.get(role) ?? 0) + (clusters.has(role) || CLUSTER_ROLES.has(role) ? 0.4 : 1));
        const { width, depth } = frontSize(asset);
        if (only?.maxDepth && depth > only.maxDepth) continue;
        const nearWindow = s.windows.some((w) => Math.abs(w - (t + width / 2)) < width / 2 + 0.4);
        if (TALL.has(role) && nearWindow) continue;
        if (t + width > to - 0.05) continue;
        if (clusters.has(role) || CLUSTER_ROLES.has(role)) {
          const k = placeCluster(ctx, room, s, t, role, step.id, step.gap ?? 0);
          if (k > 0) { covered += k; done = k + ctx.rng.range(0.1, 0.6); }
          continue;
        }
        const pl = onWall(ctx, room, s, t + width / 2, asset, role, step.id, { jitter: step.gap ? 0.15 : 0.03, gap: step.gap });
        if (!pl) continue;
        covered += width;
        if (step.surface && ["counter", "shelf", "cabinet", "dresser", "side_table", "table_small", "workbench", "table_medium", "desk", "bookshelf", "display_case"].includes(role)) dressSurface(ctx, pl, step.surface);
        // Gaps: tight runs for counters and shelves, looser elsewhere.
        done = width + (role === "counter" || role === "shelf" ? ctx.rng.range(0, 0.12) : ctx.rng.range(0.05, 0.45));
      }
      t += done || 0.2;
      if (done && ctx.rng.next() < 0.1) t += ctx.rng.range(0.6, 1.5);
    }
    // Gap fill: small pieces tucked into what's left of the wall.
    if (step.fill && !only) {
      let u = 0.1;
      let filled = 0;
      while (u < s.length - 0.3 && filled < s.length * 0.4) {
        const got = pickWeighted(ctx, zone, step.fill, { composite: false, maxSide: 1.1 });
        if (!got) break;
        const { width } = frontSize(got.asset);
        const rot = got.asset.tag?.facing === "none" ? ctx.rng.range(0, Math.PI * 2) : undefined;
        const at = sidePoint(s, u + width / 2, frontSize(got.asset).depth / 2 + 0.03);
        const pl = rot === undefined
          ? onWall(ctx, room, s, u + width / 2, got.asset, got.role, step.id, { jitter: 0.2 })
          : place(ctx, { asset: got.asset, role: got.role, at, rot, layer: LAYER.furniture, zone, feature: step.id, occupy: "solid" });
        if (pl) { filled += width; u += width + ctx.rng.range(0, 0.3); } else u += 0.25;
      }
    }
  }
}

/** Two or three barrels, crates or sacks bunched against a wall. Returns the width used. */
function placeCluster(ctx: Ctx, room: Room, s: WallSide, t: number, role: string, feature: string, offset = 0): number {
  const zone = room.zone.id;
  const a = pick(ctx, zone, role, { composite: undefined, maxSide: 2.2 });
  if (!a) return 0;
  const n = a.tag?.composite ? 1 : ctx.rng.int(1, 3);
  let used = 0;
  let first: Placed | undefined;
  for (let i = 0; i < n; i++) {
    const b = i === 0 ? a : pick(ctx, zone, role, { composite: false, maxSide: 1.6 }) ?? a;
    const { width, depth } = frontSize(b);
    const behindRow = i === 2 && ctx.rng.next() < 0.5;
    const tt = behindRow ? t + used / 2 : t + used + width / 2;
    if (tt + width / 2 > s.length - 0.05) break;
    const gap = offset + (behindRow ? depth * 0.9 : ctx.rng.range(0, 0.08));
    const at = sidePoint(s, tt + ctx.rng.range(-0.05, 0.05), depth / 2 + gap + 0.02);
    const round = /barrel|keg|pot|urn|sack|basket|bucket/i.test(b.name) || role === "barrel" || role === "sack" || role === "pot_large";
    const rot = b.tag?.facing === "none" ? (round ? ctx.rng.range(0, Math.PI * 2) : rotationFor(b, s.inward) + ctx.rng.int(0, 1) * (Math.PI / 2) + ctx.rng.range(-0.08, 0.08)) : rotationFor(b, s.inward) + ctx.rng.range(-0.12, 0.12);
    const pl = place(ctx, { asset: b, role, at, rot, layer: LAYER.furniture, zone, feature, occupy: "solid", parent: first?.key, key: first ? nextKey(ctx, `${first.key}/${role}`) : undefined });
    if (!pl) break;
    first ??= pl;
    if (!behindRow) used += width + ctx.rng.range(0, 0.06);
  }
  return used;
}

function runAnchor(ctx: Ctx, room: Room, step: AnchorStep, directive?: string): Placed | undefined {
  const zone = room.zone.id;
  const roles = step.roles.filter((r) => !forbidden(ctx, zone, r));
  // Each role's pieces, the picked one first and then smaller ones, so a cramped room still gets its bed.
  const tries: Array<{ role: string; asset: AssetRecord }> = [];
  const maxArea = room.area * 0.15;
  for (const role of roles) {
    let first = pick(ctx, zone, role, { placement: ["wall", "free", "corner"], composite: step.composite });
    if (first && step.essential && (first.tag?.condition === "broken" || first.footprint![0] * first.footprint![1] > maxArea)) {
      const style = restyleFor(ctx, zone, role) ?? ctx.style;
      const whole = poolFor(ctx.cat, style, role, { genre: ctx.plan.genre, wear: "lived-in", placement: ["wall", "free", "corner"], composite: step.composite }).filter((a) => a.footprint![0] * a.footprint![1] <= maxArea);
      if (whole.length) first = ctx.rng.pick(whole);
    }
    if (!first) continue;
    tries.push({ role, asset: first });
    const style = restyleFor(ctx, zone, role) ?? ctx.style;
    const pool = poolFor(ctx.cat, style, role, { genre: ctx.plan.genre, wear: ctx.wear, placement: ["wall", "free", "corner"], composite: step.composite });
    const area = (a: AssetRecord) => a.footprint![0] * a.footprint![1];
    for (const a of [...pool].sort((p, q) => area(p) - area(q)).slice(0, 2)) if (a !== first && area(a) < area(first)) tries.push({ role, asset: a });
  }
  for (const { role, asset } of tries) {
    const { width, depth } = frontSize(asset);
    for (const s of wallSidesOrdered(ctx, room, step.wall)) {
      const free = s.length - width - 0.2;
      if (free < 0) continue;
      const ts = step.at === "center" ? [s.length / 2, ...Array.from({ length: 6 }, () => ctx.rng.range(width / 2 + 0.1, s.length - width / 2 - 0.1))] : Array.from({ length: 10 }, () => ctx.rng.range(width / 2 + 0.1, s.length - width / 2 - 0.1));
      for (const t of ts) {
        // Keep the area in front clear for the company the anchor brings.
        const reach = (step.seats ? step.seats.dist + 1 : 0) + (step.rug ? 1.2 : 0);
        const front = sidePoint(s, t, (step.gap ?? 0) + depth + reach / 2);
        if (reach && !ctx.grid.fits(rectAt(front, s.along[0] ? [width, reach] : [reach, width]), (c) => c !== Cell.Solid && c !== Cell.Wall)) continue;
        const pl = onWall(ctx, room, s, t, asset, role, step.id, { gap: step.gap, directive });
        if (!pl) continue;
        anchorCompany(ctx, room, s, t, pl, step);
        return pl;
      }
    }
  }
  return undefined;
}

function anchorCompany(ctx: Ctx, room: Room, s: WallSide, t: number, pl: Placed, step: AnchorStep): void {
  const zone = room.zone.id;
  const { width, depth } = frontSize(pl.asset);
  const baseDepth = (step.gap ?? 0) + depth;
  if (step.flank && ctx.rng.next() < step.flank.p) {
    for (const role of step.flank.roles) {
      const f = pick(ctx, zone, role, { composite: false, maxSide: 1.5, lit: true }) ?? pick(ctx, zone, role, { composite: false, maxSide: 1.5 });
      if (!f) continue;
      const fw = frontSize(f).width;
      for (const sgn of [-1, 1]) onWall(ctx, room, s, t + sgn * (width / 2 + fw / 2 + 0.12), f, role, step.id, { gap: Math.max(0, baseDepth - frontSize(f).depth), parent: pl.key, key: nextKey(ctx, `${pl.key}/${role}`) });
      break;
    }
  }
  if (step.rug && ctx.rng.next() < step.rug.p) {
    for (const role of step.rug.roles) {
      const rug = pick(ctx, zone, role, { placement: ["rug"], composite: false });
      if (!rug) continue;
      const [rw, rh] = rug.footprint!;
      const long = Math.max(rw, rh), short = Math.min(rw, rh);
      const scale = Math.min(1.3, Math.max(0.6, (width + 0.6) / long));
      const at = sidePoint(s, t, baseDepth + (short * scale) / 2 - 0.1);
      const rot = norm(ang(s.along) - (rw >= rh ? 0 : Math.PI / 2));
      place(ctx, { asset: rug, role, at, rot, scale, layer: LAYER.rug, zone, feature: step.id, parent: pl.key, key: nextKey(ctx, `${pl.key}/rug`), occupy: "low" });
      break;
    }
  }
  if (step.seats && ctx.rng.next() < step.seats.p) {
    const n = ctx.rng.int(step.seats.n[0], step.seats.n[1]);
    const seat = step.seats.roles.map((r) => ({ r, a: pick(ctx, zone, r, { composite: false, maxSide: 3 }) })).find((x) => x.a);
    if (seat) {
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? ctx.rng.range(-0.3, 0.3) : (i - (n - 1) / 2) * Math.max(1.3, width * 0.8);
        const at = sidePoint(s, t + off, baseDepth + step.seats.dist);
        const toward = add(sidePoint(s, t, baseDepth), at, -1);
        const len = Math.hypot(toward[0], toward[1]) || 1;
        const front: Vec = step.seats.dist < 0 ? [-s.inward[0], -s.inward[1]] : [toward[0] / len, toward[1] / len];
        place(ctx, { asset: seat.a!, role: seat.r, at, rot: rotationFor(seat.a!, front) + ctx.rng.range(-0.15, 0.15), layer: LAYER.furniture, zone, feature: step.id, parent: pl.key, key: nextKey(ctx, `${pl.key}/${seat.r}`), occupy: step.seats.dist < 0 ? "force" : "solid" });
      }
    }
  }
  if (step.surface) dressSurface(ctx, pl, step.surface);
}

function runBar(ctx: Ctx, room: Room, step: BarStep): void {
  const zone = room.zone.id;
  if (forbidden(ctx, zone, "bar_counter")) return;
  const tries = [pick(ctx, zone, "bar_counter", { composite: true, maxSide: 7 }), pick(ctx, zone, "bar_counter", { composite: false, maxSide: 7 })].filter((a): a is AssetRecord => !!a);
  if (!tries.length) return;
  const sides = wallSidesOrdered(ctx, room, "interior");
  for (const bar of ctx.rng.next() < 0.5 ? tries : tries.reverse()) {
    if (bar.tag?.placement === "corner") {
      if (cornerBar(ctx, room, step, bar)) return;
      continue;
    }
    const { width, depth } = frontSize(bar);
    const back = 1.25;
    for (const s of sides) {
      if (s.length < width + 1.2) continue;
      for (let k = 0; k < 8; k++) {
        const t = k === 0 ? s.length / 2 : ctx.rng.range(width / 2 + 0.3, s.length - width / 2 - 0.3);
        // The bar, the walkway behind it, and room for stools in front must all be free.
        const zoneRect = rectAt(sidePoint(s, t, (back + depth + 1) / 2), s.along[0] ? [width + 0.4, back + depth + 1] : [back + depth + 1, width + 0.4]);
        if (!ctx.grid.fits(zoneRect, SOLID_OK)) continue;
        const key = nextKey(ctx, `${zone}/${step.id}`);
        const pl = onWall(ctx, room, s, t, bar, "bar_counter", step.id, { gap: back, key });
        if (!pl) continue;
        // Bottle shelves along the wall behind the bar (shallow pieces only), then keep the walkway clear.
        runLine(ctx, room, { kind: "line", id: `${step.id}_back`, roles: step.back, coverage: [0.75, 0.95], surface: { items: [["bottle", 4], ["mug", 2], ["food", 1]], density: 1.2 } }, { side: s, from: Math.max(0, t - width / 2 - 0.4), to: Math.min(s.length, t + width / 2 + 0.4), maxDepth: 0.7 });
        ctx.grid.mark(rectAt(sidePoint(s, t, back / 2 + 0.35), s.along[0] ? [width, back - 0.7] : [back - 0.7, width]), Cell.Path, true);
        if (!bar.tag?.composite && !forbidden(ctx, zone, "stool")) {
          const stool = pick(ctx, zone, "stool", { composite: false, maxSide: 1 }) ?? pick(ctx, zone, "chair", { composite: false, maxSide: 1 });
          if (stool) {
            const n = Math.max(1, Math.floor(width / 0.95));
            for (let i = 0; i < n; i++) {
              if (ctx.rng.next() < 0.15) continue;
              const tt = t - width / 2 + (i + 0.5) * (width / n) + ctx.rng.range(-0.08, 0.08);
              const at = sidePoint(s, tt, back + depth + frontSize(stool).depth / 2 + 0.12);
              place(ctx, { asset: stool, role: "stool", at, rot: rotationFor(stool, [-s.inward[0], -s.inward[1]]) + ctx.rng.range(-0.3, 0.3), layer: LAYER.furniture, zone, feature: step.id, parent: key, key: nextKey(ctx, `${key}/stool`), occupy: "solid" });
            }
          }
        }
        dressSurface(ctx, pl, step.surface);
        return;
      }
    }
  }
  ctx.notes.push(`${zone}: no wall had room for the bar`);
}

/**
 * L-shaped bars drawn with the bartender's area in the image's top-left go into a room
 * corner, turned so that area meets the corner; shelves line the walls inside the L and
 * stools line its outer edges.
 */
function cornerBar(ctx: Ctx, room: Room, step: BarStep, bar: AssetRecord): boolean {
  const zone = room.zone.id;
  const { inner } = room;
  const [W, H] = bar.footprint!;
  const corners = ctx.rng.shuffle([
    { c: [inner.x, inner.y] as Vec, rot: 0, a: room.sides[0]!, b: room.sides[2]!, fromEndA: false, fromEndB: false },
    { c: [inner.x + inner.w, inner.y] as Vec, rot: Math.PI / 2, a: room.sides[3]!, b: room.sides[0]!, fromEndA: false, fromEndB: true },
    { c: [inner.x + inner.w, inner.y + inner.h] as Vec, rot: Math.PI, a: room.sides[1]!, b: room.sides[3]!, fromEndA: true, fromEndB: true },
    { c: [inner.x, inner.y + inner.h] as Vec, rot: -Math.PI / 2, a: room.sides[2]!, b: room.sides[1]!, fromEndA: true, fromEndB: false },
  ]);
  // Corners away from the entrance first.
  const e = room.entry;
  if (e) corners.sort((p, q) => Math.hypot(q.c[0] - e.at[0], q.c[1] - e.at[1]) - Math.hypot(p.c[0] - e.at[0], p.c[1] - e.at[1]));
  for (const k of corners) {
    const R = (v: Vec) => rotate(v, k.rot);
    const center = add(k.c, R([W / 2, H / 2]));
    const size = aabb(bar, k.rot, 1);
    // Room for the bar plus a stool row along both outer edges.
    if (!ctx.grid.fits(rectAt(center, [size[0] + 1.6, size[1] + 1.6]), (c) => c === Cell.Free || c === Cell.Path || c === Cell.Wall)) continue;
    if (!ctx.grid.fits(rectAt(center, size, -0.05), SOLID_OK)) continue;
    const key = nextKey(ctx, `${zone}/${step.id}`);
    // Back shelves along the two walls inside the L (the image's top and left edges).
    const lenA = k.rot === 0 || k.rot === Math.PI ? W : H, lenB = k.rot === 0 || k.rot === Math.PI ? H : W;
    const backLine = (s: WallSide, len: number, fromEnd: boolean) => runLine(ctx, room, { kind: "line", id: `${step.id}_back`, roles: step.back, coverage: [0.6, 0.9], surface: { items: [["bottle", 4], ["mug", 2]], density: 1.2 } }, { side: s, from: fromEnd ? s.length - len + 0.9 : 0, to: fromEnd ? s.length : len - 0.9, maxDepth: 0.75 });
    backLine(k.a, lenA, k.fromEndA);
    backLine(k.b, lenB, k.fromEndB);
    const pl = place(ctx, { asset: bar, role: "bar_counter", at: center, rot: k.rot, layer: LAYER.furniture, zone, feature: step.id, key, occupy: "force" });
    if (!pl) continue;
    ctx.grid.mark(rectAt(center, size), Cell.Solid);
    if (!bar.tag?.composite) {
      const stool = pick(ctx, zone, "stool", { composite: false, maxSide: 1 });
      if (stool) {
        const sd = frontSize(stool).depth;
        const spots: Array<{ at: Vec; front: Vec }> = [];
        for (let x = 0.5; x < W - 0.8; x += 0.95) spots.push({ at: [x, H + sd / 2 + 0.08], front: [0, -1] });
        for (let y = 0.5; y < H - 0.8; y += 0.95) spots.push({ at: [W + sd / 2 + 0.08, y], front: [-1, 0] });
        for (const s of spots) {
          if (ctx.rng.next() < 0.15) continue;
          place(ctx, { asset: stool, role: "stool", at: add(k.c, R(s.at)), rot: rotationFor(stool, R(s.front)) + ctx.rng.range(-0.3, 0.3), layer: LAYER.furniture, zone, feature: step.id, parent: key, key: nextKey(ctx, `${key}/stool`), occupy: "solid" });
        }
      }
    }
    dressSurface(ctx, { ...pl, footprint: [Math.min(pl.footprint[0], 1.2), Math.min(pl.footprint[1], 1.2)], center: add(k.c, R([W * 0.75, H * 0.78])) }, step.surface, 2);
    return true;
  }
  return false;
}

function runRows(ctx: Ctx, room: Room, step: RowsStep): void {
  const zone = room.zone.id;
  const role = step.roles.find((r) => !forbidden(ctx, zone, r) && pick(ctx, zone, r, { composite: false }));
  if (!role) return;
  // Rows face the wall farthest from the entrance.
  const far = wallSidesOrdered(ctx, room, "far")[0]!;
  const toward: Vec = [-far.inward[0], -far.inward[1]];
  const across = far.along;
  const depthTotal = far.along[0] ? room.inner.h : room.inner.w;
  const widthTotal = far.length;
  const usable = depthTotal - step.front - step.back;
  const half = (widthTotal - step.aisle) / 2 - 0.3;
  const piece = pick(ctx, zone, role, { composite: false, maxSide: Math.max(1.2, half) })!;
  if (!piece) return;
  const { width, depth } = frontSize(piece);
  const perHalf = Math.max(1, Math.floor((half + 0.1) / (width + 0.15)));
  const rows = Math.floor((usable + step.gap) / (depth + step.gap));
  const mods = modifiers(ctx, zone, step);
  const maxRows = countFor(ctx, room, { count: [0, rows] }, mods, rows);
  for (let r = 0; r < maxRows; r++) {
    const d = step.front + depth / 2 + r * (depth + step.gap);
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < perHalf; k++) {
        const off = step.aisle / 2 + 0.15 + k * (width + 0.15) + width / 2;
        const at = add(sidePoint(far, far.length / 2 + sgn * off, d), [ctx.rng.range(-0.04, 0.04), ctx.rng.range(-0.04, 0.04)]);
        const ruined = ctx.wear === "ruined" && ctx.rng.next() < 0.3;
        if (ruined && ctx.rng.next() < 0.5) continue;
        place(ctx, { asset: piece, role, at, rot: rotationFor(piece, toward) + ctx.rng.range(-0.03, 0.03) + (ruined ? ctx.rng.range(-0.4, 0.4) : 0), layer: LAYER.furniture, zone, feature: step.id, occupy: "solid" });
      }
    }
  }
  void across;
  if (step.runner && !forbidden(ctx, zone, "runner")) {
    const run = pick(ctx, zone, "runner", { placement: ["rug"], composite: false }) ?? pick(ctx, zone, "rug", { placement: ["rug"], composite: false });
    if (run) {
      const [rw, rh] = run.footprint!;
      const long = Math.max(rw, rh);
      const len = depthTotal - 1;
      const scaleW = Math.min(1.2, (step.aisle * 0.85) / Math.min(rw, rh));
      // Tiles overlap a little so the runner reads as one piece.
      const n = Math.max(1, Math.ceil(len / (long * scaleW * 0.9)));
      for (let i = 0; i < n; i++) {
        const d = 0.5 + (i + 0.5) * (len / n);
        const at = sidePoint(far, far.length / 2, d);
        const rot = norm(ang(toward) - (rh >= rw ? Math.PI / 2 : 0));
        place(ctx, { asset: run, role: "runner", at, rot, scale: scaleW, layer: LAYER.rug, zone, feature: `${step.id}_runner`, occupy: "low" });
      }
    }
  }
}

function runCenter(ctx: Ctx, room: Room, step: CenterStep): void {
  const zone = room.zone.id;
  const c: Vec = [room.inner.x + room.inner.w / 2, room.inner.y + room.inner.h / 2];
  for (const role of step.roles) {
    if (forbidden(ctx, zone, role)) continue;
    const a = pick(ctx, zone, role, { composite: undefined, maxSide: Math.min(room.inner.w, room.inner.h) - 2 });
    if (!a) continue;
    const longAxisX = room.inner.w >= room.inner.h;
    const [fw, fh] = a.footprint!;
    const rot = (fw >= fh) === longAxisX ? 0 : Math.PI / 2;
    for (let k = 0; k < 6; k++) {
      const at = add(c, [ctx.rng.range(-1, 1) * (k ? 1.2 : 0), ctx.rng.range(-1, 1) * (k ? 1.2 : 0)]);
      const isRug = a.tag?.placement === "rug";
      const pl = place(ctx, { asset: a, role, at, rot: rot + (a.tag?.facing === "none" ? 0 : ctx.rng.int(0, 1) * Math.PI) + ctx.rng.range(-0.04, 0.04), layer: isRug ? LAYER.rug : LAYER.furniture, zone, feature: step.id, occupy: isRug ? "low" : "solid", pad: 0.3 });
      if (!pl) continue;
      if (step.seats && ctx.rng.next() < step.seats.p) {
        const n = ctx.rng.int(step.seats.n[0], step.seats.n[1]);
        const size = pl.footprint;
        const g = seatsAround(ctx, zone, { at: [0, 0], size, round: false }, step.seats.roles.map((r) => [r, 1] as [string, number]), n, step.id);
        for (const p of g) {
          const sp = place(ctx, { ...p, at: add(p.at, at), parent: pl.key, key: nextKey(ctx, `${pl.key}/${p.role}`), occupy: "force" });
          if (sp) ctx.grid.mark(rectAt(sp.center!, sp.footprint), Cell.Solid);
        }
        dressSurface(ctx, pl, { items: [["plate", 5], ["mug", 4], ["food", 3], ["cutlery", 2], ["bottle", 1]], density: 1.5, candle: 0.8 });
      } else if (["workbench", "counter", "table_long", "table_medium", "desk", "table_small"].includes(role)) {
        dressSurface(ctx, pl, { items: [["food", 4], ["cookware", 3], ["plate", 1], ["book", 0.3]], density: 1.4 });
      }
      if (step.rug && ctx.rng.next() < step.rug.p) rugUnder(ctx, zone, rectAt(at, [pl.footprint[0] + 1, pl.footprint[1] + 1]), step.id, pl.key);
      return;
    }
  }
}

function runCorners(ctx: Ctx, room: Room, step: CornersStep): void {
  const zone = room.zone.id;
  const { inner } = room;
  const corners: Array<{ at: Vec; dir: Vec; side: WallSide }> = [
    { at: [inner.x, inner.y], dir: [1, 1], side: room.sides[0]! },
    { at: [inner.x + inner.w, inner.y], dir: [-1, 1], side: room.sides[0]! },
    { at: [inner.x, inner.y + inner.h], dir: [1, -1], side: room.sides[1]! },
    { at: [inner.x + inner.w, inner.y + inner.h], dir: [-1, -1], side: room.sides[1]! },
  ];
  for (const c of corners) {
    if (ctx.rng.next() > step.chance) continue;
    const got = pickWeighted(ctx, zone, step.roles, { composite: undefined, maxSide: 1.8 });
    if (!got) continue;
    const s = aabb(got.asset, 0, 1);
    const at: Vec = [c.at[0] + c.dir[0] * (s[0] / 2 + 0.03), c.at[1] + c.dir[1] * (s[1] / 2 + 0.03)];
    const rot = got.asset.tag?.facing === "none" ? ctx.rng.range(0, Math.PI * 2) : rotationFor(got.asset, c.side.inward) + ctx.rng.range(-0.2, 0.2);
    const pl = place(ctx, { asset: got.asset, role: got.role, at, rot, layer: LAYER.furniture, zone, feature: step.id, occupy: "solid" });
    if (pl && CLUSTER_ROLES.has(got.role) && ctx.rng.next() < 0.6) {
      const b = pick(ctx, zone, got.role, { composite: false, maxSide: 1.4 });
      if (b) {
        const s2 = aabb(b, 0, 1);
        const at2: Vec = ctx.rng.next() < 0.5 ? [at[0] + c.dir[0] * (s[0] / 2 + s2[0] / 2 + 0.02), c.at[1] + c.dir[1] * (s2[1] / 2 + 0.03)] : [c.at[0] + c.dir[0] * (s2[0] / 2 + 0.03), at[1] + c.dir[1] * (s[1] / 2 + s2[1] / 2 + 0.02)];
        place(ctx, { asset: b, role: got.role, at: at2, rot: ctx.rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone, feature: step.id, occupy: "solid", parent: pl.key, key: nextKey(ctx, `${pl.key}/${got.role}`) });
      }
    }
  }
}

function runDecals(ctx: Ctx, room: Room, step: DecalsStep | ScatterStep, mult: number): void {
  const zone = room.zone.id;
  const mods = modifiers(ctx, zone, step);
  let n = countFor(ctx, room, { perArea: step.perArea * mult }, mods);
  if (step.where === "corners") n = Math.min(n, 4 - ctx.placed.filter((p) => p.zone === zone && p.type === "cobweb").length);
  const { inner } = room;
  const isDecal = step.kind === "decals";
  for (let i = 0; i < n; i++) {
    const got = pickWeighted(ctx, zone, step.roles, isDecal ? { placement: ["decal", "rug", "surface", "free"], maxSide: 3, avoid: INDOOR_DECAL_AVOID } : { maxSide: 1.6, composite: undefined, avoid: INDOOR_DECAL_AVOID });
    if (!got) continue;
    const { asset, role } = got;
    const size = aabb(asset, 0, 1);
    let at: Vec | undefined, rot = ctx.rng.range(0, Math.PI * 2);
    for (let t = 0; t < 6 && !at; t++) {
      if (step.where === "corners") {
        const cx = ctx.rng.next() < 0.5 ? 0 : 1, cy = ctx.rng.next() < 0.5 ? 0 : 1;
        // Corner art (cobwebs, corner shadows) is drawn in its top-left; turn it into the corner.
        const corner: Vec = [inner.x + cx * inner.w, inner.y + cy * inner.h];
        const dir: Vec = [cx ? -1 : 1, cy ? -1 : 1];
        rot = cx === 0 && cy === 0 ? 0 : cx === 1 && cy === 0 ? Math.PI / 2 : cx === 1 && cy === 1 ? Math.PI : -Math.PI / 2;
        const s2 = aabb(asset, rot, 1);
        at = [corner[0] + dir[0] * (s2[0] / 2 - 0.05), corner[1] + dir[1] * (s2[1] / 2 - 0.05)];
      } else if (step.where === "edges") {
        const s = ctx.rng.pick(room.sides);
        const t = ctx.rng.range(0, s.length);
        at = sidePoint(s, t, ctx.rng.range(0.1, 1.1) + Math.min(size[0], size[1]) * 0.3);
      } else if (step.where === "doors" && room.doors.length) {
        const d = ctx.rng.pick(room.doors);
        at = add(add(d.at, d.inward, ctx.rng.range(0.4, 1.6)), d.dir, ctx.rng.range(-0.8, 0.8));
      } else {
        at = [inner.x + 0.4 + ctx.rng.next() * (inner.w - 0.8), inner.y + 0.4 + ctx.rng.next() * (inner.h - 0.8)];
      }
      if (at && (at[0] < inner.x || at[1] < inner.y || at[0] > inner.x + inner.w || at[1] > inner.y + inner.h)) at = undefined;
    }
    if (!at) continue;
    const sc = role === "cobweb" ? ctx.rng.range(0.45, 0.7) : ctx.rng.range(0.85, 1.15);
    place(ctx, { asset, role, at, rot, scale: sc, layer: isDecal ? LAYER.decal : LAYER.floorClutter, zone, feature: step.id, occupy: isDecal ? "low" : "clutter", light: false });
  }
}

function runSconces(ctx: Ctx, room: Room, step: SconcesStep): void {
  const zone = room.zone.id;
  const role = step.roles.find((r) => !forbidden(ctx, zone, r) && (pick(ctx, zone, r, { placement: ["wallmount"] }) || pick(ctx, zone, r, { lit: true, maxSide: 1 })));
  if (!role) return;
  const a = pick(ctx, zone, role, { placement: ["wallmount"] }) ?? pick(ctx, zone, role, { lit: true, maxSide: 1 })!;
  const wallMounted = a.tag?.placement === "wallmount";
  for (const s of room.sides) {
    const n = Math.floor(s.length / step.every);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * (s.length / n) + ctx.rng.range(-0.3, 0.3);
      if (s.doors.some((d) => Math.abs(d - t) < 1.1) || s.windows.some((w) => Math.abs(w - t) < 0.8)) continue;
      const { depth } = frontSize(a);
      const at = sidePoint(s, t, wallMounted ? depth / 2 - INSET * 0.8 : depth / 2 + 0.05);
      place(ctx, { asset: a, role, at, rot: rotationFor(a, s.inward), layer: wallMounted ? LAYER.overhead : LAYER.surface, zone, feature: step.id, occupy: wallMounted ? "force" : "clutter", light: LIGHTS[role] ?? LIGHTS.sconce });
    }
  }
}

function runOverhead(ctx: Ctx, room: Room, step: OverheadStep): void {
  const zone = room.zone.id;
  for (const role of step.roles) {
    const a = pick(ctx, zone, role, { maxSide: 2.4 });
    if (!a) continue;
    const n = room.area > 140 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const horiz = room.inner.w >= room.inner.h;
      const t = n === 1 ? 0.5 : (i + 0.5) / n;
      const at: Vec = horiz ? [room.inner.x + room.inner.w * t, room.inner.y + room.inner.h / 2] : [room.inner.x + room.inner.w / 2, room.inner.y + room.inner.h * t];
      let spot: Vec | undefined;
      for (let k = 0; k < 12 && !spot; k++) {
        const p: Vec = k === 0 ? at : add(at, [ctx.rng.range(-2, 2), ctx.rng.range(-2, 2)]);
        if (ctx.grid.fits(rectAt(p, aabb(a, 0, 1), -0.1), (c) => c !== Cell.Solid && c !== Cell.Wall)) spot = p;
      }
      if (spot) place(ctx, { asset: a, role, at: spot, rot: 0, layer: LAYER.overhead, zone, feature: step.id, occupy: "force", light: LIGHTS.chandelier });
    }
    return;
  }
}

/** Pillars in a ring a little in from the walls, evenly spaced, skipping door fronts. */
function runColonnade(ctx: Ctx, room: Room, step: ColonnadeStep): void {
  const zone = room.zone.id;
  const a = pick(ctx, zone, "pillar", { composite: false, maxSide: 1.6 });
  // Pegs and lamps aren't pillars: skip unless the piece is a real column.
  if (!a || Math.min(...a.footprint!) < 0.7) return;
  const { inner } = room;
  const horiz = inner.w >= inner.h;
  const len = horiz ? inner.w : inner.h;
  const n = Math.max(2, Math.round((len - 2) / step.every) + 1);
  const size = aabb(a, 0, 1);
  for (let i = 0; i < n; i++) {
    const u = 1 + ((len - 2) * i) / (n - 1);
    const pair = [step.inset, (horiz ? inner.h : inner.w) - step.inset].map((v) => (horiz ? [inner.x + u, inner.y + v] : [inner.x + v, inner.y + u]) as Vec);
    if (!pair.every((p) => ctx.grid.fits(rectAt(p, size, -0.04), SOLID_OK))) continue;
    for (const p of pair) place(ctx, { asset: a, role: "pillar", at: p, rot: 0, layer: LAYER.furniture, zone, feature: step.id, occupy: "solid" });
  }
}

/** Root pieces a lock kept from an earlier generation for this step. */
function lockedRoots(ctx: Ctx, zone: string, step: Step): number {
  return ctx.placed.filter((p) => p.locked && !p.parent && p.zone === zone && p.feature === step.id).length;
}

function runStep(ctx: Ctx, room: Room, step: Step): void {
  if (step.wear && !step.wear.includes(ctx.wear)) return;
  // A locked single piece (the bar, the altar, the hearth) stays the only one.
  const kept = lockedRoots(ctx, room.zone.id, step);
  if (kept && ["anchor", "bar", "center", "overhead", "rows"].includes(step.kind)) return;
  if (step.minArea && room.area < step.minArea) return;
  if (step.p !== undefined && ctx.rng.next() > step.p) return;
  const mods = modifiers(ctx, room.zone.id, step);
  if (mods.some((m) => m.count === 0 || (typeof m.count === "object" && m.count.max === 0))) return;
  const wearMult = { clean: 0.4, "lived-in": 1, grimy: 1.7, ruined: 2.2 }[ctx.wear];
  switch (step.kind) {
    case "anchor": {
      const n = step.count ? ctx.rng.int(step.count[0], step.count[1]) : 1;
      for (let i = 0; i < n; i++) runAnchor(ctx, room, step);
      break;
    }
    case "bar": runBar(ctx, room, step); break;
    case "groups": runGroups(ctx, room, step); break;
    case "line": runLine(ctx, room, step); break;
    case "corners": runCorners(ctx, room, step); break;
    case "rows": runRows(ctx, room, step); break;
    case "center": runCenter(ctx, room, step); break;
    case "decals": runDecals(ctx, room, step, wearMult); break;
    case "scatter": runDecals(ctx, room, step, wearMult); break;
    case "sconces": runSconces(ctx, room, step); break;
    case "overhead": runOverhead(ctx, room, step); break;
    case "colonnade": runColonnade(ctx, room, step); break;
    case "runner": runRunner(ctx, room, step, mods); break;
    case "gallery": runGallery(ctx, room, step); break;
  }
}

// ---------------------------------------------------------------------------------------
// Directives

function anchorPoint(room: Room, a: Anchor | undefined, ctx: Ctx): { at: Vec; front?: Vec; side?: WallSide } {
  const { inner } = room;
  const c: Vec = [inner.x + inner.w / 2, inner.y + inner.h / 2];
  let at = c;
  let side: WallSide | undefined;
  if (a?.along) {
    side = room.sides.find((s) => s.side === a.along);
    if (side) at = sidePoint(side, side.length / 2, 1);
  } else if (a?.corner) {
    const x = a.corner.includes("w") ? inner.x + 1 : inner.x + inner.w - 1;
    const y = a.corner.includes("n") ? inner.y + 1 : inner.y + inner.h - 1;
    at = [x, y];
  } else if (a?.near) {
    const target = ctx.placed.find((p) => p.directive === a.near || p.key.startsWith(`${room.zone.id}/${a.near}`));
    if (target) at = add(target.center ?? [target.x, target.y], [1.5, 0]);
  }
  if (a?.offset) at = add(at, a.offset);
  return { at, side, front: side?.inward };
}

function placeDirective(ctx: Ctx, room: Room, d: PinDirective | FreeDirective): void {
  const zone = room.zone.id;
  const what = "pin" in d ? d.pin : d.free;
  const asset = ctx.cat.asset(what);
  const roles = asset ? [asset.tag?.role ?? asset.types[0] ?? "other"] : rolesFor(what);
  let { at, front, side } = anchorPoint(room, d.at, ctx);
  let aisle: Vec | undefined;
  const rows = RECIPE_BY_TYPE.get(room.zone.type)?.steps.find((s): s is RowsStep => s.kind === "rows");
  if (rows && (!d.at || d.at.anchor === "center") && !d.at?.near) {
    const far = wallSidesOrdered(ctx, room, "far")[0]!;
    at = sidePoint(far, far.length / 2, rows.front + 1.6);
    front = [-far.inward[0], -far.inward[1]];
    side = undefined;
    aisle = far.inward;
  }
  const slots = "slots" in d ? d.slots : undefined;
  // The directive id is the key: locks and the round trip find the piece by it.
  const key = d.id;
  const tableLike = roles.some((r) => r.startsWith("table") || r === "desk");
  let root: Placed | undefined;
  // A body (or anything big) laid on the table needs a long table.
  const bigWith = (d.with ?? []).some((w) => rolesFor(w).some((r) => ["corpse", "coffin", "bones"].includes(r)));
  if (tableLike && !asset) {
    const seatCount = slots ? slots.chair ?? slots.seat ?? slots.stool : undefined;
    const kind: GroupKind = bigWith || (roles.includes("table_long") && what !== "table") ? "long" : "square";
    for (let t = 0; t < 12 && !root; t++) {
      const g = planGroup(ctx, zone, kind, { seats: [["chair", 1]] }, d.id, seatCount);
      if (!g) break;
      const p = t === 0 ? at : add(at, [ctx.rng.range(-2, 2), ctx.rng.range(-2, 2)]);
      const res = placeGroup(ctx, g, p, 0.3, key, d.id);
      if (res) root = res[0];
    }
    if (root) dressSurface(ctx, root, { items: [["mug", 3], ["plate", 2], ["food", 1]], density: 1.2, candle: 0.5 }, 1, slots ?? {});
  } else {
    const a = asset ?? roles.map((r) => pick(ctx, zone, r, { composite: false })).find(Boolean);
    if (!a) {
      ctx.notes.push(`${d.id}: no piece found for "${what}"`);
      return;
    }
    // On an aisle a long piece lies along the aisle.
    const longY = (a.footprint?.[1] ?? 1) >= (a.footprint?.[0] ?? 1);
    const rot = d.at?.rotation !== undefined ? (d.at.rotation * Math.PI) / 180 : aisle ? norm(ang(aisle) - ang(longY ? [0, 1] : [1, 0])) : front ? rotationFor(a, front) : 0;
    for (let t = 0; t < 14 && !root; t++) {
      // On an aisle, step down the aisle; elsewhere, try nearby spots.
      const p = t === 0 ? at : aisle ? add(at, aisle, t * 0.5) : add(at, [ctx.rng.range(-2.5, 2.5), ctx.rng.range(-2.5, 2.5)]);
      const isLow = ["rug", "decal"].includes(a.tag?.placement ?? "");
      root = place(ctx, { asset: a, role: a.tag?.role ?? roles[0]!, at: side && t === 0 ? sidePoint(side, side.length / 2, frontSize(a).depth / 2 + 0.02) : p, rot, layer: isLow ? LAYER.rug : LAYER.furniture, zone, feature: d.id, key, directive: d.id, occupy: isLow ? "low" : "solid" });
    }
  }
  if (!root) {
    ctx.notes.push(`${d.id}: no room for ${what} in ${zone}`);
    return;
  }
  for (const w of d.with ?? []) {
    for (const r of rolesFor(w)) {
      const extra = pick(ctx, zone, r, { composite: false });
      if (!extra) continue;
      // Things that fit go on top of the piece, along its long axis and scaled to sit on it; bigger ones beside it.
      const [ew, eh] = extra.footprint!;
      const [rw, rh] = root.footprint;
      const fitsOn = Math.max(ew, eh) <= Math.max(rw, rh) * 1.15;
      const c = root.center ?? [root.x, root.y];
      if (fitsOn) {
        const rootLongX = rw >= rh;
        const rot = (ew >= eh) === rootLongX ? 0 : Math.PI / 2;
        const sz = aabb(extra, rot, 1);
        const scale = Math.min(1, (rw * 0.95) / sz[0], (rh * 0.95) / sz[1]);
        place(ctx, { asset: extra, role: r, at: c, rot: rot + ctx.rng.range(-0.08, 0.08), scale, layer: LAYER.surface, zone, feature: d.id, parent: root.key, key: `${key}/${r}`, directive: d.id, occupy: "force" });
      } else {
        const p = add(c, [rw / 2 + Math.max(ew, eh) / 2 + 0.1, 0]);
        place(ctx, { asset: extra, role: r, at: p, rot: ctx.rng.range(-0.5, 0.5), layer: LAYER.furniture, zone, feature: d.id, parent: root.key, key: `${key}/${r}`, directive: d.id, occupy: "force" });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Entry point

export interface DressInput {
  plan: ScenePlan;
  layout: Layout;
  cat: Catalog;
  style: Style;
  styles: Style[];
  locked: Placed[];
  /** The building's real shape (squares) when it is not its zones' boxes: furniture stays inside it. */
  mask?: Array<[number, number]>;
  /** Squares kept clear inside the mask's edges (half the wall's thickness). */
  maskPad?: number;
}

function edgeDist(p: Vec, poly: Array<[number, number]>): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return d;
}

function inPolygon(p: Vec, poly: Array<[number, number]>): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

export function makeCtx(input: DressInput, grid: Grid, label: string): Ctx {
  const { plan, layout, cat, style, styles } = input;
  return {
    plan, layout, cat, style, styles, grid, placed: [], paths: [], notes: [],
    wear: (plan.mood?.wear ?? "lived-in") as Wear,
    directives: plan.directives ?? [],
    rng: new Rng(`${plan.seed}:${style.id}:${label}`),
    keys: new Map(),
  };
}

export function dress(input: DressInput): DressResult & { grid: Grid } {
  const { plan, layout, cat, style, styles, locked } = input;
  const grid = new Grid(layout.map.w, layout.map.h);
  const ctx: Ctx = {
    plan, layout, cat, style, styles, grid, placed: [], paths: [], notes: [],
    wear: (plan.mood?.wear ?? "lived-in") as Wear,
    directives: plan.directives ?? [],
    rng: new Rng(`${plan.seed}:${style.id}:dress`),
    keys: new Map(),
  };
  // Outside the building is off limits to indoor steps; every room marks its own walls.
  const indoor = layout.zones.filter((z) => !z.outdoor);
  grid.mark({ x: 0, y: 0, w: layout.map.w, h: layout.map.h }, Cell.Wall);
  for (const z of indoor) grid.mark(z.rect, Cell.Free);
  // An L- or T-shaped building: the parts of its boxes outside the real walls are off limits.
  if (input.mask && input.mask.length >= 3) {
    const step = 1 / RES;
    const pad = input.maskPad ?? 0;
    for (let y = 0; y < grid.H; y++) for (let x = 0; x < grid.W; x++) {
      const p: Vec = [(x + 0.5) * step, (y + 0.5) * step];
      if (!inPolygon(p, input.mask) || (pad > 0 && edgeDist(p, input.mask) < pad)) grid.cells[y * grid.W + x] = Cell.Wall;
    }
  }

  // Locked pieces stay exactly where they were.
  for (const p of locked) {
    ctx.placed.push({ ...p, locked: true });
    grid.mark(rectAt(p.center ?? [p.x, p.y], p.footprint), Cell.Solid);
  }
  for (const l of plan.locks ?? []) if (l.region) grid.mark(l.region, Cell.Solid);

  const reach = { outer: wallReach(style.wall, true), inner: wallReach(style.innerWall ?? style.wall, false) };
  const rooms = indoor.map((z) => roomOf(layout, z, reach));
  // Wall bands are off limits: everything between each room's walls and its inner rect.
  for (const room of rooms) {
    const r = room.zone.rect, i = room.inner;
    grid.markInside({ x: r.x, y: r.y, w: r.w, h: i.y - r.y }, Cell.Wall);
    grid.markInside({ x: r.x, y: i.y + i.h, w: r.w, h: r.y + r.h - (i.y + i.h) }, Cell.Wall);
    grid.markInside({ x: r.x, y: r.y, w: i.x - r.x, h: r.h }, Cell.Wall);
    grid.markInside({ x: i.x + i.w, y: r.y, w: r.x + r.w - (i.x + i.w), h: r.h }, Cell.Wall);
  }
  for (const room of rooms) reserveCirculation(ctx, room);
  // Every room draws from its own random stream, so a change in one room (a pin removed,
  // a step forbidden) leaves the other rooms exactly as they were.
  const rngs = new Map(rooms.map((r) => [r.zone.id, new Rng(`${plan.seed}:${style.id}:dress:${r.zone.id}`)]));
  const use = (room: Room) => (ctx.rng = rngs.get(room.zone.id)!);
  // Gates and wrecked gates shape the space around their openings: before any furniture.
  ctx.rng = new Rng(`${plan.seed}:${style.id}:gates`);
  const gates = dressGates(ctx, rooms);
  dressWrecks(ctx, rooms);
  // The pieces that define a room (bed, bar, oven, altar) go first, then the DM's pins, then the rest.
  const ran = new Set<Step>();
  for (const room of rooms) {
    use(room);
    for (const step of RECIPE_BY_TYPE.get(room.zone.type)?.steps ?? []) if (step.essential) { runStep(ctx, room, step); ran.add(step); }
  }
  for (const room of rooms) {
    use(room);
    for (const d of ctx.directives) {
      if (("pin" in d || "free" in d) && (d.zone ?? indoor[0]?.id) === room.zone.id) placeDirective(ctx, room, d);
    }
  }
  for (const room of rooms) {
    use(room);
    const recipe = RECIPE_BY_TYPE.get(room.zone.type);
    if (!recipe) {
      ctx.notes.push(`${room.zone.id}: no recipe for ${room.zone.type}`);
      continue;
    }
    for (const step of recipe.steps) if (!ran.has(step)) runStep(ctx, room, step);
  }
  void specOf;
  return { placed: ctx.placed, paths: ctx.paths, notes: ctx.notes, grid, gates };
}

export { Grid, Cell, INSET, roomOf, rectAt, aabb, frontSize, artOffset, modifiers, place, pick, pickWeighted, nextKey, forbidden, LIGHTS, type Ctx, type Room, type Put, type Vec };
