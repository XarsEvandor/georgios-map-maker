/**
 * Street-level battle maps of part of a city, built from its MFCG layout: the real building
 * outlines become walled, roofed buildings with a door on the street side; streets and
 * squares are cobbled; the city wall runs with round towers and open gates where roads pass;
 * rivers, the sea and piers come in; market squares fill with stalls, streets get clutter
 * and lamps. One square is 5 ft (1.524 m).
 */

import { PX_PER_SQUARE as S, type AssetRecord } from "../assets/model";
import { DDMapBuilder } from "../ddmap/builder";
import type { Vec2 } from "../ddmap/godot";
import type { Catalog } from "../gen/catalog";
import { LIGHTS, makeCtx, Grid, Cell, place, pick, pickWeighted, rectAt, aabb, frontSize, rotationFor, type Ctx, type Placed, LAYER } from "../gen/dress";
import type { ElementInfo, GeneratedMap, GeneratedVersion } from "../gen/generate";
import type { Layout, Shelter } from "../gen/layout";
import type { ScenePlan } from "../gen/plan";
import { Rng } from "../gen/rng";
import { buildStyles, type Style, type Wear } from "../gen/style";
import { area as ringArea, bboxOf, centroid, clipRing, distToPolyline, inside, M_PER_SQUARE, type Box, type City, type Pt, type Ring } from "./city";
import { faceLight, hipRoof, type RoofFace } from "./roof";
import { noise2, smoothstep } from "../gen/noise";
import { houseArtFrom, placeHouses } from "./houses";
import { cityPlaces } from "./places";
import { TRADES, type Trade } from "./shops";
import { furnishBuilding, type BuildingKind } from "./interiors";
import { RECIPE_BY_TYPE, rolesOfRecipe } from "../gen/recipes";

type Vec = [number, number];

const AMBIENT = { day: "ffffffff", dusk: "ffd2c2a8", night: "ff6a7290" } as const;
const MOOD = { bright: 1, dim: 0.72, dark: 0.55 } as const;

