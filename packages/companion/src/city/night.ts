/**
 * The city image at night, as seen from above: the day image dimmed to a cold blue, with the
 * city's lights (core cityNightLights) as tiny warm glows screened on top.
 */

import sharp, { type OverlayOptions } from "sharp";
import type { City } from "@gmm/core";
import { cityNightLights, type NightLightKind } from "@gmm/core";
import { cityScale } from "./render";

/** Each kind's glow: a hot core fading through amber to nothing. */
const GLOW: Record<NightLightKind, Array<[number, string, number]>> = {
  window: [[0, "#fff1c8", 1], [0.18, "#ffc768", 0.85], [0.5, "#ff9d42", 0.28], [1, "#ff8a30", 0]],
  lamp: [[0, "#fff6d8", 1], [0.12, "#ffd98a", 0.9], [0.45, "#ffb04f", 0.3], [1, "#ff9a3a", 0]],
  fire: [[0, "#fff0c0", 1], [0.15, "#ffb44a", 0.9], [0.5, "#ff7a24", 0.35], [1, "#ff6a1a", 0]],
  tower: [[0, "#ffeab8", 1], [0.15, "#ffbe5c", 0.85], [0.5, "#ff9036", 0.3], [1, "#ff8028", 0]],
};

/** How strongly the bloom (the lights blurred wide) lifts, and the most it covers (of 255). */
const BLOOM = 9;
const BLOOM_CAP = 120;

/** The smallest a glow is drawn, in pixels, however coarse the city's scale. */
const MIN_PX: Record<NightLightKind, number> = { window: 5, lamp: 6, fire: 10, tower: 7 };

/** The night image of a city from its day image (webp or png). */
export async function renderCityNight(day: Buffer, city: City): Promise<Buffer> {
  const { ppm, toPx } = cityScale(city);
  const meta = await sharp(day, { limitInputPixels: false }).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  // About a third of the day's light, cold and grey-blue.
  const dim = await sharp(day, { limitInputPixels: false })
    .removeAlpha()
    .modulate({ brightness: 0.5, saturation: 0.5 })
    .composite([{ input: { create: { width: W, height: H, channels: 3, background: { r: 88, g: 100, b: 150 } } }, blend: "multiply" }])
    .raw()
    .toBuffer();
  const defs = Object.entries(GLOW).map(([k, stops]) => `<radialGradient id="${k}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`).join("");
  const glows: string[] = [];
  for (const l of cityNightLights(city)) {
    const [x, y] = toPx(l.at);
    // A big city is drawn at a coarser scale: its lights keep a few pixels so they still read.
    const r = Math.max(MIN_PX[l.kind], l.r * ppm);
    if (x < -r || y < -r || x > W + r || y > H + r) continue;
    glows.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#${l.kind})" fill-opacity="${l.i.toFixed(2)}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>${glows.join("")}</svg>`;
  // Raw pixels between the steps: a PNG of a 4000-pixel city takes most of a minute to encode.
  const light = await sharp(Buffer.from(svg), { limitInputPixels: false }).raw().toBuffer();
  // Bloom: where the lights crowd, a wide amber haze, as a city glows from the air. Made from
  // the glows' coverage alone (blurred), so it keeps its colour however bright it gets.
  const sigma = Math.max(8, Math.min(48, 12 * ppm));
  const blurred = await sharp(light, { raw: { width: W, height: H, channels: 4 }, limitInputPixels: false })
    .extractChannel(3)
    .blur(sigma)
    .raw()
    .toBuffer();
  // A soft cap: faint crowds of lights lift well, the gate fires level off instead of blowing out.
  const lut = Array.from({ length: 256 }, (_, v) => Math.round(BLOOM_CAP * (1 - Math.exp(-(v * BLOOM) / BLOOM_CAP))));
  const mask = Buffer.alloc(W * H);
  for (let k = 0; k < mask.length; k++) mask[k] = lut[blurred[k]!]!;
  const bloom = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 150, b: 60 } } })
    .joinChannel(mask, { raw: { width: W, height: H, channels: 1 } })
    .raw()
    .toBuffer();
  const raw = (input: Buffer): OverlayOptions => ({ input, raw: { width: W, height: H, channels: 4 }, blend: "screen", limitInputPixels: false } as OverlayOptions);
  return sharp(dim, { raw: { width: W, height: H, channels: 3 }, limitInputPixels: false })
    .composite([raw(bloom), raw(light)])
    .webp({ quality: 82, effort: 2 })
    .toBuffer();
}
