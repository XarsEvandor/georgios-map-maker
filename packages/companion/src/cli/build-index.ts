/**
 * Build the asset index.
 *
 *   npm run index -- [--root "D:\DND Assets"] [--out data] [--packs <name filter>]
 *
 * Writes <out>/asset-index.json, <out>/index-report.md and <out>/cache/analysis.json.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildIndex } from "../assets/build";
import { indexReport } from "../assets/report";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: "D:\\DND Assets" },
    out: { type: "string", default: "data" },
    packs: { type: "string" },
  },
});

const out = resolve(values.out!);
await mkdir(out, { recursive: true });
const { index, stats } = await buildIndex({
  root: values.root!,
  cacheFile: join(out, "cache", "analysis.json"),
  packFilter: values.packs,
  log: (m) => console.log(m),
});
const name = values.packs ? "asset-index.partial.json" : "asset-index.json";
await writeFile(join(out, name), JSON.stringify(index));
await writeFile(join(out, values.packs ? "index-report.partial.md" : "index-report.md"), indexReport(index, stats));
console.log(JSON.stringify(stats));
console.log(`wrote ${join(out, name)}`);
