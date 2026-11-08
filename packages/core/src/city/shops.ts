/**
 * Shops: which trades a city has and where they keep shop. The shops live in ordinary houses
 * (town-house art on the city scene); street maps show them from inside with their wares, and
 * each gets a pin on the city scene that opens a map of it.
 *
 * | Trade        | Where                                            | From  |
 * |--------------|--------------------------------------------------|-------|
 * | blacksmith   | by a gate on its road (by the market if no gate) | town  |
 * | merchant     | on the market square                             | town  |
 * | baker        | near the market                                  | town  |
 * | butcher      | near the market                                  | town  |
 * | herbalist    | quieter streets, a walk from the market          | town  |
 * | fishmonger   | by the piers or the river (coast or river only)  | town  |
 * | potion maker | quieter streets, a walk from the market          | town  |
 * | tailor       | near the market                                  | city  |
 * | cobbler      | near the market                                  | city  |
 * | armourer     | by the keep, else near the market                | city  |
 * | chandler     | a walk from the market                           | city  |
 * | potter       | towards the edge of town                         | city  |
 * | carpenter    | towards the edge of town                         | city  |
 * | jeweller     | on the market square                             | large |
 * | bookseller   | near the market                                  | large |
 *
 * A large city also gets a second merchant, baker and butcher.
 *
 * Services, the law and the underworld come after the shops (SERVICES), so adding them never
 * moves a shop. Underworld places are secret: their pins are hidden from players.
 *
 * | Place            | Where                                     | From  |
 * |------------------|-------------------------------------------|-------|
 * | healer           | by the temple                             | town  |
 * | watch house      | by a gate                                 | town  |
 * | alehouse         | a poor street towards the edge            | town  |
 * | beggars' den     | a poor street towards the edge            | town  |
 * | thieves' den     | a poor street, secret                     | town  |
 * | fence            | a pawnshop on a poor street, secret       | town  |
 * | tannery          | by the water, out of the way (water only) | town  |
 * | furrier          | towards the edge                          | town  |
 * | alchemist        | a walk from the market                    | city  |
 * | moneylender      | on the market square                      | city  |
 * | undertaker       | by the temple                             | city  |
 * | bathhouse        | near the market                           | city  |
 * | gaol             | by the keep, else near the market         | city  |
 * | gambling den     | a poor street, secret                     | city  |
 * | smugglers' den   | by the water, secret (coast only)         | city  |
 * | brewery          | towards the edge                          | city  |
 * | shipwright       | by the water (coast only)                 | city  |
 * | stonemason       | towards the edge                          | city  |
 *
 * A large city doubles the healer, alehouse, watch house and thieves' den. Mansions, the
 * garrison and stables are places of interest with their own art (places.ts).
 */

export type Trade =
  | "blacksmith" | "armourer" | "herbalist" | "potion_maker" | "butcher" | "fishmonger" | "baker" | "merchant"
  | "tailor" | "cobbler" | "jeweller" | "bookseller" | "potter" | "chandler" | "carpenter"
  | "healer" | "alchemist" | "moneylender" | "undertaker" | "bathhouse" | "fence" | "thieves_den" | "beggars_den"
  | "gambling_den" | "smugglers_den" | "alehouse" | "watch_house" | "gaol" | "tannery" | "brewery" | "shipwright"
  | "furrier" | "stonemason";

export interface TradeInfo {
  /** Pin and token label. */
  label: string;
  /** The shop room's type (gen/recipes.ts). */
  room: string;
  /** What the keeper is called. */
  keeper: string;
  /** Where the shop wants to be. */
  where: "gate" | "square" | "near" | "walk" | "edge" | "water" | "keep" | "temple" | "poor";
  /** Foundry core icon for the pin. */
  icon: string;
  /** Hidden from players (the pin's journal page is closed to them). */
  secret?: boolean;
  /** Plot size it needs, square metres (default 45-450). */
  plot?: [number, number];
  /** Only in a town by the sea, or by any water. */
  needs?: "coast" | "water";
  /** The rooms behind the main one, nearest first; leftover rooms; the room size the grid aims at. */
  rooms?: { rest: string[]; filler?: string[]; side?: number };
}

