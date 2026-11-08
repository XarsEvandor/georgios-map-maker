/** Corridors, gates, wrecked gates, gallery art and carpets; and their Foundry doors. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Catalog, colorOf, generate, layoutBuilding, parseVector2, parseVector2Array, Rng, toFoundryScene, validatePlan, ZONE_TYPES, type ScenePlan } from "../src/index";
import { testIndex } from "./fixtures";

const dracula = JSON.parse(readFileSync(new URL("../../../examples/plans/dracula-entrance.json", import.meta.url), "utf8")) as ScenePlan;
/** The same corridor with rooms off its sides and past its end (a plan the DM could ask for). */
const withRooms: ScenePlan = {
  ...dracula,
  size: { w: 30, h: 40 },
  levels: [{
    id: "ground",
    zones: [
      { id: "gallery", type: "gothic.gallery", area: "large" }, { id: "vault_left", type: "gothic.vault", area: "small" },
      { id: "vault_right", type: "gothic.vault", area: "small" }, { id: "inner_hall", type: "gothic.hall", area: "medium" },
    ],
    connections: [
      { id: "outer_gate", from: "gallery", to: "outside", via: "gate", width: 4, state: "closed" },
      { id: "sealed_gate", from: "gallery", to: "inner_hall", via: "gate", width: 4, state: "locked", wall: "end" },
      { id: "medieval_wreck", from: "gallery", to: "vault_left", via: "gate", width: 3, broken: "medieval", wall: "left", along: 0.85 },
      { id: "scifi_wreck", from: "gallery", to: "vault_right", via: "gate", width: 3, broken: "scifi", wall: "right", along: 0.85 },
    ],
  }],
};
const cat = new Catalog(testIndex(), ["fantasy", "victorian"]);
const center = (r: { x: number; y: number; w: number; h: number }): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];

describe("gate and corridor plan fields", () => {
  it("accepts the Dracula plan", () => {
    expect(validatePlan(dracula, ZONE_TYPES)).toEqual([]);
  });
  it("rejects bad gate fields with useful paths", () => {
    const bad = structuredClone(dracula);
    Object.assign(bad.levels[0]!.connections![0]!, { width: 9, state: "ajar", broken: "steampunk", wall: "up", along: 2, via: "portal" });
    const paths = validatePlan(bad, ZONE_TYPES).map((i) => i.path);
    for (const k of ["width", "state", "broken", "wall", "along", "via"]) expect(paths).toContain(`levels[0].connections[0].${k}`);
  });
});

describe("corridor layout", () => {
  for (const seed of [1897, 1898, 1899, 1900, 1901, 1902]) {
    it(`puts rooms where the plan says, seed ${seed}`, () => {
      const L = layoutBuilding({ ...withRooms, seed }, new Rng(seed).fork("layout"));
      expect(L.spine?.zone).toBe("gallery");
      const walk = L.spine!.walk;
      const left: [number, number] = [walk[1], -walk[0]];
      const z = (id: string) => L.zones.find((x) => x.id === id)!;
      const g = center(z("gallery").rect);
      const rel = (id: string): [number, number] => [center(z(id).rect)[0] - g[0], center(z(id).rect)[1] - g[1]];
      expect(dot(rel("vault_left"), left)).toBeGreaterThan(0);
      expect(dot(rel("vault_right"), left)).toBeLessThan(0);
      expect(dot(rel("inner_hall"), walk)).toBeGreaterThan(0);
      // Both vaults sit toward the far end (along 0.85).
      expect(dot(rel("vault_left"), walk)).toBeGreaterThan(0);
      // The corridor is long and wide enough for a framed 4-square gate.
      const r = z("gallery").rect;
      expect(Math.max(r.w, r.h) / Math.min(r.w, r.h)).toBeGreaterThan(2.4);
      expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(8);
    });
  }

  it("makes gates as wide as asked, with their state and wreck kind", () => {
    const L = layoutBuilding(withRooms, new Rng(withRooms.seed).fork("layout"));
    const by = (id: string) => L.doors.find((d) => d.conn === id)!;
    expect(by("outer_gate")).toMatchObject({ gate: true, width: 4, main: true, state: "closed" });
    expect(by("sealed_gate")).toMatchObject({ gate: true, width: 4, state: "locked" });
    expect(by("medieval_wreck")).toMatchObject({ broken: "medieval", width: 3 });
    expect(by("scifi_wreck")).toMatchObject({ broken: "scifi", width: 3 });
    // The entrance is on the corridor's short wall you walk in from.
    const walk = L.spine!.walk;
    expect(Math.abs(dot(by("outer_gate").dir, walk))).toBe(0);
  });

  it("reads a gate written from an outdoor zone toward the room", () => {
    const plan = structuredClone(withRooms);
    plan.levels[0]!.zones.push({ id: "forecourt", type: "gothic.graveyard", area: "small" });
    plan.levels[0]!.connections![0] = { id: "outer_gate", from: "forecourt", to: "gallery", via: "gate", width: 4 };
    plan.size = { w: 30, h: 60 };
    const L = layoutBuilding(plan, new Rng(plan.seed).fork("layout"));
    expect(L.doors.find((d) => d.conn === "outer_gate")).toMatchObject({ gate: true, width: 4, between: ["gallery", "outside"] });
  });
});

