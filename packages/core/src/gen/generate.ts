/** Plan in, Dungeondraft maps out: one per style version. See DESIGN.md sections 5, 6 and 9. */

import { PX_PER_SQUARE as S, type AssetRecord } from "../assets/model";
import { DDMapBuilder, type Json } from "../ddmap/builder";
import type { Vec2 } from "../ddmap/godot";
import { Catalog, GENRE_SETTINGS, type FloorKind } from "./catalog";
import { dress, type PathPlan, type Placed } from "./dress";
import { dressExterior } from "./exterior";
import { layoutBuilding, outerWallRuns, shelterOf, type Layout, type Shelter } from "./layout";
import { validatePlan, type PlanIssue, type ScenePlan } from "./plan";
import { RECIPE_BY_TYPE, rolesOfRecipe } from "./recipes";
import { Rng } from "./rng";
import { noise2 } from "./noise";
import { specOf, ZONE_TYPES } from "./rooms";
import { buildStyles, type Style, type Wear } from "./style";
import type { City } from "../city/city";
import { generateStreet } from "../city/street";
import { generateWar } from "./war";
import type { SundialOut } from "./sundial";

export interface ElementInfo {
  kind: "object" | "wall" | "door" | "window" | "floor" | "light" | "path";
  /** Stable key within the plan, such as "common/tables#2" or a directive id. */
  key: string;
  zone?: string;
  feature?: string;
  type?: string;
  asset?: string;
  directive?: string;
  /** Doors: Foundry door state. */
  state?: "closed" | "locked" | "open";
  /** Gates: width in squares, and the image Foundry draws as the closed leaves (fractions of the image). */
  width?: number;
  leaf?: LeafSpec;
}

/** Closed gate leaves for Foundry's door animation. */
export interface LeafSpec {
  asset: string;
  /** Where both closed leaves are in the image (fractions). */
  box: [number, number, number, number];
  /** Texture pixels per square at the size the map shows it. */
  px: number;
  /** "center": the leaves straddle the wall line; "edge": they stand on it and rise toward `side`. */
  align: "center" | "edge";
  side?: [number, number];
  /** The leaves are drawn in their frame's own art (one image): cut them out of it where Foundry draws them. */
  erase?: boolean;
}

export interface VersionSummary {
  objects: number;
  lights: number;
  doors: number;
  windows: number;
  byType: Record<string, number>;
  packs: string[];
}

export interface GeneratedVersion {
  id: string;
  name: string;
  palette: { anchorPack: string; tone: string; tint: string; floors: Record<string, string>; wall?: string; door?: string; window?: string; road?: string };
  map: Json;
  /** Dungeondraft node id -> what the element is. */
  elements: Record<string, ElementInfo>;
  placed: Placed[];
  /** Where the weather stays out (roofed buildings, or all but an enclosed map's approach), in squares. */
  sheltered?: Shelter[];
  /** The sundial set piece of a street map (gen/sundial.ts): numerals for the renderer; the shadow, gems, gate and cast for Foundry. */
  sundial?: SundialOut;
  notes: string[];
  summary: VersionSummary;
}

export interface GeneratedMap {
  plan: ScenePlan;
  layout: Layout;
  versions: GeneratedVersion[];
}

