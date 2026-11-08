/**
 * Houses from 2MT art. The city generator's building outlines become plots, and every plot
 * gets 2MT roof drawings, used as drawn (turned and scaled, never stretched):
 *
 * - Places of interest get art chosen for what they are: the temple a church roof (a chapel
 *   with its spire when small), the keep the Castle Keep roof, other castle buildings keep
 *   and tower roofs, the tavern by the gate a thatched tavern roof, the biggest building on the
 *   market square a guildhall, buildings by the piers warehouse roofs.
 * - Ordinary plots are filled along their street side with rows of house roofs (Prefab
 *   Rooftops, Town Center rooftops, Medieval City Center corner buildings, the Buildings Pack),
 *   a back row on deep plots, the rest of the plot left as yard.
 * - Plots no row fits (slanted wedges, odd shapes) get the single drawing that covers their
 *   shape best (largest overlap over union).
 *
 * The same layout feeds the city scene and the street maps, so the two agree house for house.
 */

import { PX_PER_SQUARE, type AssetIndex, type AssetRecord } from "../assets/model";
import { Rng } from "../gen/rng";
import { area, centroid, clipRing, distToPolyline, inside, M_PER_SQUARE, type City, type Pt, type Ring } from "./city";
import { cityPlaces, type Pier, type Places, type PlotLandmark } from "./places";
import { cleanRing } from "./roof";

/** Art placed on its own, not in a plot: towers over gates, fountains, mills, ships. */
export type Feature = "spire" | "lighthouse" | "windmill" | "fountain_grand" | "fountain_large" | "fountain_medium" | "gatehouse" | "ship_large" | "ship_medium" | "ship_small" | "ship_sailing" | "barge";
export type Landmark = PlotLandmark | Feature;

export interface HouseArt {
  asset: AssetRecord;
  /** The drawing's size (trimmed of its transparent margin), metres, along the image's x and y. */
  w: number;
  h: number;
  /** Centre of the drawing minus the centre of the image, metres, image axes. */
  off: Pt;
  /** Landmark-sized pieces (corner buildings, the tavern rooftop): used sparingly, only on deep plots. */
  big: boolean;
  /** What the drawing is for: a town house, a country house, or one kind of place or feature. */
  role: "house" | "rural" | Landmark;
}

