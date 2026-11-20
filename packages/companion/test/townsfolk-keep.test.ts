import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module without types
import { identityOf, keepReason, looksPlaceholder, reconcile } from "../../../foundry-module/scripts/keep.js";

const OWN = "georgios-map-maker";
const tok = (id: string, name: string, role: string, o: { x?: number; y?: number; placed?: { x: number; y: number; name: string }; actorLink?: boolean; other?: boolean } = {}) => ({
  id, name, x: o.x ?? 0, y: o.y ?? 0, actorLink: !!o.actorLink,
  flags: { [OWN]: { person: true, role, ...(o.placed ? { placed: o.placed } : {}) }, ...(o.other ? { "georgios-nemesis": { cast: {} } } : {}) },
});
const person = (name: string, role: string) => ({ name, role, kind: "commoner", px: 0, py: 0 });

describe("townsfolk the GM played survive Map Maker placing them again", () => {
  it("tells a placeholder from a token someone made into a person", () => {
    expect(looksPlaceholder("Alys, dockworker", "dockworker")).toBe(true);
    expect(looksPlaceholder("Odo, wizard, asleep", "wizard, asleep")).toBe(true);
    expect(looksPlaceholder("Alice", "dockworker")).toBe(false);
    // Moved away from where Map Maker put it: the GM did that.
    expect(keepReason(tok("a", "Alys, dockworker", "dockworker", { x: 980, y: 3850, placed: { x: 2000, y: 500, name: "Alys, dockworker" } }))).toBe("moved");
    // Renamed by the GM (no other module has taken the token over).
    expect(keepReason(tok("b", "Old Hugh", "patron", { placed: { x: 0, y: 0, name: "Hugh, patron" } }))).toBe("renamed");
    expect(keepReason(tok("c", "Old Hugh", "patron"))).toBe("renamed");
    // Renamed by another module that recasts placeholders: that module's business, not kept.
    expect(keepReason(tok("d", "Tokk of the Lampless Stair, dockworker", "dockworker", { placed: { x: 0, y: 0, name: "Alys, dockworker" }, other: true }))).toBe(null);
    // ...but once the GM renames it out of that shape, it is the GM's.
    expect(keepReason(tok("d2", "Old Mother Gervoise", "patron", { other: true }))).toBe("renamed");
    // Linked to an actor: someone.
    expect(keepReason(tok("e", "Galauche Greymane, barkeep", "barkeep", { actorLink: true, other: true }))).toBe("linked");
    expect(keepReason(tok("f", "Hugh, patron", "patron", { placed: { x: 0, y: 0, name: "Hugh, patron" } }))).toBe(null);
    expect(identityOf(tok("g", "Tokk, dockworker", "dockworker", { placed: { x: 0, y: 0, name: "Alys, dockworker" }, other: true }))).toBe("Alys, dockworker");
    expect(identityOf(tok("h", "Old Hugh", "patron"))).toBe(null);
  });

  it("keeps the played ones, reuses the same placeholders, and places only what is new", () => {
    const old = [
      tok("alys", "Alys, dockworker", "dockworker", { x: 1120, y: 3920, placed: { x: 2000, y: 500, name: "Alys, dockworker" } }), // moved into a house
      tok("hugh", "Old Hugh", "patron"), // renamed, from before the record
      tok("tokk", "Tokk, dockworker", "dockworker", { placed: { x: 10, y: 10, name: "Hugh, dockworker" }, x: 10, y: 10, other: true }), // recast by another module
      tok("odo", "Odo, sailor", "sailor", { placed: { x: 5, y: 5, name: "Odo, sailor" }, x: 5, y: 5 }), // untouched, gone from the new placement
      tok("ida", "Ida, sailor", "sailor"), // untouched, from before the record, still placed
    ];
    const fresh = [person("Alys", "dockworker"), person("Hugh", "dockworker"), person("Ida", "sailor"), person("Reynard", "sailor")];
    const plan = reconcile(old, fresh);
    // Alys stands for her own placeholder; Old Hugh, a patron, has no patron left to stand for.
    expect(plan.keep).toEqual([{ id: "alys", reason: "moved", index: 0 }, { id: "hugh", reason: "renamed" }]);
    expect(plan.reuse).toEqual([{ id: "tokk", index: 1 }, { id: "ida", index: 2 }]);
    expect(plan.drop).toEqual(["odo"]);
    // Alys is kept where the GM put her, so no second "Alys, dockworker" appears on the street.
    expect(plan.create).toEqual([3]);
  });

  it("places no fresh placeholder on top of a kept token of the same role standing in its spot", () => {
    // Galauche: a written person's token from before the placement record, still behind the bar.
    const old = [tok("galauche", "Galauche Greymane, barkeep", "barkeep", { x: 439, y: 1210, actorLink: true, other: true })];
    const fresh = [{ ...person("Alys", "barkeep"), px: 439, py: 1210 }, { ...person("Hugh", "patron"), px: 439, py: 1210 }, { ...person("Ida", "barkeep"), px: 900, py: 900 }];
    const plan = reconcile(old, fresh);
    expect(plan.keep).toEqual([{ id: "galauche", reason: "linked", index: 0 }]);
    expect(plan.create).toEqual([1, 2]);
  });

  it("places no second keeper when the shop's counter moved away from the GM's keeper", () => {
    // Mekka, the alchemist Nemesis wrote, linked, from before the placement record. The rebuilt
    // shop puts its one alchemist three squares off, behind the new counter.
    const old = [
      tok("mekka", "Mekka Clutch Ninth, alchemist", "alchemist", { x: 619, y: 725, actorLink: true, other: true }),
      tok("lambert", "Lambert, dockworker", "dockworker", { x: 1574, y: 162, placed: { x: 1574, y: 162, name: "Lambert, dockworker" } }),
    ];
    const fresh = [{ ...person("Ursula", "alchemist"), px: 819, py: 650 }, { ...person("Lambert", "dockworker"), px: 1500, py: 200 }, { ...person("Rohese", "dockworker"), px: 354, py: 575 }];
    const plan = reconcile(old, fresh);
    expect(plan.keep).toEqual([{ id: "mekka", reason: "linked", index: 0 }]);
    expect(plan.reuse).toEqual([{ id: "lambert", index: 1 }]);
    expect(plan.create).toEqual([2]);
  });

  it("lets two keepers of a trade stand for the two nearest spots, and places the third", () => {
    const old = [
      tok("a", "Odo the Elder", "smith", { x: 100, y: 100, actorLink: true }),
      tok("b", "Bertha", "smith", { x: 900, y: 900, placed: { x: 880, y: 900, name: "Bertha, smith" } }),
    ];
    const fresh = [{ ...person("Ida", "smith"), px: 950, py: 950 }, { ...person("Hugh", "smith"), px: 120, py: 100 }, { ...person("Reynard", "smith"), px: 500, py: 500 }];
    const plan = reconcile(old, fresh);
    // Bertha was moved and has no fresh namesake: she takes the spot nearest her, as Odo does his.
    expect(plan.keep).toEqual([{ id: "a", reason: "linked", index: 1 }, { id: "b", reason: "moved", index: 0 }]);
    expect(plan.create).toEqual([2]);
  });
});
