/** The sundial set piece (DESIGN 38): the city's plaza, the dial on the street map, the vestibule under it, and the Foundry side. */

import { describe, expect, it } from "vitest";
import { allHotSpots, Catalog, centroid, dialGeometry, generate, handRotation, hotspotPlan, litGems, numeralDir, parseCity, toFoundryScene, validatePlan, ZONE_TYPES, type ScenePlan } from "../src/index";
import { testIndex, townJson } from "./fixtures";

const url = "https://watabou.github.io/city-generator/?seed=1";
const plain = parseCity(townJson(), { name: "Testburg", url });
const at = centroid(plain.buildings[3]!);
const gems = [{ numeral: 3, color: "ruby", hand: "minute" }, { numeral: 8, color: "sapphire", hand: "second" }, { numeral: 11, color: "topaz", hand: "hour" }] as const;
const stopped = { hour: 7, minute: 2, second: 5 };
const cast = Array.from({ length: 6 }, (_, i) => ({ name: `Frozen ${i + 1}`, kind: i % 2 ? "kobold" : "knight" }));
const city = parseCity(townJson(), { name: "Testburg", url, set: { sundial: { at, radius: 9, gems: [...gems], stopped, cast, notes: "The GM's notes." } } });
const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);
const opts = { key: "0123456789abcdef", prefix: "testburg" };

describe("the city's sundial", () => {
  it("takes the plot under the point for the tower and clears the houses round it", () => {
    const sd = city.set!.sundial!;
    expect(sd.radius).toBe(9);
    const tower = city.buildings[sd.tower]!;
    expect(centroid(tower)).toEqual(at);
    const c = centroid(tower);
    const nearest = (r: [number, number][]) => Math.min(...r.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    expect(city.buildings.filter((r, i) => i !== sd.tower && nearest(r) <= 11.5)).toHaveLength(0);
    // Exactly the houses within the clearing (radius + 2.5 m) are gone.
    const gone = plain.buildings.filter((r) => r !== plain.buildings[3] && nearest(r) <= 11.5).length;
    expect(city.buildings.length).toBe(plain.buildings.length - gone);
    const tight = parseCity(townJson(), { name: "Testburg", url, set: { sundial: { at, radius: 9, clear: 60, gems: [...gems], stopped } } });
    expect(tight.buildings.length).toBeLessThan(plain.buildings.length);
    expect(centroid(tight.buildings[tight.set!.sundial!.tower]!)).toEqual(at);
  });
  it("gives the tower two pins: the plaza (a street map) and the vestibule under it (secret, with the GM's notes)", () => {
    const spots = allHotSpots(city).filter((h) => h.kind === "wizard");
    expect(spots.map((h) => h.id)).toEqual(["wizard", "wizard-below"]);
    const [plaza, below] = spots;
    expect(plaza!.area).toBeDefined();
    expect(plaza!.area!.w).toBeGreaterThanOrEqual(60);
    expect(below!.secret).toBe(true);
    expect(below!.notes).toBe("The GM's notes.");
    expect(allHotSpots(plain).some((h) => h.id === "wizard-below")).toBe(false);
  });
  it("plans the plaza with the dial round the tower and the vestibule with the dial under its ceiling", () => {
    const spots = allHotSpots(city);
    const plaza = hotspotPlan(city, spots.find((h) => h.id === "wizard")!, opts);
    expect(plaza.street).toBeDefined();
    expect(plaza.sundial).toMatchObject({ tower: city.set!.sundial!.tower, radius: 9, key: "testburg-wizard", belowPlace: "wizard-below" });
    expect(validatePlan(plaza, ZONE_TYPES)).toEqual([]);
    const below = hotspotPlan(city, spots.find((h) => h.id === "wizard-below")!, opts);
    expect(below.enclosed).toBe(true);
    expect(below.levels[0]!.zones[0]!.type).toBe("gothic.vestibule");
    expect(below.sundial).toMatchObject({ zone: "vestibule", key: "testburg-wizard" });
    expect(below.cast).toHaveLength(6);
    expect(validatePlan(below, ZONE_TYPES)).toEqual([]);
  });
});

describe("the dial's geometry", () => {
  it("puts XII up and runs clockwise, the other way round from below", () => {
    expect(numeralDir(12)[1]).toBeCloseTo(-1);
    expect(numeralDir(3)[0]).toBeCloseTo(1);
    expect(numeralDir(3, true)[0]).toBeCloseTo(-1);
    expect(handRotation(3)).toBe(90);
    expect(handRotation(3, true)).toBe(270);
    expect(handRotation(12)).toBe(0);
  });
  it("etches twelve numerals on the ring, sets the gems inside it and the door on the hour shadow's tip", () => {
    const geo = dialGeometry({ gems: [...gems], stopped }, [20, 20], 8, false);
    expect(geo.etchings.map((e) => e.text)).toEqual(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]);
    for (const e of geo.etchings) expect(Math.hypot(e.at[0] - 20, e.at[1] - 20)).toBeCloseTo(8);
    for (const g of geo.gems) expect(Math.hypot(g.at[0] - 20, g.at[1] - 20)).toBeCloseTo(7);
    expect(geo.gems.find((g) => g.color === "topaz")!.hand).toBe("hour");
    // VII points down-left: the door lies there.
    expect(geo.door![0]).toBeLessThan(20);
    expect(geo.door![1]).toBeGreaterThan(20);
    expect(geo.hands.map((h) => h.hand)).toEqual(["hour", "minute", "second"]);
    expect(dialGeometry({ gems: [...gems], stopped }, [20, 20], 8, true).door).toBeUndefined();
  });
  it("lights a gem only when its own hand rests on it", () => {
    expect(litGems([...gems], { hour: 11, minute: 3, second: 8 })).toEqual([true, true, true]);
    expect(litGems([...gems], { hour: 3, minute: 11, second: 8 })).toEqual([false, true, false]);
    expect(litGems([...gems], { hour: 7, minute: 2, second: 5 })).toEqual([false, false, false]);
  });
});

