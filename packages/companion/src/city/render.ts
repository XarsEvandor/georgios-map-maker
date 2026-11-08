/**
 * The city scene: a city's whole layout drawn from its MFCG export with 2MT art, at 25 ft per
 * grid square (50 ft for very large cities). Every city uses the same town set: hip roofs in
 * 2M Modular Rooftops slate (shaded by the sun, cream hips and ridges), City Street Pack
 * cobbles and flagstones, muddy shores, Castle Walls tower roofs and Roadside Forest trees.
 * Players find their way around it; battle maps of its hot spots are built separately.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { AssetIndex, AssetRecord, City, HouseArt, PlacedHouse, Pt, Ring } from "@gmm/core";
import { area, centroid, faceLight, hipRoof, houseArtFrom, imageCentre, inside, noise2, placeHouses, smoothstep } from "@gmm/core";
import type { AssetSource } from "../assets/source";

export interface CityImage {
  image: Buffer;
  width: number;
  height: number;
  /** Pixels per metre, and the grid: pixels per square and feet per square. */
  ppm: number;
  gridPx: number;
  gridFt: number;
  /** Map from metres to pixels. */
  toPx: (p: Pt) => Pt;
}

const GRID_PX = 50;
const M_PER_SQUARE = 1.524;

type Tint = [number, number, number, number];

/** An asset as PNG bytes: a square tile `px` wide, or art kept to its aspect at `px` wide. */
async function png(src: AssetSource, a: AssetRecord | undefined, px: number, opts: { tint?: Tint; keepAspect?: boolean } = {}): Promise<Buffer | undefined> {
  if (!a) return undefined;
  const n = Math.max(8, Math.round(px));
  // Shrunk copies are cached on disk: decoding the full-size 2MT art was most of a city's render time.
  const file = join(ART_CACHE, `${createHash("sha1").update(`${a.id}|${a.size.join("x")}|${n}|${opts.tint?.join(",") ?? ""}|${opts.keepAspect ? 1 : 0}`).digest("hex").slice(0, 20)}.png`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }
  try {
    // Alpha first, in its own pass: sharp runs linear() before ensureAlpha() in one pipeline, and 3-band textures then fail.
    const rgba = await sharp(await src.bytes(a.id)).ensureAlpha().png().toBuffer();
    let img = sharp(rgba).resize(opts.keepAspect ? { width: n } : { width: n, height: n, fit: "fill" });
    if (opts.tint) img = img.linear([opts.tint[0], opts.tint[1], opts.tint[2], 1], [opts.tint[3], opts.tint[3], opts.tint[3], 0]);
    const buf = await img.png().toBuffer();
    await mkdir(ART_CACHE, { recursive: true }).then(() => writeFile(file, buf)).catch(() => undefined);
    return buf;
  } catch {
    return undefined;
  }
}

/**
 * Trees for the open country: copses where the noise peaks, on ground clear of buildings, fields,
 * water and roads, and a tree now and then along the field hedges. Deterministic per city.
 */
