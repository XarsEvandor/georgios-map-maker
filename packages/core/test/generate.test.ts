import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Catalog, DDMapBuilder, generate, layoutBuilding, PlanError, Rng, validatePlan, ZONE_TYPES, parseVector2, type Placed, type ScenePlan } from "../src/index";
import { testIndex } from "./fixtures";

const tavern = JSON.parse(readFileSync(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
const chapel = JSON.parse(readFileSync(new URL("../../../examples/plans/gothic-chapel.json", import.meta.url), "utf8")) as ScenePlan;
const index = testIndex();
const cat = new Catalog(index, ["fantasy"]);

function overlaps(a: Placed, b: Placed): number {
  const ax = a.x - a.footprint[0] / 2, ay = a.y - a.footprint[1] / 2, bx = b.x - b.footprint[0] / 2, by = b.y - b.footprint[1] / 2;
  const w = Math.min(ax + a.footprint[0], bx + b.footprint[0]) - Math.max(ax, bx);
  const h = Math.min(ay + a.footprint[1], by + b.footprint[1]) - Math.max(ay, by);
  return w > 0 && h > 0 ? w * h : 0;
}

describe("validatePlan", () => {
  it("accepts the example plans", () => {
    expect(validatePlan(tavern, ZONE_TYPES)).toEqual([]);
    expect(validatePlan(chapel, ZONE_TYPES)).toEqual([]);
  });
  it("rejects bad plans with useful paths", () => {
    const bad = { ...tavern, size: { w: 500, h: 3 }, genre: "scifi", directives: [{ id: "x" }, { id: "x", forbid: "rug" }] };
    const issues = validatePlan(bad, ZONE_TYPES).map((i) => i.path);
    expect(issues).toEqual(expect.arrayContaining(["size.w", "size.h", "genre", "directives[0]", "directives[1].id", "directives[1].forbid"]));
    const unknown = { ...tavern, levels: [{ id: "g", zones: [{ id: "a", type: "tavern.ballpit" }] }] };
    expect(validatePlan(unknown, ZONE_TYPES)[0]!.message).toMatch(/unknown room type/);
    expect(validatePlan("not a plan")).toHaveLength(1);
  });
  it("caps runaway sizes", () => {
    const many = { ...tavern, directives: Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, forbid: ["rug"] })) };
    expect(validatePlan(many, ZONE_TYPES).some((i) => i.path === "directives")).toBe(true);
  });
});

