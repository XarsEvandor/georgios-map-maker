/**
 * Version styles (DESIGN.md section 9). A style anchors a version's furniture on one pack
 * and fixes, per role, a small pool of pieces from a single pack, so every chair in a map
 * matches every other chair while versions differ. Floors, walls, doors, windows, ground
 * and roads come from vision-tagged materials when tags exist.
 */

import type { AssetRecord } from "../assets/model";
import { deltaE, type Catalog, type FloorKind } from "./catalog";
import type { Genre } from "./plan";
import type { Rng } from "./rng";

export type Wear = "clean" | "lived-in" | "grimy" | "ruined";

export interface Style {
  id: string;
  name: string;
  anchorPack: string;
  /** Wood tone the furniture leans to: light, medium, dark or black. */
  tone: string;
  /** Mean Lab color of the anchor's core furniture, for floors and the version name. */
  lab: [number, number, number];
  /** ARGB custom color for wood stains. */
  tint: string;
  /** ARGB custom color for tintable fabric (2MT Colorable twins of red pieces). */
  fabric: string;
  floors: Partial<Record<FloorKind, AssetRecord>>;
  wall?: AssetRecord;
  /** Wall for interior partitions (lighter than the outer wall when available). */
  innerWall?: AssetRecord;
  door?: AssetRecord;
  window?: AssetRecord;
  terrain: AssetRecord[];
  road?: AssetRecord;
  /** Dark texture for the unseen rest of an enclosed building (tinted nearly black). */
  voidTexture?: AssetRecord;
  /** Gothic night or dim mood: dark floors and walls, dead plants. */
  dark?: boolean;
  /** Role -> chosen pool, filled lazily by poolFor. */
  pools: Map<string, AssetRecord[]>;
  /** Preferred numbered color variant of 2MT furniture packs ("Chair 3" = green), if any. */
  variant?: string;
}

/** Roles that define a version's look, with weights for choosing anchor packs. */
const CORE: Record<Genre, Record<string, number>> = {
  medieval: { table_set: 5, table_medium: 4, table_small: 3, chair: 5, stool: 3, bench: 3, bar_counter: 4, shelf: 2, barrel: 2, crate: 2, bed_single: 3, bed_double: 2, fireplace: 2, oven: 2, counter: 2, cabinet: 1, chest: 1 },
  gothic: { pew: 5, altar: 4, candelabra: 3, coffin: 3, sarcophagus: 3, chair: 4, armchair: 3, table_medium: 3, table_long: 3, bookshelf: 3, desk: 3, bed_double: 3, wardrobe: 2, fireplace: 2, sofa: 2, statue: 2 },
};

/** Packs that are generic furniture libraries: good fallbacks, never anchors on their own. */
const GENERIC = /\b(Food Assets|Grime and Shine|Blood and Bodies|Battle Damage|Broken Furniture|Mercantile Tokens|Statue Map Assets)\b/i;
/** Packs whose art style (cartoon outlines, crayon, ink sketch) clashes with the painted 2MT look: never anchors, last resort in pools. */
const CLASH = /\b(Dungeon Jail|Castle Furniture|Forgotten Monastery|Wizarding School Library|Mercantile Tokens|Modular Jail|Isometric|Crochet|Magic Toy)\b/i;
const BAD_STYLE = new Set(["modern", "whimsical", "exotic"]);
const OK_STYLE: Record<Genre, Set<string>> = {
  medieval: new Set(["rustic", "plain", "ornate", "crude", "magical"]),
  gothic: new Set(["rustic", "plain", "ornate", "gothic", "crude", "magical"]),
};

const CONDITIONS: Record<Wear, string[]> = {
  clean: ["fine"],
  "lived-in": ["fine", "worn"],
  grimy: ["worn", "fine"],
  ruined: ["broken", "worn", "burnt", "overgrown"],
};

