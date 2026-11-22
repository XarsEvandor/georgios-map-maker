/**
 * Scene plan: the single source of truth for what a map should contain (DESIGN.md section 6).
 * Claude writes and patches plans through tools; validatePlan() checks every change.
 */

export type Genre = "medieval" | "gothic";
export type Side = "north" | "south" | "east" | "west";
export type Corner = "ne" | "nw" | "se" | "sw";

export interface Anchor {
  anchor?: "center";
  along?: Side;
  corner?: Corner;
  /** Element id: a directive id or a placed feature id. */
  near?: string;
  /** Offset in squares, applied after the anchor. */
  offset?: [number, number];
  /** Rotation in degrees, clockwise. */
  rotation?: number;
}

export interface Zone {
  id: string;
  /** Rule pack room type, e.g. "tavern.common_room". */
  type: string;
  area?: "small" | "medium" | "large";
  /** Variety level: how far the palette may stretch in this zone. */
  variety?: "low" | "medium" | "high";
}

export interface Connection {
  /** Optional id, so directives can refer to this doorway ("near": "<id>"). */
  id?: string;
  from: string;
  /** A zone id, "outside" (open ground) or "beyond" (an unseen part of the building, off the map: nothing is drawn behind the door). */
  to: string;
  /** A gate is a wide double door with its own frame; in Foundry its leaves swing open. */
  via?: "door" | "opening" | "gate";
  /** Building side for doors to the outside. */
  side?: Side;
  /** Opening width in squares (doors 1, gates 3 by default). */
  width?: number;
  /** Door state in Foundry: closed (players can open it), locked (sealed; the GM unlocks it), open. */
  state?: "closed" | "locked" | "open";
  /** The door or gate was blown apart: an open gap with its wreckage thrown about. "scifi" or "medieval". */
  broken?: "medieval" | "scifi";
  /** For a room off a corridor (gothic.gallery): which corridor wall it opens from, seen walking in from the entrance. */
  wall?: "left" | "right" | "end";
  /** How far along the corridor, 0 (entrance) to 1 (far end). */
  along?: number;
}

export interface Level {
  id: string;
  zones: Zone[];
  connections?: Connection[];
}

interface DirectiveBase {
  id: string;
  /** Limit to a zone; omit for the whole map. */
  zone?: string;
  source?: "dm-chat" | "dm-dungeondraft" | "dm-foundry" | "llm";
}

export interface PinDirective extends DirectiveBase {
  /** Asset type ("table") or exact asset id ("<pack>:textures/objects/..."). */
  pin: string;
  at?: Anchor;
  /** Slot overrides for group templates, e.g. { chair: 0 }. */
  slots?: Record<string, number>;
  /** Extra asset types placed on or next to the pinned piece. */
  with?: string[];
}

export interface FreeDirective extends DirectiveBase {
  free: string;
  at?: Anchor;
  with?: string[];
}

export interface ForbidDirective extends DirectiveBase {
  forbid: string[];
}

export interface ModifyDirective extends DirectiveBase {
  /** Rule feature id (e.g. "table_sets") or group template name. */
  modify: string;
  count?: { min?: number; max?: number } | number;
  slots?: Record<string, number>;
  /** "worn", "frayed", "torn", "broken", "fine". */
  condition?: string;
  /** Color for tintable pieces: a name ("red", "crimson", "black") or ARGB/RGB hex. */
  color?: string;
}

export interface RestyleDirective extends DirectiveBase {
  /** Asset type whose look changes. */
  restyle: string;
  /** Take the look from another version ("v1") or a lookalike group id ("chair:12"). */
  from: string;
}

export type Directive = PinDirective | FreeDirective | ForbidDirective | ModifyDirective | RestyleDirective;

export interface Lock {
  id: string;
  /** Region in squares. */
  region?: { x: number; y: number; w: number; h: number };
  /** Dungeondraft node ids to keep. */
  elements?: string[];
  source?: Directive["source"];
}