function countryTrees(city: City): Pt[] {
  const b = city.bounds;
  const n = noise2(Math.round(Math.abs(b.x * 7 + b.y * 13)) % 9973);
  const wall = city.walls.find((w) => city.buildings.filter((bd) => inside(centroid(bd), w.ring)).length > city.buildings.length / 3);
  const centres = city.buildings.map(centroid);
  const nearBuilding = (p: Pt, d: number) => centres.some((c) => Math.abs(c[0] - p[0]) < d && Math.abs(c[1] - p[1]) < d);
  const segDist = (p: Pt, pts: Pt[]) => {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, q = pts[i + 1]!;
      const dx = q[0] - a[0], dy = q[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
    }
    return best;
  };
  const clear = (p: Pt) =>
    !(wall && inside(p, wall.ring)) && !nearBuilding(p, 22) && !city.water.some((w) => inside(p, w)) && !city.fields.some((f) => inside(p, f)) &&
    !city.rivers.some((r) => segDist(p, r.points) < r.width / 2 + 6) && !city.roads.some((r) => segDist(p, r.points) < r.width / 2 + 5);
  const out: Pt[] = [];
  const hash = (x: number, y: number) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  // Copses: sample a 40 m grid; where the noise is high, a cluster of 3 to 9 trees.
  for (let y = b.y + 20; y < b.y + b.h - 20; y += 40) for (let x = b.x + 20; x < b.x + b.w - 20; x += 40) {
    const v = n(x / 160, y / 160);
    if (v < 0.6) continue;
    const c: Pt = [x + (hash(x, y) - 0.5) * 30, y + (hash(y, x) - 0.5) * 30];
    if (!clear(c)) continue;
    const k = 4 + Math.floor(hash(x + 1, y + 2) * 12 * (v - 0.5) * 2);
    for (let i = 0; i < k; i++) {
      const a = hash(x + i, y - i) * Math.PI * 2, r = 3 + hash(x - i, y + i) * 16;
      const p: Pt = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      if (clear(p) && !out.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 6)) out.push(p);
    }
  }
  // Hedgerow trees: one every 60 to 120 m along field edges, on the outside of the hedge.
  for (const f of city.fields) for (let j = 0; j < f.length; j++) {
    const a = f[j]!, q = f[(j + 1) % f.length]!;
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    for (let t = 20 + hash(a[0], a[1]) * 40; t < len - 10; t += 60 + hash(t, a[0]) * 60) {
      const p: Pt = [a[0] + ((q[0] - a[0]) * t) / len, a[1] + ((q[1] - a[1]) * t) / len];
      if (!nearBuilding(p, 15) && !out.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 8)) out.push(p);
    }
  }
  return out;
}

/** Where shrunk city-scene art is cached (the companion runs from the project folder). */
const ART_CACHE = resolve("data/cache/city-art");

/** An asset as a data URI (see png()). */
async function uri(src: AssetSource, a: AssetRecord | undefined, px: number, opts: { tint?: Tint; keepAspect?: boolean } = {}): Promise<string | undefined> {
  const buf = await png(src, a, px, opts);
  return buf && `data:image/png;base64,${buf.toString("base64")}`;
}

/** A texture tiled over W x H, as raw RGBA. */
async function tiledRaw(tile: Buffer, W: number, H: number): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }, limitInputPixels: false })
    .composite([{ input: tile, tile: true, left: 0, top: 0 }])
    .raw()
    .toBuffer();
}

type GroundLayer = { tile: Buffer; seed?: number; cut?: number; scale?: number; opacity?: number };

/**
 * The open ground under the city: grass with meadow and dry-grass patches blended in through
 * soft noise, built as a raster (an SVG mask over a whole city took half a minute longer).
 */
async function groundRaster(W: number, H: number, layers: GroundLayer[]): Promise<Buffer> {
  const out = Buffer.alloc(W * H * 4);
  for (const l of layers) {
    const rgba = await tiledRaw(l.tile, W, H);
    if (l.seed === undefined) { rgba.copy(out); continue; }
    // The mask, computed small and scaled up smooth.
    const mw = Math.ceil(W / 24), mh = Math.ceil(H / 24);
    const n = noise2(l.seed), small = Buffer.alloc(mw * mh);
    const cut = l.cut ?? 0.55, sc = l.scale ?? 7, op = l.opacity ?? 1;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) small[y * mw + x] = Math.round(255 * op * smoothstep(cut - 0.08, cut + 0.08, n(x / sc, y / sc)));
    const mask = await sharp(small, { raw: { width: mw, height: mh, channels: 1 } }).resize(W, H, { kernel: "cubic", fit: "fill" }).raw().toBuffer();
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const m = mask[i]! / 255;
      if (m <= 0) continue;
      out[j] = out[j]! + (rgba[j]! - out[j]!) * m;
      out[j + 1] = out[j + 1]! + (rgba[j + 1]! - out[j + 1]!) * m;
      out[j + 2] = out[j + 2]! + (rgba[j + 2]! - out[j + 2]!) * m;
    }
  }
  for (let j = 3; j < out.length; j += 4) out[j] = 255;
  return out;
}

