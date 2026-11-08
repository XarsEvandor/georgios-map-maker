/**
 * Image analysis for the asset index: size, opaque bounding box, color profile and a
 * difference hash. Works on a downscaled copy, so a 600 px asset costs about as much as
 * a 128 px one.
 */

import sharp from "sharp";
import type { LookFeatures } from "@gmm/core";

export interface ImageAnalysis {
  size: [number, number];
  /** Opaque bounding box in full-resolution pixels. Undefined when the image is fully transparent. */
  trim?: [number, number, number, number];
  look?: LookFeatures;
}

const SAMPLE = 128; // longest side of the analysis copy
const ALPHA_EDGE = 24; // alpha above this counts as part of the drawing
const ALPHA_SOLID = 128; // alpha above this counts for color statistics

/** Decode limit: the largest 2MT image is about 99 megapixels; anything far beyond is hostile or broken. */
export const MAX_PIXELS = 150_000_000;

/** Images larger than this on a side are only measured, not analyzed (whole pre-built maps). */
export const ANALYZE_MAX_SIDE = 4096;

export async function imageSize(buf: Buffer): Promise<[number, number]> {
  const m = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
  return [m.width ?? 0, m.height ?? 0];
}

export async function analyzeImage(buf: Buffer, wantLook = true): Promise<ImageAnalysis> {
  const size = await imageSize(buf);
  if (Math.max(...size) > ANALYZE_MAX_SIDE) return { size };
  const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS })
    .resize({ width: SAMPLE, height: SAMPLE, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const box = opaqueBox(data, w, h);
  if (!box) return { size };
  const sx = size[0] / w;
  const sy = size[1] / h;
  const trim: [number, number, number, number] = [
    Math.round(box[0] * sx),
    Math.round(box[1] * sy),
    Math.max(1, Math.round(box[2] * sx)),
    Math.max(1, Math.round(box[3] * sy)),
  ];
  if (!wantLook) return { size, trim };
  return { size, trim, look: lookOf(data, w, h, box) };
}

function opaqueBox(px: Buffer, w: number, h: number): [number, number, number, number] | undefined {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]! > ALPHA_EDGE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? undefined : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// ---- color ----

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const LAB_LUT = new Map<number, [number, number, number]>();
function labOf(r: number, g: number, b: number): [number, number, number] {
  // Quantize to 5 bits per channel for a small cache; the error is far below what grouping needs.
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let v = LAB_LUT.get(key);
  if (!v) {
    v = rgbToLab((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4);
    LAB_LUT.set(key, v);
  }
  return v;
}

function lookOf(px: Buffer, w: number, h: number, box: [number, number, number, number]): LookFeatures {
  const labs: Array<[number, number, number]> = [];
  let sumL = 0, sumA = 0, sumB = 0, sumW = 0, sumC = 0;
  const [bx, by, bw, bh] = box;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3]!;
      if (a < ALPHA_SOLID) continue;
      const lab = labOf(px[i]!, px[i + 1]!, px[i + 2]!);
      const wt = a / 255;
      sumL += lab[0] * wt;
      sumA += lab[1] * wt;
      sumB += lab[2] * wt;
      sumC += Math.hypot(lab[1], lab[2]) * wt;
      sumW += wt;
      labs.push(lab);
    }
  }
  const meanLab: [number, number, number] = sumW
    ? [round1(sumL / sumW), round1(sumA / sumW), round1(sumB / sumW)]
    : [0, 0, 0];
  return {
    dhash: dhash(px, w, box),
    meanLab,
    chroma: sumW ? round1(sumC / sumW) : 0,
    colors: dominantColors(labs, 3),
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Small k-means in Lab space. Deterministic: seeds at lightness quantiles. */
function dominantColors(labs: Array<[number, number, number]>, k: number): Array<[number, number, number, number]> {
  if (!labs.length) return [];
  const step = Math.max(1, Math.floor(labs.length / 2000));
  const pts = labs.filter((_, i) => i % step === 0);
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const kk = Math.min(k, pts.length);
  let centers = Array.from({ length: kk }, (_, i) => [...sorted[Math.floor(((i + 0.5) * sorted.length) / kk)]!] as [number, number, number]);
  let counts = new Array(kk).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(kk).fill(0);
    for (const p of pts) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = (p[0] - centers[c]![0]) ** 2 + (p[1] - centers[c]![1]) ** 2 + (p[2] - centers[c]![2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best]![0]! += p[0];
      sums[best]![1]! += p[1];
      sums[best]![2]! += p[2];
      counts[best]++;
    }
    centers = centers.map((c, i) => (counts[i] ? [sums[i]![0]! / counts[i], sums[i]![1]! / counts[i], sums[i]![2]! / counts[i]] : c) as [number, number, number]);
  }
  return centers
    .map((c, i) => [round1(c[0]), round1(c[1]), round1(c[2]), Math.round((counts[i] / pts.length) * 100) / 100] as [number, number, number, number])
    .filter((c) => c[3] > 0)
    .sort((a, b) => b[3] - a[3]);
}

/**
 * 64-bit difference hash of the trimmed drawing, composited over mid gray so that
 * transparent areas compare equal. Returned as 16 hex characters.
 */
function dhash(px: Buffer, w: number, box: [number, number, number, number]): string {
  const [bx, by, bw, bh] = box;
  const gray = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const a = px[i + 3]! / 255;
    const l = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    return l * a + 128 * (1 - a);
  };
  // Box-average the trimmed area into a 9x8 grid.
  const cells: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x0 = bx + Math.floor((gx * bw) / 9), x1 = Math.max(x0 + 1, bx + Math.floor(((gx + 1) * bw) / 9));
      const y0 = by + Math.floor((gy * bh) / 8), y1 = Math.max(y0 + 1, by + Math.floor(((gy + 1) * bh) / 8));
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray(x, y); n++; }
      cells.push(s / n);
    }
  }
  let bits = 0n;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      bits = (bits << 1n) | (cells[gy * 9 + gx]! < cells[gy * 9 + gx + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
