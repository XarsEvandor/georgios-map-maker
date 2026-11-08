/** Aging an Azgaar world (world/azgaar.ts, names.ts, history.ts, chronicle.ts) on a small made-up map. */

import { describe, expect, it } from "vitest";
import { ageWorld, applySteers, cityLink, drift, edgeLines, eventText, majorEvents, namer, NameMaker, parseAzgaar, seaDirection } from "../src/index";
import { Rng } from "../src/gen/rng";

/**
 * A 12 x 8 grid of square cells: sea on the left two columns, land elsewhere; two realms split
 * down the middle, each with four provinces; a town in every other land cell; a river; roads.
 */
function tinyWorld() {
  const W = 12, H = 8, sz = 20;
  const vid = (x: number, y: number) => y * (W + 1) + x;
  const vertices = [] as Array<{ i: number; p: [number, number]; c: number[] }>;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) vertices.push({ i: vid(x, y), p: [x * sz, y * sz], c: [] });
  const cells = [] as any[];
  const id = (x: number, y: number) => y * W + x;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = id(x, y);
    const v = [vid(x, y), vid(x + 1, y), vid(x + 1, y + 1), vid(x, y + 1)];
    for (const k of v) vertices[k]!.c.push(i);
    const c: number[] = [];
    if (x > 0) c.push(id(x - 1, y)); if (x < W - 1) c.push(id(x + 1, y)); if (y > 0) c.push(id(x, y - 1)); if (y < H - 1) c.push(id(x, y + 1));
    const land = x >= 2;
    const state = land ? (x < 7 ? 1 : 2) : 0;
    const province = land ? (state - 1) * 4 + 1 + Math.floor(y / 2) : 0;
    cells.push({ i, v, c, p: [x * sz + 10, y * sz + 10], h: land ? 30 + x : 5, area: 400, f: land ? 2 : 1, t: x === 2 ? 1 : x < 2 ? -1 : 2, haven: x === 2 ? id(1, y) : 0, harbor: x === 2 ? 1 : 0, r: y === 4 ? 1 : 0, biome: land ? (x % 3 ? 6 : 4) : 0, pop: land ? 3 : 0, culture: state, religion: state, state, province, burg: 0 });
  }
  const burgs: any[] = [0];
  let b = 1;
  const capitals = new Map<number, number>();
  // Towns spaced out (every third cell each way, plus the coast), leaving room for new ones.
  for (const c of cells) {
    const x = c.i % W, y = Math.floor(c.i / W);
    if (c.h < 20 || y % 3 !== 0 || !(x === 2 || x % 3 === 0)) continue;
    c.burg = b;
    if (!capitals.has(c.state)) capitals.set(c.state, b);
    burgs.push({ i: b, cell: c.i, x: c.p[0], y: c.p[1], name: `Town${b}`, culture: c.culture, state: c.state, capital: capitals.get(c.state) === b ? 1 : 0, port: x === 2 ? 1 : 0, population: 2 + (b % 5), citadel: 0, plaza: 1, walls: b % 3 === 0 ? 1 : 0, shanty: 0, temple: 0, type: "Generic", feature: 2 });
    b++;
  }
  const provinces: any[] = [0];
  for (let k = 1; k <= 8; k++) provinces.push({ i: k, state: k <= 4 ? 1 : 2, center: 0, burg: 0, name: `Shire${k}` });
  const names = "Ashby,Brampton,Coldwell,Dunmore,Elmstead,Fairley,Glenford,Harrow,Ilford,Kingsley,Langton,Marlow,Norbury,Oakley,Penrith,Radley,Selby,Thornby,Upton,Walford";
  return {
    info: { mapName: "Tinyland", width: W * sz, height: H * sz, seed: "42" },
    settings: { distanceScale: 1, options: { year: 100, era: "Test Era", eraShort: "TE" } },
    pack: {
      cells, vertices, burgs, provinces,
      states: [{ i: 0, name: "Neutrals" }, { i: 1, name: "Westmark", culture: 1, capital: capitals.get(1), color: "#aa0000", expansionism: 1.5 }, { i: 2, name: "Eastmark", culture: 2, capital: capitals.get(2), color: "#0000aa", expansionism: 1.2 }],
      cultures: [{ i: 0, name: "Wild", base: 0 }, { i: 1, name: "Westfolk", base: 0 }, { i: 2, name: "Eastfolk", base: 0 }],
      religions: [{ i: 0, name: "None" }, { i: 1, name: "Old Faith", type: "Folk" }, { i: 2, name: "Sun Church", type: "Organized" }],
      rivers: [{ i: 1, name: "Tiny", type: "River", cells: [id(11, 4), id(6, 4), id(2, 4)], width: 1, discharge: 100, mouth: id(2, 4), source: id(11, 4) }],
      routes: [{ i: 0, group: "roads", points: [[50, 90, id(2, 4)], [130, 90, id(6, 4)], [230, 90, id(11, 4)]] }],
      markers: [{ i: 0, type: "ruins", icon: "x", x: 200, y: 30, cell: id(10, 1) }],
    },
    biomesData: { name: ["Marine", "", "", "", "Grassland", "", "Forest"], color: [], habitability: [0, 0, 0, 0, 100, 0, 100] },
    nameBases: [{ name: "Test", i: 0, min: 4, max: 9, d: "", m: 0, b: names }],
  };
}

