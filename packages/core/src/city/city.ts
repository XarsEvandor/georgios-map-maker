/**
 * Cities from watabou's Medieval Fantasy City Generator (MFCG), the generator Azgaar's
 * Fantasy Map Generator links every city to. MFCG exports a city as GeoJSON (`export=json`):
 * buildings, roads with widths, walls, rivers, piers ("planks"), squares, districts with
 * names, fields, water, trees. Units are about metres. Here: parsing, finding the places a
 * party is likely to go (hot spots), and geometry helpers. Pure: no file or network access.
 * Screen coordinates: x east, y south (GeoJSON y is flipped).
 */

import type { Trade } from "./shops";

export type Pt = [number, number];
export type Ring = Pt[];
export interface Box { x: number; y: number; w: number; h: number }

export interface City {
  name: string;
  /** The MFCG link the city came from. */
  url: string;
  roadWidth: number;
  towerRadius: number;
  wallThickness: number;
  buildings: Ring[];
  roads: Array<{ points: Pt[]; width: number }>;
  /** City and castle walls, as closed rings. */
  walls: Array<{ ring: Ring; width: number }>;
  rivers: Array<{ points: Pt[]; width: number }>;
  /** Piers and bridges. */
  planks: Array<{ points: Pt[]; width: number }>;
  squares: Ring[];
  /** Monuments in squares (wells, statues, fountains). */
  prisms: Ring[];
  greens: Ring[];
  fields: Ring[];
  water: Ring[];
  trees: Pt[];
  districts: Array<{ name: string; ring: Ring }>;
  /** Area worth showing: the walls or the built-up area, with a margin. */
  bounds: Box;
}

export type HotSpotKind = "market" | "keep" | "temple" | "tavern" | "gate" | "docks" | "inn" | "wizard" | "lighthouse" | "shop" | "mansion" | "garrison" | "stable";

export interface HotSpot {
  id: string;
  kind: HotSpotKind;
  label: string;
  /** Where the pin goes (metres). */
  at: Pt;
  /** Street-level maps: the area to build (metres). */
  area?: Box;
  /** Interiors: the building's outline (metres). */
  building?: Ring;
  /** Shops: the trade (city/shops.ts). */
  trade?: Trade;
  /** Foundry core icon for the pin, when the kind alone does not say. */
  icon?: string;
  /** Hidden from players (thieves' dens and the like). */
  secret?: boolean;
  /** Built when the DM first opens it, not when the city opens. */
  onDemand?: boolean;
}

/** Metres in one 5 ft battle-map square. */
export const M_PER_SQUARE = 1.524;

const flip = (p: number[]): Pt => [p[0]!, -p[1]!];

export function parseCity(json: unknown, meta: { name?: string; url: string }): City {
  const fc = json as { features?: Array<Record<string, any>> };
  if (!fc || !Array.isArray(fc.features)) throw new Error("not a city export (no features)");
  const byId = new Map(fc.features.map((f) => [String(f.id), f]));
  const values = byId.get("values") ?? {};
  const geom = (id: string): any => {
    const f = byId.get(id);
    return f?.geometry ?? f;
  };
  const polys = (id: string): Ring[] => {
    const g = geom(id);
    if (!g?.coordinates) return [];
    if (g.type === "Polygon") return [(g.coordinates[0] ?? []).map(flip)];
    if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).map((p) => (p[0] ?? []).map(flip)).filter((r) => r.length >= 3);
    return [];
  };
  const lines = (id: string): Array<{ points: Pt[]; width: number }> => (geom(id)?.geometries ?? [])
    .filter((m: any) => m.type === "LineString" && Array.isArray(m.coordinates))
    .map((m: any) => ({ points: (m.coordinates as number[][]).map(flip), width: Number(m.width) || 4 }));
  const walls: Array<{ ring: Ring; width: number }> = (geom("walls")?.geometries ?? []).filter((m: any) => m.type === "Polygon").map((m: any) => ({ ring: (m.coordinates[0] as number[][]).map(flip), width: Number(m.width) || Number(values.wallThickness) || 6 }));
  const districts: Array<{ name: string; ring: Ring }> = (geom("districts")?.geometries ?? []).filter((m: any) => m.type === "Polygon").map((m: any) => ({ name: String(m.name ?? "District").slice(0, 60), ring: (m.coordinates[0] as number[][]).map(flip) }));
  const treesG = geom("trees");
  const trees: Pt[] = treesG?.type === "MultiPoint" ? (treesG.coordinates as number[][]).map(flip) : [];
  const buildings = polys("buildings");
  if (!buildings.length) throw new Error("the city export has no buildings");
  const city: City = {
    name: meta.name ?? "City",
    url: meta.url,
    roadWidth: Number(values.roadWidth) || 8,
    towerRadius: Number(values.towerRadius) || 7,
    wallThickness: Number(values.wallThickness) || 7,
    buildings,
    roads: lines("roads"),
    walls,
    rivers: lines("rivers"),
    planks: lines("planks"),
    squares: polys("squares"),
    prisms: polys("prisms"),
    greens: polys("greens"),
    fields: polys("fields"),
    water: polys("water"),
    trees,
    districts,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
  };
  // A citadel the generator drew as its own small walled ring but didn't name: call it one, so
  // the keep, its art and its pin are found like a named castle district.
  if (!districts.some((d) => /castle|citadel|keep|palace/i.test(d.name))) {
    for (const w of walls) {
      const held = buildings.filter((bd) => inside(centroid(bd), w.ring));
      if (held.length >= 1 && held.length <= 8 && area(w.ring) < 40000) {
        districts.push({ name: "Citadel", ring: w.ring });
        break;
      }
    }
  }
  const core = [...buildings.flat(), ...walls.flatMap((w) => w.ring)];
  const b = bboxOf(core);
  const m = Math.max(60, Math.min(b.w, b.h) * 0.12);
  city.bounds = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
  return city;
}

