/**
 * Contact sheet of lookalike groups for one type, to check grouping by eye.
 *
 *   npm run sheet -- --type chair [--groups 8] [--members 8] [--out data/sheets]
 *
 * Each row is one group (largest first); the last rows are random singletons.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import type { AssetIndex } from "@gmm/core";
import { AssetSource } from "../assets/source";

const { values } = parseArgs({
  options: {
    type: { type: "string", default: "chair" },
    groups: { type: "string", default: "8" },
    members: { type: "string", default: "8" },
    index: { type: "string", default: "data/asset-index.json" },
    out: { type: "string", default: "data/sheets" },
  },
});

const CELL = 110;
const index = JSON.parse(await readFile(resolve(values.index!), "utf8")) as AssetIndex;
const src = new AssetSource(index);
const groups = index.lookGroups.filter((g) => g.type === values.type).sort((a, b) => b.members.length - a.members.length);
const nGroups = Number(values.groups), nMembers = Number(values.members);
const rows = groups.slice(0, nGroups).map((g) => ({ label: `${g.id} (${g.members.length})`, ids: g.members.slice(0, nMembers) }));
const singles = groups.filter((g) => g.members.length === 1);
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = Array.from({ length: Math.min(nMembers * 2, singles.length) }, () => singles[Math.floor(rand() * singles.length)]!.members[0]!);
for (let i = 0; i < pick.length; i += nMembers) rows.push({ label: "singletons", ids: pick.slice(i, i + nMembers) });

const W = 220 + nMembers * CELL, H = rows.length * (CELL + 18) + 10;
const layers: OverlayOptions[] = [];
let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><style>text{font:12px sans-serif;fill:#222}</style>`;
for (let r = 0; r < rows.length; r++) {
  const y = 10 + r * (CELL + 18);
  svg += `<text x="6" y="${y + CELL / 2}">${rows[r]!.label}</text>`;
  for (let c = 0; c < rows[r]!.ids.length; c++) {
    const id = rows[r]!.ids[c]!;
    try {
      const thumb = await sharp(await src.bytes(id), { limitInputPixels: 150_000_000 })
        .resize(CELL - 6, CELL - 6, { fit: "inside" }).png().toBuffer();
      layers.push({ input: thumb, left: 220 + c * CELL, top: y });
      const name = src.asset(id)!.name.replace(/[<>&"]/g, "").slice(0, 18);
      svg += `<text x="${220 + c * CELL}" y="${y + CELL + 10}" style="font-size:9px">${name}</text>`;
    } catch {
      /* skip unreadable */
    }
  }
}
svg += "</svg>";
await mkdir(resolve(values.out!), { recursive: true });
const file = join(resolve(values.out!), `${values.type}.png`);
await sharp({ create: { width: W, height: H, channels: 4, background: "#f2f2f2" } })
  .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...layers])
  .png()
  .toFile(file);
await src.close();
console.log(file);