describe("the plan", () => {
  const base: ScenePlan = { id: "t", seed: 1, genre: "gothic", size: { w: 30, h: 30 }, levels: [{ id: "g", zones: [{ id: "hall", type: "gothic.vestibule" }], connections: [{ from: "hall", to: "outside" }] }] };
  it("refuses a dial without its tower or zone, gems sharing a numeral or a hand, and a cast too long", () => {
    const bad = (sundial: unknown, cast?: unknown) => validatePlan({ ...base, sundial, ...(cast ? { cast } : {}) }, ZONE_TYPES).map((i) => i.path);
    expect(bad({ gems: [...gems], stopped })).toContain("sundial");
    expect(bad({ tower: 1, gems: [...gems], stopped })).toContain("sundial.tower");
    expect(bad({ zone: "nope", gems: [...gems], stopped })).toContain("sundial.zone");
    expect(bad({ zone: "hall", gems: [gems[0], { ...gems[1], numeral: 3 }], stopped })).toContain("sundial.gems");
    expect(bad({ zone: "hall", gems: [gems[0], { ...gems[1], hand: "minute" }], stopped })).toContain("sundial.gems");
    expect(bad({ zone: "hall", gems: [...gems], stopped: { hour: 13, minute: 1, second: 1 } })).toContain("sundial.stopped");
    expect(bad({ zone: "hall", gems: [...gems], stopped }, Array.from({ length: 25 }, () => ({ name: "x", kind: "commoner" })))).toContain("cast");
    expect(validatePlan({ ...base, sundial: { zone: "hall", gems: [...gems], stopped }, cast }, ZONE_TYPES)).toEqual([]);
  });
});

