/**
 * Outside the walls: the road to the main door, props by the doors, bushes hugging the
 * walls, clustered vegetation framing the map, and outdoor zones such as graveyards
 * (fenced rows of graves with a path through them).
 */

import type { AssetRecord } from "../assets/model";
import { Cell, Grid, LAYER, aabb, makeCtx, nextKey, pick, pickWeighted, place, rectAt, type Ctx, type DressInput, type PathPlan, type Placed, type Vec } from "./dress";
import type { LayoutZone, Rect } from "./layout";
import type { Side } from "./plan";

const OUT: Record<Side, Vec> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];

export interface ExteriorResult {
  placed: Placed[];
  paths: PathPlan[];
  notes: string[];
  /** Road center lines (squares), for terrain painting. */
  roads: Vec[][];
}

function markBuilding(ctx: Ctx): void {
  const g = ctx.grid;
  g.mark({ x: 0, y: 0, w: ctx.layout.map.w, h: ctx.layout.map.h }, Cell.Free);
  for (const z of ctx.layout.zones) if (!z.outdoor) g.mark({ x: z.rect.x - 0.3, y: z.rect.y - 0.3, w: z.rect.w + 0.6, h: z.rect.h + 0.6 }, Cell.Wall);
  // Leave the map edge itself a little clear so nothing is cut in half by the border.
}

/** A gently curving road from a door straight out to the map edge. */
function road(ctx: Ctx, from: Vec, dir: Vec): Vec[] {
  const { w, h } = ctx.layout.map;
  const pts: Vec[] = [add(from, dir, 0.3)];
  const lateral: Vec = [Math.abs(dir[1]), Math.abs(dir[0])];
  const dist = dir[0] > 0 ? w - from[0] : dir[0] < 0 ? from[0] : dir[1] > 0 ? h - from[1] : from[1];
  const steps = Math.max(1, Math.round(dist / 3.5));
  let off = 0;
  for (let i = 1; i <= steps; i++) {
    const d = (dist * i) / steps + (i === steps ? 0.5 : 0);
    off += i === 1 ? ctx.rng.range(-0.3, 0.3) : ctx.rng.range(-1.1, 1.1);
    off = Math.max(-3, Math.min(3, off));
    pts.push(add(add(from, dir, d), lateral, i === 1 ? off * 0.3 : off));
  }
  return pts;
}

function markPath(g: Grid, pts: Vec[], width: number, v: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3);
    for (let k = 0; k <= n; k++) {
      const p: Vec = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      g.mark(rectAt(p, [width, width]), v);
    }
  }
}

/** Where segment p1-p2 crosses segment q1-q2, if it does. */
function segHit(p1: Vec, p2: Vec, q1: Vec, q2: Vec): Vec | undefined {
  const d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0]);
  if (Math.abs(d) < 1e-9) return undefined;
  const t = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d;
  const u = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : undefined;
}

/** How many times each exterior piece has been used; repeats beyond a few look stamped. */
const repeats = new WeakMap<Ctx, Map<string, number>>();