function usable(a: AssetRecord, genre: Genre): boolean {
  const t = a.tag;
  if (!t || t.fit < 1) return false;
  if (t.style && BAD_STYLE.has(t.style)) return false;
  if (t.role === "prefab" || t.role === "token" || t.role === "label") return false;
  // Side-on or isometric drawings never sit right on a top-down map.
  if (/perspective|isometric|side view|front view|ribbon/i.test(a.name)) return false;
  void genre;
  return true;
}

function styleScore(a: AssetRecord, genre: Genre): number {
  const t = a.tag!;
  let s = t.fit;
  if (t.style && !OK_STYLE[genre].has(t.style)) s -= 1.5;
  if (genre === "gothic" && t.style === "gothic") s += 0.5;
  return s;
}

function variantOf(a: AssetRecord): string | undefined {
  // 2MT furniture numbers color variants: "Chair - Simple 2 - Dark", "Bed - Pattern 1.b".
  const m = a.name.match(/\bPattern (\d)\b/i);
  return m?.[1];
}

function labOf(list: AssetRecord[]): [number, number, number] {
  const ls = list.filter((a) => a.look).map((a) => a.look!.meanLab);
  if (!ls.length) return [45, 8, 18];
  return [0, 1, 2].map((i) => ls.reduce((s, l) => s + l[i]!, 0) / ls.length) as [number, number, number];
}

function labToArgb([L, a, b]: [number, number, number]): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const hex = lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  });
  return `ff${hex.join("")}`;
}

function pickClosest<T extends AssetRecord>(items: T[], target: [number, number, number], rng: Rng, spread = 2): T | undefined {
  const ranked = items.filter((x) => x.look).sort((x, y) => deltaE(x.look!.meanLab, target) - deltaE(y.look!.meanLab, target));
  if (!ranked.length) return items[0];
  return ranked[Math.min(ranked.length - 1, Math.floor(rng.next() * Math.min(spread, ranked.length)))];
}

function bestFit<T extends AssetRecord>(items: T[]): T[] {
  const top = Math.max(0, ...items.map((a) => a.mat?.fit ?? 0));
  return items.filter((a) => (a.mat?.fit ?? 0) >= Math.min(top, 3) - 0);
}

/** Fabric colors for Colorable pieces; Dungeondraft multiplies them into the greyscale art. */
const FABRIC = ["ffa86a55", "ff7088a8", "ff86a07a", "ff98809c", "ffc0a06a"];
const GOTHIC_FABRIC = ["ff8c3e3e", "ff6a6480", "ff587270", "ff7a4458"];

const TINTS: Array<[number, number, number]> = [
  [42, 14, 26], // warm brown
  [34, 10, 14], // dark walnut
  [55, 8, 24], // honey oak
  [30, 4, 4], // near-black stain
];

/**
 * Builds up to `count` styles anchored on different packs, ranked by how well each pack
 * covers the plan's core roles.
 */
/** Pack names that say what kind of place a pack was made for. */
const THEMED = /\b(tavern|inn|lodge|cathedral|church|chapel|crypt|crypts|monastery|bones|graveyard|haunted|wedding|mansion|victorian|ballroom|manor|alchemy|alchemist|wizard|wizarding|library|metalsmith|blacksmith|bards|market|marketplace|bathhouse|villa|asylum|cultist|toy|stable|bank|arena|ship|jail|prison|dwarven|forge|workshop)\b/i;

/** Wood floors that are not plain planks (vision-checked): basket weave, diagonal, tiles, herringbone. */
const FLOOR_BLOCK = /^(Wood Floor 1 - Tiling|Texture - Wood Floor - 8x8|Texture - Wood Tiles|Texture - Wood 1 - 6x6|Wooden Floor$)/i;
/** Wood floors must read as wood: warm, not blue or green tinted. */
const woodTone = (a: AssetRecord) => !a.look || (a.look.meanLab[2] > 3 && a.look.meanLab[1] > -2);

/** Wood tones each genre leans to, best first. */
const TONES: Record<Genre, string[]> = { medieval: ["medium", "dark", "light"], gothic: ["dark", "black", "medium"] };

