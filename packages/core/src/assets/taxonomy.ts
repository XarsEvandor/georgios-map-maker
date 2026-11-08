/**
 * Semantic asset types and the rules that assign them from filenames and tags.
 *
 * Rules match whole words in the space-joined lowercase words of a name. A name is
 * split into segments on commas and " - ", because 2MT names put the category first
 * ("Chair, armchair, royal", "Table - Broken 1 - Dark") while plain names put the head
 * noun last ("Bench Dining Table 1", "Bar Stool 2"). The primary type is the last
 * matching noun of the first segment that matches anything.
 */

import { splitWords } from "./names";

export type TypeGroup = "furniture" | "structure" | "storage" | "tableware" | "light" | "decor" | "gothic";

export interface TypeRule {
  type: string;
  group: TypeGroup;
  re: RegExp;
  /** The rule does not apply when the name matches this. */
  not?: RegExp;
  /** The rule only applies when the pack name matches this. */
  packIs?: RegExp;
  /** The rule does not apply when the pack name matches this. */
  packNot?: RegExp;
}

const JAIL = /\b(prison|jail|cell|dungeon jail|isometric jail|modular jail)\b/i;

export const TYPE_RULES: TypeRule[] = [
  // Furniture
  { type: "table", group: "furniture", re: /\b(table|tables|desk|desks|workbench|workbenches)\b/ },
  { type: "chair", group: "furniture", re: /\b(chair|chairs|armchair|armchairs|seat)\b/, not: /\bsedan\b/ },
  { type: "stool", group: "furniture", re: /\b(stool|stools)\b/ },
  { type: "bench", group: "furniture", re: /\b(bench|benches)\b/, not: /\bworkbench(es)?\b/ },
  { type: "bed", group: "furniture", re: /\b(bed|beds|cot|cots|bunk|bunks|bedroll|bedrolls|hammock|hammocks|mattress|mattresses)\b/, not: /\b(flower bed|river bed|seabed|bedside)\b/ },
  { type: "bar_counter", group: "furniture", re: /\b(bar|bars|counter|counters)\b/, not: /\b(metal|iron|gold|silver|steel|copper|bronze|soap|chocolate|candy|crow|lever|gold bar|grab|pull up|chin up|jail|prison|cell)\b/, packNot: JAIL },
  { type: "jail_bars", group: "structure", re: /\b(bar|bars)\b/, packIs: JAIL },
  { type: "throne", group: "furniture", re: /\b(throne|thrones)\b/ },
  { type: "sofa", group: "furniture", re: /\b(sofa|sofas|couch|couches|settee|settees|loveseat|loveseats|divan|chaise)\b/ },
  { type: "cushion", group: "decor", re: /\b(cushion|cushions|pillow|pillows)\b/ },
  { type: "pew", group: "furniture", re: /\b(pew|pews)\b/ },
  { type: "wardrobe", group: "furniture", re: /\b(wardrobe|wardrobes|dresser|dressers|cabinet|cabinets|cupboard|cupboards|armoire|armoires|drawers)\b/ },
  { type: "bookcase", group: "furniture", re: /\b(bookcase|bookcases|bookshelf|bookshelves)\b/ },
  { type: "shelf", group: "furniture", re: /\b(shelf|shelves|shelving|rack|racks)\b/ },
  { type: "chest", group: "storage", re: /\b(chest|chests|trunk|trunks|coffer|coffers|strongbox)\b/ },
  { type: "rug", group: "decor", re: /\b(rug|rugs|carpet|carpets)\b/ },
  { type: "lectern", group: "furniture", re: /\b(lectern|lecterns|pulpit|pulpits)\b/ },
  { type: "altar", group: "furniture", re: /\b(altar|altars)\b/ },
  // Structure
  { type: "stairs", group: "structure", re: /\b(stair|stairs|staircase|staircases|stairway|steps|ladder|ladders)\b/ },
  { type: "door", group: "structure", re: /\b(door|doors|doorway|hatch|hatches|trapdoor|trap door)\b/ },
  { type: "window", group: "structure", re: /\b(window|windows)\b/ },
  { type: "hearth", group: "structure", re: /\b(fireplace|fireplaces|hearth|hearths|oven|ovens|stove|stoves)\b/ },
  { type: "pillar", group: "structure", re: /\b(pillar|pillars|column|columns)\b/ },
  // Storage and clutter
  { type: "barrel", group: "storage", re: /\b(barrel|barrels|cask|casks)\b/ },
  { type: "keg", group: "storage", re: /\b(keg|kegs)\b/ },
  { type: "crate", group: "storage", re: /\b(crate|crates|box|boxes)\b/ },
  { type: "sack", group: "storage", re: /\b(sack|sacks|bag|bags)\b/ },
  { type: "basket", group: "storage", re: /\b(basket|baskets)\b/ },
  // Tableware and food
  { type: "tankard", group: "tableware", re: /\b(tankard|tankards|mug|mugs|cup|cups|goblet|goblets|chalice|stein|steins)\b/ },
  { type: "bottle", group: "tableware", re: /\b(bottle|bottles|jug|jugs|flask|flasks|wine)\b/ },
  { type: "plate", group: "tableware", re: /\b(plate|plates|bowl|bowls|dish|dishes|platter|platters|tray|trays)\b/ },
  { type: "cauldron", group: "tableware", re: /\b(cauldron|cauldrons|pot|pots|kettle|kettles)\b/ },
  { type: "book", group: "decor", re: /\b(book|books|tome|tomes|scroll|scrolls)\b/ },
  // Light
  { type: "candle", group: "light", re: /\b(candle|candles|candelabra|candelabras|candlestick|candlesticks)\b/ },
  { type: "chandelier", group: "light", re: /\b(chandelier|chandeliers)\b/ },
  { type: "lantern", group: "light", re: /\b(lantern|lanterns|lamp|lamps|torch|torches|sconce|sconces|brazier|braziers)\b/ },
  { type: "light", group: "light", re: /\b(light|lights|lighting)\b/ },
  // Gothic
  { type: "coffin", group: "gothic", re: /\b(coffin|coffins|casket|caskets)\b/ },
  { type: "sarcophagus", group: "gothic", re: /\b(sarcophagus|sarcophagi)\b/ },
  { type: "gravestone", group: "gothic", re: /\b(grave|graves|gravestone|gravestones|headstone|headstones|tombstone|tombstones|tomb|tombs)\b/ },
  { type: "statue", group: "gothic", re: /\b(statue|statues|bust|busts|gargoyle|gargoyles)\b/ },
  { type: "skeleton", group: "gothic", re: /\b(skeleton|skeletons|skull|skulls|bone|bones|ribcage)\b/ },
  { type: "corpse", group: "gothic", re: /\b(corpse|corpses|body|bodies|cadaver|adventurer|adventurers)\b/, packIs: /blood and bodies|bodies/i },
  { type: "blood", group: "gothic", re: /\b(blood|gore|splatter|splatters)\b/ },
  { type: "cobweb", group: "gothic", re: /\b(cobweb|cobwebs|web|webs|spiderweb|spiderwebs)\b/ },
  { type: "debris", group: "gothic", re: /\b(debris|rubble|wreckage)\b/ },
  { type: "cage", group: "gothic", re: /\b(cage|cages)\b/ },
  { type: "chain", group: "gothic", re: /\b(chain|chains|shackle|shackles|manacle|manacles)\b/ },
];