/** Whole-roof drawings, by role, as [name, pack] patterns. One drawing can serve several roles. */
const ART: Record<HouseArt["role"], Array<[RegExp, RegExp]>> = {
  house: [
    [/^prefabrooftops_roof [1-8] - /, /Prefab Rooftops/],
    [/^prefabrooftops_simple roof - (red|blue) - 8x6$/, /Prefab Rooftops/],
    [/^prefabrooftops_typical tavern rooftop/, /Prefab Rooftops/],
    [/^Rooftop [234]$/, /Town Center Pack/],
    [/^Building Right Angle [12]( Extended)?$/, /Medieval City Center/],
    [/^Building \d+ - Roof - (Red|Blue) - \d+x\d+$/, /^2MT Buildings Pack$/],
  ],
  // Country houses: slate cottages and detailed thatch (the yellow cottage and the flat 6x4 thatch read as bright blocks from far out).
  rural: [
    [/^Cottage - Roof - Large - (Red|Blue) - Prefab$/, /Bumblebee Farm/],
    [/^Sinister Cabin - Occupied - Light - Roof - 12x9$/, /^2M Sinister Cabin$/],
    [/^Cottage Exterior - Prefab A$/, /Creepy Cabin/],
  ],
  church: [[/^Library Roof$/, /Medieval City Center/]],
  chapel: [[/^Chapel - Roof - Large$/, /Wedding Chapel/]],
  parish: [[/^Chapel Prefab - Whitewashed - (Red|Blue)$/, /Wedding Chapel/], [/^Building, Chapel$/, /Haunted Graveyard/]],
  spire: [[/^Chapel - Roof - Spire$/, /Wedding Chapel/]],
  keep: [[/^Castle Keep, roof \(14x14\)/, /Castle Keep/]],
  castle: [[/^square keep, roof 1 /, /Square Keep/], [/^Great Tower, roof \(9x9\)$/, /Castle Tower/]],
  tavern: [[/^Thatch Roof$/, /Typical Tavern/]],
  inn: [[/^Tavern - (Main|Side) - Roof$/, /2-Minute Tavern/]],
  guildhall: [[/^prefabrooftops_haunted mansion rooftop/, /Prefab Rooftops/], [/^Rooftop 5$/, /Town Center Pack/]],
  warehouse: [[/^shipyard_warehouse roof$/, /Shipyard Pack/], [/^simplestable_roof$/, /^2M Simple Stable$/]],
  stable: [[/^simplestable_roof$/, /^2M Simple Stable$/]],
  wizard: [[/^Wizards Tower - Roof - 12x12/, /Wizards Tower/]],
  // Noble mansions: the great town houses; the garrison: a stone keep or tower.
  mansion: [[/^prefabrooftops_haunted mansion rooftop/, /Prefab Rooftops/], [/^Rooftop 5$/, /Town Center Pack/], [/^Building Right Angle [12] Extended$/, /Medieval City Center/]],
  garrison: [[/^square keep, roof 1 /, /Square Keep/], [/^Great Tower, roof \(9x9\)$/, /Castle Tower/]],
  lighthouse: [[/^lighthouse_lighthouse, roof \(8x8\)$/, /^2M Lighthouse$/]],
  windmill: [[/^Windmill \(6x6\)$/, /Harvest Horror/]],
  fountain_grand: [[/^Prefab - Neptune Fountain$/, /Statue Map Assets/]],
  fountain_large: [[/^Fountain - Large - Basic$/, /Statue Map Assets/]],
  fountain_medium: [[/^Fountain - Medium - Basic$/, /Statue Map Assets/]],
  gatehouse: [[/^Gatehouse, roof \(18x13\)$/, /Castle Gatehouse/]],
  // The Galleon pack's "prefab, sails (22x7)" image is the bare hull, sails furled: a ship tied up.
  ship_large: [[/^Galleon, prefab, sails \(22x7\)$/, /^2MT Galleon$/]],
  ship_sailing: [[/^Galleon, prefab \(26x9\)$/, /^2MT Galleon$/]],
  ship_medium: [[/^Viking Longship \(18x4\)$/, /Viking Longship/], [/^sailingship__example, top\(10x5\)$/, /Sailing Ship Assets/], [/^Boat - 8x14$/, /Rocky Fissures/]],
  ship_small: [[/^Rowboat \(10x4\)$/, /^2M Rowboat$/], [/^Rowboat 1 - 4x3$/, /Descending Dungeon/], [/^junglewetland_skiff, row boat$/, /Jungle Wetland/]],
  barge: [[/^junglewetland_river barge$/, /Jungle Wetland/]],
};

export function houseArtFrom(index: AssetIndex): HouseArt[] {
  const packs = new Map(index.packs.map((p) => [p.id, p]));
  const m = M_PER_SQUARE / PX_PER_SQUARE;
  const out: HouseArt[] = [];
  for (const a of [...index.assets].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.kind !== "object" || a.colorable || a.error || !a.size[0] || packs.get(a.pack)?.readAllowed === false) continue;
    const pack = packs.get(a.pack)?.name ?? "";
    for (const [role, list] of Object.entries(ART) as Array<[HouseArt["role"], Array<[RegExp, RegExp]>]>) {
      if (!list.some(([n, p]) => n.test(a.name) && p.test(pack))) continue;
      // Very large images were not trimmed when indexed; their art fills the image.
      const [tx, ty, tw, th] = a.trim ?? [0, 0, a.size[0], a.size[1]];
      const w = tw * m, h = th * m;
      out.push({ asset: a, w, h, off: [(tx + tw / 2 - a.size[0] / 2) * m, (ty + th / 2 - a.size[1] / 2) * m], big: role === "house" && Math.max(w, h) > 20, role });
    }
  }
  return out;
}

