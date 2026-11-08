/** Hostile and careless inputs: the generator must refuse or cope, never hang or crash. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Catalog, generate, validatePlan, ZONE_TYPES, type ScenePlan } from "../src/index";
import { testIndex } from "./fixtures";

const tavern = JSON.parse(readFileSync(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
const cat = new Catalog(testIndex(), ["fantasy"]);
const paths = (p: unknown) => validatePlan(p, ZONE_TYPES).map((i) => i.path);

describe("plan validation against hostile input", () => {
  it("rejects prototype keys and free text in mood", () => {
    expect(paths({ ...tavern, mood: { time: "__proto__" } })).toContain("mood.time");
    expect(paths({ ...tavern, mood: { lighting: "hearth and candle light" } })).toContain("mood.lighting");
  });
  it("caps counts, titles, picks and lock regions", () => {
    expect(paths({ ...tavern, directives: [{ id: "m", modify: "table_sets", count: 1e9 }] })).toContain("directives[0].count");
    expect(paths({ ...tavern, directives: [{ id: "m", modify: "table_sets", count: { max: -1 } }] })).toContain("directives[0].count");
    expect(paths({ ...tavern, title: "x".repeat(500) })).toContain("title");
    expect(paths({ ...tavern, versions: { picked: "../v1" } })).toContain("versions.picked");
    expect(paths({ ...tavern, locks: [{ id: "l", region: { x: NaN, y: 0, w: 1, h: 1 } }] })).toContain("locks[0].region");
    expect(paths({ ...tavern, locks: [{ id: "l", elements: ["<script>"] }] })).toContain("locks[0].elements");
    expect(paths({ ...tavern, locks: [{ id: "l" }] })).toContain("locks[0]");
  });
  it("rejects ids that could become paths or markup", () => {
    expect(paths({ ...tavern, id: "../../etc" })).toContain("id");
    expect(paths({ ...tavern, id: "<img onerror=x>" })).toContain("id");
  });
});

describe("generator against careless plans", () => {
  it("builds an outdoor-only graveyard with no walls", () => {
    const plan: ScenePlan = { id: "yard", seed: 3, genre: "gothic", size: { w: 20, h: 16 }, levels: [{ id: "g", zones: [{ id: "y", type: "gothic.graveyard" }] }] };
    const g = generate(plan, new Catalog(testIndex(), ["fantasy", "victorian"]));
    const level = (g.versions[0]!.map.world as any).levels["0"];
    expect(level.walls).toHaveLength(0);
    expect(g.versions[0]!.placed.some((p) => p.type === "gravestone")).toBe(true);
  });

  it("says which zones did not fit instead of silently dropping them", () => {
    const plan: ScenePlan = {
      id: "tiny", seed: 1, genre: "medieval", size: { w: 8, h: 8 },
      levels: [{ id: "g", zones: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, type: "tavern.guest_room" })) }],
    };
    const g = generate(plan, cat);
    expect(g.versions[0]!.notes.join(" ")).toMatch(/left out/);
  });

  it("survives directives that point at nothing", () => {
    const plan: ScenePlan = {
      ...tavern,
      directives: [
        { id: "p1", pin: "unicorn", zone: "common" },
        { id: "r1", restyle: "table", from: "nonexistent:99" },
        { id: "p2", pin: "table", zone: "common", at: { near: "missing-thing", offset: [70, -70] } },
      ],
    };
    const g = generate(plan, cat);
    expect(g.versions[0]!.notes.join(" ")).toMatch(/unicorn/);
    expect(g.versions[0]!.placed.length).toBeGreaterThan(10);
  });

  it("finishes quickly on the largest allowed map", () => {
    const t0 = Date.now();
    const big: ScenePlan = { ...tavern, size: { w: 80, h: 80 }, directives: [] };
    generate(big, cat);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
