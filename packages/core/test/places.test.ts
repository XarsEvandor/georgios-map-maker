/** Places of interest chosen by city size and location (city/places.ts), and the ships and features houses.ts lays out for them. */

import { describe, expect, it } from "vitest";
import { allHotSpots, cityPlaces, hotspotPlan, inside, parseCity, placeHouses, townSize, validatePlan, ZONE_TYPES, type AssetRecord, type HouseArt, type Pt, type Ring } from "../src/index";

const sq = (x: number, y: number, s: number, t = s) => [[x, y], [x + s, y], [x + s, y + t], [x, y + t], [x, y]];

/**
 * A walled port in MFCG's GeoJSON shape (y up): `n` houses in a grid inside the wall, a road
 * through east and west gates, a market and a big temple by it, a castle with its keep, three
 * districts, the sea to the south with five piers and warehouses by them, fields to the east.
 */
function port(n: number) {
  const houses: number[][][][] = [];
  const cols = Math.ceil(Math.sqrt(n * 1.15));
  const cell = 380 / cols;
  let k = 0;
  for (let j = 0; j < cols && k < n; j++) for (let i = 0; i < cols && k < n; i++) {
    const x = -190 + i * cell, y = -190 + j * cell;
    if (Math.abs(y + cell / 2) < 4) continue; // the road
    houses.push([sq(x, y, cell * 0.9)]);
    k++;
  }
  houses.push([sq(25, 25, 22, 18)]); // the temple, by the market
  houses.push([sq(-40, -40, 18, 18)]); // a hall on the market square
  houses.push([sq(-15, 160, 30, 25)]); // the keep
  for (const x of [-110, -70, -30]) houses.push([sq(x, -224, 10, 10)]); // warehouses by the piers
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "values", roadWidth: 8, towerRadius: 6, wallThickness: 6 },
      { type: "GeometryCollection", id: "roads", geometries: [{ type: "LineString", width: 8, coordinates: [[-320, 0], [0, 0], [330, 0]] }] },
      { type: "GeometryCollection", id: "walls", geometries: [{ type: "Polygon", width: 6, coordinates: [sq(-200, -200, 400)] }] },
      { type: "GeometryCollection", id: "planks", geometries: [-100, -60, -20, 20, 60].map((x) => ({ type: "LineString", width: 4.8, coordinates: [[x, -226], [x, -258]] })) },
      { type: "MultiPolygon", id: "buildings", coordinates: houses },
      { type: "MultiPolygon", id: "squares", coordinates: [[sq(-20, -20, 40)]] },
      { type: "MultiPolygon", id: "prisms", coordinates: [[sq(-2, -2, 4)]] },
      { type: "MultiPolygon", id: "fields", coordinates: [[sq(240, 20, 80, 60)], [sq(240, -90, 80, 60)]] },
      { type: "MultiPolygon", id: "water", coordinates: [[sq(-400, -500, 800, 272)]] },
      {
        type: "GeometryCollection", id: "districts", geometries: [
          { type: "Polygon", name: "Castle", coordinates: [sq(-40, 150, 80, 45)] },
          { type: "Polygon", name: "Old Town", coordinates: [sq(-200, -200, 200, 400)] },
          { type: "Polygon", name: "New Town", coordinates: [sq(0, -200, 200, 400)] },
        ],
      },
    ],
  };
}

function art(name: string, w: number, h: number, role: HouseArt["role"]): HouseArt {
  const asset = { id: `test:${role}:${name}`, name, size: [512, 512] } as unknown as AssetRecord;
  return { asset, w, h, off: [0, 0], big: false, role };
}
const ART: HouseArt[] = [
  art("cottage", 6, 9, "house"), art("long house", 11, 7.5, "house"), art("small", 4, 5.5, "house"), art("square", 10, 10, "house"),
  art("thatch", 9, 7, "rural"),
  art("church", 18, 27, "church"), art("chapel", 10.5, 10.5, "chapel"), art("spire", 6, 6.5, "spire"), art("parish", 13, 13, "parish"),
  art("keep", 20, 20, "keep"), art("tower", 11, 11, "castle"), art("tavern", 23, 15, "tavern"), art("inn", 23, 13, "inn"),
  art("guildhall", 33, 24, "guildhall"), art("warehouse", 7, 10, "warehouse"), art("stable", 11, 10, "stable"), art("wizard", 14, 14, "wizard"),
  art("lighthouse", 9.7, 9.7, "lighthouse"), art("windmill", 8.4, 8.3, "windmill"), art("neptune", 16, 16, "fountain_grand"), art("fountain", 16, 16, "fountain_large"), art("well", 5.6, 5.6, "fountain_medium"),
  art("gatehouse", 27, 20, "gatehouse"),
  art("galleon", 33, 10.6, "ship_large"), art("sailing ship", 13, 7.6, "ship_medium"), art("rowboat", 6, 3.3, "ship_small"), art("skiff", 1.9, 7.6, "ship_small"), art("galleon under sail", 40, 13.7, "ship_sailing"), art("barge", 14, 10.6, "barge"),
];

const large = parseCity(port(760), { name: "Bigport", url: "https://watabou.github.io/city-generator/?seed=11" });
const town = parseCity(port(200), { name: "Littleport", url: "https://watabou.github.io/city-generator/?seed=12" });

