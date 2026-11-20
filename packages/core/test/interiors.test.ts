/** Buildings seen from inside on street maps (city/interiors.ts, city/street.ts). */

import { describe, expect, it } from "vitest";
import { allHotSpots, buildStyles, Catalog, furnishBuilding, generate, hotspotPlan, LAMPS_LIT_FROM, parseCity, parseVector2Array, PX_PER_SQUARE, Rng, STOREFRONTS, toFoundryScene, TRADES, type Placed, type ScenePlan } from "../src/index";
import { testIndex, townJson } from "./fixtures";

type V = [number, number];

function inPoly(p: V, poly: V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);
const plan = { id: "t", title: "t", seed: 7, genre: "medieval", size: { w: 40, h: 40 }, mood: { time: "day", wear: "lived-in" }, levels: [{ id: "ground", zones: [] }] } as unknown as ScenePlan;
const style = buildStyles(cat, "medieval", "lived-in", ["bed_single", "table_medium", "chair", "fireplace", "chest"], 1, new Rng(1))[0]!;
const centre = (p: Placed): V => (p.center ?? [p.x, p.y]) as V;

describe("furnishing one building", () => {
  // An L-shaped house turned 30 degrees, with its door on the long side.
  const turn = (p: V): V => { const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6); return [10 + p[0] * c - p[1] * s, 10 + p[0] * s + p[1] * c]; };
  const L: V[] = ([[0, 0], [11, 0], [11, 5], [5, 5], [5, 9], [0, 9]] as V[]).map(turn);
  const door = turn([3, 0]);
  const home = furnishBuilding({ key: "h1", shape: L, door, kind: "house", plan, cat, style, zone: "streets" });

  it("keeps every piece inside the walls", () => {
    expect(home.placed.length).toBeGreaterThan(4);
    for (const p of home.placed) expect(inPoly(centre(p), L), `${p.key} at ${centre(p)}`).toBe(true);
  });

  it("gives a big house more than one room, joined by doors, with its main room first", () => {
    expect(home.rooms.length).toBeGreaterThan(1);
    expect(home.rooms[0]).toBe("house.living");
    expect(home.walls.length).toBeGreaterThan(0);
    const doors = home.walls.flatMap((w) => w.doors);
    expect(doors.length).toBe(home.rooms.length - 1);
    // Every inner door lies on its wall.
    for (const w of home.walls) for (const d of w.doors) {
      const t = ((d[0] - w.a[0]) * (w.b[0] - w.a[0]) + (d[1] - w.a[1]) * (w.b[1] - w.a[1])) / ((w.b[0] - w.a[0]) ** 2 + (w.b[1] - w.a[1]) ** 2);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });

  it("is the same every time", () => {
    expect(furnishBuilding({ key: "h1", shape: L, door, kind: "house", plan, cat, style, zone: "streets" }).placed.map((p) => [p.key, p.x, p.y])).toEqual(home.placed.map((p) => [p.key, p.x, p.y]));
  });

  it("puts a bed in a small home and a grid of rooms in a keep", () => {
    const small = furnishBuilding({ key: "h2", shape: [[2, 2], [7, 2], [7, 6], [2, 6]], door: [4, 2], kind: "house", plan, cat, style, zone: "streets" });
    expect(small.rooms).toEqual(["house.home"]);
    expect(small.placed.some((p) => p.type.startsWith("bed"))).toBe(true);
    const keep = furnishBuilding({ key: "k", shape: [[0, 0], [30, 0], [30, 26], [0, 26]], door: [15, 26], kind: "keep", plan, cat, style, zone: "streets" });
    expect(keep.rooms[0]).toBe("gothic.hall");
    expect(keep.rooms.length).toBeGreaterThanOrEqual(6);
    expect(keep.floor).toBe("stone");
  });

  it("lights every room for the night, however small, and its hearth burns", () => {
    const small = furnishBuilding({ key: "h3", shape: [[2, 2], [6, 2], [6, 5], [2, 5]], door: [4, 2], kind: "house", plan, cat, style, zone: "streets" });
    expect(small.placed.some((p) => p.light)).toBe(true);
    // Every room of the L-shaped house and the keep has a light inside the walls; only the locked strongroom (gothic.vault) stays dark.
    const keep = furnishBuilding({ key: "k2", shape: [[0, 0], [30, 0], [30, 26], [0, 26]], door: [15, 26], kind: "keep", plan, cat, style, zone: "streets" });
    for (const b of [home, keep]) {
      const lit = new Set(b.placed.filter((p) => p.light).map((p) => p.key.split("/")[1]));
      const rooms = new Set(b.placed.filter((p) => p.room !== "gothic.vault").map((p) => p.key.split("/")[1]));
      expect([...rooms].filter((r) => !lit.has(r)), "rooms without a light").toEqual([]);
    }
    for (const p of [...home.placed, ...small.placed, ...keep.placed]) if (/^(fireplace|oven|forge)$/.test(p.type)) expect(p.light, p.key).toBeTruthy();
  });
});