export interface ScenePlan {
  id: string;
  title?: string;
  seed: number;
  genre: Genre;
  /** Map size in squares. */
  size: { w: number; h: number };
  mood?: { time?: "day" | "dusk" | "night"; wear?: "clean" | "lived-in" | "grimy" | "ruined"; lighting?: "bright" | "dim" | "dark" };
  versions?: { count?: number; vary?: "palette"; picked?: string };
  levels: Level[];
  directives?: Directive[];
  locks?: Lock[];
  /**
   * The building is part of something bigger (a castle, a dungeon): outside its walls is
   * unseen darkness, except a short approach in front of the main entrance. Default: on when
   * a door leads "beyond" and there are no outdoor zones.
   */
  enclosed?: boolean;
  /**
   * Enclosed maps: the open ground in front of the main entrance. `depth` is how far it reaches
   * from the wall (default 5 squares); `width` how wide the map is there at least (default the
   * building plus a square of dark each side). The building itself is laid out as before and
   * the map grows around it, so asking for a clearing never reshapes the rooms. Eight squares
   * deep or more, the ground is dressed as a clearing ringed by trees.
   */
  approach?: { depth?: number; width?: number };
  /** Street-level map of part of a city: the city's cache key and the area in metres (city.ts). */
  street?: { city: string; area: { x: number; y: number; w: number; h: number }; focus?: string };
  /** A war map (gen/war.ts): an army's camp, or the field where armies fight. */
  war?: WarPlan;
}

/** An army on a war map: its name, its colour ("#rrggbb") and the map edge it holds (a field) or its gate faces (a camp). */
export interface WarSide {
  name: string;
  color: string;
  edge?: Side;
}

export interface WarPlan {
  /** "camp": one army's camp (sides[0]); "field": the ground between the sides' lines. */
  kind: "camp" | "field";
  sides: WarSide[];
  /** Machines standing on the field (0 to 5), glowing in their craters. */
  machines?: number;
  /** The edge a road leaves the field by (default: an edge no side holds). */
  road?: Side;
}

export const LIMITS = {
  minSize: 8,
  maxSize: 80,
  maxZones: 16,
  maxDirectives: 200,
  maxLocks: 50,
  maxVersions: 4,
  maxIdLength: 64,
};

const ID = /^[a-z0-9][a-z0-9_.:-]*$/i;