export class PlanError extends Error {
  constructor(readonly issues: PlanIssue[]) {
    super(`invalid plan: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
}

const AMBIENT = { day: "ffffffff", dusk: "ffd2c2a8", night: "ff6a7290" } as const;
/** mood.lighting: how much of the ambient light remains, and how far lamps reach. */
const MOOD_LIGHT = { bright: { ambient: 1, reach: 1 }, dim: { ambient: 0.7, reach: 0.72 }, dark: { ambient: 0.5, reach: 0.58 } } as const;

function scaleArgb(argb: string, f: number): string {
  return "ff" + [2, 4, 6].map((i) => Math.round(parseInt(argb.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");
}

/** Cells outside the building and outside the approach, as row runs: the unseen dark around an enclosed building. */
function voidRuns(layout: Layout): Array<{ x: number; y: number; w: number; h: number }> {
  const a = layout.approach;
  if (!a) return [];
  const inRoom = (x: number, y: number) => layout.zones.some((z) => !z.outdoor && x >= z.rect.x && x < z.rect.x + z.rect.w && y >= z.rect.y && y < z.rect.y + z.rect.h);
  const inApproach = (x: number, y: number) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
  const runs: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let y = 0; y < layout.map.h; y++) {
    let x0 = -1;
    for (let x = 0; x <= layout.map.w; x++) {
      const v = x < layout.map.w && !inRoom(x, y) && !inApproach(x, y);
      if (v && x0 < 0) x0 = x;
      if (!v && x0 >= 0) { runs.push({ x: x0, y, w: x - x0, h: 1 }); x0 = -1; }
    }
  }
  // Merge runs that stack exactly into taller rectangles.
  const out: typeof runs = [];
  for (const r of runs) {
    const above = out.find((o) => o.x === r.x && o.w === r.w && o.y + o.h === r.y);
    if (above) above.h += 1;
    else out.push({ ...r });
  }
  return out;
}

export interface GenerateOptions {
  /** A previous generation of the same plan, for locks. */
  previous?: GeneratedMap;
  date?: Date;
  /** Reuse a catalog across calls (it is the expensive part to build). */
  catalog?: Catalog;
  /** The city a street plan (plan.street) is built from. */
  city?: City;
  /** Street plans: 2MT house drawings ("art", the default) or procedural roofs ("roofs"). */
  houses?: "art" | "roofs";
  /** Street maps: buildings from inside (default) or roofed (false). */
  interiors?: boolean;
}

/** Pieces of the previous version that locks keep in place. */
function lockedPieces(plan: ScenePlan, previous?: GeneratedMap): Placed[] {
  if (!previous || !plan.locks?.length) return [];
  const ver = previous.versions.find((v) => v.id === (previous.plan.versions?.picked ?? plan.versions?.picked)) ?? previous.versions[0];
  if (!ver) return [];
  const keys = new Set<string>();
  for (const l of plan.locks) for (const nid of l.elements ?? []) {
    const k = ver.elements[nid]?.key;
    if (k) keys.add(k);
  }
  const inRegion = (p: Placed) => {
    const c = p.center ?? [p.x, p.y];
    return plan.locks!.some((l) => l.region && c[0] >= l.region.x && c[0] <= l.region.x + l.region.w && c[1] >= l.region.y && c[1] <= l.region.y + l.region.h);
  };
  const roots = ver.placed.filter((p) => !p.parent && (keys.has(p.key) || inRegion(p)));
  const rootKeys = new Set(roots.map((r) => r.key));
  return ver.placed.filter((p) => rootKeys.has(p.key) || (p.parent && rootKeys.has(p.parent)));
}

export function generate(plan: ScenePlan, catalogOrIndex: Catalog | ConstructorParameters<typeof Catalog>[0], opts: GenerateOptions = {}): GeneratedMap {
  const issues = validatePlan(plan, ZONE_TYPES);
  if (issues.length) throw new PlanError(issues);
  const cat = opts.catalog ?? (catalogOrIndex instanceof Catalog ? catalogOrIndex : new Catalog(catalogOrIndex, GENRE_SETTINGS[plan.genre]));
  if (plan.street) {
    if (!opts.city) throw new Error("a street plan needs its city layout");
    return generateStreet(plan, cat, opts.city, { date: opts.date, houses: opts.houses, interiors: opts.interiors });
  }
  if (plan.war) return generateWar(plan, cat, { date: opts.date });
  const rng = new Rng(plan.seed);
  const layout = layoutBuilding(plan, rng.fork("layout"));
  const roles = new Set<string>();
  for (const z of plan.levels[0]!.zones) for (const r of rolesOfRecipe(RECIPE_BY_TYPE.get(z.type) ?? { type: z.type, steps: [] })) roles.add(r);
  const count = plan.versions?.count ?? 3;
  const wear = (plan.mood?.wear ?? "lived-in") as Wear;
  const styles = buildStyles(cat, plan.genre, wear, [...roles], count, rng.fork("styles"), themeOf(plan), { dark: plan.genre === "gothic" && (plan.mood?.lighting === "dim" || plan.mood?.lighting === "dark" || plan.mood?.time === "night"), enclosed: !!layout.approach, clearing: !!layout.approach && Math.min(layout.approach.w, layout.approach.h) >= 8 });
  if (!styles.length) throw new Error("the asset library has no pieces for these room types");
  const locked = lockedPieces(plan, opts.previous);
  const versions = styles.map((st) => buildVersion(plan, layout, cat, st, styles, locked, opts.date));
  return { plan, layout, versions };
}

/** Pack-name themes that suit the plan's rooms; matching packs make better anchors. */
function themeOf(plan: ScenePlan): RegExp | undefined {
  const types = plan.levels[0]!.zones.map((z) => z.type);
  const parts: string[] = [];
  if (types.some((t) => t.startsWith("tavern."))) parts.push("tavern", "inn", "lodge", "furniture");
  if (types.some((t) => ["gothic.nave", "gothic.crypt", "gothic.vestry", "gothic.graveyard"].includes(t))) parts.push("cathedral", "church", "chapel", "crypt", "monastery", "bones", "graveyard", "haunted", "wedding");
  if (types.some((t) => ["gothic.study", "gothic.bedroom", "gothic.ballroom", "gothic.dining", "gothic.hall"].includes(t))) parts.push("mansion", "haunted", "victorian", "ballroom", "manor", "sinister", "furniture");
  return parts.length ? new RegExp(`\\b(${parts.join("|")})\\b`, "i") : undefined;
}

function floorFor(st: Style, kind: FloorKind): AssetRecord | undefined {
  const order: FloorKind[] = [kind, "wood", "stone", "tile", "cobble", "dirt"];
  for (const k of order) if (st.floors[k]) return st.floors[k];
  return undefined;
}

function distToPolyline(p: [number, number], pts: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

function buildVersion(plan: ScenePlan, layout: Layout, cat: Catalog, st: Style, styles: Style[], locked: Placed[], date?: Date): GeneratedVersion {
  const { w, h } = layout.map;
  const mood = MOOD_LIGHT[plan.mood?.lighting ?? "bright"];
  const b = new DDMapBuilder({ width: w, height: h, ambientLight: scaleArgb(AMBIENT[plan.mood?.time ?? "day"], mood.ambient), date });
  const elements: Record<string, ElementInfo> = {};
  const notes: string[] = [];
  const use = (a?: AssetRecord) => {
    if (a) b.usePack(cat.manifestFor(a.pack));
    return a;
  };
  const px = (p: readonly [number, number]): Vec2 => [p[0] * S, p[1] * S];

  const input = { plan, layout, cat, style: st, styles, locked };
  const inside = dress(input);
  const outside = dressExterior(input);

  // Terrain: patchy grass, worn to dirt along roads, around the building and its doors.
  if (st.terrain.length) {
    const tex = st.terrain.map((t) => use(t)!.res);
    while (tex.length < 4) tex.push(tex[tex.length - 1]!);
    const n1 = noise2(plan.seed % 9973), n2 = noise2((plan.seed * 7) % 9967);
    const doorsOut = layout.doors.filter((d) => d.between[1] === "outside");
    const bld = layout.building;
    b.paintTerrain(tex, (tx, ty) => {
      const x = (tx + 0.5) / 4, y = (ty + 0.5) / 4;
      let dirt = 0;
      if (bld.w > 0) {
        const dx = Math.max(bld.x - x, 0, x - (bld.x + bld.w)), dy = Math.max(bld.y - y, 0, y - (bld.y + bld.h));
        dirt = Math.max(dirt, 0.8 - Math.hypot(dx, dy) / 1.6);
      }
      for (const d of doorsOut) dirt = Math.max(dirt, 1 - Math.hypot(x - d.at[0], y - d.at[1]) / 3.2);
      for (const r of outside.roads) dirt = Math.max(dirt, 1 - (distToPolyline([x, y], r) - 0.6) / 1.8);
      const patch = n1(x / 5, y / 5);
      dirt = Math.max(dirt, (patch - 0.62) * 3);
      const third = Math.max(0, (n2(x / 3.5, y / 3.5) - 0.55) * 3);
      const dw = Math.max(0, Math.min(1, dirt));
      const tw = tex[2] !== tex[0] ? Math.max(0, Math.min(1, third)) * (1 - dw) : 0;
      return [255 * (1 - dw) * (1 - tw), 255 * dw, 255 * tw, 0];
    });
  }

  // An enclosed building sits in the unseen dark: dark rock, nearly black, all around but the approach.
  if (layout.approach && st.voidTexture) {
    const tex = use(st.voidTexture)!;
    for (const r of voidRuns(layout)) {
      const id = b.addPattern({ points: [px([r.x, r.y]), px([r.x + r.w, r.y]), px([r.x + r.w, r.y + r.h]), px([r.x, r.y + r.h])], texture: tex.res, color: "ff16141a" });
      elements[id] = { kind: "floor", key: `void@${r.x},${r.y}`, asset: tex.id };
    }
  }

  // Floors, one pattern per indoor zone.
  for (const z of layout.zones) {
    if (z.outdoor) continue;
    const floor = use(floorFor(st, specOf(z.type).floor));
    if (!floor) continue;
    const r = z.rect;
    const id = b.addPattern({ points: [px([r.x, r.y]), px([r.x + r.w, r.y]), px([r.x + r.w, r.y + r.h]), px([r.x, r.y + r.h])], texture: floor.res });
    elements[id] = { kind: "floor", key: `${z.id}/floor`, zone: z.id, asset: floor.id };
  }

  // Walls with doors and windows.
  const wallTex = use(st.wall)?.res;
  const innerTex = use(st.innerWall ?? st.wall)?.res;
  const doorTex = use(st.door)?.res;
  const winTex = use(st.window)?.res;
  // Gates: a double-gate portal (its left half becomes a swinging leaf in Foundry).
  const gatePortal = cat.ofUse("gate").filter((a) => a.kind === "portal" && (a.mat?.fit ?? 0) >= 2 && !/portcullis|bars|prison/i.test(a.name)).sort((a, b) => (b.mat!.fit - a.mat!.fit) || a.id.localeCompare(b.id))[0] ?? cat.ofUse("door_double").filter((a) => a.kind === "portal" && (a.mat?.fit ?? 0) >= 2)[0];
  const gateTex = layout.doors.some((d) => d.gate && !d.broken) ? use(gatePortal)?.res : undefined;
  const leafOf = new Map((inside.gates ?? []).map((g) => [g.door, g]));
  const doorInfo = (d: (typeof layout.doors)[number]): Partial<ElementInfo> => {
    const o: Partial<ElementInfo> = { state: d.state ?? "closed" };
    if (d.gate) {
      o.width = d.width ?? 3;
      const g = leafOf.get(layout.doors.indexOf(d));
      const a = g ? cat.asset(g.asset) : gatePortal;
      const box: [number, number, number, number] = g ? g.box : [0, 0, 1, 1];
      // Leaf texture pixels per square, so Foundry draws it at the size the map shows it.
      if (a) o.leaf = { asset: a.id, box, px: Math.max(8, Math.round(((box[2] - box[0]) * a.size[0]) / o.width)), align: g ? "edge" : "center", ...(g ? { side: g.side } : {}), ...(g?.erase ? { erase: true } : {}) };
    }
    return o;
  };
  const texOf = (d: (typeof layout.doors)[number]) => (d.gate ? gateTex ?? doorTex : doorTex);
  // Gate portals are drawn across the whole opening.
  const scaleOf = (d: (typeof layout.doors)[number]) => (d.gate && gateTex && gatePortal ? ((d.width ?? 3) * S) / gatePortal.size[0] : undefined);
  const live = layout.doors.filter((d) => !d.broken);
  // Gates blown apart leave gaps: outer ones become breaches, inner ones split their wall.
  const gaps = layout.doors.filter((d) => d.broken).map((d) => {
    const h = (d.width ?? 2) / 2;
    return { wall: d.wall, a: [d.at[0] - d.dir[0] * h, d.at[1] - d.dir[1] * h] as [number, number], b: [d.at[0] + d.dir[0] * h, d.at[1] + d.dir[1] * h] as [number, number] };
  });
  if (layout.outline.length) {
    const outerDoors = live.filter((d) => d.wall === "outer");
    const wins = winTex ? layout.windows : [];
    // One outer wall, or several runs where a ruined building's wall has fallen.
    const onRun = (p: [number, number], pts: Array<[number, number]>, loop: boolean) => {
      for (let i = 0; i < pts.length - (loop ? 0 : 1); i++) {
        const a = pts[i]!, c = pts[(i + 1) % pts.length]!;
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const t = ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / (len * len || 1);
        if (t > 0 && t < 1 && Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / (len || 1) < 0.01) return true;
      }
      return false;
    };
    const breaches = [...(layout.breaches ?? []), ...gaps.filter((g) => g.wall === "outer").map((g) => ({ a: g.a, b: g.b }))];
    outerWallRuns(layout.outline, breaches).forEach((run, ri) => {
      const ds = outerDoors.filter((d) => onRun(d.at, run.points, run.loop));
      const ws = wins.filter((wd) => onRun(wd.at, run.points, run.loop));
      const res = b.addWall({
        points: run.points.map(px),
        loop: run.loop,
        texture: wallTex,
        doors: [
          ...ds.map((d) => ({ at: px(d.at), texture: texOf(d), width: d.width ?? 1, closed: d.state !== "open", scale: scaleOf(d) })),
          ...ws.map((wd) => ({ at: px(wd.at), texture: winTex, width: wd.width, closed: true })),
        ],
      });
      elements[res.id] = { kind: "wall", key: ri === 0 ? "outer" : `outer#${ri}` };
      res.doors.forEach((nid, i) => {
        if (i < ds.length) elements[nid] = { kind: "door", key: `door:${ds[i]!.between.join("-")}`, zone: ds[i]!.between[0], ...doorInfo(ds[i]!) };
        else elements[nid] = { kind: "window", key: `window:${ws[i - ds.length]!.zone}#${i - ds.length}`, zone: ws[i - ds.length]!.zone };
      });
    });
    layout.interiorWalls.forEach((seg, wi) => {
      // Split the wall around gaps left by wrecked gates.
      const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
      const u: [number, number] = [(seg.b[0] - seg.a[0]) / len, (seg.b[1] - seg.a[1]) / len];
      const tOf = (p: [number, number]) => (p[0] - seg.a[0]) * u[0] + (p[1] - seg.a[1]) * u[1];
      const cuts = gaps.filter((g) => g.wall === wi).map((g) => [Math.min(tOf(g.a), tOf(g.b)), Math.max(tOf(g.a), tOf(g.b))] as [number, number]).sort((p, q) => p[0] - q[0]);
      const pieces: Array<[number, number]> = [];
      let t0 = 0;
      for (const [c0, c1] of cuts) { if (c0 - t0 > 0.01) pieces.push([t0, c0]); t0 = c1; }
      if (len - t0 > 0.01) pieces.push([t0, len]);
      pieces.forEach(([p0, p1], pi) => {
        const A: [number, number] = [seg.a[0] + u[0] * p0, seg.a[1] + u[1] * p0], B: [number, number] = [seg.a[0] + u[0] * p1, seg.a[1] + u[1] * p1];
        const ds = live.filter((d) => d.wall === wi && tOf(d.at) > p0 && tOf(d.at) < p1);
        const r2 = b.addWall({ points: [px(A), px(B)], texture: innerTex, doors: ds.map((d) => ({ at: px(d.at), texture: texOf(d), width: d.width ?? 1, closed: d.state !== "open", scale: scaleOf(d) })) });
        elements[r2.id] = { kind: "wall", key: pi ? `wall#${wi}.${pi}` : `wall#${wi}` };
        r2.doors.forEach((nid, i) => (elements[nid] = { kind: "door", key: `door:${ds[i]!.between.join("-")}`, zone: ds[i]!.between[0], ...doorInfo(ds[i]!) }));
      });
    });
  }

  // Roads and fences.
  const fenceUse = plan.genre === "gothic" ? ["fence_iron", "fence_stone", "fence_wood"] : ["fence_wood", "fence_stone"];
  const fence = cat.ofUse(...fenceUse).filter((a) => a.kind === "path" && (a.mat?.fit ?? 0) >= 2)[0];
  const allPaths: PathPlan[] = [...inside.paths, ...outside.paths];
  for (const p of allPaths) {
    const tex = p.use === "road" ? use(st.road) : use(fence);
    if (!tex) continue;
    const id = b.addPath({ points: p.points.map(px), texture: tex.res, width: S * (p.width ?? (p.use === "road" ? 1.7 : 0.6)), layer: p.use === "road" ? -400 : 300 });
    elements[id] = { kind: "path", key: p.key, zone: p.zone };
  }

  // Objects and their lights. A locked region keeps exactly what it had: new pieces that
  // landed in one (decals, the yard outside) are dropped, and each locked piece appears once.
  const inLock = (p: Placed) => {
    const c = p.center ?? [p.x, p.y];
    return (plan.locks ?? []).some((l) => l.region && c[0] >= l.region.x && c[0] <= l.region.x + l.region.w && c[1] >= l.region.y && c[1] <= l.region.y + l.region.h);
  };
  const seenLocked = new Set<string>();
  // Enclosed: nothing outdoors but on the approach.
  const ap = layout.approach;
  const onApproach = (p: Placed) => {
    if (!ap) return true;
    const c = p.center ?? [p.x, p.y];
    return c[0] >= ap.x - 0.3 && c[0] <= ap.x + ap.w + 0.3 && c[1] >= ap.y - 0.3 && c[1] <= ap.y + ap.h + 0.3;
  };
  const placed = [...inside.placed, ...outside.placed.filter(onApproach)].filter((p) => {
    if (p.locked) {
      if (seenLocked.has(p.key)) return false;
      seenLocked.add(p.key);
      return true;
    }
    return !inLock(p);
  });
  const lightZones = new Set<string>();
  for (const p of placed) {
    use(p.asset);
    const id = b.addObject({ at: px([p.x, p.y]), texture: p.asset.res, rotation: p.rotation, scale: p.stretch && p.stretch !== 1 ? [p.scale * p.stretch, p.scale] : p.scale, layer: p.layer, customColor: p.customColor, shadow: p.layer >= 300 && p.layer < 700 });
    elements[id] = { kind: "object", key: p.key, zone: p.zone, feature: p.feature, type: p.type, asset: p.asset.id, directive: p.directive };
    if (p.light) {
      const c = p.center ?? [p.x, p.y];
      const lid = b.addLight({ at: px(c), range: Math.max(1.5, p.light.range * mood.reach), color: p.light.color, intensity: p.light.intensity ?? 1 });
      elements[lid] = { kind: "light", key: `${p.key}/light`, zone: p.zone };
      lightZones.add(p.zone);
    }
  }
  // Every indoor zone gets at least one light.
  for (const z of layout.zones) {
    if (lightZones.has(z.id) || z.outdoor) continue;
    const lid = b.addLight({ at: px([z.rect.x + z.rect.w / 2, z.rect.y + z.rect.h / 2]), range: Math.max(3, Math.round(Math.max(z.rect.w, z.rect.h) * 0.6 * mood.reach)), intensity: 0.7 });
    elements[lid] = { kind: "light", key: `${z.id}/ambient`, zone: z.id };
  }

  const byType: Record<string, number> = {};
  for (const p of placed) byType[p.type] = (byType[p.type] ?? 0) + 1;
  const map = b.build();
  void styles;
  return {
    id: st.id,
    name: st.name,
    palette: {
      anchorPack: st.anchorPack,
      tone: st.tone,
      tint: st.tint,
      floors: Object.fromEntries(Object.entries(st.floors).filter(([, a]) => a).map(([k, a]) => [k, a!.id])),
      wall: st.wall?.id,
      door: st.door?.id,
      window: st.window?.id,
      road: st.road?.id,
    },
    map,
    elements,
    placed,
    sheltered: shelterOf(layout),
    notes: [
      ...(layout.dropped?.length ? [`zones left out because the map is too small for them: ${layout.dropped.join(", ")}; make the map bigger or use fewer rooms`] : []),
      ...b.warnings,
      ...inside.notes,
      ...outside.notes,
      ...notes,
    ],
    summary: {
      objects: placed.length,
      lights: Object.values(elements).filter((e) => e.kind === "light").length,
      doors: Object.values(elements).filter((e) => e.kind === "door").length,
      windows: Object.values(elements).filter((e) => e.kind === "window").length,
      byType,
      packs: [...b.manifest.keys()],
    },
  };
}
