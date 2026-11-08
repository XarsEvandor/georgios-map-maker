/** Filename and tag parsing for Dungeondraft asset packs. */

import type { AssetKind, Family } from "./model";

/** Lowercase words, splitting on punctuation, camelCase and letter-digit boundaries. */
export function splitWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Filename without folders and extension. */
export function stemOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Footprint stated in a name, such as "Door (2x1)" -> [2, 1]. */
export function footprintHint(stem: string): [number, number] | undefined {
  const m = /\((\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\)/i.exec(stem);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

const CONDITIONS: Array<[string, RegExp]> = [
  ["broken", /\b(broken|damaged|destroyed|cracked|ruined|smashed|shattered|toppled|collapsed)\b/],
  ["bloody", /\b(bloody|bloodied|blood)\b/],
  ["dark", /\bdark\b/],
  ["messy", /\b(messy|dirty|grimy|filthy|unmade)\b/],
  ["burnt", /\b(burnt|burned|charred|scorched)\b/],
  ["mossy", /\b(mossy|overgrown|vines?)\b/],
  ["snowy", /\b(snowy|snow|frozen|icy)\b/],
  ["rotten", /\b(rotten|rotting|decayed|decaying)\b/],
  ["empty", /\bempty\b/],
  ["open", /\bopen(ed)?\b/],
  ["closed", /\bclosed\b/],
];

/** Condition words found in a name. */
export function conditionsOf(words: string[]): string[] {
  const text = ` ${words.join(" ")} `;
  return CONDITIONS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

/** True when a name marks a colorable (grayscale, tintable) copy. */
export function isColorable(stem: string): boolean {
  return /colou?rable/i.test(stem);
}

/** Name with the colorable marker removed, to find the non-colorable twin. */
export function withoutColorable(stem: string): string {
  return stem
    .replace(/\s*[-_,]?\s*\(?colou?rable\)?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Base name shared by numbered or lettered versions of one item:
 * "Bed - Pattern 1.a" and "Bed - Pattern 1.b" -> "bed pattern 1";
 * "Chair 1" and "Chair 2" -> "chair".
 */
export function variantBase(stem: string): string {
  let s = withoutColorable(stem).replace(/\(\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\)/gi, " ").trim();
  // Strip one level of variant marker: a trailing letter (".a", " B") if present, else a number.
  if (/[._ -]+[a-z]$/i.test(s)) s = s.replace(/[._ -]+[a-z]$/i, "");
  else s = s.replace(/[\s._-]*\d+[a-z]?$/i, "");
  return splitWords(s).join(" ");
}

/** Texture folder name to asset kind. */
export function kindOf(folder: string): AssetKind {
  switch (folder) {
    case "objects":
      return "object";
    case "walls":
      return "wall";
    case "patterns":
      return "pattern";
    case "terrain":
      return "terrain";
    case "paths":
      return "path";
    case "portals":
      return "portal";
    case "tilesets":
      return "tileset";
    case "materials":
      return "material";
    case "caves":
      return "cave";
    case "roofs":
      return "roof";
    case "lights":
      return "light";
    default:
      return "other";
  }
}

export type Setting = "fantasy" | "victorian" | "modern" | "scifi";

const SCIFI = /\b(sci-?fi|cyberpunk|cosmic|power core|research facility|space|spaceship|starship|mecha|lofty airport|hound class|diver-class|clockwork construction|corroded hull|lightning rail|scout ship)\b/i;
const MODERN = /\b(modern|1900s|ww1|wwi|metro|speakeasy|car assets|street tiles|city street|theater|airport|racetrack|train|bombed)\b/i;
const VICTORIAN = /\b(victorian|ballroom|asylum|steampunk)\b/i;

/** Rough setting of a pack from its name, used to keep sci-fi and modern pieces out of fantasy maps. */
export function settingOf(packName: string): Setting {
  if (SCIFI.test(packName)) return "scifi";
  if (MODERN.test(packName)) return "modern";
  if (VICTORIAN.test(packName)) return "victorian";
  return "fantasy";
}

/** Art family from the pack name. */
export function familyOf(packName: string): Family {
  if (/^2MT\b/i.test(packName)) return "2MT";
  if (/^2M\b/i.test(packName)) return "2M";
  return "other";
}

/**
 * Normalize a pack tag: "[2MT] Seat" -> "seat".
 * Returns undefined for tags that carry no meaning per asset (pack names, "Colorable").
 */
export function normalizeTag(tag: string, packName: string): string | undefined {
  const t = tag.replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
  if (!t) return undefined;
  if (t === "colorable" || t === "colourable") return undefined;
  const pack = packName.toLowerCase();
  if (t === pack || t.startsWith("2mt ") || t.startsWith("2m ")) return undefined;
  if (t === "2-minute tabletop") return undefined;
  return t;
}