export interface PlanIssue {
  path: string;
  message: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates a plan received from Claude or the DM. Returns an empty list when valid.
 * It checks types, ranges and references, and caps sizes so a hostile or broken plan
 * can't make the generator run away.
 */
export function validatePlan(input: unknown, knownZoneTypes?: Set<string>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  if (!isObj(input)) return [{ path: "", message: "plan must be an object" }];
  const p = input;
  const id = (v: unknown, path: string) => {
    if (typeof v !== "string" || !ID.test(v) || v.length > LIMITS.maxIdLength) bad(path, "must be a short id (letters, digits, _ . : -)");
  };
  id(p.id, "id");
  if (typeof p.seed !== "number" || !Number.isInteger(p.seed) || p.seed < 0 || p.seed > 2 ** 32) bad("seed", "must be an integer 0..2^32");
  if (p.genre !== "medieval" && p.genre !== "gothic") bad("genre", 'must be "medieval" or "gothic"');
  if (!isObj(p.size)) bad("size", "must be {w, h}");
  else {
    for (const k of ["w", "h"] as const) {
      const v = p.size[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < LIMITS.minSize || v > LIMITS.maxSize) bad(`size.${k}`, `must be a whole number of squares, ${LIMITS.minSize}..${LIMITS.maxSize}`);
    }
  }
  if (p.title !== undefined && (typeof p.title !== "string" || p.title.length > 200)) bad("title", "must be a string of at most 200 characters");
  if (p.enclosed !== undefined && typeof p.enclosed !== "boolean") bad("enclosed", "must be true or false");
  if (p.approach !== undefined) {
    const ap = p.approach as Record<string, unknown>;
    if (typeof ap !== "object" || ap === null || Array.isArray(ap)) bad("approach", "must be an object with depth and/or width");
    else for (const k of Object.keys(ap)) {
      const v = ap[k];
      if (k !== "depth" && k !== "width") bad(`approach.${k}`, "unknown field (depth, width)");
      else if (typeof v !== "number" || !Number.isFinite(v) || v < 2 || v > LIMITS.maxSize) bad(`approach.${k}`, `must be a number from 2 to ${LIMITS.maxSize}`);
    }
  }
  if (p.street !== undefined) {
    const st = p.street as Record<string, any>;
    if (!isObj(st) || typeof st.city !== "string" || !/^[0-9a-f]{8,40}$/.test(st.city) || !isObj(st.area) || !["x", "y", "w", "h"].every((k) => typeof (st.area as any)[k] === "number" && Number.isFinite((st.area as any)[k]))) bad("street", "must be {city, area: {x, y, w, h}}");
    else if ((st.area as any).w < 10 || (st.area as any).h < 10 || (st.area as any).w > 130 || (st.area as any).h > 130) bad("street.area", "must be 10 to 130 metres a side");
  }
  if (p.war !== undefined) {
    const wr = p.war as Record<string, any>;
    const sideOk = (s: any) => isObj(s) && typeof s.name === "string" && s.name.length >= 1 && s.name.length <= 60 && typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) && (s.edge === undefined || ["north", "south", "east", "west"].includes(String(s.edge)));
    if (!isObj(wr) || (wr.kind !== "camp" && wr.kind !== "field")) bad("war", 'must be {kind: "camp" or "field", sides}');
    else if (!Array.isArray(wr.sides) || wr.sides.length < 1 || wr.sides.length > 4 || !wr.sides.every(sideOk)) bad("war.sides", 'must be 1 to 4 sides, each {name, color "#rrggbb", edge?}');
    else if (wr.kind === "field" && wr.sides.filter((s: any) => s.edge).length < 2) bad("war.sides", "a field needs at least two sides with an edge");
    if (isObj(wr) && wr.road !== undefined && !["north", "south", "east", "west"].includes(String(wr.road))) bad("war.road", "must be north, south, east or west");
    if (isObj(wr) && wr.machines !== undefined && (typeof wr.machines !== "number" || !Number.isInteger(wr.machines) || wr.machines < 0 || wr.machines > 5)) bad("war.machines", "must be a whole number 0..5");
    if (p.street !== undefined) bad("war", "a map is a street map or a war map, not both");
  }
  if (p.mood !== undefined) {
    if (!isObj(p.mood)) bad("mood", "must be an object");
    else {
      const enums: Record<string, string[]> = { time: ["day", "dusk", "night"], wear: ["clean", "lived-in", "grimy", "ruined"], lighting: ["bright", "dim", "dark"] };
      for (const [k, allowed] of Object.entries(enums)) {
        const v = p.mood[k];
        if (v !== undefined && (typeof v !== "string" || !allowed.includes(v))) bad(`mood.${k}`, `must be one of ${allowed.join(", ")}`);
      }
    }
  }
  if (p.versions !== undefined) {
    if (!isObj(p.versions)) bad("versions", "must be an object");
    else {
      if (p.versions.count !== undefined && (typeof p.versions.count !== "number" || !Number.isInteger(p.versions.count) || p.versions.count < 1 || p.versions.count > LIMITS.maxVersions)) bad("versions.count", `must be a whole number 1..${LIMITS.maxVersions}`);
      if (p.versions.picked !== undefined && (typeof p.versions.picked !== "string" || !/^v\d{1,2}$/.test(p.versions.picked))) bad("versions.picked", 'must look like "v1"');
    }
  }
  const zoneIds = new Set<string>();
  if (!Array.isArray(p.levels) || p.levels.length !== 1) bad("levels", "must contain exactly one level (multi-level maps are not supported yet)");
  else {
    const lv = p.levels[0];
    if (!isObj(lv)) bad("levels[0]", "must be an object");
    else {
      id(lv.id, "levels[0].id");
      if (!Array.isArray(lv.zones) || lv.zones.length < 1 || lv.zones.length > LIMITS.maxZones) bad("levels[0].zones", `must have 1..${LIMITS.maxZones} zones`);
      else {
        lv.zones.forEach((z, i) => {
          const path = `levels[0].zones[${i}]`;
          if (!isObj(z)) return bad(path, "must be an object");
          id(z.id, `${path}.id`);
          if (typeof z.id === "string") {
            if (zoneIds.has(z.id)) bad(`${path}.id`, `duplicate zone id ${z.id}`);
            zoneIds.add(z.id);
          }
          if (typeof z.type !== "string") bad(`${path}.type`, "must be a room type");
          else if (knownZoneTypes && !knownZoneTypes.has(z.type)) bad(`${path}.type`, `unknown room type ${z.type}; known: ${[...knownZoneTypes].join(", ")}`);
          if (z.area !== undefined && !["small", "medium", "large"].includes(z.area as string)) bad(`${path}.area`, "must be small, medium or large");
        });
      }
      if (lv.connections !== undefined) {
        if (!Array.isArray(lv.connections) || lv.connections.length > 64) bad("levels[0].connections", "must be a list (at most 64)");
        else {
          lv.connections.forEach((c, i) => {
            const path = `levels[0].connections[${i}]`;
            if (!isObj(c)) return bad(path, "must be an object");
            if (typeof c.from !== "string" || !zoneIds.has(c.from)) bad(`${path}.from`, "must name a zone");
            if (typeof c.to !== "string" || (c.to !== "outside" && c.to !== "beyond" && !zoneIds.has(c.to))) bad(`${path}.to`, 'must name a zone, "outside" or "beyond"');
            if (c.side !== undefined && !["north", "south", "east", "west"].includes(c.side as string)) bad(`${path}.side`, "must be north, south, east or west");
            if (c.id !== undefined) id(c.id, `${path}.id`);
            if (c.via !== undefined && !["door", "opening", "gate"].includes(c.via as string)) bad(`${path}.via`, "must be door, opening or gate");
            if (c.width !== undefined && (typeof c.width !== "number" || !Number.isInteger(c.width) || c.width < 1 || c.width > 6)) bad(`${path}.width`, "must be a whole number of squares, 1..6");
            if (c.state !== undefined && !["closed", "locked", "open"].includes(c.state as string)) bad(`${path}.state`, "must be closed, locked or open");
            if (c.broken !== undefined && !["medieval", "scifi"].includes(c.broken as string)) bad(`${path}.broken`, "must be medieval or scifi");
            if (c.wall !== undefined && !["left", "right", "end"].includes(c.wall as string)) bad(`${path}.wall`, "must be left, right or end");
            if (c.along !== undefined && (typeof c.along !== "number" || !(c.along >= 0 && c.along <= 1))) bad(`${path}.along`, "must be a number 0..1");
          });
        }
      }
    }
  }
  const dirIds = new Set<string>();
  if (p.directives !== undefined) {
    if (!Array.isArray(p.directives) || p.directives.length > LIMITS.maxDirectives) bad("directives", `must be a list (at most ${LIMITS.maxDirectives})`);
    else {
      p.directives.forEach((d, i) => {
        const path = `directives[${i}]`;
        if (!isObj(d)) return bad(path, "must be an object");
        id(d.id, `${path}.id`);
        if (typeof d.id === "string") {
          if (dirIds.has(d.id)) bad(`${path}.id`, `duplicate directive id ${d.id}`);
          dirIds.add(d.id);
        }
        const kinds = ["pin", "free", "forbid", "modify", "restyle"].filter((k) => k in d);
        if (kinds.length !== 1) return bad(path, "must have exactly one of pin, free, forbid, modify, restyle");
        if (d.zone !== undefined && (typeof d.zone !== "string" || !zoneIds.has(d.zone))) bad(`${path}.zone`, "must name a zone");
        const k = kinds[0]!;
        if (k === "forbid" && (!Array.isArray(d.forbid) || !d.forbid.every((t) => typeof t === "string") || d.forbid.length > 50)) bad(`${path}.forbid`, "must be a list of asset types");
        if ((k === "pin" || k === "free" || k === "modify" || k === "restyle") && (typeof d[k] !== "string" || (d[k] as string).length > 200)) bad(`${path}.${k}`, "must be a string");
        if (k === "restyle" && typeof d.from !== "string") bad(`${path}.from`, "must name a version or lookalike group");
        if (d.slots !== undefined && (!isObj(d.slots) || !Object.values(d.slots).every((n) => typeof n === "number" && n >= 0 && n <= 12))) bad(`${path}.slots`, "slot counts must be numbers 0..12");
        if (d.count !== undefined) {
          const okN = (n: unknown) => n === undefined || (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 60);
          if (typeof d.count === "number" ? !okN(d.count) : !isObj(d.count) || !okN(d.count.min) || !okN(d.count.max)) bad(`${path}.count`, "must be a whole number 0..60 or {min, max}");
        }
        if (d.color !== undefined && (typeof d.color !== "string" || d.color.length > 32)) bad(`${path}.color`, "must be a color name or hex");
        if (d.condition !== undefined && (typeof d.condition !== "string" || d.condition.length > 32)) bad(`${path}.condition`, "must be a short word");
        if (d.with !== undefined && (!Array.isArray(d.with) || d.with.length > 8 || !d.with.every((t) => typeof t === "string" && t.length <= 200))) bad(`${path}.with`, "must be a list of at most 8 asset types");
        if (d.at !== undefined) {
          if (!isObj(d.at)) bad(`${path}.at`, "must be an anchor object");
          else {
            const a = d.at;
            if (a.along !== undefined && !["north", "south", "east", "west"].includes(a.along as string)) bad(`${path}.at.along`, "must be a side");
            if (a.corner !== undefined && !["ne", "nw", "se", "sw"].includes(a.corner as string)) bad(`${path}.at.corner`, "must be ne, nw, se or sw");
            if (a.offset !== undefined && (!Array.isArray(a.offset) || a.offset.length !== 2 || !a.offset.every((n) => typeof n === "number" && Math.abs(n) <= LIMITS.maxSize))) bad(`${path}.at.offset`, "must be [dx, dy] in squares");
          }
        }
      });
    }
  }
  if (p.locks !== undefined) {
    if (!Array.isArray(p.locks) || p.locks.length > LIMITS.maxLocks) bad("locks", `must be a list (at most ${LIMITS.maxLocks})`);
    else {
      p.locks.forEach((l, i) => {
        const path = `locks[${i}]`;
        if (!isObj(l)) return bad(path, "must be an object");
        id(l.id, `${path}.id`);
        if (l.region !== undefined) {
          const r = l.region;
          if (!isObj(r) || !["x", "y", "w", "h"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number) && Math.abs(r[k] as number) <= LIMITS.maxSize * 2)) bad(`${path}.region`, "must be {x, y, w, h} in squares");
        }
        if (l.elements !== undefined && (!Array.isArray(l.elements) || l.elements.length > 2000 || !l.elements.every((e) => typeof e === "string" && /^[0-9a-f]{1,12}$/i.test(e)))) bad(`${path}.elements`, "must be a list of Dungeondraft node ids");
        if (l.region === undefined && l.elements === undefined) bad(path, "needs a region or elements");
      });
    }
  }
  return issues;
}