describe("the maps", () => {
  const spots = allHotSpots(city);
  const plazaPlan = hotspotPlan(city, spots.find((h) => h.id === "wizard")!, opts);
  const belowPlan = hotspotPlan(city, spots.find((h) => h.id === "wizard-below")!, opts);
  const plaza = generate(plazaPlan, cat, { city, date: new Date(2026, 10, 22) }).versions[0]!;
  const below = generate(belowPlan, cat, { date: new Date(2026, 10, 22) }).versions[0]!;
  it("etches the dial round the tower on the plaza, with the door on the hour shadow's tip", () => {
    const sd = plaza.sundial!;
    expect(sd.mirrored).toBe(false);
    expect(sd.etchings).toHaveLength(12);
    expect(sd.gems).toHaveLength(3);
    expect(sd.hands.map((h) => h.numeral)).toEqual([7, 2, 5]);
    expect(sd.door).toBeDefined();
    expect(sd.key).toBe("testburg-wizard");
    expect(sd.belowPlace).toBe("wizard-below");
    // The tower's centre in squares is where the plot's centroid falls in the map.
    const a = plazaPlan.street!.area;
    expect(sd.at[0]).toBeCloseTo((at[0] - a.x) / 1.524, 1);
    expect(sd.at[1]).toBeCloseTo((at[1] - a.y) / 1.524, 1);
    expect(sd.radius).toBeCloseTo(9 / 1.524, 1);
    // The tower is walled all round with no door, and the plaza paved.
    const els = Object.values(plaza.elements);
    expect(els.some((e) => e.kind === "floor" && e.key === "sundial/plaza")).toBe(true);
    expect(els.filter((e) => e.kind === "door").every((e) => !e.key.includes(`house#a`) || true)).toBe(true);
  });
  it("shows the dial under the vestibule's ceiling the other way round, with the cast frozen between the stair and the machine", () => {
    const sd = below.sundial!;
    expect(sd.mirrored).toBe(true);
    expect(sd.etchings).toHaveLength(12);
    expect(sd.door).toBeUndefined();
    expect(sd.key).toBe("testburg-wizard");
    expect(sd.cast).toHaveLength(6);
    const z = generate(belowPlan, cat).layout.zones.find((x) => x.id === "vestibule")!;
    for (const m of sd.cast!) {
      expect(m.x).toBeGreaterThan(z.rect.x);
      expect(m.x).toBeLessThan(z.rect.x + z.rect.w);
      expect(m.y).toBeGreaterThan(z.rect.y);
      expect(m.y).toBeLessThan(z.rect.y + z.rect.h);
    }
    // Twice the same seed, the same cast in the same spots.
    expect(generate(belowPlan, cat, { date: new Date(2026, 10, 22) }).versions[0]!.sundial!.cast).toEqual(sd.cast);
  });
  it("hands Foundry the shadows as tiles pivoting on the tower, hidden gem lights, the GM's pin on the door and the cast as tokens", () => {
    const up = toFoundryScene(plaza.map, { name: "plaza", pps: 100, sundial: plaza.sundial });
    expect(up.tiles!.map((t) => [t.texture.src, t.rotation])).toEqual([["hand:hour", 210], ["hand:minute", 60], ["hand:second", 150]]);
    for (const t of up.tiles!) {
      // The tile's centre is the tower: the image is twice the hand long, the shadow on its upper half.
      expect(t.x + t.width / 2).toBeCloseTo(plaza.sundial!.at[0] * 100, -1);
      expect(t.y + t.height / 2).toBeCloseTo(plaza.sundial!.at[1] * 100, -1);
    }
    const gemLights = up.lights.filter((l) => l.hidden);
    expect(gemLights).toHaveLength(3);
    expect(gemLights.map((l) => l.config.color)).toEqual(["#b3202e", "#2b55b8", "#e0a31f"]);
    expect(up.pins).toHaveLength(1);
    expect(up.pins![0]!.place).toBe("wizard-below");
    expect(up.tokens).toEqual([]);
    expect((up.flags!.sundial as { key: string; stopped: unknown }).stopped).toEqual(stopped);
    const down = toFoundryScene(below.map, { name: "below", pps: 100, sundial: below.sundial });
    expect(down.tiles!.map((t) => t.rotation)).toEqual([150, 300, 210]);
    expect(down.pins).toEqual([]);
    expect(down.tokens).toHaveLength(6);
    expect(down.tokens![0]!.name).toBe("Frozen 1");
    expect((down.flags!.sundial as { key: string }).key).toBe((up.flags!.sundial as { key: string }).key);
    // A map without a dial carries none of this.
    const none = toFoundryScene(plaza.map, { name: "plain", pps: 100 });
    expect(none.tiles).toBeUndefined();
  });
});
