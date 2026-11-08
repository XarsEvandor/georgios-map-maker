/**
 * Floor plans only (no assets): renders a plan's layout for several seeds side by side.
 *   npx tsx packages/companion/src/cli/layout-sheet.ts examples/plans/tavern.json [--n 9] [--out data/sheets/layouts.png]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { layoutBuilding, Rng, type ScenePlan } from "@gmm/core";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { n: { type: "string", default: "9" }, out: { type: "string" }, px: { type: "string", default: "14" } } });
const plan = JSON.parse(await readFile(resolve(positionals[0]!), "utf8")) as ScenePlan;
const N = Number(values.n), P = Number(values.px);
const cols = Math.ceil(Math.sqrt(N));
const cw = plan.size.w * P + 20, ch = plan.size.h * P + 34;
const COLORS = ["#c9a46b", "#9fb7c9", "#b5c99f", "#d6a3a3", "#c4b0d9", "#e0cf8f", "#9fd0c7", "#d9b38c"];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cw}" height="${Math.ceil(N / cols) * ch}"><rect width="100%" height="100%" fill="#f4f1ea"/>`;
for (let i = 0; i < N; i++) {
  const L = layoutBuilding({ ...plan, seed: plan.seed + i }, new Rng(plan.seed + i).fork("layout"));
  const ox = (i % cols) * cw + 10, oy = Math.floor(i / cols) * ch + 24;
  svg += `<text x="${ox}" y="${oy - 8}" font-size="12" font-family="sans-serif">seed ${plan.seed + i} front ${L.front}${L.dropped ? " dropped " + L.dropped.join(",") : ""}</text>`;
  svg += `<rect x="${ox}" y="${oy}" width="${plan.size.w * P}" height="${plan.size.h * P}" fill="#cfe0b8"/>`;
  L.zones.forEach((z, k) => {
    const r = z.rect;
    svg += `<rect x="${ox + r.x * P}" y="${oy + r.y * P}" width="${r.w * P}" height="${r.h * P}" fill="${z.outdoor ? "none" : COLORS[k % COLORS.length]}" stroke="${z.outdoor ? "#6a8" : "none"}" stroke-dasharray="4 3"/>`;
    svg += `<text x="${ox + (r.x + 0.3) * P}" y="${oy + (r.y + 1) * P}" font-size="10" font-family="sans-serif">${z.id} ${r.w}x${r.h}</text>`;
  });
  if (L.outline.length) svg += `<polygon points="${L.outline.map((p) => `${ox + p[0] * P},${oy + p[1] * P}`).join(" ")}" fill="none" stroke="#222" stroke-width="3"/>`;
  for (const s of L.interiorWalls) svg += `<line x1="${ox + s.a[0] * P}" y1="${oy + s.a[1] * P}" x2="${ox + s.b[0] * P}" y2="${oy + s.b[1] * P}" stroke="#444" stroke-width="2"/>`;
  for (const w of L.windows) svg += `<line x1="${ox + (w.at[0] - w.dir[0] * 0.5) * P}" y1="${oy + (w.at[1] - w.dir[1] * 0.5) * P}" x2="${ox + (w.at[0] + w.dir[0] * 0.5) * P}" y2="${oy + (w.at[1] + w.dir[1] * 0.5) * P}" stroke="#4af" stroke-width="4"/>`;
  for (const d of L.doors) svg += `<line x1="${ox + (d.at[0] - d.dir[0] * 0.5) * P}" y1="${oy + (d.at[1] - d.dir[1] * 0.5) * P}" x2="${ox + (d.at[0] + d.dir[0] * 0.5) * P}" y2="${oy + (d.at[1] + d.dir[1] * 0.5) * P}" stroke="${d.main ? "#e22" : "#d80"}" stroke-width="5"/>`;
}
svg += "</svg>";
const out = resolve(values.out ?? `data/sheets/layout-${plan.id}.png`);
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(out);
