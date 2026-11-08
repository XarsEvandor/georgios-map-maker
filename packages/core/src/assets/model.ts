/** Asset index data model. See DESIGN.md sections 8 and 9. */

/** Dungeondraft draws custom assets at 256 px per grid square. */
export const PX_PER_SQUARE = 256;

/** Texture folder inside a pack, as Dungeondraft names it under `textures/`. */
export type AssetKind =
  | "object"
  | "wall"
  | "pattern"
  | "terrain"
  | "path"
  | "portal"
  | "tileset"
  | "material"
  | "cave"
  | "roof"
  | "light"
  | "other";

/** Art family. "2MT" is the older 2-Minute Tabletop line, "2M" the newer one. */
export type Family = "2MT" | "2M" | "other";

export interface PackRecord {
  id: string;
  name: string;
  version?: string;
  author?: string;
  family: Family;
  /** Rough setting from the pack name: fantasy, victorian, modern or scifi. */
  setting: "fantasy" | "victorian" | "modern" | "scifi";
  /** Pack file that was indexed. */
  file: string;
  /** Other files with the same pack ID that were skipped. */
  duplicates: string[];
  /** Folder the pack file sits in, such as "Volume 8 - Dungeondraft packs". */
  folder: string;
  fileCount: number;
  /** True when every object in the pack is a whole pre-built image. */
  prefabOnly: boolean;
  /** Raw pack.json, copied into a map's header.asset_manifest when the map uses this pack. */
  manifest: Record<string, unknown>;
  /**
   * False when pack.json sets allow_3rd_party_mapping_software_to_read to false.
   * Such packs are listed but their images are never read or used.
   */
  readAllowed: boolean;
}

/** Color and shape features computed from the image. */
export interface LookFeatures {
  /** 64-bit difference hash of the trimmed image, as 16 hex characters. */
  dhash?: string;
  /** Alpha-weighted mean color in CIELAB. */
  meanLab: [number, number, number];
  /** Mean chroma (colorfulness) in CIELAB units. */
  chroma: number;
  /** Up to 3 dominant colors: L, a, b and the share of pixels. */
  colors: Array<[number, number, number, number]>;
}

export interface AssetRecord {
  /** `<packId>:<path inside pack>`, unique across the index. */
  id: string;
  pack: string;
  kind: AssetKind;
  /** Texture reference exactly as a .dungeondraft_map stores it. */
  res: string;
  /** Filename without extension. */
  name: string;
  /** Lowercase words from the filename. */
  words: string[];
  /** Normalized tags from the pack's tag file (pack-name and "Colorable" tags removed). */
  tags: string[];
  /** Semantic types, primary first. Empty when unknown. */
  types: string[];
  /** Where the primary type came from. */
  typeSource: "name" | "tag" | "vision" | "none";
  /** Condition words such as "broken", "bloody", "dark". */
  condition: string[];
  colorable: boolean;
  /** Id of the non-colorable twin, when this is a colorable copy. */
  colorableOf?: string;
  /** Assets sharing a variant group are numbered or lettered versions of one item. */
  variantGroup: string;
  /** Image size in pixels. */
  size: [number, number];
  /** Opaque bounding box in pixels: x, y, width, height. */
  trim?: [number, number, number, number];
  /** Outline of the opaque drawing, simplified, in units of the trimmed box (0..1, image axes). Traced for house and landmark roofs. */
  outline?: Array<[number, number]>;
  /** Footprint in grid squares, from the trimmed size. */
  footprint?: [number, number];
  /** Footprint stated in the filename, such as "(2x1)". */
  footprintHint?: [number, number];
  /** Larger than 1500 px on a side. */
  large: boolean;
  /** A whole pre-built map or building rather than a single piece. */
  prefab: boolean;
  look?: LookFeatures;
  /** Set when this asset is a near-identical copy of another one. */
  dupeOf?: string;
  /** Lookalike group id, for objects with a primary type. */
  lookGroup?: string;
  /** Analysis error, when the image could not be decoded. */
  error?: string;
  /** Vision tag for objects (tools/vision/ROLES.md), merged in at load time. */
  tag?: VisionTag;
  /** Vision tag for floors, walls, terrain, paths and portals (tools/vision/MATERIALS.md). */
  mat?: MaterialTag;
}

export type Facing = "down" | "up" | "left" | "right" | "none";
export type Placement = "free" | "wall" | "corner" | "surface" | "wallmount" | "overhead" | "rug" | "decal" | "outdoor";

/** What a vision pass saw in an object image. */
export interface VisionTag {
  role: string;
  /** Direction the piece's front points in the image. */
  facing: Facing;
  placement: Placement;
  composite?: boolean;
  contains?: string[];
  seats?: number;
  tone?: string;
  style?: string;
  condition?: string;
  /** 0 never use, 3 great, for medieval and gothic maps. */
  fit: number;
  lit?: boolean;
  note?: string;
  /** Copied from the base asset (a colorable twin or near-duplicate). */
  inherited?: "colorable" | "dupe";
}

export interface MaterialTag {
  use: string;
  tone?: string;
  style?: string;
  fit: number;
  gloomy?: boolean;
  note?: string;
}

/** data/asset-tags.json */
export interface AssetTags {
  objects: Record<string, VisionTag>;
  materials: Record<string, MaterialTag>;
}

/** Attaches vision tags to index records (in place). */
export function applyTags(index: { assets: AssetRecord[] }, tags: AssetTags): number {
  let n = 0;
  for (const a of index.assets) {
    const t = tags.objects[a.id];
    if (t) { a.tag = t; n++; }
    const mt = tags.materials[a.id];
    if (mt) { a.mat = mt; n++; }
  }
  return n;
}

export interface LookGroupRecord {
  id: string;
  type: string;
  members: string[];
  meanLab: [number, number, number];
  families: Family[];
  condition: string[];
}

export interface AssetIndex {
  schema: 1;
  builtAt: string;
  root: string;
  packs: PackRecord[];
  assets: AssetRecord[];
  lookGroups: LookGroupRecord[];
}
