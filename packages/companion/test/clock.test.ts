/** The module's clock: segments of the day, stepping, and the lighting each brings (foundry-module/scripts/daytime.js). */

import { describe, expect, it } from "vitest";
import { LAMPS_LIT_FROM as CORE_LAMPS } from "@gmm/core";
// @ts-expect-error plain JS module without types
import { DAYLIGHT_UNTIL, LAMPS_LIT_FROM, OVERVIEW_DARKEST, SEGMENTS, isNight, SEGMENTS_PER_PHASE, lightingFor, sceneLighting, segmentOf, segmentSpan, stepSeconds } from "../../../foundry-module/scripts/daytime.js";

const DAY = 86400;
const H = 3600;

describe("clock", () => {
  it("splits a day into 8 day segments from 06:00 and 8 night ones from 18:00", () => {
    expect(SEGMENTS.length).toBe(16);
    expect(SEGMENTS_PER_PHASE).toBe(8);
    expect(segmentOf(6 * H, DAY)).toBe(0);
    expect(segmentOf(7.5 * H - 1, DAY)).toBe(0);
    expect(segmentOf(12 * H, DAY)).toBe(4);
    expect(segmentOf(18 * H, DAY)).toBe(8);
    expect(segmentOf(0, DAY)).toBe(12);
    expect(segmentOf(6 * H - 1, DAY)).toBe(15);
    expect(segmentSpan(0, DAY)).toEqual([6 * H, 7.5 * H]);
    expect(segmentSpan(15, DAY)).toEqual([4.5 * H, 6 * H]);
  });

  it("steps to the start of the next or previous segment, round the clock", () => {
    expect(stepSeconds(6 * H, DAY, 1)).toBe(1.5 * H);
    expect(stepSeconds(7 * H, DAY, 1)).toBe(0.5 * H);
    expect(stepSeconds(6 * H, DAY, -1)).toBe(-1.5 * H);
    expect(stepSeconds(7 * H, DAY, -1)).toBe(-2.5 * H);
    // Sixteen steps make a day.
    let t = 6 * H;
    for (let k = 0; k < 16; k++) t += stepSeconds(t % DAY, DAY, 1);
    expect(t).toBe(6 * H + DAY);
    // Other calendars: a 20-hour day still has 16 segments.
    const day20 = 20 * H;
    expect(segmentOf(5 * H, day20)).toBe(0);
    expect(segmentOf(15 * H, day20)).toBe(8);
  });

  it("keeps daylight through every day segment and puts it out every night one", () => {
    for (let i = 0; i < 16; i++) {
      const night = i >= 8;
      expect(SEGMENTS[i].darkness > DAYLIGHT_UNTIL, SEGMENTS[i].key).toBe(night);
    }
    expect(lightingFor(4)).toEqual({ darknessLevel: 0, globalLight: { enabled: true, bright: true, darkness: { min: 0, max: DAYLIGHT_UNTIL } } });
    // Dawn and dusk: dim daylight, lamps lit.
    expect(lightingFor(0).globalLight.bright).toBe(false);
    expect(SEGMENTS[0].darkness).toBeGreaterThanOrEqual(LAMPS_LIT_FROM);
    expect(SEGMENTS[7].darkness).toBeGreaterThanOrEqual(LAMPS_LIT_FROM);
    expect(SEGMENTS[4].darkness).toBeLessThan(LAMPS_LIT_FROM);
    expect(LAMPS_LIT_FROM).toBe(CORE_LAMPS);
  });

  it("updates a scene only when its light differs and its darkness is not locked", () => {
    const at = lightingFor(10);
    expect(sceneLighting({ ...at }, 10)).toBeNull();
    expect(sceneLighting({ ...at, darknessLevel: 0 }, 10)).toEqual({ environment: at });
    expect(sceneLighting({ darknessLevel: 0, darknessLock: true }, 10)).toBeNull();
    expect(sceneLighting({ darknessLevel: 0.85, globalLight: { enabled: false, bright: false, darkness: { min: 0, max: 1 } } }, 10)).toEqual({ environment: at });
  });

  it("gives city and world maps (no token vision) a softer night", () => {
    expect(lightingFor(12, { overview: true }).darknessLevel).toBe(OVERVIEW_DARKEST);
    expect(lightingFor(12).darknessLevel).toBe(0.95);
    expect(lightingFor(4, { overview: true }).darknessLevel).toBe(0);
    expect(sceneLighting({ darknessLevel: 0.95 }, 12, { overview: true })?.environment.darknessLevel).toBe(OVERVIEW_DARKEST);
  });

  it("shows a city's night image without darkness on top, and its day image as usual", () => {
    for (let i = 0; i < 16; i++) expect(isNight(i)).toBe(i >= 8);
    expect(lightingFor(12, { overview: true, nightImage: true }).darknessLevel).toBe(0);
    expect(lightingFor(8, { overview: true, nightImage: true }).darknessLevel).toBe(0);
    expect(lightingFor(7, { overview: true, nightImage: true }).darknessLevel).toBe(SEGMENTS[7].darkness);
  });
});