export interface PlacedHouse {
  art: HouseArt;
  /** Centre of the drawing (metres). */
  at: Pt;
  /** The image's rotation, radians, clockwise on screen. */
  rot: number;
  scale: number;
  /** The drawing's box as placed (metres). */
  ring: Ring;
  /** The drawing's own outline as placed (metres), when it was traced; walls and shadows follow it. */
  walls?: Ring;
  /** The wall that faces the street, for the door. */
  front: [Pt, Pt];
  /** The plot (index into city.buildings), or -1 for features placed on their own. */
  plot: number;
  /** Set on places of interest and features. */
  landmark?: Landmark;
}

export interface HouseLayout {
  houses: PlacedHouse[];
  /** Plots with nothing on them (only when there is no art at all). */
  bare: number[];
  /** Plot index of each place of interest that got its drawing. */
  landmarks: Partial<Record<Landmark, number[]>>;
  /** Features on their own: lighthouse, windmills, fountains, the gatehouse, ships and barges. */
  extras: PlacedHouse[];
  /** The rules' choices (city size, location, places). */
  places: Places;
}

interface Frame {
  c: Pt;
  u: Pt;
  v: Pt;
  L: number;
  D: number;
}

/** The smallest box round a ring, with its long side along u. */
function minFrame(r: Ring): Frame {
  let best: Frame | undefined;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    let u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let v: Pt = [-u[1], u[0]];
    const us = r.map((p) => p[0] * u[0] + p[1] * u[1]), vs = r.map((p) => p[0] * v[0] + p[1] * v[1]);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    let L = u1 - u0, D = v1 - v0;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const c: Pt = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
    if (D > L) {
      [L, D] = [D, L];
      [u, v] = [v, [-v[1], v[0]]];
    }
    if (!best || L * D < best.L * best.D) best = { c, u, v, L, D };
  }
  return best!;
}

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

const at = (f: Frame, a: number, b: number): Pt => [f.c[0] + f.u[0] * a + f.v[0] * b, f.c[1] + f.u[1] * a + f.v[1] * b];

/** A placed drawing centred at (cu, cv) in the plot's frame. */
function placed(f: Frame, art: HouseArt, turned: boolean, sc: number, cu: number, cv: number, s: number, flip: boolean, plot: number, landmark?: Landmark): PlacedHouse {
  const along = (turned ? art.h : art.w) * sc, across = (turned ? art.w : art.h) * sc;
  const ring: Ring = [at(f, cu - along / 2, cv - across / 2), at(f, cu + along / 2, cv - across / 2), at(f, cu + along / 2, cv + across / 2), at(f, cu - along / 2, cv + across / 2)];
  const base = Math.atan2(f.u[1], f.u[0]) + (turned ? Math.PI / 2 : 0);
  const fv = cv + (s * across) / 2;
  const rot = base + (flip ? Math.PI : 0), centre = at(f, cu, cv);
  // The traced outline, from the drawing's own axes to the plot: scale, turn, move.
  const c = Math.cos(rot), sn = Math.sin(rot);
  const walls = art.asset.outline?.map(([u, v]): Pt => {
    const x = (u - 0.5) * art.w * sc, y = (v - 0.5) * art.h * sc;
    return [centre[0] + x * c - y * sn, centre[1] + x * sn + y * c];
  });
  return { art, at: centre, rot, scale: sc, ring, ...(walls && walls.length >= 3 ? { walls } : {}), front: [at(f, cu - along / 2, fv), at(f, cu + along / 2, fv)], plot, ...(landmark ? { landmark } : {}) };
}

