/**
 * Traces the real outline of every house and landmark roof drawing (city/houses.ts), so walls
 * and shadows follow an L- or cross-shaped roof instead of its bounding box. Also trims the
 * very large images the indexer left untrimmed. Writes data/house-outlines.json, which
 * loadIndex() applies to the index.
 *
 *   npx tsx packages/companion/src/cli/house-outlines.ts
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { houseArtFrom } from "@gmm/core";
import { AssetSource } from "../assets/source";
import { loadIndex } from "../assets/load";

const GRID = 160;

type P = [number, number];

/** Douglas-Peucker on a closed ring. */
function simplify(ring: P[], tol: number): P[] {
  const dp = (pts: P[]): P[] => {
    if (pts.length < 3) return pts;
    const a = pts[0]!, b = pts[pts.length - 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let worst = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst <= tol) return [a, b];
    return [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  // Split the ring at its two farthest-apart points and simplify each half.
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]) > Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])) far = i;
  const one = dp(ring.slice(0, far + 1)), two = dp([...ring.slice(far), ring[0]!]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/** The outer boundary of the largest opaque blob in a mask, as a ring of cell corners. */
function outline(mask: Uint8Array, w: number, h: number): P[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Largest 4-connected component.
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1 || comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = i;
    let n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (at(nx, ny) && comp[ny * w + nx] === -1) { comp[ny * w + nx] = i; stack.push(ny * w + nx); }
      }
    }
    if (n > bestSize) { bestSize = n; best = i; }
  }
  const inBlob = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && comp[y * w + x] === best;
  // Boundary edges, clockwise on screen, chained into loops; the loop with the largest area is the outside.
  const next = new Map<string, P[]>();
  const key = (p: P) => `${p[0]},${p[1]}`;
  const add = (a: P, b: P) => (next.get(key(a)) ?? next.set(key(a), []).get(key(a))!).push(b);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inBlob(x, y)) continue;
    if (!inBlob(x, y - 1)) add([x, y], [x + 1, y]);
    if (!inBlob(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!inBlob(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!inBlob(x - 1, y)) add([x, y + 1], [x, y]);
  }
  let outer: P[] = [], outerArea = 0;
  while (next.size) {
    const [k0, list0] = next.entries().next().value as [string, P[]];
    const start = k0.split(",").map(Number) as P;
    const loop: P[] = [start];
    let cur = list0.pop()!;
    if (!list0.length) next.delete(k0);
    let guard = 0;
    while (key(cur) !== k0 && guard++ < 1e6) {
      loop.push(cur);
      const list = next.get(key(cur));
      if (!list?.length) break;
      const nxt = list.pop()!;
      if (!list.length) next.delete(key(cur));
      cur = nxt;
    }
    let a = 0;
    for (let i = 0; i < loop.length; i++) { const p = loop[i]!, q = loop[(i + 1) % loop.length]!; a += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(a) > outerArea) { outerArea = Math.abs(a); outer = loop; }
  }
  return outer;
}

const index = await loadIndex("data/asset-index.json");
const src = new AssetSource(index);
const art = houseArtFrom(index);
const out: Record<string, { trim: [number, number, number, number]; outline: P[] }> = {};
for (const h of art) {
  const a = h.asset;
  try {
    const bytes = await src.bytes(a.id);
    let trim = a.trim;
    if (!trim) {
      // Trim at a reduced size, then scale the box back up.
      const k = Math.min(1, 600 / Math.max(a.size[0], a.size[1]));
      const small = await sharp(bytes, { limitInputPixels: false }).ensureAlpha().resize(Math.round(a.size[0] * k), Math.round(a.size[1] * k), { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      const { width: sw, height: sh, channels: ch } = small.info;
      let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (small.data[(y * sw + x) * ch + 3]! > 16) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      trim = [Math.floor(x0 / k), Math.floor(y0 / k), Math.ceil((x1 - x0 + 1) / k), Math.ceil((y1 - y0 + 1) / k)];
      trim[2] = Math.min(trim[2], a.size[0] - trim[0]);
      trim[3] = Math.min(trim[3], a.size[1] - trim[1]);
    }
    const [tx, ty, tw, th] = trim;
    const gw = tw >= th ? GRID : Math.max(8, Math.round((GRID * tw) / th)), gh = th >= tw ? GRID : Math.max(8, Math.round((GRID * th) / tw));
    const raw = await sharp(bytes, { limitInputPixels: false }).ensureAlpha().extract({ left: tx, top: ty, width: tw, height: th }).resize(gw, gh, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    const ch = raw.info.channels;
    const mask = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) mask[i] = raw.data[i * ch + 3]! > 110 ? 1 : 0;
    // Close one-cell gaps (ivy, soft edges) so the outline stays one piece.
    const closed = new Uint8Array(mask);
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) if (!mask[y * gw + x] && ((mask[y * gw + x - 1] && mask[y * gw + x + 1]) || (mask[(y - 1) * gw + x] && mask[(y + 1) * gw + x]))) closed[y * gw + x] = 1;
    const ring = simplify(outline(closed, gw, gh), Math.max(gw, gh) * 0.015);
    out[a.id] = { trim, outline: ring.map(([x, y]) => [Number((x / gw).toFixed(4)), Number((y / gh).toFixed(4))] as P) };
    console.log(`${a.name.padEnd(48)} ${ring.length} corners${a.trim ? "" : `, trimmed to ${trim.join(",")}`}`);
  } catch (e) {
    console.log(`${a.name}: ${(e as Error).message}`);
  }
}
await writeFile(resolve("data/house-outlines.json"), JSON.stringify(out));
console.log(`${Object.keys(out).length} outlines -> data/house-outlines.json`);