function scaleArgb(argb: string, f: number): string {
  return "ff" + [2, 4, 6].map((i) => Math.round(parseInt(argb.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");
}

/** A polyline as a polygon of the given width (squares): rectangles per segment, for clipping and patterns. */
function strokeRects(pts: Vec[], width: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const nx = (-(b[1] - a[1]) / len) * (width / 2), ny = ((b[0] - a[0]) / len) * (width / 2);
    out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  }
  return out;
}

/** The parts of a polyline inside the map (squares, half a square of slack), each segment clipped to the border. */
function clipPolyline(pts: Vec[], w: number, h: number): Vec[][] {
  const out: Vec[][] = [];
  let cur: Vec[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = clipSeg(pts[i]!, pts[i + 1]!, -0.5, -0.5, w + 0.5, h + 0.5);
    if (!c) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length || c.t0 > 0) {
      if (cur.length > 1) out.push(cur);
      cur = [c.a];
    }
    cur.push(c.b);
    if (c.t1 < 1) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Liang-Barsky: the part of segment a-b inside the box, with its parameters along the segment. */
function clipSeg(a: Vec, b: Vec, x0: number, y0: number, x1: number, y1: number): { a: Vec; b: Vec; t0: number; t1: number } | undefined {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as Array<[number, number]>) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return undefined;
  }
  return { a: [a[0] + dx * t0, a[1] + dy * t0], b: [a[0] + dx * t1, a[1] + dy * t1], t0, t1 };
}

export interface StreetOptions {
  date?: Date;
  /** "art" (default): 2MT roof drawings laid into the plots (houses.ts); "roofs": a procedural hip roof per outline (also used when the library has no house art). */
  houses?: "art" | "roofs";
  /** Show buildings from inside (floor, windows, rooms, furniture) instead of their roofs. Default true; the city scene keeps its roofs. */
  interiors?: boolean;
}

/** Room types whose furniture sets the street map's indoor style. */
const INDOOR_ROOMS = ["house.home", "house.living", "house.bedroom", "tavern.common_room"];

/** Lights by the street door of the great buildings (one each side) and the public ones (one); homes, warehouses and secret places have none. */
const DOOR_LAMPS: Partial<Record<string, number>> = { keep: 2, castle: 2, mansion: 2, garrison: 2, gatehouse: 2, church: 2, chapel: 1, parish: 1, tavern: 1, inn: 1, guildhall: 1, stable: 1, wizard: 1 };
/** Street lights are plain flames: no crystal, skulls, coloured fire or broken pieces. */
const ODD_LIGHT = /crystal|skull|green|blue|rose|broken|unlit|snuffed|toppled|neon|cyber|platform/i;

/** The furniture style every building on a street map shares (one pack family, one wood tone). */
function indoorStyle(cat: Catalog, plan: ScenePlan, st: Style, wall: AssetRecord | undefined): Style | undefined {
  const roles = [...new Set(INDOOR_ROOMS.flatMap((t) => rolesOfRecipe(RECIPE_BY_TYPE.get(t)!)))];
  const wear = (plan.mood?.wear ?? "lived-in") as Wear;
  const s = buildStyles(cat, "medieval", wear, roles, 1, new Rng(`${plan.seed}:${st.id}:indoor`))[0];
  return s ? { ...s, wall: wall ?? s.wall, innerWall: wall ?? s.innerWall } : undefined;
}

/** The kind of building a placed house drawing is (what its rooms hold). */
function kindOf(role: string, landmark?: string): BuildingKind {
  return (landmark ?? (role === "rural" ? "rural" : "house")) as BuildingKind;
}

/** Builds the versions of a street-level map. The plan carries the area (plan.street) and mood. */
export function generateStreet(plan: ScenePlan, cat: Catalog, city: City, opts: StreetOptions = {}): GeneratedMap {
  if (!plan.street) throw new Error("not a street plan");
  const ar = plan.street.area;
  const w = Math.max(10, Math.min(85, Math.round(ar.w / M_PER_SQUARE)));
  const h = Math.max(10, Math.min(85, Math.round(ar.h / M_PER_SQUARE)));
  const zone = plan.levels[0]!.zones[0]!;
  const layout: Layout = {
    map: { w, h }, building: { x: 0, y: 0, w: 0, h: 0 }, outline: [], interiorWalls: [], doors: [], windows: [], exterior: {}, front: "south",
    zones: [{ ...zone, rect: { x: 0, y: 0, w, h }, outdoor: true }],
  };
  const rng = new Rng(plan.seed);
  const wear = (plan.mood?.wear ?? "lived-in") as Wear;
  const roles = ["barrel", "crate", "sack", "basket", "cart", "wagon", "lamp_post", "brazier", "tree", "bush", "rock", "trough", "statue", "font", "debris", "dirt", "puddle", "grime"];
  const count = plan.versions?.count ?? 3;
  const styles = buildStyles(cat, plan.genre, wear, roles, count, rng.fork("styles"), undefined, { dark: plan.genre === "gothic" && (plan.mood?.lighting === "dark" || plan.mood?.time === "night") });
  const versions = styles.map((st) => streetVersion(plan, layout, cat, city, st, styles, opts));
  return { plan, layout, versions };
}

function streetVersion(plan: ScenePlan, layout: Layout, cat: Catalog, city: City, st: Style, styles: Style[], opts: StreetOptions): GeneratedVersion {
  const ar = plan.street!.area;
  const { w, h } = layout.map;
  const k = 1 / M_PER_SQUARE;
  const sq = (p: Pt): Vec => [(p[0] - ar.x) * k, (p[1] - ar.y) * k];
  const box: Box = { x: ar.x, y: ar.y, w: w * M_PER_SQUARE, h: h * M_PER_SQUARE };
  const lighting = plan.mood?.lighting ?? (plan.mood?.time === "night" ? "dim" : "bright");
  const reach = { bright: 1, dim: 0.75, dark: 0.6 }[lighting];
  const b = new DDMapBuilder({ width: w, height: h, ambientLight: scaleArgb(AMBIENT[plan.mood?.time ?? "day"], MOOD[lighting]), date: opts.date });
  const elements: Record<string, ElementInfo> = {};
  const notes: string[] = [];
  const use = (a?: AssetRecord) => {
    if (a) b.usePack(cat.manifestFor(a.pack));
    return a;
  };
  const px = (p: readonly [number, number]): Vec2 => [p[0] * S, p[1] * S];
  const rng = new Rng(`${plan.seed}:${st.id}:street`);

  // Dressing context: the whole map is one outdoor zone on a quarter-square grid.
  const grid = new Grid(w, h);
  const ctx: Ctx = makeCtx({ plan, layout, cat, style: st, styles, locked: [] }, grid, `street:${st.id}`);
  const zoneId = layout.zones[0]!.id;

  // Lights for the night: the style's own lit piece when it has one, else a plain lit 2MT piece; one look per map.
  const lrng = new Rng(`${plan.seed}:${st.id}:lights`);
  const lightPieces = new Map<string, AssetRecord | undefined>();
  const streetLight = (role: string, maxSide: number, wall = false): AssetRecord | undefined => {
    const key = `${role}:${maxSide}:${wall}`;
    if (lightPieces.has(key)) return lightPieces.get(key);
    const ok = (a: AssetRecord) => !!a.tag?.lit && !ODD_LIGHT.test(a.name) && Math.max(...(a.footprint ?? [1, 1])) <= maxSide && (a.tag?.placement === "wallmount") === wall;
    const own = pick(ctx, zoneId, role, { lit: true, maxSide, ...(wall ? { placement: ["wallmount"] } : {}) }, lrng);
    const any = cat.ofRole(role).filter(ok);
    const a = own && ok(own) ? own : any.length ? lrng.pick(any) : undefined;
    lightPieces.set(key, a);
    return a;
  };
  const doorLamps: Array<{ at: Vec; out: Vec; n: number }> = [];
  // Every house's wall line and street door, for the street lights.
  const houseWalls: Vec[][] = [];
  const doorSpots: Vec[] = [];

  const wall = city.walls.find((x) => city.buildings.filter((bb) => inside(centroid(bb), x.ring)).length > city.buildings.length / 3);
  // An open town (no wall) is a village: earth and grass, not cobbles.
  const insideWalls = (p: Pt) => (wall ? inside(p, wall.ring) : false);

  // Ground: four blended 2MT terrains, the same for every town (DESIGN 20, "Ground"). Grass,
  // cobbles, worn dirt, mud. In town the streets are cobbled and fade into the yards; outside
  // the walls the grass wears to dirt round the houses, along the roads and in patches, and to
  // mud by the water. Squares keep their flagstones.
  const ground = townGround(cat);
  const cobble = use(streetTex(cat, /^citystreet_cobblestone texture, brown$/) ?? st.floors.cobble ?? cat.ofUse("floor_cobble").filter((a) => a.kind === "pattern")[0]);
  const flag = use((ground ? cat.index.assets.find((a) => a.kind === "pattern" && a.name === "Texture - Cobble, Square - 4x4 - Sodden" && /Grass & Road Assets 2/.test(cat.packs.get(a.pack)?.name ?? "")) : undefined) ?? streetTex(cat, /^citystreet_flagstone texture, brown$/) ?? st.floors.stone ?? cobble);
  const plots = city.buildings.filter((bd) => { const bb = bboxOf(bd); return bb.x < box.x + box.w + 4 && bb.x + bb.w > box.x - 4 && bb.y < box.y + box.h + 4 && bb.y + bb.h > box.y - 4; });
  const plotGrid = new Map<string, Ring[]>();
  const PG = 12;
  for (const r of plots) {
    const bb = bboxOf(r);
    for (let gx = Math.floor((bb.x - 3) / PG); gx <= Math.floor((bb.x + bb.w + 3) / PG); gx++) for (let gy = Math.floor((bb.y - 3) / PG); gy <= Math.floor((bb.y + bb.h + 3) / PG); gy++) {
      const key = `${gx},${gy}`;
      (plotGrid.get(key) ?? plotGrid.set(key, []).get(key)!).push(r);
    }
  }
  /** Depth into the nearest plot (positive inside, negative outside, -9 when far from any). */
  const plotDepth = (p: Pt): number => {
    let best = -9;
    for (const r of plotGrid.get(`${Math.floor(p[0] / PG)},${Math.floor(p[1] / PG)}`) ?? []) {
      const d = ringDist(p, r);
      best = Math.max(best, inside(p, r) ? d : -d);
    }
    return best;
  };
  const shoreDist = (p: Pt): number => {
    let d = Infinity;
    for (const wr of city.water) if (!inside(p, wr)) d = Math.min(d, ringDist(p, wr));
    for (const rv of city.rivers) d = Math.min(d, Math.max(0, distToPolyline(p, rv.points) - rv.width / 2));
    return d;
  };
  const n1 = noise2(plan.seed % 9973), n2 = noise2((plan.seed * 13) % 9931);
  if (ground) {
    const tex = [ground.grass, ground.cobble, ground.dirt, ground.mud].map((t) => use(t)!.res);
    b.paintTerrain(tex, (tx, ty) => {
      const p: Pt = [ar.x + ((tx + 0.5) / 4) * M_PER_SQUARE, ar.y + ((ty + 0.5) / 4) * M_PER_SQUARE];
      const patch = smoothstep(0.52, 0.78, n1(p[0] / 9, p[1] / 9));
      const speck = n2(p[0] / 2.5, p[1] / 2.5);
      const depth = plotDepth(p);
      const road = Math.min(...city.roads.map((r) => distToPolyline(p, r.points) - r.width / 2), 99);
      const shore = shoreDist(p);
      let grass = 1, cob = 0, dirt = 0, mud = 0;
      if (insideWalls(p)) {
        // Cobbled streets, fading over a metre and a half into each yard; worn patches in both.
        const intoYard = depth > 0 ? smoothstep(0, 1.6, depth) : 0;
        cob = 1 - intoYard;
        // Worn streets: mud showing between the stones in patches, thicker along the house fronts.
        const worn = smoothstep(0.45, 0.75, n1(p[0] / 4 + 31, p[1] / 4 + 17)) * 0.55 + (depth > -1.2 && depth <= 0 ? 0.25 : 0);
        dirt = cob * worn + intoYard * (0.25 + 0.45 * patch) * (depth < 2.5 ? 1.3 : 1);
        cob = cob * (1 - worn * 0.6);
        grass = Math.max(0, intoYard - dirt * 0.9);
      } else {
        const nearHouse = depth > -1.8 ? (depth > 0 ? 0.35 + 0.35 * patch : 0.6 * (1 - -depth / 1.8)) : 0;
        // The road itself is trodden dirt with a ragged edge; the verge wears off over a few metres.
        const onRoad = road < 0 ? 1 : road < 2.5 ? 1 - road / 2.5 + (speck - 0.5) * 0.4 : 0;
        dirt = Math.min(1, Math.max(nearHouse, onRoad, patch * 0.45) + (speck - 0.5) * 0.15);
        grass = 1 - dirt;
      }
      if (shore < 3.5) mud = (1 - shore / 3.5) * 0.85;
      const tot = Math.max(1e-6, grass + cob + dirt + mud);
      return [(255 * grass) / tot, (255 * cob) / tot, (255 * dirt) / tot, (255 * mud) / tot];
    });
  } else if (st.terrain.length) {
    const tex = st.terrain.map((t) => use(t)!.res);
    while (tex.length < 4) tex.push(tex[tex.length - 1]!);
    b.paintTerrain(tex, () => [255, 0, 0, 0]);
  }
  // Without the cobbled terrain, the town is paved with a cobble pattern as before.
  if (!ground && cobble && wall) {
    const r = clipRing(wall.ring, box).map(sq);
    if (r.length >= 3) elements[b.addPattern({ points: r.map(px), texture: cobble.res })] = { kind: "floor", key: "cobbles", zone: zoneId, asset: cobble.id };
  }

  // Fields: wheat or fallow, rows along the field, a hedge or a dry-stone wall round it.
  const fieldTex = [streetFieldTex(cat, /^Texture - Wheat - 20x20$/), streetFieldTex(cat, /^Texture - Fallow 1 - 15x15$/), streetFieldTex(cat, /^Texture - Fallow 2 - 15x15$/)].filter((a): a is AssetRecord => !!a);
  const hedge = cat.index.assets.find((a) => a.kind === "path" && a.name === "Hedge_path" && /Hedge Maze/.test(cat.packs.get(a.pack)?.name ?? ""));
  const stoneWall = cat.index.assets.find((a) => a.kind === "path" && a.name === "Path - Stone Wall" && /Farmer's Field/.test(cat.packs.get(a.pack)?.name ?? ""));
  for (const [i, f] of city.fields.entries()) {
    const r = clipRing(f, box).map(sq);
    if (r.length < 3 || ringArea(r) < 4) continue;
    const t = fieldTex.length ? use(fieldTex[(i * 7 + 3) % fieldTex.length])! : undefined;
    const fr = fieldFrame(f);
    if (t) elements[b.addPattern({ points: r.map(px), texture: t.res, rotation: Number(fr.toFixed(5)), layer: 100 })] = { kind: "floor", key: `field#${i}`, zone: zoneId, asset: t.id };
    const edge = use(i % 3 === 0 ? stoneWall ?? hedge : hedge ?? stoneWall);
    if (edge) {
      const ring = f.map(sq);
      for (let j = 0; j < ring.length; j++) for (const seg of clipPolyline([ring[j]!, ring[(j + 1) % ring.length]!], w, h)) {
        if (Math.hypot(seg[1]![0] - seg[0]![0], seg[1]![1] - seg[0]![1]) < 0.5) continue;
        elements[b.addPath({ points: seg.map(px), texture: edge.res, width: S * (edge === hedge ? 1 : 0.8), layer: 300 })] = { kind: "path", key: `field#${i}/edge`, zone: zoneId };
      }
    }
    // Fields are no place for props.
    const bb = bboxOf(r);
    for (let yy = Math.floor(bb.y); yy < bb.y + bb.h; yy += 0.5) for (let xx = Math.floor(bb.x); xx < bb.x + bb.w; xx += 0.5) if (inside([xx + 0.25, yy + 0.25], r as Ring)) grid.mark({ x: xx, y: yy, w: 0.5, h: 0.5 }, Cell.Wall);
  }

  for (const [i, s] of city.squares.entries()) {
    const r = clipRing(s, box).map(sq);
    if (r.length >= 3 && flag) elements[b.addPattern({ points: r.map(px), texture: flag.res })] = { kind: "floor", key: `square#${i}`, zone: zoneId, asset: flag.id };
  }

  // Water: the sea and rivers, as water patterns.
  const waters = cat.ofUse("water", "river").filter((a) => (a.kind === "pattern" || a.kind === "terrain") && !/acid|underdark|cave|hot spring|lava|badlands|desert/i.test(a.name));
  const waterTex = use(waters.find((a) => /River Water Surface|Ocean, storm/i.test(a.name)) ?? waters.filter((a) => (a.look?.meanLab[0] ?? 50) > 35 && (a.look?.meanLab[0] ?? 50) < 62).sort((a, c) => a.id.localeCompare(c.id))[0] ?? waters[0]);
  const waterRings: Ring[] = [];
  for (const wr of city.water) waterRings.push(clipRing(wr, box));
  for (const rv of city.rivers) for (const rr of strokeRects(rv.points.map((p) => p as Vec), rv.width)) waterRings.push(clipRing(rr as Ring, box));
  if (waterTex) for (const [i, r0] of waterRings.entries()) {
    const r = r0.map(sq);
    if (r.length >= 3) elements[b.addPattern({ points: r.map(px), texture: waterTex.res, layer: 100 })] = { kind: "floor", key: `water#${i}`, zone: zoneId, asset: waterTex.id };
  }

  const pierEdge = use(cat.ofUse("wall_wood").filter((a) => a.kind === "wall" && (a.mat?.fit ?? 0) >= 2 && (a.footprint?.[1] ?? 1) < 0.45 && (a.look?.meanLab[0] ?? 50) < 40 && !/ruin|fence|isometric|jail/i.test(a.name)).sort((a, c) => a.id.localeCompare(c.id))[0]);

  // Quays: a stone edge where the land meets the sea and along both river banks.
  const quay = use(cat.ofUse("wall_stone", "wall_castle").filter((a) => a.kind === "wall" && (a.mat?.fit ?? 0) >= 2 && (a.footprint?.[1] ?? 0) >= 0.3 && (a.footprint?.[1] ?? 0) <= 0.75 && (a.look?.meanLab[0] ?? 50) > 35 && !/ruin|fence|cliff|crenel|isometric|jail|brick|wood|dark/i.test(a.name)).sort((a, c) => a.id.localeCompare(c.id))[0]);
  if (quay) {
    const shore: Vec[][] = [];
    const banks: Vec[][] = [];
    for (const wr of city.water) {
      const ring = wr.map(sq);
      for (let j = 0; j < ring.length; j++) shore.push(...clipPolyline([ring[j]!, ring[(j + 1) % ring.length]!], w, h));
    }
    for (const rv of city.rivers) for (const side of [1, -1]) banks.push(...clipPolyline(offsetLine(rv.points.map(sq), (side * rv.width * k) / 2), w, h));
    const inSea = (p: Vec) => city.water.some((wr) => inside([ar.x + p[0] * M_PER_SQUARE, ar.y + p[1] * M_PER_SQUARE], wr));
    // Pieces of river bank out in the sea are dropped.
    for (const line of banks) {
      let cur: Vec[] = [];
      for (let j = 0; j < line.length; j++) {
        if (j > 0 && inSea([(line[j]![0] + line[j - 1]![0]) / 2, (line[j]![1] + line[j - 1]![1]) / 2])) { if (cur.length > 1) shore.push(cur); cur = []; continue; }
        if (!cur.length && j > 0) cur.push(line[j - 1]!);
        cur.push(line[j]!);
      }
      if (cur.length > 1) shore.push(cur);
    }
    for (const [i, keep] of shore.entries()) {
      if (keep.length < 2 || Math.hypot(keep[keep.length - 1]![0] - keep[0]![0], keep[keep.length - 1]![1] - keep[0]![1]) < 0.5) continue;
      const res = b.addWall({ points: keep.map(px), texture: quay.res });
      elements[res.id] = { kind: "wall", key: `quay#${i}` };
    }
  }

  // Main roads: cobbled paths on top of the ground.
  if (st.road) use(st.road);
  for (const [i, road] of ground ? [] : city.roads.entries()) {
    for (const part of clipPolyline(road.points.map(sq), w, h)) {
      const tex = cobble ? st.road : st.road;
      if (!tex) continue;
      const id = b.addPath({ points: part.map(px), texture: tex.res, width: S * Math.max(2, road.width * k * 0.9), layer: -400 });
      elements[id] = { kind: "path", key: `road#${i}`, zone: zoneId };
    }
  }
  // Piers and bridges: deck boards laid across the walk, a dark timber edge round them.
  const plank = use(cat.search(/^sailingship_exterior deck/i, "pattern")[0] ?? cat.ofUse("floor_wood").filter((a) => a.kind === "pattern" && /floorboards a - 6x6/i.test(a.name))[0] ?? cat.ofUse("floor_wood").filter((a) => a.kind === "pattern")[0]);
  for (const [i, pl] of city.planks.entries()) {
    const pts = pl.points;
    for (let j = 0; j + 1 < pts.length; j++) {
      const rr = strokeRects([pts[j] as Vec, pts[j + 1] as Vec], pl.width)[0];
      if (!rr) continue;
      const r = clipRing(rr as Ring, box).map(sq);
      if (r.length < 3 || !plank) continue;
      const ang = Math.atan2(pts[j + 1]![1] - pts[j]![1], pts[j + 1]![0] - pts[j]![0]);
      elements[b.addPattern({ points: r.map(px), texture: plank.res, rotation: Number((ang + Math.PI / 2).toFixed(5)), layer: 200 })] = { kind: "floor", key: `pier#${i}`, zone: zoneId, asset: plank.id };
      const edge = b.addWall({ points: r.map(px), loop: true, texture: pierEdge?.res });
      elements[edge.id] = { kind: "wall", key: `pier#${i}/edge` };
      // Lanterns along the deck, every seven squares, on alternate sides.
      const lantern = streetLight("lantern", 0.8);
      const a0 = sq(pts[j] as Pt), a1 = sq(pts[j + 1] as Pt);
      const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
      const half = (pl.width * k) / 2 - 0.45;
      if (!lantern || len < 2 || half < 0.2) continue;
      const u: Vec = [(a1[0] - a0[0]) / len, (a1[1] - a0[1]) / len], v: Vec = [-u[1], u[0]];
      for (let t = 2, m = 0; t < len - 1; t += 7, m++) {
        const sd = (i + m) % 2 ? 1 : -1;
        const at: Vec = [a0[0] + u[0] * t + v[0] * half * sd, a0[1] + u[1] * t + v[1] * half * sd];
        if (at[0] > 0.5 && at[1] > 0.5 && at[0] < w - 0.5 && at[1] < h - 0.5) place(ctx, { asset: lantern, role: "lantern", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "pier_lights", occupy: "force", light: LIGHTS.lantern });
      }
    }
  }

  // The waterfront: a flagstone wharf four metres deep along the sea shore.
  const inWater = (p: Pt) => city.water.some((wr) => inside(p, wr));
  const wharves: Array<{ a: Pt; b: Pt; n: Pt }> = [];
  for (const wr of city.water) for (let j = 0; j < wr.length; j++) {
    const a = wr[j]!, q = wr[(j + 1) % wr.length]!;
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (len < 1) continue;
    const mid: Pt = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
    let n: Pt = [-(q[1] - a[1]) / len, (q[0] - a[0]) / len];
    if (inWater([mid[0] + n[0], mid[1] + n[1]])) n = [-n[0], -n[1]];
    const r = clipRing([a, q, [q[0] + n[0] * 4, q[1] + n[1] * 4], [a[0] + n[0] * 4, a[1] + n[1] * 4]], box).map(sq);
    if (r.length < 3 || !flag) continue;
    wharves.push({ a, b: q, n });
    elements[b.addPattern({ points: r.map(px), texture: flag.res })] = { kind: "floor", key: `wharf#${wharves.length}`, zone: zoneId, asset: flag.id };
  }

  // Buildings: a hip roof over the outline, walls around it, one door facing the street.
  const red = roofSet(cat, "red"), blue = roofSet(cat, "blue");
  const castle = city.districts.filter((d) => /castle|citadel|keep|palace/i.test(d.name));
  const chimney = use(cat.named("rooftops_chimney - 1x1", /Modular Rooftops/)[0]);
  const thin = cat.ofUse("wall_stone", "wall_wood", "wall_plaster").filter((a) => a.kind === "wall" && (a.mat?.fit ?? 0) >= 2 && (a.footprint?.[1] ?? 1) < 0.6 && !/ruin|fence|cliff|crenel|isometric|jail/i.test(a.name));
  // Dark outlines read as house walls under a roof; pale ones read as yellow borders.
  const houseWall = use(thin.filter((a) => (a.look?.meanLab[0] ?? 50) < 40).sort((a, c) => a.id.localeCompare(c.id))[0] ?? thin[0] ?? st.wall);
  const door = use(st.door);
  const nearIdx = city.buildings.map((_, k) => k).filter((k) => { const bb = bboxOf(city.buildings[k]!); return bb.x < box.x + box.w && bb.x + bb.w > box.x && bb.y < box.y + box.h && bb.y + bb.h > box.y; });
  const near = nearIdx.map((k) => city.buildings[k]!);
  const open = (p: Pt) => !near.some((o) => inside(p, o));
  const free = (at: Vec, sz = 0.6) => at[0] > 0.8 && at[1] > 0.8 && at[0] < w - 0.8 && at[1] < h - 0.8 && grid.fits(rectAt(at, [sz, sz]), (cv) => cv === Cell.Free);
  // Ground cover from one meadow set (Green Hill, Meadow Picnic, Roadside Forest, Farmer's Field,
  // Farm Friends): the same look in every town.
  const M = meadowSet(cat);
  type Menu = Array<[AssetRecord[], number]>;
  const BIG = new Set<AssetRecord[]>([M.bush, M.rocks, M.trees, M.logs]);
  /** A cluster of ground cover round `c`: `n` pieces within `radius` squares, inside `keep` when given. */
  const tuft = (c: Vec, menu: Menu, n: number, radius: number, feature: string, rr: Rng, keep?: Ring) => {
    const avail = menu.filter(([l]) => l.length);
    if (!avail.length) return;
    for (let i = 0, made = 0; i < n * 3 && made < n; i++) {
      const [list] = rr.weighted(avail, (x) => x[1]);
      const a = rr.pick(list);
      const d = radius * Math.sqrt(rr.next()), t = rr.next() * Math.PI * 2;
      const at: Vec = [c[0] + Math.cos(t) * d, c[1] + Math.sin(t) * d];
      if (at[0] < 0.5 || at[1] < 0.5 || at[0] > w - 0.5 || at[1] > h - 0.5 || (keep && !inside(at as Pt, keep))) continue;
      const big = BIG.has(list);
      const tree = list === M.trees;
      if (big ? !free(at, tree ? 1 : 0.7) : !grid.fits(rectAt(at, [0.3, 0.3]), (cv) => cv !== Cell.Wall)) continue;
      const pl = place(ctx, { asset: use(a)!, role: tree ? "tree" : big ? "bush" : "groundcover", at, rot: rr.range(0, Math.PI * 2), scale: list === M.grass ? rr.range(0.55, 0.8) : rr.range(0.85, 1.15), layer: tree ? LAYER.overhead : big ? LAYER.furniture : LAYER.decal, zone: zoneId, feature, occupy: tree ? "force" : big ? "solid" : "low", light: false });
      if (pl) made++;
      if (pl && tree) grid.mark(rectAt(at, [0.8, 0.8]), Cell.Solid);
    }
  };
  // 2MT houses: drawings laid into the plots, yards behind them; plots nothing fits keep a procedural roof.
  const art = opts.houses !== "roofs" ? placeHouses(city, houseArtFrom(cat.index), city.url) : undefined;
  const bare = new Set(art?.bare ?? nearIdx);

  // Buildings from inside (the default): a floor, windows, rooms and furniture where the roof was.
  const indoor = opts.interiors !== false ? indoorStyle(cat, plan, st, houseWall) : undefined;
  const windowTex = use(indoor?.window);
  const insideMap = (p: Vec, m = 0.6) => p[0] > m && p[1] > m && p[0] < w - m && p[1] < h - m;
  /** Window spots on a building's walls: on walls that face open ground, clear of the door and the corners. */
  const windowsOf = (ring: Vec[], doorAt: Vec | undefined, others: (p: Vec) => boolean, wr: Rng): Vec[] => {
    if (!windowTex) return [];
    const out: Vec[] = [];
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j]!, q = ring[(j + 1) % ring.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 2.6 || wr.next() < 0.25) continue;
      const u: Vec = [(q[0] - a[0]) / len, (q[1] - a[1]) / len];
      const mid: Vec = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
      // Outward is the side that is not inside the building.
      const nrm: Vec = inside([mid[0] - u[1] * 0.4, mid[1] + u[0] * 0.4] as Pt, ring as Ring) ? [u[1], -u[0]] : [-u[1], u[0]];
      const n = Math.max(1, Math.floor(len / 3.6));
      for (let k = 0; k < n; k++) {
        const t = (len * (k + 0.5)) / n;
        if (t < 0.9 || t > len - 0.9) continue;
        const p: Vec = [a[0] + u[0] * t, a[1] + u[1] * t];
        if (!insideMap(p, 0.8) || (doorAt && Math.hypot(p[0] - doorAt[0], p[1] - doorAt[1]) < 1.4)) continue;
        if (others([p[0] + nrm[0] * 0.7, p[1] + nrm[1] * 0.7])) continue;
        out.push(p);
      }
    }
    return out;
  };
  /** Buildings shown from inside: the weather stays out of them (roofed buildings get it on the roof). */
  const sheltered: Shelter[] = [];
  /** Floor, inner walls with doors and furniture for one building (`shape` is its wall line). */
  const furnish = (key: string, floorRing: Vec[], shape: Vec[], doorAt: Vec | undefined, kind: BuildingKind, trade?: Trade) => {
    if (!indoor) return;
    sheltered.push({ points: shape.map(([x, y]) => [x, y] as [number, number]) });
    const it = furnishBuilding({ key, shape, door: doorAt, kind, trade, plan, cat, style: indoor, zone: zoneId });
    const floor = use(indoor.floors[it.floor] ?? indoor.floors.wood ?? indoor.floors.stone);
    if (floor) elements[b.addPattern({ points: floorRing.map(px), texture: floor.res })] = { kind: "floor", key: `floor:${key}`, zone: zoneId, asset: floor.id };
    it.walls.forEach((wl, i) => {
      const ds = wl.doors.map((d, k) => ({ d, locked: !!wl.locked?.[k] })).filter((x) => insideMap(x.d));
      const res = b.addWall({ points: [px(wl.a), px(wl.b)], texture: houseWall?.res, doors: door ? ds.map((x) => ({ at: px(x.d), texture: door.res, width: 1 })) : [] });
      elements[res.id] = { kind: "wall", key: `${key}/wall#${i}` };
      res.doors.forEach((nid, k) => (elements[nid] = { kind: "door", key: `door:${key}/wall#${i}`, zone: zoneId, state: ds[k]?.locked ? "locked" : "closed" }));
    });
    for (const p of it.placed) {
      const c = p.center ?? [p.x, p.y];
      if (!insideMap(c as Vec, 0.3)) continue;
      use(p.asset);
      ctx.placed.push(p);
    }
    notes.push(`${key}: ${it.rooms.join(", ")}${trade ? ` (${trade})` : ""}`);
  };

  if (art) {
    // Yards are painted into the ground (above); a yard pattern only without the town ground set.
    const yard = ground ? undefined : use(cat.search(/^Texture - Grass - 10x10 - Sodden$/, "pattern", /Grass & Road Assets 2/)[0] ?? cat.search(/^Texture - Dirt - 10x10$/, "pattern", /Grass & Road Assets 2/)[0]);
    for (const [i, bd] of near.entries()) {
      const r = clipRing(bd, box).map(sq);
      if (r.length >= 3 && yard && !bare.has(nearIdx[i]!)) elements[b.addPattern({ points: r.map(px), texture: yard.res, color: "ffd0d0c4" })] = { kind: "floor", key: `yard#${i}`, zone: zoneId, asset: yard.id };
    }
    const inMap = (p: Vec) => p[0] > -2 && p[1] > -2 && p[0] < w + 2 && p[1] < h + 2;
    // Every building's outline here, to keep windows off walls that face a neighbour.
    // Shops: in each shop plot, the biggest house keeps the shop (the same house on every map).
    const shopOf = new Map<number, Trade>();
    for (const [plot, trade] of art.places.shops) {
      let best = -1, size = 0;
      art.houses.forEach((hs, k) => {
        const s = ringArea(hs.walls ?? hs.ring);
        if (hs.plot === plot && !hs.landmark && s > size + 1e-6) [best, size] = [k, s];
      });
      if (best >= 0) shopOf.set(best, trade);
    }
    const outlines = art.houses.map((hs) => (hs.landmark === "spire" ? [] : (hs.walls ?? hs.ring).map(sq)));
    const boxes = outlines.map((o) => (o.length ? bboxOf(o) : undefined));
    const builtAt = (p: Vec, except: number) => outlines.some((o, j) => j !== except && boxes[j] && p[0] >= boxes[j]!.x && p[1] >= boxes[j]!.y && p[0] <= boxes[j]!.x + boxes[j]!.w && p[1] <= boxes[j]!.y + boxes[j]!.h && inside(p as Pt, o as Ring));
    for (const [n, hs] of art.houses.entries()) {
      const ring = hs.ring.map(sq);
      if (!ring.some(inMap)) continue;
      // A spire sits on its chapel's roof: no walls of its own, and nothing to show from inside.
      if (indoor && hs.landmark === "spire") continue;
      if (!indoor) place(ctx, { asset: use(hs.art.asset)!, role: hs.landmark ?? "house", at: sq(hs.at), rot: hs.rot, scale: hs.scale, layer: LAYER.overhead, zone: zoneId, feature: hs.landmark ? "landmarks" : "houses", occupy: "force", light: false });
      if (hs.landmark === "spire") continue;
      // Walls just inside the drawing's own outline (its box when untraced), for Foundry; a door on
      // the wall nearest the middle of the street side.
      const shape = (hs.walls ?? hs.ring).map(sq);
      const m: Vec = [shape.reduce((a, p) => a + p[0], 0) / shape.length, shape.reduce((a, p) => a + p[1], 0) / shape.length];
      const inner = shape.map((p) => { const d = Math.hypot(m[0] - p[0], m[1] - p[1]) || 1; const k2 = Math.min(0.15, 0.1 / d * 3); return [p[0] + (m[0] - p[0]) * k2, p[1] + (m[1] - p[1]) * k2] as Vec; });
      const fm = sq([(hs.front[0][0] + hs.front[1][0]) / 2, (hs.front[0][1] + hs.front[1][1]) / 2]);
      // Door spots: the middle of each wall long enough for a door.
      const walls = inner.map((p, j) => {
        const q = inner[(j + 1) % inner.length]!, len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const mid: Vec = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const nrm: Vec = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
        // The side of the wall that is not the house.
        const out: Vec = inside([mid[0] + nrm[0] * 0.4, mid[1] + nrm[1] * 0.4] as Pt, inner as Ring) ? [-nrm[0], -nrm[1]] : nrm;
        return { p: mid, len, out };
      }).filter((e) => e.len >= 1.4);
      const mids = walls.map((e) => e.p);
      const near = (list: Vec[]) => list.reduce((best, p) => (Math.hypot(p[0] - fm[0], p[1] - fm[1]) < Math.hypot(best[0] - fm[0], best[1] - fm[1]) ? p : best), list[0]!);
      let doorAt = mids.length ? near(mids) : fm;
      let inside0 = mids.length > 0 && insideMap(doorAt);
      // A building cut by the map's edge whose street door is off the map: the door goes on the
      // nearest wall that is on the map and opens onto free ground, so the party can get in.
      if (mids.length && !inside0 && indoor) {
        const open = walls.filter((e) => insideMap(e.p) && !builtAt([e.p[0] + e.out[0] * 0.7, e.p[1] + e.out[1] * 0.7], n)).map((e) => e.p);
        if (open.length) [doorAt, inside0] = [near(open), true];
      }
      const wins = indoor ? windowsOf(inner, mids.length ? doorAt : undefined, (p) => builtAt(p, n), new Rng(`${plan.seed}:windows:${n}`)) : [];
      const res = b.addWall({
        points: inner.map(px), loop: true, texture: houseWall?.res,
        doors: [...(door && inside0 ? [{ at: px(doorAt), texture: door.res, width: 1 }] : []), ...wins.map((p) => ({ at: px(p), texture: windowTex!.res, width: 1, closed: true }))],
      });
      elements[res.id] = { kind: "wall", key: `house#a${n}` };
      houseWalls.push(inner);
      if (door && inside0) doorSpots.push(doorAt);
      const nDoor = door && inside0 ? 1 : 0;
      res.doors.forEach((nid, k) => (elements[nid] = k < nDoor ? { kind: "door", key: `door:house#a${n}`, zone: zoneId, state: "closed" } : { kind: "window", key: `window:house#a${n}#${k - nDoor}`, zone: zoneId }));
      furnish(`house#a${n}`, shape, inner, mids.length ? doorAt : undefined, kindOf(hs.art.role, hs.landmark), shopOf.get(n));
      const trade = shopOf.get(n);
      const lamps = hs.landmark ? (DOOR_LAMPS[hs.landmark] ?? 0) : trade && !TRADES[trade].secret ? 1 : 0;
      const doorWall = lamps && door && inside0 ? walls.find((e) => e.p === doorAt) : undefined;
      if (doorWall) doorLamps.push({ at: doorAt, out: doorWall.out, n: lamps });
      const bb = bboxOf(shape);
      for (let yy = Math.floor(bb.y); yy < bb.y + bb.h; yy += 0.25) for (let xx = Math.floor(bb.x); xx < bb.x + bb.w; xx += 0.25) {
        if (inside([xx + 0.125, yy + 0.125], shape as Ring)) grid.mark({ x: xx, y: yy, w: 0.25, h: 0.25 }, Cell.Wall);
      }
    }
  }
  if (art) {
    // Yards: a kitchen garden, a woodpile, hay and animals out in the country, crates and barrels
    // in town; grass tufts and flowers in clusters, the way 2MT dresses its own yards.
    const tufts: Menu = [[M.grass, 5], [M.flowers, 3], [M.clover, 2], [M.bush, 0.8], [M.leaves, 0.7], [M.stones, 0.5]];
    for (const [i, bd] of near.entries()) {
      if (bare.has(nearIdx[i]!)) continue;
      const r = clipRing(bd, box).map(sq) as Ring;
      if (r.length < 3) continue;
      const bb = bboxOf(r);
      const yrng = new Rng(`${plan.seed}:yard:${nearIdx[i]}`);
      const country = !insideWalls(centroid(bd));
      const spot = (): Vec | undefined => {
        for (let t = 0; t < 12; t++) {
          const at: Vec = [bb.x + yrng.range(0.6, bb.w - 0.6), bb.y + yrng.range(0.6, bb.h - 0.6)];
          if (inside(at as Pt, r) && free(at, 1)) return at;
        }
        return undefined;
      };
      const room = ringArea(r);
      // A kitchen garden: two or three short rows of the same crop.
      if (room > 40 && yrng.next() < (country ? 0.45 : 0.3)) {
        const at = spot(), crop = pick(ctx, zoneId, "crops", { maxSide: 1.6 }, yrng);
        if (at && crop) {
          const ang = yrng.range(0, Math.PI);
          const u: Vec = [Math.cos(ang), Math.sin(ang)], v: Vec = [-u[1], u[0]];
          for (let row = 0; row < yrng.int(2, 3); row++) for (let c = 0; c < yrng.int(3, 4); c++) {
            const p: Vec = [at[0] + u[0] * c * 0.9 + v[0] * row * 1.1, at[1] + u[1] * c * 0.9 + v[1] * row * 1.1];
            if (inside(p as Pt, r) && free(p, 0.5)) place(ctx, { asset: crop, role: "crops", at: p, rot: ang + yrng.range(-0.2, 0.2), layer: LAYER.decal, zone: zoneId, feature: "garden", occupy: "low", light: false });
          }
        }
      }
      const things: Array<[string, number]> = country ? [["woodpile", 2], ["haystack", 1.5], ["barrel", 0.5], ["cart", 0.5]] : [["woodpile", 1.5], ["barrel", 2], ["crate", 2], ["sack", 1]];
      for (let n = 0; n < Math.min(3, Math.round(room / 70)); n++) {
        const at = spot();
        const got = at ? pickWeighted(ctx, zoneId, things, { maxSide: 3 }, yrng) : undefined;
        if (at && got) place(ctx, { asset: got.asset, role: got.role, at, rot: yrng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "yards", occupy: "solid", light: false });
      }
      for (let n = 0; n < Math.max(1, Math.round(room / 35)); n++) {
        const at = spot();
        if (at) tuft(at, tufts, yrng.int(2, 4), yrng.range(0.8, 1.8), "yard_green", yrng, r);
      }
      // Farm animals in country yards, a hen or a dog now and then in town.
      const beasts = country ? M.farmAnimals : M.townAnimals;
      if (beasts.length && yrng.next() < (country ? 0.5 : 0.15)) {
        const at = spot();
        if (at) for (let n = 0; n < (country ? yrng.int(1, 3) : 1); n++) {
          const p: Vec = [at[0] + yrng.range(-0.8, 0.8), at[1] + yrng.range(-0.8, 0.8)];
          if (inside(p as Pt, r) && free(p, 0.4)) place(ctx, { asset: use(yrng.pick(beasts))!, role: "animal", at: p, rot: yrng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "animals", occupy: "solid", light: false });
        }
      }
    }
  }

  // Plots drawn without house art keep their shops too.
  const plotShops = indoor ? (art?.places ?? cityPlaces(city)).shops : new Map<number, Trade>();
  for (const [i, bd] of near.entries()) {
    if (!bare.has(nearIdx[i]!)) continue;
    const clipped = clipRing(bd, box);
    if (clipped.length < 3 || ringArea(clipped) < 2) continue;
    const r = clipped.map(sq);
    const c = centroid(bd);
    // Red slate for houses; blue slate for the castle and the great buildings.
    const set = castle.some((d) => inside(c, d.ring)) || ringArea(bd) > 380 ? blue ?? red : red ?? blue;
    // Seen from inside, the plot gets no roof.
    if (set && !indoor) {
      for (const k of ["tiles", "ridge", "hip"] as const) use(set[k]);
      const roof = hipRoof(bd);
      for (const f of roof.faces) {
        const fr = clipRing(f.ring, box).map(sq);
        if (fr.length < 3) continue;
        const g = Math.round(255 * faceLight(f)).toString(16).padStart(2, "0");
        // Tile rows run along the eave, the shingles' lower edges toward it.
        const rot = Math.atan2(f.down[1], f.down[0]) - Math.PI / 2;
        elements[b.addPattern({ points: fr.map(px), texture: set.tiles.res, rotation: Number(rot.toFixed(5)), color: `ff${g}${g}${g}`, layer: ROOF_LAYER })] = { kind: "floor", key: `roof#${i}`, zone: zoneId, asset: set.tiles.id };
      }
      for (const [part, lines, wd] of [["hip", roof.hips, 0.2], ["ridge", roof.ridges, 0.26]] as const) {
        for (const [p0, p1] of lines) for (const seg of clipPolyline([sq(p0), sq(p1)], w, h)) {
          if (Math.hypot(seg[1]![0] - seg[0]![0], seg[1]![1] - seg[0]![1]) < 0.1) continue;
          elements[b.addPath({ points: seg.map(px), texture: set[part].res, width: S * wd, layer: ROOF_LAYER })] = { kind: "path", key: `roof#${i}/${part}`, zone: zoneId };
        }
      }
      // A chimney on about half the bigger houses, up by the ridge of the longest face.
      const big = roof.faces.reduce<RoofFace | undefined>((m, f) => (!m || seglen(f.eave) > seglen(m.eave) ? f : m), undefined);
      if (chimney && big && ringArea(bd) > 55 && rng.next() < 0.55) {
        const mid: Pt = [(big.eave[0][0] + big.eave[1][0]) / 2, (big.eave[0][1] + big.eave[1][1]) / 2];
        const fc = centroid(big.ring);
        const t = rng.range(-0.3, 0.3);
        const at = sq([mid[0] + (fc[0] - mid[0]) * 1.35 + (big.eave[1][0] - big.eave[0][0]) * t * 0.5, mid[1] + (fc[1] - mid[1]) * 1.35 + (big.eave[1][1] - big.eave[0][1]) * t * 0.5]);
        if (at[0] > 0.5 && at[1] > 0.5 && at[0] < w - 0.5 && at[1] < h - 0.5 && inside(at as Pt, r as Ring)) {
          place(ctx, { asset: chimney, role: "chimney", at, rot: Math.atan2(big.down[1], big.down[0]) - Math.PI / 2, layer: LAYER.overhead, zone: zoneId, feature: "chimneys", occupy: "force", light: false });
        }
      }
    }
    // The door goes on the longest edge that faces open street.
    let best: { at: Vec; len: number; out: Vec } | undefined;
    for (let j = 0; j < r.length; j++) {
      const a = r[j]!, q = r[(j + 1) % r.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 2.2) continue;
      const mid: Vec = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
      if (mid[0] < 0.6 || mid[1] < 0.6 || mid[0] > w - 0.6 || mid[1] > h - 0.6) continue;
      const nx = -(q[1] - a[1]) / len, ny = (q[0] - a[0]) / len;
      const probe = (s: number): Pt => [ar.x + (mid[0] + nx * s) * M_PER_SQUARE, ar.y + (mid[1] + ny * s) * M_PER_SQUARE];
      const outside = open(probe(1.5)) && !inside(probe(1.5), bd) ? 1 : open(probe(-1.5)) && !inside(probe(-1.5), bd) ? -1 : 0;
      if (!outside) continue;
      if (!best || len > best.len) best = { at: mid, len, out: [nx * outside, ny * outside] };
    }
    const others = (p: Vec) => !open([ar.x + p[0] * M_PER_SQUARE, ar.y + p[1] * M_PER_SQUARE]);
    const wins = indoor ? windowsOf(r, best?.at, others, new Rng(`${plan.seed}:windows:p${i}`)) : [];
    const res = b.addWall({
      points: r.map(px), loop: true, texture: houseWall?.res,
      doors: [...(best && door ? [{ at: px(best.at), texture: door.res, width: 1 }] : []), ...wins.map((p) => ({ at: px(p), texture: windowTex!.res, width: 1, closed: true }))],
    });
    elements[res.id] = { kind: "wall", key: `house#${i}` };
    houseWalls.push(r);
    if (best && door) doorSpots.push(best.at);
    const nDoor = best && door ? 1 : 0;
    res.doors.forEach((nid, k) => (elements[nid] = k < nDoor ? { kind: "door", key: `door:house#${i}`, zone: zoneId, state: "closed" } : { kind: "window", key: `window:house#${i}#${k - nDoor}`, zone: zoneId }));
    const plotKind = castle.some((d) => inside(c, d.ring)) && ringArea(bd) > 150 ? "keep" : "house";
    const plotTrade = plotShops.get(nearIdx[i]!);
    furnish(`house#${i}`, r, r, best?.at, plotKind, plotTrade);
    const plotLamps = plotKind === "keep" ? 2 : plotTrade && !TRADES[plotTrade].secret ? 1 : 0;
    if (plotLamps && best && door) doorLamps.push({ at: best.at, out: best.out, n: plotLamps });
    // Buildings are solid for the dressing grid.
    const bb = bboxOf(r);
    for (let yy = Math.floor(bb.y); yy < bb.y + bb.h; yy += 0.25) for (let xx = Math.floor(bb.x); xx < bb.x + bb.w; xx += 0.25) {
      if (inside([xx + 0.125, yy + 0.125], r as Ring)) grid.mark({ x: xx, y: yy, w: 0.25, h: 0.25 }, Cell.Wall);
    }
  }

  // The city wall: thick stone with round towers, open gates where roads pass.
  if (wall) {
    const castleTex = use(cat.ofUse("wall_castle", "wall_stone").filter((a) => a.kind === "wall" && (a.footprint?.[1] ?? 0) >= 0.7).sort((a, c) => (b2(c) - b2(a)) || a.id.localeCompare(c.id))[0] ?? st.wall);
    const ring = wall.ring.map(sq);
    const gates: Vec[] = [];
    const gateDirs: Vec[] = [];
    for (const road of city.roads) for (let i = 0; i + 1 < road.points.length; i++) for (let j = 0; j < ring.length; j++) {
      const p = ring[j]!, q = ring[(j + 1) % ring.length]!;
      const hit = segCross(sq(road.points[i]!), sq(road.points[i + 1]!), p, q);
      if (!hit) continue;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      gates.push(hit);
      gateDirs.push([(q[0] - p[0]) / len, (q[1] - p[1]) / len]);
    }
    const halfGate = (city.roadWidth * k) / 2 + 0.6;
    // Walk the ring, cutting it into runs at gates and at the map border.
    const n = ring.length;
    for (let j = 0; j < n; j++) {
      const a = ring[j]!, q = ring[(j + 1) % n]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 1e-6) continue;
      const u: Vec = [(q[0] - a[0]) / len, (q[1] - a[1]) / len];
      const cuts = gates.map((g) => ((g[0] - a[0]) * u[0] + (g[1] - a[1]) * u[1])).filter((t, gi) => t > -halfGate && t < len + halfGate && Math.abs((gates[gi]![0] - a[0]) * u[1] - (gates[gi]![1] - a[1]) * u[0]) < 0.5).map((t) => [t - halfGate, t + halfGate] as [number, number]).sort((x, y) => x[0] - y[0]);
      let t0 = 0;
      const pieces: Array<[number, number]> = [];
      for (const [c0, c1] of cuts) { if (c0 > t0) pieces.push([t0, c0]); t0 = Math.max(t0, c1); }
      if (t0 < len) pieces.push([t0, len]);
      for (const [p0, p1] of pieces) {
        const seg = clipPolyline([[a[0] + u[0] * p0, a[1] + u[1] * p0], [a[0] + u[0] * p1, a[1] + u[1] * p1]], w, h);
        for (const part of seg) {
          if (Math.hypot(part[1]![0] - part[0]![0], part[1]![1] - part[0]![1]) < 0.3) continue;
          const res = b.addWall({ points: part.map(px), texture: castleTex?.res });
          elements[res.id] = { kind: "wall", key: `citywall#${j}` };
        }
      }
    }
    // Round towers at the corners; at a gate, two towers flank the opening instead.
    const tower = use(cat.named("Tower, round, roof (6x6)", /Castle Walls/i)[0] ?? cat.named("Gatehouse, tower, roof (4x4)")[0]);
    const towerAt: Vec[] = [];
    for (let j = 0; j < ring.length; j++) {
      const v = ring[j]!;
      const g = gates.find((x) => Math.hypot(x[0] - v[0], x[1] - v[1]) < halfGate + city.towerRadius * k);
      if (!g) { towerAt.push(v); continue; }
      for (const nb of [ring[(j + ring.length - 1) % ring.length]!, ring[(j + 1) % ring.length]!]) {
        const len = Math.hypot(nb[0] - g[0], nb[1] - g[1]) || 1;
        const off = halfGate + city.towerRadius * k * 0.75;
        if (len > off) towerAt.push([g[0] + ((nb[0] - g[0]) / len) * off, g[1] + ((nb[1] - g[1]) / len) * off]);
      }
    }
    if (tower) for (const v of towerAt) {
      if (v[0] < -3 || v[1] < -3 || v[0] > w + 3 || v[1] > h + 3) continue;
      const scale = (city.towerRadius * 2 * k) / Math.max(...tower.footprint!);
      place(ctx, { asset: tower, role: "tower", at: v, rot: rng.int(0, 3) * (Math.PI / 2), scale, layer: LAYER.overhead, zone: zoneId, feature: "towers", occupy: "force", light: false });
      grid.mark(rectAt(v, [city.towerRadius * 2 * k, city.towerRadius * 2 * k]), Cell.Wall);
    }
    // Braziers flank each gate on either side of the road: just inside the wall, or in front of it when a gatehouse fills the inside.
    const town: Vec = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    gates.forEach((g, gi) => {
      if (g[0] < 1 || g[1] < 1 || g[0] > w - 1 || g[1] > h - 1) return;
      if (gates.slice(0, gi).some((o) => Math.hypot(o[0] - g[0], o[1] - g[1]) < 1)) return;
      const fire = streetLight("brazier", 1.4);
      if (!fire) return;
      const d = gateDirs[gi]!;
      let nrm: Vec = [-d[1], d[0]];
      if ((town[0] - g[0]) * nrm[0] + (town[1] - g[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
      // At the roadside (the road is path, which a brazier may stand on), stepping back from the wall until there is room.
      for (const face of [1, -1]) {
        let placed2 = 0;
        for (const sgn of [-1, 1]) {
          let done = false;
          for (const depth of [1.6, 2.4, 3.2, 4.2, 5.4, 6.6]) for (const side of [halfGate - 0.2, halfGate + 0.5]) {
            if (done) break;
            const at: Vec = [g[0] + d[0] * sgn * side + nrm[0] * depth * face, g[1] + d[1] * sgn * side + nrm[1] * depth * face];
            done = !!place(ctx, { asset: fire, role: "brazier", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "gate_fires", occupy: "clutter", light: LIGHTS.brazier });
          }
          if (done) placed2++;
        }
        if (placed2) break;
      }
    });
  }

  // Wall bands and water are off limits for props.
  for (const r0 of waterRings) {
    const r = r0.map(sq);
    if (r.length < 3) continue;
    const bb = bboxOf(r);
    for (let yy = Math.floor(bb.y); yy < bb.y + bb.h; yy += 0.5) for (let xx = Math.floor(bb.x); xx < bb.x + bb.w; xx += 0.5) if (inside([xx + 0.25, yy + 0.25], r)) grid.mark({ x: xx, y: yy, w: 0.5, h: 0.5 }, Cell.Wall);
  }

  // Ships and barges from the city's harbour layout (houses.ts), rope coils on the piers, cargo
  // piled on the wharf. Without house art, a few skiffs tie up instead.
  const ropes = cat.search(/^shipyard_rope \d$/);
  const inMapBox = (ring: Ring) => ring.some((p) => { const q = sq(p); return q[0] > -1 && q[1] > -1 && q[0] < w + 1 && q[1] < h + 1; });
  const boats = (art?.extras ?? []).filter((e) => /^(ship_|barge)/.test(e.landmark ?? ""));
  for (const e of boats) {
    if (!inMapBox(e.ring)) continue;
    place(ctx, { asset: use(e.art.asset)!, role: e.landmark!, at: sq(e.at), rot: e.rot, scale: e.scale, layer: LAYER.furniture, zone: zoneId, feature: "ships", occupy: "force", light: false });
  }
  const skiff = art ? undefined : cat.named("junglewetland_skiff, row boat")[0];
  for (const pl of city.planks) for (let j = 0; j + 1 < pl.points.length; j++) {
    const a = pl.points[j]!, q = pl.points[j + 1]!;
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (len < 6) continue;
    const u: Pt = [(q[0] - a[0]) / len, (q[1] - a[1]) / len], n: Pt = [-u[1], u[0]];
    const along = Math.atan2(u[1], u[0]);
    for (const [t, side] of [[0.45, 1], [0.8, -1], [0.7, 1]] as const) {
      if (!skiff || rng.next() < 0.3) continue;
      const off = pl.width / 2 + 1.2;
      const at: Pt = [a[0] + u[0] * len * t + n[0] * side * off, a[1] + u[1] * len * t + n[1] * side * off];
      const p = sq(at);
      if (!inWater(at) || p[0] < 1 || p[1] < 1 || p[0] > w - 1 || p[1] > h - 1) continue;
      place(ctx, { asset: use(skiff)!, role: "boat", at: p, rot: along - Math.PI / 2 + rng.range(-0.08, 0.08), layer: LAYER.furniture, zone: zoneId, feature: "boats", occupy: "force", light: false });
    }
    if (ropes.length) {
      const at = sq([a[0] + u[0] * len * 0.6, a[1] + u[1] * len * 0.6]);
      if (at[0] > 1 && at[1] > 1 && at[0] < w - 1 && at[1] < h - 1) place(ctx, { asset: rng.pick(ropes), role: "rope", at, rot: rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "pier_gear", occupy: "force", light: false });
    }
  }
  // The lighthouse and windmills, with walls round the lighthouse tower.
  for (const e of (art?.extras ?? []).filter((x) => x.landmark === "lighthouse" || x.landmark === "windmill")) {
    if (!inMapBox(e.ring)) continue;
    place(ctx, { asset: use(e.art.asset)!, role: e.landmark!, at: sq(e.at), rot: e.rot, scale: e.scale, layer: LAYER.overhead, zone: zoneId, feature: "landmarks", occupy: "force", light: false });
    const shape = (e.landmark === "lighthouse" ? e.walls ?? e.ring : e.ring).map(sq);
    const bb = bboxOf(shape);
    for (let yy = Math.floor(bb.y); yy < bb.y + bb.h; yy += 0.25) for (let xx = Math.floor(bb.x); xx < bb.x + bb.w; xx += 0.25) if (inside([xx + 0.125, yy + 0.125], shape as Ring)) grid.mark({ x: xx, y: yy, w: 0.25, h: 0.25 }, Cell.Wall);
    if (e.landmark === "lighthouse" && e.walls) {
      const m: Vec = [shape.reduce((t, p) => t + p[0], 0) / shape.length, shape.reduce((t, p) => t + p[1], 0) / shape.length];
      const inner = shape.map((p) => [p[0] + (m[0] - p[0]) * 0.08, p[1] + (m[1] - p[1]) * 0.08] as Vec);
      const doorAt: Vec = [(inner[0]![0] + inner[1]![0]) / 2, (inner[0]![1] + inner[1]![1]) / 2];
      const res = b.addWall({ points: inner.map(px), loop: true, texture: houseWall?.res, doors: door ? [{ at: px(doorAt), texture: door.res, width: 1 }] : [] });
      elements[res.id] = { kind: "wall", key: "lighthouse" };
      res.doors.forEach((nid) => (elements[nid] = { kind: "door", key: "door:lighthouse", zone: zoneId, state: "closed" }));
    }
  }
  for (const wf of wharves) {
    const len = Math.hypot(wf.b[0] - wf.a[0], wf.b[1] - wf.a[1]);
    for (let t = 3 + rng.range(0, 4); t < len - 2; t += rng.range(7, 12)) {
      const at = sq([wf.a[0] + ((wf.b[0] - wf.a[0]) * t) / len + wf.n[0] * 2.2, wf.a[1] + ((wf.b[1] - wf.a[1]) * t) / len + wf.n[1] * 2.2]);
      if (at[0] < 1 || at[1] < 1 || at[0] > w - 1 || at[1] > h - 1) continue;
      const role = rng.pick(["crate", "crate", "barrel", "sack"]);
      for (let k2 = 0; k2 < rng.int(2, 4); k2++) {
        const piece = pick(ctx, zoneId, role, { maxSide: 1.6 });
        if (piece) place(ctx, { asset: piece, role, at: [at[0] + rng.range(-0.9, 0.9), at[1] + rng.range(-0.9, 0.9)], rot: rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "cargo", occupy: "solid" });
      }
    }
  }

  // Market squares: stalls in rows round the edge, a few in the middle, the monument kept clear.
  const stalls = cat.search(/^Market (Box|Chicken|Clothing|Empty|Knick Knack|Pumpkin|Pottery) Stall|^Market Stall|^Festival Stall Cluster|^Market Tent - |^citygate_market stall/i).filter((a) => (a.footprint ? Math.max(...a.footprint) <= 6.5 : false));
  for (const pr of city.prisms) {
    const c = sq(centroid(pr));
    if (c[0] < 0 || c[1] < 0 || c[0] > w || c[1] > h) continue;
    // A fountain the rules chose for this square (grand on a large city's market), else a well or statue.
    const fountain = (art?.extras ?? []).find((e) => e.landmark?.startsWith("fountain_") && Math.hypot(e.at[0] - centroid(pr)[0], e.at[1] - centroid(pr)[1]) < 3);
    if (fountain) {
      place(ctx, { asset: use(fountain.art.asset)!, role: "fountain", at: c, rot: fountain.rot, scale: fountain.scale, layer: LAYER.furniture, zone: zoneId, feature: "monument", occupy: "force", light: false });
      const d = Math.max(fountain.art.w, fountain.art.h) / M_PER_SQUARE;
      grid.mark(rectAt(c, [d + 2, d + 2]), Cell.Solid);
      continue;
    }
    const mon = pick(ctx, zoneId, "font", { maxSide: 3 }) ?? pick(ctx, zoneId, "statue", { maxSide: 3, minSide: 1 });
    if (mon) place(ctx, { asset: mon, role: "monument", at: c, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "monument", occupy: "force", pad: 1.2 });
    grid.mark(rectAt(c, [5, 5]), Cell.Path);
  }
  for (const s of city.squares) {
    const r = clipRing(s, box).map(sq);
    if (r.length < 3) continue;
    const bb = bboxOf(r);
    const deck = rng.shuffle([...stalls]);
    let tried = 0;
    let n = 0;
    // Rows of stalls along the square's long side, aisles between them, facing alternately, a few gaps for crossings.
    const whole = s.map(sq);
    let axis: [Vec, Vec] = [whole[0]!, whole[1]!];
    for (let j = 0; j < whole.length; j++) {
      const e: [Vec, Vec] = [whole[j]!, whole[(j + 1) % whole.length]!];
      if (Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]) > Math.hypot(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1])) axis = e;
    }
    const th = Math.atan2(axis[1][1] - axis[0][1], axis[1][0] - axis[0][0]);
    const U: Vec = [Math.cos(th), Math.sin(th)], V: Vec = [-Math.sin(th), Math.cos(th)];
    const us = r.map((p) => p[0] * U[0] + p[1] * U[1]), vs = r.map((p) => p[0] * V[0] + p[1] * V[1]);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const rowGap = 5.8, along = 4.6;
    for (let row = v0 + 3, ri = 0; row < v1 - 2.5; row += rowGap, ri++) {
      for (let u = u0 + 3 + rng.range(0, 2); u < u1 - 2.5; u += along + rng.range(-0.3, 0.8)) {
        if (rng.next() < 0.1) continue;
        tried++;
        const a = deck[n % deck.length];
        if (!a) break;
        const at: Vec = [U[0] * u + V[0] * row, U[1] * u + V[1] * row];
        if (!inside(at as Pt, r) || at[0] < 2 || at[1] < 2 || at[0] > w - 2 || at[1] > h - 2) continue;
        const rot = th + (ri % 2 === 0 ? 0 : Math.PI) + rng.range(-0.05, 0.05);
        // Turned stalls have big bounding boxes; the rows already space them, so only their cores must be clear.
        const core = Math.min(...(a.footprint ?? [2, 2])) * 0.75;
        if (!grid.fits(rectAt(at, [core, core]), (cv) => cv === Cell.Free)) continue;
        if (place(ctx, { asset: a, role: "stall", at, rot, layer: LAYER.furniture, zone: zoneId, feature: "stalls", occupy: "force" })) {
          grid.mark(rectAt(at, [core, core], 0.4), Cell.Solid);
          n++;
        }
      }
    }
    if (tried) notes.push(`square ${n} stalls on ${tried} spots`);
    // Crates, sacks and baskets between the stalls.
    for (let i = 0; i < Math.round(bb.w * bb.h * 0.02); i++) {
      const role = rng.pick(["crate", "sack", "basket", "barrel"]);
      const a = pick(ctx, zoneId, role, { maxSide: 1.4 });
      const at: Vec = [bb.x + rng.range(1, bb.w - 1), bb.y + rng.range(1, bb.h - 1)];
      if (a && inside(at as Pt, r)) place(ctx, { asset: a, role, at, rot: rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "market_goods", occupy: "solid" });
    }
    // Braziers for the night, spread over the square between the stalls.
    const brazier = streetLight("brazier", 1.4);
    if (brazier && bb.w > 4 && bb.h > 4) {
      const want = Math.max(2, Math.min(14, Math.round(ringArea(r) / 70)));
      const fires: Vec[] = [];
      for (let t = 0; t < 200 && fires.length < want; t++) {
        const at: Vec = [bb.x + lrng.range(1.5, bb.w - 1.5), bb.y + lrng.range(1.5, bb.h - 1.5)];
        if (!inside(at as Pt, r) || !insideMap(at, 1.5) || fires.some((f) => Math.hypot(f[0] - at[0], f[1] - at[1]) < 6)) continue;
        if (!grid.fits(rectAt(at, [1.4, 1.4]), (cv) => cv === Cell.Free)) continue;
        if (place(ctx, { asset: brazier, role: "brazier", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "market_fires", occupy: "solid", light: LIGHTS.brazier })) fires.push(at);
      }
    }
  }

  // Street clutter against the house walls: walk the building edges that face the street.
  // No troughs: the library's only troughs are a magic shop's glowing fungi planters.
  const clutter: Array<[string, number]> = [["barrel", 3], ["crate", 3], ["sack", 2], ["basket", 1], ["debris", 0.6]];
  for (const bd of near) {
    const r = clipRing(bd, box).map(sq);
    if (r.length < 3) continue;
    for (let j = 0; j < r.length; j++) {
    const a = r[j]!, q = r[(j + 1) % r.length]!;
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    // About one pile per 8 squares of street-facing wall.
    if (len < 2.5 || rng.next() > Math.min(0.9, len / 8)) continue;
    const t = rng.range(0.15, 0.85);
    const nx = -(q[1] - a[1]) / len, ny = (q[0] - a[0]) / len;
    for (const sgn of [1, -1]) {
      const at: Vec = [a[0] + (q[0] - a[0]) * t + nx * sgn * 0.75, a[1] + (q[1] - a[1]) * t + ny * sgn * 0.75];
      if (at[0] < 1 || at[1] < 1 || at[0] > w - 1 || at[1] > h - 1 || !grid.fits(rectAt(at, [0.5, 0.5]), (cv) => cv === Cell.Free)) continue;
      // A small pile: one to three pieces of the same kind.
      const role = rng.weighted(clutter, (x) => x[1])[0];
      for (let n = 0; n < rng.int(1, 3); n++) {
        const piece = pick(ctx, zoneId, role, { maxSide: 1.6 });
        const p: Vec = [at[0] + (q[0] - a[0]) / len * n * 0.8, at[1] + (q[1] - a[1]) / len * n * 0.8];
        if (piece) place(ctx, { asset: piece, role, at: p, rot: rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "street_clutter", occupy: "solid" });
      }
      break;
    }
    }
  }
  for (let i = 0; i < Math.max(1, Math.round((w * h) / 1600)); i++) {
    const a = pick(ctx, zoneId, rng.next() < 0.6 ? "cart" : "wagon", { maxSide: 4 });
    const road = city.roads[rng.int(0, Math.max(0, city.roads.length - 1))];
    if (!a || !road) break;
    const inMap = road.points.map(sq).filter((p) => p[0] > 3 && p[1] > 3 && p[0] < w - 3 && p[1] < h - 3);
    const p = inMap.length ? rng.pick(inMap) : undefined;
    if (p) place(ctx, { asset: a, role: "cart", at: [p[0] + rng.range(-1.5, 1.5), p[1] + rng.range(-1.5, 1.5)], rot: rng.range(0, Math.PI * 2), layer: LAYER.furniture, zone: zoneId, feature: "carts", occupy: "solid" });
  }

  // Trees outside the walls and in greens.
  for (const t of city.trees) {
    const at = sq(t);
    if (at[0] < 0 || at[1] < 0 || at[0] > w || at[1] > h) continue;
    const a = pick(ctx, zoneId, "tree", { maxSide: 5 });
    if (a) place(ctx, { asset: a, role: "tree", at, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.7, 1), layer: LAYER.overhead, zone: zoneId, feature: "trees", occupy: "clutter", light: false });
  }
  // Edges: weeds where the cobbles meet house walls in town; outside, grass and flowers along the
  // house fronts and the road verges, and wild growth (trees, bushes, rocks) on open ground.
  for (const bd of near) {
    const ring = bd.map(sq);
    const town = insideWalls(centroid(bd));
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j]!, q = ring[(j + 1) % ring.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 1) continue;
      const u: Vec = [(q[0] - a[0]) / len, (q[1] - a[1]) / len];
      for (let t = rng.range(0.4, 1.5); t < len - 0.4; t += rng.range(1.8, 3.6)) {
        if (rng.next() < (town ? 0.65 : 0.35)) continue;
        for (const side of [1, -1]) {
          const at: Vec = [a[0] + u[0] * t - u[1] * side * 0.45, a[1] + u[1] * t + u[0] * side * 0.45];
          if (inside([ar.x + at[0] * M_PER_SQUARE, ar.y + at[1] * M_PER_SQUARE], bd) || !free(at, 0.4)) continue;
          // A strip of grass laid along the wall foot; clovers and leaves in town.
          const strip = M.grassStrips.length && rng.next() < (town ? 0.5 : 0.7) ? rng.pick(M.grassStrips) : undefined;
          if (strip) {
            const fp = strip.footprint ?? [1, 3];
            const along = Math.atan2(u[1], u[0]) - (fp[1] > fp[0] ? Math.PI / 2 : 0);
            const half = Math.min(...fp) / 2;
            const p: Vec = [a[0] + u[0] * t - u[1] * side * (0.35 + half), a[1] + u[1] * t + u[0] * side * (0.35 + half)];
            if (free(p, 0.3)) place(ctx, { asset: use(strip)!, role: "groundcover", at: p, rot: along + (rng.next() < 0.5 ? Math.PI : 0), scale: rng.range(0.7, 0.95), layer: LAYER.decal, zone: zoneId, feature: "verges", occupy: "low", light: false });
          } else tuft(at, town ? [[M.clover, 3], [M.leaves, 1.5], [M.stones, 1]] : [[M.flowers, 3], [M.clover, 2], [M.bush, 0.8]], 1, 0.3, "verges", rng);
          break;
        }
      }
    }
  }
  for (const road of city.roads) {
    const pts = road.points.map(sq);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, q = pts[i + 1]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 1) continue;
      const u: Vec = [(q[0] - a[0]) / len, (q[1] - a[1]) / len];
      for (let t = rng.range(0, 4); t < len; t += rng.range(3.5, 7)) {
        for (const side of [1, -1]) {
          const at: Vec = [a[0] + u[0] * t - u[1] * side * (road.width * k * 0.5 + 1.1), a[1] + u[1] * t + u[0] * side * (road.width * k * 0.5 + 1.1)];
          const m: Pt = [ar.x + at[0] * M_PER_SQUARE, ar.y + at[1] * M_PER_SQUARE];
          if (insideWalls(m) || !free(at, 0.8) || rng.next() < 0.4) continue;
          tuft(at, [[M.grass, 5], [M.flowers, 3], [M.clover, 1.5], [M.stones, 1], [M.bush, 0.8]], rng.int(2, 4), rng.range(0.6, 1.4), "verges", rng);
        }
      }
    }
  }
  {
    const wild: Menu = [[M.trees, 1.6], [M.bush, 3], [M.rocks, 0.8], [M.grass, 6], [M.flowers, 4], [M.clover, 2], [M.stones, 1], [M.logs, 0.3]];
    const tries = Math.round((w * h) / 45);
    for (let n = 0; n < tries; n++) {
      const at: Vec = [rng.range(1, w - 1), rng.range(1, h - 1)];
      const m: Pt = [ar.x + at[0] * M_PER_SQUARE, ar.y + at[1] * M_PER_SQUARE];
      if (insideWalls(m) || plotDepth(m) > -4 || Math.min(...city.roads.map((r) => distToPolyline(m, r.points) - r.width / 2), 99) < 4 || shoreDist(m) < 3) continue;
      if (city.water.some((wr) => inside(m, wr)) || city.fields.some((f) => inside(m, f)) || !free(at, 1.2)) continue;
      tuft(at, wild, rng.int(2, 5), rng.range(1, 2.6), "wild", rng);
    }
  }
  // Grime and puddles on the streets.
  for (let i = 0; i < Math.round(w * h * 0.01); i++) {
    const role = rng.pick(["dirt", "puddle", "grime"]);
    const a = pick(ctx, zoneId, role, { maxSide: 2 });
    const at: Vec = [rng.range(1, w - 1), rng.range(1, h - 1)];
    if (a && grid.fits(rectAt(at, [0.5, 0.5]), (cv) => cv !== Cell.Wall)) place(ctx, { asset: a, role, at, rot: rng.range(0, Math.PI * 2), layer: LAYER.decal, zone: zoneId, feature: "street_grime", occupy: "low", light: false });
  }

  // A torch or lamp on the wall beside the street door of the public and the great buildings.
  const torch = streetLight("torch", 1.3, true) ?? streetLight("sconce", 1.3, true);
  for (const d of torch ? doorLamps : []) {
    const along: Vec = [-d.out[1], d.out[0]];
    const off = frontSize(torch!).depth / 2 + 0.12;
    for (const sg of d.n === 2 ? [-1, 1] : [lrng.next() < 0.5 ? -1 : 1]) {
      const at: Vec = [d.at[0] + along[0] * 0.95 * sg + d.out[0] * off, d.at[1] + along[1] * 0.95 * sg + d.out[1] * off];
      if (insideMap(at, 0.4)) place(ctx, { asset: torch!, role: "torch", at, rot: rotationFor(torch!, d.out), layer: LAYER.overhead, zone: zoneId, feature: "door_lights", occupy: "force", light: LIGHTS.torch });
    }
  }

  // Street lights, about every seven squares: a lantern on a house wall that fronts the street; a
  // standing torch at the street edge of a plot whose house stands back from it; a standing torch
  // by the main road where no light is near (open stretches, squares). Out in the country (outside
  // the town wall, or away from the houses of a town without one) the roads stay dark.
  const SPACING = 7;
  const shining: Vec[] = ctx.placed.filter((p) => p.light && !p.key.startsWith("house#")).map((p) => (p.center ?? [p.x, p.y]) as Vec);
  const far = (p: Vec) => shining.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= SPACING);
  const metres = (p: Vec): Pt => [ar.x + p[0] * M_PER_SQUARE, ar.y + p[1] * M_PER_SQUARE];
  const inTown = (p: Vec) => (wall ? insideWalls(metres(p)) : near.some((bd) => ringDist(metres(p), bd) < 12));
  const wallLamp = streetLight("sconce", 1.1, true) ?? torch;
  if (wallLamp) {
    const off = frontSize(wallLamp).depth / 2 + 0.12;
    for (const ring of houseWalls) for (let j = 0; j < ring.length; j++) {
      const a = ring[j]!, q = ring[(j + 1) % ring.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 2) continue;
      let n: Vec = [-(q[1] - a[1]) / len, (q[0] - a[0]) / len];
      if (inside([(a[0] + q[0]) / 2 + n[0] * 0.4, (a[1] + q[1]) / 2 + n[1] * 0.4] as Pt, ring as Ring)) n = [-n[0], -n[1]];
      for (let t = 1; t <= len - 1; t += 1) {
        const e: Vec = [a[0] + ((q[0] - a[0]) * t) / len, a[1] + ((q[1] - a[1]) * t) / len];
        const at: Vec = [e[0] + n[0] * off, e[1] + n[1] * off];
        if (!insideMap(at, 0.6) || !far(at) || !inTown(at) || doorSpots.some((d) => Math.hypot(d[0] - e[0], d[1] - e[1]) < 1.3)) continue;
        // Facing the street: open street within four squares in front, nothing walled in between.
        let street = false;
        for (const d of [1.2, 2.2, 3.2, 4.2]) {
          const f: Vec = [e[0] + n[0] * d, e[1] + n[1] * d];
          if (!grid.fits(rectAt(f, [0.4, 0.4]), (c) => c !== Cell.Wall)) break;
          if (open(metres(f))) { street = true; break; }
        }
        if (street && place(ctx, { asset: wallLamp, role: "lantern", at, rot: rotationFor(wallLamp, n), layer: LAYER.overhead, zone: zoneId, feature: "street_lights", occupy: "force", light: LIGHTS.lantern })) shining.push(at);
      }
    }
  }
  const post = cat.named("Torch - Standing")[0] ?? streetLight("lantern", 0.8);
  // The street edge of every plot (the city's building outlines are plots; the houses stand inside them).
  if (post) for (const bd of near) {
    const r = clipRing(bd, box).map(sq);
    if (r.length < 3) continue;
    for (let j = 0; j < r.length; j++) {
      const a = r[j]!, q = r[(j + 1) % r.length]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 2) continue;
      let n: Vec = [-(q[1] - a[1]) / len, (q[0] - a[0]) / len];
      if (inside([(a[0] + q[0]) / 2 + n[0] * 0.4, (a[1] + q[1]) / 2 + n[1] * 0.4] as Pt, r as Ring)) n = [-n[0], -n[1]];
      for (let t = 1; t <= len - 1; t += 1) {
        const at: Vec = [a[0] + ((q[0] - a[0]) * t) / len + n[0] * 0.6, a[1] + ((q[1] - a[1]) * t) / len + n[1] * 0.6];
        if (!insideMap(at, 0.8) || !far(at) || !inTown(at) || !open(metres(at))) continue;
        if (place(ctx, { asset: post, role: "torch", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "street_lights", occupy: "clutter", light: LIGHTS.torch })) shining.push(at);
      }
    }
  }
  if (post) for (const road of city.roads) {
    const pts = road.points.map(sq);
    const off = (road.width * k) / 2 + 0.5;
    let side = 1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, q = pts[i + 1]!;
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 1e-6) continue;
      const nrm: Vec = [-(q[1] - a[1]) / len, (q[0] - a[0]) / len];
      for (let t = 0; t < len; t += 1) {
        const c: Vec = [a[0] + ((q[0] - a[0]) * t) / len, a[1] + ((q[1] - a[1]) * t) / len];
        if (!insideMap(c, 1) || !inTown(c) || !far(c)) continue;
        for (const sd of [side, -side]) {
          const at: Vec = [c[0] + nrm[0] * off * sd, c[1] + nrm[1] * off * sd];
          if (insideMap(at, 0.8) && place(ctx, { asset: post, role: "torch", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "road_lights", occupy: "clutter", light: LIGHTS.torch })) {
            shining.push(at);
            side = -sd;
            break;
          }
        }
      }
    }
  }

  // Whatever street is still dark (wide streets, small squares, greens): a standing torch on a three-square lattice.
  if (post) for (let y = 1.5; y < h - 1; y += 3) for (let x = 1.5; x < w - 1; x += 3) {
    const at: Vec = [x, y];
    if (!far(at) || !inTown(at) || !open(metres(at)) || city.water.some((wr) => inside(metres(at), wr))) continue;
    if (place(ctx, { asset: post, role: "torch", at, rot: 0, layer: LAYER.furniture, zone: zoneId, feature: "street_lights", occupy: "clutter", light: LIGHTS.torch })) shining.push(at);
  }

  // Objects and lights.
  const placed: Placed[] = ctx.placed;
  for (const p of placed) {
    use(p.asset);
    const id = b.addObject({ at: px([p.x, p.y]), texture: p.asset.res, rotation: p.rotation, scale: p.scale, layer: p.layer, customColor: p.customColor, shadow: p.layer >= 300 && p.layer < 700 });
    elements[id] = { kind: "object", key: p.key, zone: p.zone, feature: p.feature, type: p.type, asset: p.asset.id };
    // Lamps by day too: Foundry lights them at dusk (LAMPS_LIT_FROM), as the clock darkens the scene.
    if (p.light) {
      const lid = b.addLight({ at: px(p.center ?? [p.x, p.y]), range: Math.max(1.5, p.light.range * reach), color: p.light.color, intensity: p.light.intensity ?? 1 });
      elements[lid] = { kind: "light", key: `${p.key}/light`, zone: p.zone };
    }
  }
  const byType: Record<string, number> = {};
  for (const p of placed) byType[p.type] = (byType[p.type] ?? 0) + 1;
  const map = b.build();
  return {
    id: st.id,
    // Every street map uses the same town set; the indoor style's pack name means nothing here.
    name: "Streets",
    palette: { anchorPack: st.anchorPack, tone: st.tone, tint: st.tint, floors: {}, wall: houseWall?.id, door: door?.id, road: st.road?.id },
    map,
    elements,
    placed,
    sheltered,
    notes: [...b.warnings, ...ctx.notes, ...notes],
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

/** A polyline moved sideways by `d` (positive to the left of its direction on screen), mitred at the bends. */
function offsetLine(pts: Vec[], d: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[i]!, c = pts[Math.min(pts.length - 1, i + 1)]!;
    const n = (p: Vec, q: Vec): Vec => {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return [(q[1] - p[1]) / l, -(q[0] - p[0]) / l];
    };
    const n1 = i > 0 ? n(a, b) : n(b, c), n2 = i < pts.length - 1 ? n(b, c) : n1;
    const m: Vec = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]) || 1;
    const cos = (m[0] * n1[0] + m[1] * n1[1]) / ml;
    const s = d / Math.max(0.35, cos);
    out.push([b[0] + (m[0] / ml) * s, b[1] + (m[1] / ml) * s]);
  }
  return out;
}