// ---------------------------------------------------------------------------------------
// Geometry

export function bboxOf(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function area(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i]!, b = r[(i + 1) % r.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

export function centroid(r: Ring): Pt {
  let cx = 0, cy = 0, s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const k = a[0] * b[1] - b[0] * a[1];
    s += k; cx += (a[0] + b[0]) * k; cy += (a[1] + b[1]) * k;
  }
  if (Math.abs(s) < 1e-9) { const bb = bboxOf(r); return [bb.x + bb.w / 2, bb.y + bb.h / 2]; }
  return [cx / (3 * s), cy / (3 * s)];
}

export function inside(p: Pt, r: Ring): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!, b = r[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

/** Where two segments cross, if they do. */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0]!, a[1] + t * r[1]!] : undefined;
}

/** Clips a ring to a box (Sutherland-Hodgman). */
export function clipRing(r: Ring, b: Box): Ring {
  let out = r;
  const edges: Array<[(p: Pt) => boolean, (p: Pt, q: Pt) => Pt]> = [
    [(p) => p[0] >= b.x, (p, q) => [b.x, p[1] + ((q[1] - p[1]) * (b.x - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= b.x + b.w, (p, q) => [b.x + b.w, p[1] + ((q[1] - p[1]) * (b.x + b.w - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= b.y, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y - p[1])) / (q[1] - p[1]), b.y]],
    [(p) => p[1] <= b.y + b.h, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y + b.h - p[1])) / (q[1] - p[1]), b.y + b.h]],
  ];
  for (const [ins, at] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!, q = input[(i + 1) % input.length]!;
      if (ins(q)) { if (!ins(p)) out.push(at(p, q)); out.push(q); }
      else if (ins(p)) out.push(at(p, q));
    }
    if (!out.length) break;
  }
  return out;
}

