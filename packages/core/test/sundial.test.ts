/** The sundial set piece (DESIGN 38): the city's plaza, the dial and the tower cut open on the street map, the shadow's rule, and the Foundry side. */

import { describe, expect, it } from "vitest";
import { allHotSpots, Catalog, centroid, dialGeometry, generate, hotspotPlan, litGems, numeralDir, parseCity, shadowRests, shadowRotation, toFoundryScene, validatePlan, ZONE_TYPES, type AssetIndex, type ScenePlan } from "../src/index";
import { testIndex, townJson } from "./fixtures";

const url = "https://watabou.github.io/city-generator/?seed=1";
const plain = parseCity(townJson(), { name: "Testburg", url });
const at = centroid(plain.buildings[3]!);
const gems = [{ numeral: 11, color: "topaz" }, { numeral: 3, color: "ruby" }, { numeral: 8, color: "sapphire" }] as const;
const cast = Array.from({ length: 6 }, (_, i) => ({ name: `Frozen ${i + 1}`, kind: i % 2 ? "kobold" : "knight" }));
const city = parseCity(townJson(), { name: "Testburg", url, set: { sundial: { at, size: 20, radius: 12, gems: [...gems], stopped: 7, cast, notes: "The GM's notes." } } });
/** The fixture library plus a house roof and the wizard's tower roof, so the street map lays houses in the plots and has a tower to cut open. */
function towerIndex(): AssetIndex {
  const index = testIndex();
  const base = index.assets.find((a) => a.kind === "object")!;
  const roof = (id: string, pack: string, name: string, fp: [number, number]) => ({ ...base, id, pack, name, words: name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), types: [], typeSource: "none" as const, variantGroup: id, footprint: fp, size: [Math.round(fp[0] * 256), Math.round(fp[1] * 256)] as [number, number], trim: [0, 0, Math.round(fp[0] * 256), Math.round(fp[1] * 256)] as [number, number, number, number], tag: undefined });
  index.packs.push({ ...index.packs[0]!, id: "WIZ", name: "2MT Wizards Tower" }, { ...index.packs[0]!, id: "BLD", name: "2MT Buildings Pack" });
  index.assets.push(roof("WIZ:roof", "WIZ", "Wizards Tower - Roof - 12x12 - 300 DPI", [9.3, 9.65]), roof("BLD:roof", "BLD", "Building 1 - Roof - Red - 8x6", [8, 6]));
  return index;
}
const cat = new Catalog(towerIndex(), ["fantasy", "victorian"]);
const opts = { key: "0123456789abcdef", prefix: "testburg" };

