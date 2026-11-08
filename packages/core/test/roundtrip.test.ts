import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adoptSavedMap, Catalog, diffMaps, formatVector2, generate, parseVector2, toFoundryScene, type ScenePlan } from "../src/index";
import { testIndex } from "./fixtures";

const tavern = JSON.parse(readFileSync(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
const cat = new Catalog(testIndex(), ["fantasy"]);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("Dungeondraft round trip", () => {
  const g = generate(tavern, cat, { date: new Date(2026, 10, 6) });
  const v = g.versions[0]!;

  it("reports no changes for an untouched save", () => {
    const r = diffMaps(v.map, clone(v.map), v.elements);
    expect(r.changes).toEqual([]);
    expect(r.locks).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });

  it("turns moves, additions and deletions into locks", () => {
    const saved = clone(v.map) as any;
    const objs = saved.world.levels["0"].objects;
    const moved = objs[0];
    const [x, y] = parseVector2(moved.position);
    moved.position = formatVector2([x + 256, y]);
    const removed = objs.splice(1, 1)[0];
    objs.push({ ...objs[2], node_id: "fff0", position: formatVector2([512, 512]) });
    const r = diffMaps(v.map, saved, v.elements, "s1-");
    const kinds = r.changes.map((c) => `${c.kind}:${c.nodeId}`);
    expect(kinds).toEqual(expect.arrayContaining([`moved:${moved.node_id}`, `removed:${removed.node_id}`, "added:fff0"]));
    expect(r.locks.some((l) => l.elements?.includes(moved.node_id))).toBe(true);
    expect(r.locks.some((l) => l.elements?.includes("fff0"))).toBe(true);
    expect(r.locks.some((l) => l.region)).toBe(true);
    expect(r.locks.every((l) => l.id.startsWith("s1-") && l.source === "dm-dungeondraft")).toBe(true);
  });

  it("flags edits it can't express as directives", () => {
    const saved = clone(v.map) as any;
    saved.world.levels["0"].texts.push({ text: "Here be dragons" });
    saved.world.levels["1"] = clone(saved.world.levels["0"]);
    const r = diffMaps(v.map, saved, v.elements);
    expect(r.unmapped.join(" ")).toMatch(/texts edited/);
    expect(r.unmapped.join(" ")).toMatch(/level count/);
  });

  it("keeps a hand-moved piece through regeneration with a new seed", () => {
    const saved = clone(v.map) as any;
    const objs = saved.world.levels["0"].objects;
    const target = objs.find((o: any) => v.elements[o.node_id]?.feature === "bar");
    target.position = formatVector2([3 * 256, 3 * 256]);
    const r = diffMaps(v.map, saved, v.elements);
    const adopted = adoptSavedMap(saved, v, g.layout, cat);
    const previous = { ...g, plan: { ...tavern, versions: { picked: "v1" } }, versions: [adopted, ...g.versions.slice(1)] };
    const plan2: ScenePlan = { ...tavern, seed: 99, versions: { count: 2, picked: "v1" }, locks: r.locks };
    const g2 = generate(plan2, cat, { previous });
    for (const ver of g2.versions) {
      const bar = ver.placed.find((p) => p.key === v.elements[target.node_id]!.key);
      expect(bar?.x).toBeCloseTo(3);
      expect(bar?.y).toBeCloseTo(3);
    }
  });
});

describe("Foundry scene conversion", () => {
  const g = generate(tavern, cat);
  const v = g.versions[0]!;
  const scene = toFoundryScene(v.map, { name: "Tavern", pps: 100 });

  it("sizes the scene to the render", () => {
    expect(scene.width).toBe(g.layout.map.w * 100);
    expect(g.layout.map.w).toBeLessThanOrEqual(tavern.size.w);
    expect(scene.grid.size).toBe(100);
    expect(scene.darkness).toBeGreaterThan(0.3); // night plan
  });

  it("splits walls around doors and marks the door pieces", () => {
    const doors = scene.walls.filter((w) => w.door === 1);
    expect(doors.length).toBe(g.layout.doors.length);
    for (const d of doors) {
      const len = Math.hypot(d.c[2] - d.c[0], d.c[3] - d.c[1]);
      expect(len).toBeGreaterThan(90);
      expect(len).toBeLessThan(110);
    }
    expect(scene.walls.filter((w) => w.door === 0).length).toBeGreaterThan(4);
  });

  it("converts lights with ranges in feet", () => {
    expect(scene.lights.length).toBe(v.summary.lights);
    for (const l of scene.lights) expect(l.config.dim % 5).toBe(0);
  });
});
