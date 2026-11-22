/**
 * Room programs: how big each room type wants to be and what its walls need.
 * Areas are in grid squares (one square = 5 ft). Values come from 2MT's own furnished
 * maps: a 22x16 tavern holds a common room of about 10x8, a kitchen of 6x5, and so on.
 */

import type { FloorKind } from "./catalog";

export interface RoomSpec {
  type: string;
  label: string;
  /** Target area range in squares. */
  area: [number, number];
  /** Shortest allowed side. */
  minSide: number;
  /** Longest side / shortest side limit. */
  maxAspect: number;
  /** Preferred lowest aspect (long rooms such as naves and dining halls). */
  minAspect?: number;
  /** The main door goes on a short side (naves: door opposite the altar). */
  doorOnShortSide?: boolean;
  /** The room wants an outside wall (entrances, chimneys, windows). */
  exterior?: boolean;
  /** The room is where visitors come in; it gets the main door on the building front. */
  entrance?: boolean;
  /** Windows on outside walls: squares between windows, or 0 for none. */
  windowEvery: number;
  floor: FloorKind;
  /** Open-air zone (graveyard, yard): no walls, no floor pattern. */
  outdoor?: boolean;
  /** A corridor that organizes the building: other rooms open off its walls and far end. */
  spine?: boolean;
}

const S = (s: Omit<RoomSpec, "minSide" | "maxAspect" | "windowEvery"> & Partial<RoomSpec>): RoomSpec => ({ minSide: 3, maxAspect: 2.2, windowEvery: 4, ...s });

