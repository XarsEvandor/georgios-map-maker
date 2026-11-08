/** Cities from the Medieval Fantasy City Generator export: parsing, hot spots, plans and street maps. */

import { describe, expect, it } from "vitest";
import { areaPlan, Catalog, findHotSpots, gates, generate, hotspotPlan, parseCity, parseVector2Array, validatePlan, ZONE_TYPES } from "../src/index";
import { testIndex, townJson } from "./fixtures";

const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);

describe("parseCity", () => {
  it("reads every layer and flips y to screen space", () => {
    expect(city.buildings).toHaveLength(25);
    expect(city.walls).toHaveLength(2);
    expect(city.districts.map((d) => d.name)).toEqual(["Castle", "Old Town"]);
    // The keep is drawn at y 95..135 (north); on screen it is above the square.
    const keep = city.buildings[24]!;
    expect(Math.max(...keep.map((p) => p[1]))).toBeLessThan(0);
    expect(city.roadWidth).toBe(8);
  });
  it("refuses something that isn't a city export", () => {
    expect(() => parseCity({ nope: 1 }, { url: "x" })).toThrow();
  });
});

describe("hot spots", () => {
  const hs = findHotSpots(city);
  const by = (id: string) => hs.find((h) => h.id === id);
  it("finds the market, keep, temple, tavern, main gate and docks", () => {
    expect(hs.map((h) => h.id).sort()).toEqual(["docks", "gate", "keep", "market", "tavern", "temple"]);
    expect(by("market")!.area!.w).toBeGreaterThanOrEqual(55);
    expect(by("keep")!.building).toBe(city.buildings[24]);
    // The road enters the town wall on its west side at y 0.
    expect(gates(city)[0]![0]).toBeCloseTo(-120, 0);
    expect(by("tavern")!.building).toBeDefined();
  });
  it("makes valid plans: street areas for the market, gate and docks; interiors for the rest", () => {
    for (const h of hs) {
      const plan = hotspotPlan(city, h, { key: "0123456789abcdef", prefix: "testburg" });
      expect(validatePlan(plan, ZONE_TYPES)).toEqual([]);
      expect(!!plan.street).toBe(["market", "gate", "docks"].includes(h.kind));
    }
  });
});

describe("street maps", () => {
  it("builds walled, roofed houses, cobbles and the city wall with a gap at the gate", () => {
    const gate = findHotSpots(city).find((h) => h.id === "gate")!;
    const plan = hotspotPlan(city, gate, { key: "0123456789abcdef", prefix: "testburg" });
    const g = generate(plan, cat, { city, date: new Date(2026, 10, 6) });
    const v = g.versions[0]!;
    expect(g.layout.map.w).toBe(Math.round(gate.area!.w / 1.524));
    const els = Object.values(v.elements);
    expect(els.filter((e) => e.kind === "wall" && e.key.startsWith("house#")).length).toBeGreaterThan(0);
    expect(els.filter((e) => e.kind === "wall" && e.key.startsWith("citywall")).length).toBeGreaterThan(0);
    // No city wall crosses the middle of the gate.
    const level = (v.map as any).world.levels["0"];
    const gx = (gates(city)[0]![0] - plan.street!.area.x) / 1.524 * 256, gy = (gates(city)[0]![1] - plan.street!.area.y) / 1.524 * 256;
    const walls = (level.walls as Array<{ points: string; node_id: string }>).filter((w) => v.elements[w.node_id]?.key.startsWith("citywall")).map((w) => parseVector2Array(w.points));
    expect(walls.length).toBeGreaterThan(0);
    const onWall = walls.some((pts) => pts.some((a, i) => {
      const b = pts[i + 1];
      if (!b) return false;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((gx - a[0]) * (b[0] - a[0]) + (gy - a[1]) * (b[1] - a[1])) / (len * len);
      return t > 0 && t < 1 && Math.abs((gx - a[0]) * (b[1] - a[1]) - (gy - a[1]) * (b[0] - a[0])) / len < 40;
    }));
    expect(onWall).toBe(false);
  });
  it("paints the same ground every time, and draws roads as paths when the 2MT ground set is missing", () => {
    const gate = findHotSpots(city).find((h) => h.id === "gate")!;
    const plan = hotspotPlan(city, gate, { key: "0123456789abcdef", prefix: "testburg" });
    const a = generate(plan, cat, { city, date: new Date(2026, 10, 6) }).versions[0]!;
    const b = generate(plan, cat, { city, date: new Date(2026, 10, 6) }).versions[0]!;
    const terrain = (v: typeof a) => (v.map as any).world.levels["0"].terrain;
    expect(terrain(a).splat).toBe(terrain(b).splat);
    expect(terrain(a).splat.length).toBeGreaterThan(0);
    // The test library has no Fort Foul Luck or Grass & Road textures: roads come back as road paths.
    expect(Object.values(a.elements).some((e) => e.kind === "path" && e.key.startsWith("road#"))).toBe(true);
  });
  it("keeps any area the DM picks to a battle-map size", () => {
    const plan = areaPlan(city, { x: -100, y: -100, w: 400, h: 20 }, { key: "0123456789abcdef", prefix: "testburg", id: "a", title: "t" });
    expect(plan.street!.area.w).toBe(120);
    expect(plan.street!.area.h).toBe(20);
    expect(validatePlan(plan, ZONE_TYPES)).toEqual([]);
  });
});
