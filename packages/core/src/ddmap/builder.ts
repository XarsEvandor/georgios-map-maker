/**
 * Builds a Dungeondraft 1.2.0.1 map (format 3) from scratch.
 *
 * Structure and defaults come from maps saved by Dungeondraft itself (see DESIGN.md
 * section 10). Positions are pixels at 256 px per square, rotations radians.
 */

import { PX_PER_SQUARE } from "../assets/model";
import { formatByteArray, formatIntArray, formatVector2, formatVector2Array, toArgb, type Vec2 } from "./godot";

export const BUILT_IN = {
  wall: "res://textures/walls/stone.png",
  door: "res://textures/portals/door_00.png",
  light: "res://textures/lights/point.png",
  lightColor: "ffeccd8b",
  terrain: [
    "res://textures/terrain/terrain_sand.png",
    "res://textures/terrain/terrain_sandstone.png",
    "res://textures/terrain/terrain_cracked_earth.png",
    "res://textures/terrain/terrain_snow.png",
  ],
} as const;

/** Dungeondraft's default smart and simple tileset lookup for a new map. */
const TILE_LOOKUP: Record<string, string> = Object.fromEntries(
  [
    "smart/tileset_wood_vertical", "smart_double/tileset_stone", "simple/tileset_carpet", "simple/tileset_concrete_slab",
    "simple/tileset_brick_worn", "simple/tileset_concrete_large", "simple/tileset_brick_running", "simple/tileset_cave",
    "simple/tileset_brick_basketweave", "simple/tileset_cobble", "simple/tileset_concrete", "simple/tileset_diamond_2",
    "simple/tileset_ornate", "simple/tileset_roman_worn", "simple/tileset_diamond", "simple/tileset_cut_stone",
    "simple/tileset_sewers", "simple/tileset_herringbone", "simple/tileset_roman_tiles", "simple/tileset_plank_45",
    "simple/tileset_straw", "simple/tileset_wood_interlaced", "simple/tileset_worn_cobble", "simple/tileset_wood_damaged",
  ].map((t, i) => [String(i), `res://textures/tilesets/${t}.png`]),
);

const PALETTE_OBJECTS = [
  "ff6b3834", "ffac584c", "ff885848", "ffc0866c", "ff8d6d58", "fff3a768", "ff685848", "ff9c8868", "ffae9254", "ffd8c888",
  "ff888868", "ffaab478", "ff92aa58", "ff87a868", "ff679865", "ff789868", "ff546d56", "ff68887c", "ff667878", "ff809dab",
  "ff61788d", "ff535869", "ff786878", "ff886878", "ff905868", "ff994858", "ffd8d8d8", "ff8a8a8a", "ff585858", "ff282828",
];

/** Layers Dungeondraft creates for every level. */
export const LAYERS = { user1: 100, user2: 200, user3: 300, user4: 400, aboveWalls: 700, aboveRoofs: 900, belowGround: -400, belowWater: -100 };

export interface DoorSpec {
  /** Door center in pixels; must lie on the wall. */
  at: Vec2;
  /** Width in squares (default 1). */
  width?: number;
  texture?: string;
  closed?: boolean;
  /** Texture scale (a gate texture stretched across a wide opening). */
  scale?: number;
}

export interface WallSpec {
  points: Vec2[];
  loop?: boolean;
  texture?: string;
  color?: string;
  shadow?: boolean;
  doors?: DoorSpec[];
}

export interface ObjectSpec {
  at: Vec2;
  texture: string;
  /** Radians, clockwise on screen. */
  rotation?: number;
  scale?: number | Vec2;
  mirror?: boolean;
  layer?: number;
  shadow?: boolean;
  blockLight?: boolean;
  customColor?: string;
}

export interface PatternSpec {
  points: Vec2[];
  texture: string;
  color?: string;
  layer?: number;
  outline?: boolean;
  rotation?: number;
}

export interface LightSpec {
  at: Vec2;
  /** Radius in squares. */
  range?: number;
  intensity?: number;
  color?: string;
  texture?: string;
  shadows?: boolean;
}

