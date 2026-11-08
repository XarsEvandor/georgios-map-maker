import { describe, expect, it } from "vitest";
import {
  conditionsOf,
  familyOf,
  footprintHint,
  isColorable,
  normalizeTag,
  splitWords,
  stemOf,
  variantBase,
  withoutColorable,
} from "../src/index";

describe("splitWords", () => {
  it("splits punctuation, camelCase and digits", () => {
    expect(splitWords("TrustyTavernFloor1")).toEqual(["trusty", "tavern", "floor", "1"]);
    expect(splitWords("Bed, large, royal, double")).toEqual(["bed", "large", "royal", "double"]);
    expect(splitWords("Bed - Pattern 1.a")).toEqual(["bed", "pattern", "1", "a"]);
  });
});

describe("stemOf", () => {
  it("drops folders and extension", () => {
    expect(stemOf("textures/objects/Door (2x1).webp")).toBe("Door (2x1)");
  });
});

describe("footprintHint", () => {
  it("reads (WxH) from names", () => {
    expect(footprintHint("Door (2x1)")).toEqual([2, 1]);
    expect(footprintHint("Hatch, trap door, small (1x1)")).toEqual([1, 1]);
    expect(footprintHint("Galleon, Dread, deck 1 (20x7)")).toEqual([20, 7]);
    expect(footprintHint("Chair 1")).toBeUndefined();
  });
});

describe("conditionsOf", () => {
  it("finds condition words", () => {
    expect(conditionsOf(splitWords("Table - Broken 1 - Dark"))).toEqual(["broken", "dark"]);
    expect(conditionsOf(splitWords("Adventurer 1 - Bloody"))).toEqual(["bloody"]);
    expect(conditionsOf(splitWords("Bed, large, messy"))).toEqual(["messy"]);
    expect(conditionsOf(splitWords("Chair 1"))).toEqual([]);
  });
});

describe("colorable handling", () => {
  it("detects and strips the colorable marker", () => {
    expect(isColorable("AdoredAbodeFloor2 - Colorable")).toBe(true);
    expect(isColorable("Bed 2")).toBe(false);
    expect(withoutColorable("ForestGuardianShell - Colorable")).toBe("ForestGuardianShell");
  });
});

describe("variantBase", () => {
  it("groups lettered and numbered versions", () => {
    expect(variantBase("Bed - Pattern 1.a")).toBe("bed pattern 1");
    expect(variantBase("Bed - Pattern 1.b")).toBe("bed pattern 1");
    expect(variantBase("Chair 1")).toBe("chair");
    expect(variantBase("Chair 12")).toBe("chair");
    expect(variantBase("Door (2x1)")).toBe("door");
    expect(variantBase("DruidsBurrowMushroom1 - Colorable")).toBe("druids burrow mushroom");
  });
});

describe("familyOf and normalizeTag", () => {
  it("detects the art family", () => {
    expect(familyOf("2MT Castle Furniture")).toBe("2MT");
    expect(familyOf("2M Sinister Cabin Pack")).toBe("2M");
    expect(familyOf("Some Other Pack")).toBe("other");
  });
  it("normalizes tags and drops pack-name tags", () => {
    expect(normalizeTag("[2MT] Seat", "2MT Castle Furniture")).toBe("seat");
    expect(normalizeTag("Colorable", "2MT Castle Furniture")).toBeUndefined();
    expect(normalizeTag("2MT Castle Furniture", "2MT Castle Furniture")).toBeUndefined();
    expect(normalizeTag("2M Sinister Cabin", "2M Sinister Cabin Pack")).toBeUndefined();
    expect(normalizeTag("Tavern", "2MT Typical Tavern")).toBe("tavern");
  });
});
