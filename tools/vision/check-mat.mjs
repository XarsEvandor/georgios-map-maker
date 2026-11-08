// Checks material tag files against sheet.json and MATERIALS.md. Usage: node tools/vision/check-mat.mjs data/vision/mat [fromSheet] [toSheet]
import { readFileSync, readdirSync } from "node:fs";
const [dir, from = "1", to = "999"] = process.argv.slice(2);
const guide = readFileSync(new URL("./MATERIALS.md", import.meta.url), "utf8");
const USES = new Set([...guide.split("## Uses")[1].split("## Tips")[0].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
const TONE = new Set(["light", "medium", "dark", "black", "grey", "warm", "cool", "colorful"]);
const STYLE = new Set(["rustic", "plain", "ornate", "gothic", "crude", "magical", "whimsical", "modern", "exotic"]);
const sheets = JSON.parse(readFileSync(`${dir}/sheet.json`, "utf8"));
const want = new Set();
sheets.forEach((s, i) => { if (i + 1 >= +from && i + 1 <= +to) for (const it of s.items) want.add(it.n); });
const got = new Set(); const problems = [];
for (const f of readdirSync(dir).filter((f) => /^tags-\d+\.jsonl$/.test(f))) {
  const n = Number(f.match(/\d+/)[0]);
  if (n < +from || n > +to) continue;
  for (const [i, line] of readFileSync(`${dir}/${f}`, "utf8").split(/\r?\n/).filter((l) => l.trim()).entries()) {
    let t; try { t = JSON.parse(line); } catch { problems.push(`${f}:${i + 1} bad JSON`); continue; }
    const w = `${f}:${i + 1} n=${t.n}`;
    if (!want.has(t.n)) { problems.push(`${w} unknown n`); continue; }
    if (!USES.has(t.use)) problems.push(`${w} use "${t.use}"`);
    if (t.tone !== undefined && !TONE.has(t.tone)) problems.push(`${w} tone "${t.tone}"`);
    if (t.style !== undefined && !STYLE.has(t.style)) problems.push(`${w} style "${t.style}"`);
    if (![0, 1, 2, 3].includes(t.fit)) problems.push(`${w} fit "${t.fit}"`);
    got.add(t.n);
  }
}
const missing = [...want].filter((n) => !got.has(n));
console.log(`${dir} sheets ${from}-${to}: ${got.size}/${want.size} tagged, ${missing.length} missing, ${problems.length} problems`);
if (missing.length) console.log("missing n:", missing.slice(0, 60).join(","));
for (const p of problems.slice(0, 40)) console.log(" ", p);
process.exitCode = missing.length || problems.length ? 1 : 0;
