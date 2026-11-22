/** War maps (core gen/war.ts): an army's camp and the field between armies. */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Catalog, generate, GENRE_SETTINGS, validatePlan, ZONE_TYPES, type ScenePlan } from "@gmm/core";
import { loadIndex } from "../src/assets/load";
import { testIndex } from "../../core/test/fixtures";

const camp = (edge: "north" | "south" | "east" | "west" = "east"): ScenePlan => ({
  id: "test-camp", title: "Camp", seed: 7, genre: "medieval",
  size: edge === "north" || edge === "south" ? { w: 48, h: 40 } : { w: 40, h: 48 },
  mood: { time: "day", wear: "grimy" }, versions: { count: 1, picked: "v1" },
  levels: [{ id: "ground", zones: [{ id: "camp", type: "war.camp" }] }],
  war: { kind: "camp", sides: [{ name: "March", color: "#e07b1a", edge }] },
});
const field = (): ScenePlan => ({
  id: "test-field", title: "Field", seed: 8, genre: "medieval", size: { w: 80, h: 56 },
  mood: { time: "day", wear: "ruined" }, versions: { count: 1, picked: "v1" },
  levels: [{ id: "ground", zones: [{ id: "field", type: "war.field" }] }],
  war: { kind: "field", machines: 3, sides: [{ name: "March", color: "#e07b1a", edge: "west" }, { name: "Garanny", color: "#2e7d32", edge: "south" }, { name: "Theapley", color: "#7e3fa8", edge: "east" }] },
});

describe("war map plans", () => {
  it("accepts a camp and a field, and refuses broken war fields", () => {
    expect(validatePlan(camp(), ZONE_TYPES)).toEqual([]);
    expect(validatePlan(field(), ZONE_TYPES)).toEqual([]);
    const bad = (war: unknown) => validatePlan({ ...camp(), war }, ZONE_TYPES).map((i) => i.path);
    expect(bad({ kind: "siege", sides: [] })).toContain("war");
    expect(bad({ kind: "camp", sides: [{ name: "March", color: "orange" }] })).toContain("war.sides");
    expect(bad({ kind: "field", sides: [{ name: "A", color: "#000000", edge: "west" }] })).toContain("war.sides");
    expect(bad({ kind: "field", machines: 9, sides: [{ name: "A", color: "#000000", edge: "west" }, { name: "B", color: "#ffffff", edge: "east" }] })).toContain("war.machines");
    expect(validatePlan({ ...camp(), street: { city: "0123456789abcdef", area: { x: 0, y: 0, w: 50, h: 50 } } }, ZONE_TYPES).map((i) => i.path)).toContain("war");
  });

  it("builds without the camp packs, saying what is missing", () => {
    const cat = new Catalog(testIndex(), GENRE_SETTINGS.medieval);
    const g = generate(camp(), cat);
    expect(g.versions).toHaveLength(1);
    expect(g.versions[0]!.notes.join(" ")).toMatch(/palisade|command tent/);
  });
});

const real = existsSync("data/asset-index.json");
describe.skipIf(!real)("war maps with the 2MT library", async () => {
  const cat = real ? new Catalog(await loadIndex("data/asset-index.json"), GENRE_SETTINGS.medieval) : (undefined as never);

  it("makes a walled camp in the army's colour round an open command tent", () => {
    for (const edge of ["east", "north"] as const) {
      const v = generate(camp(edge), cat).versions[0]!;
      const els = Object.values(v.elements);
      expect(els.some((e) => e.kind === "wall" && e.key === "palisade")).toBe(true);
      const by = (f: string) => v.placed.filter((p) => p.feature === f);
      expect(by("command").some((p) => p.type === "tent")).toBe(true);
      expect(by("command").some((p) => p.type === "table_medium")).toBe(true);
      expect(v.sheltered?.length).toBe(1);
      // Banners, the officers' tents and the general's chair carry March's orange.
      const tinted = v.placed.filter((p) => p.customColor === "ffe07b1a").map((p) => p.type);
      expect(tinted).toEqual(expect.arrayContaining(["banner", "tent", "chair", "rug"]));
      expect(by("soldiers").length).toBeGreaterThanOrEqual(10);
      expect(by("fires").some((p) => p.light)).toBe(true);
      // Nothing lies outside the map.
      expect(v.placed.every((p) => p.x > -1 && p.y > -1 && p.x < 49 && p.y < 49)).toBe(true);
    }
  });

  it("makes the field: each side's banners, the dead, wrecks, and three glowing machines", () => {
    const g = generate(field(), cat);
    const v = g.versions[0]!;
    const machines = v.placed.filter((p) => p.type === "machine");
    expect(machines).toHaveLength(3);
    expect(machines.every((m) => m.light?.color === "ffb46cff")).toBe(true);
    for (const c of ["ffe07b1a", "ff2e7d32", "ff7e3fa8"]) expect(v.placed.some((p) => p.type === "banner" && p.customColor === c)).toBe(true);
    expect(v.placed.filter((p) => p.type === "corpse").length).toBeGreaterThan(40);
    expect(v.placed.filter((p) => p.feature === "wrecks" && p.type === "siege").length).toBeGreaterThanOrEqual(2);
    expect(Object.values(v.elements).filter((e) => e.kind === "path" && e.key.startsWith("cable")).length).toBe(3);
    // The same plan always gives the same map.
    expect(generate(field(), cat).versions[0]!.placed.length).toBe(v.placed.length);
  });
});