export function scatterCluster(ctx: Ctx, center: Vec, menu: Array<[string, number]>, n: number, radius: number, zone: string, feature: string, bounds: Rect, maxSide = 6): number {
  let made = 0;
  for (let i = 0; i < n * 3 && made < n; i++) {
    const got = pickWeighted(ctx, zone, menu, { placement: ["outdoor", "free", "decal"], maxSide });
    if (!got) return made;
    const seen = repeats.get(ctx) ?? repeats.set(ctx, new Map()).get(ctx)!;
    const vg = got.asset.variantGroup || got.asset.id;
    if (/\b(pit|hole|protected)\b/i.test(got.asset.name)) continue;
    if ((seen.get(vg) ?? 0) >= (["grass", "flowers", "leaves", "rock"].includes(got.role) ? 8 : 3)) continue;
    seen.set(vg, (seen.get(vg) ?? 0) + 1);
    const r = radius * Math.sqrt(ctx.rng.next());
    const a = ctx.rng.next() * Math.PI * 2;
    const at: Vec = [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
    if (at[0] < bounds.x || at[1] < bounds.y || at[0] > bounds.x + bounds.w || at[1] > bounds.y + bounds.h) continue;
    const big = ["tree", "dead_tree", "tree_canopy", "boulder"].includes(got.role);
    const low = ["grass", "flowers", "leaves", "moss", "mushroom", "dirt", "puddle"].includes(got.role);
    const scale = ctx.rng.range(0.85, 1.15);
    // Trees may overhang paths and props but never the building.
    if (/indoor|interior/i.test(got.asset.name)) continue;
    if (big) {
      const s = aabb(got.asset, 0, scale);
      if (!ctx.grid.fits(rectAt(at, s), (c) => c !== Cell.Wall && c !== Cell.Door) || !ctx.grid.fits(rectAt(at, [0.9, 0.9]), (c) => c === Cell.Free)) continue;
    }
    const pl = place(ctx, {
      asset: got.asset, role: got.role, at, rot: ctx.rng.range(0, Math.PI * 2), scale,
      layer: big ? LAYER.overhead : low ? LAYER.decal : LAYER.furniture, zone, feature, occupy: big ? "force" : low ? "low" : "solid", light: false,
    });
    if (pl) {
      made++;
      if (big) ctx.grid.mark(rectAt(at, [0.8, 0.8]), Cell.Solid);
    }
  }
  return made;
}

const GREEN: Record<"medieval" | "gothic", Array<[string, number]>> = {
  medieval: [["tree", 4], ["bush", 5], ["rock", 2], ["boulder", 0.5], ["grass", 5], ["flowers", 3], ["log", 1], ["stump", 1], ["mushroom", 0.5]],
  gothic: [["dead_tree", 4], ["tree", 1], ["bush", 3], ["rock", 3], ["grass", 2], ["log", 1], ["stump", 1.5], ["bones", 0.5], ["leaves", 1.5]],
};

/** Hedges, bushes or lamp posts along both sides of the approach road. */
function lineRoad(ctx: Ctx, pts: Vec[], zone: string): void {
  const gothic = ctx.plan.genre === "gothic";
  const menu: Array<[string, number]> = gothic ? [["hedge", 3], ["bush", 3], ["dead_tree", 1], ["lamp_post", 1]] : [["hedge", 2], ["bush", 4], ["flowers", 2], ["lamp_post", 0.5]];
  const kind = pickWeighted(ctx, zone, menu, { placement: ["outdoor", "free", "decal"], maxSide: 2.5 });
  if (!kind) return;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const u: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Vec = [-u[1], u[0]];
    for (let t = i === 0 ? 2 : 0.6; t < len; t += ctx.rng.range(1.6, 2.4)) {
      for (const sgn of [-1, 1]) {
        if (ctx.rng.next() < 0.25) continue;
        const a2 = pick(ctx, zone, kind.role, { placement: ["outdoor", "free", "decal"], maxSide: 2.5 }) ?? kind.asset;
        const half = Math.max(...aabb(a2, 0, 1)) / 2;
        const at = add(add(a, u, t), n, sgn * (1.15 + half + ctx.rng.range(0, 0.3)));
        place(ctx, { asset: a2, role: kind.role, at, rot: ctx.rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone, feature: "approach", occupy: "solid", light: kind.role === "lamp_post" ? undefined : false });
      }
    }
  }
}

function vegetation(ctx: Ctx, bounds: Rect, density: number, zone: string): void {
  const menu = GREEN[ctx.plan.genre];
  const { w, h } = ctx.layout.map;
  const area = bounds.w * bounds.h;
  const clusters = Math.round((area / 26) * density);
  for (let i = 0; i < clusters; i++) {
    // Favor the map edges: they frame the scene and keep the middle playable.
    let c: Vec = [bounds.x + ctx.rng.next() * bounds.w, bounds.y + ctx.rng.next() * bounds.h];
    const edge = Math.min(c[0], c[1], w - c[0], h - c[1]);
    if (edge > 5 && ctx.rng.next() < 0.55) c = [ctx.rng.next() < 0.5 ? bounds.x + ctx.rng.range(0, 3) : bounds.x + bounds.w - ctx.rng.range(0, 3), c[1]];
    scatterCluster(ctx, c, menu, ctx.rng.int(2, 6), ctx.rng.range(1.2, 2.6), zone, "greenery", bounds);
  }
}