/** The town's ground set: Fort Foul Luck grass and mud, Grass & Road Assets 2 cobbles and dirt. */
function townGround(cat: Catalog): { grass: AssetRecord; cobble: AssetRecord; dirt: AssetRecord; mud: AssetRecord } | undefined {
  const find = (re: RegExp, pack: RegExp) => cat.index.assets.find((a) => a.kind === "terrain" && !a.error && re.test(a.name) && pack.test(cat.packs.get(a.pack)?.name ?? "") && cat.packs.get(a.pack)?.readAllowed !== false);
  const grass = find(/^Texture_grass$/, /Fort Foul Luck/) ?? find(/^Lush Grass D - Green - 10x10$/, /Green Hill/);
  const cobble = find(/^Texture - Cobble, Round - 5x5 - Sodden$/, /Grass & Road Assets 2/) ?? find(/^Texture - Cobble, Round - 5x5$/, /Grass & Road Assets 2/);
  const dirt = find(/^Texture - Dirt - 10x10$/, /Grass & Road Assets 2/);
  const mud = find(/^Texture_mud$/, /Fort Foul Luck/) ?? find(/^Texture - Dirt - 10x10 - Sodden$/, /Grass & Road Assets 2/);
  return grass && cobble && dirt && mud ? { grass, cobble, dirt, mud } : undefined;
}