describe("street maps from inside", () => {
  const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
  const spot = allHotSpots(city).find((h) => h.area)!;
  const p = hotspotPlan(city, spot, { key: "0123456789abcdef", prefix: "testburg" });
  const inside = generate(p, cat, { city, date: new Date(2026, 10, 6), houses: "roofs" });
  const roofed = generate(p, cat, { city, date: new Date(2026, 10, 6), houses: "roofs", interiors: false });
  const v = inside.versions[0]!, r = roofed.versions[0]!;
  const level = (x: typeof v) => (x.map as Record<string, any>).world.levels["0"];
  const key = (x: typeof v, id: unknown) => x.elements[String(id)]?.key ?? "";

  it("puts furniture inside the houses and draws no roofs", () => {
    const houses = level(v).walls.filter((w: any) => /^house#\d+$/.test(key(v, w.node_id)) && w.loop);
    expect(houses.length).toBeGreaterThan(0);
    const indoor = v.placed.filter((x) => x.key.startsWith("house#"));
    expect(indoor.length).toBeGreaterThan(houses.length);
    const rings = new Map<string, V[]>(houses.map((w: any) => [key(v, w.node_id), parseVector2Array(w.points).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V)]));
    for (const x of indoor) {
      const ring = rings.get(x.key.split("/")[0]!);
      if (ring) expect(inPoly(centre(x), ring), `${x.key}`).toBe(true);
    }
    expect(Object.values(v.elements).some((e) => e.kind === "floor" && e.key.startsWith("floor:house#"))).toBe(true);
    expect(level(v).patterns.some((pt: any) => key(v, pt.node_id).startsWith("roof#"))).toBe(false);
    // Roofed (the old look): no floors and no furniture in the houses.
    expect(Object.values(r.elements).some((e) => e.kind === "floor" && e.key.startsWith("floor:house#"))).toBe(false);
    expect(r.placed.some((x) => x.key.startsWith("house#"))).toBe(false);
  });

  it("gives the houses windows", () => {
    expect(Object.values(v.elements).filter((e) => e.kind === "window").length).toBeGreaterThan(0);
    expect(v.summary.windows).toBeGreaterThan(0);
  });

  it("lights the streets at night: torches by public doors, braziers on the market, street lamps seven squares or more apart", () => {
    const out = v.placed.filter((x) => x.light && !x.key.startsWith("house#"));
    const feats = new Set(out.map((x) => x.feature));
    expect(feats.has("door_lights")).toBe(true);
    expect(feats.has("market_fires")).toBe(true);
    const lamps = out.filter((x) => x.feature === "street_lights").map((x) => x.center ?? [x.x, x.y]);
    expect(lamps.length).toBeGreaterThan(2);
    for (const [i, a] of lamps.entries()) for (const b of lamps.slice(i + 1)) expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeGreaterThanOrEqual(7 - 1e-6);
    // Torches sit by doors, not by every home's door.
    const homes = Object.values(v.elements).filter((e) => e.kind === "door" && /^door:house#a?\d+$/.test(e.key)).length;
    expect(out.filter((x) => x.feature === "door_lights").length).toBeLessThan(homes * 2);
  });

  it("keeps its lamps by day, and Foundry lights them from dusk (the clock)", () => {
    expect(p.mood?.time).toBe("day");
    const lamps = level(v).lights;
    expect(lamps.length).toBeGreaterThan(0);
    const scene = toFoundryScene(v.map, { name: "t", pps: 70 });
    expect(scene.lights.length).toBe(lamps.length);
    for (const l of scene.lights) expect(l.config.darkness).toEqual({ min: LAMPS_LIT_FROM, max: 1 });
  });
});

describe("shops", () => {
  const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
  const spots = allHotSpots(city);
  const shops = spots.filter((h) => h.kind === "shop");

  it("gives a town its shops, each with a pin, a map area and a unique id", () => {
    expect(shops.length).toBeGreaterThanOrEqual(5);
    expect(new Set(spots.map((h) => h.id)).size).toBe(spots.length);
    for (const s of shops) {
      expect(s.trade).toBeDefined();
      expect(s.label).toBe(TRADES[s.trade!].label);
      expect(s.area!.w).toBeGreaterThanOrEqual(26);
      expect(s.onDemand).toBe(true);
    }
    expect(shops.map((s) => s.trade)).toEqual(expect.arrayContaining(["blacksmith", "merchant", "baker", "butcher", "herbalist"]));
    // The same city gives the same shops.
    expect(allHotSpots(city).filter((h) => h.kind === "shop").map((h) => [h.id, h.at])).toEqual(shops.map((h) => [h.id, h.at]));
  });

  it("sells from a counter on a shop floor that takes the street door, a store behind, no bedrooms", () => {
    const shape: V[] = [[0, 0], [12, 0], [12, 7], [0, 7]];
    const s = furnishBuilding({ key: "s1", shape, door: [3, 7], kind: "house", trade: "merchant", plan, cat, style, zone: "streets" });
    expect(s.rooms).toEqual(["shop.merchant", "tavern.storage"]);
    const counter = s.placed.find((p) => p.room === "shop.merchant" && p.feature === "counter");
    expect(counter).toBeDefined();
    // Goods on the counter.
    expect(s.placed.some((p) => p.parent === counter!.key)).toBe(true);
    // A big shop: a store and a workroom, still no family rooms (a shop full of beds reads as a house).
    const big = furnishBuilding({ key: "s2", shape: [[0, 0], [16, 0], [16, 10], [0, 10]], door: [5, 10], kind: "house", trade: "baker", plan, cat, style, zone: "streets" });
    expect(big.rooms[0]).toBe("shop.baker");
    for (const r of big.rooms) expect(["house.bedroom", "house.home", "house.living"]).not.toContain(r);
  });

  it("gives every shop a front to the street: a sign in its trade's colour, its goods, a mat, its tiles", () => {
    let fronts = 0;
    for (const h of shops) {
      const p = hotspotPlan(city, h, { key: "0123456789abcdef", prefix: "testburg" });
      const m = generate(p, cat, { city, date: new Date(2026, 10, 6), houses: "roofs" });
      const v = m.versions[0]!;
      const level = (v.map as Record<string, any>).world.levels["0"];
      const sq = (pts: string) => parseVector2Array(pts).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V);
      const houses = (level.walls ?? []).filter((w: any) => w.loop && String(v.elements[String(w.node_id)]?.key ?? "").startsWith("house")).map((w: any) => sq(w.points));
      const signs = v.placed.filter((q) => q.feature === "shop_signs");
      const goods = v.placed.filter((q) => q.feature === "shop_goods");
      for (const s of signs) {
        // Each sign wears a shop's colour, through the sign's Colorable twin.
        expect(s.asset.colorable).toBe(true);
        expect(Object.values(STOREFRONTS).map((f) => f!.color)).toContain(s.customColor);
      }
      // Goods stand out in the street, never inside a building.
      for (const g of goods) expect(houses.some((hs: V[]) => inPoly(centre(g), hs)), `${g.asset.name} on ${h.id}`).toBe(false);
      // The map's own shop shows its colour.
      if (signs.some((s) => s.customColor === STOREFRONTS[h.trade!]?.color)) fronts++;
      // Shops stand on terracotta tiles; homes keep their boards.
      const tiles = Object.entries(v.elements).filter(([, e]) => e.kind === "floor" && /Terracotta/.test(e.asset ?? "")).length;
      if (signs.length) expect(tiles, h.id).toBeGreaterThan(0);
    }
    expect(fronts).toBeGreaterThanOrEqual(Math.ceil(shops.length / 2));
  });

  it("leaves the secret places unmarked: no sign, no goods", () => {
    for (const t of Object.keys(TRADES) as Array<keyof typeof TRADES>) if (TRADES[t].secret) expect(STOREFRONTS[t]).toBeUndefined();
  });
});