export const ROOM_SPECS: RoomSpec[] = [
  S({ type: "tavern.common_room", label: "Tavern common room", area: [64, 120], minSide: 6, maxAspect: 1.8, exterior: true, entrance: true, windowEvery: 3, floor: "wood" }),
  S({ type: "tavern.kitchen", label: "Kitchen", area: [20, 36], minSide: 4, exterior: true, floor: "stone" }),
  S({ type: "tavern.storage", label: "Storeroom", area: [9, 20], minSide: 3, windowEvery: 0, floor: "wood" }),
  S({ type: "tavern.guest_room", label: "Guest room", area: [9, 18], minSide: 3, maxAspect: 1.7, windowEvery: 3, floor: "wood" }),
  S({ type: "tavern.cellar", label: "Cellar", area: [24, 56], minSide: 4, windowEvery: 0, floor: "stone" }),
  S({ type: "gothic.nave", label: "Chapel nave", area: [90, 170], minSide: 7, maxAspect: 2.6, minAspect: 1.6, doorOnShortSide: true, exterior: true, entrance: true, windowEvery: 3, floor: "stone" }),
  S({ type: "gothic.crypt", label: "Crypt", area: [30, 72], minSide: 5, windowEvery: 0, floor: "stone" }),
  S({ type: "gothic.vestry", label: "Vestry", area: [9, 20], minSide: 3, windowEvery: 3, floor: "stone" }),
  S({ type: "gothic.study", label: "Study", area: [16, 32], minSide: 4, maxAspect: 1.8, windowEvery: 5, floor: "wood" }),
  S({ type: "gothic.bedroom", label: "Bedroom", area: [16, 30], minSide: 4, maxAspect: 1.8, windowEvery: 4, floor: "wood" }),
  S({ type: "gothic.ballroom", label: "Ballroom", area: [70, 130], minSide: 7, maxAspect: 1.9, exterior: true, entrance: true, windowEvery: 3, floor: "wood" }),
  S({ type: "gothic.dining", label: "Dining hall", area: [36, 70], minSide: 5, maxAspect: 2.4, minAspect: 1.3, windowEvery: 3, floor: "wood" }),
  S({ type: "gothic.hall", label: "Entrance hall", area: [20, 42], minSide: 4, exterior: true, entrance: true, windowEvery: 3, floor: "stone" }),
  S({ type: "gothic.gallery", label: "Gallery corridor (long hall with art, rooms off its sides)", area: [60, 300], minSide: 4, maxAspect: 6, minAspect: 2.6, doorOnShortSide: true, exterior: true, entrance: true, windowEvery: 0, floor: "stone", spine: true }),
  S({ type: "gothic.vault", label: "Side vault or alcove", area: [8, 20], minSide: 3, maxAspect: 1.8, windowEvery: 0, floor: "stone" }),
  S({ type: "gothic.vestibule", label: "Vestibule under a tower (a bare, squarish stone hall with pillars)", area: [140, 560], minSide: 9, maxAspect: 1.35, exterior: true, entrance: true, windowEvery: 0, floor: "stone" }),
  S({ type: "house.home", label: "One-room home (hearth, bed, table)", area: [9, 36], minSide: 3, exterior: true, entrance: true, windowEvery: 4, floor: "wood" }),
  S({ type: "house.living", label: "House main room (hearth, table, shelves)", area: [12, 40], minSide: 3, exterior: true, entrance: true, windowEvery: 4, floor: "wood" }),
  S({ type: "house.bedroom", label: "House bedroom", area: [8, 24], minSide: 3, maxAspect: 2, windowEvery: 4, floor: "wood" }),
  S({ type: "house.workroom", label: "Workroom (workbench, racks, tools)", area: [9, 30], minSide: 3, windowEvery: 4, floor: "wood" }),
  S({ type: "house.smithy", label: "Smithy (forge, anvil)", area: [12, 36], minSide: 3, exterior: true, windowEvery: 0, floor: "stone" }),
  S({ type: "house.weaver", label: "Weaver's room (looms, baskets)", area: [9, 30], minSide: 3, windowEvery: 3, floor: "wood" }),
  S({ type: "house.stable", label: "Stable (hay, trough)", area: [12, 60], minSide: 3, maxAspect: 3, exterior: true, windowEvery: 0, floor: "dirt" }),
  ...([
    ["blacksmith", "Blacksmith's forge and shop (forge, anvil, weapon racks)", "stone"],
    ["armourer", "Armourer's shop (armour stands, weapon racks, counter)", "wood"],
    ["herbalist", "Herbalist's shop (counter, herb bundles, shelves of jars)", "wood"],
    ["potion_maker", "Potion maker's shop (counter, potions, cauldron, alchemy station)", "wood"],
    ["butcher", "Butcher's shop (butcher's counter, meat, barrels)", "stone"],
    ["fishmonger", "Fishmonger's shop (counter of fish, barrels, crates)", "stone"],
    ["baker", "Bakery (oven, counter and shelves of bread, flour sacks)", "wood"],
    ["merchant", "Merchant's shop (counter, crates, barrels, sacks, shelves of goods)", "wood"],
    ["tailor", "Tailor's shop (clothes racks, cloth, counter)", "wood"],
    ["cobbler", "Cobbler's shop (boot shelves, workbench, counter)", "wood"],
    ["jeweller", "Jeweller's shop (display cases, counter of jewels)", "wood"],
    ["bookseller", "Bookshop (bookshelves, counter, books and scrolls)", "wood"],
    ["potter", "Potter's shop (pots and jars, workbench)", "wood"],
    ["chandler", "Chandler's shop (candles, shelves, counter)", "wood"],
    ["carpenter", "Carpenter's workshop (workbench, timber, tools)", "wood"],
  ] as const).map(([t, label, floor]) => S({ type: `shop.${t}`, label, area: [9, 40], minSide: 3, exterior: true, entrance: true, windowEvery: 3, floor })),
  ...([
    ["service.infirmary", "Infirmary (beds along the walls, washbasins, herbs and potions)", "wood", 12, 60],
    ["craft.alchemy", "Alchemist's laboratory (alchemy station, cauldron, shelves of potions, books)", "wood", 9, 40],
    ["service.counting", "Moneylender's counting room (counter, desk, strongboxes)", "wood", 9, 36],
    ["service.vault", "Strongroom (chests)", "stone", 4, 20],
    ["shop.undertaker", "Undertaker's shop (coffins, workbench, candles)", "wood", 9, 36],
    ["service.bath", "Bath hall (tubs, benches, washbasins)", "stone", 12, 60],
    ["underworld.pawn", "Pawnshop front (counter of odds and ends, shelves of junk)", "wood", 9, 36],
    ["underworld.contraband", "Contraband store (crates, barrels, sacks, chests)", "stone", 6, 40],
    ["underworld.den", "Thieves' den (card tables, loot, cots, weapon racks)", "wood", 12, 50],
    ["underworld.hideout", "Hideout (cots, chests)", "wood", 6, 30],
    ["underworld.squat", "Beggars' squat (cots and bedrolls round a fire, rubbish)", "stone", 6, 50],
    ["underworld.gambling", "Gambling hall (card and dice tables, a bar)", "wood", 16, 70],
    ["guard.post", "Guard post (table, weapon racks, armour)", "stone", 9, 30],
    ["guard.barracks", "Barracks (bunks along the walls, footlockers)", "wood", 12, 60],
    ["guard.mess", "Mess hall (long table with benches)", "wood", 16, 60],
    ["guard.armoury", "Armoury (weapon racks, armour stands)", "stone", 9, 36],
    ["guard.office", "Captain's office (desk, chests, banner)", "wood", 9, 30],
    ["gaol.guardroom", "Gaol guardroom (table, weapon racks)", "stone", 9, 30],
    ["gaol.cell", "Gaol cell (cot, straw, filth; locked door)", "stone", 4, 16],
    ["craft.tannery", "Tannery (vats, racks, hides)", "stone", 9, 50],
    ["craft.brewery", "Brewery (brew kettle, barrels, kegs, sacks of grain)", "stone", 12, 60],
    ["craft.shipwright", "Shipwright's shed (workbench, timber, tools)", "wood", 12, 60],
    ["shop.furrier", "Furrier's shop (counter, pelts, racks)", "wood", 9, 36],
    ["craft.mason", "Stonemason's yard (workbench, stone, statues in the making)", "stone", 9, 50],
  ] as const).map(([type, label, floor, lo, hi]) => S({ type, label, area: [lo, hi], minSide: 2, exterior: true, windowEvery: 3, floor })),
  S({ type: "street.area", label: "City streets (built from a city layout; set by the city tools, not by hand)", area: [100, 6400], minSide: 10, maxAspect: 4, windowEvery: 0, floor: "cobble", outdoor: true }),
  S({ type: "war.camp", label: "An army's camp (a war map; set with the plan's war field, not by hand)", area: [400, 6400], minSide: 20, maxAspect: 3, windowEvery: 0, floor: "dirt", outdoor: true }),
  S({ type: "war.field", label: "A battlefield between armies (a war map; set with the plan's war field, not by hand)", area: [400, 6400], minSide: 20, maxAspect: 3, windowEvery: 0, floor: "dirt", outdoor: true }),
  S({ type: "gothic.graveyard", label: "Graveyard", area: [100, 900], minSide: 6, maxAspect: 10, windowEvery: 0, floor: "dirt", outdoor: true }),
];

export const SPEC_BY_TYPE = new Map(ROOM_SPECS.map((s) => [s.type, s]));

export function specOf(type: string): RoomSpec {
  return SPEC_BY_TYPE.get(type) ?? S({ type, label: type, area: [16, 36], floor: "wood" });
}

/** Target area for a zone: small, medium and large map to the low, middle and high end. */
export function targetArea(spec: RoomSpec, size?: "small" | "medium" | "large"): number {
  const [lo, hi] = spec.area;
  const f = size === "small" ? 0.15 : size === "large" ? 0.95 : 0.5;
  return lo + (hi - lo) * f;
}

/** Every room type the generator knows. */
export const ZONE_TYPES = new Set(ROOM_SPECS.map((s) => s.type));