/**
 * The one drawing from `pool` that covers the plot best: centred on the plot's box, along its
 * long side or across it, at the uniform scale (within lo..hi) that gives the largest overlap
 * over union with the outline.
 */
function bestFit(r: Ring, f: Frame, pool: HouseArt[], lo: number, hi: number, rng: Rng): { art: HouseArt; turned: boolean; sc: number; iou: number } | undefined {
  // The outline in the frame's own coordinates, where a placed drawing is an axis-aligned box.
  const q: Ring = r.map((p) => [(p[0] - f.c[0]) * f.u[0] + (p[1] - f.c[1]) * f.u[1], (p[0] - f.c[0]) * f.v[0] + (p[1] - f.c[1]) * f.v[1]]);
  const A = area(q);
  let best: { art: HouseArt; turned: boolean; sc: number; iou: number; score: number } | undefined;
  for (const art of pool) for (const turned of [false, true]) {
    const along = turned ? art.h : art.w, across = turned ? art.w : art.h;
    const fitIn = Math.min(f.L / along, f.D / across), sameArea = Math.sqrt((f.L * f.D) / (along * across));
    for (const s0 of [fitIn, sameArea, (fitIn + sameArea) / 2]) {
      const sc = Math.max(lo, Math.min(hi, s0));
      const a = along * sc, b = across * sc;
      const inter = clipRing(q, { x: -a / 2, y: -b / 2, w: a, h: b });
      const I = inter.length >= 3 ? area(inter) : 0;
      const iou = I / (A + a * b - I);
      const score = iou - Math.abs(1 - sc) * 0.08 + rng.range(0, 0.02);
      if (!best || score > best.score) best = { art, turned, sc, iou, score };
    }
  }
  return best;
}