export interface PathSpec {
  points: Vec2[];
  texture: string;
  /** Width in pixels. */
  width?: number;
  layer?: number;
  loop?: boolean;
  smooth?: boolean;
}

export interface MapOptions {
  width: number;
  height: number;
  /** Set when the map uses Dungeondraft's built-in assets (default true). */
  usesDefaultAssets?: boolean;
  /** ARGB ambient light of the level (default full white). */
  ambientLight?: string;
  label?: string;
  date?: Date;
}

/** Generic JSON object, as Dungeondraft stores it. */
export type Json = Record<string, unknown>;

interface Hit {
  point: Vec2;
  segment: number;
  t: number;
  length: number;
  direction: Vec2;
  distance: number;
}

function closestOnPolyline(points: Vec2[], loop: boolean, p: Vec2): Hit | undefined {
  let best: Hit | undefined;
  const n = loop ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len)));
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.distance) best = { point: q, segment: i, t, length: len, direction: [dx / len, dy / len], distance: d };
  }
  return best;
}

export class DDMapBuilder {
  private nextId = 1;
  readonly manifest = new Map<string, Json>();
  readonly level: Json & {
    patterns: Json[];
    walls: Json[];
    objects: Json[];
    lights: Json[];
    paths: Json[];
    environment: Json;
    terrain: Json;
  };
  readonly warnings: string[] = [];
  private splat?: Uint8Array;