const az = parseAzgaar(tinyWorld());

describe("Azgaar model", () => {
  it("reads cells, towns, realms and name bases", () => {
    expect(az.cells).toHaveLength(96);
    expect(az.burgs).toHaveLength(12);
    expect(az.states.map((s) => s.name)).toEqual(["Neutrals", "Westmark", "Eastmark"]);
    expect(az.nameBases[0]!.names).toHaveLength(20);
  });
  it("finds the coast and the realm border as lines of cell edges", () => {
    const coast = edgeLines(az, (a, b) => (az.cells[a]!.h >= 20) !== (b >= 0 ? az.cells[b]!.h >= 20 : false));
    expect(coast.length).toBeGreaterThan(0);
    // The land runs the full height of the map along x = 40.
    const pts = coast.flat().map((v) => az.vertices[v]!);
    expect(pts.some(([x, y]) => x === 40 && y === 0)).toBe(true);
    expect(pts.some(([x, y]) => x === 40 && y === 160)).toBe(true);
  });
  it("gives the sea's direction the way Azgaar writes it (south 0, west 0.5; matched on 42 of 43 real links)", () => {
    expect(seaDirection(az, 4 * 12 + 2)).toBeCloseTo(0.5, 2);
  });
});

describe("names", () => {
  it("coins new names in a base's style, never repeating one", () => {
    const n = new NameMaker(az.nameBases);
    const rng = new Rng("names");
    const made = Array.from({ length: 15 }, () => n.coin(0, rng));
    expect(new Set(made).size).toBe(15);
    for (const m of made) {
      expect(m).toMatch(/^[A-Z][a-z' -]+$/);
      expect(az.nameBases[0]!.names).not.toContain(m);
    }
  });
  it("wears old names down, and leaves them alone at strength 0", () => {
    expect(drift("Marvilleville", new Rng("d"), 0)).toBe("Marville");
    const worn = drift("Chateauville", new Rng("d"), 3);
    expect(worn).not.toBe("Chateauville");
    expect(worn.length).toBeGreaterThanOrEqual(3);
  });
});

describe("a thousand years", () => {
  const aged = ageWorld(az, { seed: "test" });

  it("is the same every time for a seed, and differs for another", () => {
    const again = ageWorld(az, { seed: "test" });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(aged.events));
    expect(JSON.stringify(ageWorld(az, { seed: "other" }).events)).not.toBe(JSON.stringify(aged.events));
  });

  it("runs from the start year to a thousand years on, with wars and new towns", () => {
    expect(aged.startYear).toBe(100);
    expect(aged.year).toBe(1100);
    const kinds = new Set(aged.events.map((e) => e.kind));
    expect(kinds.has("war")).toBe(true);
    expect(aged.events.every((e) => e.year > 100 && e.year <= 1100)).toBe(true);
    expect(aged.burgs.some((b) => b.founded)).toBe(true);
  });

  it("keeps the world consistent: towns sit in living realms, realms hold land, capitals are their own", () => {
    const alive = aged.states.filter((s) => s.alive);
    expect(alive.length).toBeGreaterThan(0);
    for (const b of aged.burgs.filter((x) => x.alive)) {
      expect(aged.cells.state[b.cell]).toBe(b.state);
      expect(alive.some((s) => s.id === b.state)).toBe(true);
    }
    for (const s of alive) {
      expect(aged.cells.state.filter((x) => x === s.id).length).toBeGreaterThan(0);
      const cap = aged.burgs.find((b) => b.id === s.capital);
      if (cap) {
        expect(cap.alive).toBe(true);
        expect(cap.state).toBe(s.id);
      }
      expect(s.fullName).toContain(s.form === "Free City" ? "Free City of" : s.name);
    }
    for (const s of aged.states.filter((x) => !x.alive)) expect(s.ended).toBeDefined();
    // The sea stays sea.
    for (const c of az.cells.filter((x) => x.h < 20)) expect(aged.cells.state[c.i]).toBe(0);
  });

  it("leaves ruins where towns died, and keeps shanty towns to great walled cities", () => {
    for (const b of aged.burgs.filter((x) => !x.alive)) expect(aged.markers.some((m) => m.type === "ruins" && m.burg === b.id)).toBe(true);
    for (const b of aged.burgs.filter((x) => x.shanty)) { expect(b.walls).toBe(true); expect(b.population).toBeGreaterThanOrEqual(30); }
  });

  it("writes every event as a dated sentence with the names of its time", () => {
    const n = namer(aged);
    const cells = az.cells.map((c) => c.p);
    for (const e of aged.events) {
      const t = eventText(e, n, cells);
      expect(t.startsWith(`${e.year}:`)).toBe(true);
      expect(t).not.toMatch(/undefined|NaN/);
    }
  });

  it("lays an invasion over the rolled history: one block of land, no fallen capital, the rest untouched", () => {
    const town = aged.burgs.find((b) => b.alive && !b.capital)!;
    const before = JSON.stringify(aged);
    const w = applySteers(az, aged, [{ kind: "invasion", name: "Research Institute of Science", at: town.name, share: 0.1 }]);
    // The rolled world is left as it was; the dice ran no further.
    expect(JSON.stringify(aged)).toBe(before);
    const inv = w.states.at(-1)!;
    expect(inv).toMatchObject({ name: "Research Institute of Science", fullName: "Research Institute of Science", invader: true, alive: true, founded: aged.year });
    const land = w.cells.state.filter((x) => x > 0).length;
    const own = w.cells.state.map((x, i) => (x === inv.id ? i : -1)).filter((i) => i >= 0);
    expect(own.length).toBe(inv.cells);
    expect(own.length).toBe(Math.round(land * 0.1));
    expect(own).toContain(town.cell);
    // In one piece.
    const set = new Set(own), seen = new Set([own[0]!]), queue = [own[0]!];
    while (queue.length) for (const nb of az.cells[queue.pop()!]!.c) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); queue.push(nb); }
    expect(seen.size).toBe(own.length);
    // Capitals stand; towns in the block are the invaders', seated in the largest.
    for (const b of aged.burgs.filter((x) => x.alive && x.capital)) expect(w.cells.state[b.cell]).toBe(b.state);
    const taken = w.burgs.filter((b) => b.alive && set.has(b.cell));
    expect(taken.every((b) => b.state === inv.id)).toBe(true);
    expect(inv.capital).toBe([...taken].sort((a, b) => b.population - a.population)[0]!.id);
    // Each realm that lost land counts it, and the year ends with the invasion in the chronicle.
    for (const s of w.states.filter((x) => x.alive)) expect(s.cells).toBe(w.cells.state.filter((x) => x === s.id).length);
    const evs = w.events.filter((e) => e.kind === "invasion");
    expect(evs.length).toBeGreaterThan(0);
    expect(eventText(evs[0]!, namer(w), az.cells.map((c) => c.p))).toMatch(/^\d+: the Research Institute of Science invaded \w+ and took the land round /);
    expect(majorEvents(w, aged.year - 25, aged.year)).toContainEqual(evs[0]);
    // Regions still cover the land once each.
    const counted = w.regions.flatMap((r) => r.cells);
    expect(new Set(counted).size).toBe(counted.length);
    expect(w.regions.find((r) => r.state === inv.id)!.cells.sort()).toEqual([...own].sort());
    expect(w.steers[0]!.towns.sort()).toEqual(taken.map((b) => b.id).sort());
  });

  it("builds city generator links with the town's size, walls and coast", () => {
    const b = aged.burgs.find((x) => x.alive && x.coast)!;
    const q = new URL(cityLink(b)).searchParams;
    expect(q.get("name")).toBe(b.name);
    expect(Number(q.get("population"))).toBe(Math.max(100, Math.round(b.population * 1000)));
    expect(q.get("walls")).toBe(b.walls ? "1" : "0");
    expect(q.get("coast")).toBe("1");
    expect(q.get("sea")).not.toBeNull();
  });
});
