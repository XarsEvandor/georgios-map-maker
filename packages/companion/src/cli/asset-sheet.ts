/**
 * Numbered contact sheets of assets that match a query, for choosing and tagging pieces by eye.
 *
 *   npx tsx packages/companion/src/cli/asset-sheet.ts --pack "Twilight Tavern" --out data/sheets/tt
 *   npx tsx packages/companion/src/cli/asset-sheet.ts --name "chair|stool" --setting fantasy --kind object
 *   npx tsx packages/companion/src/cli/asset-sheet.ts --ids ids.txt --out data/sheets/x
 *
 * Writes <out>/sheet-01.png ... and <out>/sheet.json mapping each number to an asset id.
 * Every cell shows the number, the name and the footprint in squares. With --scale, cells
 * keep true relative size (1 square = --sq pixels) so sizes compare at a glance.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import type { AssetIndex, AssetRecord } from "@gmm/core";
import { AssetSource } from "../assets/source";

const { values } = parseArgs({
  options: {
    pack: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    kind: { type: "string", default: "object" },
    setting: { type: "string" },
    ids: { type: "string" },
    exclude: { type: "string" },
    cols: { type: "string", default: "8" },
    cell: { type: "string", default: "160" },
    per: { type: "string", default: "48" },
    max: { type: "string", default: "2000" },
    scale: { type: "boolean", default: false },
    sq: { type: "string", default: "48" },
    bg: { type: "string", default: "#d9d4c7" },
    index: { type: "string", default: "data/asset-index.json" },
    out: { type: "string", default: "data/sheets/query" },
  },
});

const index = JSON.parse(await readFile(resolve(values.index!), "utf8")) as AssetIndex;
const src = new AssetSource(index);
const packs = new Map(index.packs.map((p) => [p.id, p]));

let list: AssetRecord[];
if (values.ids) {
  const ids = (await readFile(resolve(values.ids), "utf8")).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const byId = new Map(index.assets.map((a) => [a.id, a]));
  list = ids.map((id) => byId.get(id)).filter((a): a is AssetRecord => !!a);
} else {
  const packRe = values.pack ? new RegExp(values.pack, "i") : undefined;
  const nameRe = values.name ? new RegExp(values.name, "i") : undefined;
  const exRe = values.exclude ? new RegExp(values.exclude, "i") : undefined;
  list = index.assets.filter((a) => {
    const p = packs.get(a.pack);
    if (!p || a.dupeOf || a.error) return false;
    if (values.kind !== "any" && a.kind !== values.kind) return false;
    if (values.setting && !values.setting.split(",").includes(p.setting)) return false;
    if (packRe && !packRe.test(p.name)) return false;
    if (nameRe && !nameRe.test(a.name) && !nameRe.test(a.res)) return false;
    if (exRe && (exRe.test(a.name) || exRe.test(p.name))) return false;
    if (values.type && !a.types.includes(values.type)) return false;
    return true;
  });
  list.sort((a, b) => (packs.get(a.pack)!.name + a.res).localeCompare(packs.get(b.pack)!.name + b.res));
}
list = list.slice(0, Number(values.max));

const COLS = Number(values.cols), CELL = Number(values.cell), PER = Number(values.per), SQ = Number(values.sq);
const LABEL = 30;
const out = resolve(values.out!);
await mkdir(out, { recursive: true });
const esc = (s: string) => s.replace(/[<>&"']/g, "");
const sheets: Array<{ file: string; items: Array<{ n: number; id: string; name: string; pack: string; footprint?: [number, number] }> }> = [];

for (let page = 0; page * PER < list.length; page++) {
  const items = list.slice(page * PER, (page + 1) * PER);
  const rows = Math.ceil(items.length / COLS);
  const W = COLS * CELL, H = rows * (CELL + LABEL);
  const layers: OverlayOptions[] = [];
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:sans-serif;fill:#111}</style>`;
  const meta: (typeof sheets)[number]["items"] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    const n = page * PER + i + 1;
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * (CELL + LABEL);
    svg += `<rect x="${cx + 1}" y="${cy + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="none" stroke="#888" stroke-width="1"/>`;
    try {
      let box = CELL - 8;
      if (values.scale && a.footprint) box = Math.min(CELL - 8, Math.max(8, Math.round(Math.max(a.footprint[0], a.footprint[1]) * SQ)));
      const thumb = await sharp(await src.bytes(a.id), { limitInputPixels: 150_000_000 })
        .resize(box, box, { fit: "inside" }).png().toBuffer();
      const m = await sharp(thumb).metadata();
      layers.push({ input: thumb, left: cx + Math.round((CELL - m.width!) / 2), top: cy + Math.round((CELL - m.height!) / 2) });
    } catch {
      svg += `<text x="${cx + 8}" y="${cy + 40}" style="font-size:12px">unreadable</text>`;
    }
    const fp = a.footprint ? `${a.footprint[0]}x${a.footprint[1]}` : "?";
    svg += `<text x="${cx + 4}" y="${cy + 16}" style="font-size:15px;font-weight:bold;fill:#b00">${n}</text>`;
    svg += `<text x="${cx + 2}" y="${cy + CELL + 12}" style="font-size:10px">${esc(a.name).slice(0, 26)}</text>`;
    svg += `<text x="${cx + 2}" y="${cy + CELL + 25}" style="font-size:9px;fill:#444">${esc(packs.get(a.pack)!.name.replace(/^2MT? /, "")).slice(0, 22)} ${fp}</text>`;
    meta.push({ n, id: a.id, name: a.name, pack: packs.get(a.pack)!.name, footprint: a.footprint });
  }
  svg += "</svg>";
  const file = join(out, `sheet-${String(page + 1).padStart(2, "0")}.png`);
  await sharp({ create: { width: W, height: H, channels: 4, background: values.bg! } })
    .composite([...layers, { input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toFile(file);
  sheets.push({ file, items: meta });
}
await writeFile(join(out, "sheet.json"), JSON.stringify(sheets, null, 1));
await src.close();
console.log(`${list.length} assets, ${sheets.length} sheets in ${out}`);