export function buildStyles(cat: Catalog, genre: Genre, wear: Wear, neededRoles: string[], count: number, rng: Rng, theme?: RegExp, mood: { dark?: boolean; enclosed?: boolean; clearing?: boolean } = {}): Style[] {
  const weights = CORE[genre];
  const roles = new Set([...Object.keys(weights), ...neededRoles]);
  const packScore = new Map<string, number>();
  const packPieces = new Map<string, AssetRecord[]>();
  for (const role of roles) {
    const seen = new Set<string>();
    for (const a of cat.ofRole(role)) {
      if (!usable(a, genre) || a.tag!.fit < 2 || seen.has(a.pack)) continue;
      const name = cat.packs.get(a.pack)?.name ?? "";
      if (GENERIC.test(name) || CLASH.test(name)) continue;
      seen.add(a.pack);
      // Packs built for this kind of place make the best anchors; packs built for another kind of place the worst.
      const fit = theme?.test(name) ? 1.6 : theme && THEMED.test(name) ? 0.3 : 1;
      packScore.set(a.pack, (packScore.get(a.pack) ?? 0) + (weights[role] ?? 0.5) * fit);
      (packPieces.get(a.pack) ?? packPieces.set(a.pack, []).get(a.pack)!).push(a);
    }
  }
  const ranked = [...packScore.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0]?.[1] ?? 0;
  // Strong candidates first; weaker ones only fill in when versions would run short.
  const pool = [...ranked.filter(([, s]) => s >= top * 0.4).slice(0, 10), ...ranked.filter(([, s]) => s < top * 0.4).slice(0, 6)];
  const anchors: string[] = [];
  while (anchors.length < count && anchors.length < pool.length) {
    let best: string | undefined, bestV = -Infinity;
    const line = (p: string) => (cat.packs.get(p)?.name ?? p).replace(/\s+(Plus|Pack)$/i, "").replace(/^2MT?\s+/, "");
    for (const [pack, s] of pool) {
      if (anchors.includes(pack)) continue;
      // One anchor per product line: "Furniture Map Assets" and its Plus pack look the same.
      if (anchors.some((a) => line(a) === line(pack))) continue;
      const lab = labOf(packPieces.get(pack) ?? []);
      const spread = anchors.length ? Math.min(...anchors.map((p) => deltaE(labOf(packPieces.get(p) ?? []), lab))) : 20;
      const v = (s / top) * 2 + Math.min(spread, 30) / 20 + rng.next() * 0.6;
      if (v > bestV) { bestV = v; best = pack; }
    }
    if (!best) break;
    anchors.push(best);
  }
  // Without tags (tests, untagged libraries) fall back to a generic style.
  if (!anchors.length) anchors.push(...[...cat.packs.keys()].slice(0, 1));

  return anchors.map((anchor, i) => {
    const r = rng.fork(`style${i}`);
    const pieces = packPieces.get(anchor) ?? [];
    const lab = labOf(pieces.filter((a) => ["chair", "table_medium", "table_small", "table_set", "bench", "pew"].includes(a.tag!.role)));
    const tones = pieces.map((a) => a.tag?.tone).filter(Boolean) as string[];
    const tone = [...TONES[genre]].sort((a, b) => tones.filter((t) => t === b).length - tones.filter((t) => t === a).length)[0]!;
    const tintLab = TINTS[(i + r.int(0, 3)) % TINTS.length]!;

    // Floors: tagged patterns by use, wood following the furniture tone.
    const floors: Partial<Record<FloorKind, AssetRecord>> = {};
    const FLOOR_USE: Record<FloorKind, string[]> = { wood: ["floor_wood"], stone: ["floor_stone", "floor_brick"], tile: ["floor_tile"], cobble: ["floor_cobble"], dirt: ["floor_dirt"], grass: [] };
    const target: Record<FloorKind, [number, number, number]> = { wood: genre === "medieval" ? [52, 10, 22] : [42, 8, 16], stone: [50, 0, 4], tile: [56, 2, 6], cobble: [50, 0, 4], dirt: [42, 4, 14], grass: [60, -18, 30] };
    for (const kind of Object.keys(FLOOR_USE) as FloorKind[]) {
      let list = cat.ofUse(...FLOOR_USE[kind]).filter((a) => a.kind === "pattern" && (a.mat!.fit >= 2) && !BAD_STYLE.has(a.mat!.style ?? "") && !/ship|deck|boat|raft|isometric|colorable|parquet|alternating|checker|herringbone|chess|mosaic|diagonal|zigzag|chevron/i.test(a.name) && !(genre === "medieval" && kind === "wood" && /\bdark\b/i.test(a.name)) && !FLOOR_BLOCK.test(a.name) && (kind !== "wood" || woodTone(a)));
      if (genre === "medieval") list = list.filter((a) => a.mat!.style !== "gothic" || kind !== "wood");
      if (genre === "gothic" && kind === "stone") {
        // Castle stone: rough flagstones and paving blocks; veined slabs and square tile grids read as marble.
        const rough = list.filter((a) => /crazy-paving|irregular|paving blocks|flagstone/i.test(a.mat!.note ?? "") && !/veined|square|slab|tile|marble|polished/i.test(a.mat!.note ?? "") && (a.look?.chroma ?? 0) < 10);
        if (rough.length >= 2) list = rough;
        if (mood.dark) {
          const dark = list.filter((a) => (a.look?.meanLab[0] ?? 50) < 42);
          if (dark.length >= 2) list = dark;
        }
      }
      const own = list.filter((a) => a.pack === anchor);
      const tgt: [number, number, number] = genre === "gothic" && kind === "stone" && mood.dark ? [33, 1, 2] : target[kind];
      const fromTags = pickClosest(bestFit(own.length ? own : list), tgt, r, 3);
      floors[kind] = fromTags ?? pickClosest(cat.floorsOf(kind), target[kind], r);
    }

    const wallUses = genre === "gothic" ? ["wall_stone", "wall_brick", "wall_castle"] : ["wall_wood", "wall_plaster", "wall_stone", "wall_brick"];
    let walls = cat.ofUse(...wallUses).filter((a) => a.kind === "wall" && a.mat!.fit >= 2 && !BAD_STYLE.has(a.mat!.style ?? "") && !a.name.endsWith("_end") && !/crenel|battlement|merlon|castle walls|atelier|ruin|fence|ledge|cliff|wall only|straight - concave - grn/i.test(a.name));
    const top = walls.filter((a) => a.mat!.fit >= 3);
    if (top.length >= 3) walls = top;
    walls = walls.filter((a) => !CLASH.test(cat.packs.get(a.pack)?.name ?? "")) .length ? walls.filter((a) => !CLASH.test(cat.packs.get(a.pack)?.name ?? "")) : walls;
    if (genre === "gothic") {
      // Castle walls are thick and dark.
      const heavy = walls.filter((a) => (a.footprint?.[1] ?? 0) >= 0.75 && (a.look?.meanLab[0] ?? 50) < (mood.dark ? 40 : 50));
      if (heavy.length >= 2) walls = heavy;
    }
    const wallOwn = walls.filter((a) => a.pack === anchor);
    const wallTarget: [number, number, number] = genre === "gothic" && mood.dark ? [30, 0, -2] : [lab[0] * 0.8, lab[1], lab[2]];
    const wall = pickClosest(bestFit(wallOwn.length && !(genre === "gothic") ? wallOwn : walls), wallTarget, r, 4) ?? pickClosest(cat.walls, lab, r);
    // Partitions use the same wall: mixed wall textures read as stray strips.
    const innerWall = wall;

    const doors = cat.ofUse("door").filter((a) => a.kind === "portal" && a.mat!.fit >= 2 && !BAD_STYLE.has(a.mat!.style ?? ""));
    const door = pickClosest(doors.length ? doors : cat.doors, lab, r, 3);
    const wins = cat.ofUse("window").filter((a) => a.kind === "portal" && a.mat!.fit >= 2 && !BAD_STYLE.has(a.mat!.style ?? ""));
    const window = wins.length ? r.pick(wins) : cat.windows.length ? r.pick(cat.windows) : undefined;

    const gloomy = genre === "gothic";
    const ground = (uses: string[], tgt: [number, number, number]) => {
      let list = cat.ofUse(...uses).filter((a) => a.kind === "terrain" && a.mat!.fit >= 2 && !BAD_STYLE.has(a.mat!.style ?? ""));
      const mood = list.filter((a) => !!a.mat!.gloomy === gloomy);
      if (mood.length) list = mood;
      return pickClosest(bestFit(list), tgt, r, 3);
    };
    // A clearing in front of an enclosed building is open country: grass and earth, even at night.
    const terrain = (gloomy && !mood.clearing && (mood.enclosed || mood.dark) ? [
      ground(["dirt", "mud"], [34, 2, 6]),
      ground(["stone", "gravel"], [36, 0, 2]),
      ground(["mud", "leaves", "grass_dry"], [32, 2, 8]),
    ] : [
      ground(["grass"], gloomy ? [48, -10, 18] : [62, -20, 34]) ?? cat.floorsOf("grass", cat.terrains)[0],
      ground(["dirt", "mud"], gloomy ? [38, 2, 8] : [55, 4, 22]) ?? cat.floorsOf("dirt", cat.terrains)[0],
      ground(gloomy ? ["mud", "leaves", "moss"] : ["grass_dry", "gravel", "leaves"], gloomy ? [34, 0, 6] : [55, -4, 26]),
    ]).filter((x): x is AssetRecord => !!x);
    // The unseen dark around an enclosed building: a rough dark rock texture.
    const voidTexture = mood.enclosed
      ? cat.ofUse("floor_stone", "floor_other", "stone").filter((a) => a.kind === "pattern" && /rock|stone|cliff|cave/i.test(a.name) && !/water|lava|ice|snow|sky|crystal|sand|grass|tile|brick/i.test(a.name) && (a.look?.meanLab[0] ?? 50) < 36 && (a.look?.chroma ?? 0) < 12).sort((a, b) => (a.look!.meanLab[0] - b.look!.meanLab[0]) || a.id.localeCompare(b.id))[0] ?? floors.stone
      : undefined;
    const roads = cat.ofUse(genre === "gothic" ? "road_dirt" : "road_cobble", "road_dirt", "trail").filter((a) => a.kind === "path" && a.mat!.fit >= 2 && !BAD_STYLE.has(a.mat!.style ?? ""));
    // Gothic maps want dark, worn roads; a pale trail reads as a white scar at night.
    // Roads stay brown or grey: the cursed and sodden variants read as water.
    const earthy = roads.filter((a) => !/cursed|sodden|frozen|icy/i.test(a.name) && (a.look?.meanLab[2] ?? 5) > -1);
    const moody = genre === "gothic" ? earthy.filter((a) => (a.look?.meanLab[0] ?? 50) < (mood.dark ? 46 : 58)) : earthy;
    const road = (moody.length ? r.pick(moody.slice(0, 8)) : roads.length ? r.pick(roads.slice(0, 8)) : undefined) ?? cat.paths[0];

    const packName = (cat.packs.get(anchor)?.name ?? anchor).replace(/^2MT?\s+/, "").replace(/\s+(Plus|Pack|Map Assets)$/i, "");
    return {
      id: `v${i + 1}`,
      name: packName,
      anchorPack: anchor,
      tone,
      lab,
      tint: labToArgb(tintLab),
      fabric: (genre === "gothic" ? GOTHIC_FABRIC : FABRIC)[(i + r.int(0, 4)) % (genre === "gothic" ? GOTHIC_FABRIC : FABRIC).length]!,
      floors,
      wall,
      innerWall,
      door,
      window,
      terrain,
      road,
      voidTexture,
      dark: !!mood.dark,
      pools: new Map(),
      variant: r.pick(["5", "7", "6", undefined, undefined]),
    };
  });
}

