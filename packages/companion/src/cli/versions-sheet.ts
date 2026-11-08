/**
 * Side-by-side sheet of a plan's versions, like the version picker.
 *   npx tsx packages/companion/src/cli/versions-sheet.ts data/maps/<plan id> [--pps 28]
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import type { AssetIndex } from "@gmm/core";
import { AssetSource } from "../assets/source";
import { renderMap } from "../render/render";
import { loadIndex } from "../assets/load";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { pps: { type: "string", default: "28" }, lighting: { type: "boolean", default: false } } });
const dir = resolve(positionals[0]!);
const index = await loadIndex("data/asset-index.json");
const src = new AssetSource(index);
const files = (await readdir(dir)).filter((f) => /^v\d+\.dungeondraft_map$/.test(f)).sort();
const imgs: Buffer[] = [];
for (const f of files) imgs.push(await renderMap(JSON.parse(await readFile(join(dir, f), "utf8")), src, { pps: Number(values.pps), lighting: values.lighting }));
const metas = await Promise.all(imgs.map((i) => sharp(i).metadata()));
const gap = 12;
const W = metas.reduce((s, m) => s + (m.width ?? 0), 0) + gap * (imgs.length + 1);
const H = Math.max(...metas.map((m) => m.height ?? 0)) + gap * 2;
let x = gap;
const layers = imgs.map((input, i) => {
  const l = { input, left: x, top: gap };
  x += (metas[i]!.width ?? 0) + gap;
  return l;
});
const out = join(dir, values.lighting ? "versions.lit.png" : "versions.png");
await sharp({ create: { width: W, height: H, channels: 4, background: "#1e1e1e" } }).composite(layers).png().toFile(out);
await src.close();
console.log(out);