export function boxAround(c: Pt, w: number, h = w): Box {
  return { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
}

// ---------------------------------------------------------------------------------------
// Hot spots

/** The city wall: the wall ring that encloses the most buildings. */
export function cityWall(city: City): { ring: Ring; width: number } | undefined {
  let best: { ring: Ring; width: number } | undefined, n = -1;
  for (const w of city.walls) {
    const k = city.buildings.filter((b) => inside(centroid(b), w.ring)).length;
    if (k > n) { n = k; best = w; }
  }
  return best;
}

/** Gates: where a main road crosses the city wall. The first is where the longest road enters. */
export function gates(city: City): Pt[] {
  const wall = cityWall(city);
  if (!wall) return [];
  const out: Array<{ at: Pt; len: number }> = [];
  for (const road of city.roads) {
    let len = 0;
    for (let i = 0; i + 1 < road.points.length; i++) len += dist(road.points[i]!, road.points[i + 1]!);
    for (let i = 0; i + 1 < road.points.length; i++) {
      for (let j = 0; j < wall.ring.length; j++) {
        const hit = cross(road.points[i]!, road.points[i + 1]!, wall.ring[j]!, wall.ring[(j + 1) % wall.ring.length]!);
        if (hit && !out.some((o) => dist(o.at, hit) < 20)) out.push({ at: hit, len });
      }
    }
  }
  return out.sort((a, b) => b.len - a.len).map((o) => o.at);
}

/**
 * The places a party is likely to go: the market square, the castle's keep, the temple,
 * a tavern by the main gate, the main gate, and the docks. Street-level areas are about
 * 60 to 110 m across (40 to 72 squares).
 */
export function findHotSpots(city: City): HotSpot[] {
  const out: HotSpot[] = [];
  const used = new Set<Ring>();
  const sizes = city.buildings.map(area).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 100;
  const castle = city.districts.find((d) => /castle|citadel|keep|palace/i.test(d.name));
  const inCastle = (b: Ring) => !!castle && inside(centroid(b), castle.ring);

  const square = [...city.squares].sort((a, b) => area(b) - area(a))[0];
  const marketAt = square ? centroid(square) : [city.bounds.x + city.bounds.w / 2, city.bounds.y + city.bounds.h / 2] as Pt;
  if (square) {
    const bb = bboxOf(square);
    const side = Math.max(55, Math.min(90, Math.max(bb.w, bb.h) + 24));
    out.push({ id: "market", kind: "market", label: "Market square", at: marketAt, area: boxAround(marketAt, side) });
  }
  if (castle) {
    const keep = city.buildings.filter(inCastle).sort((a, b) => area(b) - area(a))[0];
    if (keep) {
      used.add(keep);
      out.push({ id: "keep", kind: "keep", label: `${castle.name}: the keep`, at: centroid(keep), building: keep });
    }
  }
  // The temple: the biggest building outside the castle, near the middle of town.
  const temple = city.buildings
    .filter((b) => !inCastle(b) && !used.has(b) && area(b) > median * 1.6)
    .sort((a, b) => area(b) / (1 + dist(centroid(b), marketAt) / 150) - area(a) / (1 + dist(centroid(a), marketAt) / 150))[0];
  if (temple) {
    used.add(temple);
    out.push({ id: "temple", kind: "temple", label: "Temple", at: centroid(temple), building: temple });
  }
  const gateList = gates(city);
  const main = gateList[0];
  const wall = cityWall(city);
  // A tavern: a good-sized building on a main road, just inside the main gate (or near the market).
  const near = main ?? marketAt;
  const tavern = city.buildings
    .filter((b) => !used.has(b) && !inCastle(b) && area(b) >= median * 0.9 && area(b) <= median * 3.5 && (!wall || inside(centroid(b), wall.ring)))
    .filter((b) => city.roads.some((r) => distToPolyline(centroid(b), r.points) < r.width / 2 + 14))
    .sort((a, b) => dist(centroid(a), near) - dist(centroid(b), near))[0];
  if (tavern) {
    used.add(tavern);
    out.push({ id: "tavern", kind: "tavern", label: main ? "Tavern by the gate" : "Tavern", at: centroid(tavern), building: tavern });
  }
  if (main) out.push({ id: "gate", kind: "gate", label: "Main gate", at: main, area: boxAround(main, 70) });
  if (city.planks.length) {
    // Piers come in groups along the shore: the docks are the biggest group.
    const groups: Array<Array<{ points: Pt[] }>> = [];
    for (const pl of city.planks) {
      const c = pl.points[0]!;
      const g = groups.find((gr) => gr.some((o) => dist(o.points[0]!, c) < 70));
      if (g) g.push(pl);
      else groups.push([pl]);
    }
    const best = groups.sort((a, b) => b.length - a.length)[0]!;
    const pts = best.flatMap((p) => p.points);
    const bb = bboxOf(pts);
    const c: Pt = [bb.x + bb.w / 2, bb.y + bb.h / 2];
    const side = Math.max(55, Math.min(90, Math.max(bb.w, bb.h) + 20));
    // Each pier's land end is the end nearer a building; the map leans that way, so the
    // wharf and its warehouses come in, not just open water.
    const near = (p: Pt) => Math.min(...city.buildings.map((b) => dist(centroid(b), p)));
    let lx = 0, ly = 0;
    for (const pl of best) {
      const a = pl.points[0]!, z = pl.points[pl.points.length - 1]!;
      const [land, sea] = near(a) <= near(z) ? [a, z] : [z, a];
      lx += land[0] - sea[0];
      ly += land[1] - sea[1];
    }
    const len = Math.hypot(lx, ly) || 1;
    const centre: Pt = [c[0] + (lx / len) * side * 0.28, c[1] + (ly / len) * side * 0.28];
    out.push({ id: "docks", kind: "docks", label: "Docks", at: c, area: boxAround(centre, side) });
  }
  return out;
}