/** Lays 2MT houses into every plot of the city. Deterministic for a seed. */
export function placeHouses(city: City, art: HouseArt[], seed: string): HouseLayout {
  const houses: PlacedHouse[] = [], bare: number[] = [];
  const landmarks: HouseLayout["landmarks"] = {};
  const pool = art.filter((a) => a.role === "house");
  if (!pool.length) return { houses, bare: city.buildings.map((_, i) => i), landmarks, extras: [], places: cityPlaces(city) };
  const byRole = (role: Landmark) => art.filter((a) => a.role === role);
  const B = city.buildings;
  // A coarse grid of plots, to ask "is this point inside another building?" quickly.
  const CELL = 25;
  const grid = new Map<string, number[]>();
  B.forEach((r, i) => {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gy = Math.floor(Math.min(...ys) / CELL); gy <= Math.floor(Math.max(...ys) / CELL); gy++) {
        const k = `${gx},${gy}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  });
  const built = (p: Pt, except: number) => (grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []).some((j) => j !== except && inside(p, B[j]!));
  // The street side of a plot: the long side whose outside is open ground.
  const streetSide = (i: number, f: Frame) => {
    const open = (s: number) => [-f.L / 3, 0, f.L / 3].filter((t) => !built(at(f, t, s * (f.D / 2 + 1.5)), i)).length;
    return open(1) >= open(-1) ? 1 : -1;
  };

  // Places of interest and country plots, by the rules in places.ts.
  const places = cityPlaces(city);
  const role = places.plots as Map<number, Landmark>;
  const ruralPool = art.filter((a) => a.role === "rural");

  /**
   * One row of houses along a side of the plot (s = +1 or -1), using `depth` metres of it from that
   * side. Each step takes the drawing that best fills the depth without stretching (uniform scale
   * lo..hi); slanted plot ends that refuse every drawing are stepped over a metre at a time.
   */
  const packRow = (i: number, r: Ring, f: Frame, s: number, depth: number, rng: Rng, lo: number, hi: number, allowBig: boolean, tol = 0.6, from: HouseArt[] = pool): PlacedHouse[] => {
    const fits = (ring: Ring) => ring.every((p) => inside(p, r) || distToRing(p, r) < tol);
    const minAlong = Math.min(...from.map((a) => Math.min(a.w, a.h))) * 0.85;
    const row: PlacedHouse[] = [];
    let t = -f.L / 2;
    let last: HouseArt | undefined;
    let bigUsed = false;
    while (f.L / 2 - t >= (minAlong * lo) / 0.85) {
      const room = f.L / 2 - t;
      const options: Array<{ a: HouseArt; turned: boolean; sc: number; score: number }> = [];
      for (const a of from) {
        if (a.big && (!allowBig || bigUsed || depth < 13)) continue;
        for (const turned of [false, true]) {
          const along = turned ? a.h : a.w, across = turned ? a.w : a.h;
          // As near natural size as the room allows; grow a little to fill the depth.
          let sc = Math.min(hi, room / along, (depth * 1.03) / across);
          if (sc > 1) sc = Math.max(1, Math.min(sc, (depth * 0.95) / across));
          if (sc < lo) continue;
          const fill = (across * sc) / depth;
          if (fill < 0.6) continue;
          const rest = room - along * sc;
          const score = 2 * fill - Math.abs(1 - sc) + (rest < 0.6 || rest >= minAlong ? 0.4 : 0) - (a === last ? 0.6 : 0) - (a.big ? 0.3 : 0) + rng.range(0, 0.5);
          options.push({ a, turned, sc, score });
        }
      }
      options.sort((x, y) => y.score - x.score);
      let done = false;
      for (const o of options) {
        for (const shrink of [1, 0.92]) {
          const sc = Math.max(lo, o.sc * shrink);
          const along = (o.turned ? o.a.h : o.a.w) * sc, across = (o.turned ? o.a.w : o.a.h) * sc;
          const h = placed(f, o.a, o.turned, sc, t + along / 2, s * (f.D / 2 - across / 2), s, rng.next() < 0.5, i);
          if (!fits(h.ring)) continue;
          row.push(h);
          t += along;
          last = o.a;
          bigUsed ||= o.a.big;
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) t += 1;
    }
    return row;
  };

  B.forEach((outline, i) => {
    const r = cleanRing(outline);
    if (r.length < 3) return void bare.push(i);
    const f = minFrame(r);
    const rng = new Rng(`${seed}:house:${i}`);
    const s = streetSide(i, f);

    // A place of interest: its own drawing, fitted to the whole plot.
    const lm = role.get(i);
    const lmArt = lm ? byRole(lm) : [];
    if (lm && lmArt.length) {
      const [lo, hi] = LANDMARK_SCALE[lm as PlotLandmark] ?? [0.5, 2.5];
      const fit = bestFit(r, f, lmArt, lo, hi, rng);
      if (fit) {
        const h = placed(f, fit.art, fit.turned, fit.sc, 0, 0, s, rng.next() < 0.5, i, lm);
        houses.push(h);
        (landmarks[lm] ??= []).push(i);
        // A chapel gets its spire over the gable at one end.
        const spire = lm === "chapel" ? byRole("spire")[0] : undefined;
        if (spire) {
          const len = Math.max(fit.turned ? fit.art.h : fit.art.w, fit.turned ? fit.art.w : fit.art.h) * fit.sc;
          const sAlong = Math.max(spire.w, spire.h) * fit.sc * 0.8;
          const along = (fit.turned ? fit.art.h : fit.art.w) >= (fit.turned ? fit.art.w : fit.art.h);
          const cu = along ? len / 2 - sAlong / 2 : 0, cv = along ? 0 : len / 2 - sAlong / 2;
          houses.push(placed(f, spire, false, fit.sc * 0.8, cu, cv, s, false, i, "spire"));
        }
        return;
      }
    }

    // Ordinary plots: rows along the street side; deep plots take a back row as well. Country
    // plots mostly take cottages and thatch.
    const from = places.rural.has(i) && ruralPool.length && rng.next() < 0.75 ? ruralPool : pool;
    const two = f.D >= 17;
    let row = packRow(i, r, f, s, two ? f.D * 0.55 : f.D, rng, 0.8, 1.2, !two, 0.6, from);
    if (two && row.length) {
      // The back row gets what the front row left of the depth.
      const across = Math.max(...row.map((h) => {
        const ds = h.ring.map((p) => (p[0] - f.c[0]) * f.v[0] + (p[1] - f.c[1]) * f.v[1]);
        return Math.max(...ds) - Math.min(...ds);
      }));
      const rest = f.D - across - 0.4;
      if (rest >= 6) row = row.concat(packRow(i, r, f, -s, rest, rng, 0.8, 1.2, false, 0.6, from));
    }
    // Odd plots nothing fits at near size: one more try with more give in the scale.
    if (!row.length) row = packRow(i, r, f, s, f.D, rng, 0.65, 1.35, true, 1.6);
    // Still nothing: the single drawing that best covers the shape.
    if (!row.length) {
      const fit = bestFit(r, f, pool, 0.6, 1.6, rng);
      if (fit) row = [placed(f, fit.art, fit.turned, fit.sc, 0, 0, s, rng.next() < 0.5, i)];
    }
    if (row.length) houses.push(...row);
    else bare.push(i);
  });
  const extras = placeFeatures(city, places, art, seed);
  return { houses, bare, landmarks, extras, places };
}

/** Uniform scale range for each place of interest fitted to its plot. */
const LANDMARK_SCALE: Partial<Record<PlotLandmark, [number, number]>> = {
  warehouse: [0.7, 1.6],
  stable: [0.6, 1.6],
  keep: [0.5, 3.2],
  wizard: [0.6, 2],
  inn: [0.6, 1.8],
  parish: [0.6, 1.7],
  mansion: [0.6, 2.2],
  garrison: [0.6, 2.6],
};

/** A rectangle centred at c, long side L along angle a, short side W. */
function boxRing(c: Pt, a: number, L: number, W: number): Ring {
  const u: Pt = [Math.cos(a), Math.sin(a)], v: Pt = [-u[1], u[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [c[0] + (u[0] * x! * L) / 2 + (v[0] * y! * W) / 2, c[1] + (u[1] * x! * L) / 2 + (v[1] * y! * W) / 2] as Pt);
}

/** Do two convex rings overlap? (Separating axes.) */
function overlap(a: Ring, b: Ring): boolean {
  for (const r of [a, b]) for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const n: Pt = [-(q[1] - p[1]), q[0] - p[0]];
    const pa = a.map((x) => x[0] * n[0] + x[1] * n[1]), pb = b.map((x) => x[0] * n[0] + x[1] * n[1]);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** Points spread over a ring's area: corners, edge midpoints and the centre. */
function samples(r: Ring): Pt[] {
  const c = centroid(r);
  const out: Pt[] = [c];
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    out.push(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], [(p[0] + c[0]) / 2, (p[1] + c[1]) / 2]);
  }
  return out;
}

/** A feature placed with its drawing's long side along angle `a` (ships) or its x axis at `a`. */
function feature(art: HouseArt, at: Pt, a: number, scale: number, alongLong: boolean, landmark: Landmark): PlacedHouse {
  const horizontal = art.w >= art.h;
  const rot = alongLong && !horizontal ? a - Math.PI / 2 : a;
  const L = Math.max(art.w, art.h) * scale, W = Math.min(art.w, art.h) * scale;
  const ring = alongLong ? boxRing(at, a, L, W) : boxRing(at, rot, art.w * scale, art.h * scale);
  const c = Math.cos(rot), s = Math.sin(rot);
  const walls = art.asset.outline?.map(([u, v]): Pt => {
    const x = (u - 0.5) * art.w * scale, y = (v - 0.5) * art.h * scale;
    return [at[0] + x * c - y * s, at[1] + x * s + y * c];
  });
  return { art, at, rot, scale, ring, ...(walls && walls.length >= 3 ? { walls } : {}), front: [at, at], plot: -1, landmark };
}

/**
 * The features on their own: the lighthouse, windmills, fountains, the gatehouse, ships at the
 * piers and at anchor, barges on the river.
 */
function placeFeatures(city: City, places: Places, art: HouseArt[], seed: string): PlacedHouse[] {
  const rng = new Rng(`${seed}:features`);
  const of = (role: Landmark) => art.filter((a) => a.role === role);
  const out: PlacedHouse[] = [];
  const one = (role: Landmark, salt: number) => { const list = of(role); return list.length ? list[salt % list.length] : undefined; };

  const lh = one("lighthouse", 0);
  if (lh && places.lighthouse) out.push(feature(lh, places.lighthouse.at, places.lighthouse.rot, 1, false, "lighthouse"));
  const mill = one("windmill", 0);
  if (mill) for (const w of places.windmills) out.push(feature(mill, w.at, w.rot, 1, false, "windmill"));
  for (const f of places.fountains) {
    const role = `fountain_${f.size}` as Landmark;
    const a = one(role, 0) ?? one("fountain_medium", 0);
    if (a) out.push(feature(a, f.at, 0, 1, false, role));
  }
  const gh = one("gatehouse", 0);
  if (gh) for (const g of places.gatehouses) out.push(feature(gh, g.at, g.rot, 1.15, false, "gatehouse"));

  // Ships. Water they may use: the sea, clear of the piers and of each other.
  const inSea = (p: Pt) => city.water.some((w) => inside(p, w));
  const pierBoxes = places.piers.map((p) => boxRing([(p.land[0] + p.sea[0]) / 2, (p.land[1] + p.sea[1]) / 2], Math.atan2(p.u[1], p.u[0]), p.length + 1, p.width + 0.6));
  const taken: Ring[] = [...pierBoxes];
  const b = city.bounds;
  const free = (r: Ring) => samples(r).every((p) => inSea(p) && p[0] > b.x && p[1] > b.y && p[0] < b.x + b.w && p[1] < b.y + b.h) && !taken.some((t) => overlap(t, r));
  const tryShip = (roles: Landmark[], pier: Pier, side: number, k: number): boolean => {
    for (const role of roles) {
      const pool = rng.shuffle([...of(role)]);
      for (const a of pool) {
        const L = Math.max(a.w, a.h), W = Math.min(a.w, a.h);
        const n: Pt = [-pier.u[1] * side, pier.u[0] * side];
        const off = pier.width / 2 + W / 2 + 0.8;
        for (const t of [pier.length - L / 2 - 1.5, pier.length / 2 + L / 4, L / 2 + 3]) {
          if (t < L / 2 + 1) continue;
          const c: Pt = [pier.land[0] + pier.u[0] * t + n[0] * off, pier.land[1] + pier.u[1] * t + n[1] * off];
          const heading = Math.atan2(pier.u[1], pier.u[0]) + ((k + side) % 2 === 0 ? 0 : Math.PI);
          const ship = feature(a, c, heading, 1, true, role);
          if (!free(ship.ring)) continue;
          taken.push(ship.ring);
          out.push(ship);
          return true;
        }
      }
    }
    return false;
  };
  const size = places.size;
  places.piers.forEach((pier, k) => {
    const sides = (k * 7 + 3) % 2 === 0 ? [1, -1] : [-1, 1];
    const first: Landmark[] = size === "large" ? (k % 2 === 0 ? ["ship_large", "ship_medium", "ship_small"] : ["ship_medium", "ship_small"]) : size === "city" ? (k % 2 === 0 ? ["ship_medium", "ship_small"] : ["ship_small"]) : ["ship_small"];
    const second: Landmark[] = ["ship_small"];
    const busy = size === "large" ? 0.85 : size === "city" ? 0.7 : 0.55;
    if (rng.next() < busy) tryShip(first, pier, sides[0]!, k);
    if (rng.next() < busy * 0.6) tryShip(second, pier, sides[1]!, k);
  });
  // Big ships at anchor out in the bay, sails set, broadside to the shore.
  const anchored = { town: 0, city: 1, large: 2 }[size];
  const sailing = of("ship_sailing");
  if (anchored && sailing.length && places.piers.length) {
    const hc: Pt = [places.piers.reduce((s2, p) => s2 + p.sea[0], 0) / places.piers.length, places.piers.reduce((s2, p) => s2 + p.sea[1], 0) / places.piers.length];
    let ux = places.piers.reduce((s2, p) => s2 + p.u[0], 0), uy = places.piers.reduce((s2, p) => s2 + p.u[1], 0);
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    let n = 0;
    const heading = Math.atan2(uy, ux) + Math.PI / 2 + rng.range(-0.3, 0.3);
    outer: for (const d of [70, 100, 130, 160]) for (const o of [-70, 70, -30, 30, 0, -110, 110]) {
      if (n >= anchored) break outer;
      const c: Pt = [hc[0] + ux * d - uy * o, hc[1] + uy * d + ux * o];
      const ship = feature(sailing[n % sailing.length]!, c, heading, 1, true, "ship_sailing");
      // Keep a ship's length of open water round it.
      const clear = boxRing(c, heading, Math.max(ship.art.w, ship.art.h) + 24, Math.min(ship.art.w, ship.art.h) + 24);
      if (!free(clear)) continue;
      taken.push(clear);
      out.push(ship);
      n++;
    }
  }

  // Barges moored along the river banks, inside the walls, away from bridges.
  const barges = of("barge");
  if (places.river && barges.length) {
    const want = { town: 1, city: 2, large: 4 }[size];
    const bridges = city.planks.filter((p) => p.points.length >= 2 && !p.points.some(inSea));
    const wall = city.walls.find((w) => city.buildings.filter((bd) => inside(centroid(bd), w.ring)).length > city.buildings.length / 3);
    const placedBarges: Pt[] = [];
    for (const rv of city.rivers) {
      const pts = rv.points;
      for (let i = 0; i + 1 < pts.length && placedBarges.length < want; i++) {
        const p = pts[i]!, q = pts[i + 1]!;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 1e-6) continue;
        const u: Pt = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        for (let t = 12; t < len - 12 && placedBarges.length < want; t += 18) {
          const m: Pt = [p[0] + u[0] * t, p[1] + u[1] * t];
          if (wall && !inside(m, wall.ring)) continue;
          if (inSea(m) || bridges.some((br) => distToPolyline(m, br.points) < 30) || placedBarges.some((x) => Math.hypot(x[0] - m[0], x[1] - m[1]) < 70)) continue;
          const a = barges[placedBarges.length % barges.length]!;
          const W = Math.min(a.w, a.h);
          const side = placedBarges.length % 2 === 0 ? 1 : -1;
          const off = rv.width / 2 - W / 2 - 2;
          if (off < 0) continue;
          const c: Pt = [m[0] - u[1] * side * off, m[1] + u[0] * side * off];
          const barge = feature(a, c, Math.atan2(u[1], u[0]), 1, true, "barge");
          if (!samples(barge.ring).every((x) => distToPolyline(x, pts) < rv.width / 2 - 0.3)) continue;
          out.push(barge);
          placedBarges.push(m);
        }
      }
    }
  }
  return out;
}

/** Where the image's centre goes for a placed house (the drawing sits off-centre in its image). */
export function imageCentre(h: PlacedHouse): Pt {
  const [ox, oy] = h.art.off;
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  return [h.at[0] - (ox * c - oy * s) * h.scale, h.at[1] - (ox * s + oy * c) * h.scale];
}
