import { describe, expect, it } from "vitest";
import { colorDistance, realmColors, realmNeighbours, REALM_PALETTE } from "../src/index";

describe("realm colours on the world map", () => {
  it("knows which realms touch, from the cells, over land only", () => {
    // Cells 0-3 in a row: realm 1, realm 1, realm 2, sea; cell 4 is realm 3 next to the sea only.
    const cells = [{ i: 0, c: [1] }, { i: 1, c: [0, 2] }, { i: 2, c: [1, 3] }, { i: 3, c: [2, 4] }, { i: 4, c: [3] }];
    const n = realmNeighbours(cells, [1, 1, 2, 0, 3], [true, true, true, false, true]);
    expect([...n.get(1)!]).toEqual([[2, 1]]);
    expect([...n.get(2)!]).toEqual([[1, 1]]);
    expect(n.has(3)).toBe(false);
  });

  it("gives touching realms colours far apart, keeps a fixed colour, and never changes for the same map", () => {
    // A wheel: realm 1 in the middle touches 2-7, which touch each other in a ring; 8 is fixed and touches 2.
    const nb = new Map<number, Map<number, number>>();
    const link = (a: number, b: number) => {
      (nb.get(a) ?? nb.set(a, new Map()).get(a)!).set(b, 3);
      (nb.get(b) ?? nb.set(b, new Map()).get(b)!).set(a, 3);
    };
    for (let k = 2; k <= 7; k++) {
      link(1, k);
      link(k, k === 7 ? 2 : k + 1);
    }
    link(8, 2);
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const fixed = new Map([[8, "#2f7f86"]]);
    const c = realmColors(ids, nb, fixed);
    expect(c.get(8)).toBe("#2f7f86");
    expect(ids.every((id) => c.has(id))).toBe(true);
    for (const [a, m] of nb) for (const b of m.keys()) expect(colorDistance(c.get(a)!, c.get(b)!)).toBeGreaterThan(30);
    // Seven realms to colour, twelve colours: none used twice.
    expect(new Set(ids.filter((id) => id !== 8).map((id) => c.get(id))).size).toBe(7);
    expect(realmColors(ids, nb, fixed)).toEqual(c);
  });

  it("has twelve colours that all look different from each other and from the Institute's teal", () => {
    expect(REALM_PALETTE.length).toBe(12);
    for (const [i, a] of REALM_PALETTE.entries()) {
      for (const b of REALM_PALETTE.slice(i + 1)) expect(colorDistance(a, b)).toBeGreaterThan(28);
      expect(colorDistance(a, "#2f7f86")).toBeGreaterThan(27);
    }
  });

  it("keeps the others away from a fixed colour even off the palette", () => {
    const nb = new Map([[1, new Map([[2, 1]])], [2, new Map([[1, 1]])]]);
    // Realm 3 touches nobody: it still takes a colour unlike the fixed one, since that one is in use.
    const c = realmColors([1, 2, 3], nb, new Map([[1, "#2f7f86"]]));
    expect(colorDistance(c.get(3)!, "#2f7f86")).toBeGreaterThan(25);
  });
});
