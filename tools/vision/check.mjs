// Checks a batch's tag files against its sheet.json and the role list in ROLES.md.
// Usage: node tools/vision/check.mjs data/vision/b01
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
const guide = readFileSync(new URL("./ROLES.md", import.meta.url), "utf8");
const rolesPart = guide.split("## Roles")[1].split("## Tips")[0];
const ROLES = new Set([...rolesPart.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
const FACING = new Set(["down", "up", "left", "right", "none"]);
const PLACEMENT = new Set(["free", "wall", "corner", "surface", "wallmount", "overhead", "rug", "decal", "outdoor"]);
const TONE = new Set(["light", "medium", "dark", "black", "stone", "metal", "colorful", "tintable"]);
const STYLE = new Set(["rustic", "plain", "ornate", "gothic", "crude", "magical", "whimsical", "modern", "exotic"]);
const COND = new Set(["fine", "worn", "broken", "bloody", "burnt", "overgrown"]);
const sheets = JSON.parse(readFileSync(`${dir}/sheet.json`, "utf8"));
const want = new Map();
for (const s of sheets) for (const it of s.items) want.set(it.n, it.id);
const got = new Map();
const problems = [];
for (const f of readdirSync(dir).filter((f) => /^tags-\d+\.jsonl$/.test(f)).sort()) {
  const lines = readFileSync(`${dir}/${f}`, "utf8").split(/\r?\n/).filter((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    let t;
    try { t = JSON.parse(line); } catch { problems.push(`${f}:${i + 1} bad JSON`); continue; }
    const where = `${f}:${i + 1} n=${t.n}`;
    if (!want.has(t.n)) { problems.push(`${where} unknown n`); continue; }
    if (!ROLES.has(t.role)) problems.push(`${where} role "${t.role}"`);
    if (!FACING.has(t.facing)) problems.push(`${where} facing "${t.facing}"`);
    if (!PLACEMENT.has(t.placement)) problems.push(`${where} placement "${t.placement}"`);
    if (t.tone !== undefined && !TONE.has(t.tone)) problems.push(`${where} tone "${t.tone}"`);
    if (t.style !== undefined && !STYLE.has(t.style)) problems.push(`${where} style "${t.style}"`);
    if (t.condition !== undefined && !COND.has(t.condition)) problems.push(`${where} condition "${t.condition}"`);
    if (![0, 1, 2, 3].includes(t.fit)) problems.push(`${where} fit "${t.fit}"`);
    if (t.contains && (!Array.isArray(t.contains) || t.contains.some((r) => !ROLES.has(r)))) problems.push(`${where} contains ${JSON.stringify(t.contains)}`);
    got.set(t.n, t);
  }
}
const missing = [...want.keys()].filter((n) => !got.has(n));
console.log(`${dir}: ${got.size}/${want.size} tagged, ${missing.length} missing, ${problems.length} problems`);
if (missing.length) console.log("missing n:", missing.slice(0, 60).join(","));
for (const p of problems.slice(0, 40)) console.log(" ", p);
process.exitCode = missing.length || problems.length ? 1 : 0;
