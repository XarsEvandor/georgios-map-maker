/** Where the weather stays out (gen/layout.ts shelterOf, street maps' buildings, the Foundry export). */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allHotSpots, Catalog, generate, hotspotPlan, parseCity, parseVector2Array, PX_PER_SQUARE, toFoundryScene, type ScenePlan } from "../src/index";
import { testIndex, townJson } from "./fixtures";

type V = [number, number];
const plan = (name: string) => JSON.parse(readFileSync(new URL(`../../../examples/plans/${name}.json`, import.meta.url), "utf8")) as ScenePlan;

function inPoly(p: V, poly: V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

describe("weather stays out of buildings", () => {
  it("keeps it off a tavern's floor and lets it fall round it", () => {
    const g = generate(plan("tavern"), new Catalog(testIndex(), ["fantasy"]));
    for (const v of g.versions) {
      expect(v.sheltered).toEqual([{ points: g.layout.outline }]);
      const scene = toFoundryScene(v.map, { name: "t", pps: 100, sheltered: v.sheltered });
      expect(scene.sheltered).toHaveLength(1);
      expect(scene.sheltered[0]!.hole).toBeUndefined();
      expect(scene.sheltered[0]!.points).toEqual(g.layout.outline.flatMap(([x, y]) => [x * 100, y * 100]));
    }
    const b = g.layout.building;
    const shelter = g.layout.outline as V[];
    expect(inPoly([b.x + b.w / 2, b.y + b.h / 2], shelter)).toBe(true);
    if (b.x > 1) expect(inPoly([b.x - 1, b.y + b.h / 2], shelter)).toBe(false);
  });

  it("keeps it everywhere but the approach on an enclosed map", () => {
    const g = generate(plan("dracula-entrance"), new Catalog(testIndex(), ["fantasy", "victorian"]));
    const a = g.layout.approach!;
    expect(a).toBeDefined();
    const s = g.versions[0]!.sheltered!;
    expect(s).toHaveLength(2);
    expect(s[0]!.hole).toBeFalsy();
    expect(s[0]!.points).toEqual([[0, 0], [g.layout.map.w, 0], [g.layout.map.w, g.layout.map.h], [0, g.layout.map.h]]);
    expect(s[1]!.hole).toBe(true);
    expect(s[1]!.points).toEqual([[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]]);
    expect(toFoundryScene(g.versions[0]!.map, { name: "d", pps: 70, sheltered: s }).sheltered[1]).toEqual({ points: [a.x * 70, a.y * 70, (a.x + a.w) * 70, a.y * 70, (a.x + a.w) * 70, (a.y + a.h) * 70, a.x * 70, (a.y + a.h) * 70], hole: true });
  });

  it("keeps it out of every house shown from inside on a street map", () => {
    const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
    const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);
    let houses = 0;
    for (const h of allHotSpots(city).filter((x) => x.area).slice(0, 4)) {
      const p = hotspotPlan(city, h, { key: "0123456789abcdef", prefix: "testburg" });
      const m = generate(p, cat, { city, date: new Date(2026, 10, 6) });
      const v = m.versions[0]!;
      const shelters = (v.sheltered ?? []).map((s) => s.points as V[]);
      for (const s of v.sheltered ?? []) expect(s.hole).toBeFalsy();
      const level = (v.map as Record<string, any>).world.levels["0"];
      for (const w of level.walls ?? []) {
        if (!w.loop || !String(v.elements[String(w.node_id)]?.key ?? "").startsWith("house")) continue;
        const ring = parseVector2Array(w.points).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V);
        const mid: V = [ring.reduce((t, q) => t + q[0], 0) / ring.length, ring.reduce((t, q) => t + q[1], 0) / ring.length];
        if (!inPoly(mid, ring)) continue;
        houses++;
        expect(shelters.some((s) => inPoly(mid, s)), `house on ${h.id} at ${mid}`).toBe(true);
      }
      // Houses drawn with roofs (no interiors) get the weather on the roof.
      const roofed = generate(p, cat, { city, date: new Date(2026, 10, 6), interiors: false });
      expect(roofed.versions[0]!.sheltered).toEqual([]);
    }
    expect(houses).toBeGreaterThan(0);
  });
});