describe("services, the law, the underworld and the nobles", () => {
  const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
  const spots = allHotSpots(city);
  const trades = spots.filter((h) => h.kind === "shop").map((h) => h.trade!);

  it("adds services after the shops and hides the underworld from players", () => {
    expect(trades).toEqual(expect.arrayContaining(["healer", "watch_house", "alehouse", "beggars_den", "thieves_den", "fence"]));
    for (const h of spots.filter((x) => x.kind === "shop")) expect(!!h.secret, h.id).toBe(!!TRADES[h.trade!].secret);
    expect(spots.find((h) => h.trade === "thieves_den")?.secret).toBe(true);
    expect(spots.find((h) => h.trade === "healer")?.secret).toBeUndefined();
    // Every place has an icon for its pin.
    for (const h of spots.filter((x) => x.kind === "shop" || x.kind === "mansion" || x.kind === "garrison" || x.kind === "stable")) expect(h.icon, h.id).toMatch(/^icons\/svg\//);
  });

  it("locks the gaol's cells", () => {
    const gaol = furnishBuilding({ key: "g", shape: [[0, 0], [12, 0], [12, 9], [0, 9]], door: [6, 9], kind: "house", trade: "gaol", plan, cat, style, zone: "streets" });
    expect(gaol.rooms[0]).toBe("gaol.guardroom");
    expect(gaol.rooms.filter((r) => r === "gaol.cell").length).toBeGreaterThanOrEqual(3);
    expect(gaol.walls.some((w) => w.locked?.some(Boolean))).toBe(true);
    expect(gaol.floor).toBe("stone");
  });

  it("gives a mansion a hall, a dining room and more, and a garrison its barracks", () => {
    const mansion = furnishBuilding({ key: "m", shape: [[0, 0], [12, 0], [12, 11], [0, 11]], door: [6, 11], kind: "mansion", plan, cat, style, zone: "streets" });
    expect(mansion.rooms[0]).toBe("gothic.hall");
    expect(mansion.rooms).toContain("gothic.dining");
    expect(mansion.rooms.length).toBeGreaterThanOrEqual(4);
    const garrison = furnishBuilding({ key: "q", shape: [[0, 0], [16, 0], [16, 14], [0, 14]], door: [8, 14], kind: "garrison", plan, cat, style, zone: "streets" });
    expect(garrison.rooms[0]).toBe("guard.mess");
    expect(garrison.rooms).toEqual(expect.arrayContaining(["guard.barracks", "guard.armoury", "guard.office"]));
    expect(garrison.placed.some((p) => p.room === "guard.barracks" && p.type.startsWith("bed"))).toBe(true);
  });
});
