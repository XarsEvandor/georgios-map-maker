/**
 * Renders a .dungeondraft_map to an image using the pack textures (DESIGN.md section 11).
 * Draw order follows Dungeondraft: terrain, floor patterns, paths, walls, portals, objects.
 * Built-in Dungeondraft textures are not available outside Dungeondraft; they draw as flat fills.
 */

import sharp, { type OverlayOptions, type Sharp } from "sharp";
import { PX_PER_SQUARE, parseByteArray, parseVector2, parseVector2Array, type Json, type LeafSpec } from "@gmm/core";
import { MAX_PIXELS } from "../assets/analyze";
import type { AssetSource } from "../assets/source";

/** Most objects a map may have before the renderer refuses it. */
const MAX_OBJECTS = 20_000;

export interface RenderOptions {
  /** Pixels per grid square in the output (default 64). */
  pps?: number;
  /** Apply the level's ambient light and its lights (default false). */
  lighting?: boolean;
  grid?: boolean;
  format?: "png" | "webp";
  quality?: number;
  /** Numbered labels at these square positions (for chat references). */
  labels?: Array<{ x: number; y: number; text: string }>;
  /** Letters cut into the ground (a sundial's numerals): drawn on the floor, under walls and objects. Squares; rot in radians. */
  etchings?: Array<{ text: string; at: [number, number]; rot: number; size: number }>;
  /** Gate leaves by portal node id (generate.ts ElementInfo.leaf). */
  leaves?: Record<string, LeafSpec & { width: number }>;
  /** "closed": draw gate leaves shut (previews); "hide": leave the opening for Foundry to draw them. */
  leafMode?: "closed" | "hide";
}

