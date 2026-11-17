/** The city at night from above: where its lights burn (city/night.ts). */

import { describe, expect, it } from "vitest";
import { centroid, cityNightLights, inside, parseCity } from "../src/index";
import { townJson } from "./fixtures";

describe("city lights at night", () => {
  const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
  const lights = cityNightLights(city);

  it("lights windows in the houses and lamps in the streets", () => {
    const windows = lights.filter((l) => l.kind === "window");
    const lamps = lights.filter((l) => l.kind === "lamp");
    expect(windows.length).toBeGreaterThan(city.buildings.length / 2);
    expect(lamps.length).toBeGreaterThan(0);
    for (const w of windows) expect(city.buildings.some((b) => inside(w.at, b))).toBe(true);
    // Street lamps stand in the street, not in a house.
    for (const l of lamps) expect(city.buildings.some((b) => inside(l.at, b))).toBe(false);
    for (const l of lights) {
      expect(l.r).toBeGreaterThan(0);
      expect(l.i).toBeGreaterThan(0);
      expect(l.i).toBeLessThanOrEqual(1);
    }
  });

  it("puts a torch on every tower of the wall", () => {
    const towers = lights.filter((l) => l.kind === "tower").length;
    expect(towers).toBeGreaterThanOrEqual(city.walls.reduce((n, w) => n + w.ring.length, 0));
  });

  it("is the same every time", () => {
    expect(cityNightLights(city)).toEqual(lights);
    expect(centroid(lights.map((l) => l.at))).toEqual(centroid(cityNightLights(city).map((l) => l.at)));
  });
});
