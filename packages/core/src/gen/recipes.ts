/**
 * Room recipes: what goes in each room type, as an ordered list of steps the dressing
 * engine (dress.ts) runs. Roles are vision-tag roles (tools/vision/ROLES.md). Counts scale
 * with room area; the DM's directives can change or remove any step.
 *
 * The recipes copy what 2MT's own furnished maps do: walls lined with storage and work
 * surfaces, furniture in groups (tables with chairs, a hearth with seating), things on
 * every surface, rugs under groups, grime along edges, and many small lights.
 */

import type { Wear } from "./style";

export type Weighted = Array<[string, number]>;

/** Items put on top of a surface piece. */
export interface SurfaceSpec {
  items: Weighted;
  /** Items per square of top area. */
  density: number;
  /** A lit candle or lantern on top, with this probability. */
  candle?: number;
  /** Largest item side as a share of the surface's short side (default 0.6); shops stack bigger goods. */
  fill?: number;
}

interface StepBase {
  id: string;
  /** Runs before the DM's pins: the piece that makes the room what it is. */
  essential?: boolean;
  /** Run only at these wear levels. */
  wear?: Wear[];
  /** Run with this probability. */
  p?: number;
  /** Skip in rooms smaller than this many squares. */
  minArea?: number;
}

/** A big piece against a wall, with optional company (rug, seats facing it, flanking pieces). */
export interface AnchorStep extends StepBase {
  kind: "anchor";
  roles: string[];
  wall: "far" | "exterior" | "interior" | "any";
  at?: "center" | "random";
  count?: [number, number];
  /** Distance from the wall (squares), e.g. a free-standing altar. */
  gap?: number;
  rug?: { roles: string[]; p: number };
  flank?: { roles: string[]; p: number };
  seats?: { roles: string[]; n: [number, number]; dist: number; p: number };
  surface?: SurfaceSpec;
  /** Prefer composite (artist-made group) pieces. */
  composite?: boolean;
}

/** A bar counter with a walkway, back shelves and stools. */
export interface BarStep extends StepBase {
  kind: "bar";
  back: Weighted;
  surface: SurfaceSpec;
}

export type GroupKind = "composite" | "square" | "round" | "long" | "desk" | "lounge" | "pair";

/** Seating groups (tables with chairs) spread over the open floor. */
export interface GroupsStep extends StepBase {
  kind: "groups";
  /** Groups per square of room area. */
  perArea: number;
  count?: [number, number];
  kinds: Array<[GroupKind, number]>;
  /** Free space kept around each group (squares). */
  aisle: number;
  rug?: number;
  surface?: SurfaceSpec;
  /** Seat roles for assembled groups, weighted. */
  seats?: Weighted;
}

/** Pieces lined up along the walls. */
export interface LineStep extends StepBase {
  kind: "line";
  roles: Weighted;
  /** Fraction of free wall length to fill: [min, max]. */
  coverage: [number, number];
  walls?: "all" | "exterior" | "interior";
  surface?: SurfaceSpec;
  /** Roles placed as small clusters (2 to 3 together). */
  clusters?: string[];
  /** Small pieces that fill leftover wall gaps after the main run. */
  fill?: Weighted;
  /** Distance from the wall: a second row in front of the first. */
  gap?: number;
}

export interface CornersStep extends StepBase {
  kind: "corners";
  roles: Weighted;
  /** Chance per free corner. */
  chance: number;
}

/** Rows of pieces facing the far wall (pews, beds, sarcophagi) with a center aisle. */
export interface RowsStep extends StepBase {
  kind: "rows";
  roles: string[];
  /** Squares kept free in front of the far wall and at the entrance end. */
  front: number;
  back: number;
  aisle: number;
  /** Gap between rows. */
  gap: number;
  runner?: boolean;
}

export interface CenterStep extends StepBase {
  kind: "center";
  roles: string[];
  rug?: { roles: string[]; p: number };
  seats?: { roles: string[]; n: [number, number]; dist: number; p: number };
}

export interface DecalsStep extends StepBase {
  kind: "decals";
  roles: Weighted;
  /** Decals per square. */
  perArea: number;
  where: "edges" | "corners" | "doors" | "anywhere";
}

export interface ScatterStep extends StepBase {
  kind: "scatter";
  roles: Weighted;
  perArea: number;
  where: "edges" | "anywhere";
}

/** Wall lights every few squares. */
export interface SconcesStep extends StepBase {
  kind: "sconces";
  roles: string[];
  every: number;
}

/** Pillars in a ring a few squares in from the walls. */
export interface ColonnadeStep extends StepBase {
  kind: "colonnade";
  roles: string[];
  every: number;
  inset: number;
}

/** A hanging light over the room center. */
export interface OverheadStep extends StepBase {
  kind: "overhead";
  roles: string[];
}

/** One long carpet down the room's long axis, door to door (worn ones fray, tear and gap). */
export interface RunnerStep extends StepBase {
  kind: "runner";
  /** Carpet width as a fraction of the room's short side. */
  width: number;
}

/**
 * A gallery: art hung along both long walls in mirrored pairs, with free-standing pieces
 * (statues, armor) between them and wall lights in the rhythm.
 */
export interface GalleryStep extends StepBase {
  kind: "gallery";
  /** Hung pieces (wallmount). */
  art: string[];
  /** Pieces standing against the wall between the art. */
  stands: Weighted;
  /** Squares from one painting to the next. */
  every: number;
  lights: string[];
}

export type Step = AnchorStep | BarStep | GroupsStep | LineStep | CornersStep | RowsStep | CenterStep | DecalsStep | ScatterStep | SconcesStep | OverheadStep | ColonnadeStep | RunnerStep | GalleryStep;

export interface Recipe {
  type: string;
  steps: Step[];
}

const TABLE_TOP: SurfaceSpec = { items: [["mug", 5], ["plate", 3], ["bottle", 2], ["food", 2], ["games", 1], ["cutlery", 1], ["coins", 0.5]], density: 1.3, candle: 0.55 };
const BAR_TOP: SurfaceSpec = { items: [["mug", 6], ["bottle", 4], ["plate", 2], ["food", 1], ["cookware", 1]], density: 1.4, candle: 0.4 };
const KITCHEN_TOP: SurfaceSpec = { items: [["food", 6], ["cookware", 4], ["plate", 2], ["bottle", 1], ["cutlery", 1]], density: 1.6 };
const SHELF_TOP: SurfaceSpec = { items: [["bottle", 3], ["food", 2], ["cookware", 1], ["pot_large", 1]], density: 1.0 };
const DESK_TOP: SurfaceSpec = { items: [["book", 4], ["scroll", 4], ["writing", 2], ["potion", 1], ["trinket", 1]], density: 1.4, candle: 0.7 };
const NIGHT_TOP: SurfaceSpec = { items: [["book", 2], ["mug", 1], ["trinket", 1]], density: 0.8, candle: 0.7 };
const ALTAR_TOP: SurfaceSpec = { items: [["book", 2], ["trinket", 2], ["skull", 1]], density: 0.8, candle: 0.9 };
const HOME_TOP: SurfaceSpec = { items: [["plate", 3], ["mug", 3], ["food", 3], ["cookware", 1], ["bottle", 1]], density: 1.1, candle: 0.5 };
const DINING_TOP: SurfaceSpec ={ items: [["plate", 5], ["mug", 4], ["food", 3], ["cutlery", 2], ["bottle", 1]], density: 1.6, candle: 0.8 };