/** The closed leaves of a gate as an image: the box of its art, left half only for one leaf of a pair, padded when it stands on the wall line by its edge. */
export async function leafImage(src: AssetSource, leaf: LeafSpec, opts: { half?: boolean; pad?: boolean } = {}): Promise<Buffer> {
  const buf = await src.bytes(leaf.asset);
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const x0 = Math.max(0, Math.round(leaf.box[0] * W)), y0 = Math.max(0, Math.round(leaf.box[1] * H));
  const x1 = Math.min(W, Math.round(leaf.box[2] * W)), y1 = Math.min(H, Math.round(leaf.box[3] * H));
  const w = opts.half ? Math.max(1, Math.floor((x1 - x0) / 2)) : x1 - x0, h = Math.max(1, y1 - y0);
  let img = await sharp(buf).ensureAlpha().extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer();
  if (opts.pad && leaf.align === "edge") img = await sharp(img).extend({ bottom: h, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return img;
}

type Level = Record<string, any>;

class TexCache {
  private readonly cache = new Map<string, Promise<{ buf: Buffer; w: number; h: number } | undefined>>();
  constructor(private readonly src: AssetSource) {}

  /** Texture scaled by `k` (output px per texture px), as PNG with alpha. */
  get(res: string, k: number): Promise<{ buf: Buffer; w: number; h: number } | undefined> {
    const key = `${res}@${k.toFixed(4)}`;
    let v = this.cache.get(key);
    if (!v) {
      v = (async () => {
        if (!this.src.assetByRes(res)) return undefined; // built-in texture
        const raw = await this.src.bytes(res);
        const meta = await sharp(raw, { limitInputPixels: MAX_PIXELS }).metadata();
        const w = Math.max(1, Math.round((meta.width ?? 1) * k));
        const h = Math.max(1, Math.round((meta.height ?? 1) * k));
        const buf = await sharp(raw, { limitInputPixels: MAX_PIXELS }).resize(w, h, { fit: "fill" }).ensureAlpha().png().toBuffer();
        return { buf, w, h };
      })();
      this.cache.set(key, v);
    }
    return v;
  }
}

function argbToRgba(argb: string): [number, number, number, number] {
  const a = parseInt(argb.slice(0, 2), 16), r = parseInt(argb.slice(2, 4), 16), g = parseInt(argb.slice(4, 6), 16), b = parseInt(argb.slice(6, 8), 16);
  return [r, g, b, a / 255];
}

/** Crops a tile so it is no larger than the target (sharp rejects larger overlays). */
async function fitTile(buf: Buffer, tw: number, th: number, w: number, h: number): Promise<Buffer> {
  if (tw <= w && th <= h) return buf;
  return sharp(buf).extract({ left: 0, top: 0, width: Math.min(tw, w), height: Math.min(th, h) }).png().toBuffer();
}

async function tiled(tex: { buf: Buffer; w: number; h: number }, w: number, h: number): Promise<Buffer> {
  const tile = await fitTile(tex.buf, tex.w, tex.h, w, h);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: tile, tile: true, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

/** A strip of texture repeated along a segment, rotated into place. */
async function strip(tex: { buf: Buffer; w: number; h: number }, length: number, thickness: number, angleDeg: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const L = Math.max(1, Math.round(length));
  const T = Math.max(1, Math.round(thickness));
  const sw = tex.h === T ? tex.w : Math.max(1, Math.round((tex.w * T) / tex.h));
  const scaled0 = tex.h === T ? tex.buf : await sharp(tex.buf).resize({ height: T, width: sw, fit: "fill" }).png().toBuffer();
  const scaled = await fitTile(scaled0, sw, T, L, T);
  const band = await sharp({ create: { width: L, height: T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, tile: true, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const rotated = await sharp(band).rotate(angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  return { buf: rotated.data, w: rotated.info.width, h: rotated.info.height };
}

export async function renderMap(map: Json, src: AssetSource, opts: RenderOptions = {}): Promise<Buffer> {
  const pps = opts.pps ?? 64;
  const k = pps / PX_PER_SQUARE;
  const world = map.world as Record<string, any>;
  const level = (world.levels as Record<string, Level>)["0"]!;
  const W = Math.round(world.width * pps), H = Math.round(world.height * pps);
  if (!(W > 0 && H > 0) || W * H > 120_000_000) throw new Error(`render too large: ${W}x${H}`);
  const counts = ["objects", "walls", "patterns", "paths", "lights"].reduce((n, k) => n + ((level[k] as unknown[] | undefined)?.length ?? 0), 0);
  if (counts > MAX_OBJECTS) throw new Error(`map has too many elements to render (${counts})`);
  const tc = new TexCache(src);
  const layers: OverlayOptions[] = [];

  // 1. Terrain: blend up to 4 textures by the splat weights.
  const terrain = level.terrain ?? {};
  const base = Buffer.alloc(W * H * 4, 0);
  {
    const slots: Array<Buffer | undefined> = [];
    const used = new Map<string, Buffer | undefined>();
    for (let i = 1; i <= 4; i++) {
      const res = terrain[`texture_${i}`] as string | undefined;
      if (res && used.has(res)) { slots.push(used.get(res)); continue; }
      const t = res ? await tc.get(res, k) : undefined;
      // Terrain textures can be partly transparent; flatten them on a neutral ground color.
      const buf = t ? await sharp(await tiled(t, W, H)).flatten({ background: { r: 92, g: 88, b: 64 } }).ensureAlpha().raw().toBuffer() : undefined;
      if (res) used.set(res, buf);
      slots.push(buf);
    }
    const splat = terrain.splat ? parseByteArray(terrain.splat) : undefined;
    const sw = world.width * 4, sh = world.height * 4;
    const fallback: Array<[number, number, number]> = [[96, 112, 70], [120, 98, 70], [110, 100, 90], [200, 200, 205]];
    // Bilinear weights between splat texels, so blends don't look blocky.
    const weightAt = (fx: number, fy: number, s: number) => {
      if (!splat) return s === 0 ? 255 : 0;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
      const v = (xx: number, yy: number) => splat[(yy * sw + xx) * 4 + s]!;
      return (v(x0, y0) * (1 - ax) + v(x1, y0) * ax) * (1 - ay) + (v(x0, y1) * (1 - ax) + v(x1, y1) * ax) * ay;
    };
    for (let y = 0; y < H; y++) {
      const fy = (y / H) * sh - 0.5;
      for (let x = 0; x < W; x++) {
        const fx = (x / W) * sw - 0.5;
        let r = 0, g = 0, b = 0, tot = 0;
        for (let s = 0; s < 4; s++) {
          const wgt = weightAt(fx, fy, s);
          if (wgt < 1) continue;
          const px = slots[s];
          const o = (y * W + x) * 4;
          const c = px ? [px[o]!, px[o + 1]!, px[o + 2]!] : fallback[s]!;
          r += c[0]! * wgt; g += c[1]! * wgt; b += c[2]! * wgt; tot += wgt;
        }
        const o = (y * W + x) * 4;
        base[o] = tot ? r / tot : 90; base[o + 1] = tot ? g / tot : 100; base[o + 2] = tot ? b / tot : 70; base[o + 3] = 255;
      }
    }
  }

  // 2-3. Floor patterns (clipped to their polygons) and paths, by layer as Dungeondraft stacks them.
  const segs = (points: [number, number][], loop: boolean) => {
    const out: Array<[[number, number], [number, number]]> = [];
    for (let i = 0; i < points.length - 1 + (loop ? 1 : 0); i++) out.push([points[i]!, points[(i + 1) % points.length]!]);
    return out;
  };
  const drawStrip = async (res: string, a: [number, number], b: [number, number], thickPx: number | undefined, extend: number, fallbackColor: string) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * k + extend * 2;
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const tex = await tc.get(res, k);
    const T = thickPx ?? (tex ? tex.h : 0.3 * pps);
    const s = tex
      ? await strip(tex, len, T, ang)
      : await (async () => {
          const band = await sharp({ create: { width: Math.max(1, Math.round(len)), height: Math.max(1, Math.round(T)), channels: 4, background: fallbackColor } }).png().toBuffer();
          const r = await sharp(band).rotate(ang, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
          return { buf: r.data, w: r.info.width, h: r.info.height };
        })();
    const cx = ((a[0] + b[0]) / 2) * k, cy = ((a[1] + b[1]) / 2) * k;
    const left = Math.round(cx - s.w / 2), top = Math.round(cy - s.h / 2);
    if (left >= 0 && top >= 0 && left + s.w <= W && top + s.h <= H) return { input: s.buf, left, top } as OverlayOptions;
    // Long strips (a coastline across the map) can outgrow the canvas: keep the part that shows.
    const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(W, left + s.w), y1 = Math.min(H, top + s.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) return { input: { create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }, left: 0, top: 0 } as OverlayOptions;
    const part = await sharp(s.buf).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    return { input: part, left: x0, top: y0 } as OverlayOptions;
  };
  const floorItems = [
    ...(level.patterns ?? []).map((p: any, i: number) => ({ kind: "pattern" as const, p, layer: Number(p.layer ?? 100), i })),
    ...(level.paths ?? []).map((p: any, i: number) => ({ kind: "path" as const, p, layer: Number(p.layer ?? 100), i: 1e6 + i })),
  ].sort((a, b) => a.layer - b.layer || a.i - b.i);
  for (const item of floorItems) {
    const p = item.p;
    if (item.kind === "path") {
      const origin = parseVector2(p.position);
      const pts = parseVector2Array(p.edit_points).map(([x, y]) => [x + origin[0], y + origin[1]] as [number, number]);
      for (const [a, b] of segs(pts, !!p.loop)) layers.push(await drawStrip(p.texture, a, b, (p.width ?? 256) * k, 0, "#6b6256"));
      continue;
    }
    const pts = parseVector2Array(p.points).map(([x, y]) => [x * k, y * k] as [number, number]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
    const bw = Math.ceil(Math.max(...xs)) - x0, bh = Math.ceil(Math.max(...ys)) - y0;
    if (bw <= 0 || bh <= 0) continue;
    const tex = await tc.get(p.texture, k);
    const rot = Number(p.rotation ?? 0);
    let fill: Buffer;
    if (!tex) fill = await sharp({ create: { width: bw, height: bh, channels: 4, background: { r: 120, g: 100, b: 80, alpha: 1 } } }).png().toBuffer();
    else if (Math.abs(rot) < 1e-4) {
      // Tiles line up with the world, as in Dungeondraft, so neighbouring patches of one texture show no seam.
      const ox = ((x0 % tex.w) + tex.w) % tex.w, oy = ((y0 % tex.h) + tex.h) % tex.h;
      fill = ox || oy ? await sharp(await tiled(tex, bw + ox, bh + oy)).extract({ left: ox, top: oy, width: bw, height: bh }).png().toBuffer() : await tiled(tex, bw, bh);
    }
    else {
      // Texture turned with the pattern (roof tiles laid along their eave): tile a square that covers the box at any angle, turn it, cut the middle.
      const D = Math.ceil(Math.hypot(bw, bh)) + 4;
      const turned = await sharp(await tiled(tex, D, D)).rotate((rot * 180) / Math.PI, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
      fill = await sharp(turned.data).extract({ left: Math.floor((turned.info.width - bw) / 2), top: Math.floor((turned.info.height - bh) / 2), width: bw, height: bh }).png().toBuffer();
    }
    // Pattern color multiplies the texture, as in Dungeondraft (the dark around an enclosed building).
    if (p.color && !/^ffffffff$/i.test(p.color)) {
      const [cr, cg, cb] = argbToRgba(p.color);
      fill = await sharp(fill).linear([cr / 255, cg / 255, cb / 255, 1], [0, 0, 0, 0]).png().toBuffer();
    }
    const poly = pts.map(([x, y]) => `${(x - x0).toFixed(1)},${(y - y0).toFixed(1)}`).join(" ");
    const mask = Buffer.from(`<svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg"><polygon points="${poly}" fill="#fff"/></svg>`);
    const clipped = await sharp(fill).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    layers.push({ input: clipped, left: x0, top: y0 });
  }

  // 3b. Etchings: letters cut into the stone, a dark cut with a pale lip below it, turned as asked.
  if (opts.etchings?.length) {
    let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
    for (const e of opts.etchings) {
      const cx = e.at[0] * pps, cy = e.at[1] * pps, fs = Math.max(8, e.size * pps), deg = (e.rot * 180) / Math.PI;
      const text = e.text.replace(/[<>&"']/g, "");
      const lip = Math.max(1, fs * 0.045);
      const font = `font-family="Georgia, 'Times New Roman', Times, serif" font-size="${fs.toFixed(1)}" font-weight="bold" text-anchor="middle"`;
      s += `<g transform="rotate(${deg.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})">`
        + `<text x="${(cx + lip).toFixed(1)}" y="${(cy + fs * 0.36 + lip).toFixed(1)}" ${font} fill="rgba(255,248,230,0.42)">${text}</text>`
        + `<text x="${cx.toFixed(1)}" y="${(cy + fs * 0.36).toFixed(1)}" ${font} fill="rgba(26,20,14,0.66)">${text}</text></g>`;
    }
    layers.push({ input: Buffer.from(`${s}</svg>`), left: 0, top: 0 });
  }

  // 4. Walls (with a soft shadow), 5. portals.
  const wallLayers: OverlayOptions[] = [];
  for (const w of level.walls ?? []) {
    const pts = parseVector2Array(w.points);
    for (const [a, b] of segs(pts, !!w.loop)) wallLayers.push(await drawStrip(w.texture, a, b, undefined, 0.15 * pps, "#3b3631"));
  }
  // Wall shadow: the wall layers, darkened and blurred, slightly offset.
  if (wallLayers.length) {
    const wallsOnly = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(wallLayers).png().toBuffer();
    const shadow = await sharp(wallsOnly).linear([0, 0, 0, 0.55], [0, 0, 0, 0]).blur(Math.max(1, pps * 0.12)).png().toBuffer();
    layers.push({ input: shadow, left: Math.round(pps * 0.06), top: Math.round(pps * 0.08) }, { input: wallsOnly, left: 0, top: 0 });
  }
  for (const w of level.walls ?? []) {
    for (const p of w.portals ?? []) {
      const [x, y] = parseVector2(p.position);
      const leaf = opts.leaves?.[p.node_id];
      if (leaf && opts.leafMode === "hide") continue;
      // Leaves drawn in the frame's own art: the frame object shows them.
      if (leaf?.erase) continue;
      if (leaf && leaf.align === "edge") {
        // Framed gate: the closed leaves stand on the wall line and rise toward their side.
        const img0 = await leafImage(src, leaf);
        const m0 = await sharp(img0).metadata();
        const wPx = Math.max(1, Math.round(leaf.width * pps)), hPx = Math.max(1, Math.round(((m0.height ?? 1) * wPx) / (m0.width ?? 1)));
        const side = leaf.side ?? [0, -1];
        // Image "up" toward `side`: rotate the upright image by the angle from (0,-1) to side.
        const deg = (Math.atan2(side[0], -side[1]) * 180) / Math.PI;
        const rot = await sharp(await sharp(img0).resize(wPx, hPx, { fit: "fill" }).png().toBuffer()).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
        const cx = x * k + side[0] * hPx / 2, cy = y * k + side[1] * hPx / 2;
        layers.push({ input: rot.data, left: Math.round(cx - rot.info.width / 2), top: Math.round(cy - rot.info.height / 2) });
        continue;
      }
      const [psx] = parseVector2(p.scale ?? "Vector2( 1, 1 )");
      const tex = await tc.get(p.texture, k * Math.max(0.05, Math.abs(psx || 1)));
      const deg = ((p.rotation ?? 0) * 180) / Math.PI;
      const img = tex
        ? await sharp(tex.buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true })
        : await sharp({ create: { width: Math.round(p.radius * 2 * k), height: Math.round(0.25 * pps), channels: 4, background: "#7a5a3a" } }).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
      layers.push({ input: img.data, left: Math.round(x * k - img.info.width / 2), top: Math.round(y * k - img.info.height / 2) });
    }
  }

  // 6. Objects by layer, each with a drop shadow.
  const objects = [...(level.objects ?? [])].map((o, i) => ({ o, i })).sort((a, b) => a.o.layer - b.o.layer || a.i - b.i);
  // Frames whose leaves Foundry draws: their leaves are cut out of the background.
  const cut = new Map<string, [number, number, number, number]>();
  if (opts.leafMode === "hide") for (const l of Object.values(opts.leaves ?? {})) if (l.erase) { const a = src.asset(l.asset); if (a) cut.set(a.res, l.box); }
  for (const { o } of objects) {
    const [sx, sy] = parseVector2(o.scale ?? "Vector2( 1, 1 )");
    const tex0 = await tc.get(o.texture, k * Math.max(0.05, Math.abs(sx)));
    if (!tex0) continue;
    let tex = tex0;
    const box = cut.get(o.texture);
    if (box) {
      const x0 = Math.round(box[0] * tex0.w), y0 = Math.round(box[1] * tex0.h), x1 = Math.round(box[2] * tex0.w), y1 = Math.round(box[3] * tex0.h);
      const hole = Buffer.from(`<svg width="${tex0.w}" height="${tex0.h}" xmlns="http://www.w3.org/2000/svg"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff"/></svg>`);
      tex = { ...tex0, buf: await sharp(tex0.buf).composite([{ input: hole, blend: "dest-out" }]).png().toBuffer() };
    }
    let img = sharp(tex.buf);
    if (Math.abs(sy - sx) > 1e-3) img = img.resize(tex.w, Math.max(1, Math.round((tex.h * Math.abs(sy)) / Math.abs(sx))), { fit: "fill" });
    if (o.mirror) img = img.flop();
    if (o.custom_color) {
      // Colorable art is painted red; Dungeondraft swaps the red for the chosen color and keeps the shading.
      img = await recolor(img, argbToRgba(o.custom_color));
    }
    const deg = ((o.rotation ?? 0) * 180) / Math.PI;
    const rot = await img.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    const [x, y] = parseVector2(o.position);
    const left = Math.round(x * k - rot.info.width / 2), top = Math.round(y * k - rot.info.height / 2);
    if (left > W || top > H || left + rot.info.width < 0 || top + rot.info.height < 0) continue;
    if (o.shadow !== false && o.layer < 700) {
      const sh = await sharp(rot.data).linear([0, 0, 0, 0.6], [0, 0, 0, 0]).blur(Math.max(0.8, pps * 0.06)).png().toBuffer();
      layers.push({ input: sh, left: left + Math.round(pps * 0.06), top: top + Math.round(pps * 0.09) });
    }
    layers.push({ input: rot.data, left, top });
  }

  // Grid and labels go on top of the lit scene.
  const overlays: OverlayOptions[] = [];
  const sceneCount = layers.length;
  if (opts.grid) {
    let g = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><g stroke="rgba(0,0,0,0.18)" stroke-width="1">`;
    for (let x = 0; x <= W; x += pps) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
    for (let y = 0; y <= H; y += pps) g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
    overlays.push({ input: Buffer.from(`${g}</g></svg>`), left: 0, top: 0 });
  }
  if (opts.labels?.length) {
    const fs = Math.max(10, Math.round(pps * 0.35));
    let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
    for (const l of opts.labels) {
      const cx = l.x * pps, cy = l.y * pps;
      const text = l.text.replace(/[<>&"']/g, "");
      s += `<circle cx="${cx}" cy="${cy}" r="${fs * 0.8}" fill="rgba(20,20,20,0.75)" stroke="#fff" stroke-width="1.5"/><text x="${cx}" y="${cy + fs * 0.35}" font-family="sans-serif" font-size="${fs}" font-weight="bold" fill="#fff" text-anchor="middle">${text}</text>`;
    }
    overlays.push({ input: Buffer.from(`${s}</svg>`), left: 0, top: 0 });
  }
  void sceneCount;
  // Clip overlays that hang off the canvas; sharp rejects overlays larger than the base.
  const safe: OverlayOptions[] = [];
  for (const l of layers) {
    if (l.left === undefined) { safe.push(l); continue; }
    const meta = await sharp(l.input as Buffer).metadata();
    const lw = meta.width ?? 0, lh = meta.height ?? 0;
    const x0 = Math.max(0, l.left), y0 = Math.max(0, l.top ?? 0);
    const x1 = Math.min(W, l.left + lw), y1 = Math.min(H, (l.top ?? 0) + lh);
    if (x1 <= x0 || y1 <= y0) continue;
    if (x0 === l.left && y0 === l.top && x1 - x0 === lw && y1 - y0 === lh) { safe.push(l); continue; }
    const cut = await sharp(l.input as Buffer).extract({ left: x0 - l.left, top: y0 - (l.top ?? 0), width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    safe.push({ ...l, input: cut, left: x0, top: y0 });
  }
  let scene: Buffer = await sharp(base, { raw: { width: W, height: H, channels: 4 } }).composite(safe).png().toBuffer();
  if (opts.lighting) scene = await applyLighting(scene, level, W, H, k, pps);
  const out = overlays.length ? sharp(scene).composite(overlays) : sharp(scene);
  return opts.format === "webp" ? out.webp({ quality: opts.quality ?? 82 }).toBuffer() : out.png().toBuffer();
}

/**
 * Lighting like Dungeondraft's: a light map of the ambient color plus every light's pool
 * (added, smooth falloff), multiplied into the scene, then a faint warm glow around each
 * light so flames read as bright.
 */
async function applyLighting(scene: Buffer, level: any, W: number, H: number, k: number, pps: number): Promise<Buffer> {
  const amb = argbToRgba(level.environment?.ambient_light ?? "ffffffff");
  const blockers = lightBlockers(level, k);
  const pools: OverlayOptions[] = [];
  // Floors mark the building; a light standing on one is indoors and its pool stays within 1.5 squares of the building.
  // Dark-tinted patterns are the unseen dark around a building, not floor.
  const isFloor = (p: any) => !p.color || lum(p.color) > 0.35;
  const floorBoxes = ((level.patterns ?? []) as any[]).filter(isFloor).map((p) => {
    const o = parseVector2(p.position ?? "Vector2( 0, 0 )");
    const pts = parseVector2Array(p.points).map(([x, y]) => [(x + o[0]) * k, (y + o[1]) * k] as [number, number]);
    return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  });
  const bx0 = Math.min(...floorBoxes.map((b) => b[0]!)) - 1.5 * pps, by0 = Math.min(...floorBoxes.map((b) => b[1]!)) - 1.5 * pps;
  const bx1 = Math.max(...floorBoxes.map((b) => b[2]!)) + 1.5 * pps, by1 = Math.max(...floorBoxes.map((b) => b[3]!)) + 1.5 * pps;
  const indoors = (x: number, y: number) => floorBoxes.some((b) => x >= b[0]! && x <= b[2]! && y >= b[1]! && y <= b[3]!);
  const glows: string[] = [];
  for (const l of (level.lights ?? []) as any[]) {
    const [x, y] = parseVector2(l.position);
    const [r, g, b] = argbToRgba(l.color ?? "ffeccd8b");
    const R = Math.max(4, (l.range ?? 5) * pps);
    const I = Math.max(0, Math.min(1.5, l.intensity ?? 1));
    const size = Math.ceil(R * 2);
    const left = Math.round(x * k - R), top = Math.round(y * k - R);
    if (left > W || top > H || left + size < 0 || top + size < 0) continue;
    const stops = [0, 0.25, 0.55, 1].map((t) => {
      const v = I * Math.pow(1 - t, 1.6);
      return `<stop offset="${t}" stop-color="rgb(${Math.round(r * v)},${Math.round(g * v)},${Math.round(b * v)})"/>`;
    }).join("");
    // Walls cast shadows: the pool only reaches what the light can see.
    const inside = floorBoxes.length > 0 && indoors(x * k, y * k);
    const vis = visibility([x * k, y * k], R, blockers)
      .map(([px, py]) => (inside ? [Math.max(bx0, Math.min(bx1, px)), Math.max(by0, Math.min(by1, py))] : [px, py]))
      .map(([px, py]) => `${(px! - left).toFixed(1)},${(py! - top).toFixed(1)}`).join(" ");
    let pool = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%">${stops}</radialGradient><clipPath id="v"><polygon points="${vis}"/></clipPath></defs><rect width="${size}" height="${size}" fill="black"/><circle cx="${R}" cy="${R}" r="${R}" fill="url(#g)" clip-path="url(#v)"/></svg>`);
    // Clip to the canvas; sharp needs overlays inside the base.
    const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(W, left + size), y1 = Math.min(H, top + size);
    if (x1 <= x0 || y1 <= y0) continue;
    let png = await sharp(pool).png().toBuffer();
    if (x0 !== left || y0 !== top || x1 - x0 !== size || y1 - y0 !== size) png = await sharp(png).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    pools.push({ input: png, left: x0, top: y0, blend: "add" });
    const gr = Math.max(3, R * 0.22);
    glows.push(`<radialGradient id="w${glows.length}" cx="${x * k}" cy="${y * k}" r="${gr}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgb(${r},${g},${b})" stop-opacity="${0.55 * Math.min(1, I)}"/><stop offset="1" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/></radialGradient><circle cx="${x * k}" cy="${y * k}" r="${gr}" fill="url(#w${glows.length})"/>`);
    void pool;
  }
  // Indoors never drops to the outdoor night: floors get a lifted ambient (rooms have many small lights).
  const lift = (c: number) => Math.round(c + (255 - c) * 0.22);
  const floors = ((level.patterns ?? []) as any[]).filter(isFloor).map((p) => {
    const origin = parseVector2(p.position ?? "Vector2( 0, 0 )");
    const pts = parseVector2Array(p.points).map(([x, y]) => `${((x + origin[0]) * k).toFixed(1)},${((y + origin[1]) * k).toFixed(1)}`).join(" ");
    return `<polygon points="${pts}" fill="rgb(${lift(amb[0])},${lift(amb[1])},${lift(amb[2])})"/>`;
  }).join("");
  const base: OverlayOptions[] = floors ? [{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${floors}</svg>`), left: 0, top: 0 }] : [];
  const lightMap = await sharp({ create: { width: W, height: H, channels: 3, background: { r: amb[0], g: amb[1], b: amb[2] } } }).composite([...base, ...pools]).png().toBuffer();
  const lit = await sharp(scene).composite([{ input: lightMap, blend: "multiply" }]).png().toBuffer();
  if (!glows.length) return lit;
  return sharp(lit).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${glows.join("")}</svg>`), blend: "screen" }]).png().toBuffer();
}

type Seg = [number, number, number, number];

function lum(argb: string): number {
  const [r, g, b] = argbToRgba(argb);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Wall segments that block light, in output pixels; windows are gaps, closed doors block. */
function lightBlockers(level: any, k: number): Seg[] {
  const out: Seg[] = [];
  for (const w of (level.walls ?? []) as any[]) {
    const pts = parseVector2Array(w.points).map(([x, y]) => [x * k, y * k] as [number, number]);
    const n = w.loop ? pts.length : pts.length - 1;
    // Open doorways let light through; windows don't (their beams read as searchlights on a battle map).
    const gaps = ((w.portals ?? []) as any[]).filter((p) => p.closed === false && !/window/i.test(p.texture ?? "")).map((p) => {
      const [x, y] = parseVector2(p.position);
      return { at: [x * k, y * k] as [number, number], r: (p.radius ?? 128) * k };
    });
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      // Cut window openings out of the segment.
      const cuts: Array<[number, number]> = [];
      for (const g of gaps) {
        const t = (g.at[0] - a[0]) * ux + (g.at[1] - a[1]) * uy;
        const off = Math.abs((g.at[0] - a[0]) * uy - (g.at[1] - a[1]) * ux);
        if (off < 8 && t > -g.r && t < len + g.r) cuts.push([t - g.r, t + g.r]);
      }
      cuts.sort((p, q) => p[0] - q[0]);
      let t0 = 0;
      for (const [c0, c1] of cuts) {
        if (c0 > t0) out.push([a[0] + ux * t0, a[1] + uy * t0, a[0] + ux * c0, a[1] + uy * c0]);
        t0 = Math.max(t0, c1);
      }
      if (t0 < len) out.push([a[0] + ux * t0, a[1] + uy * t0, b[0], b[1]]);
    }
  }
  return out;
}

/** Visibility polygon of a point light against blocking segments, out to radius R. */
function visibility(o: [number, number], R: number, segs: Seg[]): Array<[number, number]> {
  const near = segs.filter(([x1, y1, x2, y2]) => {
    // Distance from o to the segment.
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((o[0] - x1) * dx + (o[1] - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(o[0] - (x1 + t * dx), o[1] - (y1 + t * dy)) < R;
  });
  if (!near.length) return Array.from({ length: 48 }, (_, i) => [o[0] + Math.cos((i / 48) * 2 * Math.PI) * R, o[1] + Math.sin((i / 48) * 2 * Math.PI) * R] as [number, number]);
  const angles: number[] = [];
  for (let i = 0; i < 96; i++) angles.push((i / 96) * 2 * Math.PI - Math.PI);
  for (const [x1, y1, x2, y2] of near) {
    for (const [px, py] of [[x1, y1], [x2, y2]]) {
      const a = Math.atan2(py! - o[1], px! - o[0]);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }
  angles.sort((p, q) => p - q);
  const pts: Array<[number, number]> = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = R;
    for (const [x1, y1, x2, y2] of near) {
      // Ray o + t*d against segment p1 + u*(p2 - p1).
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - o[0]) * ey - (y1 - o[1]) * ex) / den;
      const u = ((x1 - o[0]) * dy - (y1 - o[1]) * dx) / den;
      if (t > 0.5 && u >= 0 && u <= 1 && t < best) best = t;
    }
    pts.push([o[0] + dx * best, o[1] + dy * best]);
  }
  return pts;
}

/** Replaces the red of colorable art with a color, keeping its light and dark (Dungeondraft's custom color). */
async function recolor(img: Sharp, rgb: [number, number, number, number] | number[]): Promise<Sharp> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [tr, tg, tb] = rgb as [number, number, number];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (r < 8) continue;
    const red = Math.max(0, Math.min(1, (r - Math.max(g, b)) / r));
    if (red <= 0) continue;
    const v = r / 255;
    data[i] = Math.round(r * (1 - red) + tr * v * red);
    data[i + 1] = Math.round(g * (1 - red) + tg * v * red);
    data[i + 2] = Math.round(b * (1 - red) + tb * v * red);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}
