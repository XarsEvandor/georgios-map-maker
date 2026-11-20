/** A tiny synthetic asset library for generator tests (no real packs needed), vision-tagged like the real one. */

import type { AssetIndex, AssetRecord, Facing, LookGroupRecord, MaterialTag, PackRecord, Placement, VisionTag } from "../src/index";

const PACKS: PackRecord[] = [
  { id: "PACKA", name: "2MT Test Tavern", family: "2MT", setting: "fantasy", file: "a.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2MT Test Tavern", id: "PACKA", version: "1", author: "test" }, readAllowed: true },
  { id: "PACKB", name: "2MT Test Furniture", family: "2MT", setting: "fantasy", file: "b.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2MT Test Furniture", id: "PACKB", version: "1", author: "test" }, readAllowed: true },
  { id: "PACKC", name: "2M Test Chapel", family: "2M", setting: "fantasy", file: "c.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2M Test Chapel", id: "PACKC", version: "1", author: "test" }, readAllowed: true },
  { id: "SCIFI", name: "2MT Sci-Fi Test", family: "2MT", setting: "scifi", file: "d.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2MT Sci-Fi Test", id: "SCIFI", version: "1", author: "test" }, readAllowed: true },
  { id: "DEPTH", name: "2MT Living Depths Test", family: "2MT", setting: "fantasy", file: "e.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2MT Living Depths Test", id: "DEPTH", version: "1", author: "test" }, readAllowed: true },
  { id: "STORE", name: "2MT Marketplace Test", family: "2MT", setting: "fantasy", file: "f.dungeondraft_pack", duplicates: [], folder: "t", fileCount: 1, prefabOnly: false, manifest: { name: "2MT Marketplace Test", id: "STORE", version: "1", author: "test" }, readAllowed: true },
];

let n = 0;
function asset(pack: string, kind: AssetRecord["kind"], name: string, types: string[], fp: [number, number], lab: [number, number, number] = [45, 10, 20]): AssetRecord {
  n++;
  const folder = kind === "object" ? "objects" : `${kind}s`;
  const rel = `textures/${folder}/${name}.png`;
  return {
    id: `${pack}:${rel}`, pack, kind, res: `res://packs/${pack}/${rel}`, name, words: name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    tags: [], types, typeSource: types.length ? "name" : "none", condition: [], colorable: false, variantGroup: `${pack}:${name}`,
    size: [Math.round(fp[0] * 256), Math.round(fp[1] * 256)], trim: [0, 0, Math.round(fp[0] * 256), Math.round(fp[1] * 256)], footprint: fp,
    large: false, prefab: false, look: { meanLab: lab, chroma: Math.hypot(lab[1], lab[2]), colors: [], dhash: (n * 2654435761 >>> 0).toString(16).padStart(16, "0") },
  };
}

type Row = [role: string, name: string, fp: [number, number], facing: Facing, placement: Placement, extra?: Partial<VisionTag>];

