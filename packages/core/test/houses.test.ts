/** 2MT house drawings laid into a city's plots (city/houses.ts). */

import { describe, expect, it } from "vitest";
import { centroid, findHotSpots, inside, parseCity, placeHouses, type AssetRecord, type HouseArt } from "../src/index";

const sq = (x: number, y: number, s: number, t = s) => [[x, y], [x + s, y], [x + s, y + t], [x, y + t], [x, y]];
/** A small walled town in MFCG's GeoJSON shape: terraces, a slanted wedge, a square, a castle with its keep. */
function town() {
  const houses: number[][][][] = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) houses.push([sq(-90 + i * 30, -60 + j * 30, 22, 13)]);
  houses.push([[[40, -60], [62, -60], [52, -40], [40, -45], [40, -60]]]); // a slanted wedge
  houses.push([sq(-20, 95, 40)]); // the keep, in the castle
  houses.push([sq(25, 10, 26, 22)]); // a big building by the square: the temple
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "values", roadWidth: 8, towerRadius: 6, wallThickness: 6 },
      { type: "GeometryCollection", id: "roads", geometries: [{ type: "LineString", width: 8, coordinates: [[-250, 0], [-120, 0], [0, 0]] }] },
      { type: "GeometryCollection", id: "walls", geometries: [{ type: "Polygon", width: 6, coordinates: [sq(-120, -120, 240)] }] },
      { type: "MultiPolygon", id: "buildings", coordinates: houses },
      { type: "MultiPolygon", id: "squares", coordinates: [[sq(-10, 20, 30)]] },
      { type: "GeometryCollection", id: "districts", geometries: [{ type: "Polygon", name: "Castle", coordinates: [sq(-40, 80, 80)] }, { type: "Polygon", name: "Old Town", coordinates: [sq(-120, -120, 240)] }] },
    ],
  };
}

const city = parseCity(town(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=7" });
function art(name: string, w: number, h: number, role: HouseArt["role"] = "house"): HouseArt {
  const asset = { id: `test:${name}`, name, size: [512, 512] } as unknown as AssetRecord;
  return { asset, w, h, off: [0, 0], big: false, role };
}
const houses = [art("cottage", 6, 9), art("long house", 11, 7.5), art("small", 4, 5.5), art("square", 10, 10)];
const landmarks = [art("keep roof", 20, 20, "keep"), art("church roof", 18, 27, "church"), art("chapel roof", 10.5, 10.5, "chapel"), art("spire", 6, 6.5, "spire")];

describe("placeHouses", () => {
  const layout = placeHouses(city, [...houses, ...landmarks], city.url);

  it("puts a drawing on every plot, odd shapes included", () => {
    expect(layout.bare).toEqual([]);
    const built = new Set(layout.houses.map((h) => h.plot));
    expect(built.size).toBe(city.buildings.length);
  });

  it("is the same every time for a city", () => {
    const again = placeHouses(city, [...houses, ...landmarks], city.url);
    expect(again.houses.map((h) => [h.art.asset.name, h.at[0].toFixed(3), h.at[1].toFixed(3), h.rot.toFixed(4)])).toEqual(layout.houses.map((h) => [h.art.asset.name, h.at[0].toFixed(3), h.at[1].toFixed(3), h.rot.toFixed(4)]));
  });

  it("keeps each ordinary house on its own plot and leaves the drawings unstretched", () => {
    for (const h of layout.houses.filter((x) => !x.landmark)) {
      expect(inside(centroid(h.ring), city.buildings[h.plot]!)).toBe(true);
      const a = Math.hypot(h.ring[1]![0] - h.ring[0]![0], h.ring[1]![1] - h.ring[0]![1]), b = Math.hypot(h.ring[2]![0] - h.ring[1]![0], h.ring[2]![1] - h.ring[1]![1]);
      // Uniform scale: the placed box has the drawing's own proportions.
      expect(Math.max(a, b) / Math.min(a, b)).toBeCloseTo(Math.max(h.art.w, h.art.h) / Math.min(h.art.w, h.art.h), 5);
      expect(h.scale).toBeGreaterThanOrEqual(0.6);
      expect(h.scale).toBeLessThanOrEqual(1.6);
    }
  });

  it("gives the keep the keep roof and the temple a church roof", () => {
    const spots = findHotSpots(city);
    const keepPlot = city.buildings.indexOf(spots.find((h) => h.kind === "keep")!.building!);
    const templePlot = city.buildings.indexOf(spots.find((h) => h.kind === "temple")!.building!);
    expect(layout.houses.filter((h) => h.plot === keepPlot).map((h) => h.art.asset.name)).toEqual(["keep roof"]);
    const temple = layout.houses.filter((h) => h.plot === templePlot).map((h) => h.art.asset.name);
    expect(temple[0]).toMatch(/church roof|chapel roof/);
    if (temple[0] === "chapel roof") expect(temple).toContain("spire");
    expect(layout.landmarks.keep).toEqual([keepPlot]);
  });

  it("leaves every plot bare when the library has no house drawings, so street maps fall back to drawn roofs", () => {
    const none = placeHouses(city, landmarks, city.url);
    expect(none.houses).toEqual([]);
    expect(none.bare).toHaveLength(city.buildings.length);
  });
});