describe("a corridor alone: gates into the unseen beyond", () => {
  for (const seed of [1897, 1898, 1899, 1900]) {
    it(`draws nothing behind the gates and puts each where the plan says, seed ${seed}`, () => {
      const L = layoutBuilding({ ...dracula, seed, size: { w: 16, h: 40 } }, new Rng(seed).fork("layout"));
      expect(L.zones.map((z) => z.id)).toEqual(["gallery"]);
      const walk = L.spine!.walk;
      const left: [number, number] = [walk[1], -walk[0]];
      const g = center(L.zones[0]!.rect);
      const by = (id: string) => L.doors.find((d) => d.conn === id)!;
      const rel = (id: string): [number, number] => [by(id).at[0] - g[0], by(id).at[1] - g[1]];
      expect(by("outer_gate").between).toEqual(["gallery", "outside"]);
      for (const id of ["sealed_gate", "medieval_wreck", "scifi_wreck"]) expect(by(id).between).toEqual(["gallery", "beyond"]);
      expect(dot(rel("sealed_gate"), walk)).toBeGreaterThan(0);
      expect(dot(rel("medieval_wreck"), left)).toBeGreaterThan(0);
      expect(dot(rel("scifi_wreck"), left)).toBeLessThan(0);
      // Darkness around the walls, an approach only in front of the entrance.
      const ap = L.approach!;
      expect(dot([center(ap)[0] - g[0], center(ap)[1] - g[1]], walk)).toBeLessThan(0);
      expect(Math.min(ap.w, ap.h)).toBe(5);
      expect(Math.min(L.map.w - L.building.w, L.map.h - L.building.h)).toBe(2);
    });
  }

  it("fills the unseen dark, keeps outdoor pieces on the approach, and darkens the mood", () => {
    const g = generate(dracula, cat, { date: new Date(2026, 10, 6) });
    const v = g.versions[0]!;
    const level = (v.map as any).world.levels["0"];
    expect(level.patterns.some((p: any) => p.color !== "ffffffff")).toBe(true);
    const ap = g.layout.approach!;
    for (const p of v.placed.filter((x) => x.zone === "outside")) {
      const c = p.center ?? [p.x, p.y];
      expect(c[0] >= ap.x - 0.31 && c[0] <= ap.x + ap.w + 0.31 && c[1] >= ap.y - 0.31 && c[1] <= ap.y + ap.h + 0.31).toBe(true);
    }
    const dark = toFoundryScene(v.map, { name: "d", pps: 100 }).darkness;
    const dimPlan = { ...dracula, mood: { ...dracula.mood, lighting: "bright" as const } };
    const bright = toFoundryScene(generate(dimPlan, cat, { date: new Date(2026, 10, 6) }).versions[0]!.map, { name: "b", pps: 100 }).darkness;
    expect(dark).toBeGreaterThan(0.7);
    expect(dark).toBeGreaterThan(bright);
  });
});

