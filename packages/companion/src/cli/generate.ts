/**
 * Generate maps from a plan file.
 *   npm run gen -- examples/plans/tavern.json [--out data/maps]
 * Writes <out>/<plan id>/<version>.dungeondraft_map and generation.json.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Catalog, GENRE_SETTINGS, generate, PlanError, type AssetIndex, type ScenePlan } from "@gmm/core";
import { loadIndex } from "../assets/load";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "data/maps" }, index: { type: "string", default: "data/asset-index.json" } },
});
if (!positionals[0]) throw new Error("usage: generate <plan.json>");
const plan = JSON.parse(await readFile(resolve(positionals[0]), "utf8")) as ScenePlan;
const t0 = Date.now();
const index = await loadIndex(values.index!);
const t1 = Date.now();
const cat = new Catalog(index, GENRE_SETTINGS[plan.genre] ?? ["fantasy"]);
const t2 = Date.now();
try {
  const g = generate(plan, cat);
  const t3 = Date.now();
  const dir = join(resolve(values.out!), plan.id);
  await mkdir(dir, { recursive: true });
  for (const v of g.versions) {
    await writeFile(join(dir, `${v.id}.dungeondraft_map`), `${JSON.stringify(v.map, null, "\t")}\n`);
    console.log(`${v.id} "${v.name}": ${v.summary.objects} objects, ${v.summary.lights} lights, ${v.summary.doors} doors, packs ${v.summary.packs.length}`);
    console.log(`   types: ${Object.entries(v.summary.byType).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    if (v.notes.length) console.log(`   notes: ${v.notes.slice(0, 8).join(" | ")}${v.notes.length > 8 ? ` (+${v.notes.length - 8})` : ""}`);
  }
  await writeFile(join(dir, "generation.json"), JSON.stringify({ ...g, versions: g.versions.map((v) => ({ ...v, map: undefined })) }));
  console.log(`zones: ${g.layout.zones.map((z) => `${z.id} ${z.rect.w}x${z.rect.h}@${z.rect.x},${z.rect.y}`).join(", ")}; doors ${g.layout.doors.length}`);
  console.log(`timing: index load ${t1 - t0} ms, catalog ${t2 - t1} ms, generate ${t3 - t2} ms`);
} catch (e) {
  if (e instanceof PlanError) {
    console.error("plan problems:");
    for (const i of e.issues) console.error(`  ${i.path}: ${i.message}`);
    process.exit(2);
  }
  throw e;
}
