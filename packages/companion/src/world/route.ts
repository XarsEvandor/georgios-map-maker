/**
 * maps.route: the way between two towns of a built world, through other towns when asked, for the
 * Foundry module (which draws it on the world map) and the GM's assistant (Georgios Scribbler asks
 * for it through the module): the route in plain words, its points, and a picture of the stretch of
 * the world map it crosses with the way drawn on it (red: road solid, trail dashed; blue: sea; amber:
 * the way by land, when the shortest one takes a boat; gold dots: the towns it was asked to pass).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { findJourney, findTown, routeText, type LegKind, type Route, type RouteWorld, type Scale } from "@gmm/core";

const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The picture's longer side, in pixels (what a vision model reads in full). */
const IMAGE_MAX = 1400;

interface Loaded {
  aged: RouteWorld;
  scale: Scale;
  map: string;
  width: number;
  height: number;
}

const cache = new Map<string, Promise<Loaded>>();

async function load(dataDir: string, world: string): Promise<Loaded> {
  if (!WORLD_ID.test(world)) throw new Error("bad world id");
  let job = cache.get(world);
  if (!job) {
    job = (async () => {
      const dir = join(dataDir, "worlds", world);
      if (!existsSync(join(dir, "aged.json"))) throw new Error(`no built world "${world}" in the Map Maker companion`);
      const [aged, map, bundle] = await Promise.all(["aged.json", "map.json", "bundle.json"].map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
      return { aged, scale: { pxPerUnit: Number(map.scale) || 1, milesPerPx: bundle.grid.distance / bundle.grid.size }, map: join(dir, bundle.image?.file ?? "map.webp"), width: map.width, height: map.height };
    })();
    cache.set(world, job);
    job.catch(() => cache.delete(world));
  }
  return job;
}

const STYLE: Record<LegKind, string> = {
  road: 'stroke="#c0281e" stroke-width="7"',
  trail: 'stroke="#c0281e" stroke-width="6" stroke-dasharray="16 10"',
  sea: 'stroke="#1d5fae" stroke-width="6" stroke-dasharray="16 10"',
  "open ground": 'stroke="#c0281e" stroke-width="5" stroke-dasharray="4 8"',
};

/** The stretch of the map the way crosses, with the way drawn on it: a JPEG, base64. */
async function picture(w: Loaded, routes: Array<{ r: Route; land?: boolean }>): Promise<{ media_type: string; data: string; caption: string }> {
  const pts = routes.flatMap(({ r }) => r.points);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = Math.max(160, 0.15 * Math.max(x1 - x0, y1 - y0));
  x0 -= margin;
  x1 += margin;
  y0 -= margin;
  y1 += margin;
  // At least 700 px each way, so a short trip still shows its country.
  for (const [lo, hi, set] of [[x0, x1, (a: number, b: number) => ((x0 = a), (x1 = b))], [y0, y1, (a: number, b: number) => ((y0 = a), (y1 = b))]] as const) {
    if (hi - lo < 700) {
      const c = (lo + hi) / 2;
      set(c - 350, c + 350);
    }
  }
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const width = Math.min(w.width, Math.ceil(x1)) - left;
  const height = Math.min(w.height, Math.ceil(y1)) - top;
  const f = Math.min(1, IMAGE_MAX / Math.max(width, height));
  const W = Math.round(width * f);
  const H = Math.round(height * f);
  const at = ([x, y]: [number, number]) => `${((x - left) * f).toFixed(1)},${((y - top) * f).toFixed(1)}`;
  const lines = routes.flatMap(({ r, land }) => r.steps.map((k, i) => `<polyline points="${at(r.points[i]!)} ${at(r.points[i + 1]!)}" fill="none" stroke-linecap="round" opacity="0.85" ${land ? 'stroke="#e08a00" stroke-width="5" stroke-dasharray="10 8"' : STYLE[k]}/>`));
  const main = routes[0]!.r;
  const dot = (p: [number, number], color: string) => `<circle cx="${at(p).split(",")[0]}" cy="${at(p).split(",")[1]}" r="11" fill="${color}" stroke="#fff" stroke-width="3"/>`;
  const stops = main.stops.slice(1, -1).map((s) => dot(s.point, "#e0a92e")).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines.join("")}${stops}${dot(main.points[0]!, "#1e8f3a")}${dot(main.points.at(-1)!, "#c0281e")}</svg>`;
  const jpeg = await sharp(w.map).extract({ left, top, width, height }).resize(W, H).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 82 }).toBuffer();
  const per100 = (100 / f) * w.scale.milesPerPx;
  return {
    media_type: "image/jpeg",
    data: jpeg.toString("base64"),
    caption: `The picture shows the stretch of the world map the way crosses: ${main.from} is the green dot, ${main.to} the red one${main.via?.length ? `, ${main.via.join(" and ")} ${main.via.length > 1 ? "are the" : "is the"} gold ${main.via.length > 1 ? "dots" : "dot"}` : ""}. The way is drawn in red (solid: road, dashed: trail, dotted: open ground) and blue dashes (by sea)${routes.length > 1 ? "; the way by land only in amber dashes" : ""}. In this picture 100 pixels are about ${Math.round(per100)} miles.`,
  };
}

export interface RouteAnswer {
  found: boolean;
  text?: string;
  route?: Route;
  land?: Route | null;
  image?: { media_type: string; data: string };
  /** Names that matched no town: the nearest town names. */
  unknown?: Array<{ name: string; suggestions: string[] }>;
}

/**
 * The way from one town to another, through `via` towns in order when asked; `land`: never by boat
 * (then there is no second, by-land way to offer).
 */
export async function worldRoute(dataDir: string, world: string, from: string, to: string, o: { image?: boolean; via?: string[]; land?: boolean } = {}): Promise<RouteAnswer> {
  const w = await load(dataDir, world);
  const names = [from, ...(o.via ?? []).filter((v) => v.trim()), to];
  const found = names.map((n) => findTown(w.aged, n));
  const unknown = names.map((name, i) => ({ name, t: found[i]! })).filter((x) => !x.t.town).map((x) => ({ name: x.name, suggestions: x.t.suggestions }));
  if (unknown.length) return { found: false, unknown, text: unknown.map((u) => `No town called "${u.name}" on the map${u.suggestions.length ? `; the nearest names: ${u.suggestions.join(", ")}` : ""}.`).join("\n") };
  const towns = found.map((t) => t.town!);
  const route = findJourney(w.aged, towns, w.scale, { land: !!o.land });
  if (!route) return { found: false, text: `${towns[0]!.name} and ${towns.at(-1)!.name} are the same town.` };
  const land = route.byKind.sea && !o.land ? findJourney(w.aged, towns, w.scale, { land: true }) : null;
  const pic = o.image === false ? undefined : await picture(w, [{ r: route }, ...(land ? [{ r: land, land: true }] : [])]);
  return {
    found: true, route, land,
    text: `${routeText(route, land)}${o.land ? "\nBy land only, as asked: no boat." : ""}${pic ? `\n${pic.caption}` : ""}`,
    ...(pic ? { image: { media_type: pic.media_type, data: pic.data } } : {}),
  };
}
