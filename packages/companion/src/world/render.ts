/**
 * The world map, drawn in 2MT's Wonderdraft world-map art on parchment.
 *
 * Base: the cells painted in muted parchment colours by terrain and height, each realm's colour
 * (one of twelve, unlike its neighbours': core realmColors) washed over its land and deepened in a
 * band inside its borders, painted small and blown up smooth so it reads as brushwork, then paper
 * grain and a darker rim. Realm names are inked in a dark shade of the realm's colour. On top, in ink: shelf bands off the coast, the coastline, rivers that
 * widen to the sea, roads, province and realm borders; 2MT forests, hills and mountains by terrain
 * and height; 2MT settlement pieces by kind and size; ruins and battlefields; ships on the sea
 * lanes; names; a title banner, a compass rose and a frame.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { cellPolygon, edgeLines, isLand, noise2, realmColors, realmNeighbours, smoothstep, type AgedBurg, type AgedWorld, type AssetIndex, type AssetRecord, type AzCell, type AzWorld, type Pt } from "@gmm/core";
import type { AssetSource } from "../assets/source";

export interface WorldImage {
  image: Buffer;
  width: number;
  height: number;
  /** Output pixels per Azgaar map pixel. */
  scale: number;
}

const S = 5;
const PACK = "2MT Wonderdraft World Map Assets";
const ART_CACHE = resolve("data/cache/world-art");

const LAND: Record<number, string> = {
  1: "#e6d5a6", 2: "#d6ceb0", 3: "#ddd09b", 4: "#d9d3a1", 5: "#c6c992", 6: "#c2c68f", 7: "#b6bf88", 8: "#b8c08b", 9: "#bcbf98", 10: "#d5cfb4", 11: "#efeee6", 12: "#bfc698",
};

/** How strongly a realm's colour washes over its land, and the deeper band inside its borders (width in map pixels before the 5x blow-up). */
const REALM_WASH = 0.38;
const REALM_BAND = 10;
const REALM_BAND_OPACITY = 0.6;

const f1 = (n: number) => n.toFixed(1);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** A piece of 2MT art, `px` wide, as a cached PNG data URI with its height. */
async function art(src: AssetSource, a: AssetRecord, px: number): Promise<{ uri: string; w: number; h: number }> {
  const w = Math.max(8, Math.round(px));
  const file = join(ART_CACHE, `${createHash("sha1").update(`${a.id}|${w}`).digest("hex").slice(0, 20)}.png`);
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    const rgba = await sharp(await src.bytes(a.id)).ensureAlpha().png().toBuffer();
    const meta = await sharp(rgba).metadata();
    const IW = meta.width ?? 1, IH = meta.height ?? 1;
    // The stored trim box can overrun the image by a pixel or two: keep it inside.
    const t = a.trim;
    const box = t ? { left: Math.max(0, Math.min(IW - 1, t[0])), top: Math.max(0, Math.min(IH - 1, t[1])), width: 0, height: 0 } : undefined;
    if (box && t) { box.width = Math.max(1, Math.min(IW - box.left, t[2])); box.height = Math.max(1, Math.min(IH - box.top, t[3])); }
    const trimmed = box ? await sharp(rgba).extract(box).png().toBuffer() : rgba;
    buf = await sharp(trimmed).resize({ width: w }).png().toBuffer();
    await mkdir(ART_CACHE, { recursive: true }).then(() => writeFile(file, buf)).catch(() => undefined);
  }
  const m = await sharp(buf).metadata();
  return { uri: `data:image/png;base64,${buf.toString("base64")}`, w: m.width ?? w, h: m.height ?? w };
}

/** Chaikin corner cutting. */
function smooth(pts: Pt[], closed: boolean, rounds = 2): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const out: Pt[] = closed ? [] : [p[0]!];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i]!, b = p[(i + 1) % n]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[n - 1]!);
    p = out;
  }
  return p;
}
const pathOf = (pts: Pt[], closed: boolean) => pts.map((p, i) => `${i ? "L" : "M"}${f1(p[0] * S)},${f1(p[1] * S)}`).join("") + (closed ? "Z" : "");

