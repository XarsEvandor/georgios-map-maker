/**
 * Dumps asset images out of the packs as PNGs, for looking at them.
 * Usage: npx tsx packages/companion/src/cli/dump-assets.ts <outDir> <maxSide> <name or id>...
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import type { AssetIndex } from "@gmm/core";
import { AssetSource } from "../assets/source";

const [out, maxSideArg, ...names] = process.argv.slice(2);
if (!out || !names.length) throw new Error("usage: dump-assets <outDir> <maxSide> <name|id>...");
const maxSide = Number(maxSideArg) || 1400;
const idx = JSON.parse(readFileSync(process.env.GMM_INDEX ?? "data/asset-index.json", "utf8")) as AssetIndex;
const src = new AssetSource(idx);
mkdirSync(out, { recursive: true });
for (const n of names) {
  const a = idx.assets.find((x) => x.id === n || x.name === n);
  if (!a) { console.log("missing", n); continue; }
  const buf = await src.bytes(a.id);
  const img = sharp(buf, { limitInputPixels: false });
  const meta = await img.metadata();
  const file = `${out}/${a.name.replace(/[^a-z0-9]+/gi, "_")}.png`;
  await img.resize({ width: maxSide, height: maxSide, fit: "inside" }).png().toFile(file);
  console.log(`${a.name}\t${meta.width}x${meta.height}\t${file}`);
}
await src.close();
