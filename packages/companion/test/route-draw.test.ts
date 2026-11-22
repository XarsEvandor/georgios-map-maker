import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module without types
import { clearRoute, drawRoute, hereOf, worldOf } from "../../../foundry-module/scripts/routes.js";

const OWN = "georgios-map-maker";

/** A stand-in scene: flags, a grid, and drawings that can be made and removed. */
function scene(id: string, flags: Record<string, unknown>) {
  const s = {
    id, name: id, grid: { size: 100 }, flags: { [OWN]: flags },
    getFlag: (mod: string, key: string) => (s.flags as Record<string, Record<string, unknown>>)[mod]?.[key],
    drawings: [] as Array<Record<string, any>>,
    async createEmbeddedDocuments(_type: string, data: Array<Record<string, any>>) {
      for (const d of data) s.drawings.push({ ...d, id: `d${s.drawings.length}`, getFlag: (mod: string, key: string) => d.flags?.[mod]?.[key] });
    },
    async deleteEmbeddedDocuments(_type: string, ids: string[]) {
      s.drawings = s.drawings.filter((d) => !ids.includes(d.id));
    },
  };
  return s;
}

const worldMap = scene("world", { world: "ogeia-1183", worldMap: true });
const city = scene("narkoc", { city: "a597", cityName: "Narkoc", worldOf: "ogeia-1183" });
const place = scene("docks", { city: "a597", mapId: "narkoc-docks" });
const other = scene("castle", { mapId: "dracula-entrance" });

beforeEach(() => {
  worldMap.drawings = [{ id: "mine", sort: 4, getFlag: () => undefined }];
  Object.assign(globalThis, {
    game: { scenes: [worldMap, city, place, other], user: { id: "gm" } },
    canvas: { scene: city },
    CONST: { DRAWING_FILL_TYPES: { NONE: 0, SOLID: 1 } },
  });
});

const route = {
  from: "Zugkatil", to: "Glukkhar", via: ["Vigkane"], miles: 376.4,
  points: [[0, 0], [100, 0], [200, 50], [300, 50], [300, 200]],
  steps: ["road", "road", "trail", "open ground"],
  stops: [{ name: "Zugkatil", point: [0, 0] }, { name: "Vigkane", point: [200, 50] }, { name: "Glukkhar", point: [300, 200] }],
};

describe("the way drawn on the world map", () => {
  it("knows the world and the town of a scene", () => {
    expect([worldOf(worldMap), worldOf(city), worldOf(place), worldOf(other)]).toEqual(["ogeia-1183", "ogeia-1183", "ogeia-1183", undefined]);
    expect([hereOf(worldMap), hereOf(city), hereOf(place), hereOf(other), hereOf()]).toEqual([undefined, "Narkoc", "Narkoc", undefined, "Narkoc"]);
  });

  it("draws a halo, one line per kind of way, a dot per town asked for and a label, hidden from players", async () => {
    const drawn = await drawRoute("ogeia-1183", route);
    expect(drawn).toEqual({ scene: "world", name: "world", revealed: false });
    const mine = worldMap.drawings.filter((d) => d.flags?.[OWN]?.route);
    expect(mine.length).toBe(1 + 3 + 3 + 1);
    expect(mine.every((d) => d.hidden === true && d.author === "gm")).toBe(true);
    // Drawn over what was there: sorts above the GM's own drawing.
    expect(Math.min(...mine.map((d) => d.sort))).toBe(5);
    const [halo, road, trail, open] = mine;
    expect(halo.shape.points.length).toBe(route.points.length * 2);
    // Road: three points, relative to the line's corner; the trail starts where the road ends.
    expect([road.x, road.y, road.shape.points, road.strokeColor]).toEqual([0, 0, [0, 0, 100, 0, 200, 50], "#c0281e"]);
    expect([trail.x, trail.y, trail.shape.points, trail.shape.width, trail.shape.height]).toEqual([200, 50, [0, 0, 100, 0], 100, 0]);
    expect(open.shape.points).toEqual([0, 0, 0, 150]);
    expect(mine.slice(1, 4).every((d) => d.fillType === 0 && d.shape.type === "p")).toBe(true);
    const dots = mine.slice(4, 7);
    expect(dots.map((d) => d.fillColor)).toEqual(["#1e8f3a", "#e0a92e", "#c0281e"]);
    expect(dots[1]!.x + dots[1]!.shape.width / 2).toBe(200);
    expect(mine[7]!.text).toBe("Zugkatil → Glukkhar (via Vigkane): 376 mi");
  });

  it("replaces the way drawn before, reveals it when asked, and Clear takes it away", async () => {
    await drawRoute("ogeia-1183", route);
    const second = await drawRoute("ogeia-1183", { ...route, via: [], stops: [route.stops[0], route.stops[2]] }, { reveal: true, land: true });
    expect(second.revealed).toBe(true);
    const mine = worldMap.drawings.filter((d) => d.flags?.[OWN]?.route);
    expect(mine.length).toBe(1 + 3 + 2 + 1);
    expect(mine.every((d) => d.hidden === false)).toBe(true);
    expect(mine.at(-1)!.text).toBe("Zugkatil → Glukkhar: 376 mi, by land");
    expect(await clearRoute()).toBe(7);
    expect(worldMap.drawings.map((d) => d.id)).toEqual(["mine"]);
    expect(await drawRoute("no-such-world", route)).toBeUndefined();
  });
});
