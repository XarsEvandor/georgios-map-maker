/**
 * Checks the shopfronts on a city's place maps, without Foundry or rendering: for every map of a
 * trade (or the spots given), whether the shop the map is about got its sign, goods out front and
 * a mat, and how many other shops on the map got theirs.
 *   npx tsx packages/companion/src/cli/shop-check.ts --city 2baa33eaf8e93b1e
 *   npx tsx packages/companion/src/cli/shop-check.ts --city 2baa33eaf8e93b1e --spots shop-butcher --list
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { allHotSpots, Catalog, generate, GENRE_SETTINGS, hotspotPlan, parseCity, STOREFRONTS, TRADES } from "@gmm/core";
import { loadIndex } from "../assets/load";

const { values } = parseArgs({ options: { city: { type: "string" }, spots: { type: "string", default: "" }, list: { type: "boolean", default: false }, index: { type: "string", default: "data/asset-index.json" } } });
const dir = resolve("data/cities");
const key = values.city!;
const meta = JSON.parse(await readFile(join(dir, `${key}.meta.json`), "utf8"));
const city = parseCity(JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")), meta);
const index = await loadIndex(values.index!);
const all = allHotSpots(city);
const spots = values.spots ? values.spots.split(",").map((id) => all.find((h) => h.id === id)).filter((h) => !!h) : all.filter((h) => h.trade);
const tally = { maps: 0, secret: 0, sign: 0, goods: 0, goods2: 0, mat: 0 };
const misses: string[] = [];
for (const hs of spots) {
  const plan = hotspotPlan(city, hs, { key, prefix: "check" });
  const gen = generate(plan, new Catalog(index, GENRE_SETTINGS[plan.genre]), { city, date: new Date(2026, 10, 7) });
  const v = gen.versions[0]!;
  tally.maps++;
  if (hs.trade && TRADES[hs.trade].secret) { tally.secret++; continue; }
  // The shop the map is about: its sign is in its trade's colour; its goods and mat stand by that door.
  const color = hs.trade ? STOREFRONTS[hs.trade]?.color : undefined;
  const signs = v.placed.filter((p) => p.feature === "shop_signs" && p.customColor === color);
  const by = (feature: string, r: number) => v.placed.filter((p) => p.feature === feature && signs.some((s) => Math.hypot((p.center ?? [p.x, p.y])[0] - s.center![0], (p.center ?? [p.x, p.y])[1] - s.center![1]) < r));
  const sign = signs.length > 0, goods = by("shop_goods", 6).length, mat = by("shop_mats", 3).length > 0;
  if (sign) tally.sign++;
  if (goods) tally.goods++;
  if (goods >= 2) tally.goods2++;
  if (mat) tally.mat++;
  if (!sign || !goods) misses.push(`${hs.id} (${hs.trade}): sign ${sign ? "yes" : "no"}, goods ${goods}, mat ${mat ? "yes" : "no"}`);
  if (values.list) {
    console.log(`${hs.id}: ${v.notes.filter((n) => /\(\w+\)$/.test(n)).join(" | ")}`);
    for (const p of v.placed.filter((q) => /^shop_/.test(q.feature))) console.log(`  ${p.feature} ${p.asset.name} at ${(p.center ?? [p.x, p.y]).map((x) => x.toFixed(1)).join(",")}`);
  }
}
const open = tally.maps - tally.secret;
console.log(`${meta.name}: ${tally.maps} trade maps (${tally.secret} secret, no front); of ${open}: sign ${tally.sign}, goods ${tally.goods} (two ${tally.goods2}), mat ${tally.mat}`);
for (const m of misses) console.log(`  missing: ${m}`);