export const TRADES: Record<Trade, TradeInfo> = {
  blacksmith: { label: "Blacksmith", room: "shop.blacksmith", keeper: "blacksmith", where: "gate", icon: "icons/svg/sword.svg" },
  merchant: { label: "Merchant", room: "shop.merchant", keeper: "merchant", where: "square", icon: "icons/svg/item-bag.svg" },
  baker: { label: "Baker", room: "shop.baker", keeper: "baker", where: "near", icon: "icons/svg/fire.svg" },
  butcher: { label: "Butcher", room: "shop.butcher", keeper: "butcher", where: "near", icon: "icons/svg/leg.svg" },
  herbalist: { label: "Herbalist", room: "shop.herbalist", keeper: "herbalist", where: "walk", icon: "icons/svg/oak.svg" },
  fishmonger: { label: "Fishmonger", room: "shop.fishmonger", keeper: "fishmonger", where: "water", icon: "icons/svg/net.svg" },
  potion_maker: { label: "Potion maker", room: "shop.potion_maker", keeper: "potion maker", where: "walk", icon: "icons/svg/acid.svg" },
  tailor: { label: "Tailor", room: "shop.tailor", keeper: "tailor", where: "near", icon: "icons/svg/hanging-sign.svg" },
  cobbler: { label: "Cobbler", room: "shop.cobbler", keeper: "cobbler", where: "near", icon: "icons/svg/walk.svg" },
  armourer: { label: "Armourer", room: "shop.armourer", keeper: "armourer", where: "keep", icon: "icons/svg/shield.svg" },
  chandler: { label: "Chandler", room: "shop.chandler", keeper: "chandler", where: "walk", icon: "icons/svg/light.svg" },
  potter: { label: "Potter", room: "shop.potter", keeper: "potter", where: "edge", icon: "icons/svg/barrel.svg" },
  carpenter: { label: "Carpenter", room: "shop.carpenter", keeper: "carpenter", where: "edge", icon: "icons/svg/ladder.svg" },
  jeweller: { label: "Jeweller", room: "shop.jeweller", keeper: "jeweller", where: "square", icon: "icons/svg/coins.svg" },
  bookseller: { label: "Bookseller", room: "shop.bookseller", keeper: "bookseller", where: "near", icon: "icons/svg/book.svg" },
  healer: { label: "Healer", room: "service.infirmary", keeper: "healer", where: "temple", icon: "icons/svg/heal.svg", plot: [60, 500], rooms: { rest: ["house.living", "tavern.storage"], side: 7 } },
  alchemist: { label: "Alchemist", room: "craft.alchemy", keeper: "alchemist", where: "walk", icon: "icons/svg/pill.svg", rooms: { rest: ["gothic.study", "tavern.storage"] } },
  moneylender: { label: "Moneylender", room: "service.counting", keeper: "moneylender", where: "square", icon: "icons/svg/chest.svg", rooms: { rest: ["service.vault", "house.bedroom"] } },
  undertaker: { label: "Undertaker", room: "shop.undertaker", keeper: "undertaker", where: "temple", icon: "icons/svg/skull.svg", rooms: { rest: ["tavern.storage", "house.home"] } },
  bathhouse: { label: "Bathhouse", room: "service.bath", keeper: "bath attendant", where: "near", icon: "icons/svg/waterfall.svg", plot: [90, 500], rooms: { rest: ["service.bath", "house.living"], side: 7 } },
  fence: { label: "Fence (pawnshop)", room: "underworld.pawn", keeper: "fence", where: "poor", icon: "icons/svg/padlock.svg", secret: true, rooms: { rest: ["underworld.contraband", "house.bedroom"] } },
  thieves_den: { label: "Thieves' den", room: "underworld.den", keeper: "lookout", where: "poor", icon: "icons/svg/cowled.svg", secret: true, plot: [60, 450], rooms: { rest: ["underworld.hideout", "underworld.contraband"], filler: ["underworld.hideout"], side: 7 } },
  beggars_den: { label: "Beggars' den", room: "underworld.squat", keeper: "beggar", where: "poor", icon: "icons/svg/mystery-man.svg", rooms: { rest: ["underworld.squat"], filler: ["underworld.squat"] } },
  gambling_den: { label: "Gambling den", room: "underworld.gambling", keeper: "dealer", where: "poor", icon: "icons/svg/card-joker.svg", secret: true, plot: [60, 450], rooms: { rest: ["underworld.contraband", "tavern.storage"] } },
  smugglers_den: { label: "Smugglers' den", room: "underworld.contraband", keeper: "smuggler", where: "water", icon: "icons/svg/door-secret-outline.svg", secret: true, needs: "coast", rooms: { rest: ["underworld.hideout", "tavern.storage"] } },
  alehouse: { label: "Alehouse", room: "tavern.common_room", keeper: "alewife", where: "poor", icon: "icons/svg/tankard.svg", plot: [60, 450], rooms: { rest: ["tavern.kitchen", "tavern.storage"], side: 8 } },
  watch_house: { label: "Watch house", room: "guard.post", keeper: "watch sergeant", where: "gate", icon: "icons/svg/eye.svg", rooms: { rest: ["guard.barracks", "gaol.cell"] } },
  gaol: { label: "Gaol", room: "gaol.guardroom", keeper: "gaoler", where: "keep", icon: "icons/svg/door-locked-outline.svg", plot: [70, 450], rooms: { rest: ["gaol.cell", "gaol.cell", "gaol.cell", "gaol.cell", "gaol.cell"], filler: ["gaol.cell"], side: 4 } },
  tannery: { label: "Tannery", room: "craft.tannery", keeper: "tanner", where: "water", icon: "icons/svg/poison.svg", needs: "water", rooms: { rest: ["tavern.storage"] } },
  brewery: { label: "Brewery", room: "craft.brewery", keeper: "brewer", where: "edge", icon: "icons/svg/barrel.svg", plot: [60, 450], rooms: { rest: ["craft.brewery", "tavern.storage"] } },
  shipwright: { label: "Shipwright", room: "craft.shipwright", keeper: "shipwright", where: "water", icon: "icons/svg/whale.svg", needs: "coast", plot: [80, 600], rooms: { rest: ["tavern.storage"] } },
  furrier: { label: "Furrier", room: "shop.furrier", keeper: "furrier", where: "edge", icon: "icons/svg/mole.svg", rooms: { rest: ["tavern.storage", "house.home"] } },
  stonemason: { label: "Stonemason", room: "craft.mason", keeper: "stonemason", where: "edge", icon: "icons/svg/mountain.svg", plot: [70, 450], rooms: { rest: ["tavern.storage"] } },
};

