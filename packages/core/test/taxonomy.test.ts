import { describe, expect, it } from "vitest";
import { classify } from "../src/index";

const primary = (stem: string, pack = "2MT Furniture Map Assets", tags: string[] = []) =>
  classify(stem, pack, tags).types[0];

describe("classify", () => {
  it("uses the category-first 2MT style", () => {
    expect(primary("Chair, armchair, royal")).toBe("chair");
    expect(primary("Bed, small, single, cot")).toBe("bed");
    expect(primary("Barrels, stacked, pile")).toBe("barrel");
    expect(primary("Table - Broken 1 - Dark")).toBe("table");
    expect(primary("Door (2x1)", "2MT Castle Walls")).toBe("door");
  });

  it("uses the head noun of plain names", () => {
    expect(primary("Bench Dining Table 1", "2MT Typical Tavern")).toBe("table");
    expect(classify("Bench Dining Table 1", "2MT Typical Tavern").types).toContain("bench");
    expect(primary("Bar Stool 2")).toBe("stool");
    expect(primary("Dining table", "2M Sinister Cabin Pack")).toBe("table");
  });

  it("prefers the specific subtype in category-first 2M names", () => {
    expect(primary("Chair - Stool 5", "2M Forest Fungi Pack")).toBe("stool");
    expect(primary("Chair - Sofa 6.a", "2MT Mushroom Village Interiors Plus")).toBe("sofa");
    expect(primary("Chair - Throne 2 - Stone", "2MT Palatial Throne Plus")).toBe("throne");
    expect(primary("Chair - Armchair 1", "2MT Furniture Map Assets Plus")).toBe("chair");
    expect(primary("CHair, long bench", "2MT Mansion Furniture")).toBe("bench");
  });

  it("lets a specific type beat the generic Light category", () => {
    expect(primary("Light - Candle cluster", "2M Sinister Cabin Pack")).toBe("candle");
    expect(primary("Light - Candle Collection 1", "2M Forgotten Monastery")).toBe("candle");
  });

  it("splits jail bars from bar counters by pack", () => {
    expect(primary("Bars 1", "2MT Isometric Jail Plus")).toBe("jail_bars");
    expect(primary("Bar 1", "2M The Shanty Pack")).toBe("bar_counter");
    expect(classify("Metal bar", "2MT Metalsmith's Workshop Plus").types).not.toContain("bar_counter");
  });

  it("recognizes corpses only in the bodies packs", () => {
    expect(primary("Adventurer 1 - Bloody", "2MT Blood and Bodies Map Assets")).toBe("corpse");
    expect(classify("Adventurer 1", "2MT Hero Tokens 1").types).not.toContain("corpse");
  });

  it("does not confuse bedside tables or workbenches", () => {
    expect(primary("Table, bedside", "2MT Mansion Furniture")).toBe("table");
    expect(classify("Table, bedside", "2MT Mansion Furniture").types).not.toContain("bed");
    expect(classify("Workbench 1", "2MT Metalsmith's Workshop Plus").types).not.toContain("bench");
  });

  it("falls back to tags", () => {
    const c = classify("Asset 17", "2M Sinister Cabin Pack", ["skeleton"]);
    expect(c).toEqual({ types: ["skeleton"], source: "tag" });
    expect(classify("Asset 17", "2M Sinister Cabin Pack", ["clutter"])).toEqual({ types: [], source: "none" });
  });
});
