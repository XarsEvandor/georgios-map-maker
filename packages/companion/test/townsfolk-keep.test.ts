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
    expect(plan.keep).toEqual([{ id: "alys", reason: "moved" }, { id: "hugh", reason: "renamed" }]);
    expect(plan.reuse).toEqual([{ id: "tokk", index: 1 }, { id: "ida", index: 2 }]);
    expect(plan.drop).toEqual(["odo"]);
    // Alys is kept where the GM put her, so no second "Alys, dockworker" appears on the street.
    expect(plan.create).toEqual([3]);
  });
});
