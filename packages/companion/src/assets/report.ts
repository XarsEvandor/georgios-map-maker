/** Markdown report of an asset index: coverage, types, lookalike groups. */

import type { AssetIndex } from "@gmm/core";
import { typeGroup } from "@gmm/core";
import type { BuildStats } from "./build";

const fmt = (n: number) => n.toLocaleString("en-US");

export function indexReport(index: AssetIndex, stats: BuildStats): string {
  const A = index.assets;
  const objects = A.filter((a) => a.kind === "object");
  const byKind = new Map<string, number>();
  for (const a of A) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  const usable = objects.filter((o) => !o.prefab && !o.dupeOf && !o.colorable);
  const typed = usable.filter((o) => o.types.length);
  const bySource = { name: 0, tag: 0 };
  for (const o of typed) if (o.typeSource === "name" || o.typeSource === "tag") bySource[o.typeSource]++;

  const typeCount = new Map<string, number>();
  for (const o of typed) typeCount.set(o.types[0]!, (typeCount.get(o.types[0]!) ?? 0) + 1);
  const groupsByType = new Map<string, number[]>();
  for (const g of index.lookGroups) {
    const list = groupsByType.get(g.type) ?? [];
    list.push(g.members.length);
    groupsByType.set(g.type, list);
  }

  const lines: string[] = [];
  lines.push(`# Asset index report`, "", `Built ${index.builtAt} from \`${index.root}\` in ${stats.seconds} s.`, "");
  lines.push("## Packs", "", "| Measure | Count |", "|---|---|");
  lines.push(`| Pack files found | ${fmt(stats.packFiles)} |`);
  lines.push(`| Unique pack IDs indexed | ${fmt(stats.uniquePacks)} |`);
  lines.push(`| Duplicate pack files skipped | ${fmt(stats.duplicatePackFiles)} |`);
  lines.push(`| Packs with only pre-built images | ${fmt(index.packs.filter((p) => p.prefabOnly).length)} |`, "");

  lines.push("## Textures", "", "| Kind | Count |", "|---|---|");
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${fmt(n)} |`);
  lines.push("", `Analyzed ${fmt(stats.analyzed)}, cache hits ${fmt(stats.cacheHits)}, decode errors ${fmt(stats.errors)}.`, "");

  lines.push("## Objects", "", "| Measure | Count |", "|---|---|");
  lines.push(`| Objects | ${fmt(objects.length)} |`);
  lines.push(`| Pre-built images (prefab) | ${fmt(objects.filter((o) => o.prefab).length)} |`);
  lines.push(`| Colorable copies | ${fmt(objects.filter((o) => o.colorable).length)} (${fmt(objects.filter((o) => o.colorableOf).length)} linked to a twin) |`);
  lines.push(`| Near-identical copies | ${fmt(objects.filter((o) => o.dupeOf).length)} |`);
  lines.push(`| Usable pieces (not prefab, copy or colorable) | ${fmt(usable.length)} |`);
  lines.push(`| Usable pieces with a type | ${fmt(typed.length)} (${fmt(bySource.name)} from names, ${fmt(bySource.tag)} from tags) |`);
  lines.push(`| Usable pieces without a type | ${fmt(usable.length - typed.length)} |`, "");

  lines.push("## Types and lookalike groups", "");
  lines.push("Usable pieces per primary type, grouped by look. A group is a set of interchangeable assets.", "");
  lines.push("| Type | Group | Pieces | Look groups | Largest groups | Singletons |", "|---|---|---|---|---|---|");
  for (const [t, n] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
    const sizes = (groupsByType.get(t) ?? []).sort((a, b) => b - a);
    lines.push(`| ${t} | ${typeGroup(t) ?? ""} | ${fmt(n)} | ${fmt(sizes.length)} | ${sizes.slice(0, 5).join(", ")} | ${fmt(sizes.filter((s) => s === 1).length)} |`);
  }
  lines.push("");
  return lines.join("\n");
}