describe("gates, wrecks and the gallery in the generated map", () => {
  const g = generate(dracula, cat, { date: new Date(2026, 10, 6) });
  const v = g.versions[0]!;
  const doors = Object.entries(v.elements).filter(([, e]) => e.kind === "door");

  it("makes the two gates portals with their state and leaves, and no portal for wrecks", () => {
    expect(doors).toHaveLength(2);
    const sealed = doors.find(([, e]) => e.state === "locked")![1];
    expect(sealed.width).toBe(4);
    // The fixture has an open/closed gate pair: Foundry draws the closed leaves, standing on the wall.
    expect(sealed.leaf).toMatchObject({ align: "edge" });
    expect(sealed.leaf!.side).toBeDefined();
    const entrance = doors.find(([, e]) => e.state === "closed")![1];
    expect(entrance.leaf).toMatchObject({ align: "center", box: [0, 0, 1, 1] });
  });

  it("leaves an open gap where each gate was blown apart, with its wreckage in front", () => {
    const walls = ((v.map as any).world.levels["0"].walls as Array<{ points: string; loop: boolean }>).map((w) => ({ pts: parseVector2Array(w.points).map((p) => [p[0] / 256, p[1] / 256] as [number, number]), loop: w.loop }));
    const onWall = (p: [number, number]) => walls.some(({ pts, loop }) => pts.some((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      if (!loop && i === pts.length - 1) return false;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
      return t > 0 && t < 1 && Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len < 0.05;
    }));
    for (const d of g.layout.doors.filter((x) => x.broken)) expect(onWall(d.at)).toBe(false);
    for (const d of g.layout.doors.filter((x) => x.gate && !x.broken)) expect(onWall(d.at)).toBe(true);
    const wreck = (f: RegExp) => v.placed.filter((p) => f.test(p.feature));
    expect(wreck(/^wreck_gate$/).length).toBeGreaterThan(0);
    // Sci-fi wreckage comes from a sci-fi pack, though the map is gothic.
    expect(wreck(/^wreck_(plates|door|wires)$/).some((p) => p.asset.pack === "SCIFI")).toBe(true);
    expect(v.placed.some((p) => p.feature === "gate_frame" && /Open/.test(p.asset.name))).toBe(true);
  });

  it("hangs art in mirrored pairs and runs one carpet down the hall", () => {
    const art = v.placed.filter((p) => p.feature === "art" && p.type === "painting");
    expect(art.length).toBeGreaterThanOrEqual(4);
    expect(art.length % 2).toBe(0);
    const rug = v.placed.filter((p) => p.feature === "runner" && p.type === "runner");
    expect(rug.length).toBeGreaterThan(1);
    // Frayed: torn stretches between plain ones, stretched to fill the hall.
    expect(rug.some((p) => /Torn/.test(p.asset.name))).toBe(true);
    expect(rug.some((p) => p.stretch !== undefined)).toBe(true);
  });

  it("exports locked and closed gates to Foundry with swinging leaves; windows keep light in", () => {
    const meta = Object.fromEntries(doors.map(([nid, e]) => [nid, { state: e.state, width: e.width, leaf: e.leaf }]));
    const scene = toFoundryScene(v.map, { name: "Dracula", pps: 100, doors: meta });
    const gates = scene.walls.filter((w) => w.door === 1);
    expect(gates.map((w) => w.ds).sort()).toEqual([0, 2]);
    for (const w of gates) {
      expect(w.animation).toMatchObject({ type: "swing", double: true });
      expect(w.animation!.texture).toMatch(/^leaf:[0-9a-f]+$/);
      expect((w.flags.core as { textureGridSize: number }).textureGridSize).toBeGreaterThan(8);
    }
    for (const w of scene.walls) expect(w.light).toBe(20);
  });
});

describe("colorOf", () => {
  it("reads color names, shades and hex", () => {
    expect(colorOf("crimson")).toBe("ff8c1c28");
    expect(colorOf("#7a1f24")).toBe("ff7a1f24");
    expect(colorOf("dark red")).not.toBe(colorOf("red"));
    expect(colorOf("plaid")).toBeUndefined();
    void parseVector2;
  });
});

describe("edits stay local", () => {
  const tavern = JSON.parse(readFileSync(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
  const sig = (ps: Array<{ zone: string; key: string; x: number; y: number }>, zone: string) => ps.filter((p) => p.zone === zone).map((p) => `${p.key}@${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort();

  it("removing a pin in one room leaves the other rooms as they were", () => {
    const a = generate(tavern, cat, { date: new Date(2026, 10, 6) });
    const without = { ...tavern, directives: (tavern.directives ?? []).filter((d) => d.id !== "d1") };
    const b = generate(without, cat, { date: new Date(2026, 10, 6) });
    for (const zone of ["kitchen", "storage", "guest"]) expect(sig(b.versions[0]!.placed, zone)).toEqual(sig(a.versions[0]!.placed, zone));
    expect(sig(b.versions[0]!.placed, "common")).not.toEqual(sig(a.versions[0]!.placed, "common"));
  });

  it("locking the whole map keeps the piece count through repeated regenerations", () => {
    const first = generate(tavern, cat, { date: new Date(2026, 10, 6) });
    const locked: ScenePlan = { ...tavern, locks: [{ id: "all", region: { x: 0, y: 0, w: 80, h: 80 } }], versions: { ...(tavern.versions ?? {}), picked: "v1" } };
    let prev = { ...first, plan: locked };
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g = generate(locked, cat, { date: new Date(2026, 10, 6), previous: prev });
      counts.push(g.versions[0]!.placed.length);
      prev = g;
    }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(first.versions[0]!.placed.length);
  });
});
