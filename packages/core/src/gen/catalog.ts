/** Usable assets for one genre, filtered from the asset index. Pure: no file access. */

import type { AssetIndex, AssetRecord, LookGroupRecord, PackRecord } from "../assets/model";
import type { Setting } from "../assets/names";
import type { Genre } from "./plan";

export type FloorKind = "wood" | "stone" | "tile" | "cobble" | "dirt" | "grass";

const FLOOR_WORDS: Record<FloorKind, RegExp> = {
  wood: /\b(floorboards?|wood|wooden|plank|planks|boards?|parquet)\b/,
  stone: /\b(flagstones?|stone|slab|slabs|paving|flags)\b/,
  tile: /\b(tiles?|marble|mosaic|checker|checkered)\b/,
  cobble: /\b(cobble|cobbles|cobblestone|cobblestones)\b/,
  dirt: /\b(dirt|mud|earth|soil|ground)\b/,
  grass: /\b(grass|meadow|lush|lawn)\b/,
};
const FLOOR_EXCLUDE = /\b(isometric|crochet|water|ocean|ice|icy|lava|scrap|sky|cutaway|wall|stairs|cover|platform|background|biotech|cyber|neon|sci|space|snow|snowy|frozen|volcanic|acid|infernal|jade|crystal|cosmic|candy|giant|underdark|lichen|river|sand|desert|badlands|beach|obsidian|gilded|gold|golden|night|recolour|mushroom|fungi|xibalba|labyrinth|greek)\b/;
const WALL_EXCLUDE = /\b(fence|ribbon|low|curb|cliff|path|wire|scrap|crochet|mushroom|natural|organic|ledge|hedge|cave|isometric|ice|icy|candy|sci|cyber|perspective|cap|rail|railing|ruin|ruined|broken)\b/;
const DOOR_EXCLUDE = /\b(prison|vault|security|emergency|exit|jail|dungeonjail|portcullis|bars|window|broken|cell|gate|sailing|sailingship|metal|heavy|duty)\b/;

export const GENRE_SETTINGS: Record<Genre, Setting[]> = {
  medieval: ["fantasy"],
  gothic: ["fantasy", "victorian"],
};

export class Catalog {
  readonly packs = new Map<string, PackRecord>();
  private readonly byId = new Map<string, AssetRecord>();
  private readonly byType = new Map<string, AssetRecord[]>();
  private readonly groups = new Map<string, LookGroupRecord>();
  private readonly groupsByType = new Map<string, LookGroupRecord[]>();
  readonly walls: AssetRecord[] = [];
  readonly floors: AssetRecord[] = [];
  readonly terrains: AssetRecord[] = [];
  readonly doors: AssetRecord[] = [];
  readonly paths: AssetRecord[] = [];
  /** Vision-tagged objects by role (fit >= 1, allowed packs only). */
  private readonly byRole = new Map<string, AssetRecord[]>();
  /** Base asset id -> its colorable twin. */
  readonly twins = new Map<string, AssetRecord>();
  /** Vision-tagged materials by use (walls, floors, terrain, paths, portals). */
  private readonly byUse = new Map<string, AssetRecord[]>();
  readonly windows: AssetRecord[] = [];
  /** Tagged objects from packs outside the genre (sci-fi wreckage), by "style:role". */
  private readonly foreign = new Map<string, AssetRecord[]>();
  private readonly byName = new Map<string, AssetRecord[]>();

