/**
 * The DM's lore for a world (data/worlds/<id>/lore.json): the era, the Lord, the peoples of each
 * culture, each faith's stance, fixed rulers, and what is known of an invader. Prose prompts and
 * journal pages read it. Journals are visible to players, so the file holds only what the people
 * of the world can know.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WorldLore {
  era?: { short: string; name: string; from: string };
  lord?: string;
  world?: string[];
  peoples?: string;
  humans?: string;
  cultures?: Record<string, { way: string; folk: string[]; note?: string }>;
  faiths?: Record<string, string>;
  /** Keyed by state id. */
  rulers?: Record<string, { ruler: string; archmage?: string }>;
  invader?: { seen?: string; unknown?: string };
}

export async function loadLore(dir: string): Promise<WorldLore | undefined> {
  const file = join(dir, "lore.json");
  return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as WorldLore) : undefined;
}

/** "Yotunn (the hard country: minotaurs ..., trolls, ...)", or the bare name without lore. */
export function cultureText(lore: WorldLore | undefined, name: string): string {
  const c = lore?.cultures?.[name];
  return c ? `${name} (${c.way}: ${c.folk.join(", ")}${c.note ? `. ${c.note}` : ""})` : name;
}

/** "Yotunn Faith, which reveres the Lord ...", or the bare name without lore. */
export function faithText(lore: WorldLore | undefined, name: string): string {
  const f = lore?.faiths?.[name];
  return f ? `${name}, which ${f.replace(/^a sect that /, "is a sect that ")}` : name;
}

/** The lines every prompt shares: the era, the Lord, the world's customs and its peoples. */
export function loreContext(lore: WorldLore | undefined, cultureNames: string[]): string {
  if (!lore) return `Its peoples: ${cultureNames.join(", ")}.`;
  const lines: string[] = [];
  if (lore.era) lines.push(`Years are counted ${lore.era.short}, ${lore.era.name}, from ${lore.era.from}.`);
  if (lore.lord) lines.push(lore.lord);
  lines.push(...(lore.world ?? []));
  if (lore.peoples) lines.push(lore.peoples);
  lines.push(`Its cultures and their folk: ${cultureNames.map((n) => cultureText(lore, n)).join("; ")}.`);
  if (lore.humans) lines.push(lore.humans);
  lines.push("Whenever you mention the people of a place, show them as the kinds of creature its culture holds; never write as if everyone were human.");
  return lines.join("\n");
}