describe("the city's sundial", () => {
  it("takes the plot under the point for the tower, makes it the asked square and clears the houses round it", () => {
    const sd = city.set!.sundial!;
    expect(sd.radius).toBe(12);
    const tower = city.buildings[sd.tower]!;
    expect(centroid(tower)[0]).toBeCloseTo(at[0]);
    expect(centroid(tower)[1]).toBeCloseTo(at[1]);
    // A 20 m square where the 18 m plot was.
    expect(Math.hypot(tower[1]![0] - tower[0]![0], tower[1]![1] - tower[0]![1])).toBeCloseTo(20);
    const c = centroid(tower);
    const nearest = (r: [number, number][]) => Math.min(...r.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    expect(city.buildings.filter((r, i) => i !== sd.tower && nearest(r) <= 14.5)).toHaveLength(0);
    // The fixture's houses stand a good way apart: a wider clearing takes the nearest ones.
    expect(city.buildings.length).toBe(plain.buildings.length);
    const wide = parseCity(townJson(), { name: "Testburg", url, set: { sundial: { at, size: 20, radius: 12, clear: 20, gems: [...gems], stopped: 7 } } });
    expect(wide.buildings.length).toBeLessThan(plain.buildings.length);
    const asIs = parseCity(townJson(), { name: "Testburg", url, set: { sundial: { at, gems: [...gems], stopped: 7 } } });
    expect(asIs.buildings[asIs.set!.sundial!.tower]).toEqual(plain.buildings[3]);
  });
  it("gives the tower one pin, a street map of its plaza, carrying the GM's notes", () => {
    const spots = allHotSpots(city).filter((h) => h.kind === "wizard");
    expect(spots.map((h) => h.id)).toEqual(["wizard"]);
    expect(spots[0]!.area).toBeDefined();
    expect(spots[0]!.area!.w).toBeGreaterThanOrEqual(60);
    expect(spots[0]!.notes).toBe("The GM's notes.");
    expect(spots[0]!.secret).toBeUndefined();
  });
  it("plans the plaza with the dial round the tower and the cast inside it", () => {
    const plaza = hotspotPlan(city, allHotSpots(city).find((h) => h.id === "wizard")!, opts);
    expect(plaza.street).toBeDefined();
    expect(plaza.sundial).toEqual({ tower: city.set!.sundial!.tower, radius: 12, gems: [...gems], stopped: 7 });
    expect(plaza.cast).toHaveLength(6);
    expect(validatePlan(plaza, ZONE_TYPES)).toEqual([]);
  });
});

describe("the dial", () => {
  it("puts XII up and runs clockwise", () => {
    expect(numeralDir(12)[1]).toBeCloseTo(-1);
    expect(numeralDir(3)[0]).toBeCloseTo(1);
    expect(shadowRotation(3)).toBe(90);
    expect(shadowRotation(12)).toBe(0);
    expect(shadowRotation(7)).toBe(210);
  });
  it("etches twelve numerals on the ring, sets the gems inside it in order, and throws the shadow from the tower's wall past the ring", () => {
    const geo = dialGeometry({ tower: 0, gems: [...gems], stopped: 7 }, [20, 20], 8, 4);
    expect(geo.etchings.map((e) => e.text)).toEqual(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]);
    for (const e of geo.etchings) expect(Math.hypot(e.at[0] - 20, e.at[1] - 20)).toBeCloseTo(8);
    for (const g of geo.gems) expect(Math.hypot(g.at[0] - 20, g.at[1] - 20)).toBeCloseTo(7);
    expect(geo.gems.map((g) => g.color)).toEqual(["topaz", "ruby", "sapphire"]);
    expect(geo.stopped).toBe(7);
    expect(geo.shadow.from).toBe(4);
    expect(geo.shadow.length).toBeCloseTo(9.3);
    expect(geo.shadow.width).toBeCloseTo(6.8);
  });
  it("lights the gems in their order, puts them out on a gem out of turn, and ignores plain numerals", () => {
    expect(shadowRests(gems, 0, 12)).toEqual({ progress: 0, event: "none" });
    expect(shadowRests(gems, 0, 11)).toEqual({ progress: 1, event: "lit" });
    expect(shadowRests(gems, 1, 2)).toEqual({ progress: 1, event: "none" });
    expect(shadowRests(gems, 1, 3)).toEqual({ progress: 2, event: "lit" });
    expect(shadowRests(gems, 2, 8)).toEqual({ progress: 3, event: "done" });
    expect(shadowRests(gems, 0, 3)).toEqual({ progress: 0, event: "wrong" });
    expect(shadowRests(gems, 1, 8)).toEqual({ progress: 0, event: "wrong" });
    // Resting again on a gem already lit changes nothing; once solved, nothing does.
    expect(shadowRests(gems, 2, 11)).toEqual({ progress: 2, event: "none" });
    expect(shadowRests(gems, 3, 3)).toEqual({ progress: 3, event: "none" });
    expect(litGems(gems, 2)).toEqual([true, true, false]);
  });
});

describe("the plan", () => {
  const street: ScenePlan = { id: "t", seed: 1, genre: "medieval", size: { w: 30, h: 30 }, levels: [{ id: "g", zones: [{ id: "s", type: "street.area" }] }], street: { city: "0123456789abcdef", area: { x: 0, y: 0, w: 40, h: 40 } } };
  const interior: ScenePlan = { id: "t", seed: 1, genre: "gothic", size: { w: 30, h: 30 }, levels: [{ id: "g", zones: [{ id: "hall", type: "gothic.hall" }], connections: [{ from: "hall", to: "outside" }] }] };
  it("refuses a dial off a street map, without its tower, with gems sharing a numeral, and a cast too long", () => {
    const bad = (plan: ScenePlan, sundial: unknown, cast?: unknown) => validatePlan({ ...plan, sundial, ...(cast ? { cast } : {}) } as ScenePlan, ZONE_TYPES).map((i) => i.path);
    expect(bad(interior, { tower: 1, gems: [...gems], stopped: 7 })).toContain("sundial");
    expect(bad(street, { gems: [...gems], stopped: 7 })).toContain("sundial.tower");
    expect(bad(street, { tower: 1, gems: [gems[0], { ...gems[1], numeral: 11 }], stopped: 7 })).toContain("sundial.gems");
    expect(bad(street, { tower: 1, gems: [...gems], stopped: 13 })).toContain("sundial.stopped");
    expect(bad(street, { tower: 1, gems: [...gems], stopped: { hour: 7 } })).toContain("sundial.stopped");
    expect(bad(street, { tower: 1, gems: [...gems], stopped: 7 }, Array.from({ length: 25 }, () => ({ name: "x", kind: "commoner" })))).toContain("cast");
    expect(validatePlan({ ...street, sundial: { tower: 1, gems: [...gems], stopped: 7 }, cast }, ZONE_TYPES)).toEqual([]);
  });
});

