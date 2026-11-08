/**
 * Ages an Azgaar world: runs the thousand-year history and writes the result.
 *   npx tsx packages/companion/src/cli/world-age.ts --in "<Azgaar full JSON>" --id ogeia-1183 [--seed s] [--years 1000]
 * Writes data/worlds/<id>/aged.json and prints a summary.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ageWorld, parseAzgaar } from "@gmm/core";

const { values } = parseArgs({ options: { in: { type: "string" }, id: { type: "string" }, seed: { type: "string" }, years: { type: "string", default: "1000" }, war: { type: "string" } } });
if (!values.in || !values.id) throw new Error("--in and --id are required");
const az = parseAzgaar(JSON.parse(await readFile(values.in, "utf8")));
const t0 = Date.now();
const aged = ageWorld(az, { years: Number(values.years), seed: values.seed, war: values.war ? Number(values.war) : undefined });
const dir = resolve("data/worlds", values.id);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "aged.json"), JSON.stringify(aged));

const kinds: Record<string, number> = {};
for (const e of aged.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const alive = aged.burgs.filter((b) => b.alive);
console.log(`${az.name}: ${aged.startYear} -> ${aged.year} ${aged.eraShort} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("events:", JSON.stringify(kinds));
console.log(`towns: ${alive.length} standing (${alive.filter((b) => b.founded).length} new, ${alive.filter((b) => b.kind === "fort").length} forts), ${aged.burgs.filter((b) => !b.alive).length} in ruins; walled ${alive.filter((b) => b.walls).length}`);
console.log(`people in towns: ${Math.round(az.burgs.reduce((s, b) => s + b.population, 0))}k -> ${Math.round(alive.reduce((s, b) => s + b.population, 0))}k`);
const name = (id: number) => aged.burgs.find((b) => b.id === id)?.name ?? "-";
console.log("realms:");
for (const s of aged.states.filter((x) => x.alive).sort((a, b) => b.cells - a.cells)) console.log(`  ${s.fullName.padEnd(36)} ${String(s.cells).padStart(4)} cells  capital ${name(s.capital)}  culture ${az.cultures.find((c) => c.i === s.culture)?.name}  since ${s.founded} (${s.origin}${s.oldName ? `, was ${s.oldName}` : ""})`);
console.log(`fallen realms: ${aged.states.filter((s) => !s.alive).map((s) => `${s.name} (${s.founded}-${s.ended})`).join(", ")}`);
console.log("greatest towns:");
for (const b of [...alive].sort((a, b) => b.population - a.population).slice(0, 12)) console.log(`  ${b.name.padEnd(18)} ${b.population.toFixed(1).padStart(6)}k ${b.oldName && b.oldName !== b.name ? `(was ${b.oldName})` : b.founded ? `(founded ${b.founded})` : ""}${b.capital ? " capital" : ""}${b.walls ? " walled" : ""}${b.port ? " port" : ""}`);
console.log(`religions now: ${[...new Set(aged.cells.religion.filter((r, i) => aged.cells.state[i]))].map((r) => aged.religions.find((x) => x.i === r)?.name ?? r).join(", ")}`);
