/**
 * Prints the styles (versions) the generator would build for a genre and each role's pool.
 *   npx tsx packages/companion/src/cli/debug-styles.ts medieval [roles,comma,separated] [seed]
 */
import { buildStyles, Catalog, GENRE_SETTINGS, Rng, poolFor } from "@gmm/core";
import { loadIndex } from "../assets/load";

const idx = await loadIndex();
const genre = (process.argv[2] ?? "medieval") as "medieval" | "gothic";
const cat = new Catalog(idx, GENRE_SETTINGS[genre]);
const st = buildStyles(cat, genre, "lived-in", [], 3, new Rng(Number(process.argv[4] ?? 5)));
const roles = (process.argv[3] ?? "chair,table_set,bar_counter,stool,shelf,barrel,rug,candle,mug,dirt,grime,sconce,fireplace,oven,counter").split(",");
for (const s of st) {
  console.log(`${s.id} ${s.name} [${cat.packs.get(s.anchorPack)?.name}] tone ${s.tone}`);
  console.log(`   wall ${s.wall?.name} | inner ${s.innerWall?.name} | wood ${s.floors.wood?.name} | stone ${s.floors.stone?.name} | door ${s.door?.name} | window ${s.window?.name} | road ${s.road?.name} | terrain ${s.terrain.map((t) => t.name).join(", ")}`);
  for (const role of roles) {
    const p = poolFor(cat, s, role, { genre, wear: "lived-in" });
    console.log(`   ${role}: ${p.length} ${[...new Set(p.map((a) => cat.packs.get(a.pack)?.name))].join("/")} :: ${p.slice(0, 4).map((a) => a.name).join(" | ")}`);
  }
}
