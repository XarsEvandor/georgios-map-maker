// Splits the objects of the packs in packs.txt into N balanced batches of asset ids.
// Usage: node tools/vision/prepare.mjs <batches> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [nArg, outDir] = process.argv.slice(2);
const N = Number(nArg) || 12;
const idx = JSON.parse(readFileSync("data/asset-index.json", "utf8"));
const names = readFileSync("tools/vision/packs.txt", "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
const ids = new Set(idx.assets.map((a) => a.id));
const groups = [];
for (const n of names) {
  const p = idx.packs.find((p) => p.name === n);
  const list = idx.assets
    .filter((a) => a.pack === p.id && a.kind === "object" && !a.dupeOf && !(a.colorableOf && ids.has(a.colorableOf)))
    .sort((a, b) => a.res.localeCompare(b.res));
  groups.push({ name: n, ids: list.map((a) => a.id) });
}
const total = groups.reduce((s, g) => s + g.ids.length, 0);
const target = total / N;
const batches = [[]];
for (const g of groups) {
  for (const id of g.ids) {
    if (batches.at(-1).length >= target && batches.length < N) batches.push([]);
    batches.at(-1).push(id);
  }
}
mkdirSync(outDir, { recursive: true });
batches.forEach((b, i) => writeFileSync(`${outDir}/ids-${String(i + 1).padStart(2, "0")}.txt`, b.join("\n")));
console.log(`total ${total} in ${batches.length} batches: ${batches.map((b) => b.length).join(", ")}`);
