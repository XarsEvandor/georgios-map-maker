/**
 * Gets a city's layout from watabou's Medieval Fantasy City Generator: opens the city's
 * link with `export=json` in headless Edge (playwright-core, no browser download) and keeps
 * the GeoJSON it downloads. Cached per link in <data>/cities.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOST = "watabou.github.io";

/** Normalizes a city link and refuses anything that isn't watabou's city generator. */
export function cityLink(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== HOST || !u.pathname.startsWith("/city-generator")) throw new Error("not a watabou city-generator link");
  u.searchParams.delete("export");
  return u;
}

export function cityKey(url: string): string {
  return createHash("sha1").update(cityLink(url).toString()).digest("hex").slice(0, 16);
}

export async function fetchCityJson(url: string, dataDir: string, opts: { timeoutMs?: number } = {}): Promise<unknown> {
  const link = cityLink(url);
  const dir = join(dataDir, "cities");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${cityKey(url)}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    link.searchParams.set("export", "json");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: opts.timeoutMs ?? 60_000 }),
      page.goto(link.toString(), { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 60_000 }),
    ]);
    const tmp = await download.path();
    if (!tmp) throw new Error("the city generator did not deliver a file");
    const text = await readFile(tmp, "utf8");
    if (text.length > 20_000_000) throw new Error("city export too large");
    const json = JSON.parse(text);
    await writeFile(file, text);
    return json;
  } finally {
    await browser.close();
  }
}