/** One row per role the recipes and the exterior use. */
const OBJECTS: Row[] = [
  ["table_medium", "Table Wood", [1.5, 1], "none", "free"], ["table_long", "Table Long", [2.4, 1], "none", "free"], ["table_small", "Table Round", [1, 1], "none", "free"],
  ["table_set", "Table Set", [2.4, 2.4], "none", "free", { composite: true, seats: 4, contains: ["table_medium", "chair"] }],
  ["chair", "Chair Wood", [0.7, 0.7], "down", "free"], ["stool", "Stool", [0.6, 0.6], "none", "free"], ["bench", "Bench", [2, 0.6], "down", "free"],
  ["armchair", "Armchair", [1, 1], "down", "free"], ["sofa", "Sofa", [2, 1], "down", "wall"], ["side_table", "Nightstand", [0.6, 0.6], "down", "wall"],
  ["bed_double", "Bed", [1.6, 2.2], "down", "wall"], ["bed_single", "Bed Single", [1.1, 2], "down", "wall"], ["bar_counter", "Bar Counter", [4, 1], "down", "wall"],
  ["fireplace", "Fireplace", [2, 1], "down", "wall", { lit: true }], ["oven", "Oven", [1.4, 1.2], "down", "wall", { lit: true }], ["counter", "Counter", [2, 0.8], "down", "wall"],
  ["barrel", "Barrel", [0.8, 0.8], "none", "free"], ["crate", "Crate", [0.9, 0.9], "none", "free"], ["sack", "Sack", [0.6, 0.6], "none", "free"], ["basket", "Basket", [0.6, 0.6], "none", "free"],
  ["keg", "Keg", [0.8, 0.8], "none", "free"], ["pot_large", "Urn", [0.6, 0.6], "none", "free"], ["shelf", "Shelf", [2, 0.6], "down", "wall"], ["cabinet", "Cabinet", [1.2, 0.6], "down", "wall"],
  ["chest", "Chest", [1, 0.7], "down", "wall"], ["wardrobe", "Wardrobe", [1.5, 0.7], "down", "wall"], ["dresser", "Dresser", [1.3, 0.6], "down", "wall"], ["bookshelf", "Bookshelf", [2, 0.6], "down", "wall"],
  ["desk", "Desk", [1.6, 0.9], "down", "wall"], ["workbench", "Workbench", [2, 0.9], "none", "free"], ["washbasin", "Washbasin", [0.8, 0.6], "down", "wall"],
  ["rug", "Rug", [2, 1.5], "none", "rug"], ["runner", "Runner", [4, 1], "none", "rug"], ["fur", "Fur", [1.6, 1.2], "none", "rug"],
  ["mug", "Tankard", [0.3, 0.3], "none", "surface"], ["plate", "Plate", [0.4, 0.4], "none", "surface"], ["food", "Bread", [0.4, 0.3], "none", "surface"], ["bottle", "Bottle", [0.3, 0.3], "none", "surface"],
  ["cookware", "Pot", [0.4, 0.4], "none", "surface"], ["book", "Book", [0.4, 0.3], "none", "surface"], ["scroll", "Scroll", [0.4, 0.3], "none", "surface"],
  ["candle", "Candle", [0.3, 0.3], "none", "surface", { lit: true }], ["candelabra", "Candelabra", [0.6, 0.6], "none", "free", { lit: true }],
  ["sconce", "Sconce", [0.5, 0.4], "down", "wallmount", { lit: true }], ["lantern", "Lantern", [0.5, 0.5], "none", "free", { lit: true }], ["chandelier", "Chandelier", [1.5, 1.5], "none", "overhead", { lit: true }],
  ["cobweb", "Cobweb", [1, 1], "none", "decal"], ["dirt", "Dirt", [1.2, 1], "none", "decal"], ["grime", "Grime", [1, 1], "none", "decal"], ["stain", "Stain", [0.8, 0.6], "none", "decal"],
  ["corpse", "Corpse", [1, 1.8], "none", "free"], ["altar", "Altar", [2, 1], "down", "wall"], ["pew", "Pew", [3, 0.8], "down", "free"], ["statue", "Statue", [1, 1], "down", "free"],
  ["coffin", "Coffin", [0.9, 2], "none", "free"], ["sarcophagus", "Sarcophagus", [1.2, 2.4], "none", "free"], ["pillar", "Pillar", [0.8, 0.8], "none", "free"],
  ["gravestone", "Gravestone", [0.8, 0.5], "down", "outdoor"], ["grave", "Grave", [1, 2], "none", "decal"], ["bones", "Bones", [0.8, 0.6], "none", "decal"], ["debris", "Debris", [0.8, 0.8], "none", "decal"],
  ["tree", "Tree", [3, 3], "none", "outdoor"], ["dead_tree", "Dead Tree", [3, 3], "none", "outdoor"], ["bush", "Bush", [1.2, 1.2], "none", "outdoor"], ["rock", "Rock", [0.8, 0.8], "none", "outdoor"],
  ["grass", "Grass Tuft", [0.8, 0.8], "none", "decal"], ["flowers", "Flowers", [0.8, 0.8], "none", "decal"], ["mushroom", "Mushroom", [0.4, 0.4], "none", "outdoor"],
  // Gallery, gates and wrecks.
  ["painting", "Framed Painting", [1, 0.4], "down", "wallmount", { note: "framed painting drawn face-on" }], ["armor_stand", "Suit of Armor", [0.8, 0.8], "down", "free"],
  ["brazier", "Brazier", [0.8, 0.8], "none", "free", { lit: true }], ["scorch", "Scorch 2 - 1x1", [0.95, 0.9], "none", "decal"], ["crack", "Crack Stone", [1, 1], "none", "decal"],
  ["runner", "Long Runner", [8, 1.4], "none", "rug", { tone: "tintable" }], ["rug_torn", "Rug - Torn Runner", [4.2, 1.35], "none", "rug", { tone: "tintable", condition: "broken" }],
  ["gate", "Gate - Iron - Broken", [1.9, 1.3], "none", "wallmount", { condition: "broken" }],
];

