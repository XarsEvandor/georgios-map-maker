/**
 * Which buildings of interest a city gets, by rules on its size and location. The rules only
 * choose kinds and spots; houses.ts puts the 2MT art there.
 *
 * Size, from the number of buildings: town (under 250), city (under 700), large (700 and up).
 * Location: coast (sea water), river, walls, farms (fields), castle district.
 *
 * | Place             | When                         | Where                                              |
 * |-------------------|------------------------------|----------------------------------------------------|
 * | temple            | always                       | findHotSpots (church roof over 350 m², else chapel) |
 * | keep, castle      | a castle district            | the keep; other big castle buildings                |
 * | tavern            | always                       | by the main gate (findHotSpots)                     |
 * | guildhall         | city, large                  | the biggest building fronting the market square     |
 * | inns              | city: 1, large: 3            | inside the wall, by the busiest other gates         |
 * | stables           | walls; town: main gate only  | outside the wall, nearest each gate                 |
 * | parish chapels    | large                        | the middle of each big district without the temple  |
 * | wizard's tower    | large                        | a squarish plot 80-350 m from the market            |
 * | warehouses        | piers                        | by the piers' landward ends (2 / 6 / 14)            |
 * | rural houses      | walls, or farms              | outside the wall, or next to the fields             |
 * | lighthouse        | coast, city or large or 3+ piers | the land reaching farthest out by the harbour |
 * | windmills         | farms                        | in the fields by a road (1 / 2 / 3)                 |
 * | fountains         | a monument in a square       | grand (large), large (city), else the well stays    |
 * | gatehouse         | walls, large                 | over the main gate (city scene)                     |
 * | ships and boats   | coast with piers             | houses.ts, by pier and size                         |
 * | barges            | river                        | houses.ts, moored along the banks (1 / 2 / 4)       |
 */

import { area, bboxOf, boxAround, centroid, cityWall, distToPolyline, findHotSpots, gates, inside, type City, type HotSpot, type Pt, type Ring } from "./city";
import { AIM, nobleName, ROSTER, SERVICES, TRADES, type Trade } from "./shops";

export type TownSize = "town" | "city" | "large";

export function townSize(city: City): TownSize {
  const n = city.buildings.length;
  return n < 250 ? "town" : n < 700 ? "city" : "large";
}

/** Places of interest that take a whole plot. */
export type PlotLandmark = "church" | "chapel" | "parish" | "keep" | "castle" | "tavern" | "inn" | "guildhall" | "warehouse" | "stable" | "wizard" | "mansion" | "garrison";

export interface Pier {
  /** Landward and seaward ends (metres). */
  land: Pt;
  sea: Pt;
  width: number;
  length: number;
  /** Unit vector from land to sea. */
  u: Pt;
}

export interface Spot {
  at: Pt;
  /** Radians: the direction the art's x axis points. */
  rot: number;
}