/** Trees and undergrowth round the edge of a clearing (not along the building's wall), the middle left open. */
function clearing(ctx: Ctx, r: Rect, zone: string): void {
  const L = ctx.layout;
  const b = L.building;
  const gothic = ctx.plan.genre === "gothic";
  const trees: Array<[string, number]> = gothic ? [["dead_tree", 5], ["tree", 2]] : [["tree", 5], ["dead_tree", 0.5]];
  const under: Array<[string, number]> = gothic ? [["bush", 3], ["rock", 2], ["stump", 1.5], ["log", 1], ["leaves", 2], ["grass", 2]] : [["bush", 4], ["rock", 1.5], ["stump", 1], ["log", 1], ["grass", 3], ["flowers", 2]];
  // The edges away from the building, walked in steps of two or three squares.
  const edges: Array<[Vec, Vec]> = [];
  const x0 = r.x + 0.8, x1 = r.x + r.w - 0.8, y0 = r.y + 0.8, y1 = r.y + r.h - 0.8;
  const touches = (side: Side) => side === "north" ? Math.abs(r.y - (b.y + b.h)) < 0.5 : side === "south" ? Math.abs(r.y + r.h - b.y) < 0.5 : side === "west" ? Math.abs(r.x - (b.x + b.w)) < 0.5 : Math.abs(r.x + r.w - b.x) < 0.5;
  if (!touches("north")) edges.push([[x0, y0], [x1, y0]]);
  if (!touches("south")) edges.push([[x0, y1], [x1, y1]]);
  if (!touches("west")) edges.push([[x0, y0], [x0, y1]]);
  if (!touches("east")) edges.push([[x1, y0], [x1, y1]]);
  for (const [a, c] of edges) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const u: Vec = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    for (let t = ctx.rng.range(0, 1.5); t <= len; t += ctx.rng.range(2, 3.2)) {
      const at = add(a, u, t);
      // The road out keeps its way through.
      // Trees stand right at the edge, their crowns may hang off the map; the road keeps its way through.
      const tree = ctx.grid.fits(rectAt(at, [1.6, 1.6]), (cell) => cell === Cell.Free) ? pickWeighted(ctx, zone, trees, { placement: ["outdoor", "free", "decal"], maxSide: 7, avoid: /indoor|interior|potted|planter|vase/i }) : undefined;
      if (tree && place(ctx, { asset: tree.asset, role: tree.role, at, rot: ctx.rng.range(0, Math.PI * 2), scale: ctx.rng.range(0.85, 1.15), layer: LAYER.overhead, zone, feature: "clearing", occupy: "force", light: false })) ctx.grid.mark(rectAt(at, [0.8, 0.8]), Cell.Solid);
      scatterCluster(ctx, at, under, ctx.rng.int(1, 2), 1.6, zone, "clearing", r, 2.5);
    }
  }
}

function hugWalls(ctx: Ctx, zone: string): void {
  const L = ctx.layout;
  const menu: Array<[string, number]> = ctx.plan.genre === "gothic" ? [["bush", 2], ["grass", 1], ["rock", 2], ["bones", 0.5]] : [["bush", 4], ["grass", 3], ["flowers", 2], ["crate", 1], ["barrel", 1]];
  const pts = L.outline;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const outN: Vec = [dir[1], -dir[0]]; // clockwise outline: outside is to the left of travel
    for (let t = 0.5; t < len - 0.5; t += ctx.rng.range(1.2, 3.2)) {
      if (ctx.rng.next() < 0.45) continue;
      const got = pickWeighted(ctx, zone, menu, { placement: ["outdoor", "free", "wall"], maxSide: 1.8 });
      if (!got) continue;
      const s = aabb(got.asset, 0, 1);
      const at = add(add(a, dir, t), outN, 0.35 + Math.min(s[0], s[1]) / 2);
      place(ctx, { asset: got.asset, role: got.role, at, rot: ctx.rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone, feature: "walls", occupy: "solid", light: false });
    }
  }
}

function doorProps(ctx: Ctx, zone: string): void {
  for (const d of ctx.layout.doors.filter((x) => x.between[1] === "outside")) {
    const side = sideOfDoor(ctx, d.at);
    if (!side) continue;
    const out = OUT[side];
    const along: Vec = [Math.abs(out[1]), Math.abs(out[0])];
    const menu: Array<[string, number]> = d.main
      ? [["barrel", 3], ["crate", 2], ["lantern", 1], ["sign", 1], ["bench", 1], ["plant", 1]]
      : [["woodpile", 3], ["barrel", 3], ["crate", 2], ["sack", 2], ["cart", 1], ["haystack", 1]];
    for (const sgn of [-1, 1]) {
      if (ctx.rng.next() < 0.35) continue;
      const got = pickWeighted(ctx, zone, menu, { maxSide: 2.5 });
      if (!got) continue;
      const s = aabb(got.asset, 0, 1);
      const at = add(add(d.at, along, sgn * (1.3 + s[0] / 2)), out, 0.35 + s[1] / 2);
      place(ctx, { asset: got.asset, role: got.role, at, rot: got.asset.tag?.facing === "none" ? ctx.rng.range(0, 6.28) : Math.atan2(out[1], out[0]) - Math.PI / 2 + ctx.rng.range(-0.3, 0.3), layer: LAYER.furniture, zone, feature: d.main ? "front_door" : "back_door", occupy: "solid" });
    }
  }
}