  constructor(readonly index: AssetIndex, readonly settings: Setting[]) {
    for (const p of index.packs) this.packs.set(p.id, p);
    const allowedPack = (id: string) => {
      const p = this.packs.get(id);
      return !!p && p.readAllowed && !p.prefabOnly && settings.includes(p.setting);
    };
    const allIds = new Set(index.assets.map((a) => a.id));
    for (const a of index.assets) {
      if (a.error || !a.size[0]) continue;
      const pk = this.packs.get(a.pack);
      if (!allowedPack(a.pack)) {
        // Off-genre art is only for set pieces that ask for it by style (a blasted sci-fi door).
        if (pk?.readAllowed && a.kind === "object" && a.tag?.style && a.footprint && !a.dupeOf) {
          const k = `${a.tag.style}:${a.tag.role}`;
          (this.foreign.get(k) ?? this.foreign.set(k, []).get(k)!).push(a);
        }
        continue;
      }
      this.byId.set(a.id, a);
      (this.byName.get(a.name) ?? this.byName.set(a.name, []).get(a.name)!).push(a);
      if (a.kind === "object" && a.colorableOf) {
        this.twins.set(a.colorableOf, a);
      }
      if (a.kind === "object" && a.tag && a.tag.fit >= 1 && a.footprint && !a.dupeOf && !(a.colorableOf && allIds.has(a.colorableOf))) {
        const list = this.byRole.get(a.tag.role) ?? [];
        list.push(a);
        this.byRole.set(a.tag.role, list);
      }
      if (a.mat && a.mat.fit >= 1 && !a.dupeOf) {
        const list = this.byUse.get(a.mat.use) ?? [];
        list.push(a);
        this.byUse.set(a.mat.use, list);
      }
      const words = ` ${a.words.join(" ")} `;
      switch (a.kind) {
        case "object":
          if (a.prefab || a.dupeOf || a.colorable || !a.types[0] || !a.footprint) break;
          {
            const list = this.byType.get(a.types[0]) ?? [];
            list.push(a);
            this.byType.set(a.types[0], list);
          }
          break;
        case "wall":
          if (!a.name.endsWith("_end") && /\bwall\b/.test(words) && !WALL_EXCLUDE.test(words)) this.walls.push(a);
          break;
        case "pattern":
          if (!FLOOR_EXCLUDE.test(words) && !a.colorable) this.floors.push(a);
          break;
        case "terrain":
          if (!FLOOR_EXCLUDE.test(words.replace(/\b(sand|desert)\b/g, "")) && !a.colorable) this.terrains.push(a);
          break;
        case "portal":
          if (/\bdoors?\b/.test(words) && !DOOR_EXCLUDE.test(words)) this.doors.push(a);
          break;
        case "path":
          if (/\b(cobble|dirt|road|path|gravel|stone)\b/.test(words) && !/\b(wall|cliff|ledge|fence|scrap|lamp|ice|lava|biotech|tracks)\b/.test(words)) this.paths.push(a);
          break;
      }
    }
    for (const g of index.lookGroups) {
      const members = g.members.filter((m) => this.byType.get(g.type)?.some((a) => a.id === m));
      if (!members.length) continue;
      const rec = { ...g, members };
      this.groups.set(g.id, rec);
      const list = this.groupsByType.get(g.type) ?? [];
      list.push(rec);
      this.groupsByType.set(g.type, list);
    }
  }

  /** Tagged objects with a role, best fit first. */
  ofRole(role: string): AssetRecord[] {
    return this.byRole.get(role) ?? [];
  }

  roles(): string[] {
    return [...this.byRole.keys()];
  }

  /** Tagged objects of a style from packs outside the genre (e.g. "scifi", "debris"). */
  offGenre(style: string, role: string): AssetRecord[] {
    return this.foreign.get(`${style}:${role}`) ?? [];
  }

  /** Assets of a kind whose name matches (any genre-allowed pack, colorable twins and duplicates left out), sorted by id. */
  search(re: RegExp, kind: AssetRecord["kind"] = "object", pack?: RegExp): AssetRecord[] {
    const out: AssetRecord[] = [];
    for (const a of this.byId.values()) if (a.kind === kind && !a.colorable && !a.dupeOf && re.test(a.name) && (!pack || pack.test(this.packs.get(a.pack)?.name ?? ""))) out.push(a);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Assets with this exact name, optionally only from packs whose name matches. */
  named(name: string, pack?: RegExp): AssetRecord[] {
    return (this.byName.get(name) ?? []).filter((a) => !pack || pack.test(this.packs.get(a.pack)?.name ?? ""));
  }

  /** Tagged materials with one of the uses. */
  ofUse(...uses: string[]): AssetRecord[] {
    return uses.flatMap((u) => this.byUse.get(u) ?? []);
  }

  /** True when the library carries vision tags (otherwise the generator falls back to name rules). */
  get tagged(): boolean {
    return this.byRole.size > 0;
  }

  asset(id: string): AssetRecord | undefined {
    return this.byId.get(id);
  }

  ofType(type: string): AssetRecord[] {
    return this.byType.get(type) ?? [];
  }

  group(id: string): LookGroupRecord | undefined {
    return this.groups.get(id);
  }

  groupsOf(type: string): LookGroupRecord[] {
    return this.groupsByType.get(type) ?? [];
  }

  types(): string[] {
    return [...this.byType.keys()];
  }

  floorsOf(kind: FloorKind, from: AssetRecord[] = this.floors): AssetRecord[] {
    return from.filter((a) => FLOOR_WORDS[kind].test(` ${a.words.join(" ")} `));
  }

  manifestFor(packId: string): Record<string, unknown> {
    const p = this.packs.get(packId);
    if (!p) throw new Error(`unknown pack ${packId}`);
    return p.manifest;
  }
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
