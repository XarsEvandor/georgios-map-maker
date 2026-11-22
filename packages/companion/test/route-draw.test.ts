import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module without types
import { clearRoute, drawnRouteText, drawRoute, hereOf, townAt, tripBack, tripClick, tripLand, worldOf } from "../../../foundry-module/scripts/routes.js";

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
    expect(drawnRouteText()).toBe("Zugkatil → Glukkhar, 376 mi, by land");
    expect(await clearRoute()).toBe(7);
    expect(worldMap.drawings.map((d) => d.id)).toEqual(["mine"]);
    expect(drawnRouteText()).toBe("");
    expect(await drawRoute("no-such-world", route)).toBeUndefined();
  });
});

describe("clicking a route on the world map", () => {
  const pin = (id: number, name: string, x: number, y: number) => ({ x, y, text: name, getFlag: (_m: string, k: string) => (k === "key" ? `town-${id}` : undefined) });
  const notes = [pin(1, "Narkoc", 1000, 1000), pin(2, "Borgzah", 1100, 900), pin(3, "Zugkatil", 1000, 200), { x: 1010, y: 1010, text: "Old battle", getFlag: () => "battle-1" }];
  const said: string[] = [];
  const asked: Array<Record<string, unknown>> = [];
  const ctx = {
    t: (k: string) => k,
    route: async (o: Record<string, unknown>) => {
      asked.push(o);
      return { found: true, route: { from: "A", to: "B", miles: 10, byKind: { road: 10 } } };
    },
  };
  const click = (x: number, y: number, fresh = false) => tripClick({ x, y }, { fresh, ...ctx });

  beforeEach(() => {
    Object.assign(worldMap, { notes });
    said.length = 0;
    asked.length = 0;
    const note = (m: string) => said.push(m);
    Object.assign(globalThis, {
      canvas: { scene: worldMap, georgios: { addChild: (g: unknown) => g } },
      ui: { notifications: { info: note, warn: note, error: note } },
      PIXI: { Graphics: class { destroyed = false; lineStyle() { return this; } beginFill() { return this; } drawCircle() { return this; } endFill() { return this; } destroy() { this.destroyed = true; } } },
    });
    (globalThis as any).game.i18n = { format: (k: string, d: Record<string, string>) => `${k}:${d.town}` };
  });

  it("finds the town pin nearest the click, and nothing far from every town", () => {
    expect(townAt(worldMap, { x: 1030, y: 1020 })).toMatchObject({ id: 1, name: "Narkoc" });
    expect(townAt(worldMap, { x: 1070, y: 930 })).toMatchObject({ id: 2, name: "Borgzah" });
    expect(townAt(worldMap, { x: 1500, y: 500 })).toBeUndefined();
  });

  it("starts at the first town clicked, ends at the last, passes the ones between; right-click takes one back", async () => {
    await click(1005, 1003, true);
    expect([asked.length, said.at(-1)]).toEqual([0, "GMM.Route.Started:Narkoc"]);
    await click(1005, 1003); // the same town again: nothing
    await click(1000, 210);
    expect(asked.at(-1)).toMatchObject({ towns: [1, 3], draw: true, pan: false, land: false, image: false });
    await click(1095, 905);
    expect(asked.at(-1)!.towns).toEqual([1, 3, 2]);
    await tripBack(ctx);
    expect(asked.at(-1)!.towns).toEqual([1, 3]);
    await tripLand.set(true, ctx);
    expect(asked.at(-1)).toMatchObject({ towns: [1, 3], land: true });
    await tripLand.set(false, ctx);
    // Shift-click: a new route from Borgzah.
    const before = asked.length;
    await click(1100, 900, true);
    expect([asked.length, said.at(-1)]).toEqual([before, "GMM.Route.Started:Borgzah"]);
    await click(1500, 500);
    expect(said.at(-1)).toBe("Route.NoTown");
    (globalThis as any).canvas.scene = city;
    await click(1000, 1000);
    expect(said.at(-1)).toBe("Route.NotWorldMap");
  });
});
