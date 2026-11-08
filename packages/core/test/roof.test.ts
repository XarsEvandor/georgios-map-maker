/** Hip roofs over building outlines (city/roof.ts). */

import { describe, expect, it } from "vitest";
import { area, faceLight, hipRoof, type Pt, type Ring } from "../src/index";

const len = ([a, b]: [Pt, Pt]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const faceArea = (r: Ring) => area(r);

describe("hip roofs", () => {
  it("covers a long house with two trapezoids, two triangles, four hips and a ridge", () => {
    const roof = hipRoof([[0, 0], [10, 0], [10, 4], [0, 4]]);
    expect(roof.faces).toHaveLength(4);
    expect(roof.hips).toHaveLength(4);
    expect(roof.ridges).toHaveLength(1);
    expect(len(roof.ridges[0]!)).toBeCloseTo(6, 5);
    expect(roof.ridges[0]![0][1]).toBeCloseTo(2, 5);
    expect(roof.faces.reduce((s, f) => s + faceArea(f.ring), 0)).toBeCloseTo(40, 4);
    // Each face slopes down to its own wall: the top wall's face points up the screen (-y).
    const top = roof.faces.find((f) => f.eave[0][1] === 0 && f.eave[1][1] === 0)!;
    expect(top.down[1]).toBeCloseTo(-1, 5);
  });

  it("gives a square a pyramid: four hips meeting in the middle, no ridge", () => {
    const roof = hipRoof([[0, 0], [6, 0], [6, 6], [0, 6]]);
    expect(roof.faces).toHaveLength(4);
    expect(roof.ridges).toHaveLength(0);
    for (const [, top] of roof.hips) {
      expect(top[0]).toBeCloseTo(3, 5);
      expect(top[1]).toBeCloseTo(3, 5);
    }
  });

  it("handles either winding, skewed quads and a closing point", () => {
    const cw = hipRoof([[0, 0], [0, 4], [10, 4], [10, 0], [0, 0]]);
    expect(cw.faces).toHaveLength(4);
    const skew = hipRoof([[0, 0], [11, 1], [10, 6], [-1, 5]]);
    expect(skew.faces).toHaveLength(4);
    expect(skew.faces.reduce((s, f) => s + faceArea(f.ring), 0)).toBeCloseTo(area([[0, 0], [11, 1], [10, 6], [-1, 5]]), 3);
  });

  it("roofs an L-shaped house as wings that together cover the outline", () => {
    const L: Ring = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const roof = hipRoof(L);
    expect(roof.faces.length).toBeGreaterThanOrEqual(7);
    expect(roof.faces.reduce((s, f) => s + faceArea(f.ring), 0)).toBeCloseTo(area(L), 3);
  });

  it("lights faces that look toward the north-west sun", () => {
    const roof = hipRoof([[0, 0], [10, 0], [10, 4], [0, 4]]);
    const north = roof.faces.find((f) => f.down[1] < -0.9)!;
    const south = roof.faces.find((f) => f.down[1] > 0.9)!;
    expect(faceLight(north)).toBeGreaterThan(faceLight(south));
  });

  it("ignores slivers", () => {
    expect(hipRoof([[0, 0], [1, 0], [2, 0]]).faces).toHaveLength(0);
  });
});