function finder(index: AssetIndex) {
  const packs = new Map(index.packs.map((p) => [p.id, p]));
  return (kind: string, re: RegExp, pack?: RegExp): AssetRecord | undefined =>
    index.assets.filter((a) => a.kind === kind && !a.error && (re.test(a.name) || re.test(a.id.split(":").slice(1).join(":"))) && !a.colorable && packs.get(a.pack)?.readAllowed !== false && (!pack || pack.test(packs.get(a.pack)?.name ?? ""))).sort((a, b) => a.id.localeCompare(b.id))[0];
}

const f1 = (n: number) => n.toFixed(1);


const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface CityRenderOptions {
  /** "art" (default): 2MT roof drawings laid into the plots (houses.ts); "roofs": a procedural hip roof per outline. */
  houses?: "art" | "roofs";
}

/**
 * The city image's scale: the coarsest grid that keeps its long side under 8000 px (Foundry and
 * the browser struggle past that), 25 ft per square for towns, up to 200 ft for the great cities.
 */
export function cityScale(city: City): { gridFt: number; ppm: number; W: number; H: number; toPx: (p: Pt) => Pt } {
  const b = city.bounds;
  const MAX_SIDE = 8000;
  const gridFt = [25, 50, 100, 200].find((ft) => (Math.max(b.w, b.h) * GRID_PX) / (ft * 0.3048) <= MAX_SIDE) ?? 200;
  const ppm = GRID_PX / (gridFt * 0.3048);
  return { gridFt, ppm, W: Math.round(b.w * ppm), H: Math.round(b.h * ppm), toPx: (p: Pt): Pt => [(p[0] - b.x) * ppm, (p[1] - b.y) * ppm] };
}