export async function renderWorld(az: AzWorld, w: AgedWorld, src: AssetSource, index: AssetIndex): Promise<WorldImage> {
  const W = az.width * S, H = az.height * S;
  const C = az.cells;
  const land = C.map(isLand);
  const state = w.cells.state, biome = w.cells.biome;
  // Each realm in a colour of its own, unlike its neighbours' (an invader keeps the colour it came with).
  const realmIds = [...new Set(C.filter((c) => land[c.i] && state[c.i]).map((c) => state[c.i]!))];
  const stateColor = realmColors(realmIds, realmNeighbours(C, state, land), new Map(w.states.filter((s) => s.invader).map((s) => [s.id, s.color])));
  const regionOf = new Array<number>(C.length).fill(0);
  for (const r of w.regions) for (const c of r.cells) regionOf[c] = r.id;
  const packs = new Map(index.packs.map((p) => [p.id, p.name]));
  const piece = (name: string) => index.assets.find((a) => a.kind === "object" && a.name === name && packs.get(a.pack) === PACK && !a.error);
  const pieces = (re: RegExp) => index.assets.filter((a) => a.kind === "object" && re.test(a.name) && packs.get(a.pack) === PACK && !a.error).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const hash = (x: number, y: number, k = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

  // ---- Base: painted small, blown up smooth. ----
  const cellFill = (i: number): string => {
    const c = C[i]!;
    if (!land[i]) return "#9dbcc1";
    let col = LAND[biome[i]!] ?? "#d9d3a1";
    if (c.h > 40) col = mix(col, "#c9b38c", Math.min(1, (c.h - 40) / 35) * 0.7);
    if (c.h > 70) col = mix(col, "#e8e3d6", Math.min(1, (c.h - 70) / 25) * 0.6);
    return col;
  };
  const small: string[] = [];
  const realmCells = new Map<number, string[]>();
  for (const c of C) {
    const poly = cellPolygon(az, c);
    if (poly.length < 3) continue;
    const d = poly.map((p, i) => `${i ? "L" : "M"}${f1(p[0])},${f1(p[1])}`).join("") + "Z";
    small.push(`<path d="${d}" fill="${cellFill(c.i)}" stroke="${cellFill(c.i)}" stroke-width="1"/>`);
    const s = land[c.i] ? state[c.i] : 0;
    if (s) {
      small.push(`<path d="${d}" fill="${stateColor.get(s) ?? "#999"}" opacity="${REALM_WASH}"/>`);
      (realmCells.get(s) ?? realmCells.set(s, []).get(s)!).push(d);
    }
  }
  // A deeper band of each realm's colour along the inside of its borders with other realms, the
  // way a political map edges its countries: kept inside the realm by clipping to its own cells.
  const smallDefs: string[] = [];
  for (const [s, cells] of realmCells) {
    const edges = edgeLines(az, (a, b) => b >= 0 && land[a] && land[b] && state[a] === s && state[b] !== s);
    if (!edges.length) continue;
    const d = edges.map((l) => l.map((v, i) => `${i ? "L" : "M"}${f1(az.vertices[v]![0])},${f1(az.vertices[v]![1])}`).join("")).join("");
    smallDefs.push(`<clipPath id="realm${s}"><path d="${cells.join("")}"/></clipPath>`);
    small.push(`<g clip-path="url(#realm${s})"><path d="${d}" fill="none" stroke="${stateColor.get(s) ?? "#999"}" stroke-width="${REALM_BAND}" stroke-linejoin="round" stroke-linecap="round" opacity="${REALM_BAND_OPACITY}"/></g>`);
  }
  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${az.width}" height="${az.height}"><defs>${smallDefs.join("")}</defs><rect width="100%" height="100%" fill="#9dbcc1"/>${small.join("")}</svg>`;
  const baseSmall = await sharp(Buffer.from(baseSvg)).blur(1.8).png().toBuffer();
  const base = await sharp(baseSmall).resize(W, H, { kernel: "cubic", fit: "fill" }).removeAlpha().raw().toBuffer();
  // Paper grain and a darker rim.
  {
    const gw = Math.ceil(W / 3), gh = Math.ceil(H / 3);
    const n1 = noise2(17), n2 = noise2(91);
    const g = Buffer.alloc(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = Math.round(255 * (0.55 * n1(x / 90, y / 90) + 0.45 * n2(x / 7, y / 7)));
    const grain = await sharp(g, { raw: { width: gw, height: gh, channels: 1 } }).resize(W, H, { kernel: "cubic", fit: "fill" }).raw().toBuffer();
    for (let y = 0, i = 0; y < H; y++) {
      const ey = Math.min(y, H - y) / (H * 0.12);
      for (let x = 0; x < W; x++, i++) {
        const ex = Math.min(x, W - x) / (W * 0.08);
        const rim = 0.82 + 0.18 * smoothstep(0, 1, Math.min(1, ex, ey));
        const k = rim * (0.9 + 0.1 * (grain[i]! / 255));
        const j = i * 3;
        base[j] = base[j]! * k;
        base[j + 1] = base[j + 1]! * k;
        base[j + 2] = base[j + 2]! * (k * 0.97);
      }
    }
  }

  // ---- Ink. ----
  const parts: string[] = [];
  const defs: string[] = [];
  const P = (v: number): Pt => az.vertices[v]!;
  const coast = edgeLines(az, (a, b) => land[a] !== (b >= 0 ? land[b] : false));
  const coastPaths = coast.map((l) => { const closed = l[0] === l[l.length - 1]; return pathOf(smooth(l.map(P), closed), closed); }).join("");
  // Sea shelf bands, clipped to the water.
  const water = C.filter((c) => !land[c.i]).map((c) => cellPolygon(az, c)).filter((p) => p.length >= 3).map((p) => pathOf(p, true)).join("");
  defs.push(`<clipPath id="sea"><path d="${water}"/></clipPath>`);
  parts.push(`<g clip-path="url(#sea)" fill="none" stroke="#45707d" stroke-linejoin="round">`);
  for (const [wd, op] of [[95, 0.07], [60, 0.08], [32, 0.1], [12, 0.12]] as const) parts.push(`<path d="${coastPaths}" stroke-width="${wd}" opacity="${op}"/>`);
  parts.push(`</g>`);
  // Rivers, widening downstream.
  for (const r of az.rivers) {
    const pts = r.cells.map((c) => C[c]?.p).filter((p): p is Pt => !!p);
    if (pts.length < 2) continue;
    const sm = smooth(pts, false, 3);
    const n = sm.length;
    const top = 1.6 + Math.min(6, Math.sqrt(r.discharge) / 6);
    for (let i = 0; i + 1 < n; i += 4) {
      const seg = sm.slice(i, Math.min(n, i + 5));
      const wd = 1 + (top - 1) * (i / n);
      parts.push(`<path d="${pathOf(seg, false)}" fill="none" stroke="#4e7d95" stroke-width="${f1(wd * S * 0.55)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`);
    }
  }
  // Coastline in ink.
  parts.push(`<path d="${coastPaths}" fill="none" stroke="#3b3127" stroke-width="3.4" stroke-linejoin="round"/>`);
  // Roads, trails, sea lanes.
  for (const r of w.routes) {
    const pts = r.points.map((p) => [p[0], p[1]] as Pt);
    if (pts.length < 2) continue;
    const d = pathOf(smooth(pts, false, 2), false);
    if (r.group === "searoutes") parts.push(`<path d="${d}" fill="none" stroke="#3f6672" stroke-width="2" stroke-dasharray="2 12" stroke-linecap="round" opacity="0.4"/>`);
    else if (r.group === "trails") parts.push(`<path d="${d}" fill="none" stroke="#6b4f35" stroke-width="1.8" stroke-dasharray="3 8" stroke-linecap="round" opacity="0.45"/>`);
    else parts.push(`<path d="${d}" fill="none" stroke="#6b4f35" stroke-width="2.8" stroke-dasharray="16 8" stroke-linecap="round" opacity="0.65"/>`);
  }
  // Province and realm borders.
  const provinceLines = edgeLines(az, (a, b) => b >= 0 && land[a] && land[b] && state[a] === state[b] && regionOf[a] !== regionOf[b]);
  parts.push(`<path d="${provinceLines.map((l) => pathOf(smooth(l.map(P), false, 1), false)).join("")}" fill="none" stroke="#6b5a45" stroke-width="1.6" stroke-dasharray="5 7" opacity="0.4"/>`);
  const realmLines = edgeLines(az, (a, b) => b >= 0 && land[a] && land[b] && state[a] !== state[b]);
  const realmD = realmLines.map((l) => pathOf(smooth(l.map(P), false, 1), false)).join("");
  parts.push(`<path d="${realmD}" fill="none" stroke="#f3ead2" stroke-width="9" opacity="0.5" stroke-linecap="round"/>`);
  parts.push(`<path d="${realmD}" fill="none" stroke="#5a3a28" stroke-width="4" stroke-dasharray="22 7 5 7" opacity="0.75" stroke-linecap="round"/>`);
  // Land held by invaders (a DM's steer): hatched in their colour, behind a bold front line.
  const invaders = w.states.filter((s) => s.alive && s.invader);
  if (invaders.length) {
    const loops = coast.filter((l) => l[0] === l[l.length - 1]).map((l) => pathOf(smooth(l.map(P), true), true)).join("");
    defs.push(`<clipPath id="land"><path d="${loops}" clip-rule="evenodd"/></clipPath>`);
  }
  for (const s of invaders) {
    const held = (i: number) => land[i] && state[i] === s.id;
    // The held land plus the water off its shore; the land clip then follows the inked coast.
    const reach = (i: number) => held(i) || (!land[i] && C[i]!.c.some(held));
    const outline = edgeLines(az, (a, b) => reach(a) !== (b >= 0 && reach(b)));
    const d = outline.map((l) => { const closed = l[0] === l[l.length - 1]; return pathOf(smooth(l.map(P), closed, 1), closed); }).join("");
    const ink = mix(s.color, "#1b1b1b", 0.3);
    defs.push(`<pattern id="held${s.id}" patternUnits="userSpaceOnUse" width="44" height="44" patternTransform="rotate(45)"><rect width="14" height="44" fill="${ink}"/></pattern>`);
    parts.push(`<g clip-path="url(#land)"><path d="${d}" fill="url(#held${s.id})" fill-rule="evenodd" opacity="0.3"/></g>`);
    const front = edgeLines(az, (a, b) => b >= 0 && land[a] && land[b] && held(a) !== held(b));
    const fd = front.map((l) => pathOf(smooth(l.map(P), false, 1), false)).join("");
    parts.push(`<path d="${fd}" fill="none" stroke="#f3ead2" stroke-width="14" opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path d="${fd}" fill="none" stroke="${ink}" stroke-width="7" opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // ---- 2MT symbols: terrain, then settlements. ----
  const ids = new Map<string, { id: string; w: number; h: number }>();
  const use = async (a: AssetRecord | undefined, px: number) => {
    if (!a) return undefined;
    const key = `${a.id}@${Math.round(px)}`;
    let hit = ids.get(key);
    if (!hit) {
      const im = await art(src, a, px * 1.5);
      const id = `s${ids.size}`;
      const h = (im.h / im.w) * px;
      defs.push(`<image id="${id}" href="${im.uri}" width="${f1(px)}" height="${f1(h)}" preserveAspectRatio="none"/>`);
      hit = { id, w: px, h };
      ids.set(key, hit);
    }
    return hit;
  };
  type Sym = { a: AssetRecord; px: number; x: number; y: number; opacity?: number };
  const syms: Sym[] = [];
  const alive = w.burgs.filter((b) => b.alive);
  const nearTown = (p: Pt, r: number) => alive.some((b) => Math.abs(b.x - p[0]) < r && Math.abs(b.y - p[1]) < r && Math.hypot(b.x - p[0], b.y - p[1]) < r);
  const forests = pieces(/^Forest, (1[0-3]|[1-9])$/), pines = pieces(/^Forest, pine, [1-7]$/), hills = pieces(/^Hill, [1-7]$/);
  const brown = pieces(/^Mountain, brown, \d+$/), grey = pieces(/^Mountain, grey, \d+$/), rugged = pieces(/^Mountain, rugged, (brown|grey), \d+$/), reeds = pieces(/^Bamboo/);
  const volcanoes = new Set(w.markers.filter((m) => m.type === "volcanoes").map((m) => m.cell));
  for (const c of C) {
    if (!land[c.i]) continue;
    const r = (k: number) => hash(c.p[0], c.p[1], k);
    const jitter = (k: number): Pt => [c.p[0] + (r(k) - 0.5) * 9, c.p[1] + (r(k + 1) - 0.5) * 9];
    if (nearTown(c.p, 13)) continue;
    if (volcanoes.has(c.i)) { const v = piece("Mountain, volcano, huge"); if (v) syms.push({ a: v, px: 34 * S, x: c.p[0], y: c.p[1] + 6 }); continue; }
    if (c.h >= 62) {
      const list = c.h >= 82 && rugged.length ? rugged : c.h >= 72 && grey.length ? grey : brown;
      if (list.length) { const p = jitter(1); syms.push({ a: list[Math.floor(r(2) * list.length)]!, px: (22 + (c.h - 62) * 0.35 + r(3) * 6) * S, x: p[0], y: p[1] + 7 }); }
      continue;
    }
    if (c.h >= 47 && hills.length && r(4) < 0.75) { const p = jitter(5); syms.push({ a: hills[Math.floor(r(6) * hills.length)]!, px: (16 + r(7) * 5) * S, x: p[0], y: p[1] + 5 }); continue; }
    const b = biome[c.i]!;
    const list = b === 9 ? pines : [5, 6, 7, 8].includes(b) ? forests : b === 12 ? reeds : [];
    if (!list.length) continue;
    // Forests drawn thick, the way 2MT maps show them: several clumps per cell.
    const count = b === 12 ? 2 : 3 + (c.area > 400 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const p: Pt = [c.p[0] + (r(10 + k * 3) - 0.5) * 16, c.p[1] + (r(11 + k * 3) - 0.5) * 14];
      if (nearTown(p, 9)) continue;
      syms.push({ a: list[Math.floor(r(12 + k) * list.length)]!, px: (b === 12 ? 9 : 16 + r(13 + k) * 7) * S, x: p[0], y: p[1] + 4 });
    }
  }
  // Settlements by kind and size.
  const kindOf = (b: AgedBurg): AssetRecord | undefined => {
    const r = hash(b.x, b.y, 7);
    if (b.capital) return piece(b.population >= 15 ? "Settlement, castle, 2" : "Settlement, castle, 4");
    if (b.kind === "fort") return piece(`Settlement, tower, ${1 + Math.floor(r * 3)}`);
    if (b.population >= 12) return piece(`Settlement, city, ${1 + Math.floor(r * 3)}`);
    if (b.population >= 3) return b.port ? piece(b.population >= 6 ? "Settlement, harbor, large" : "Settlement, harbor, small") : piece(`Settlement, town, ${1 + Math.floor(r * 4)}`);
    return piece(r < 0.35 ? "Settlement, village" : `Settlement, building, ${1 + Math.floor(r * 6)}`);
  };
  const townPx = (b: AgedBurg) => (b.capital ? 30 : b.kind === "fort" ? 14 : b.population >= 12 ? 26 : b.population >= 3 ? 19 : 12) * S;
  for (const b of alive) { const a = kindOf(b); if (a) syms.push({ a, px: townPx(b), x: b.x, y: b.y + 4 }); }
  const ruin = piece("Settlement, building, 3");
  for (const m of w.markers) {
    if (m.type === "ruins" && ruin) syms.push({ a: ruin, px: 10 * S, x: m.x, y: m.y + 3, opacity: 0.45 });
    if (m.type === "mines") { const a = piece("Settlement, mine"); if (a) syms.push({ a, px: 11 * S, x: m.x, y: m.y + 3 }); }
    if (m.type === "lighthouses") { const a = piece("Settlement, tower, 2"); if (a) syms.push({ a, px: 10 * S, x: m.x, y: m.y + 3 }); }
  }
  // Ships out on the sea lanes, in deep water.
  const ships = pieces(/^Ship, [12]$/);
  if (ships.length) {
    const spots: Pt[] = [];
    for (const r of w.routes.filter((x) => x.group === "searoutes")) for (const p of r.points) {
      const c = C[p[2]];
      if (c && !land[c.i] && c.h < 12 && !spots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 160)) spots.push([p[0], p[1]]);
    }
    spots.slice(0, 7).forEach((p, k) => syms.push({ a: ships[k % ships.length]!, px: 26 * S, x: p[0], y: p[1] + 8 }));
  }
  syms.sort((a, b) => a.y - b.y);
  for (const s of syms) {
    const h = await use(s.a, s.px);
    if (!h) continue;
    parts.push(`<use href="#${h.id}" x="${f1(s.x * S - h.w / 2)}" y="${f1(s.y * S - h.h)}"${s.opacity ? ` opacity="${s.opacity}"` : ""}/>`);
  }
  // Battlefields: small red crosses.
  for (const m of w.markers.filter((x) => x.type === "battlefields")) {
    const x = m.x * S, y = m.y * S, k = 14;
    parts.push(`<path d="M${f1(x - k)},${f1(y - k)}L${f1(x + k)},${f1(y + k)}M${f1(x + k)},${f1(y - k)}L${f1(x - k)},${f1(y + k)}" stroke="#8a2a1f" stroke-width="6" stroke-linecap="round" opacity="0.75"/>`);
  }

  // ---- Names, skipping any that would overlap one already set. ----
  const halo = `paint-order="stroke" stroke="#f1e7cd" stroke-linejoin="round"`;
  const boxes: Array<[number, number, number, number]> = [];
  const free = (x: number, y: number, w2: number, h2: number) => {
    if (boxes.some(([a, b, c, d]) => x < c && x + w2 > a && y < d && y + h2 > b)) return false;
    boxes.push([x, y, x + w2, y + h2]);
    return true;
  };
  // The cell under a point (map units): the nearest cell centre, looked up in 40-unit buckets.
  const BK = 40;
  const buckets = new Map<string, AzCell[]>();
  for (const c of C) {
    const k = `${Math.floor(c.p[0] / BK)},${Math.floor(c.p[1] / BK)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(c);
  }
  const cellAt = (x: number, y: number): AzCell | undefined => {
    let best: AzCell | undefined, bd = Infinity;
    const bx = Math.floor(x / BK), by = Math.floor(y / BK);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const c of buckets.get(`${bx + i},${by + j}`) ?? []) {
      const d = (c.p[0] - x) ** 2 + (c.p[1] - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  // Where the towns and their names stand, for realm names to keep clear of.
  const townBoxes = alive.filter((b) => b.capital || b.population >= 3).map((b) => {
    const px = townPx(b), fs = b.capital ? 46 : b.population >= 12 ? 36 : 27;
    return [b.x * S - px / 2, b.y * S - px * 0.6, b.x * S + px * 0.45 + b.name.length * fs * 0.55, (b.y + 4) * S + px * 0.3] as const;
  });
  // A realm's land in connected pieces, biggest first.
  const piecesOf = (cells: AzCell[]): AzCell[][] => {
    const own = new Set(cells.map((c) => c.i));
    const seen = new Set<number>();
    const out: AzCell[][] = [];
    for (const c of cells) {
      if (seen.has(c.i)) continue;
      const piece: AzCell[] = [];
      const stack = [c.i];
      seen.add(c.i);
      while (stack.length) {
        const i = stack.pop()!;
        piece.push(C[i]!);
        for (const n of C[i]!.c) if (own.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
      out.push(piece);
    }
    return out.sort((a, b) => b.length - a.length);
  };
  for (const s of w.states.filter((x) => x.alive)) {
    const all = C.filter((c) => land[c.i] && state[c.i] === s.id);
    // Free cities and lordships of a few cells are named by their capital's label already.
    if (all.length < 20 || s.form === "Free City") continue;
    // A realm in several pieces (land cut off by a neighbour) is named on each piece of some size:
    // the biggest with its full name, the others with its short one.
    const pieces = piecesOf(all).filter((p, k) => k === 0 || p.length >= 20);
    for (const [piece, own] of pieces.entries()) {
      const cx = own.reduce((t, c) => t + c.p[0], 0) / own.length, cy = own.reduce((t, c) => t + c.p[1], 0) / own.length;
      // The interior cell nearest the middle (all neighbours in the realm).
      const inner = own.filter((c) => c.c.every((n) => state[n] === s.id));
      const near = (inner.length ? inner : own).sort((a, b) => Math.hypot(a.p[0] - cx, a.p[1] - cy) - Math.hypot(b.p[0] - cx, b.p[1] - cy));
      const fs = Math.max(40, Math.min(115, 20 + Math.sqrt(own.length) * 4.6));
      const label = piece > 0 || s.form === "Free City" ? s.name.toUpperCase() : s.fullName.toUpperCase();
      // A long name over a small realm may go on two or three lines.
      const xs = own.map((c) => c.p[0]), ys = own.map((c) => c.p[1]);
      const span = (Math.max(...xs) - Math.min(...xs)) * S;
      const words = label.split(" ");
      const splits: string[][] = [[label]];
      // Any name of several words may break into lines when the realm has no room for it on one.
      if (words.length > 1) {
        let two: string[] = [], three: string[] = [];
        const longest = (ls: string[]) => Math.max(...ls.map((l) => l.length));
        for (let i = 1; i < words.length; i++) {
          const t = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
          if (!two.length || longest(t) < longest(two)) two = t;
          for (let j = i + 1; j < words.length; j++) {
            const u = [words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")];
            if (!three.length || longest(u) < longest(three)) three = u;
          }
        }
        if (label.length > 22 && label.length * fs * 0.86 > span * 1.2) splits.shift();
        splits.push(two);
        if (three.length && label.length > 22) splits.push(three);
      }
      // The spot nearest the middle where the name covers no town or its name.
      const reach = 0.35 * Math.max(span, (Math.max(...ys) - Math.min(...ys)) * S);
      const boxOf = (c: AzCell, ls: string[], f = fs) => {
        const tw = Math.max(...ls.map((l) => l.length)) * f * 0.86, y0 = c.p[1] * S - (ls.length - 1) * f * 0.6;
        return [c.p[0] * S - tw / 2, y0 - f, c.p[0] * S + tw / 2, y0 - f + f * 1.2 * ls.length] as const;
      };
      const clear = (b: readonly [number, number, number, number]) => !townBoxes.some(([a, c, d, e]) => b[0] < d && b[2] > a && b[1] < e && b[3] > c);
      // How much of the name lies on the realm's own land (of nine points over its box).
      const own9 = (b: readonly [number, number, number, number]) => {
        let n = 0;
        for (const fx of [0.04, 0.5, 0.96]) for (const fy of [0.15, 0.5, 0.85]) {
          const c = cellAt((b[0] + (b[2] - b[0]) * fx) / S, (b[1] + (b[3] - b[1]) * fy) / S);
          if (c && land[c.i] && state[c.i] === s.id) n++;
        }
        return n;
      };
      // First a spot where the whole name lies on the realm's land (on one line or broken, at full
      // size, then a fifth smaller), looking a little farther out than the middle; then one where
      // most of it does; then any spot near the middle.
      let at = near[0]!, lines = splits[0]!, size = fs;
      search: for (const [need, far, scale] of [[9, 1.8, 1], [9, 1.8, 0.8], [7, 1.8, 1], [7, 1.8, 0.8], [0, 1, 1]] as const) for (const ls of splits) for (const c of near) {
        if (Math.hypot(c.p[0] - cx, c.p[1] - cy) * S > reach * far) break;
        const box = boxOf(c, ls, fs * scale);
        if (clear(box) && (!need || own9(box) >= need)) { at = c; lines = ls; size = fs * scale; break search; }
      }
      const [bx0, by0, bx1, by1] = boxOf(at, lines, size);
      const y0 = at.p[1] * S - (lines.length - 1) * size * 0.6;
      free(bx0, by0, bx1 - bx0, by1 - by0);
      // The realm's name in a dark shade of its own colour.
      const ink = mix(stateColor.get(s.id) ?? "#6b4a35", "#2a1d12", 0.45);
      lines.forEach((l, k) => parts.push(`<text x="${f1(at.p[0] * S)}" y="${f1(y0 + k * size * 1.2)}" font-family="Georgia, serif" font-size="${f1(size)}" letter-spacing="${f1(size * 0.22)}" text-anchor="middle" fill="${ink}" opacity="0.8" ${halo} stroke-width="${f1(size / 7)}">${esc(l)}</text>`));
    }
  }
  for (const b of [...alive].sort((x, y) => Number(y.capital) - Number(x.capital) || y.population - x.population)) {
    if (!b.capital && b.population < 3) continue;
    const fs = b.capital ? 46 : b.population >= 12 ? 36 : 27;
    const tx = b.x * S + townPx(b) * 0.45, ty = b.y * S - townPx(b) * 0.15;
    if (!free(tx, ty - fs, b.name.length * fs * 0.55, fs * 1.15) && !b.capital) continue;
    parts.push(`<text x="${f1(b.x * S + townPx(b) * 0.45)}" y="${f1(b.y * S - townPx(b) * 0.15)}" font-family="Georgia, serif" font-size="${fs}" ${b.capital ? 'font-weight="bold"' : ""} fill="#2f2418" ${halo} stroke-width="${f1(fs / 4.5)}">${esc(b.name)}</text>`);
  }

  // ---- Title, compass, frame. ----
  const banner = piece("Banner, red");
  if (banner) {
    const h = await use(banner, 1900);
    if (h) {
      const x = W / 2 - h.w / 2, y = 70;
      parts.push(`<use href="#${h.id}" x="${f1(x)}" y="${f1(y)}"/>`);
      parts.push(`<text x="${f1(W / 2)}" y="${f1(y + h.h * 0.62)}" font-family="Georgia, serif" font-size="104" font-weight="bold" letter-spacing="14" text-anchor="middle" fill="#f6ead0" paint-order="stroke" stroke="#5a1f15" stroke-width="5">${esc(`${w.name.toUpperCase()} · ${w.year} ${w.eraShort}`)}</text>`);
    }
  }
  const rose = piece("Compass Rose");
  if (rose) {
    // The corner with the most sea.
    const corners: Pt[] = [[0.1, 0.85], [0.9, 0.85], [0.1, 0.15], [0.9, 0.2]];
    const seaAt = (p: Pt) => { const c = C.reduce((best, x) => (Math.hypot(x.p[0] - p[0] * az.width, x.p[1] - p[1] * az.height) < Math.hypot(best.p[0] - p[0] * az.width, best.p[1] - p[1] * az.height) ? x : best), C[0]!); return land[c.i] ? 0 : 1; };
    const corner = corners.find((p) => seaAt(p)) ?? corners[0]!;
    const h = await use(rose, 520);
    if (h) parts.push(`<use href="#${h.id}" x="${f1(corner[0] * W - h.w / 2)}" y="${f1(corner[1] * H - h.h / 2)}" opacity="0.85"/>`);
  }
  parts.push(`<rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="#3b3127" stroke-width="8"/>`);
  parts.push(`<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#3b3127" stroke-width="2.5"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
  const top = await sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true }).ensureAlpha().raw().toBuffer();
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const a = top[j + 3]! / 255;
    if (a <= 0) continue;
    const k = i * 3;
    base[k] = base[k]! + (top[j]! - base[k]!) * a;
    base[k + 1] = base[k + 1]! + (top[j + 1]! - base[k + 1]!) * a;
    base[k + 2] = base[k + 2]! + (top[j + 2]! - base[k + 2]!) * a;
  }
  const image = await sharp(base, { raw: { width: W, height: H, channels: 3 }, limitInputPixels: false }).webp({ quality: 86 }).toBuffer();
  return { image, width: W, height: H, scale: S };
}