/** Services, the law and the underworld, placed after the shops (so shops never move). */
export const SERVICES: Record<"town" | "city" | "large", Trade[]> = {
  town: ["healer", "watch_house", "alehouse", "beggars_den", "thieves_den", "fence", "tannery", "furrier"],
  city: ["healer", "watch_house", "alehouse", "beggars_den", "thieves_den", "fence", "tannery", "furrier", "alchemist", "moneylender", "undertaker", "bathhouse", "gaol", "gambling_den", "smugglers_den", "brewery", "shipwright", "stonemason"],
  large: ["healer", "watch_house", "alehouse", "beggars_den", "thieves_den", "fence", "tannery", "furrier", "alchemist", "moneylender", "undertaker", "bathhouse", "gaol", "gambling_den", "smugglers_den", "brewery", "shipwright", "stonemason", "healer", "alehouse", "watch_house", "thieves_den"],
};

/** The trades a town of each size has, in the order they pick their plots. */
export const ROSTER: Record<"town" | "city" | "large", Trade[]> = {
  town: ["fishmonger", "blacksmith", "merchant", "baker", "butcher", "herbalist", "potion_maker"],
  city: ["fishmonger", "blacksmith", "merchant", "baker", "butcher", "herbalist", "potion_maker", "armourer", "tailor", "cobbler", "chandler", "potter", "carpenter"],
  large: ["fishmonger", "blacksmith", "merchant", "jeweller", "baker", "butcher", "herbalist", "potion_maker", "armourer", "tailor", "cobbler", "chandler", "potter", "carpenter", "bookseller", "merchant", "baker", "butcher", "blacksmith"],
};

/** Distance from the market (metres) each kind of spot aims at: [best, tolerance]. */
export const AIM: Record<TradeInfo["where"], [number, number]> = {
  square: [0, 25],
  near: [70, 60],
  walk: [160, 90],
  edge: [300, 160],
  gate: [0, 40],
  water: [0, 30],
  keep: [0, 60],
  temple: [0, 70],
  poor: [280, 170],
};

const NAME_A = ["Val", "Cor", "Ald", "Bel", "Dra", "Mor", "Ser", "Vor", "Ash", "Kel", "Ran", "Tor", "Lys", "Bran", "Cas", "Dun", "Fal", "Gal", "Hal", "Mar", "Ost", "Rav", "Sten", "Ulm"];
const NAME_B = ["mont", "wick", "ford", "mere", "crest", "hollow", "dane", "ric", "vane", "holt", "more", "ley", "bourne", "stead", "garde", "wyn", "march", "brook"];

/** A noble family's name for a mansion, the same for the same number (0..1). */
export function nobleName(seed: number): string {
  const h = Math.floor(Math.abs(seed) * 1e6) >>> 0;
  return NAME_A[h % NAME_A.length]! + NAME_B[Math.floor(h / NAME_A.length) % NAME_B.length]!;
}