/** Small things on tables and outdoors may be colorful (food, flowers); furniture should not. */
const SURFACE_ROLES = new Set(["food", "mug", "plate", "bottle", "potion", "book", "trinket", "flowers", "plant", "games", "coins", "scroll", "cookware", "cutlery", "candle", "blood", "mushroom", "banner", "painting", "instrument"]);

/** Roles whose small variants look wrong (a one-square altar, a child's coffin). */
const BIG_ROLES = new Set(["altar", "coffin", "sarcophagus", "bed_double", "fireplace", "bar_counter", "pew", "table_long", "pillar"]);

export interface PoolQuery {
  genre: Genre;
  wear: Wear;
  /** Placement the piece must have (any if omitted). */
  placement?: string[];
  /** Composite or not (any if omitted). */
  composite?: boolean;
  /** Name words that must not appear. */
  avoid?: RegExp;
  /** Name words preferred. */
  prefer?: RegExp;
  /** Only pieces with a lit flame (true) or without (false). */
  lit?: boolean;
  /** Maximum footprint side in squares. */
  maxSide?: number;
  /** Minimum footprint side in squares. */
  minSide?: number;
  /** How many packs may contribute (1 = one look). */
  packs?: number;
  /** Composites must include seating (table sets). */
  seated?: boolean;
}

