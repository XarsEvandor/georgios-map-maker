/**
 * Fetches cities from their watabou city-generator links into data/cities (the same cache the
 * companion uses), so they can be previewed offline with city-preview.ts.
 *   npx tsx packages/companion/src/cli/city-fetch.ts "<link>" ["<link>" ...]
 *   npx tsx packages/companion/src/cli/city-fetch.ts --file links.json   (an array of {link} or strings)
 * Prints one line per city: key, name, building count.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseCity } from "@gmm/core";
import { cityKey, cityLink, fetchCityJson } from "../city/fetch";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { file: { type: "string" }, data: { type: "string", default: "data" } } });
const links: string[] = [...positionals];
if (values.file) {
  const list = JSON.parse(await readFile(values.file, "utf8")) as Array<string | { link: string }>;
  for (const x of list) links.push(typeof x === "string" ? x : x.link);
}
const dataDir = resolve(values.data!);
for (const url of links) {
  const t0 = Date.now();
  try {
    const link = cityLink(url);
    const key = cityKey(url);
    const name = link.searchParams.get("name") ?? "City";
    const json = await fetchCityJson(url, dataDir);
    await writeFile(join(dataDir, "cities", `${key}.meta.json`), JSON.stringify({ url: link.toString(), name }));
    const city = parseCity(json, { url: link.toString(), name });
    console.log(`${key}  ${name}  ${city.buildings.length} buildings  ${Math.round(city.bounds.w)}x${Math.round(city.bounds.h)} m  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.log(`FAILED ${url}: ${(e as Error).message}`);
  }
}
