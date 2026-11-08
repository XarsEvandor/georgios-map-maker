/**
 * Render generated maps to images.
 *   npm run render -- data/maps/smugglers-tavern [--pps 64] [--lighting] [--grid]
 * Renders every .dungeondraft_map in the folder (or a single file) next to it as .png.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AssetIndex } from "@gmm/core";
import { AssetSource } from "../assets/source";
import { renderMap } from "../render/render";
import { loadIndex } from "../assets/load";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pps: { type: "string", default: "64" },
    lighting: { type: "boolean", default: false },
    grid: { type: "boolean", default: false },
    index: { type: "string", default: "data/asset-index.json" },
  },
});
const target = resolve(positionals[0] ?? "data/maps");
const files = (await stat(target)).isDirectory()
  ? (await readdir(target)).filter((f) => f.endsWith(".dungeondraft_map")).map((f) => join(target, f))
  : [target];
const index = await loadIndex(values.index!);
const src = new AssetSource(index);
// Gate leaves from the generation record, when there is one.
const gen = await readFile(join((await stat(target)).isDirectory() ? target : resolve(target, ".."), "generation.json"), "utf8").then((t) => JSON.parse(t)).catch(() => undefined);
for (const f of files) {
  const t0 = Date.now();
  const map = JSON.parse(await readFile(f, "utf8"));
  const vid = f.replace(/^.*[\\/]/, "").replace(/\.dungeondraft_map$/, "");
  const els = gen?.versions?.find((v: any) => v.id === vid)?.elements ?? {};
  const leaves = Object.fromEntries(Object.entries(els).filter(([, e]: [string, any]) => e.leaf).map(([k, e]: [string, any]) => [k, { ...e.leaf, width: e.width ?? 1 }]));
  const png = await renderMap(map, src, { pps: Number(values.pps), lighting: values.lighting, grid: values.grid, leaves, leafMode: "closed" });
  const out = f.replace(/\.dungeondraft_map$/, values.lighting ? ".lit.png" : ".png");
  await writeFile(out, png);
  console.log(`${out} (${Date.now() - t0} ms)`);
}
await src.close();