/**
 * The pool of pieces a style uses for a role: one pack's best matches (the anchor's if it
 * has the role), filtered for wear and placement. Cached per style, role and query.
 */
/**
 * Goods named within roles, for shops: "food:fish" is the food pieces whose names say fish.
 * The part before the colon only labels the piece (Placed.type); the lookup uses these roles.
 */
const GOODS: Record<string, { roles: string[]; name: RegExp; not?: RegExp }> = {
  fish: { roles: ["food", "trophy"], name: /\bfish\b|fish \d|\bcrabs?\b|lobster|\beels?\b|shrimp|oyster|squid|octopus|\bclams?\b/i, not: /rod|pole|statue|bones?|skeleton|dish|plate|bowl/i },
  meat: { roles: ["food"], name: /meat|\bham\b|sausage|steak|\bribs?\b|pork|boar|\bpig\b|poultry|mutton|beef|drumstick/i, not: /dish|salad|plate|bowl|stew|soup|fish/i },
  bread: { roles: ["food"], name: /bread|loaf|baguette|pastr|\bpies?\b|\bbuns?\b|croissant|\bcakes?\b|muffin/i, not: /broken|slice of cake/i },
  herbs: { roles: ["crops", "plant", "trinket", "food"], name: /herb|garlic|bundle|hanging plant/i },
  cloth: { roles: ["other", "trinket", "table_small", "table_medium", "curtain"], name: /cloth|clothing|fabric|yarn|wool|spool|thread/i, not: /table/i },
  clothes: { roles: ["rack", "mannequin"], name: /clothes|mannequin|dress form/i },
  weapons: { roles: ["rack"], name: /weapon|sword|spear/i },
  boots: { roles: ["shelf", "trinket"], name: /boots?\b|shoes?\b/i },
  jewels: { roles: ["trinket", "other", "display_case"], name: /necklace|jewel|\bgems?\b|\brings?\b|crown|bracelet|tiara|\bgold\b/i, not: /chandelier|sarcophag|statue/i },
  butcher: { roles: ["counter", "workbench", "table_set"], name: /butcher/i },
  alchemy: { roles: ["alchemy", "table_medium", "table_small", "counter"], name: /alchem/i },
};