interface Meadow {
  grass: AssetRecord[];
  grassStrips: AssetRecord[];
  flowers: AssetRecord[];
  clover: AssetRecord[];
  leaves: AssetRecord[];
  bush: AssetRecord[];
  stones: AssetRecord[];
  rocks: AssetRecord[];
  trees: AssetRecord[];
  logs: AssetRecord[];
  farmAnimals: AssetRecord[];
  townAnimals: AssetRecord[];
}

/** The ground-cover set every town uses (2MT grassland packs), by kind. */
function meadowSet(cat: Catalog): Meadow {
  const of = (pack: RegExp, name: RegExp) => cat.index.assets.filter((a) => a.kind === "object" && !a.colorable && !a.dupeOf && !a.error && a.footprint && name.test(a.name) && pack.test(cat.packs.get(a.pack)?.name ?? "") && cat.packs.get(a.pack)?.readAllowed !== false).sort((a, b) => a.id.localeCompare(b.id));
  const grassAll = of(/^2M Green Hill$/, /^Grass \d+[ab]$/);
  const elongated = (a: AssetRecord) => Math.max(...a.footprint!) / Math.min(...a.footprint!) >= 2.4;
  return {
    grass: grassAll.filter((a) => Math.max(...a.footprint!) <= 5),
    grassStrips: grassAll.filter((a) => elongated(a) && Math.min(...a.footprint!) <= 1.3),
    flowers: [...of(/Meadow Picnic/, /^Flower (1|4|7|13|16) - (Blue|White|Yellow)$/), ...of(/^2MT Farm Friends$/, /^Flower - (Dandelion|Cornflower|Azure Bluet)/)],
    clover: of(/Roadside Forest Tokens/, /^Clovers, \d$/),
    leaves: of(/Roadside Forest Tokens/, /^Leaf litter, leaves, [12]$/),
    bush: of(/Farmer's Field Plus/, /^Bush [1-3]$/),
    stones: of(/Farmer's Field Plus/, /^Stones - Loose \d+$/),
    rocks: of(/Roadside Forest Tokens/, /^Rocks, [1-5]$/),
    trees: [...of(/Roadside Forest Tokens/, /^Tree, [1-3]$/), ...of(/Farmer's Field Plus/, /^Tree$/)],
    logs: of(/Roadside Forest Tokens/, /^Stump, [1-3]$/),
    farmAnimals: of(/^2MT Farm Friends( Plus)?$/, /^Animal - (Chicken|Chicks|Duck|Goose|Goat|Sheep|Lamb|Pig|Piglet|Cow|Calf|Horse|Dog) (\d+|Variant \d+)$/),
    townAnimals: of(/^2MT Farm Friends( Plus)?$/, /^Animal - (Chicken|Dog|Duck|Goose) (\d+|Variant \d+)$/),
  };
}

/** A Farmer's Field crop texture (pattern). */
function streetFieldTex(cat: Catalog, re: RegExp): AssetRecord | undefined {
  return cat.index.assets.find((a) => a.kind === "pattern" && !a.colorable && re.test(a.name) && /Farmer's Field/.test(cat.packs.get(a.pack)?.name ?? ""));
}

/** The direction of a field's long side, radians: crop rows run along it. */
function fieldFrame(r: Ring): number {
  let best = 0, ang = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, q = r[(i + 1) % r.length]!;
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (len > best) { best = len; ang = Math.atan2(q[1] - a[1], q[0] - a[0]); }
  }
  return ang;
}

function ringDist(p: Pt, r: Ring): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return d;
}

/** Roofs sit above the ground, roads and the water; hips and ridges go on after the faces. */
const ROOF_LAYER = 400;

const seglen = (s: [Pt, Pt]) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);

/** A 2M City Street Pack texture (filed as modern, but its cobbles and flagstones suit any old town). */
function streetTex(cat: Catalog, re: RegExp): AssetRecord | undefined {
  return cat.index.assets.filter((a) => a.kind === "pattern" && !a.error && re.test(a.name) && cat.packs.get(a.pack)?.readAllowed && /City Street Pack/i.test(cat.packs.get(a.pack)?.name ?? "")).sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** One of 2M Modular Rooftops' roof sets: shingle tiles, ridge and hip strips. */
function roofSet(cat: Catalog, color: "red" | "blue"): { tiles: AssetRecord; ridge: AssetRecord; hip: AssetRecord } | undefined {
  const all = cat.index.assets.filter((a) => a.kind === "roof" && !a.error && a.id.includes(`/${color}_roof/`) && /Modular Rooftops/i.test(cat.packs.get(a.pack)?.name ?? ""));
  const tiles = all.find((a) => a.name === "tiles"), ridge = all.find((a) => a.name === "ridge"), hip = all.find((a) => a.name === "hip");
  return tiles && ridge && hip ? { tiles, ridge, hip } : undefined;
}

function b2(a: AssetRecord): number {
  return a.footprint?.[1] ?? 0;
}

function segCross(a: Vec, b: Vec, c: Vec, d: Vec): Vec | undefined {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0]!, a[1] + t * r[1]!] : undefined;
}
