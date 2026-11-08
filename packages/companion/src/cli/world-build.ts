/**
 * Builds a world for Foundry from an Azgaar export, aged a thousand years:
 *   npx tsx packages/companion/src/cli/world-build.ts --in "<Azgaar full JSON>" --id ogeia-1183 --title "Ogeia, 1183 NE" [--stage all|age|prose|render|bundle[,...]] [--seed s] [--steer file]
 * Stages write into data/worlds/<id>/ (aged.json, prose.json, map.webp, bundle.json) and each
 * reuses what the earlier ones wrote, so a stage can be redone alone. "bundle" also copies the
 * bundle into Foundry's Data folder (georgios-map-maker/worlds/<id>/), where the module imports it.
 * The DM's changes (data/worlds/<id>/steer.json, see core world/steer.ts) are laid over the
 * rolled history in the age stage; prose touched by a new steer is dropped, so the next prose
 * stage writes only that again.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ageWorld, applySteers, parseAzgaar, type AgedWorld, type SteerRecord, type Steer } from "@gmm/core";
import { writeProse, type Prose } from "../world/write";
import { renderWorld } from "../world/render";
import { buildBundle } from "../world/bundle";
import { loadIndex } from "../assets/load";
import { AssetSource } from "../assets/source";

const { values } = parseArgs({
  options: {
    in: { type: "string" }, id: { type: "string" }, title: { type: "string" }, stage: { type: "string", default: "all" }, seed: { type: "string" }, steer: { type: "string" },
    foundry: { type: "string", default: join(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data") },
  },
});
if (!values.in || !values.id) throw new Error("--in and --id are required");
const stages = new Set(values.stage!.split(","));
const has = (x: string) => stages.has("all") || stages.has(x);
const dir = resolve("data/worlds", values.id);
await mkdir(dir, { recursive: true });
const az = parseAzgaar(JSON.parse(await readFile(values.in, "utf8")));
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

let aged: AgedWorld;
if (has("age") || !existsSync(join(dir, "aged.json"))) {
  const steerFile = values.steer ?? join(dir, "steer.json");
  const steers: Steer[] = existsSync(steerFile) ? JSON.parse(await readFile(steerFile, "utf8")) : [];
  const before: SteerRecord[] = existsSync(join(dir, "aged.json")) ? (JSON.parse(await readFile(join(dir, "aged.json"), "utf8")).steers ?? []) : [];
  const steered = applySteers(az, ageWorld(az, { seed: values.seed }), steers);
  aged = steered;
  await writeFile(join(dir, "aged.json"), JSON.stringify(aged));
  log(`aged ${aged.startYear} -> ${aged.year}: ${aged.states.filter((s) => s.alive).length} realms, ${aged.burgs.filter((b) => b.alive).length} towns, ${aged.events.length} events${steers.length ? `, ${steers.length} steer(s)` : ""}`);
  // A new steer: drop the prose it touched (its realms and towns, the age it falls in, the overview).
  const old = new Set(before.map((r) => JSON.stringify(r.steer)));
  const fresh = steered.steers.filter((r) => !old.has(JSON.stringify(r.steer)));
  if (fresh.length && !stages.has("all") && existsSync(join(dir, "prose.json"))) {
    const p: Prose = JSON.parse(await readFile(join(dir, "prose.json"), "utf8"));
    const years = fresh.map((r) => r.steer.year ?? aged.year);
    p.overview = "";
    p.ages = p.ages.filter((a) => !years.some((y) => y >= a.from && (y < a.to || a.to === aged.year)));
    for (const r of fresh) {
      for (const id of r.realms) delete p.realms[id];
      for (const id of r.towns) delete p.towns[id];
    }
    await writeFile(join(dir, "prose.json"), JSON.stringify(p, null, 1));
    log(`steers changed: dropped the overview, ${years.length} age(s), ${fresh.flatMap((r) => r.realms).length} realm(s) and ${fresh.flatMap((r) => r.towns).length} town(s) from prose.json`);
  }
} else aged = JSON.parse(await readFile(join(dir, "aged.json"), "utf8"));

let prose: Prose | undefined;
if (has("prose")) {
  const prior = existsSync(join(dir, "prose.json")) && !stages.has("all") ? JSON.parse(await readFile(join(dir, "prose.json"), "utf8")) : undefined;
  prose = await writeProse(az, aged, { prior, onProgress: log });
  await writeFile(join(dir, "prose.json"), JSON.stringify(prose, null, 1));
  log("prose written");
} else if (existsSync(join(dir, "prose.json"))) prose = JSON.parse(await readFile(join(dir, "prose.json"), "utf8"));

if (has("render")) {
  const index = await loadIndex("data/asset-index.json");
  const img = await renderWorld(az, aged, new AssetSource(index), index);
  await writeFile(join(dir, "map.webp"), img.image);
  await writeFile(join(dir, "map.json"), JSON.stringify({ width: img.width, height: img.height, scale: img.scale }));
  log(`map ${img.width}x${img.height}`);
}

if (has("bundle")) {
  const map = JSON.parse(await readFile(join(dir, "map.json"), "utf8"));
  const bundle = buildBundle(az, aged, prose, { id: values.id, title: values.title ?? `${aged.name}, ${aged.year} ${aged.eraShort}`, map });
  await writeFile(join(dir, "bundle.json"), JSON.stringify(bundle));
  const target = join(values.foundry!, "georgios-map-maker", "worlds", values.id);
  await mkdir(target, { recursive: true });
  await copyFile(join(dir, "bundle.json"), join(target, "bundle.json"));
  await copyFile(join(dir, "map.webp"), join(target, "map.webp"));
  log(`bundle: ${bundle.journals.length} journals, ${bundle.pins.length} pins -> ${target}`);
}
