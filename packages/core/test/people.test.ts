/** Townsfolk on building-level maps (gen/people.ts): who stands where, and nobody in a wall, a house, the water or another person. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allHotSpots, Catalog, generate, hotspotPlan, parseCity, parseVector2Array, placePeople, PX_PER_SQUARE, RECIPE_BY_TYPE, TRADES, type GeneratedMap, type Person, type ScenePlan } from "../src/index";
import { testIndex, townJson } from "./fixtures";

type V = [number, number];
const tavern = JSON.parse(readFileSync(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
const g = generate(tavern, new Catalog(testIndex(), ["fantasy"]));
const v = g.versions[0]!;
const at = (time: "day" | "dusk" | "night", m: GeneratedMap = g, seed: string | number = tavern.seed) =>
  placePeople({ layout: m.layout, placed: m.versions[0]!.placed, map: m.versions[0]!.map as Record<string, any>, elements: m.versions[0]!.elements, seed, time });

function wallSegments(map: Record<string, any>): Array<[V, V]> {
  const out: Array<[V, V]> = [];
  for (const w of map.world.levels["0"].walls ?? []) {
    const pts = parseVector2Array(w.points).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V);
    for (let i = 0; i + 1 < pts.length + (w.loop ? 1 : 0); i++) out.push([pts[i]!, pts[(i + 1) % pts.length]!]);
  }
  return out;
}
function segDist(p: V, a: V, b: V): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inPoly(p: V, poly: V[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}
function sane(people: Person[], map: Record<string, any>, w: number, h: number) {
  const walls = wallSegments(map);
  for (const p of people) {
    expect(p.x).toBeGreaterThanOrEqual(0.5);
    expect(p.y).toBeGreaterThanOrEqual(0.5);
    expect(p.x).toBeLessThanOrEqual(w - 0.5);
    expect(p.y).toBeLessThanOrEqual(h - 0.5);
    expect(Math.hypot(...p.facing)).toBeCloseTo(1, 5);
    expect(p.name).toMatch(/^[A-Z][a-z]+$/);
  }
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) expect(Math.hypot(people[i]!.x - people[j]!.x, people[i]!.y - people[j]!.y)).toBeGreaterThan(0.69);
  // Standing people keep off the walls (seats may stand against one).
  for (const p of people.filter((x) => !/patron|worshipper|at table|asleep/.test(x.role))) for (const [a, b] of walls) expect(segDist([p.x, p.y], a, b)).toBeGreaterThan(0.38);
}

describe("people in a tavern", () => {
  const day = at("day"), dusk = at("dusk"), night = at("night");

  it("is the same every time for a seed and time", () => {
    expect(at("day")).toEqual(day);
    expect(at("day", g, "another seed")).not.toEqual(day);
  });

  it("keeps everyone on the map, apart, and off the walls", () => {
    for (const ps of [day, dusk, night]) sane(ps, v.map, g.layout.map.w, g.layout.map.h);
  });

  it("puts a barkeep behind the bar, facing the customers", () => {
    const bar = v.placed.find((p) => p.type === "bar_counter")!;
    const keep = day.find((p) => p.role === "barkeep")!;
    expect(keep).toBeDefined();
    const f = bar.facing!;
    expect((keep.x - bar.x) * f[0] + (keep.y - bar.y) * f[1]).toBeLessThan(0);
    expect(keep.facing[0] * f[0] + keep.facing[1] * f[1]).toBeGreaterThan(0.99);
  });

  it("seats patrons on the chairs, stools and benches, facing the way the seat faces", () => {
    const seats = v.placed.filter((p) => ["chair", "stool", "bench"].includes(p.type));
    const patrons = day.filter((p) => p.role === "patron");
    expect(patrons.length).toBeGreaterThan(3);
    for (const p of patrons) {
      const s = seats.find((x) => Math.hypot(x.x - p.x, x.y - p.y) < Math.max(...x.footprint) / 2 + 0.05)!;
      expect(s, `${p.name} at ${p.x},${p.y}`).toBeDefined();
      expect(p.facing[0] * s.facing![0] + p.facing[1] * s.facing![1]).toBeGreaterThan(0.99);
    }
  });

  it("is busier in the evening, and guests sleep in the beds at night", () => {
    expect(dusk.filter((p) => p.role === "patron").length).toBeGreaterThan(night.filter((p) => p.role === "patron").length);
    expect(day.some((p) => p.asleep)).toBe(false);
    const beds = v.placed.filter((p) => p.type.startsWith("bed"));
    for (const p of night.filter((x) => x.asleep)) expect(beds.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 1)).toBe(true);
  });

  it("puts a cook in the kitchen", () => {
    const kitchen = g.layout.zones.find((z) => z.type === "tavern.kitchen")!.rect;
    const cook = day.find((p) => p.role === "cook")!;
    expect(cook.x).toBeGreaterThan(kitchen.x);
    expect(cook.x).toBeLessThan(kitchen.x + kitchen.w);
    expect(cook.y).toBeGreaterThan(kitchen.y);
    expect(cook.y).toBeLessThan(kitchen.y + kitchen.h);
  });
});

describe("people on the street", () => {
  const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
  const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);
  const spots = allHotSpots(city).filter((h) => h.area);

  // Shopkeepers and their customers stand inside the shops; everyone else stays out of the houses.
  const indoors = new Set([...Object.values(TRADES).map((t) => t.keeper), "customer", "patient", "healer", "guard", "prisoner", "beggar", "thief", "noble", "gambler", "gaoler", "captain", "patron", "bather"]);

  it("keeps everyone out of the houses and the water, and puts guards at the gate", () => {
    let guards = 0, keepers = 0;
    for (const h of spots) {
      const plan = hotspotPlan(city, h, { key: "0123456789abcdef", prefix: "testburg" });
      const m = generate(plan, cat, { city, date: new Date(2026, 10, 6) });
      const mv = m.versions[0]!;
      const people = at("day", m, plan.seed);
      sane(people, mv.map, m.layout.map.w, m.layout.map.h);
      const level = (mv.map as Record<string, any>).world.levels["0"];
      const key = (id: unknown) => mv.elements[String(id)]?.key ?? "";
      const houses = (level.walls ?? []).filter((w: any) => key(w.node_id).startsWith("house") && w.loop).map((w: any) => parseVector2Array(w.points).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V));
      const poly = (pt: any) => parseVector2Array(pt.points).map(([x, y]) => [x / PX_PER_SQUARE, y / PX_PER_SQUARE] as V);
      const water = (level.patterns ?? []).filter((pt: any) => key(pt.node_id).startsWith("water")).map(poly);
      const decks = (level.patterns ?? []).filter((pt: any) => /^(pier|wharf)/.test(key(pt.node_id))).map(poly);
      for (const p of people.filter((x) => x.role !== "sailor")) {
        const inHouse = houses.some((hs: V[]) => inPoly([p.x, p.y], hs));
        expect(inHouse, `${p.role} ${indoors.has(p.role) ? "out of" : "in"} a house on ${h.id}`).toBe(indoors.has(p.role));
        if (water.some((wp: V[]) => inPoly([p.x, p.y], wp))) expect(decks.some((d: V[]) => inPoly([p.x, p.y], d)), `${p.role} in the water on ${h.id}`).toBe(true);
      }
      guards += people.filter((p) => p.role === "gate guard").length;
      // Every trade's map has its own keeper in: shops, services, crafts and dens alike.
      if (h.trade) {
        expect(people.some((p) => p.role === TRADES[h.trade!].keeper), `${TRADES[h.trade!].keeper} on ${h.id}`).toBe(true);
        keepers++;
      }
    }
    expect(spots.some((h) => h.kind === "gate")).toBe(true);
    expect(guards).toBeGreaterThan(0);
    expect(keepers).toBeGreaterThan(0);
  });

  it("finds a keeper a place in every trade's room, counter or not", () => {
    const rooms = new Set(Object.values(TRADES).map((t) => t.room));
    for (const room of rooms) {
      const r = RECIPE_BY_TYPE.get(room);
      expect(r, room).toBeDefined();
      expect(r!.steps.some((s) => s.id === "counter" || ("essential" in s && s.essential)), `${room} has a counter or a main piece`).toBe(true);
    }
  });

  it("empties the market at night", () => {
    const market = spots.find((h) => h.kind === "market");
    if (!market) return;
    const plan = hotspotPlan(city, market, { key: "0123456789abcdef", prefix: "testburg" });
    const m = generate(plan, cat, { city, date: new Date(2026, 10, 6) });
    expect(at("night", m, plan.seed).filter((p) => p.role === "vendor")).toHaveLength(0);
  });
});
