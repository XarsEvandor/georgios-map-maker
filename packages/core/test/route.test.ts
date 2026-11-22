import { describe, expect, it } from "vitest";
import { findJourney, findRoute, findTown, routeText, type RouteWorld } from "../src/index";

// A small world: Port A --road--> Mid --trail--> B, and a shorter sea lane Port A -> B; Hermit off every route.
// Azgaar units; 1 unit = 5 map px; 100 px = 6 mi, so 1 unit = 0.3 mi.
const W: RouteWorld = {
  burgs: [null, { id: 1, name: "Narkoc", cell: 1, x: 0, y: 0, state: 1, population: 9 }, { id: 2, name: "Midhollow", cell: 3, x: 100, y: 0, state: 1 }, { id: 3, name: "Zugkatil", cell: 5, x: 100, y: 100, state: 2, population: 20 }, { id: 4, name: "Hermitage", cell: 9, x: 0, y: 200, state: 2 }, { id: 5, name: "Narkoc", cell: 7, x: 500, y: 500, state: 2, population: 1 }],
  routes: [
    { group: "roads", points: [[0, 0, 1], [50, 0, 2], [100, 0, 3]] },
    { group: "trails", points: [[100, 0, 3], [100, 50, 4], [100, 100, 5]] },
    { group: "searoutes", points: [[0, 0, 1], [60, 60, 6], [100, 100, 5]] },
  ],
  cells: { state: [0, 1, 1, 1, 2, 2, 0, 2, 0, 2], biome: [0, 4, 4, 6, 6, 9, 0, 4, 0, 4] },
  states: [null, { id: 1, name: "March" }, { id: 2, name: "Vylnarg" }],
};
const S = { pxPerUnit: 5, milesPerPx: 0.06 };

describe("travel on the world map", () => {
  it("finds a town by a loose name, and offers the nearest names when it is not clear", () => {
    expect(findTown(W, "narkóc").town?.population).toBe(9); // the bigger of two namesakes
    expect(findTown(W, "Zugkatl").town?.name).toBe("Zugkatil");
    expect(findTown(W, "Zugk").town?.name).toBe("Zugkatil");
    const lost = findTown(W, "Nokron");
    expect(lost.town).toBeUndefined();
    expect(lost.suggestions[0]).toBe("Narkoc");
  });

  it("takes the shortest way, by sea when it is shorter, and the way by land as well", () => {
    const a = findTown(W, "Narkoc").town!;
    const b = findTown(W, "Zugkatil").town!;
    const sea = findRoute(W, a, b, S)!;
    // 60*sqrt2 + 40*sqrt2 = 141.4 units = 42.4 mi by sea; 200 units = 60 mi by road and trail.
    expect(Math.round(sea.miles)).toBe(42);
    expect(sea.legs.map((l) => [l.kind, Math.round(l.miles), l.from, l.to])).toEqual([["sea", 42, "Narkoc", "Zugkatil"]]);
    const land = findRoute(W, a, b, S, { land: true })!;
    expect(Math.round(land.miles)).toBe(60);
    expect(land.legs.map((l) => [l.kind, Math.round(l.miles), l.from, l.to])).toEqual([["road", 30, "Narkoc", "Midhollow"], ["trail", 30, "Midhollow", "Zugkatil"]]);
    expect([land.towns, land.realms]).toEqual([["Midhollow"], ["March", "Vylnarg"]]);
    expect(land.terrain).toEqual([{ terrain: "grassland", miles: 30 }, { terrain: "temperate deciduous forest", miles: 30 }]);
    expect(land.points[0]).toEqual([0, 0]);
    expect(land.points.at(-1)).toEqual([500, 500]);
    expect(Math.round(land.straightMiles)).toBe(42);
    const text = routeText(sea, land);
    expect(text).toContain("Narkoc to Zugkatil: 42 mi by the shortest way (42 mi in a straight line).");
    expect(text).toContain("By land only (no boat): 60 mi: road 30 mi, trail 30 mi, through Midhollow.");
  });

  it("goes through the towns asked for, in order, and marks where each stands", () => {
    const a = findTown(W, "Narkoc").town!;
    const mid = findTown(W, "Midhollow").town!;
    const b = findTown(W, "Zugkatil").town!;
    const r = findJourney(W, [a, mid, b], S)!;
    // Through Midhollow the sea lane is no use: road 30 mi, then trail 30 mi.
    expect(Math.round(r.miles)).toBe(60);
    expect(r.via).toEqual(["Midhollow"]);
    expect(r.legs.map((l) => [l.kind, Math.round(l.miles), l.from, l.to])).toEqual([["road", 30, "Narkoc", "Midhollow"], ["trail", 30, "Midhollow", "Zugkatil"]]);
    expect(r.towns).toEqual(["Midhollow"]);
    expect(r.realms).toEqual(["March", "Vylnarg"]);
    expect(r.stops).toEqual([{ name: "Narkoc", point: [0, 0] }, { name: "Midhollow", point: [500, 0] }, { name: "Zugkatil", point: [500, 500] }]);
    // One point per step plus the start, with no repeat where the stretches meet.
    expect(r.points.length).toBe(r.steps.length + 1);
    expect(r.points).toEqual([[0, 0], [250, 0], [500, 0], [500, 250], [500, 500]]);
    expect(routeText(r)).toContain("Narkoc to Zugkatil through Midhollow: 60 mi by the shortest way that passes there (42 mi in a straight line).");
    // A repeat in a row is the same stop; one town alone is no journey.
    expect(findJourney(W, [a, a, b], S)!.via).toBeUndefined();
    expect(findJourney(W, [a, a], S)).toBeNull();
    // Without stops it is the plain shortest way.
    expect(Math.round(findJourney(W, [a, b], S)!.miles)).toBe(42);
  });

  it("walks a town off every route to the nearest point of the network", () => {
    const r = findRoute(W, findTown(W, "Hermitage").town!, findTown(W, "Narkoc").town!, S, { land: true })!;
    // 200 units (60 mi) of open ground to Narkoc itself, the nearest network point.
    expect(r.legs.map((l) => [l.kind, Math.round(l.miles)])).toEqual([["open ground", 60]]);
    expect(findRoute(W, findTown(W, "Narkoc").town!, findTown(W, "Narkoc").town!, S)).toBeNull();
  });
});