describe("the map", () => {
  const plan = hotspotPlan(city, allHotSpots(city).find((h) => h.id === "wizard")!, opts);
  const plaza = generate(plan, cat, { city, date: new Date(2026, 10, 22) }).versions[0]!;
  const sd = plaza.sundial!;
  it("etches the dial round the tower and starts the shadow at the tower's wall", () => {
    expect(sd.etchings).toHaveLength(12);
    expect(sd.gems.map((g) => g.color)).toEqual(["topaz", "ruby", "sapphire"]);
    expect(sd.stopped).toBe(7);
    // The tower's centre in squares is where the plot's centroid falls in the map.
    const a = plan.street!.area;
    expect(sd.at[0]).toBeCloseTo((at[0] - a.x) / 1.524, 0);
    expect(sd.at[1]).toBeCloseTo((at[1] - a.y) / 1.524, 0);
    expect(sd.radius).toBeCloseTo(12 / 1.524, 1);
    // The shadow starts at the wall (a 20 m tower: about 6.5 squares) and reaches past the ring.
    expect(sd.shadow.from).toBeGreaterThan(5);
    expect(sd.shadow.from).toBeLessThan(sd.radius - 1);
    expect(sd.shadow.length).toBeGreaterThan(sd.radius);
    const els = Object.values(plaza.elements);
    expect(els.some((e) => e.kind === "floor" && e.key === "sundial/plaza")).toBe(true);
  });
  it("cuts the tower open: a floor, a door to the plaza, the locked gate to the stair, and the cast frozen inside", () => {
    const els = Object.values(plaza.elements);
    expect(els.some((e) => e.kind === "floor" && e.key.startsWith("floor:tower#"))).toBe(true);
    expect(els.filter((e) => e.kind === "door" && e.key.startsWith("door:tower#")).map((e) => e.state)).toEqual(["closed"]);
    const gate = els.filter((e) => e.kind === "door" && e.key === "sundial/gate");
    expect(gate.map((e) => e.state)).toEqual(["locked"]);
    expect(els.some((e) => e.kind === "light" && e.key === "sundial/device/light")).toBe(true);
    expect(sd.cast).toHaveLength(6);
    for (const m of sd.cast!) {
      const d = Math.hypot(m.x - sd.at[0], m.y - sd.at[1]);
      expect(d).toBeGreaterThan(2.5);
      expect(d).toBeLessThan(sd.shadow.from);
    }
    // Twice the same seed, the same cast in the same spots.
    expect(generate(plan, cat, { city, date: new Date(2026, 10, 22) }).versions[0]!.sundial!.cast).toEqual(sd.cast);
  });
  it("hands Foundry the shadow as a tile pivoting on the tower, hidden gem lights in order, the gate's wall flagged and the cast as tokens", () => {
    const up = toFoundryScene(plaza.map, { name: "plaza", pps: 100, sundial: sd, doors: Object.fromEntries(Object.entries(plaza.elements).filter(([, e]) => e.kind === "door").map(([nid, e]) => [nid, { key: e.key, state: e.state, width: e.width }])) });
    expect(up.tiles!.map((t) => [t.texture.src, t.rotation])).toEqual([["shadow", 210]]);
    const t = up.tiles![0]!;
    expect(t.x + t.width / 2).toBeCloseTo(sd.at[0] * 100, -1);
    expect(t.y + t.height / 2).toBeCloseTo(sd.at[1] * 100, -1);
    const gemLights = up.lights.filter((l) => l.hidden);
    expect(gemLights).toHaveLength(3);
    expect(gemLights.map((l) => l.config.color)).toEqual(["#e0a31f", "#b3202e", "#2b55b8"]);
    expect(gemLights.map((l) => (l.flags["georgios-map-maker"] as { sundial: { order: number } }).sundial.order)).toEqual([1, 2, 3]);
    const gates = up.walls.filter((w) => (w.flags["georgios-map-maker"] as { sundial?: { gate?: boolean } }).sundial?.gate);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.ds).toBe(2);
    expect(up.tokens).toHaveLength(6);
    expect(up.tokens![0]!.name).toBe("Frozen 1");
    expect(up.flags!.sundial).toMatchObject({ stopped: 7, shadow: 7, progress: 0, gems: [{ numeral: 11, color: "topaz" }, { numeral: 3, color: "ruby" }, { numeral: 8, color: "sapphire" }] });
    // A map without a dial carries none of this.
    const none = toFoundryScene(plaza.map, { name: "plain", pps: 100 });
    expect(none.tiles).toBeUndefined();
  });
});
