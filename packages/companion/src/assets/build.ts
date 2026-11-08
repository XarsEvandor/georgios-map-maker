/** Builds the asset index from the packs under an asset root. See DESIGN.md section 8. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import {
  PX_PER_SQUARE,
  classify,
  conditionsOf,
  footprintHint,
  isColorable,
  kindOf,
  normalizeTag,
  settingOf,
  splitWords,
  stemOf,
  variantBase,
  withoutColorable,
  type AssetIndex,
  type AssetRecord,
  type Family,
  type PackRecord,
} from "@gmm/core";
import { mapLimit } from "../util/pool";
import { analyzeImage, type ImageAnalysis } from "./analyze";
import { buildLookGroups, markNearDuplicates, type GroupOptions } from "./group";
import { discoverPacks, packRelative } from "./packs";
import { PckReader } from "./pck";

const IMAGE_EXT = /\.(png|webp|jpe?g)$/i;
/** Objects larger than this on a side are "large". */
export const LARGE_SIDE = 1500;
const CACHE_VERSION = 1;

export interface BuildOptions {
  root: string;
  cacheFile?: string;
  /** Only index packs whose name contains this (case-insensitive). */
  packFilter?: string;
  concurrency?: number;
  group?: GroupOptions;
  log?: (msg: string) => void;
}

export interface BuildStats {
  packFiles: number;
  uniquePacks: number;
  duplicatePackFiles: number;
  textures: number;
  analyzed: number;
  cacheHits: number;
  errors: number;
  dupes: number;
  seconds: number;
}

type Cache = Record<string, ImageAnalysis>;

async function loadCache(file?: string): Promise<Cache> {
  if (!file) return {};
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { version: number; entries: Cache };
    return parsed.version === CACHE_VERSION ? parsed.entries : {};
  } catch {
    return {};
  }
}

const round05 = (v: number) => Math.round(v * 20) / 20;

export async function buildIndex(opts: BuildOptions): Promise<{ index: AssetIndex; stats: BuildStats }> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  sharp.concurrency(1);
  sharp.cache(false);

  let packs = await discoverPacks(opts.root);
  const packFiles = packs.reduce((n, p) => n + 1 + p.duplicates.length, 0);
  if (opts.packFilter) {
    const f = opts.packFilter.toLowerCase();
    packs = packs.filter((p) => p.name.toLowerCase().includes(f));
  }
  log(`packs: ${packFiles} files, ${packs.length} unique${opts.packFilter ? " (filtered)" : ""}`);

  const cache = await loadCache(opts.cacheFile);
  const stats: BuildStats = {
    packFiles,
    uniquePacks: packs.length,
    duplicatePackFiles: packs.reduce((n, p) => n + p.duplicates.length, 0),
    textures: 0,
    analyzed: 0,
    cacheHits: 0,
    errors: 0,
    dupes: 0,
    seconds: 0,
  };

  const assets: AssetRecord[] = [];
  const packRecords: PackRecord[] = [];
  const familyOfPack = new Map<string, Family>();
  const settingOfPack = new Map<string, string>();
  let done = 0;

  // Packs run a few at a time; images within a pack run concurrently.
  await mapLimit(packs, 4, async (pack) => {
    familyOfPack.set(pack.id, pack.family);
    settingOfPack.set(pack.id, settingOf(pack.name));
    // Packs that opt out of third-party reading are listed but never read.
    const entries = pack.readAllowed
      ? pack.index.entries.filter((e) => e.path.includes("/textures/") && IMAGE_EXT.test(e.path))
      : [];
    const reader = await PckReader.open(pack.file);
    const recs: AssetRecord[] = [];
    try {
      await mapLimit(entries, Math.max(1, Math.floor((opts.concurrency ?? 32) / 4)), async (e) => {
        const rel = packRelative(e.path, pack.id) ?? e.path;
        const folder = rel.split("/")[1] ?? "";
        const kind = kindOf(folder);
        const stem = stemOf(rel);
        const key = `${pack.id}|${e.path}|${e.size}`;
        let an = cache[key];
        let error: string | undefined;
        if (an) {
          stats.cacheHits++;
        } else {
          try {
            an = await analyzeImage(await reader.read(e), true);
            cache[key] = an;
            stats.analyzed++;
          } catch (err) {
            error = (err as Error).message;
            stats.errors++;
            an = { size: [0, 0] };
          }
        }
        const tags = [...new Set((pack.tagsByPath.get(rel) ?? []).map((t) => normalizeTag(t, pack.name)).filter((t): t is string => !!t))];
        const words = splitWords(stem);
        const cls = kind === "object" ? classify(stem, pack.name, tags) : { types: [] as string[], source: "none" as const };
        const trim = an.trim;
        const large = Math.max(...an.size) > LARGE_SIDE;
        recs.push({
          id: `${pack.id}:${rel}`,
          pack: pack.id,
          kind,
          res: e.path,
          name: stem,
          words,
          tags,
          types: cls.types,
          typeSource: cls.source,
          condition: conditionsOf(words),
          colorable: isColorable(stem),
          variantGroup: `${pack.id}:${folder}:${variantBase(stem)}`,
          size: an.size,
          trim,
          footprint: trim ? [round05(trim[2] / PX_PER_SQUARE), round05(trim[3] / PX_PER_SQUARE)] : undefined,
          footprintHint: footprintHint(stem),
          large,
          prefab: false,
          look: an.look,
          error,
        });
        if (++done % 5000 === 0) log(`  ${done} textures`);
      });
    } finally {
      await reader.close();
    }
    const objects = recs.filter((r) => r.kind === "object");
    const prefabOnly = objects.length > 0 && objects.every((r) => r.large);
    for (const r of objects) r.prefab = r.large && (prefabOnly || r.types.length === 0);
    packRecords.push({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      author: pack.author,
      family: pack.family,
      setting: settingOf(pack.name),
      file: pack.file,
      duplicates: pack.duplicates,
      folder: pack.folder,
      fileCount: pack.index.entries.length,
      prefabOnly,
      manifest: pack.meta,
      readAllowed: pack.readAllowed,
    });
    assets.push(...recs);
  });
  stats.textures = assets.length;

  // Deterministic order regardless of completion order.
  packRecords.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const packOrder = new Map(packRecords.map((p, i) => [p.id, i]));
  assets.sort((a, b) => packOrder.get(a.pack)! - packOrder.get(b.pack)! || a.id.localeCompare(b.id));

  // Colorable copies point at their non-colorable twin in the same pack and folder.
  const plain = new Map<string, string>();
  for (const a of assets) if (!a.colorable) plain.set(`${a.pack}|${a.kind}|${a.name.toLowerCase()}`, a.id);
  for (const a of assets) {
    if (!a.colorable) continue;
    const twin = plain.get(`${a.pack}|${a.kind}|${withoutColorable(a.name).toLowerCase()}`);
    if (twin) a.colorableOf = twin;
  }

  stats.dupes = markNearDuplicates(assets);
  const lookGroups = buildLookGroups(assets, familyOfPack, settingOfPack, opts.group);

  if (opts.cacheFile) {
    await mkdir(dirname(opts.cacheFile), { recursive: true });
    await writeFile(opts.cacheFile, JSON.stringify({ version: CACHE_VERSION, entries: cache }));
  }
  stats.seconds = Math.round((Date.now() - t0) / 100) / 10;
  return {
    index: { schema: 1, builtAt: new Date().toISOString(), root: opts.root, packs: packRecords, assets, lookGroups },
    stats,
  };
}