const MATERIALS: Array<[AssetRecord["kind"], string, [number, number], MaterialTag["use"]]> = [
  ["wall", "Wall - Stone A_wall", [4, 0.3], "wall_stone"], ["wall", "Wall - Wood A_wall", [4, 0.3], "wall_wood"], ["portal", "Door Wood", [1, 0.3], "door"], ["portal", "Window Wood", [1, 0.3], "window"],
  ["pattern", "Texture - Wood Floor", [4, 4], "floor_wood"], ["pattern", "Texture - Stone Floor", [4, 4], "floor_stone"],
  ["terrain", "Lush Grass - 10x10", [10, 10], "grass"], ["terrain", "Texture - Dirt - 10x10", [10, 10], "dirt"], ["terrain", "Mud - 10x10", [10, 10], "mud"],
  ["portal", "Gate, double door", [2.3, 0.5], "gate"], ["path", "Ribbon - Cobble Road", [4, 1], "road_cobble"], ["path", "Ribbon - Dirt Road", [4, 1], "road_dirt"], ["path", "Fence Wood", [4, 0.4], "fence_wood"], ["path", "Fence Iron", [4, 0.4], "fence_iron"],
];

export function testIndex(): AssetIndex {
  n = 0;
  const assets: AssetRecord[] = [];
  const tones: Record<string, string> = { PACKA: "medium", PACKB: "dark", PACKC: "dark" };
  for (const [role, name, fp, facing, placement, extra] of OBJECTS) {
    for (const [pack, lab] of [["PACKA", [40, 10, 20]], ["PACKB", [55, 6, 14]], ["PACKC", [35, 2, 4]]] as Array<[string, [number, number, number]]>) {
      const a = asset(pack, "object", `${name} ${pack.slice(-1)}`, [role], fp, lab);
      a.tag = { role, facing, placement, fit: 3, tone: tones[pack], style: "rustic", condition: "fine", ...extra };
      assets.push(a);
    }
  }
  const sci = asset("SCIFI", "object", "Space Chair", ["chair"], [0.7, 0.7], [60, 0, -20]);
  sci.tag = { role: "chair", facing: "down", placement: "free", fit: 3 };
  assets.push(sci);
  for (const [name, role, fp] of [["Warped Metal A", "debris", [1.8, 1.7]], ["Warped Metal B", "debris", [1.7, 1.4]], ["Wires A", "debris", [1.5, 1.3]], ["Wall - Top-Down - Door - Small", "door", [1.1, 0.7]]] as Array<[string, string, [number, number]]>) {
    const a = asset("SCIFI", "object", name, [], fp, [50, -5, -15]);
    a.tag = { role, facing: "none", placement: "free", fit: 0, style: "scifi", condition: "broken" };
    assets.push(a);
  }
  // A framed gate: the open frame and the same art with its leaves shut.
  for (const name of ["Gate - Iron - Door (Open)", "Gate - Iron - Door (Closed)"]) {
    const a = asset("DEPTH", "object", name, [], [3.8, 1.75], [25, 0, 0]);
    a.size = [1106, 530];
    a.trim = [60, 17, 916, 440];
    a.tag = { role: "gate", facing: "down", placement: "wall", fit: 3, style: "gothic", tone: "dark" };
    assets.push(a);
  }
  // Shopfronts (city/storefront.ts) by their 2MT names, on roles no recipe asks for: a sign with its
  // Colorable twin, goods tables, a doormat, the shops' terracotta tiles.
  const sign = asset("STORE", "object", "Tavern Sign 1 - Blank", [], [1.3, 1], [40, 20, 25]);
  sign.tag = { role: "shop_sign", facing: "none", placement: "wall", fit: 3 };
  const twin = asset("STORE", "object", "Tavern Sign 1 - Blank - Colorable", [], [1.3, 1], [60, 0, 0]);
  Object.assign(twin, { colorable: true, colorableOf: sign.id });
  twin.tag = { role: "shop_sign", facing: "none", placement: "wall", fit: 3 };
  assets.push(sign, twin);
  for (const [name, fp] of [["Stall - Butcher", [1.8, 0.95]], ["Stall - Potions", [2.05, 1.05]], ["Stall - Chests", [1, 0.95]], ["Stall - Crystals", [0.9, 0.95]], ["Stall - Produce 2.0", [2.25, 0.8]], ["Stall - Blacksmith 1.0", [2.75, 1.1]], ["Stall - Weapons 1", [1.1, 1]], ["Display - Bread 1", [0.9, 1.4]], ["Rug - Doormat 1", [0.75, 0.5]]] as Array<[string, [number, number]]>) {
    const a = asset("STORE", "object", name, [], fp, [50, 15, 25]);
    a.tag = { role: name.startsWith("Rug") ? "doormat" : "stall_goods", facing: "none", placement: "free", fit: 3 };
    assets.push(a);
  }
  assets.push(asset("STORE", "pattern", "Texture - Greek Tiles - Terracotta 1", [], [4, 4], [55, 25, 30]));
  for (const [kind, name, fp, use] of MATERIALS) {
    const a = asset("PACKA", kind, name, [], fp, [45, 8, 14]);
    a.mat = { use, fit: 3, tone: "medium", style: "rustic" };
    assets.push(a);
  }
  // One lookalike group per (role, pack), as the real index has.
  const lookGroups: LookGroupRecord[] = [];
  const byKey = new Map<string, LookGroupRecord>();
  for (const a of assets) {
    if (a.kind !== "object") continue;
    const key = `${a.types[0]}|${a.pack}`;
    let g = byKey.get(key);
    if (!g) {
      g = { id: `${a.types[0]}:${byKey.size + 1}`, type: a.types[0]!, members: [], meanLab: a.look!.meanLab, families: ["2MT"], condition: [] };
      byKey.set(key, g);
      lookGroups.push(g);
    }
    g.members.push(a.id);
    a.lookGroup = g.id;
  }
  return { schema: 1, builtAt: "2026-11-06T00:00:00Z", root: "test", packs: PACKS, assets, lookGroups };
}