describe("town size and location", () => {
  it("sizes by building count", () => {
    expect(townSize(town)).toBe("town");
    expect(townSize(large)).toBe("large");
    expect(townSize({ ...town, buildings: Array.from({ length: 400 }, () => town.buildings[0]!) })).toBe("city");
  });
  it("reads coast, walls and farms, and finds each pier's landward end", () => {
    const p = cityPlaces(large);
    expect([p.coast, p.walled, p.farms, p.river]).toEqual([true, true, true, false]);
    expect(p.piers).toHaveLength(5);
    // The sea is to the south: on screen, every pier runs down from its landward end.
    for (const pier of p.piers) {
      expect(pier.sea[1]).toBeGreaterThan(pier.land[1]);
      expect(pier.length).toBeCloseTo(32, 5);
    }
  });
});

describe("places by size", () => {
  const big = cityPlaces(large), small = cityPlaces(town);
  const kinds = (p: ReturnType<typeof cityPlaces>) => new Set(p.plots.values());

  it("gives a large city a guildhall, an inn by the second gate, a wizard's tower and parish chapels", () => {
    const k = kinds(big);
    for (const want of ["church", "keep", "tavern", "guildhall", "inn", "wizard", "warehouse"]) expect(k.has(want as never), want).toBe(true);
    expect(k.has("parish" as never)).toBe(true);
    expect(big.gatehouses).toHaveLength(1);
    expect(big.fountains[0]?.size).toBe("grand");
  });

  it("keeps a town plain: no guildhall, inns, wizard's tower, parish chapels or gatehouse", () => {
    const k = kinds(small);
    for (const not of ["guildhall", "inn", "wizard", "parish"]) expect(k.has(not as never), not).toBe(false);
    expect(small.gatehouses).toHaveLength(0);
    // A town's market keeps its well.
    expect(small.fountains).toHaveLength(0);
    expect(small.windmills.length).toBeLessThanOrEqual(1);
  });

  it("puts warehouses by the piers and the lighthouse on land by the harbour", () => {
    const B = large.buildings;
    const warehouses = [...big.plots].filter(([, k]) => k === "warehouse").map(([i]) => i);
    expect(warehouses.length).toBeGreaterThanOrEqual(3);
    for (const i of warehouses) expect(Math.min(...big.piers.map((p) => Math.min(...B[i]!.map((q) => Math.hypot(q[0] - p.land[0], q[1] - p.land[1])))))).toBeLessThan(25);
    expect(big.lighthouse).toBeDefined();
    expect(large.water.some((w) => inside(big.lighthouse!.at, w))).toBe(false);
  });

  it("puts windmills in the fields, well apart", () => {
    expect(big.windmills.length).toBeGreaterThanOrEqual(1);
    for (const w of big.windmills) expect(large.fields.some((f) => inside(w.at, f))).toBe(true);
    for (let i = 0; i < big.windmills.length; i++) for (let j = i + 1; j < big.windmills.length; j++) expect(Math.hypot(big.windmills[i]!.at[0] - big.windmills[j]!.at[0], big.windmills[i]!.at[1] - big.windmills[j]!.at[1])).toBeGreaterThanOrEqual(150);
  });

  it("pins the new places to be built on demand, with valid plans", () => {
    const spots = allHotSpots(large, big);
    const onDemand = spots.filter((h) => h.onDemand).map((h) => h.kind).sort();
    expect(onDemand).toEqual(expect.arrayContaining(["inn", "lighthouse", "wizard"]));
    expect(spots.filter((h) => !h.onDemand).map((h) => h.kind)).not.toContain("wizard");
    for (const h of spots) expect(validatePlan(hotspotPlan(large, h, { key: "0123456789abcdef", prefix: "bigport" }), ZONE_TYPES), h.id).toEqual([]);
    expect(allHotSpots(town).some((h) => h.kind === "wizard")).toBe(false);
  });
});

describe("ships", () => {
  const corners = (r: Ring): Pt[] => r;
  const inSea = (city: typeof large, p: Pt) => city.water.some((w) => inside(p, w));

  it("moors big and small ships at a large port's piers, all on the water, none overlapping", () => {
    const layout = placeHouses(large, ART, large.url);
    const ships = layout.extras.filter((e) => e.landmark?.startsWith("ship_"));
    expect(ships.some((s) => s.landmark === "ship_large")).toBe(true);
    expect(ships.some((s) => s.landmark === "ship_small" || s.landmark === "ship_medium")).toBe(true);
    for (const s of ships) for (const p of corners(s.ring)) expect(inSea(large, p)).toBe(true);
    // No two ships share water: their centres sit at least half a beam apart and their boxes don't cross.
    for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i]!, b = ships[j]!;
      expect(inside(a.at, b.ring) || inside(b.at, a.ring)).toBe(false);
    }
    // No ship lies across a pier.
    for (const s of ships) for (const pier of layout.places.piers) expect(inside([(pier.land[0] + pier.sea[0]) / 2, (pier.land[1] + pier.sea[1]) / 2], s.ring)).toBe(false);
  });

  it("gives a town only small boats", () => {
    const layout = placeHouses(town, ART, town.url);
    const ships = layout.extras.filter((e) => e.landmark?.startsWith("ship_"));
    expect(ships.every((s) => s.landmark === "ship_small")).toBe(true);
  });

  it("lays the lighthouse, windmills, fountain and gatehouse out as features of a large city", () => {
    const layout = placeHouses(large, ART, large.url);
    const kinds = new Set(layout.extras.map((e) => e.landmark));
    for (const k of ["lighthouse", "windmill", "fountain_grand", "gatehouse"]) expect(kinds.has(k as never), k).toBe(true);
    expect(layout.bare).toEqual([]);
  });
});