  constructor(readonly opts: MapOptions) {
    const { width: w, height: h } = opts;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 200 || h > 200) {
      throw new Error(`map size must be whole squares between 1 and 200, got ${w}x${h}`);
    }
    this.level = {
      label: opts.label ?? "Ground",
      environment: { baked_lighting: true, ambient_light: toArgb(opts.ambientLight ?? "ffffffff") },
      layers: { "100": "User Layer 1", "200": "User Layer 2", "300": "User Layer 3", "400": "User Layer 4", "700": "Above Walls", "900": "Above Roofs", "-400": "Below Ground", "-100": "Below Water" },
      shapes: { polygons: [], walls: [] },
      tiles: {
        cells: formatIntArray(new Array(w * h).fill(-1)),
        colors: new Array(w * h).fill("ffffffff"),
        lookup: { ...TILE_LOOKUP },
      },
      patterns: [],
      walls: [],
      portals: [],
      cave: {
        // Observed size on square maps: (2w + 3) * h + 2 bytes. All zero means no cave.
        bitmap: formatByteArray(new Uint8Array((2 * w + 3) * h + 2)),
        ground_color: "ff7f7e71",
        wall_color: "ff7f7e71",
        entrance_bitmap: formatByteArray(new Uint8Array((2 * w + 3) * h + 2)),
        texture: "res://textures/caves/colorable/floor.png",
      },
      terrain: {
        enabled: true,
        expand_slots: false,
        smooth_blending: false,
        texture_1: BUILT_IN.terrain[0],
        texture_2: BUILT_IN.terrain[1],
        texture_3: BUILT_IN.terrain[2],
        texture_4: BUILT_IN.terrain[3],
        splat: "",
      },
      water: { disable_border: false },
      materials: { "100": [], "-400": [] },
      paths: [],
      objects: [],
      lights: [],
      roofs: { shade: true, shade_contrast: 0.5, sun_direction: 45, roofs: [] },
      texts: [],
      texts_vis: true,
    };
  }

  /** Allocates a node id (hex), as Dungeondraft does from world.next_node_id. */
  allocId(): string {
    return (this.nextId++).toString(16);
  }

  /** Registers a pack in the map's asset manifest (needed for every custom texture). */
  usePack(manifest: Json): void {
    const id = manifest.id;
    if (typeof id !== "string") throw new Error("manifest entry needs an id");
    if (!this.manifest.has(id)) this.manifest.set(id, { ...manifest });
  }

  private checkTexture(texture: string): void {
    const m = /^res:\/\/packs\/([^/]+)\//.exec(texture);
    if (m && !this.manifest.has(m[1]!)) throw new Error(`texture ${texture} uses pack ${m[1]} that is not in the manifest`);
    if (!/^res:\/\//.test(texture)) throw new Error(`texture must be a res:// path, got ${texture}`);
  }

  /**
   * Sets terrain textures and paints the splat map. `weights(x, y)` gets texel coordinates
   * (4 per square) and returns weights for slots 1 to 4 (0..255).
   */
  paintTerrain(textures: string[], weights: (tx: number, ty: number) => [number, number, number, number]): void {
    textures.slice(0, 4).forEach((t, i) => {
      this.checkTexture(t);
      this.level.terrain[`texture_${i + 1}`] = t;
    });
    const W = this.opts.width * 4, H = this.opts.height * 4;
    const splat = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const w = weights(x, y);
        splat.set(w.map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * W + x) * 4);
      }
    }
    this.splat = splat;
  }

  addPattern(p: PatternSpec): string {
    this.checkTexture(p.texture);
    if (p.points.length < 3) throw new Error("a floor pattern needs at least 3 points");
    const node_id = this.allocId();
    this.level.patterns.push({
      position: "Vector2( 0, 0 )",
      shape_rotation: 0,
      scale: "Vector2( 1, 1 )",
      points: formatVector2Array(p.points),
      layer: p.layer ?? LAYERS.user1,
      color: toArgb(p.color ?? "ffffffff"),
      outline: p.outline ?? false,
      texture: p.texture,
      rotation: p.rotation ?? 0,
      node_id,
    });
    return node_id;
  }

  addWall(w: WallSpec): { id: string; doors: string[] } {
    const texture = w.texture ?? BUILT_IN.wall;
    this.checkTexture(texture);
    const loop = w.loop ?? false;
    if (w.points.length < 2 || (loop && w.points.length < 3)) throw new Error("wall has too few points");
    const node_id = this.allocId();
    const portals: Json[] = [];
    for (const d of w.doors ?? []) {
      const tex = d.texture ?? BUILT_IN.door;
      this.checkTexture(tex);
      const hit = closestOnPolyline(w.points, loop, d.at);
      if (!hit || hit.distance > PX_PER_SQUARE / 4) throw new Error(`door at ${d.at} is not on its wall`);
      const radius = ((d.width ?? 1) * PX_PER_SQUARE) / 2;
      const along = hit.t * hit.length;
      if (along < radius - 1e-6 || hit.length - along < radius - 1e-6) this.warnings.push(`door at ${d.at} extends past its wall segment`);
      const [dx, dy] = hit.direction;
      portals.push({
        position: formatVector2(hit.point),
        rotation: Number(Math.atan2(dy, dx).toFixed(6)),
        scale: formatVector2([d.scale ?? 1, d.scale ?? 1]),
        direction: formatVector2([Number(dx.toFixed(6)), Number(dy.toFixed(6))]),
        texture: tex,
        radius,
        wall_id: node_id,
        wall_distance: Number((hit.segment + hit.t).toFixed(6)),
        closed: d.closed ?? true,
        node_id: this.allocId(),
      });
    }
    this.level.walls.push({
      points: formatVector2Array(w.points),
      texture,
      color: toArgb(w.color ?? "ffffffff"),
      loop,
      type: 0,
      joint: 1,
      normalize_uv: true,
      shadow: w.shadow ?? true,
      node_id,
      portals,
    });
    return { id: node_id, doors: portals.map((p) => p.node_id as string) };
  }

  addObject(o: ObjectSpec): string {
    this.checkTexture(o.texture);
    const s = o.scale ?? 1;
    const scale: Vec2 = typeof s === "number" ? [s, s] : s;
    const node_id = this.allocId();
    this.level.objects.push({
      position: formatVector2(o.at),
      rotation: Number((o.rotation ?? 0).toFixed(6)),
      scale: formatVector2(scale),
      mirror: o.mirror ?? false,
      texture: o.texture,
      layer: o.layer ?? LAYERS.user1,
      shadow: o.shadow ?? true,
      block_light: o.blockLight ?? false,
      ...(o.customColor ? { custom_color: toArgb(o.customColor) } : {}),
      node_id,
    });
    return node_id;
  }

  addLight(l: LightSpec): string {
    const texture = l.texture ?? BUILT_IN.light;
    this.checkTexture(texture);
    const node_id = this.allocId();
    this.level.lights.push({
      position: formatVector2(l.at),
      range: l.range ?? 5,
      intensity: l.intensity ?? 1,
      color: toArgb(l.color ?? BUILT_IN.lightColor),
      texture,
      shadows: l.shadows ?? true,
      node_id,
    });
    return node_id;
  }

  addPath(p: PathSpec): string {
    this.checkTexture(p.texture);
    if (p.points.length < 2) throw new Error("a path needs at least 2 points");
    const origin = p.points[0]!;
    const node_id = this.allocId();
    this.level.paths.push({
      position: formatVector2(origin),
      rotation: 0,
      scale: "Vector2( 1, 1 )",
      edit_points: formatVector2Array(p.points.map(([x, y]) => [x - origin[0], y - origin[1]] as Vec2)),
      smoothness: p.smooth === false ? 0 : 1,
      texture: p.texture,
      width: p.width ?? 256,
      layer: p.layer ?? LAYERS.user1,
      fade_in: false,
      fade_out: false,
      grow: false,
      shrink: false,
      block_light: false,
      loop: p.loop ?? false,
      node_id,
    });
    return node_id;
  }

  /** The complete map as a JSON object. */
  build(): Json {
    const { width: w, height: h } = this.opts;
    const splat = this.splat ?? (() => {
      const s = new Uint8Array(w * 4 * h * 4 * 4);
      for (let i = 0; i < s.length; i += 4) s[i] = 255;
      return s;
    })();
    const d = this.opts.date ?? new Date();
    const level = { ...this.level, terrain: { ...this.level.terrain, splat: formatByteArray(splat) } };
    return {
      header: {
        creation_build: "1.2.0.1 opulent kirin",
        creation_date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: d.getDay(), dst: false, hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() },
        uses_default_assets: this.opts.usesDefaultAssets ?? true,
        asset_manifest: [...this.manifest.values()],
        editor_state: {
          current_level: 0,
          camera_position: formatVector2([(w * PX_PER_SQUARE) / 2, (h * PX_PER_SQUARE) / 2]),
          camera_zoom: 4,
          guide_position: "null",
          trace_image: null,
          color_palettes: {
            object_custom_colors: PALETTE_OBJECTS,
            scatter_custom_colors: PALETTE_OBJECTS,
            light_colors: ["ffeccd8b", "ffeaefca", "ff80beff", "ffffad58", "ff4dd569"],
            grid_colors: ["7fffffff", "7fcccccc", "7f333333", "7f000000"],
            deep_water_colors: ["ff3aa19a", "ff8bceb0", "ffffcc55", "ff3c8ab8"],
            shallow_water_colors: ["ff3ac3b2", "ff8bceb0", "ffcc5555", "ff54c1da"],
            cave_ground_colors: ["ff7f7e71"],
            cave_wall_colors: ["ff7f7e71"],
          },
          object_tags_memory: { set: 0, tags: [] },
          scatter_tags_memory: { set: 0, tags: [] },
          object_library_memory: { mode: "all", scroll: 0, selected: [], search_strictness: 0.5 },
          scatter_library_memory: null,
          path_library_memory: { scroll: 0, selected: [], search_strictness: 0.5 },
          sharpen_fonts: true,
        },
      },
      world: {
        format: 3,
        width: w,
        height: h,
        next_node_id: this.nextId.toString(16),
        next_prefab_id: "1",
        msi: { offset_map_size: 512, max_offset_distance: 0.2, cell_size: 64, seed: "6ac0c2d0" },
        grid: { color: "7f000000", texture: "res://textures/grid/dotted_line.png" },
        building_wear: null,
        wall_shadow: true,
        object_shadow: true,
        trace_image_visible: false,
        embedded: {},
        levels: { "0": level },
      },
      mod: { ".node_table": {} },
    };
  }

  /** Map file text: tab-indented JSON with a trailing newline, like Dungeondraft writes. */
  serialize(): string {
    return `${JSON.stringify(this.build(), null, "\t")}\n`;
  }
}
