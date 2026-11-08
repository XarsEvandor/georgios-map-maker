/** Near-duplicate detection and lookalike grouping over the analyzed assets. */

import type { AssetRecord, Family, LookGroupRecord } from "@gmm/core";
import { hamming } from "./analyze";

function popcount(hex: string): number {
  let n = 0;
  for (const ch of hex) n += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][parseInt(ch, 16)]!;
  return n;
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Marks near-identical objects (same drawing, same colors, same size) with dupeOf.
 * Uses 4 bands of 16 hash bits so only plausible pairs get compared.
 * Returns the number of assets marked.
 */
export function markNearDuplicates(assets: AssetRecord[]): number {
  const idx: number[] = [];
  assets.forEach((a, i) => {
    const h = a.look?.dhash;
    // Skip low-information hashes (flat images) and colorable copies (handled as twins).
    if (a.kind === "object" && h && !a.colorable && popcount(h) >= 6 && popcount(h) <= 58) idx.push(i);
  });
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(i, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (let band = 0; band < 4; band++) {
    const buckets = new Map<string, number[]>();
    for (const i of idx) {
      const key = assets[i]!.look!.dhash!.slice(band * 4, band * 4 + 4);
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
    for (const list of buckets.values()) {
      if (list.length < 2 || list.length > 400) continue;
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const a = assets[list[x]!]!, b = assets[list[y]!]!;
          if (hamming(a.look!.dhash!, b.look!.dhash!) > 4) continue;
          const [aw, ah] = a.size, [bw, bh] = b.size;
          if (Math.abs(aw - bw) > 0.08 * Math.max(aw, bw) || Math.abs(ah - bh) > 0.08 * Math.max(ah, bh)) continue;
          if (deltaE(a.look!.meanLab, b.look!.meanLab) > 5) continue;
          union(list[x]!, list[y]!);
        }
      }
    }
  }
  let marked = 0;
  for (const i of idx) {
    const r = find(i);
    if (r !== i) {
      assets[i]!.dupeOf = assets[r]!.id;
      marked++;
    }
  }
  return marked;
}

export interface GroupOptions {
  /** Maximum distance from a group's center to join it. */
  threshold: number;
}

export const DEFAULT_GROUP_OPTIONS: GroupOptions = { threshold: 1.0 };

export interface LookPoint {
  lab: [number, number, number];
  dhash?: string;
  family: Family;
  setting: string;
  pack: string;
  condition: string[];
  /** Name words without numbers and condition words. */
  nameWords: string[];
  variantGroup: string;
}

const NOISE = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "colorable", "colourable", "dark", "light", "broken", "bloody", "messy", "plus", "pack"]);

export function nameWordsOf(words: string[]): string[] {
  return [...new Set(words.filter((w) => !/^\d+$/.test(w) && !NOISE.has(w)))];
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const sb = new Set(b);
  const inter = a.filter((w) => sb.has(w)).length;
  return inter / (a.length + b.length - inter);
}

/**
 * Look distance between two assets of the same type. Terms: color (Delta E / 25),
 * shape (hash bits / 40, dropped for versions of one named item, since those are often
 * the same drawing rotated), name overlap, family and condition. About 1.0 means
 * "different look".
 */
export function lookDistance(a: LookPoint, b: LookPoint): number {
  const color = deltaE(a.lab, b.lab) / 25;
  const sameItem = a.variantGroup === b.variantGroup;
  const shape = sameItem ? 0 : a.dhash && b.dhash ? hamming(a.dhash, b.dhash) / 40 : 0.8;
  const name = (1 - jaccard(a.nameWords, b.nameWords)) * 0.4;
  const fam = a.family !== b.family ? 0.35 : a.pack !== b.pack ? 0.15 : 0;
  const cond = a.condition.join(",") === b.condition.join(",") ? 0 : 0.6;
  const setting = a.setting === b.setting ? 0 : 1;
  return color + shape + name + fam + cond + setting;
}

/**
 * Groups objects of the same primary type by look (leader clustering, deterministic
 * in index order). Duplicates and colorable twins join their original's group.
 */
export function buildLookGroups(
  assets: AssetRecord[],
  familyOfPack: Map<string, Family>,
  settingOfPack: Map<string, string>,
  opts: GroupOptions = DEFAULT_GROUP_OPTIONS,
): LookGroupRecord[] {
  const byType = new Map<string, AssetRecord[]>();
  for (const a of assets) {
    if (a.kind !== "object" || !a.types[0] || a.prefab || a.dupeOf || a.colorable || !a.look) continue;
    const list = byType.get(a.types[0]) ?? [];
    list.push(a);
    byType.set(a.types[0], list);
  }
  const point = (a: AssetRecord): LookPoint => ({
    lab: a.look!.meanLab,
    dhash: a.look!.dhash,
    family: familyOfPack.get(a.pack) ?? "other",
    setting: settingOfPack.get(a.pack) ?? "fantasy",
    pack: a.pack,
    condition: a.condition,
    nameWords: nameWordsOf(a.words),
    variantGroup: a.variantGroup,
  });
  const groups: LookGroupRecord[] = [];
  for (const [type, list] of [...byType.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const local: Array<{ rec: LookGroupRecord; center: LookPoint; n: number }> = [];
    for (const a of list) {
      const me = point(a);
      let best: (typeof local)[number] | undefined;
      let bestD = Infinity;
      for (const g of local) {
        const d = lookDistance(me, g.center);
        if (d < bestD) { bestD = d; best = g; }
      }
      if (best && bestD <= opts.threshold) {
        best.rec.members.push(a.id);
        best.center.lab = best.center.lab.map((v, i) => (v * best!.n + me.lab[i]!) / (best!.n + 1)) as [number, number, number];
        best.n++;
        if (!best.rec.families.includes(me.family)) best.rec.families.push(me.family);
        a.lookGroup = best.rec.id;
      } else {
        const rec: LookGroupRecord = {
          id: `${type}:${local.length + 1}`,
          type,
          members: [a.id],
          meanLab: me.lab,
          families: [me.family],
          condition: a.condition,
        };
        local.push({ rec, center: { ...me, lab: [...me.lab] as [number, number, number] }, n: 1 });
        a.lookGroup = rec.id;
      }
    }
    for (const g of local) {
      g.rec.meanLab = g.center.lab.map((v) => Math.round(v * 10) / 10) as [number, number, number];
      groups.push(g.rec);
    }
  }
  // Duplicates and colorable twins follow their original.
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const a of assets) {
    const orig = a.dupeOf ?? a.colorableOf;
    const g = orig ? byId.get(orig)?.lookGroup : undefined;
    if (g && !a.lookGroup) a.lookGroup = g;
  }
  return groups;
}
