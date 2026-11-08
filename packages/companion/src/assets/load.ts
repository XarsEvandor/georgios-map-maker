/** Loads the asset index and merges vision tags (data/asset-tags.json next to it) when present. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { applyTags, type AssetIndex, type AssetTags } from "@gmm/core";

export async function loadIndex(file = "data/asset-index.json", tagsFile?: string): Promise<AssetIndex> {
  const path = resolve(file);
  const index = JSON.parse(await readFile(path, "utf8")) as AssetIndex;
  const tags = tagsFile ?? join(dirname(path), "asset-tags.json");
  if (existsSync(tags)) applyTags(index, JSON.parse(await readFile(tags, "utf8")) as AssetTags);
  // Roof outlines (cli/house-outlines.ts): trims for the big images the indexer skipped, and shapes for walls.
  const outlines = join(dirname(path), "house-outlines.json");
  if (existsSync(outlines)) {
    const data = JSON.parse(await readFile(outlines, "utf8")) as Record<string, { trim: [number, number, number, number]; outline: Array<[number, number]> }>;
    for (const a of index.assets) {
      const o = data[a.id];
      if (!o) continue;
      a.trim ??= o.trim;
      a.footprint ??= [Number((o.trim[2] / 256).toFixed(2)), Number((o.trim[3] / 256).toFixed(2))];
      a.outline = o.outline;
    }
  }
  return index;
}
