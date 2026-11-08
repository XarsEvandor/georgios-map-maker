// Merges batch tag files into data/asset-tags.json. Colorable twins and near-duplicates
// inherit their base asset's tag. Usage: node tools/vision/merge.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
const idx = JSON.parse(readFileSync("data/asset-index.json", "utf8"));
const out = { objects: {}, materials: {} };
const load = (dir, into) => {
  if (!existsSync(`${dir}/sheet.json`)) return 0;
  const sheets = JSON.parse(readFileSync(`${dir}/sheet.json`, "utf8"));
  const byN = new Map();
  for (const s of sheets) for (const it of s.items) byN.set(it.n, it.id);
  let n = 0;
  for (const f of readdirSync(dir).filter((f) => /^tags-\d+\.jsonl$/.test(f))) {
    for (const line of readFileSync(`${dir}/${f}`, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let t; try { t = JSON.parse(line); } catch { continue; }
      const id = byN.get(t.n);
      if (!id) continue;
      const { n: _n, ...rest } = t;
      into[id] = rest;
      n++;
    }
  }
  return n;
};
let objs = 0;
for (const d of readdirSync("data/vision").filter((d) => /^b\d+$/.test(d))) objs += load(`data/vision/${d}`, out.objects);
const mats = load("data/vision/mat", out.materials);
let inh = 0;
for (const a of idx.assets) {
  if (out.objects[a.id] || out.materials[a.id]) continue;
  const base = a.colorableOf ?? a.dupeOf;
  if (!base) continue;
  const why = a.colorableOf ? "colorable" : "dupe";
  if (out.objects[base]) { out.objects[a.id] = { ...out.objects[base], inherited: why, ...(why === "colorable" ? { tone: "tintable" } : {}) }; inh++; }
  else if (out.materials[base]) { out.materials[a.id] = { ...out.materials[base] }; inh++; }
}
writeFileSync("data/asset-tags.json", JSON.stringify(out));
console.log(`objects ${objs}, materials ${mats}, inherited ${inh}`);