describe("generate", () => {
  const g = generate(tavern, cat, { date: new Date(2026, 10, 6) });

  it("makes the requested number of versions with different anchors", () => {
    expect(g.versions).toHaveLength(3);
    expect(new Set(g.versions.map((v) => v.palette.anchorPack)).size).toBe(3);
  });

  it("is deterministic", () => {
    const again = generate(tavern, cat, { date: new Date(2026, 10, 6) });
    expect(JSON.stringify(again.versions[0]!.map)).toBe(JSON.stringify(g.versions[0]!.map));
  });

  it("connects every zone", () => {
    const zones = new Set(g.layout.zones.map((z) => z.id));
    const seen = new Set([g.layout.zones[0]!.id]);
    for (let i = 0; i < 10; i++) for (const d of g.layout.doors) if (seen.has(d.between[0]) && d.between[1] !== "outside") seen.add(d.between[1]);
    for (let i = 0; i < 10; i++) for (const d of g.layout.doors) if (seen.has(d.between[1])) seen.add(d.between[0]);
    expect([...zones].every((z) => seen.has(z))).toBe(true);
    expect(g.layout.doors.some((d) => d.between[1] === "outside")).toBe(true);
  });

  it("keeps blocking pieces apart and inside the map", () => {
    for (const v of g.versions) {
      const blocking = v.placed.filter((p) => p.layer === 300);
      for (const p of blocking) {
        const c = p.center ?? [p.x, p.y];
        expect(c[0]).toBeGreaterThan(0);
        expect(c[1]).toBeGreaterThan(0);
        expect(c[0]).toBeLessThan(tavern.size.w);
        expect(c[1]).toBeLessThan(tavern.size.h);
      }
      for (let i = 0; i < blocking.length; i++) {
        for (let j = i + 1; j < blocking.length; j++) {
          const a = blocking[i]!, b = blocking[j]!;
          if (a.parent === b.key || b.parent === a.key || (a.parent && a.parent === b.parent)) continue; // chairs tuck under their table
          if (a.directive || b.directive) continue; // the DM's pins go where the DM says
          expect(overlaps(a, b), `${a.key} overlaps ${b.key}`).toBeLessThan(0.08);
        }
      }
    }
  });

  it("applies pin, forbid and slot overrides", () => {
    for (const v of g.versions) {
      const pinned = v.placed.find((p) => p.key === "d1");
      expect(pinned?.type).toMatch(/^table/);
      const kids = v.placed.filter((p) => p.parent === "d1");
      expect(kids.some((k) => k.type === "chair")).toBe(false);
      expect(kids.some((k) => k.type === "corpse")).toBe(true);
      expect(v.placed.some((p) => p.zone === "kitchen" && p.type === "rug")).toBe(false);
    }
  });

  it("never uses packs outside the genre's settings", () => {
    for (const v of g.versions) expect(v.placed.some((p) => p.asset.pack === "SCIFI")).toBe(false);
  });

  it("lists every used pack in the map's asset manifest", () => {
    for (const v of g.versions) {
      const manifest = new Set(((v.map.header as { asset_manifest: Array<{ id: string }> }).asset_manifest).map((m) => m.id));
      const text = JSON.stringify(v.map);
      for (const m of text.matchAll(/res:\/\/packs\/([^/]+)\//g)) expect(manifest.has(m[1]!)).toBe(true);
    }
  });

  it("records an element for every node", () => {
    const v = g.versions[0]!;
    const level = (v.map.world as any).levels["0"];
    const ids = [...level.objects, ...level.walls, ...level.lights, ...level.patterns, ...level.paths].map((e: any) => e.node_id);
    for (const id of ids) expect(v.elements[id], id).toBeDefined();
    const maxId = Math.max(...ids.map((i: string) => parseInt(i, 16)));
    expect(parseInt((v.map.world as any).next_node_id, 16)).toBeGreaterThan(maxId);
  });

  it("keeps locked pieces when regenerating with a new seed", () => {
    const v1 = g.versions[0]!;
    const bar = v1.placed.find((p) => p.feature === "bar" && !p.parent)!;
    const nid = Object.entries(v1.elements).find(([, e]) => e.key === bar.key)![0];
    const relocked: ScenePlan = { ...tavern, seed: tavern.seed + 1, versions: { count: 3, picked: "v1" }, locks: [{ id: "l1", elements: [nid] }] };
    const g2 = generate(relocked, cat, { previous: { ...g, plan: { ...tavern, versions: { picked: "v1" } } } });
    for (const v of g2.versions) {
      const kept = v.placed.find((p) => p.key === bar.key);
      expect(kept?.x).toBe(bar.x);
      expect(kept?.asset.id).toBe(bar.asset.id);
      expect(v.placed.filter((p) => p.feature === "bar" && !p.parent)).toHaveLength(1);
    }
  });

  it("generates the gothic chapel with a yard", () => {
    const c = generate(chapel, cat);
    const v = c.versions[0]!;
    expect(v.placed.filter((p) => p.type === "gravestone").length).toBeGreaterThan(5);
    expect(v.placed.some((p) => p.zone === "nave" && p.type === "pew")).toBe(true);
    const b = c.layout.building;
    // No grave inside the building.
    for (const p of v.placed.filter((q) => q.type === "gravestone")) expect(p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h).toBe(false);
  });

  it("turns chairs to face their table", () => {
    for (const v of g.versions) {
      const byKey = new Map(v.placed.map((p) => [p.key, p]));
      const chairs = v.placed.filter((p) => p.type === "chair" && p.parent && byKey.get(p.parent)?.type.startsWith("table"));
      for (const c of chairs) {
        const t = byKey.get(c.parent!)!;
        const tc = t.center ?? [t.x, t.y], cc = c.center ?? [c.x, c.y];
        const dot = c.facing![0] * (tc[0] - cc[0]) + c.facing![1] * (tc[1] - cc[1]);
        expect(dot, `${c.key} faces away from ${t.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("crops a building-only map to the building plus a margin", () => {
    const L = g.layout;
    expect(L.map.w).toBeLessThanOrEqual(tavern.size.w);
    expect(L.building.x).toBeGreaterThanOrEqual(3);
    expect(L.map.w - (L.building.x + L.building.w)).toBeGreaterThanOrEqual(3);
  });

  it("breaks the outer wall of ruined buildings but keeps the doors", () => {
    const ruined = generate({ ...tavern, mood: { ...tavern.mood, wear: "ruined" } }, cat);
    expect(ruined.layout.breaches?.length).toBeGreaterThan(0);
    const v = ruined.versions[0]!;
    expect(Object.values(v.elements).filter((e) => e.kind === "wall" && e.key.startsWith("outer")).length).toBeGreaterThan(1);
    expect(Object.values(v.elements).filter((e) => e.kind === "door").length).toBe(ruined.layout.doors.length);
  });

  it("throws PlanError for invalid plans", () => {
    expect(() => generate({ ...tavern, size: { w: 1, h: 1 } }, cat)).toThrow(PlanError);
  });
});

describe("DDMapBuilder", () => {
  it("writes a map Dungeondraft's format expects", () => {
    const b = new DDMapBuilder({ width: 10, height: 6 });
    expect(() => b.addObject({ at: [0, 0], texture: "res://packs/NOPE/textures/objects/x.png" })).toThrow(/manifest/);
    b.usePack({ id: "P1", name: "p" });
    const w = b.addWall({ points: [[0, 0], [2560, 0]], texture: "res://packs/P1/textures/walls/w.png", doors: [{ at: [1280, 0] }] });
    expect(w.doors).toHaveLength(1);
    expect(() => b.addWall({ points: [[0, 0], [2560, 0]], doors: [{ at: [1280, 512] }] })).toThrow(/not on its wall/);
    const map = b.build() as any;
    const level = map.world.levels["0"];
    expect(map.world.format).toBe(3);
    expect(level.walls[0].portals[0].wall_id).toBe(level.walls[0].node_id);
    expect(parseVector2(level.walls[0].portals[0].position)).toEqual([1280, 0]);
    // Cave bitmap size observed in real maps: (2w + 3) * h + 2.
    expect(level.cave.bitmap.split(",").length).toBe((2 * 10 + 3) * 6 + 2);
    expect(level.terrain.splat.split(",").length).toBe(10 * 4 * 6 * 4 * 4);
    expect(() => new DDMapBuilder({ width: 0, height: 5 })).toThrow();
    expect(() => new DDMapBuilder({ width: 1e9, height: 5 })).toThrow();
  });
});

describe("outerWallRuns", () => {
  it("splits the outline loop around breaches", async () => {
    const { outerWallRuns } = await import("../src/index");
    const square: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(outerWallRuns(square)).toEqual([{ points: square, loop: true }]);
    const runs = outerWallRuns(square, [{ a: [4, 0], b: [6, 0] }, { a: [10, 3], b: [10, 5] }]);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => !r.loop)).toBe(true);
    const length = (pts: Array<[number, number]>) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
    expect(runs.reduce((s, r) => s + length(r.points), 0)).toBeCloseTo(40 - 4, 6);
  });
});

describe("a clearing in front of an enclosed building (plan.approach)", () => {
  const hall: ScenePlan = {
    id: "gallery", title: "Gallery", seed: 1897, genre: "gothic", size: { w: 16, h: 40 }, enclosed: true,
    mood: { time: "night", wear: "ruined", lighting: "dark" }, versions: { count: 1 },
    levels: [{ id: "ground", zones: [{ id: "corridor", type: "gothic.gallery", area: "large" }], connections: [{ id: "front_gate", from: "corridor", to: "outside", via: "gate", width: 4, state: "closed" }] }],
  };
  const wide: ScenePlan = { ...hall, approach: { depth: 12, width: 20 } };

  it("grows the map in front of the entrance and moves the building, leaving it as it was", () => {
    const a = layoutBuilding(hall, new Rng(hall.seed).fork("layout"));
    const b = layoutBuilding(wide, new Rng(wide.seed).fork("layout"));
    const dx = b.building.x - a.building.x, dy = b.building.y - a.building.y;
    expect(b.front).toBe(a.front);
    const vertical = a.front === "north" || a.front === "south";
    expect(vertical ? b.map.w : b.map.h).toBe(20);
    expect(vertical ? b.approach!.h : b.approach!.w).toBe(12);
    expect({ ...b.building, x: b.building.x - dx, y: b.building.y - dy }).toEqual(a.building);
    expect(b.zones.map((z) => ({ ...z.rect, x: z.rect.x - dx, y: z.rect.y - dy }))).toEqual(a.zones.map((z) => z.rect));
    expect(b.doors.map((d) => [d.at[0] - dx, d.at[1] - dy])).toEqual(a.doors.map((d) => d.at));
    expect(b.outline.map(([x, y]) => [x - dx, y - dy])).toEqual(a.outline);
  });

  it("dresses the rooms the same and the deep approach as a clearing", () => {
    const a = generate(hall, cat).versions[0]!, b = generate(wide, cat);
    const L = b.layout, base = layoutBuilding(hall, new Rng(hall.seed).fork("layout"));
    const dx = L.building.x - base.building.x, dy = L.building.y - base.building.y;
    const inside = (v: typeof a) => v.placed.filter((p) => p.zone === "corridor").map((p) => `${p.type}@${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    expect(inside({ ...b.versions[0]!, placed: b.versions[0]!.placed.map((p) => ({ ...p, x: p.x - dx, y: p.y - dy })) })).toEqual(inside(a));
    // Everything outdoors stands on the clearing.
    const ap = L.approach!;
    for (const p of b.versions[0]!.placed.filter((q) => q.zone !== "corridor")) {
      const [x, y] = p.center ?? [p.x, p.y];
      expect(x >= ap.x - 0.3 && x <= ap.x + ap.w + 0.3 && y >= ap.y - 0.3 && y <= ap.y + ap.h + 0.3).toBe(true);
    }
  });

  it("is checked: depth and width only, 2 to 80 squares", () => {
    expect(validatePlan(wide, ZONE_TYPES)).toEqual([]);
    expect(validatePlan({ ...hall, approach: { depth: 1 } }, ZONE_TYPES).map((i) => i.path)).toContain("approach.depth");
    expect(validatePlan({ ...hall, approach: { depth: 8, height: 3 } as never }, ZONE_TYPES).map((i) => i.path)).toContain("approach.height");
  });
});