const GRIME: DecalsStep = { kind: "decals", id: "grime", roles: [["grime", 4], ["dirt", 3], ["stain", 2], ["crack", 1]], perArea: 0.045, where: "edges" };
const GRIME_FLOOR: DecalsStep = { kind: "decals", id: "grime_floor", roles: [["dirt", 3], ["stain", 2], ["grime", 2]], perArea: 0.02, where: "anywhere" };
const DOOR_DIRT: DecalsStep = { kind: "decals", id: "door_dirt", roles: [["dirt", 3], ["mud", 1], ["grime", 1]], perArea: 0.03, where: "doors" };
const COBWEBS: DecalsStep = { kind: "decals", id: "cobwebs", roles: [["cobweb", 1]], perArea: 0.04, where: "corners", wear: ["lived-in", "grimy", "ruined"] };
const RUIN: ScatterStep = { kind: "scatter", id: "rubble", roles: [["debris", 4], ["bones", 1], ["paper_scatter", 1]], perArea: 0.05, where: "anywhere", wear: ["ruined"] };
const BLOOD: DecalsStep = { kind: "decals", id: "blood", roles: [["blood", 1]], perArea: 0.006, where: "edges", wear: ["grimy", "ruined"] };

/** The shop counter: across the back of the shop, a step off the wall so the keeper fits behind it, goods on top. */
function counter(items: Weighted): AnchorStep {
  return { kind: "anchor", id: "counter", essential: true, roles: ["counter", "table_long", "table_medium"], wall: "far", at: "center", gap: 1.1, surface: { items, density: 3.2, fill: 1, candle: 0.25 } };
}

/** A display table out on the shop floor, near a side wall. */
function display(items: Weighted): AnchorStep {
  return { kind: "anchor", id: "display", roles: ["table_medium", "table_small", "table_long"], wall: "any", at: "random", gap: 0.9, surface: { items, density: 3, fill: 1 }, p: 0.65, minArea: 15 };
}

/** A room of the services, the law, the underworld or the crafts: its steps, lights every few squares, the usual wear. */
function room(type: string, steps: Step[], light: string[] = ["candle", "lantern", "sconce"], every = 6): Recipe {
  return { type, steps: [...steps, { kind: "sconces", id: "light", roles: light, every }, GRIME, DOOR_DIRT, COBWEBS, RUIN] };
}

/** A shop room: a rug in the shop's colour on the floor, its own steps, then lights and the wear every room gets. */
function shop(trade: string, steps: Step[], opts: { light?: string[]; floorGrime?: number } = {}): Recipe {
  return {
    type: `shop.${trade}`,
    steps: [{ kind: "center", id: "shop_rug", roles: ["rug"], p: 0.9, minArea: 9 }, ...steps, { kind: "sconces", id: "light", roles: opts.light ?? ["candle", "lantern", "sconce"], every: 6 }, GRIME, ...(opts.floorGrime ? [{ ...GRIME_FLOOR, perArea: opts.floorGrime }] : []), DOOR_DIRT, COBWEBS, RUIN],
  };
}

