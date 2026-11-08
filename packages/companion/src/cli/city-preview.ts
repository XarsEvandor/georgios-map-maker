/**
 * Renders a cached city and its hot spots' street maps to PNGs, for looking at the city art
 * without Foundry.
 *   npx tsx packages/companion/src/cli/city-preview.ts --city 6da09c265782637a --spots market,docks --out data/preview
 *   npx tsx packages/companion/src/cli/city-preview.ts --city 0be7d407427cc2fb --spots "" --area market,40,-60,70
 *     (a box 70 m across, centred 40 m east and 60 m north of the market)
 *   --roofs draws street maps with roofs instead of the buildings' insides.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { allHotSpots, areaPlan, Catalog, generate, GENRE_SETTINGS, hotspotPlan, parseCity } from "@gmm/core";
import { AssetSource } from "../assets/source";
import { loadIndex } from "../assets/load";
import { renderCity } from "../city/render";
import { renderMap } from "../render/render";

const { values } = parseArgs({
  options: {
    city: { type: "string" },
    spots: { type: "string", default: "market" },
    overview: { type: "boolean", default: false },
    houses: { type: "string", default: "art" },
    crop: { type: "string" },
    area: { type: "string" },
    roofs: { type: "boolean", default: false },
    pps: { type: "string", default: "70" },
    index: { type: "string", default: "data/asset-index.json" },
    out: { type: "string", default: "data/preview" },
  },
});

const dir = resolve("data/cities");
const key = values.city!;
const meta = JSON.parse(await readFile(join(dir, `${key}.meta.json`), "utf8"));
const city = parseCity(JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")), meta);
const index = await loadIndex(values.index!);
const src = new AssetSource(index);
const out = resolve(values.out!);
await mkdir(out, { recursive: true });

if (values.overview) {
  const t0 = Date.now();
  const img = await renderCity(city, src, index, { houses: values.houses === "art" ? "art" : "roofs" });
  await writeFile(join(out, "city.webp"), img.image);
  // Crops at full size around hot spots or metre points: "market,1400;keep,1000" or "x,y,size".
  for (const spec of (values.crop ?? "market,1400").split(";")) {
    const parts = spec.split(",");
    const hs = allHotSpots(city).find((x) => x.id === parts[0]);
    const [cx, cy, size] = hs ? [hs.at[0], hs.at[1], Number(parts[1] ?? 1400)] : (parts.map(Number) as [number, number, number]);
    if (![cx, cy, size].every(Number.isFinite)) { console.log(`no crop: ${spec}`); continue; }
    const [px, py] = img.toPx([cx, cy]);
    const left = Math.max(0, Math.min(img.width - size, Math.round(px - size / 2))), top = Math.max(0, Math.min(img.height - size, Math.round(py - size / 2)));
    const name = hs ? hs.id : `${cx}_${cy}`;
    await sharp(img.image).extract({ left, top, width: Math.min(size, img.width), height: Math.min(size, img.height) }).png().toFile(join(out, `city-crop-${name}.png`));
  }
  await sharp(img.image).resize({ width: 1800 }).png().toFile(join(out, "city-small.png"));
  console.log(`city ${img.width}x${img.height} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const spots = allHotSpots(city);
for (const id of values.spots!.split(",").filter(Boolean)) {
  const hs = spots.find((h) => h.id === id);
  if (!hs) { console.log(`no ${id}`); continue; }
  const plan = hotspotPlan(city, hs, { key, prefix: "preview" });
  const cat = new Catalog(index, GENRE_SETTINGS[plan.genre]);
  const t0 = Date.now();
  const gen = generate(plan, cat, { city, date: new Date(2026, 10, 7), houses: values.houses === "art" ? "art" : "roofs", interiors: !values.roofs });
  const v = gen.versions[0]!;
  const png = await renderMap(v.map, src, { pps: Number(values.pps), lighting: true });
  await writeFile(join(out, `${id}.png`), png);
  await sharp(png).resize({ width: 1600, withoutEnlargement: true }).png().toFile(join(out, `${id}-small.png`));
  console.log(`${id}: ${gen.layout.map.w}x${gen.layout.map.h} squares, ${v.summary.objects} objects, ${((Date.now() - t0) / 1000).toFixed(1)} s; ${v.notes.filter((n) => /stalls/.test(n)).join("; ")}`);
}

// A box of the city round a hot spot: "spot,dx,dy,size" in metres (dy negative is north).
if (values.area) {
  const [id, dx, dy, size] = values.area.split(",");
  const hs = spots.find((h) => h.id === id);
  if (!hs) console.log(`no ${id}`);
  else {
    const s = Number(size ?? 70), cx = hs.at[0] + Number(dx ?? 0), cy = hs.at[1] + Number(dy ?? 0);
    const plan = areaPlan(city, { x: cx - s / 2, y: cy - s / 2, w: s, h: s }, { key, prefix: "preview", id: `area-${Math.round(cx)}-${Math.round(cy)}`, title: "area" });
    const cat = new Catalog(index, GENRE_SETTINGS[plan.genre]);
    const t0 = Date.now();
    const gen = generate(plan, cat, { city, date: new Date(2026, 10, 7), interiors: !values.roofs });
    const v = gen.versions[0]!;
    const png = await renderMap(v.map, src, { pps: Number(values.pps), lighting: true });
    const name = `area-${id}${dx}${dy}`.replace(/[^a-z0-9-]/gi, "_");
    await writeFile(join(out, `${name}.png`), png);
    await writeFile(join(out, `${name}.notes.txt`), v.notes.join("\n"));
    await sharp(png).resize({ width: 1600, withoutEnlargement: true }).png().toFile(join(out, `${name}-small.png`));
    console.log(`${name}: ${gen.layout.map.w}x${gen.layout.map.h} squares, ${v.summary.objects} objects, ${v.summary.doors} doors, ${v.summary.windows} windows, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