export interface Places {
  size: TownSize;
  coast: boolean;
  river: boolean;
  walled: boolean;
  farms: boolean;
  /** Plot index -> its place of interest. */
  plots: Map<number, PlotLandmark>;
  /** Plots that take country houses (cottages, thatch) instead of town houses. */
  rural: Set<number>;
  /** Plot index -> the trade that keeps shop there (shops.ts), in the order they were placed. */
  shops: Map<number, Trade>;
  /** Mansion plots -> the noble family's name. */
  nobles: Map<number, string>;
  piers: Pier[];
  lighthouse?: Spot;
  windmills: Spot[];
  /** Monuments that become fountains, by size. */
  fountains: Array<Spot & { size: "grand" | "large" | "medium" }>;
  gatehouses: Spot[];
  /** Named gates other than the main one, for the inns' labels. */
  innGates: Map<number, string>;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** A stable 0..1 number from a point, for choices that must not change between runs. */
const hash = (p: Pt, salt = 0) => {
  const s = Math.sin(p[0] * 12.9898 + p[1] * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

function distToRing(p: Pt, r: Ring): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return d;
}

/** Long side over short side of the smallest box round a ring. */
export function aspectOf(r: Ring): number {
  let best = Infinity, ratio = 1;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const us = r.map((p) => p[0] * u[0] + p[1] * u[1]), vs = r.map((p) => -p[0] * u[1] + p[1] * u[0]);
    const w = Math.max(...us) - Math.min(...us), h = Math.max(...vs) - Math.min(...vs);
    if (w * h < best) { best = w * h; ratio = Math.max(w, h) / Math.max(1e-6, Math.min(w, h)); }
  }
  return ratio;
}

/** Compass word for a direction from the centre (y grows down the screen). */
function compass(from: Pt, to: Pt): string {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  return names[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]!;
}

/** Planks that run out into the sea, with their landward end found by depth into the water. */
export function piersOf(city: City): Pier[] {
  const inSea = (p: Pt) => city.water.some((w) => inside(p, w));
  const depth = (p: Pt) => (inSea(p) ? Math.min(...city.water.map((w) => distToRing(p, w))) : -1);
  const out: Pier[] = [];
  for (const pl of city.planks) {
    if (pl.points.length < 2) continue;
    const a = pl.points[0]!, z = pl.points[pl.points.length - 1]!;
    // Bridges have both ends on land.
    if (!inSea(a) && !inSea(z)) continue;
    const [land, sea] = depth(a) <= depth(z) ? [a, z] : [z, a];
    const length = dist(land, sea);
    if (length < 4) continue;
    out.push({ land, sea, width: pl.width, length, u: [(sea[0] - land[0]) / length, (sea[1] - land[1]) / length] });
  }
  return out.sort((p, q) => p.land[0] - q.land[0] || p.land[1] - q.land[1]);
}

export function cityPlaces(city: City): Places {
  const size = townSize(city);
  const B = city.buildings;
  const wall = cityWall(city);
  const walled = !!wall;
  const coast = city.water.length > 0;
  const river = city.rivers.length > 0;
  const farms = city.fields.length > 0;
  const inWall = (p: Pt) => (wall ? inside(p, wall.ring) : true);
  const spots = findHotSpots(city);
  const plots = new Map<number, PlotLandmark>();
  const free = (i: number) => !plots.has(i);
  const plotOf = (ring?: Ring) => (ring ? B.indexOf(ring) : -1);
  const centre: Pt = wall ? centroid(wall.ring) : [city.bounds.x + city.bounds.w / 2, city.bounds.y + city.bounds.h / 2];
  const C = B.map(centroid);
  const A = B.map(area);

  const temple = plotOf(spots.find((h) => h.kind === "temple")?.building);
  if (temple >= 0) plots.set(temple, A[temple]! > 350 ? "church" : "chapel");
  const keep = plotOf(spots.find((h) => h.kind === "keep")?.building);
  if (keep >= 0) plots.set(keep, "keep");
  const tavern = plotOf(spots.find((h) => h.kind === "tavern")?.building);
  if (tavern >= 0) plots.set(tavern, "tavern");
  const castle = city.districts.find((d) => /castle|citadel|keep|palace/i.test(d.name));
  if (castle) B.forEach((_, i) => { if (free(i) && inside(C[i]!, castle.ring) && A[i]! > 60) plots.set(i, "castle"); });
  const inCastle = (i: number) => !!castle && inside(C[i]!, castle.ring);

  // The guildhall: the biggest building fronting the market square.
  const market = [...city.squares].sort((a, b) => area(b) - area(a))[0];
  const marketAt = market ? centroid(market) : centre;
  if (market && size !== "town") {
    const fronting = B.map((_, i) => i).filter((i) => free(i) && B[i]!.some((p) => distToRing(p, market) < 4)).sort((x, y) => A[y]! - A[x]!);
    if (fronting[0] !== undefined && A[fronting[0]]! > 150) plots.set(fronting[0], "guildhall");
  }

  // Inns by the other gates (inside the wall, on the road); stables just outside each gate.
  const gateList = gates(city);
  const innGates = new Map<number, string>();
  // Inns at the busiest other gates (gates come sorted by the length of their road): three at most.
  const innAt = size === "large" ? gateList.slice(1, 4) : size === "city" ? gateList.slice(1, 2) : [];
  for (const g of innAt) {
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !inCastle(i) && inWall(C[i]!) && A[i]! >= 120 && A[i]! <= 500 && dist(C[i]!, g) < 90 && city.roads.some((r) => distToPolyline(C[i]!, r.points) < r.width / 2 + 12))
      .sort((x, y) => dist(C[x]!, g) - dist(C[y]!, g))[0];
    if (best !== undefined) {
      plots.set(best, "inn");
      innGates.set(best, compass(centre, g));
    }
  }
  if (walled) for (const g of size === "town" ? gateList.slice(0, 1) : gateList) {
    const best = B.map((_, i) => i).filter((i) => free(i) && !inWall(C[i]!) && A[i]! >= 50 && A[i]! <= 350 && dist(C[i]!, g) < 70).sort((x, y) => dist(C[x]!, g) - dist(C[y]!, g))[0];
    if (best !== undefined) plots.set(best, "stable");
  }