function sideOfDoor(ctx: Ctx, at: Vec): Side | undefined {
  for (const z of ctx.layout.zones) {
    if (z.outdoor) continue;
    const r = z.rect;
    if (Math.abs(at[1] - r.y) < 1e-6 && at[0] > r.x && at[0] < r.x + r.w && (ctx.layout.exterior[z.id] ?? []).includes("north")) return "north";
    if (Math.abs(at[1] - (r.y + r.h)) < 1e-6 && at[0] > r.x && at[0] < r.x + r.w && (ctx.layout.exterior[z.id] ?? []).includes("south")) return "south";
    if (Math.abs(at[0] - r.x) < 1e-6 && at[1] > r.y && at[1] < r.y + r.h && (ctx.layout.exterior[z.id] ?? []).includes("west")) return "west";
    if (Math.abs(at[0] - (r.x + r.w)) < 1e-6 && at[1] > r.y && at[1] < r.y + r.h && (ctx.layout.exterior[z.id] ?? []).includes("east")) return "east";
  }
  return undefined;
}

function graveyard(ctx: Ctx, z: LayoutZone, roads: Vec[][]): void {
  const zone = z.id;
  const r: Rect = { x: z.rect.x + 0.8, y: z.rect.y + 0.8, w: z.rect.w - 1.6, h: z.rect.h - 1.6 };
  // A graveyard on its own gets a path in from the map edge to a focal point (mausoleum, great
  // tree or statue), lit along the way; the fence opens where the path enters.
  const inside = (p: Vec) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;
  let focal: Vec | undefined;
  if (!roads.some((rd) => rd.some(inside))) {
    const M = ctx.layout.map;
    const cx = r.x + r.w * ctx.rng.range(0.4, 0.6);
    focal = [cx + ctx.rng.range(-0.5, 0.5), r.y + r.h * 0.28];
    const path: Vec[] = [[cx, M.h + 0.3], [cx + ctx.rng.range(-0.6, 0.6), r.y + r.h * 0.65], [focal[0], focal[1] + 1.6]];
    roads.push(path);
    ctx.paths.push({ key: nextKey(ctx, `${zone}/path`), zone, points: path, use: "road", width: 1.4 });
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const p: Vec = [path[0]![0] + (path[2]![0] - path[0]![0]) * t, path[0]![1] + (path[2]![1] - path[0]![1]) * t];
      const lamp = pick(ctx, zone, "lamp_post", { lit: true }) ?? pick(ctx, zone, "brazier", { lit: true }) ?? pick(ctx, zone, "lantern", { lit: true }) ?? pick(ctx, zone, "lamp_post");
      if (lamp) place(ctx, { asset: lamp, role: lamp.tag?.role ?? "lamp_post", at: add(p, [k % 2 ? 1.3 : -1.3, 0]), rot: 0, layer: LAYER.furniture, zone, feature: "lights", occupy: "force" });
    }
  }
  if (focal) {
    const bigEnough = (a?: import("../assets/model").AssetRecord) => (a && Math.min(...a.footprint!) >= 2.4 ? a : undefined);
    const f = bigEnough(pick(ctx, zone, "mausoleum", { maxSide: 6 })) ?? bigEnough(pick(ctx, zone, "tomb", { maxSide: 5 })) ?? pick(ctx, zone, "dead_tree", { maxSide: 6 }) ?? pick(ctx, zone, "statue", { maxSide: 3 });
    if (f) {
      const pl = place(ctx, { asset: f, role: f.tag?.role ?? "tomb", at: focal, rot: 0, layer: LAYER.furniture, zone, feature: "focal", occupy: "force", light: false });
      if (pl) ctx.grid.mark(rectAt(focal, [pl.footprint[0] + 1.2, pl.footprint[1] + 1.2]), Cell.Solid);
    }
  }
  // Fence around the yard, open where the road crosses it.
  // Fence around the yard, with a gate where a road or path crosses it.
  const ring: Vec[] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const crossings: Vec[] = [];
  for (const rd of roads) for (let i = 0; i + 1 < rd.length; i++) for (let j = 0; j < 4; j++) {
    const hit = segHit(rd[i]!, rd[i + 1]!, ring[j]!, ring[(j + 1) % 4]!);
    if (hit) crossings.push(hit);
  }
  for (let j = 0; j < 4; j++) {
    const a = ring[j]!, b = ring[(j + 1) % 4]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const cuts = crossings.map((c) => (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1]).filter((t) => t > -0.5 && t < len + 0.5 && crossings.length).sort((p, q) => p - q);
    const onSide = crossings.filter((c) => Math.abs((c[0] - a[0]) * u[1] - (c[1] - a[1]) * u[0]) < 0.3);
    const ts = onSide.map((c) => (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1]).sort((p, q) => p - q);
    void cuts;
    let t0 = 0;
    for (const t of ts) {
      if (t - 1.1 > t0) ctx.paths.push({ key: nextKey(ctx, `${zone}/fence`), zone, points: [add(a, u, t0), add(a, u, t - 1.1)], use: "fence" });
      t0 = t + 1.1;
    }
    if (len - t0 > 0.3) ctx.paths.push({ key: nextKey(ctx, `${zone}/fence`), zone, points: [add(a, u, t0), b], use: "fence" });
  }
  markPath(ctx.grid, [...ring, ring[0]!], 0.5, Cell.Solid);
  for (const rd of roads) markPath(ctx.grid, rd, 2.2, Cell.Path);
  // Graves don't sit on paths.
  for (const rd of roads) markPath(ctx.grid, rd, 1.6, Cell.Solid);
  // Rows of graves facing the same way, with a walkway every few rows.
  const horizontalRows = r.w >= r.h;
  const colStep = ctx.rng.range(1.5, 1.8), rowStep = ctx.rng.range(2.1, 2.5);
  const face: Vec = horizontalRows ? [0, 1] : [1, 0];
  const across = horizontalRows ? r.w : r.h, deep = horizontalRows ? r.h : r.w;
  const rows = Math.floor((deep - 1) / rowStep), cols = Math.floor((across - 1) / colStep);
  const walk = ctx.rng.int(Math.floor(cols / 3), Math.ceil((2 * cols) / 3));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (j === walk) continue;
      const u = r.x + (horizontalRows ? 0.8 + j * colStep : 0.8 + i * rowStep);
      const v = r.y + (horizontalRows ? 0.8 + i * rowStep : 0.8 + j * colStep);
      const roll = ctx.rng.next();
      if (roll < 0.1) continue;
      const role = roll < 0.15 ? "grave" : roll < 0.19 ? "tomb" : roll < 0.21 ? "statue" : "gravestone";
      const a = pick(ctx, zone, role, { maxSide: role === "tomb" ? 3.2 : 1.8 }) ?? pick(ctx, zone, "gravestone", { maxSide: 1.8 });
      if (!a) return;
      const tilt = ctx.wear === "ruined" ? ctx.rng.range(-0.3, 0.3) : ctx.wear === "grimy" ? ctx.rng.range(-0.15, 0.15) : ctx.rng.range(-0.05, 0.05);
      const rot = Math.atan2(face[1], face[0]) - Math.PI / 2 + tilt + (a.tag?.facing === "none" ? ctx.rng.range(-0.2, 0.2) : 0);
      const at: Vec = [u + ctx.rng.range(-0.07, 0.07), v + ctx.rng.range(-0.07, 0.07)];
      const pl = place(ctx, { asset: a, role, at, rot, layer: LAYER.furniture, zone, feature: "graves", occupy: "solid", light: false });
      if (!pl) continue;
      // A grave mound in front of some stones.
      if (pl && role === "gravestone" && ctx.rng.next() < 0.55) {
        const mound = pick(ctx, zone, "grave", { maxSide: 2.4 }) ?? pick(ctx, zone, "dirt", { maxSide: 2 });
        if (mound) place(ctx, { asset: mound, role: "grave", at: add(at, face, 0.9), rot, layer: LAYER.decal, zone, feature: "graves", parent: pl.key, key: nextKey(ctx, `${pl.key}/grave`), occupy: "low", light: false });
      }
    }
  }
  // A few lights and some decay.
  for (let i = 0; i < (focal ? 0 : 2); i++) {
    const a = pick(ctx, zone, "lamp_post") ?? pick(ctx, zone, "brazier") ?? pick(ctx, zone, "lantern");
    if (a) place(ctx, { asset: a, role: a.tag?.role ?? "lantern", at: [r.x + ctx.rng.range(1, r.w - 1), r.y + ctx.rng.range(1, r.h - 1)], rot: 0, layer: LAYER.furniture, zone, feature: "lights", occupy: "solid" });
  }
  // Greenery hugs the fence; the rows stay readable.
  const menu = GREEN[ctx.plan.genre];
  const perim = 2 * (r.w + r.h);
  for (let d = ctx.rng.range(0, 3); d < perim; d += ctx.rng.range(2.5, 5)) {
    const p: Vec = d < r.w ? [r.x + d, r.y + 0.4] : d < r.w + r.h ? [r.x + r.w - 0.4, r.y + d - r.w] : d < 2 * r.w + r.h ? [r.x + r.w - (d - r.w - r.h), r.y + r.h - 0.4] : [r.x + 0.4, r.y + r.h - (d - 2 * r.w - r.h)];
    scatterCluster(ctx, p, menu, ctx.rng.int(1, 3), 0.9, zone, "greenery", { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
  }
}

export function dressExterior(input: DressInput): ExteriorResult {
  const grid = new Grid(input.layout.map.w, input.layout.map.h);
  const ctx = makeCtx(input, grid, "exterior");
  markBuilding(ctx);
  const L = ctx.layout;
  const zoneId = L.zones.find((z) => z.outdoor)?.id ?? "outside";
  const roads: Vec[][] = [];
  // Road from the main door (or every outside door when there is no main one).
  const outs = L.doors.filter((d) => d.between[1] === "outside");
  const main = outs.find((d) => d.main) ?? outs[0];
  if (main) {
    const side = sideOfDoor(ctx, main.at) ?? L.front;
    const pts = road(ctx, main.at, OUT[side]);
    roads.push(pts);
    ctx.paths.push({ key: "road:main", zone: main.between[0], points: pts, use: "road", width: 1.7 });
    markPath(grid, pts, 2.0, Cell.Path);
  }
  for (const d of outs) {
    if (d === main) continue;
    const side = sideOfDoor(ctx, d.at);
    if (!side) continue;
    // Back doors get a short trodden trail.
    const pts: Vec[] = [add(d.at, OUT[side], 0.3), add(add(d.at, OUT[side], 2.5), [ctx.rng.range(-0.6, 0.6), ctx.rng.range(-0.6, 0.6)])];
    roads.push(pts);
    markPath(grid, pts, 1.4, Cell.Path);
  }
  // Doors stay clear outside too.
  for (const d of outs) grid.mark(rectAt(d.at, [2.2, 2.2]), Cell.Door);

  // Rubble where a ruined wall has fallen, spilling both ways.
  for (const br of L.breaches ?? []) {
    const mid: Vec = [(br.a[0] + br.b[0]) / 2, (br.a[1] + br.b[1]) / 2];
    for (let i = 0; i < 4; i++) {
      const a = pick(ctx, zoneId, "debris", { maxSide: 1.6, avoid: /blood|bone|body|wood|board|plank|glass/i });
      if (!a) break;
      const at: Vec = [mid[0] + ctx.rng.range(-1.2, 1.2), mid[1] + ctx.rng.range(-1.2, 1.2)];
      place(ctx, { asset: a, role: "debris", at, rot: ctx.rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "breach", occupy: "force", light: false });
    }
  }
  if (L.building.w > 0) {
    doorProps(ctx, zoneId);
    hugWalls(ctx, zoneId);
  }
  for (const z of L.zones.filter((q) => q.outdoor)) {
    if (z.type === "gothic.graveyard") graveyard(ctx, z, roads);
  }
  // A deep approach is a clearing: trees close in round its far edge and sides, the middle stays open.
  if (L.approach && Math.min(L.approach.w, L.approach.h) >= 8) clearing(ctx, L.approach, zoneId);
  // The more open ground around the building, the more it needs: a lined approach and denser greenery.
  const open = (L.map.w * L.map.h - L.building.w * L.building.h) / (L.map.w * L.map.h);
  if (L.building.w > 0 && roads[0] && open > 0.55) lineRoad(ctx, roads[0], zoneId);
  vegetation(ctx, { x: 0.3, y: 0.3, w: L.map.w - 0.6, h: L.map.h - 0.6 }, L.building.w > 0 ? 0.6 + Math.max(0, open - 0.5) * 1.2 : 0.8, zoneId);
  void ({} as AssetRecord);
  return { placed: ctx.placed, paths: ctx.paths, notes: ctx.notes, roads };
}
