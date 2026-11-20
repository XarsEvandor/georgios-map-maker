/**
 * A shop's face to the street, so it stands out among the houses on a street map (the user: "make
 * it super clear which one is the shop. Make them pop out and be distinct"): a hanging sign in the
 * trade's colour beside the door, the trade's goods on tables out front (2MT Marketplace stall
 * pieces, made for this), a mat at the door. Secret places (the fence and the dens) show nothing.
 */

import type { Trade } from "./shops";

export interface Storefront {
  /** The sign's colour, ARGB: one per trade, so neighbouring shops tell apart. */
  color: string;
  /** Goods out front: 2MT pieces by name. */
  goods?: RegExp;
  /** Or by role, when no stall piece fits the trade (pots for the potter, logs for the carpenter). */
  roles?: string[];
  /** Smaller goods, for a front with no room for a table (the same 2MT stall sets' crates and baskets). */
  small?: RegExp;
}

/** Goods for a cramped front when a trade has no small pieces of its own. */
export const SMALL_GOODS = ["crate", "barrel", "basket", "sack"];

export const STOREFRONTS: Partial<Record<Trade, Storefront>> = {
  blacksmith: { color: "ff9a4a24", goods: /^Stall - (Blacksmith 1\.[01]|Weapons 1)$/, small: /^Stall - Blacksmith 1\.[234]$/ },
  armourer: { color: "ff4f6a8a", goods: /^Stall - (Armor 1\.0|Weapons 1)$/, small: /^Stall - Armor 1\.(3a|4|5a)$/ },
  merchant: { color: "ffc89a2a", goods: /^Stall - (Chests|Crystals|Produce 2\.0)$/ },
  baker: { color: "ffd88a2a", goods: /^Display - Bread [12]$/ },
  butcher: { color: "ffa82828", goods: /^Stall - Butcher$/ },
  herbalist: { color: "ff4a8a3a", goods: /^Stall - (Produce 3\.0|Produce 2\.0|Tea)$/, small: /^Stall - Produce (1\.2|2\.1|3\.2|1\.3a)$/ },
  fishmonger: { color: "ff2a6aa0", goods: /^Stall - Fish 1\.1$/, small: /^Stall - Fish 1\.[23]$/ },
  potion_maker: { color: "ff8a3aa8", goods: /^Stall - Potions$/, small: /^Stall - Crystals$/ },
  tailor: { color: "ffc0407a", goods: /^Stall - Tailor$/ },
  cobbler: { color: "ff7a5230", goods: /^Stall - Boots$/ },
  chandler: { color: "ffe0c040", roles: ["candelabra"] },
  potter: { color: "ffc0643a", roles: ["pot_large"] },
  carpenter: { color: "ffa07040", roles: ["woodpile", "log"] },
  jeweller: { color: "ff2aa0a0", goods: /^Stall - (Crystals|Magical Items)$/ },
  bookseller: { color: "ff3a4a9a", goods: /^Stall - (Tomes|Scrolls)$/ },
  healer: { color: "ffe8e8e0" },
  alchemist: { color: "ff6a2aa0", goods: /^Stall - (Potions|Crystals)$/, small: /^Stall - Crystals$/ },
  moneylender: { color: "ffd0b040", goods: /^Stall - Chests$/ },
  undertaker: { color: "ff2a2a30", roles: ["coffin"] },
  bathhouse: { color: "ff3aa0c0" },
  alehouse: { color: "ffb06a2a", goods: /^Stall - Beer$/ },
  watch_house: { color: "ff2a3a6a" },
  gaol: { color: "ff3a3a3a" },
  tannery: { color: "ff8a5a30", goods: /^Stall - Furs 1\.1$/, small: /^Stall - Furs 1\.[23]$/ },
  brewery: { color: "ffc08a2a", goods: /^Stall - Beer$/ },
  shipwright: { color: "ff2a5a7a", roles: ["rope", "log"] },
  furrier: { color: "ff9a7a5a", goods: /^Stall - Furs 1\.[01]$/, small: /^Stall - Furs 1\.[23]$/ },
  stonemason: { color: "ff9a9a90", roles: ["statue"] },
};