  // Parish chapels in the big districts that have no temple.
  if (size === "large") {
    const templeDistrict = temple >= 0 ? city.districts.find((d) => inside(C[temple]!, d.ring)) : undefined;
    const chosen: number[] = [];
    for (const d of city.districts) {
      if (d === castle || d === templeDistrict || chosen.length >= 4) continue;
      const members = B.map((_, i) => i).filter((i) => inside(C[i]!, d.ring));
      if (members.length < 80) continue;
      const dc = centroid(d.ring);
      const best = members.filter((i) => free(i) && A[i]! >= 100 && A[i]! <= 450 && aspectOf(B[i]!) <= 2.2).sort((x, y) => dist(C[x]!, dc) - dist(C[y]!, dc))[0];
      if (best !== undefined) { plots.set(best, "parish"); chosen.push(best); }
    }
  }

  // The wizard's tower: the squarest mid-sized plot a short walk from the market.
  if (size === "large") {
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !inCastle(i) && inWall(C[i]!) && A[i]! >= 70 && A[i]! <= 280 && dist(C[i]!, marketAt) >= 80 && dist(C[i]!, marketAt) <= 350)
      .map((i) => ({ i, score: aspectOf(B[i]!) + Math.abs(dist(C[i]!, marketAt) - 180) / 600 }))
      .sort((x, y) => x.score - y.score)[0];
    if (best) plots.set(best.i, "wizard");
  }

  // Warehouses by the piers.
  const piers = piersOf(city);
  const cap = { town: 2, city: 6, large: 14 }[size];
  const byPier = B.map((_, i) => i)
    .filter((i) => free(i) && !inCastle(i))
    .map((i) => ({ i, d: Math.min(...piers.map((p) => Math.min(...B[i]!.map((q) => dist(q, p.land))))) }))
    .filter((x) => x.d < 25)
    .sort((x, y) => x.d - y.d)
    .slice(0, cap);
  for (const { i } of byPier) plots.set(i, "warehouse");

  // Country houses: outside the wall, or (no wall) next to the fields.
  const rural = new Set<number>();
  B.forEach((_, i) => {
    if (!free(i)) return;
    const out = walled ? !inWall(C[i]!) : farms && city.fields.some((f) => inside(C[i]!, f) || distToRing(C[i]!, f) < 40);
    if (out) rural.add(i);
  });

  // Shops in ordinary town houses, each trade where it does business (shops.ts): spread out,
  // never in a place of interest, the castle or a country cottage (a smith may work by the gate).
  const shops = new Map<number, Trade>();
  const square = market;
  const keepAt = keep >= 0 ? C[keep]! : castle ? centroid(castle.ring) : marketAt;
  const waterDist = (p: Pt) => Math.min(
    Infinity,
    ...piers.map((q) => dist(p, q.land)),
    ...city.water.map((w) => distToRing(p, w)),
    ...city.rivers.map((r) => Math.max(0, distToPolyline(p, r.points) - r.width / 2)),
  );
  const templeAt = temple >= 0 ? C[temple]! : marketAt;
  /** Out of town and by water, a tanner or a beggar may take a country plot. */
  const RURAL_OK = new Set<Trade>(["blacksmith", "tannery", "beggars_den", "furrier", "stonemason", "brewery", "shipwright", "smugglers_den"]);
  const placeTrade = (trade: Trade, salt: number) => {
    const info = TRADES[trade];
    if (trade === "fishmonger" && !coast && !river) return;
    if (info.needs === "coast" && !coast) return;
    if (info.needs === "water" && !coast && !river) return;
    const [aim, tol] = AIM[info.where];
    const [lo, hi] = info.plot ?? [trade === "blacksmith" || trade === "carpenter" ? 90 : 45, 450];
    const from = (p: Pt): number => {
      switch (info.where) {
        case "gate": return gateList.length ? Math.min(...gateList.map((g) => dist(p, g))) : dist(p, marketAt);
        case "water": return waterDist(p);
        case "keep": return dist(p, keepAt);
        case "temple": return dist(p, templeAt);
        case "square": return square ? distToRing(p, square) : dist(p, marketAt);
        default: return dist(p, marketAt);
      }
    };
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !shops.has(i) && !inCastle(i) && (RURAL_OK.has(trade) || !rural.has(i)) && A[i]! >= lo && A[i]! <= hi && [...shops.keys()].every((j) => dist(C[j]!, C[i]!) > 22))
      .map((i) => ({ i, s: Math.abs(from(C[i]!) - aim) / tol + hash(C[i]!, salt) * 0.35 }))
      .sort((x, y) => x.s - y.s || x.i - y.i)[0];
    if (best) shops.set(best.i, trade);
  };
  ROSTER[size].forEach((trade, k) => placeTrade(trade, k + 11));

  // Noble mansions: big plots inside the wall, a short walk from the keep (or the temple, or the
  // market), well apart. A town with a keep has its lord there; one without gets one manor.
  const nobles = new Map<number, string>();
  const nobleAt = keep >= 0 ? C[keep]! : temple >= 0 ? C[temple]! : marketAt;
  const manors = { town: keep >= 0 ? 0 : 1, city: 3, large: 6 }[size];
  for (let n = 0; n < manors; n++) {
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !shops.has(i) && !inCastle(i) && !rural.has(i) && inWall(C[i]!) && A[i]! >= 220 && A[i]! <= 1400 && aspectOf(B[i]!) <= 2.4 && [...nobles.keys()].every((j) => dist(C[j]!, C[i]!) > 45))
      .map((i) => ({ i, s: Math.abs(dist(C[i]!, nobleAt) - 110) / 120 + hash(C[i]!, 71 + n) * 0.3 }))
      .sort((x, y) => x.s - y.s || x.i - y.i)[0];
    if (!best) break;
    plots.set(best.i, "mansion");
    let name = nobleName(hash(C[best.i]!, 97));
    for (let k = 1; [...nobles.values()].includes(name); k++) name = nobleName(hash(C[best.i]!, 97 + k));
    nobles.set(best.i, name);
  }
  // The garrison: a big plot by the main gate (or the keep), cities and up.
  if (size !== "town") {
    const at = gateList[0] ?? keepAt;
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !shops.has(i) && A[i]! >= 250 && A[i]! <= 1600 && (!walled || inWall(C[i]!)))
      .map((i) => ({ i, s: Math.abs(dist(C[i]!, at) - 45) / 60 + hash(C[i]!, 83) * 0.2 }))
      .sort((x, y) => x.s - y.s || x.i - y.i)[0];
    if (best) plots.set(best.i, "garrison");
  }
  // An open town (no wall, so no stables by its gates) keeps a stable by a road at its edge.
  if (!walled) {
    const far = Math.max(1, ...C.map((c) => dist(c, marketAt)));
    const best = B.map((_, i) => i)
      .filter((i) => free(i) && !shops.has(i) && A[i]! >= 60 && A[i]! <= 400 && city.roads.some((r) => distToPolyline(C[i]!, r.points) < r.width / 2 + 10))
      .map((i) => ({ i, s: Math.abs(dist(C[i]!, marketAt) - far * 0.75) / (far * 0.3) + hash(C[i]!, 89) * 0.2 }))
      .sort((x, y) => x.s - y.s || x.i - y.i)[0];
    if (best) plots.set(best.i, "stable");
  }
  // Services, the law and the underworld (after the shops and the mansions, so neither moves).
  SERVICES[size].forEach((trade, k) => placeTrade(trade, k + 101));

  // The lighthouse: the point of land that reaches farthest out to sea near the harbour (or from
  // the centre, with no piers), clear of buildings, piers and roads.
  let lighthouse: Spot | undefined;
  if (coast && (size !== "town" || piers.length >= 3)) {
    const inSea = (p: Pt) => city.water.some((w) => inside(p, w));
    const harbour: Pt | undefined = piers.length ? [piers.reduce((s2, p) => s2 + p.land[0], 0) / piers.length, piers.reduce((s2, p) => s2 + p.land[1], 0) / piers.length] : undefined;
    let sx = piers.reduce((s2, p) => s2 + p.u[0], 0), sy = piers.reduce((s2, p) => s2 + p.u[1], 0);
    const sl = Math.hypot(sx, sy) || 1;
    sx /= sl; sy /= sl;
    const margin = 40, b = city.bounds;
    let best: { spot: Spot; score: number } | undefined;
    for (const w of city.water) for (let j = 0; j < w.length; j++) {
      const p = w[j]!, q = w[(j + 1) % w.length]!;
      const len = dist(p, q);
      if (len < 1e-6) continue;
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const s: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        if (s[0] < b.x + margin || s[1] < b.y + margin || s[0] > b.x + b.w - margin || s[1] > b.y + b.h - margin) continue;
        let n: Pt = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
        if (inSea([s[0] + n[0] * 3, s[1] + n[1] * 3])) n = [-n[0], -n[1]];
        const at: Pt = [s[0] + n[0] * 7, s[1] + n[1] * 7];
        if (inSea(at) || B.some((r, i) => dist(C[i]!, at) < 40 && (inside(at, r) || distToRing(at, r) < 9))) continue;
        if (wall && distToRing(at, wall.ring) < 10) continue;
        if (piers.some((pr) => distToPolyline(at, [pr.land, pr.sea]) < 20)) continue;
        if (city.roads.some((r) => distToPolyline(at, r.points) < r.width / 2 + 4)) continue;
        // Near a harbour: as far out along the piers' direction as the land goes, within 450 m.
        if (harbour && dist(at, harbour) > 450) continue;
        const score = harbour ? (at[0] - harbour[0]) * sx + (at[1] - harbour[1]) * sy - dist(at, harbour) * 0.15 : dist(at, centre);
        if (!best || score > best.score) best = { spot: { at, rot: Math.atan2(-n[1], -n[0]) }, score };
      }
    }
    lighthouse = best?.spot;
  }

  // Windmills in the fields, by a road, well apart.
  const windmills: Spot[] = [];
  if (farms) {
    const want = { town: 1, city: 2, large: 3 }[size];
    const cands = city.fields.map((f) => {
      const fc = centroid(f);
      // The field corner nearest a road, pulled 8 m into the field.
      const v = [...f].sort((a, b) => Math.min(...city.roads.map((r) => distToPolyline(a, r.points))) - Math.min(...city.roads.map((r) => distToPolyline(b, r.points))))[0]!;
      const d = dist(v, fc) || 1;
      const at: Pt = [v[0] + ((fc[0] - v[0]) / d) * Math.min(8, d / 2), v[1] + ((fc[1] - v[1]) / d) * Math.min(8, d / 2)];
      return { at, road: Math.min(...city.roads.map((r) => distToPolyline(at, r.points))) };
    }).filter((c) => !B.some((r, i) => dist(C[i]!, c.at) < 40 && distToRing(c.at, r) < 12) && !city.roads.some((r) => distToPolyline(c.at, r.points) < r.width / 2 + 4))
      .sort((a, b) => a.road - b.road);
    for (const c of cands) {
      if (windmills.length >= want) break;
      if (windmills.some((w) => dist(w.at, c.at) < 150)) continue;
      windmills.push({ at: c.at, rot: hash(c.at) * Math.PI * 2 });
    }
  }

  // Fountains: the market's monument becomes a grand or large fountain; others a small one.
  const fountains: Places["fountains"] = [];
  for (const pr of city.prisms) {
    const at = centroid(pr);
    const onMarket = !!market && inside(at, market);
    const sz = onMarket ? (size === "large" && area(market!) >= 900 ? "grand" : size !== "town" ? "large" : undefined) : "medium";
    if (sz) fountains.push({ at, rot: 0, size: sz });
  }

  // A gatehouse over the main gate of a large walled city, along the wall.
  const gatehouses: Spot[] = [];
  const main = gateList[0];
  if (wall && size === "large" && main) {
    let best = Infinity, rot = 0;
    for (let j = 0; j < wall.ring.length; j++) {
      const p = wall.ring[j]!, q = wall.ring[(j + 1) % wall.ring.length]!;
      const d = distToPolyline(main, [p, q]);
      if (d < best) { best = d; rot = Math.atan2(q[1] - p[1], q[0] - p[0]); }
    }
    gatehouses.push({ at: main, rot });
  }

  return { size, coast, river, walled, farms, plots, rural, shops, nobles, piers, lighthouse, windmills, fountains, gatehouses, innGates };
}