const BY_TYPE = new Map(TYPE_RULES.map((r) => [r.type, r]));
const GENERIC = new Set(["light"]);

export function typeGroup(type: string): TypeGroup | undefined {
  return BY_TYPE.get(type)?.group;
}

interface Hit {
  type: string;
  end: number;
}

function matchSegment(text: string, packName: string): Hit[] {
  const hits: Hit[] = [];
  for (const rule of TYPE_RULES) {
    if (rule.packIs && !rule.packIs.test(packName)) continue;
    if (rule.packNot && rule.packNot.test(packName)) continue;
    if (rule.not && rule.not.test(text)) continue;
    const re = new RegExp(rule.re.source, "g");
    let m: RegExpExecArray | null;
    let end = -1;
    while ((m = re.exec(text))) end = Math.max(end, m.index + m[0].length);
    if (end >= 0) hits.push({ type: rule.type, end });
  }
  return hits;
}

export interface Classification {
  types: string[];
  source: "name" | "tag" | "none";
}

/**
 * Types for an asset from its filename stem, falling back to its normalized tags.
 * @param stem filename without extension
 * @param packName pack display name, for context rules such as jail bars
 * @param tags normalized tags (see normalizeTag)
 */
export function classify(stem: string, packName: string, tags: string[] = []): Classification {
  const segments = stem
    .split(/\s*,\s*|\s+-\s+|\s+–\s+/)
    .map((s) => splitWords(s).join(" "))
    .filter(Boolean);
  // Later segments are more specific ("Chair - Stool 5" is a stool, "Chair - Throne 2" a throne),
  // so the primary type is the head noun of the last segment that names a type.
  const perSegment = segments.map((seg) => matchSegment(seg, packName).sort((a, b) => b.end - a.end));
  const types: string[] = [];
  for (let i = perSegment.length - 1; i >= 0; i--) {
    for (const h of perSegment[i]!) if (!types.includes(h.type)) types.push(h.type);
  }
  // Category words such as "Light" in "Light - Candle cluster" yield to a specific type.
  if (types.length > 1 && GENERIC.has(types[0]!)) types.push(types.shift()!);
  if (types.length) return { types, source: "name" };
  for (const tag of tags) {
    for (const h of matchSegment(splitWords(tag).join(" "), packName)) {
      if (!types.includes(h.type)) types.push(h.type);
    }
  }
  return types.length ? { types, source: "tag" } : { types: [], source: "none" };
}