export async function renderCity(city: City, src: AssetSource, index: AssetIndex, opts: CityRenderOptions = {}): Promise<CityImage> {
  const b = city.bounds;
  const { gridFt, ppm, W, H, toPx } = cityScale(city);
  const line = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${f1(toPx(p)[0])},${f1(toPx(p)[1])}`).join("");
  const ring = (r: Ring) => `${line(r)}Z`;
  const find = finder(index);
  // Textures at twice their battle-map size, so they read as surface at this scale.
  const tilePx = (squares: number) => squares * M_PER_SQUARE * ppm * 2;

  const mute: [number, number, number, number] = [0.8, 0.84, 0.74, 4];
  const T = {
    grass: await uri(src, find("terrain", /Texture_grass/, /Fort Foul Luck/) ?? find("terrain", /grass/i), 220, { tint: [0.86, 0.9, 0.82, 0] }),
    field: await uri(src, find("terrain", /crop|farm|field|wheat|dry grass/i) ?? find("terrain", /dirt/i), 130, { tint: mute }),
    // Meadow for blending into the grass, and crops for the fields (Farmer's Field).
    crops: (await Promise.all([/^Texture - Wheat - 20x20$/, /^Texture - Fallow 1 - 15x15$/, /^Texture - Fallow 2 - 15x15$/].map((re, i) => uri(src, find("pattern", re, /Farmer's Field/), tilePx(i ? 15 : 20) * 0.9, { tint: i ? [0.9, 0.9, 0.86, 0] : [0.6, 0.6, 0.5, 14] })))).filter((x): x is string => !!x),
    dirt: await uri(src, find("terrain", /\bdirt\b|mud/i, /Farmer|Roadside|Forest|Graveyard/i) ?? find("terrain", /\bdirt\b/i), 140, { tint: [0.85, 0.82, 0.76, 0] }),
    cobble: await uri(src, find("pattern", /cobblestone texture, brown/i, /City Street Pack/i), tilePx(8)),
    flag: await uri(src, find("pattern", /flagstone texture, brown/i, /City Street Pack/i), tilePx(8)),
    water: await uri(src, find("terrain", /water/i, /river|coast|lake|pond|ocean|sea/i) ?? find("terrain", /water/i), 180, { tint: [0.72, 0.82, 0.9, 0] }),
    stone: await uri(src, find("pattern", /stone/i, /Castle/i) ?? find("pattern", /stone/i), 40),
    plank: await uri(src, find("pattern", /plank|board|dock|pier/i, /Docks|Shipyard|Harbo/i) ?? find("pattern", /plank/i), 60),
    red: await uri(src, find("roof", /red_roof\/tiles/, /Modular Rooftops/), tilePx(3.5)),
    blue: await uri(src, find("roof", /blue_roof\/tiles/, /Modular Rooftops/), tilePx(3.5)),
    tower: await uri(src, find("object", /Tower, round, roof \(6x6\)/, /Castle Walls/), 160, { keepAspect: true }),
    yard: await uri(src, find("pattern", /Texture - Grass - 10x10 - Sodden$/, /Grass & Road Assets 2/) ?? find("pattern", /Texture - Dirt - 10x10$/, /Grass & Road Assets 2/), tilePx(10), { tint: [0.88, 0.9, 0.84, 0] }),
    trees: (await Promise.all([
      uri(src, find("object", /^Tree$/, /Farmer's Field Plus/), 160, { keepAspect: true }),
      ...[1, 2, 3].map((n) => uri(src, find("object", new RegExp(`^Tree, ${n}$`), /Roadside Forest Tokens/), 160, { keepAspect: true })),
    ])).filter((x): x is string => !!x),
  };
  const roofPx = tilePx(3.5);

  const defs: string[] = [];
  const pat = (id: string, href: string | undefined, size: number, fallback: string, rotate = 0) => {
    if (!href) return fallback;
    defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f1(size)}" height="${f1(size)}"${rotate ? ` patternTransform="rotate(${rotate})"` : ""}><image href="${href}" width="${f1(size)}" height="${f1(size)}" preserveAspectRatio="none"/></pattern>`);
    return `url(#${id})`;
  };
  const fill = {
    grass: pat("grass", T.grass, 200, "#6f7d4f"),
    field: pat("field", T.field, 130, "#a99a5c"),
    dirt: pat("dirt", T.dirt, 140, "#8a7558"),
    cobble: pat("cobble", T.cobble, tilePx(8), "#8a8378"),
    flag: pat("flag", T.flag, tilePx(8), "#a39a8c"),
    water: pat("water", T.water, 180, "#4b6d80"),
    stone: pat("stone", T.stone, 40, "#6d6a66"),
    plank: pat("plank", T.plank, 60, "#7a5a3a"),
    yard: pat("yard", T.yard, tilePx(10), "#7d6a50"),
  };

  const wall = city.walls.find((x) => city.buildings.filter((bd) => inside(centroid(bd), x.ring)).length > city.buildings.length / 3) ?? city.walls[0];
  const castle = city.districts.filter((d) => /castle|citadel|keep|palace/i.test(d.name));
  const parts: string[] = [];
  // The grass, meadow and dry patches are a raster under the SVG (groundRaster, at the end).
  // Fields: crops in rows along each field's long side, a hedgerow round each.
  for (const [i, f] of city.fields.entries()) {
    const crop = T.crops.length ? T.crops[(i * 7 + 3) % T.crops.length] : undefined;
    let ang = 0, best = 0;
    for (let j = 0; j < f.length; j++) { const a = f[j]!, q = f[(j + 1) % f.length]!; const l = Math.hypot(q[0] - a[0], q[1] - a[1]); if (l > best) { best = l; ang = (Math.atan2(q[1] - a[1], q[0] - a[0]) * 180) / Math.PI; } }
    const size = (i * 7 + 3) % T.crops.length === 0 ? tilePx(20) * 0.9 : tilePx(15) * 0.9;
    const fillF = crop ? pat(`crop${i}`, crop, size, "#a99a5c", Math.round(ang)) : fill.field;
    parts.push(`<path d="${ring(f)}" fill="${fillF}"/>`);
  }
  if (city.fields.length) {
    const hedges = city.fields.map((f) => ring(f)).join("");
    parts.push(`<path d="${hedges}" fill="none" stroke="#1f2e17" stroke-width="${f1(ppm * 1.9)}" stroke-linejoin="round" opacity="0.55"/>`);
    parts.push(`<path d="${hedges}" fill="none" stroke="#3f5a2c" stroke-width="${f1(ppm * 1.3)}" stroke-linejoin="round" stroke-dasharray="${f1(ppm * 2.2)} ${f1(ppm * 0.5)}"/>`);
    parts.push(`<path d="${hedges}" fill="none" stroke="#5b7a3d" stroke-width="${f1(ppm * 0.6)}" stroke-linejoin="round" stroke-dasharray="${f1(ppm * 1.1)} ${f1(ppm * 1.6)}"/>`);
  }
  for (const g of city.greens) parts.push(`<path d="${ring(g)}" fill="#55703f" opacity="0.55"/>`);

  // Roads out in the country are dirt; inside the walls the whole town is cobbled and its main streets flagged.
  const roadPath = (w: number) => city.roads.map((r) => `<path d="${line(r.points)}" stroke-width="${f1(r.width * ppm * w)}"/>`).join("");
  parts.push(`<g fill="none" stroke="#5f523d" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">${roadPath(1.25)}</g>`);
  parts.push(`<g fill="none" stroke="${fill.dirt}" stroke-linecap="round" stroke-linejoin="round">${roadPath(1)}</g>`);
  if (wall) {
    defs.push(`<clipPath id="town"><path d="${ring(wall.ring)}"/></clipPath>`);
    parts.push(`<path d="${ring(wall.ring)}" fill="${fill.cobble}"/>`);
    parts.push(`<g clip-path="url(#town)" fill="none" stroke="${fill.flag}" stroke-linecap="round" stroke-linejoin="round">${roadPath(1)}</g>`);
  }
  for (const s of city.squares) parts.push(`<path d="${ring(s)}" fill="${fill.flag}" stroke="#4b4036" stroke-width="1" stroke-opacity="0.5"/>`);

  // Water over a muddy shore band, a dark line where it meets the bank.
  const bank = 2.2 * ppm;
  for (const w of city.water) parts.push(`<path d="${ring(w)}" fill="#7b6d52" stroke="#7b6d52" stroke-width="${f1(bank * 2)}" stroke-linejoin="round"/>`);
  for (const r of city.rivers) parts.push(`<path d="${line(r.points)}" fill="none" stroke="#7b6d52" stroke-width="${f1(r.width * ppm + bank * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const w of city.water) parts.push(`<path d="${ring(w)}" fill="${fill.water}" stroke="#263c48" stroke-width="1.6" stroke-opacity="0.7"/>`);
  for (const r of city.rivers) {
    parts.push(`<path d="${line(r.points)}" fill="none" stroke="#263c48" stroke-opacity="0.7" stroke-width="${f1(r.width * ppm + 3)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path d="${line(r.points)}" fill="none" stroke="${fill.water}" stroke-width="${f1(r.width * ppm)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const p of city.planks) {
    parts.push(`<path d="${line(p.points)}" fill="none" stroke="#2b2119" stroke-width="${f1(p.width * ppm + 2.4)}"/>`);
    parts.push(`<path d="${line(p.points)}" fill="none" stroke="${fill.plank}" stroke-width="${f1(p.width * ppm)}"/>`);
  }

  // Every drawing is defined once and stamped where it stands.
  const layout = opts.houses !== "roofs" ? placeHouses(city, houseArtFrom(index), city.url) : undefined;
  const ids = new Map<HouseArt, string>();
  const stamp = async (list: PlacedHouse[]) => {
    for (const h of list) {
      let id = ids.get(h.art);
      if (!id) {
        const a = h.art;
        const W = (a.asset.size[0] / 256) * M_PER_SQUARE * ppm, H = (a.asset.size[1] / 256) * M_PER_SQUARE * ppm;
        const href = await uri(src, a.asset, Math.min(W * 2, 1600), { keepAspect: true });
        if (!href) continue;
        id = `art${ids.size}`;
        defs.push(`<image id="${id}" href="${href}" x="${f1(-W / 2)}" y="${f1(-H / 2)}" width="${f1(W)}" height="${f1(H)}" preserveAspectRatio="none"/>`);
        ids.set(a, id);
      }
      const [x, y] = toPx(imageCentre(h));
      parts.push(`<use href="#${id}" transform="translate(${f1(x)},${f1(y)}) rotate(${((h.rot * 180) / Math.PI).toFixed(1)}) scale(${h.scale.toFixed(3)})"/>`);
    }
  };
  const extras = layout?.extras ?? [];
  const isBoat = (h: PlacedHouse) => /^(ship_|barge)/.test(h.landmark ?? "");
  // Ships and barges on the water, a faint shadow under each.
  const boats = extras.filter(isBoat);
  if (boats.length) parts.push(`<path d="${boats.map((h) => ring((h.walls ?? h.ring).map((p) => [p[0] + 0.6, p[1] + 0.8] as Pt))).join("")}" fill="#061018" opacity="0.3"/>`);
  await stamp(boats);

  // Houses: 2MT drawings laid into the plots with yards behind, or a procedural roof per outline.
  const roofed = layout ? layout.bare.map((i) => city.buildings[i]!) : city.buildings;
  if (layout) {
    parts.push(`<path d="${city.buildings.map((bd) => ring(bd)).join("")}" fill="${fill.yard}" stroke="#3b2f24" stroke-width="1" stroke-opacity="0.35" opacity="0.85"/>`);
  } else {
    // Houses outside the walls stand in trodden dirt yards.
    const yards = city.buildings.filter((bd) => !wall || !inside(centroid(bd), wall.ring)).map((bd) => ring(bd)).join("");
    if (yards) parts.push(`<path d="${yards}" fill="${fill.dirt}" stroke="${fill.dirt}" stroke-width="${f1(ppm * 5)}" stroke-linejoin="round" opacity="0.85"/>`);
  }

  // Procedural roofs: one face per wall, tile rows along the eave, shaded by a north-west sun.
  const shadow: string[] = [], outline: string[] = [], edges: string[] = [], ridges: string[] = [];
  const faces = new Map<string, string[]>();
  const shade = new Map<number, string[]>();
  const off: Pt = [0.9, 1.2];
  const standing = extras.filter((h) => /^(lighthouse|windmill)$/.test(h.landmark ?? ""));
  for (const h of [...(layout?.houses ?? []), ...standing]) if (h.landmark !== "spire") shadow.push(ring((h.walls ?? h.ring).map((p) => [p[0] + off[0], p[1] + off[1]] as Pt)));
  for (const bd of roofed) {
    shadow.push(ring(bd.map((p) => [p[0] + off[0], p[1] + off[1]] as Pt)));
    outline.push(ring(bd));
    const c = centroid(bd);
    const color = castle.some((d) => inside(c, d.ring)) || area(bd) > 380 ? "blue" : "red";
    const roof = hipRoof(bd);
    for (const f of roof.faces) {
      const deg = ((Math.atan2(f.down[1], f.down[0]) - Math.PI / 2) * 180) / Math.PI;
      const bin = ((Math.round(deg / 5) * 5) % 360 + 360) % 360;
      const key = `${color}-${bin}`;
      (faces.get(key) ?? faces.set(key, []).get(key)!).push(ring(f.ring));
      const dark = Math.round((1 - faceLight(f)) * 20) / 20;
      if (dark > 0) (shade.get(dark) ?? shade.set(dark, []).get(dark)!).push(ring(f.ring));
      edges.push(ring(f.ring));
    }
    for (const [a, q] of [...roof.hips, ...roof.ridges]) ridges.push(line([a, q]));
  }
  if (shadow.length) parts.push(`<path d="${shadow.join("")}" fill="#000" opacity="0.35"/>`);
  for (const [key, ds] of faces) {
    const [color, bin] = key.split("-") as ["red" | "blue", string];
    const f = pat(`r${key}`, T[color], roofPx, color === "red" ? "#8e4b3c" : "#4f5866", Number(bin));
    parts.push(`<path d="${ds.join("")}" fill="${f}"/>`);
  }
  for (const [dark, ds] of shade) parts.push(`<path d="${ds.join("")}" fill="#120c08" opacity="${dark.toFixed(2)}"/>`);
  if (edges.length) parts.push(`<path d="${edges.join("")}" fill="none" stroke="#24180f" stroke-width="0.6" stroke-opacity="0.55"/>`);
  if (ridges.length) {
    parts.push(`<path d="${ridges.join("")}" fill="none" stroke="#2a1f17" stroke-width="${f1(Math.max(2.2, ppm * 0.5))}" stroke-linecap="round"/>`);
    parts.push(`<path d="${ridges.join("")}" fill="none" stroke="#e6d8b8" stroke-width="${f1(Math.max(1.1, ppm * 0.26))}" stroke-linecap="round"/>`);
  }
  if (outline.length) parts.push(`<path d="${outline.join("")}" fill="none" stroke="#1f1610" stroke-width="${f1(Math.max(1.2, ppm * 0.22))}" stroke-linejoin="round"/>`);
  // The 2MT drawings: houses, then the lighthouse, mills and fountains.
  if (layout) await stamp(layout.houses);
  await stamp(extras.filter((h) => /^(lighthouse|windmill|fountain_)/.test(h.landmark ?? "")));
  const fountainAt = extras.filter((h) => h.landmark?.startsWith("fountain_")).map((h) => h.at);
  for (const p of city.prisms) if (!fountainAt.some((f) => inside(f, p) || Math.hypot(f[0] - centroid(p)[0], f[1] - centroid(p)[1]) < 3)) parts.push(`<path d="${ring(p)}" fill="#bdb6a8" stroke="#2b221d" stroke-width="1.5"/>`);

  // City walls: dark-edged stone, round towers with their conical roofs.
  const towerD = city.towerRadius * 2 * ppm * 1.25;
  for (const w of city.walls) {
    parts.push(`<path d="${ring(w.ring)}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="${f1(w.width * ppm + 3)}" stroke-linejoin="round" transform="translate(${f1(off[0] * ppm)},${f1(off[1] * ppm)})"/>`);
    parts.push(`<path d="${ring(w.ring)}" fill="none" stroke="#221d19" stroke-width="${f1(w.width * ppm + 3)}" stroke-linejoin="round"/>`);
    parts.push(`<path d="${ring(w.ring)}" fill="none" stroke="${fill.stone}" stroke-width="${f1(w.width * ppm)}" stroke-linejoin="round"/>`);
    for (const v of w.ring) {
      const [x, y] = toPx(v);
      if (T.tower) parts.push(`<circle cx="${f1(x + off[0] * ppm)}" cy="${f1(y + off[1] * ppm)}" r="${f1(towerD / 2)}" fill="#000" opacity="0.35"/><image href="${T.tower}" x="${f1(x - towerD / 2)}" y="${f1(y - towerD / 2)}" width="${f1(towerD)}" height="${f1(towerD)}"/>`);
      else parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(towerD / 2)}" fill="${fill.stone}" stroke="#2a2724" stroke-width="2"/>`);
    }
  }

  // The gatehouse sits over the wall.
  await stamp(extras.filter((h) => h.landmark === "gatehouse"));

  // Trees from the Roadside Forest tokens, turned and sized at random (seeded by position).
  // Copses on open ground and the odd tree along the hedgerows (MFCG cities often carry none).
  const allTrees = [...city.trees, ...countryTrees(city)];
  const treeShadow = allTrees.map((t) => { const [x, y] = toPx([t[0] + 0.9, t[1] + 1.2]); return `M${f1(x - 5 * ppm)},${f1(y)}a${f1(5 * ppm)},${f1(5 * ppm)} 0 1,0 ${f1(10 * ppm)},0a${f1(5 * ppm)},${f1(5 * ppm)} 0 1,0 ${f1(-10 * ppm)},0Z`; }).join("");
  if (allTrees.length) parts.push(`<path d="${treeShadow}" fill="#0c1408" opacity="0.28"/>`);
  if (T.trees.length) {
    T.trees.forEach((href, i) => defs.push(`<image id="tree${i}" href="${href}" x="-60" y="-60" width="120" height="120"/>`));
    for (const t of allTrees) {
      const [x, y] = toPx(t);
      const h = Math.abs(Math.sin(t[0] * 12.9898 + t[1] * 78.233) * 43758.5453) % 1;
      const d = (9 + h * 6) * ppm;
      parts.push(`<use href="#tree${Math.floor(h * 97) % T.trees.length}" transform="translate(${f1(x)},${f1(y)}) rotate(${Math.round(h * 360)}) scale(${(d / 120).toFixed(3)})"/>`);
    }
  } else for (const t of allTrees) {
    const [x, y] = toPx(t);
    parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(2.5 * ppm)}" fill="#3e5a2e" stroke="#22331a" stroke-width="1"/>`);
  }

  // District names, quiet and large.
  for (const d of city.districts) {
    const [x, y] = toPx(centroid(d.ring));
    const fs = Math.max(18, Math.min(70, ppm * 8));
    parts.push(`<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-family="Georgia, serif" font-size="${fs.toFixed(0)}" fill="#f4ead2" stroke="#1d1712" stroke-width="${(fs / 6).toFixed(1)}" paint-order="stroke" text-anchor="middle" opacity="0.9" letter-spacing="3">${esc(d.name.toUpperCase())}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
  // Raw pixels between the steps: compressing a whole-city PNG only to unpack it again took seconds.
  const top = await sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true }).ensureAlpha().raw().toBuffer();
  const grassTile = await png(src, find("terrain", /^Texture_grass$/, /Fort Foul Luck/) ?? find("terrain", /grass/i), 220, { tint: [0.86, 0.9, 0.82, 0] });
  const meadowTile = await png(src, find("terrain", /^Lush Grass D - Green - 10x10$/, /Green Hill/), tilePx(10), { tint: [0.84, 0.88, 0.8, 0] });
  const dryTile = await png(src, find("terrain", /^Texture - Grass - 10x10 - Withered$/, /Grass & Road/), tilePx(10), { tint: [0.95, 0.94, 0.9, 0] });
  const layers: GroundLayer[] = [];
  if (grassTile) layers.push({ tile: grassTile });
  if (meadowTile) layers.push({ tile: meadowTile, seed: 11, cut: 0.55, scale: 7, opacity: 0.85 });
  if (dryTile) layers.push({ tile: dryTile, seed: 29, cut: 0.66, scale: 9, opacity: 0.6 });
  const base = layers.length ? await groundRaster(W, H, layers) : undefined;
  if (base) {
    // Lay the SVG layer over the ground by its alpha, in place.
    for (let j = 0; j < base.length; j += 4) {
      const a = top[j + 3]! / 255;
      if (a <= 0) continue;
      base[j] = base[j]! + (top[j]! - base[j]!) * a;
      base[j + 1] = base[j + 1]! + (top[j + 1]! - base[j + 1]!) * a;
      base[j + 2] = base[j + 2]! + (top[j + 2]! - base[j + 2]!) * a;
    }
  }
  const image = await sharp(base ?? top, { raw: { width: W, height: H, channels: 4 }, limitInputPixels: false }).webp({ quality: 84 }).toBuffer();
  return { image, width: W, height: H, ppm, gridPx: GRID_PX, gridFt, toPx };
}