function rolePool(cat: Catalog, role: string): AssetRecord[] {
  const k = role.indexOf(":");
  if (k < 0) return cat.ofRole(role);
  const g = GOODS[role.slice(k + 1)];
  if (!g) return cat.ofRole(role.slice(0, k));
  return g.roles.flatMap((r) => cat.ofRole(r)).filter((a) => g.name.test(a.name) && !g.not?.test(a.name));
}

export function poolFor(cat: Catalog, style: Style, role: string, q: PoolQuery): AssetRecord[] {
  const key = `${role}|${q.placement?.join(",") ?? ""}|${q.composite ?? ""}|${q.avoid?.source ?? ""}|${q.prefer?.source ?? ""}|${q.lit ?? ""}|${q.maxSide ?? ""}|${q.minSide ?? ""}|${q.packs ?? 1}|${q.seated ?? ""}`;
  const hit = style.pools.get(key);
  if (hit) return hit;
  let list = rolePool(cat, role).filter((a) => usable(a, q.genre));
  // Named goods ("food:fish") follow their role's rules below.
  role = role.split(":")[0]!;
  if (q.placement) list = list.filter((a) => q.placement!.includes(a.tag!.placement));
  if (q.composite !== undefined) list = list.filter((a) => !!a.tag!.composite === q.composite);
  if (q.avoid) list = list.filter((a) => !q.avoid!.test(a.name));
  if (q.lit !== undefined) list = list.filter((a) => !!a.tag!.lit === q.lit);
  if (q.maxSide) list = list.filter((a) => Math.max(...a.footprint!) <= q.maxSide!);
  if (q.minSide) list = list.filter((a) => Math.min(...a.footprint!) >= q.minSide!);
  if (q.seated) list = list.filter((a) => (a.tag!.seats ?? 0) > 0 || (a.tag!.contains ?? []).some((r) => ["chair", "stool", "bench", "armchair", "sofa"].includes(r)));
  // Loud colors: 2MT's default-red pieces only work when a same-size Colorable twin can be
  // tinted; bright "colorful" furniture clashes with the muted 2MT palette. Keep them only
  // when nothing else exists for the role.
  const tintOk = (a: AssetRecord) => {
    if (a.tag!.tone !== "tintable" || a.colorable) return true;
    const t = cat.twins.get(a.id);
    return !!(t?.footprint && a.footprint && Math.abs(t.footprint[0] - a.footprint[0]) <= a.footprint[0] * 0.08 && Math.abs(t.footprint[1] - a.footprint[1]) <= a.footprint[1] * 0.08);
  };
  if (role === "pillar") {
    const plain = list.filter((a) => !/crystal|gem|blue|cyan|gold|neon/i.test(a.name) && (a.look?.chroma ?? 0) < 14);
    if (plain.length) list = plain;
  }
  // Flames burn warm: Twilight's green, blue and pink candles read as magic, not as an inn.
  if (["candle", "lantern", "torch", "sconce", "candelabra", "chandelier", "brazier", "lamp_post", "campfire", "firepit"].includes(role) || q.lit) {
    const warm = list.filter((a) => !/green|blue|purple|pink|violet|spectral|ghost|teal|cyan/i.test(a.name));
    if (warm.length) list = warm;
  }
  // Near-black rugs read as holes in the floor.
  if (["rug", "runner", "fur", "mat"].includes(role)) {
    const lit = list.filter((a) => a.tag!.tone !== "black" && !/\bblack\b/i.test(a.name));
    if (lit.length) list = lit;
  }
  if (role === "runner" || role === "rug") {
    const muted = list.filter((a) => (a.look?.chroma ?? 0) < 22 || a.colorable || a.tag!.tone === "tintable");
    if (muted.length) list = muted;
  }
  if (role === "blood") {
    const dark = list.filter((a) => a.tag!.tone === "dark" || a.tag!.tone === "black");
    if (dark.length) list = dark;
  }
  if (role === "stump" || role === "log") {
    const solid = list.filter((a) => !/_tree\b|tree_stump_\d+_tree|hollow|pit|protected/i.test(a.name));
    if (solid.length) list = solid;
  }
  if (!SURFACE_ROLES.has(role) && !["blood", "flowers", "plant", "bush", "tree"].includes(role)) {
    const quiet = list.filter((a) => a.colorable || a.tag!.tone === "tintable" || (a.look?.chroma ?? 0) < 28);
    if (quiet.length) list = quiet;
  }
  if (q.genre === "gothic" && style.dark && ["bush", "tree", "plant", "flowers", "mushroom", "leaves", "hedge", "grass"].includes(role)) {
    const dead = list.filter((a) => (a.look?.chroma ?? 0) < 18 && !/flower|blossom|pink|purple|bloom|cherry|autumn/i.test(a.name));
    if (dead.length) list = dead;
  }
  if (role === "plate" || role === "food") {
    const tidy = list.filter((a) => !/leaf dressing|garnish|foliage/i.test(a.name));
    if (tidy.length) list = tidy;
  }
  const plainRole = role.startsWith("table") || role === "runner" || role === "desk" || role === "counter";
  const calm = list.filter((a) => (plainRole ? a.tag!.tone !== "tintable" && !a.colorable : tintOk(a)) && (a.tag!.tone !== "colorful" || SURFACE_ROLES.has(role)));
  if (calm.length) list = calm;
  const conds = CONDITIONS[q.wear];
  const condOk = list.filter((a) => conds.includes(a.tag!.condition ?? "fine"));
  if (condOk.length) list = condOk;
  if (!list.length) {
    style.pools.set(key, []);
    return [];
  }
  const prefer = (a: AssetRecord) => (q.prefer && q.prefer.test(a.name) ? 1 : 0);
  const v = style.variant;
  const byPack = new Map<string, AssetRecord[]>();
  for (const a of list) (byPack.get(a.pack) ?? byPack.set(a.pack, []).get(a.pack)!).push(a);
  const anchorName = cat.packs.get(style.anchorPack)?.name ?? "";
  const packRank = [...byPack.entries()].map(([pack, items]) => {
    const name = cat.packs.get(pack)?.name ?? "";
    let s = Math.max(...items.map((a) => styleScore(a, q.genre))) + Math.min(items.length, 6) * 0.15;
    // Big roles: the pack with properly sized pieces wins (a one-square altar looks like a footstool).
    if (BIG_ROLES.has(role)) s += Math.min(2.5, Math.max(...items.map((a) => a.footprint![0] * a.footprint![1])) / 1.5);
    if (pack === style.anchorPack) s += 3;
    // Packs from the same product line as the anchor (Plus versions) count as kin.
    else if (anchorName && name.replace(/ Plus$/, "") === anchorName.replace(/ Plus$/, "")) s += 2;
    if (GENERIC.test(name)) s += 0.5;
    if (CLASH.test(name)) s -= 4;
    const toneHits = items.filter((a) => a.tag!.tone === style.tone).length / items.length;
    s += toneHits;
    return { pack, s, items };
  }).sort((a, b) => b.s - a.s || a.pack.localeCompare(b.pack));
  const chosen = packRank.slice(0, Math.max(1, q.packs ?? 1));
  let out = chosen.flatMap((c) => c.items);
  // A single piece repeats too obviously: borrow from the runner-up pack when the best has one.
  if (out.length < 2 && !q.packs && packRank[1]) out = [...out, ...packRank[1].items];
  // Keep to the style's wood tone where the pack offers it (Twilight's near-black "Dark 2" vs brown "Dark").
  const wood = new Set(["light", "medium", "dark", "black"]);
  if (out.some((a) => wood.has(a.tag!.tone ?? ""))) {
    const order = TONES[q.genre];
    const want = order.find((t) => out.some((a) => a.tag!.tone === t));
    const same = out.filter((a) => a.tag!.tone === want || !wood.has(a.tag!.tone ?? ""));
    if (same.length) out = same;
  }
  const bestScore = Math.max(...out.map((a) => styleScore(a, q.genre) + prefer(a)));
  out = out.filter((a) => styleScore(a, q.genre) + prefer(a) >= bestScore - 1);
  // Prefer the style's numbered color variant where the pack has numbered variants.
  if (v) {
    const sameVariant = out.filter((a) => variantOf(a) === v);
    if (sameVariant.length) out = sameVariant;
  }
  if (BIG_ROLES.has(role)) {
    const notSmall = out.filter((a) => !/\b(small|mini|tiny|child|baby)\b/i.test(a.name));
    if (notSmall.length) out = notSmall;
    const area = (a: AssetRecord) => a.footprint![0] * a.footprint![1];
    const best = Math.max(...out.map(area));
    const big = out.filter((a) => area(a) >= best * 0.55);
    if (big.length) out = big;
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  style.pools.set(key, out);
  return out;
}