const sq = (x: number, y: number, s: number) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
/** A small walled town in MFCG's GeoJSON shape (y up): houses in rows, a square, a castle, a road through a gate, piers. */
export function townJson() {
  const houses: number[][][][] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) houses.push([sq(-90 + i * 26, -60 + j * 30, i === 5 && j === 3 ? 30 : 18)]);
  houses.push([sq(-20, 95, 40)]); // the keep, in the castle
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "values", roadWidth: 8, towerRadius: 6, wallThickness: 6 },
      { type: "Polygon", id: "earth", coordinates: [sq(-300, -300, 600)] },
      { type: "GeometryCollection", id: "roads", geometries: [{ type: "LineString", width: 8, coordinates: [[-250, 0], [-120, 0], [0, 0]] }] },
      { type: "GeometryCollection", id: "walls", geometries: [{ type: "Polygon", width: 6, coordinates: [sq(-120, -120, 240)] }, { type: "Polygon", width: 6, coordinates: [sq(-40, 80, 80)] }] },
      { type: "GeometryCollection", id: "rivers", geometries: [] },
      { type: "GeometryCollection", id: "planks", geometries: [{ type: "LineString", width: 4, coordinates: [[100, -110], [140, -110]] }, { type: "LineString", width: 4, coordinates: [[100, -95], [140, -95]] }] },
      { type: "MultiPolygon", id: "buildings", coordinates: houses },
      { type: "MultiPolygon", id: "prisms", coordinates: [[sq(-2, 52, 4)]] },
      { type: "MultiPolygon", id: "squares", coordinates: [[sq(-30, 30, 50)]] },
      { type: "MultiPolygon", id: "greens", coordinates: [] },
      { type: "MultiPolygon", id: "fields", coordinates: [] },
      { type: "MultiPoint", id: "trees", coordinates: [[-200, 150]] },
      { type: "GeometryCollection", id: "districts", geometries: [{ type: "Polygon", name: "Castle", coordinates: [sq(-40, 80, 80)] }, { type: "Polygon", name: "Old Town", coordinates: [sq(-120, -120, 240)] }] },
      { type: "MultiPolygon", id: "water", coordinates: [[sq(120, -300, 200)]] },
    ],
  };
}