export const RECIPES: Recipe[] = [
  {
    type: "tavern.common_room",
    steps: [
      { kind: "bar", id: "bar", essential: true, back: [["shelf", 5], ["keg", 3], ["barrel", 3], ["cabinet", 1]], surface: BAR_TOP },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "exterior", at: "random", rug: { roles: ["rug", "fur"], p: 0.7 }, seats: { roles: ["armchair", "bench", "chair"], n: [1, 2], dist: 1.7, p: 0.7 }, p: 0.85 },
      { kind: "anchor", id: "stairs", roles: ["stairs"], wall: "interior", at: "random", p: 0.55, minArea: 70 },
      { kind: "groups", id: "tables", perArea: 1 / 9, count: [3, 14], kinds: [["composite", 4], ["square", 3], ["round", 3], ["long", 2]], aisle: 0.55, rug: 0.3, surface: TABLE_TOP, seats: [["chair", 5], ["stool", 2], ["bench", 1]] },
      { kind: "line", id: "edges", roles: [["barrel", 3], ["crate", 2], ["bench", 1], ["table_small", 1], ["plant", 0.5], ["instrument", 0.3]], coverage: [0.1, 0.25], clusters: ["barrel", "crate"] },
      { kind: "sconces", id: "sconces", roles: ["sconce", "torch", "lantern"], every: 5 },
      { kind: "overhead", id: "chandelier", roles: ["chandelier"], minArea: 70, p: 0.6 },
      GRIME, GRIME_FLOOR, DOOR_DIRT, COBWEBS,
      { kind: "decals", id: "spills", roles: [["puddle", 2], ["stain", 2]], perArea: 0.02, where: "anywhere" },
      { kind: "scatter", id: "dropped", roles: [["mug", 2], ["food", 1], ["paper_scatter", 1], ["debris", 1]], perArea: 0.015, where: "anywhere", wear: ["lived-in", "grimy", "ruined"] },
      RUIN, BLOOD,
    ],
  },
  {
    type: "tavern.kitchen",
    steps: [
      { kind: "anchor", id: "oven", essential: true, roles: ["oven", "fireplace"], wall: "exterior", at: "random", surface: { items: [["cookware", 1]], density: 0.5 } },
      { kind: "line", id: "counters", roles: [["counter", 6], ["shelf", 3], ["cabinet", 2], ["barrel", 2], ["sack", 1.5], ["crate", 1.5], ["rack", 1]], coverage: [0.65, 0.85], surface: KITCHEN_TOP, clusters: ["barrel", "sack", "crate"], fill: [["sack", 3], ["basket", 2], ["barrel", 2], ["pot_large", 2], ["crate", 1]] },
      { kind: "center", id: "prep", roles: ["workbench", "counter", "table_long", "table_medium"], p: 0.9, minArea: 16 },
      { kind: "scatter", id: "supplies", roles: [["sack", 2], ["basket", 2], ["food", 2], ["pot_large", 1]], perArea: 0.06, where: "edges" },
      { kind: "corners", id: "corners", roles: [["barrel", 3], ["sack", 2], ["basket", 1], ["pot_large", 1]], chance: 0.6 },
      { kind: "sconces", id: "lights", roles: ["lantern", "sconce", "candle"], every: 6 },
      GRIME, { ...GRIME_FLOOR, perArea: 0.035 }, DOOR_DIRT, COBWEBS,
      { kind: "scatter", id: "kitchen_mess", roles: [["food", 3], ["cookware", 1], ["straw", 1]], perArea: 0.03, where: "edges" },
      RUIN, BLOOD,
    ],
  },
  {
    type: "tavern.storage",
    steps: [
      { kind: "line", id: "stores", roles: [["shelf", 3], ["crate", 4], ["barrel", 4], ["sack", 3], ["rack", 1], ["chest", 1], ["basket", 1]], coverage: [0.75, 0.95], surface: SHELF_TOP, clusters: ["crate", "barrel", "sack"], fill: [["crate", 3], ["sack", 3], ["barrel", 2], ["basket", 1], ["pot_large", 1]] },
      { kind: "line", id: "stores2", roles: [["crate", 3], ["barrel", 3], ["sack", 3], ["basket", 1]], coverage: [0.3, 0.55], gap: 0.95, clusters: ["crate", "barrel", "sack"] },
      { kind: "center", id: "pile", roles: ["crate", "barrel", "sack"], p: 0.5, minArea: 14 },
      { kind: "corners", id: "corners", roles: [["barrel", 2], ["crate", 2], ["sack", 1]], chance: 0.7 },
      { kind: "sconces", id: "light", roles: ["lantern", "candle", "sconce"], every: 8 },
      GRIME, GRIME_FLOOR, COBWEBS,
      { kind: "scatter", id: "straw", roles: [["straw", 3], ["debris", 1], ["food", 1]], perArea: 0.05, where: "anywhere" },
      RUIN,
    ],
  },
  {
    type: "tavern.guest_room",
    steps: [
      { kind: "anchor", id: "bed", essential: true, roles: ["bed_double", "bed_single"], wall: "far", at: "random", flank: { roles: ["side_table"], p: 0.8 }, rug: { roles: ["rug", "fur", "mat"], p: 0.6 } },
      { kind: "line", id: "furniture", roles: [["chest", 3], ["wardrobe", 2], ["dresser", 2], ["washbasin", 1], ["chair", 1], ["table_small", 1]], coverage: [0.25, 0.45], surface: NIGHT_TOP },
      { kind: "sconces", id: "candle", roles: ["candle", "sconce", "lantern"], every: 8 },
      GRIME, COBWEBS,
      { kind: "scatter", id: "belongings", roles: [["book", 1], ["trinket", 1], ["mug", 1], ["paper_scatter", 1]], perArea: 0.03, where: "edges" },
      RUIN, BLOOD,
    ],
  },
  {
    type: "tavern.cellar",
    steps: [
      { kind: "line", id: "racks", roles: [["barrel", 5], ["keg", 3], ["rack", 3], ["crate", 3], ["sack", 2], ["shelf", 1]], coverage: [0.7, 0.9], surface: SHELF_TOP, clusters: ["barrel", "crate", "sack"], fill: [["barrel", 3], ["crate", 2], ["sack", 2]] },
      { kind: "line", id: "racks2", roles: [["barrel", 4], ["crate", 3], ["sack", 2]], coverage: [0.25, 0.45], gap: 1.05, clusters: ["barrel", "crate", "sack"] },
      { kind: "corners", id: "corners", roles: [["barrel", 3], ["crate", 2]], chance: 0.8 },
      { kind: "center", id: "casks", roles: ["barrel", "keg", "crate"], p: 0.6, minArea: 20 },
      { kind: "sconces", id: "light", roles: ["torch", "lantern", "sconce"], every: 7 },
      { ...GRIME, perArea: 0.07 }, { ...GRIME_FLOOR, perArea: 0.04 }, COBWEBS,
      { kind: "decals", id: "damp", roles: [["puddle", 2], ["moss", 1]], perArea: 0.02, where: "edges" },
      RUIN,
    ],
  },
  {
    type: "gothic.nave",
    steps: [
      { kind: "anchor", id: "altar", essential: true, roles: ["altar", "shrine"], wall: "far", at: "center", gap: 1.2, flank: { roles: ["candelabra"], p: 0.9 }, rug: { roles: ["rug", "runner"], p: 0.5 }, surface: ALTAR_TOP },
      { kind: "rows", id: "pews", roles: ["pew", "bench"], front: 3.4, back: 1.6, aisle: 1.8, gap: 0.55, runner: true },
      { kind: "line", id: "edges", roles: [["statue", 2], ["candelabra", 2], ["font", 1], ["lectern", 1], ["banner", 1]], coverage: [0.08, 0.18] },
      { kind: "sconces", id: "sconces", roles: ["sconce", "torch", "candle"], every: 4 },
      { kind: "overhead", id: "chandelier", roles: ["chandelier"], minArea: 90, p: 0.5 },
      { ...GRIME, perArea: 0.04 }, GRIME_FLOOR, DOOR_DIRT, COBWEBS,
      { kind: "scatter", id: "rubble", roles: [["debris", 4], ["bones", 1], ["book", 0.5], ["paper_scatter", 1]], perArea: 0.05, where: "anywhere", wear: ["grimy", "ruined"] },
      BLOOD,
    ],
  },
  {
    type: "gothic.crypt",
    steps: [
      { kind: "anchor", id: "shrine", essential: true, roles: ["altar", "statue", "shrine"], wall: "far", at: "center", gap: 0.6, flank: { roles: ["candelabra", "brazier"], p: 0.9 } },
      { kind: "line", id: "tombs", roles: [["sarcophagus", 4], ["coffin", 3], ["tomb", 1]], coverage: [0.55, 0.75], walls: "all" },
      { kind: "center", id: "runner", roles: ["runner", "rug"], p: 0.6 },
      { kind: "line", id: "niches", roles: [["bones", 2], ["pot_large", 1], ["candelabra", 2], ["skull", 1]], coverage: [0.15, 0.3], clusters: ["bones"] },
      { kind: "sconces", id: "light", roles: ["torch", "candle", "sconce", "brazier"], every: 5 },
      { ...GRIME, perArea: 0.08 }, { ...GRIME_FLOOR, perArea: 0.05 }, COBWEBS,
      { kind: "scatter", id: "bones", roles: [["bones", 3], ["skull", 2], ["debris", 2]], perArea: 0.04, where: "anywhere" },
      BLOOD,
    ],
  },
  {
    type: "gothic.vestry",
    steps: [
      { kind: "line", id: "cupboards", roles: [["wardrobe", 2], ["cabinet", 2], ["bookshelf", 2], ["chest", 2], ["shelf", 1]], coverage: [0.5, 0.7], surface: { items: [["book", 2], ["candle", 1], ["trinket", 1]], density: 0.8 } },
      { kind: "center", id: "table", roles: ["table_medium", "desk", "table_small"], p: 0.7 },
      { kind: "sconces", id: "light", roles: ["candle", "sconce", "candelabra"], every: 6 },
      GRIME, COBWEBS, RUIN,
    ],
  },
  {
    type: "gothic.study",
    steps: [
      { kind: "anchor", id: "desk", roles: ["desk"], wall: "exterior", at: "random", gap: 0.9, seats: { roles: ["chair", "armchair"], n: [1, 1], dist: -0.2, p: 0.95 }, surface: DESK_TOP },
      { kind: "line", id: "books", roles: [["bookshelf", 6], ["cabinet", 1], ["display_case", 1], ["globe", 0.5], ["clock", 0.5]], coverage: [0.55, 0.8], surface: { items: [["book", 2], ["trinket", 1]], density: 0.4 } },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "any", at: "random", rug: { roles: ["rug", "fur"], p: 0.8 }, seats: { roles: ["armchair", "sofa"], n: [1, 2], dist: 1.8, p: 0.8 }, p: 0.6 },
      { kind: "sconces", id: "light", roles: ["candle", "sconce", "candelabra"], every: 5 },
      GRIME, COBWEBS,
      { kind: "scatter", id: "papers", roles: [["book", 2], ["scroll", 2], ["paper_scatter", 2]], perArea: 0.05, where: "anywhere" },
      RUIN, BLOOD,
    ],
  },
  {
    type: "gothic.bedroom",
    steps: [
      { kind: "anchor", id: "bed", essential: true, roles: ["bed_double", "bed_single"], wall: "far", at: "center", flank: { roles: ["side_table"], p: 0.9 }, rug: { roles: ["rug", "fur"], p: 0.8 } },
      { kind: "anchor", id: "chest", roles: ["chest"], wall: "any", at: "random", p: 0.7 },
      { kind: "groups", id: "sitting", perArea: 1 / 40, count: [0, 1], kinds: [["lounge", 1]], aisle: 0.5, rug: 0.4, minArea: 20 },
      { kind: "line", id: "furniture", roles: [["wardrobe", 3], ["dresser", 3], ["chest", 1], ["mirror", 1], ["washbasin", 1], ["bookshelf", 1], ["desk", 1]], coverage: [0.45, 0.65], surface: NIGHT_TOP },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "any", at: "random", p: 0.5 },
      { kind: "sconces", id: "light", roles: ["candle", "sconce", "candelabra"], every: 6 },
      GRIME, COBWEBS, RUIN, BLOOD,
    ],
  },
  {
    type: "gothic.ballroom",
    steps: [
      { kind: "anchor", id: "stage", roles: ["instrument_large"], wall: "far", at: "center", p: 0.8, rug: { roles: ["rug"], p: 0.6 } },
      { kind: "anchor", id: "buffet", roles: ["table_long", "table_medium"], wall: "interior", at: "random", gap: 0.3, surface: DINING_TOP, p: 0.8 },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "exterior", at: "random", p: 0.6, rug: { roles: ["rug", "fur"], p: 0.7 } },
      { kind: "colonnade", id: "pillars", roles: ["pillar", "statue"], every: 4, inset: 2.2, minArea: 80 },
      { kind: "groups", id: "lounges", perArea: 1 / 30, count: [2, 6], kinds: [["lounge", 1]], aisle: 0.6, rug: 0.5 },
      { kind: "line", id: "seating", roles: [["sofa", 2], ["armchair", 3], ["table_small", 2], ["plant", 2], ["statue", 1], ["candelabra", 2], ["display_case", 1]], coverage: [0.3, 0.45] },
      { kind: "center", id: "dance", roles: ["rug"], p: 0.5 },
      { kind: "overhead", id: "chandelier", roles: ["chandelier"] },
      { kind: "sconces", id: "light", roles: ["sconce", "candle", "candelabra"], every: 4 },
      GRIME, COBWEBS, RUIN, BLOOD,
    ],
  },
  {
    type: "gothic.dining",
    steps: [
      { kind: "center", id: "table", essential: true, roles: ["table_long"], seats: { roles: ["chair"], n: [6, 10], dist: 0, p: 1 } },
      { kind: "line", id: "sideboards", roles: [["cabinet", 3], ["dresser", 2], ["candelabra", 2], ["statue", 1], ["painting", 1]], coverage: [0.3, 0.5], surface: DINING_TOP },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "any", at: "center", p: 0.7 },
      { kind: "sconces", id: "light", roles: ["sconce", "candle"], every: 5 },
      GRIME, COBWEBS, RUIN, BLOOD,
    ],
  },
  {
    type: "gothic.hall",
    steps: [
      { kind: "center", id: "rug", roles: ["runner", "rug"], p: 0.95 },
      { kind: "anchor", id: "hearth", roles: ["fireplace"], wall: "any", at: "center", p: 0.4, rug: { roles: ["rug", "fur"], p: 0.5 } },
      { kind: "line", id: "decor", roles: [["bench", 3], ["side_table", 2], ["statue", 2], ["armor_stand", 2], ["candelabra", 2], ["plant", 1], ["display_case", 1], ["painting", 1], ["clock", 1]], coverage: [0.45, 0.65], surface: { items: [["candle", 2], ["book", 1], ["trinket", 2]], density: 0.8 } },
      { kind: "overhead", id: "chandelier", roles: ["chandelier"], minArea: 20, p: 0.8 },
      { kind: "sconces", id: "light", roles: ["sconce", "torch", "candle"], every: 4 },
      GRIME, DOOR_DIRT, COBWEBS, RUIN, BLOOD,
    ],
  },
  {
    type: "gothic.gallery",
    steps: [
      { kind: "runner", id: "runner", essential: true, width: 0.3 },
      { kind: "gallery", id: "art", essential: true, art: ["painting", "banner"], stands: [["statue", 3], ["armor_stand", 2], ["candelabra", 1]], every: 3.2, lights: ["sconce", "torch", "candelabra"] },
      GRIME, DOOR_DIRT, COBWEBS, RUIN, BLOOD,
      { kind: "decals", id: "worn_path", roles: [["dirt", 3], ["stain", 2], ["grime", 1]], perArea: 0.015, where: "anywhere" },
    ],
  },
  // The hall under a sundial tower (gen/sundial.ts puts the dial, the device and the face in it): bare stone, pillars, a few lights.
  {
    type: "gothic.vestibule",
    steps: [
      { kind: "colonnade", id: "pillars", roles: ["pillar"], every: 4, inset: 1.2 },
      { kind: "sconces", id: "light", roles: ["sconce", "torch", "candle"], every: 4 },
      { kind: "corners", id: "corners", roles: [["pot_large", 1], ["crate", 1], ["bones", 1], ["candelabra", 2]], chance: 0.35 },
      GRIME, COBWEBS,
    ],
  },
  {
    type: "gothic.vault",
    steps: [
      { kind: "anchor", id: "relic", roles: ["sarcophagus", "chest", "statue", "altar"], wall: "far", at: "center", p: 0.6 },
      { kind: "corners", id: "corners", roles: [["pot_large", 2], ["crate", 1], ["bones", 2], ["candelabra", 1]], chance: 0.5 },
      { kind: "scatter", id: "rubble", roles: [["debris", 4], ["bones", 2], ["skull", 1]], perArea: 0.12, where: "anywhere" },
      GRIME, COBWEBS, BLOOD,
    ],
  },
  { type: "gothic.graveyard", steps: [] },
  // Town houses (street maps show them from inside): a one-room home, or a main room with a
  // bedroom and a workroom off it.
  {
    type: "house.home",
    steps: [
      { kind: "anchor", id: "hearth", essential: true, roles: ["fireplace", "oven"], wall: "exterior", at: "random", rug: { roles: ["rug", "fur", "mat"], p: 0.45 }, surface: { items: [["cookware", 1]], density: 0.5 }, p: 0.85 },
      { kind: "anchor", id: "bed", essential: true, roles: ["bed_single", "bed_double", "cot"], wall: "far", at: "random", flank: { roles: ["side_table", "chest"], p: 0.35 } },
      { kind: "groups", id: "table", perArea: 1 / 30, count: [1, 1], kinds: [["square", 3], ["round", 2], ["composite", 1]], aisle: 0.35, surface: HOME_TOP, seats: [["stool", 3], ["chair", 3], ["bench", 1]] },
      { kind: "line", id: "household", roles: [["shelf", 3], ["chest", 2], ["barrel", 2], ["sack", 2], ["cabinet", 1], ["washbasin", 1], ["basket", 1], ["pot_large", 1]], coverage: [0.2, 0.4], surface: SHELF_TOP, clusters: ["barrel", "sack"] },
      { kind: "sconces", id: "light", roles: ["candle", "lantern", "sconce"], every: 7 },
      GRIME, COBWEBS, RUIN,
    ],
  },
  {
    type: "house.living",
    steps: [
      { kind: "anchor", id: "hearth", essential: true, roles: ["fireplace", "oven"], wall: "exterior", at: "random", rug: { roles: ["rug", "fur", "mat"], p: 0.55 }, seats: { roles: ["chair", "bench", "stool"], n: [1, 2], dist: 1.5, p: 0.5 }, surface: { items: [["cookware", 1]], density: 0.5 } },
      { kind: "groups", id: "table", perArea: 1 / 24, count: [1, 2], kinds: [["square", 2], ["round", 2], ["long", 1], ["composite", 1]], aisle: 0.4, rug: 0.25, surface: HOME_TOP, seats: [["chair", 3], ["stool", 2], ["bench", 2]] },
      { kind: "line", id: "household", roles: [["shelf", 3], ["cabinet", 2], ["counter", 1], ["barrel", 2], ["sack", 2], ["chest", 1], ["basket", 1], ["pot_large", 1]], coverage: [0.3, 0.5], surface: SHELF_TOP, clusters: ["barrel", "sack"] },
      { kind: "sconces", id: "light", roles: ["candle", "lantern", "sconce"], every: 6 },
      GRIME, DOOR_DIRT, COBWEBS, RUIN,
    ],
  },
  {
    type: "house.bedroom",
    steps: [
      { kind: "anchor", id: "bed", essential: true, roles: ["bed_double", "bed_single"], wall: "far", at: "random", count: [1, 2], flank: { roles: ["side_table"], p: 0.5 }, rug: { roles: ["rug", "fur", "mat"], p: 0.5 } },
      { kind: "anchor", id: "chest", roles: ["chest"], wall: "any", at: "random", p: 0.6 },
      { kind: "line", id: "furniture", roles: [["wardrobe", 2], ["dresser", 2], ["chest", 2], ["washbasin", 1], ["chair", 1]], coverage: [0.2, 0.4], surface: NIGHT_TOP },
      { kind: "sconces", id: "candle", roles: ["candle", "lantern"], every: 8 },
      GRIME, COBWEBS, RUIN,
    ],
  },
  {
    type: "house.workroom",
    steps: [
      { kind: "center", id: "bench", essential: true, roles: ["workbench", "table_medium", "counter"] },
      { kind: "line", id: "tools", roles: [["rack", 3], ["tool", 3], ["shelf", 2], ["crate", 2], ["barrel", 2], ["sack", 1], ["woodpile", 1]], coverage: [0.4, 0.6], surface: { items: [["tool", 2], ["cookware", 1]], density: 0.6 }, clusters: ["crate", "barrel"] },
      { kind: "corners", id: "corners", roles: [["barrel", 2], ["crate", 2], ["sack", 1]], chance: 0.5 },
      { kind: "sconces", id: "light", roles: ["lantern", "candle"], every: 7 },
      GRIME, GRIME_FLOOR, COBWEBS, RUIN,
      { kind: "scatter", id: "shavings", roles: [["debris", 2], ["dirt", 1]], perArea: 0.03, where: "anywhere" },
    ],
  },
  {
    type: "house.smithy",
    steps: [
      { kind: "anchor", id: "forge", essential: true, roles: ["forge", "fireplace"], wall: "exterior", at: "random" },
      { kind: "center", id: "anvil", essential: true, roles: ["anvil"] },
      { kind: "line", id: "tools", roles: [["rack", 3], ["tool", 3], ["grindstone", 1], ["barrel", 2], ["crate", 1], ["armor_stand", 1]], coverage: [0.35, 0.55], clusters: ["barrel"] },
      { kind: "sconces", id: "light", roles: ["lantern", "torch"], every: 7 },
      { ...GRIME, perArea: 0.07 }, { ...GRIME_FLOOR, perArea: 0.04 }, RUIN,
      { kind: "decals", id: "soot", roles: [["scorch", 2], ["dirt", 1]], perArea: 0.03, where: "anywhere" },
    ],
  },
  {
    type: "house.weaver",
    steps: [
      { kind: "anchor", id: "loom", essential: true, roles: ["loom", "spinning_wheel"], wall: "exterior", at: "random", gap: 0.3, count: [1, 2] },
      { kind: "line", id: "stores", roles: [["basket", 3], ["shelf", 2], ["sack", 2], ["chest", 1], ["table_small", 1], ["stool", 1]], coverage: [0.3, 0.5], clusters: ["basket", "sack"] },
      { kind: "sconces", id: "light", roles: ["candle", "lantern"], every: 7 },
      GRIME, COBWEBS, RUIN,
    ],
  },
  // Shops: a counter across the back of the shop (the keeper stands behind it, facing the door),
  // the trade's goods on the counter, on shelves along the walls and on a display table.
  shop("blacksmith", [
    { kind: "anchor", id: "forge", essential: true, roles: ["forge", "fireplace", "brazier", "oven"], wall: "any", at: "random" },
    { kind: "center", id: "anvil", essential: true, roles: ["anvil", "grindstone"] },
    { kind: "line", id: "wares", roles: [["rack:weapons", 3], ["tool", 3], ["grindstone", 1], ["barrel", 2], ["crate", 1], ["armor_stand", 1]], coverage: [0.35, 0.55], clusters: ["barrel"] },
    { kind: "decals", id: "soot", roles: [["scorch", 2], ["dirt", 1]], perArea: 0.03, where: "anywhere" },
  ], { light: ["lantern", "torch"], floorGrime: 0.04 }),
  shop("armourer", [
    counter([["weapon", 4], ["trinket", 1], ["tool", 1]]),
    { kind: "line", id: "wares", roles: [["armor_stand", 4], ["rack:weapons", 4], ["display_case", 1], ["chest", 1]], coverage: [0.45, 0.7] },
    { kind: "center", id: "anvil", roles: ["anvil", "armor_stand"], p: 0.5, minArea: 20 },
  ]),
  shop("herbalist", [
    counter([["food:herbs", 5], ["potion", 2], ["bottle", 1]]),
    { kind: "line", id: "wares", roles: [["shelf", 4], ["basket", 2], ["plant", 2], ["cabinet", 1], ["pot_large", 1], ["sack", 1]], coverage: [0.45, 0.7], surface: { items: [["food:herbs", 4], ["potion", 2], ["bottle", 2], ["pot_large", 1]], density: 2.2, fill: 1 }, clusters: ["basket", "plant"] },
    display([["food:herbs", 4], ["potion", 1], ["plant", 1]]),
    { kind: "scatter", id: "leaves", roles: [["leaves", 2], ["food:herbs", 1]], perArea: 0.03, where: "edges" },
  ]),
  shop("potion_maker", [
    counter([["potion", 6], ["bottle", 2], ["book", 1]]),
    { kind: "anchor", id: "brew", essential: true, roles: ["alchemy:alchemy", "cauldron"], wall: "any", at: "random", gap: 0.4 },
    { kind: "line", id: "wares", roles: [["shelf", 4], ["bookshelf", 1], ["cabinet", 2], ["pot_large", 1]], coverage: [0.45, 0.7], surface: { items: [["potion", 5], ["bottle", 2], ["book", 1]], density: 2.4, fill: 1 } },
    { kind: "center", id: "cauldron", roles: ["cauldron"], p: 0.6, minArea: 16 },
  ]),
  shop("butcher", [
    { ...counter([["food:meat", 6], ["cutlery", 1]]), roles: ["counter:butcher", "counter", "table_long"] },
    { kind: "line", id: "wares", roles: [["counter:butcher", 2], ["barrel", 2], ["crate", 1], ["shelf", 1], ["sack", 1]], coverage: [0.3, 0.5], surface: { items: [["food:meat", 5], ["cutlery", 1]], density: 2.4, fill: 1 } },
    { kind: "decals", id: "blood", roles: [["blood", 2], ["stain", 2]], perArea: 0.03, where: "anywhere" },
  ], { floorGrime: 0.04 }),
  shop("fishmonger", [
    counter([["food:fish", 7]]),
    { kind: "line", id: "wares", roles: [["barrel", 4], ["crate", 3], ["basket", 2], ["counter", 1]], coverage: [0.4, 0.6], surface: { items: [["food:fish", 5]], density: 2.6, fill: 1 }, clusters: ["barrel", "crate"] },
    display([["food:fish", 5]]),
    { kind: "decals", id: "wet", roles: [["puddle", 3], ["stain", 1]], perArea: 0.04, where: "anywhere" },
  ]),
  shop("baker", [
    { kind: "anchor", id: "oven", essential: true, roles: ["oven", "fireplace"], wall: "exterior", at: "random" },
    counter([["food:bread", 7]]),
    { kind: "line", id: "wares", roles: [["shelf", 3], ["sack", 3], ["basket", 2], ["barrel", 1]], coverage: [0.35, 0.55], surface: { items: [["food:bread", 5], ["food", 1]], density: 2.4, fill: 1 }, clusters: ["sack"] },
    display([["food:bread", 5]]),
    { kind: "scatter", id: "flour", roles: [["stain", 1], ["dirt", 1]], perArea: 0.02, where: "anywhere" },
  ]),
  shop("merchant", [
    counter([["trinket", 2], ["bottle", 1], ["coins", 1], ["book", 1], ["mug", 1]]),
    { kind: "line", id: "wares", roles: [["crate", 3], ["barrel", 3], ["sack", 3], ["shelf", 3], ["chest", 1], ["basket", 1], ["rack", 1]], coverage: [0.5, 0.75], surface: { items: [["bottle", 2], ["trinket", 2], ["food", 1], ["pot_large", 1]], density: 2.0, fill: 1 }, clusters: ["crate", "barrel", "sack"] },
    { kind: "center", id: "pile", roles: ["crate", "barrel", "sack"], p: 0.6, minArea: 18 },
  ]),
  shop("tailor", [
    counter([["other:cloth", 4], ["trinket", 1]]),
    { kind: "line", id: "wares", roles: [["rack:clothes", 4], ["shelf", 2], ["chest", 1], ["loom", 1], ["wardrobe", 1]], coverage: [0.45, 0.7], surface: { items: [["other:cloth", 3]], density: 2.0, fill: 1 } },
    display([["other:cloth", 4]]),
  ]),
  shop("cobbler", [
    counter([["trinket:boots", 3], ["tool", 2]]),
    { kind: "line", id: "wares", roles: [["shelf:boots", 4], ["shelf", 2], ["crate", 1], ["workbench", 1]], coverage: [0.4, 0.6], surface: { items: [["trinket:boots", 2], ["tool", 1]], density: 2.0, fill: 1 } },
    { kind: "center", id: "bench", roles: ["workbench", "table_medium"], p: 0.7, minArea: 14 },
  ]),
  shop("jeweller", [
    counter([["trinket:jewels", 5], ["coins", 2], ["trinket", 1]]),
    { kind: "line", id: "wares", roles: [["display_case", 5], ["cabinet", 1], ["chest", 1]], coverage: [0.4, 0.6], surface: { items: [["trinket:jewels", 3]], density: 2.0, fill: 1 } },
    { kind: "center", id: "case", roles: ["display_case"], p: 0.7, minArea: 14 },
  ]),
  shop("bookseller", [
    counter([["book", 4], ["scroll", 2], ["writing", 1]]),
    { kind: "line", id: "wares", roles: [["bookshelf", 6], ["desk", 1], ["chest", 1]], coverage: [0.55, 0.8], surface: { items: [["book", 2]], density: 2.0, fill: 1 } },
    display([["book", 5], ["scroll", 2]]),
    { kind: "scatter", id: "papers", roles: [["book", 2], ["scroll", 1], ["paper_scatter", 1]], perArea: 0.03, where: "edges" },
  ]),
  shop("potter", [
    counter([["pot_large", 3], ["plate", 2], ["mug", 1]]),
    { kind: "line", id: "wares", roles: [["pot_large", 5], ["shelf", 2], ["crate", 1]], coverage: [0.45, 0.7], surface: { items: [["pot_large", 3], ["plate", 1]], density: 2.0, fill: 1 }, clusters: ["pot_large"] },
    { kind: "corners", id: "jars", roles: [["pot_large", 3]], chance: 0.7 },
    { kind: "center", id: "bench", roles: ["workbench", "table_medium"], p: 0.6, minArea: 14 },
  ]),
  shop("chandler", [
    counter([["candle", 5], ["trinket", 1]]),
    { kind: "line", id: "wares", roles: [["shelf", 4], ["crate", 1], ["barrel", 1], ["pot_large", 1]], coverage: [0.4, 0.6], surface: { items: [["candle", 4], ["bottle", 1]], density: 2.4, fill: 1 } },
    display([["candle", 5]]),
  ]),
  shop("carpenter", [
    { kind: "center", id: "bench", essential: true, roles: ["workbench", "table_medium"] },
    { kind: "line", id: "wares", roles: [["woodpile", 2], ["log", 2], ["tool", 2], ["rack", 2], ["crate", 1], ["chair", 1], ["table_small", 1]], coverage: [0.4, 0.6], clusters: ["log", "woodpile"] },
    { kind: "scatter", id: "shavings", roles: [["debris", 2], ["dirt", 1]], perArea: 0.05, where: "anywhere" },
  ]),
  // Services.
  room("service.infirmary", [
    { kind: "line", id: "beds", essential: true, roles: [["bed_single", 5], ["cot", 3]], coverage: [0.55, 0.8] },
    { kind: "line", id: "care", roles: [["washbasin", 2], ["side_table", 2], ["shelf", 2], ["cabinet", 1], ["chest", 1]], coverage: [0.15, 0.3], surface: { items: [["potion", 3], ["food:herbs", 2], ["bottle", 2], ["book", 1]], density: 2, fill: 1 } },
    { kind: "center", id: "desk", roles: ["table_medium", "desk", "table_small"], p: 0.5, minArea: 16 },
    { kind: "decals", id: "bandages", roles: [["stain", 2], ["blood", 1]], perArea: 0.012, where: "anywhere" },
  ], ["candle", "lantern", "sconce"], 5),
  room("craft.alchemy", [
    { kind: "anchor", id: "station", essential: true, roles: ["alchemy:alchemy", "cauldron", "table_medium"], wall: "any", at: "random", gap: 0.4, surface: { items: [["potion", 5], ["bottle", 3]], density: 3, fill: 1 } },
    { kind: "center", id: "cauldron", roles: ["cauldron"], p: 0.8 },
    { kind: "line", id: "shelves", roles: [["shelf", 3], ["bookshelf", 2], ["cabinet", 2], ["display_case", 1], ["pot_large", 1]], coverage: [0.5, 0.75], surface: { items: [["potion", 5], ["bottle", 3], ["book", 2]], density: 2.4, fill: 1 } },
    { kind: "anchor", id: "desk", roles: ["desk", "table_medium"], wall: "any", at: "random", p: 0.7, seats: { roles: ["chair", "stool"], n: [1, 1], dist: -0.2, p: 0.8 }, surface: { items: [["book", 3], ["scroll", 2], ["potion", 2], ["writing", 1]], density: 2.4, fill: 1, candle: 0.8 } },
    { kind: "scatter", id: "spills", roles: [["potion", 2], ["paper_scatter", 1], ["scorch", 1]], perArea: 0.03, where: "anywhere" },
  ], ["candle", "candelabra", "lantern"], 5),
  room("service.counting", [
    { kind: "anchor", id: "counter", essential: true, roles: ["counter", "table_long", "desk"], wall: "far", at: "center", gap: 1.1, surface: { items: [["coins", 3], ["writing", 2], ["scroll", 2], ["book", 1]], density: 3, fill: 1, candle: 0.4 } },
    { kind: "anchor", id: "desk", roles: ["desk"], wall: "exterior", at: "random", p: 0.8, seats: { roles: ["chair"], n: [1, 1], dist: -0.2, p: 0.9 }, surface: { items: [["book", 2], ["scroll", 2], ["writing", 2], ["coins", 1]], density: 2, fill: 1, candle: 0.8 } },
    { kind: "line", id: "strongboxes", roles: [["chest", 3], ["bookshelf", 2], ["cabinet", 2], ["display_case", 1]], coverage: [0.35, 0.55] },
  ]),
  room("service.vault", [
    { kind: "line", id: "chests", essential: true, roles: [["chest", 5], ["crate", 2], ["display_case", 1]], coverage: [0.5, 0.8] },
    { kind: "corners", id: "corners", roles: [["chest", 2], ["crate", 1]], chance: 0.7 },
    { kind: "center", id: "strongbox", roles: ["chest"], p: 0.5 },
  ], ["candle", "lantern"], 8),
  room("shop.undertaker", [
    { kind: "line", id: "coffins", essential: true, roles: [["coffin", 5], ["shelf", 1], ["workbench", 1]], coverage: [0.45, 0.7] },
    { kind: "center", id: "bench", roles: ["workbench", "table_long", "table_medium"], p: 0.9 },
    { kind: "line", id: "candles", roles: [["candelabra", 2], ["chest", 1], ["pot_large", 1]], coverage: [0.1, 0.2] },
  ], ["candle", "candelabra"], 5),
  room("service.bath", [
    { kind: "anchor", id: "tubs", essential: true, roles: ["bathtub"], wall: "any", at: "random", count: [2, 4], gap: 0.3 },
    { kind: "center", id: "tub", roles: ["bathtub"], p: 0.6, minArea: 20 },
    { kind: "line", id: "benches", roles: [["bench", 3], ["washbasin", 2], ["shelf", 1], ["plant", 1], ["chest", 1]], coverage: [0.25, 0.45], surface: { items: [["bottle", 2], ["trinket", 1]], density: 1.5, fill: 1 } },
    { kind: "decals", id: "wet", roles: [["puddle", 3], ["stain", 1]], perArea: 0.04, where: "anywhere" },
  ], ["candle", "lantern", "sconce"], 5),
  // The underworld.
  room("underworld.pawn", [
    { kind: "anchor", id: "counter", essential: true, roles: ["counter", "table_long", "table_medium"], wall: "far", at: "center", gap: 1.1, surface: { items: [["trinket", 4], ["weapon", 2], ["coins", 1], ["book", 1], ["bottle", 1]], density: 3.2, fill: 1, candle: 0.3 } },
    { kind: "line", id: "junk", roles: [["shelf", 3], ["display_case", 2], ["chest", 2], ["crate", 2], ["armor_stand", 1], ["rack:weapons", 1], ["barrel", 1]], coverage: [0.55, 0.8], surface: { items: [["trinket", 3], ["weapon", 1], ["bottle", 1], ["book", 1], ["pot_large", 1]], density: 2.2, fill: 1 }, clusters: ["crate"] },
    { kind: "scatter", id: "clutter", roles: [["debris", 2], ["trinket", 1], ["book", 1]], perArea: 0.03, where: "edges" },
  ], ["candle", "lantern"], 6),
  room("underworld.contraband", [
    { kind: "line", id: "goods", essential: true, roles: [["crate", 4], ["barrel", 3], ["sack", 3], ["chest", 2]], coverage: [0.7, 0.95], clusters: ["crate", "barrel", "sack"], fill: [["crate", 2], ["sack", 2]] },
    { kind: "line", id: "goods2", roles: [["crate", 3], ["barrel", 2], ["sack", 2]], coverage: [0.25, 0.45], gap: 0.95, clusters: ["crate", "barrel", "sack"] },
    { kind: "center", id: "pile", roles: ["crate", "chest", "barrel"], p: 0.8 },
  ], ["lantern", "candle"], 8),
  room("underworld.den", [
    { kind: "groups", id: "tables", essential: true, perArea: 1 / 14, count: [1, 3], kinds: [["round", 2], ["square", 2], ["composite", 1]], aisle: 0.45, surface: { items: [["games", 2], ["coins", 2], ["mug", 3], ["bottle", 2], ["weapon", 1], ["food", 1]], density: 1.6, candle: 0.6 }, seats: [["chair", 3], ["stool", 3], ["bench", 1]] },
    { kind: "line", id: "loot", roles: [["cot", 2], ["crate", 2], ["barrel", 2], ["rack:weapons", 1], ["chest", 1], ["sack", 1]], coverage: [0.3, 0.55], clusters: ["crate", "barrel"] },
    { kind: "scatter", id: "mess", roles: [["bottle", 2], ["debris", 2], ["mug", 1]], perArea: 0.04, where: "anywhere" },
    { kind: "decals", id: "blood", roles: [["blood", 1], ["stain", 2]], perArea: 0.01, where: "anywhere" },
  ], ["lantern", "candle"], 6),
  room("underworld.hideout", [
    { kind: "line", id: "bunks", essential: true, roles: [["cot", 4], ["chest", 2], ["crate", 1], ["bed_single", 1]], coverage: [0.4, 0.65] },
    { kind: "center", id: "table", roles: ["table_small", "table_medium"], p: 0.5 },
    { kind: "scatter", id: "mess", roles: [["bottle", 2], ["debris", 2]], perArea: 0.04, where: "anywhere" },
  ], ["candle", "lantern"], 8),
  room("underworld.squat", [
    { kind: "center", id: "fire", roles: ["firepit", "brazier", "campfire"], p: 0.8 },
    { kind: "line", id: "beds", essential: true, roles: [["cot", 4], ["mat", 3], ["sack", 1], ["pot_large", 1]], coverage: [0.45, 0.7] },
    { kind: "scatter", id: "rubbish", roles: [["debris", 3], ["bottle", 1], ["straw", 1], ["bones", 1]], perArea: 0.07, where: "anywhere" },
    { kind: "decals", id: "filth", roles: [["grime", 3], ["dirt", 3], ["stain", 2]], perArea: 0.08, where: "anywhere" },
  ], ["candle"], 9),
  room("underworld.gambling", [
    { kind: "groups", id: "tables", essential: true, perArea: 1 / 10, count: [2, 5], kinds: [["square", 2], ["round", 2], ["composite", 1]], aisle: 0.5, surface: { items: [["games", 4], ["coins", 3], ["mug", 2], ["bottle", 1]], density: 1.8, candle: 0.7 }, seats: [["chair", 4], ["stool", 2]] },
    { kind: "anchor", id: "counter", roles: ["bar_counter", "counter"], wall: "far", at: "random", gap: 1.1, p: 0.7, surface: { items: [["mug", 3], ["bottle", 3], ["coins", 1]], density: 2.4, fill: 1 } },
    { kind: "line", id: "casks", roles: [["barrel", 3], ["keg", 2], ["crate", 1]], coverage: [0.15, 0.3], clusters: ["barrel"] },
    { kind: "scatter", id: "spills", roles: [["mug", 1], ["bottle", 1], ["paper_scatter", 1]], perArea: 0.03, where: "anywhere" },
  ], ["lantern", "candle", "sconce"], 4),
  // The law.
  room("guard.post", [
    { kind: "groups", id: "table", perArea: 1 / 20, count: [1, 1], kinds: [["square", 2], ["round", 1]], aisle: 0.4, surface: { items: [["games", 1], ["mug", 2], ["food", 1], ["coins", 1], ["writing", 1]], density: 1.4, candle: 0.5 }, seats: [["chair", 2], ["stool", 2], ["bench", 1]] },
    { kind: "line", id: "arms", essential: true, roles: [["rack:weapons", 3], ["armor_stand", 2], ["chest", 2], ["cot", 1], ["barrel", 1], ["banner", 1]], coverage: [0.35, 0.55] },
  ], ["torch", "lantern"], 6),
  room("guard.barracks", [
    { kind: "line", id: "bunks", essential: true, roles: [["bed_single", 5], ["cot", 3]], coverage: [0.55, 0.85] },
    { kind: "line", id: "lockers", roles: [["chest", 3], ["rack:weapons", 1], ["armor_stand", 1]], coverage: [0.12, 0.25] },
  ], ["torch", "lantern"], 7),
  room("guard.mess", [
    { kind: "center", id: "table", essential: true, roles: ["table_long"], seats: { roles: ["bench", "chair"], n: [6, 10], dist: 0, p: 1 } },
    { kind: "line", id: "stores", roles: [["barrel", 2], ["shelf", 2], ["counter", 1], ["rack:weapons", 1], ["banner", 1]], coverage: [0.25, 0.45], surface: { items: [["mug", 2], ["food", 2], ["plate", 1]], density: 1.6, fill: 1 } },
  ], ["torch", "lantern", "sconce"], 5),
  room("guard.armoury", [
    { kind: "line", id: "arms", essential: true, roles: [["rack:weapons", 5], ["armor_stand", 4], ["crate", 1], ["chest", 1]], coverage: [0.6, 0.85] },
    { kind: "center", id: "anvil", roles: ["anvil", "grindstone", "armor_stand"], p: 0.6 },
  ], ["torch", "lantern"], 7),
  room("guard.office", [
    { kind: "anchor", id: "desk", essential: true, roles: ["desk", "table_medium"], wall: "exterior", at: "random", gap: 0.9, seats: { roles: ["chair", "armchair"], n: [1, 1], dist: -0.2, p: 0.95 }, surface: { items: [["writing", 2], ["scroll", 2], ["book", 1], ["coins", 1]], density: 2, fill: 1, candle: 0.8 } },
    { kind: "line", id: "office", roles: [["chest", 2], ["bookshelf", 2], ["rack:weapons", 1], ["banner", 1], ["armor_stand", 1]], coverage: [0.3, 0.5] },
    { kind: "center", id: "rug", roles: ["rug"], p: 0.5 },
  ], ["candle", "sconce"], 6),
  room("gaol.guardroom", [
    { kind: "groups", id: "table", essential: true, perArea: 1 / 20, count: [1, 1], kinds: [["square", 2], ["round", 1]], aisle: 0.4, surface: { items: [["mug", 2], ["games", 1], ["food", 1], ["writing", 1]], density: 1.4, candle: 0.5 }, seats: [["chair", 2], ["stool", 2]] },
    { kind: "line", id: "arms", roles: [["rack:weapons", 2], ["chest", 2], ["barrel", 1], ["cot", 1]], coverage: [0.3, 0.5] },
  ], ["torch", "lantern"], 6),
  room("gaol.cell", [
    { kind: "anchor", id: "cot", essential: true, roles: ["cot", "mat", "bed_single"], wall: "far", at: "random" },
    { kind: "scatter", id: "filth", roles: [["straw", 2], ["bones", 1], ["debris", 1], ["chamber_pot", 1]], perArea: 0.1, where: "anywhere" },
    { kind: "decals", id: "grime", roles: [["grime", 3], ["dirt", 2], ["stain", 2]], perArea: 0.1, where: "anywhere" },
  ], ["torch"], 12),
  // Crafts.
  room("craft.tannery", [
    { kind: "line", id: "vats", essential: true, roles: [["barrel", 4], ["pot_large", 3], ["rack", 2], ["workbench", 1]], coverage: [0.5, 0.75], clusters: ["barrel", "pot_large"] },
    { kind: "center", id: "bench", roles: ["workbench", "table_medium"], p: 0.7 },
    { kind: "scatter", id: "hides", roles: [["fur", 2], ["stain", 2], ["puddle", 2], ["dirt", 1]], perArea: 0.06, where: "anywhere" },
  ], ["lantern"], 8),
  room("craft.brewery", [
    { kind: "center", id: "kettle", essential: true, roles: ["cauldron", "pot_large"] },
    { kind: "line", id: "casks", roles: [["barrel", 5], ["keg", 3], ["sack", 2], ["crate", 1]], coverage: [0.6, 0.85], clusters: ["barrel", "sack"] },
    { kind: "corners", id: "corners", roles: [["barrel", 2], ["sack", 1]], chance: 0.6 },
    { kind: "decals", id: "spills", roles: [["puddle", 2], ["stain", 2]], perArea: 0.03, where: "anywhere" },
  ], ["lantern", "candle"], 7),
  room("craft.shipwright", [
    { kind: "center", id: "bench", essential: true, roles: ["workbench", "table_long", "table_medium"] },
    { kind: "line", id: "timber", roles: [["log", 3], ["woodpile", 2], ["tool", 2], ["crate", 2], ["barrel", 1], ["rack", 1]], coverage: [0.45, 0.7], clusters: ["log", "woodpile"] },
    { kind: "scatter", id: "shavings", roles: [["debris", 3], ["dirt", 1]], perArea: 0.06, where: "anywhere" },
  ], ["lantern"], 8),
  room("shop.furrier", [
    { kind: "anchor", id: "counter", essential: true, roles: ["counter", "table_long", "table_medium"], wall: "far", at: "center", gap: 1.1, surface: { items: [["trinket", 2], ["tool", 1], ["weapon", 1]], density: 2.4, fill: 1, candle: 0.25 } },
    { kind: "line", id: "wares", roles: [["rack", 2], ["chest", 2], ["shelf", 2], ["armor_stand", 1], ["barrel", 1]], coverage: [0.4, 0.6] },
    { kind: "center", id: "pelt", roles: ["fur", "rug"], p: 0.9 },
    { kind: "scatter", id: "pelts", roles: [["fur", 1]], perArea: 0.04, where: "anywhere" },
  ]),
  room("craft.mason", [
    { kind: "center", id: "bench", essential: true, roles: ["workbench", "table_medium"] },
    { kind: "line", id: "stone", roles: [["rock", 3], ["boulder", 2], ["statue", 2], ["tool", 2], ["crate", 1]], coverage: [0.4, 0.65] },
    { kind: "scatter", id: "chips", roles: [["debris", 3], ["rock", 1], ["dirt", 1]], perArea: 0.07, where: "anywhere" },
  ], ["lantern"], 8),
  {
    type: "house.stable",
    steps: [
      { kind: "anchor", id: "trough", essential: true, roles: ["trough", "haystack"], wall: "any", at: "random" },
      { kind: "line", id: "hay", roles: [["haystack", 4], ["barrel", 1], ["sack", 2], ["crate", 1], ["woodpile", 1]], coverage: [0.35, 0.6], clusters: ["haystack", "sack"] },
      { kind: "corners", id: "corners", roles: [["haystack", 2], ["sack", 1], ["barrel", 1]], chance: 0.6 },
      { kind: "sconces", id: "light", roles: ["lantern"], every: 9 },
      { ...GRIME_FLOOR, perArea: 0.05 }, COBWEBS,
      { kind: "scatter", id: "straw", roles: [["straw", 3], ["dirt", 2], ["leaves", 1]], perArea: 0.08, where: "anywhere" },
    ],
  },
];

export const RECIPE_BY_TYPE = new Map(RECIPES.map((r) => [r.type, r]));

/** Roles a recipe can place (for style anchor ranking). */
export function rolesOfRecipe(r: Recipe): string[] {
  const out = new Set<string>();
  const add = (w?: Weighted | string[]) => w?.forEach((x) => out.add(typeof x === "string" ? x : x[0]));
  for (const s of r.steps) {
    switch (s.kind) {
      case "anchor": add(s.roles); break;
      case "bar": out.add("bar_counter"); out.add("stool"); add(s.back); break;
      case "groups": out.add("table_set"); out.add("table_medium"); out.add("chair"); add(s.seats); break;
      case "line": case "corners": case "decals": case "scatter": add(s.roles); break;
      case "rows": case "center": case "sconces": case "overhead": case "colonnade": add(s.roles); break;
      case "runner": out.add("runner"); break;
      case "gallery": add(s.art); add(s.stands); add(s.lights); break;
    }
  }
  return [...out];
}