/**
 * Every place with a pin: the hot spots built when a city opens, and the places built when the
 * DM first opens them (the wizard's tower, the lighthouse, inns).
 */
export function allHotSpots(city: City, places = cityPlaces(city)): HotSpot[] {
  const out = findHotSpots(city);
  const B = city.buildings;
  const C0 = (i: number) => centroid(B[i]!);
  // Ids stay unique: a second place of the same name gets a number.
  const used = new Set(out.map((h) => h.id));
  const idFor = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  for (const [i, kind] of places.plots) {
    if (kind === "wizard") out.push({ id: idFor("wizard"), kind: "wizard", label: "Wizard's tower", at: centroid(B[i]!), building: B[i]!, onDemand: true });
    if (kind === "inn") {
      const dir = places.innGates.get(i) ?? "";
      out.push({ id: idFor(`inn-${dir || i}`), kind: "inn", label: dir ? `Inn by the ${dir} gate` : "Inn", at: centroid(B[i]!), building: B[i]!, onDemand: true });
    }
  }
  if (places.lighthouse) out.push({ id: idFor("lighthouse"), kind: "lighthouse", label: "Lighthouse", at: places.lighthouse.at, area: boxAround(places.lighthouse.at, 55), onDemand: true });
  // Shops: a street-level map of the shop and its frontage, so it matches every other street map.
  const around = (i: number, min: number) => {
    const bb = bboxOf(B[i]!);
    return boxAround([bb.x + bb.w / 2, bb.y + bb.h / 2], Math.max(min, bb.w + 16, bb.h + 16));
  };
  for (const [i, trade] of places.shops) {
    const t = TRADES[trade];
    out.push({ id: idFor(`shop-${trade}`), kind: "shop", trade, label: t.label, at: centroid(B[i]!), area: around(i, 26), onDemand: true, icon: t.icon, ...(t.secret ? { secret: true } : {}) });
  }
  // Mansions, the garrison and stables: street-level maps of the building and its grounds.
  const gateAt = gates(city);
  const middle = places.walled ? centroid(cityWall(city)!.ring) : [city.bounds.x + city.bounds.w / 2, city.bounds.y + city.bounds.h / 2] as Pt;
  for (const [i, kind] of places.plots) {
    if (kind === "mansion") {
      const name = places.nobles.get(i) ?? "";
      out.push({ id: idFor(`mansion-${name.toLowerCase() || i}`), kind: "mansion", label: name ? `Mansion of House ${name}` : "Mansion", at: centroid(B[i]!), area: around(i, 32), onDemand: true, icon: "icons/svg/tower-flag.svg" });
    }
    if (kind === "garrison") out.push({ id: idFor("garrison"), kind: "garrison", label: "Garrison", at: centroid(B[i]!), area: around(i, 32), onDemand: true, icon: "icons/svg/combat.svg" });
    if (kind === "stable") {
      const g = gateAt.slice().sort((a, b) => dist(a, C0(i)) - dist(b, C0(i)))[0];
      const label = g && dist(g, C0(i)) < 120 ? `Stables by the ${compass(middle, g)} gate` : "Stables";
      out.push({ id: idFor("stables"), kind: "stable", label, at: centroid(B[i]!), area: around(i, 28), onDemand: true, icon: "icons/svg/pawprint.svg" });
    }
  }
  return out;
}
