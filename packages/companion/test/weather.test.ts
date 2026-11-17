/** The module's calendar and weather (foundry-module/scripts/weather.js and the date parts of daytime.js). */

import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module without types
import { EASE, FLAKES_SHRINK_MOST, MAX_WALK, NEXT, SEASONS, SETTLE, WEATHER, chance, chancesFrom, effectFor, flakeScale, nextWeather, seasonKind, trimLog, walk, weatherAt } from "../../../foundry-module/scripts/weather.js";
// @ts-expect-error plain JS module without types
import { DAYLIGHT_UNTIL, LAMPS_LIT_FROM, OVERCAST_DARKEST, SEGMENTS, absoluteSegment, dayOfYear, lightingFor, segmentOf, segmentStart, stepSeconds } from "../../../foundry-module/scripts/daytime.js";

const DAY = 86400;
const H = 3600;
const SEG = DAY / 16;

/** The Simplified Gregorian months as Foundry lists them. */
const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, i) => (i === 1 ? { days, leapDays: 29 } : { days }));

describe("days and dates", () => {
  it("counts segments from the start of world time, and their remainder is the segment of the day", () => {
    for (const t of [0, 5400, 6 * H, 6 * H + 1, 23 * H, DAY + 7 * H, 400 * DAY + 13 * H]) {
      const n = absoluteSegment(t, DAY);
      expect(((n % 16) + 16) % 16).toBe(segmentOf(t % DAY, DAY));
      expect(segmentStart(n, DAY)).toBeLessThanOrEqual(t);
      expect(segmentStart(n + 1, DAY)).toBeGreaterThan(t);
    }
    expect(absoluteSegment(6 * H, DAY)).toBe(0);
    expect(absoluteSegment(0, DAY)).toBe(-4);
  });

  it("moves the date on when the step button passes midnight, and back when it steps back over it", () => {
    const lateNight = 5 * DAY + 22.5 * H;
    const midnight = lateNight + stepSeconds(lateNight % DAY, DAY, 1);
    expect(midnight).toBe(6 * DAY);
    expect(Math.floor(lateNight / DAY)).toBe(5);
    expect(Math.floor(midnight / DAY)).toBe(6);
    expect(SEGMENTS[segmentOf(midnight % DAY, DAY)].key).toBe("Midnight");
    const back = midnight + stepSeconds(midnight % DAY, DAY, -1);
    expect(back).toBe(lateNight);
    expect(Math.floor(back / DAY)).toBe(5);
    // Sixteen steps from any segment start: the same time on the next date.
    let t = 3 * DAY + 9 * H;
    for (let k = 0; k < 16; k++) t += stepSeconds(t % DAY, DAY, 1);
    expect(t).toBe(4 * DAY + 9 * H);
  });

  it("turns a date into days into its year, leap years and short months included", () => {
    expect(dayOfYear(MONTHS, false, 0, 1)).toBe(0);
    expect(dayOfYear(MONTHS, false, 2, 1)).toBe(59);
    expect(dayOfYear(MONTHS, true, 2, 1)).toBe(60);
    expect(dayOfYear(MONTHS, false, 11, 31)).toBe(364);
    // 31 February is the last day of February.
    expect(dayOfYear(MONTHS, false, 1, 31)).toBe(58);
    expect(dayOfYear(MONTHS, true, 1, 31)).toBe(59);
    expect(dayOfYear(MONTHS, false, 0, 0)).toBe(0);
  });
});

describe("seasons", () => {
  it("knows the four seasons by name, in Foundry's keys or any words", () => {
    expect(seasonKind("CALENDAR.GREGORIAN.Spring Spring", 3, 12)).toBe("spring");
    expect(seasonKind("CALENDAR.GREGORIAN.Summer", 6, 12)).toBe("summer");
    expect(seasonKind("CALENDAR.GREGORIAN.Fall Fall", 9, 12)).toBe("autumn");
    expect(seasonKind("Deep Winter", 0, 12)).toBe("winter");
  });

  it("falls back on the month round the year when a season has no name it knows", () => {
    const by = (m: number) => seasonKind("", m, 12);
    expect([11, 0, 1].map(by)).toEqual(["winter", "winter", "winter"]);
    expect([2, 3, 4].map(by)).toEqual(["spring", "spring", "spring"]);
    expect([5, 6, 7].map(by)).toEqual(["summer", "summer", "summer"]);
    expect([8, 9, 10].map(by)).toEqual(["autumn", "autumn", "autumn"]);
  });
});

describe("weather", () => {
  const always = (s: string) => () => s;
  const ALL = Object.keys(WEATHER);

  it("gives every weather in every season chances that add up to 100, toward weathers that exist", () => {
    for (const s of SEASONS) {
      for (const [from, row] of Object.entries(NEXT[s] as Record<string, Record<string, number>>)) {
        expect(ALL, `${s} ${from}`).toContain(from);
        expect(Object.values(row).reduce((a, b) => a + b, 0), `${s} ${from}`).toBe(100);
        for (const to of Object.keys(row)) expect(ALL, `${s} ${from} -> ${to}`).toContain(to);
      }
      // A weather the season has no row for eases a step toward clear.
      for (const w of ALL) expect((Object.values(chancesFrom(w, s)) as number[]).reduce((a, b) => a + b, 0)).toBe(100);
    }
    for (const w of ALL) expect(ALL).toContain(EASE[w]);
  });

  it("moves a step at a time: a clear sky clouds over before it rains or snows", () => {
    const heavy = ["drizzle", "rain", "storm", "flurries", "snow", "blizzard"];
    for (const s of SEASONS) {
      for (const to of Object.keys(chancesFrom("clear", s))) expect(heavy, `${s}: clear -> ${to}`).not.toContain(to);
      for (const to of Object.keys(chancesFrom("blizzard", s))) expect(["blizzard", "snow"], `${s}: blizzard -> ${to}`).toContain(to);
      for (const to of Object.keys(chancesFrom("storm", s))) expect(["storm", "rain", "cloudy"], `${s}: storm -> ${to}`).toContain(to);
      for (const to of Object.keys(chancesFrom("snow", s))) expect(["snow", "flurries", "blizzard"], `${s}: snow -> ${to}`).toContain(to);
    }
    // Snow left over into summer melts away a step at a time.
    expect(chancesFrom("blizzard", "summer")).toEqual({ snow: 100 });
    expect(chancesFrom("snow", "summer")).toEqual({ flurries: 100 });
    expect(chancesFrom("flurries", "summer")).toEqual({ cloudy: 100 });
  });

  it("does not snow all winter: mostly clear or overcast, snow about a fifth of the time, spells of hours", () => {
    const share = (s: string) => {
      const N = 40000;
      let w = "clear", changes = 0;
      const count: Record<string, number> = {};
      for (let k = 0; k < N; k++) {
        const v = nextWeather(w, s, chance("climate", k, "sky"));
        if (v !== w) changes++;
        w = v;
        count[w] = (count[w] ?? 0) + 1;
      }
      const of = (...ws: string[]) => ws.reduce((t, x) => t + (count[x] ?? 0), 0) / N;
      return { of, hours: (N / changes) * 1.5 };
    };
    const winter = share("winter");
    expect(winter.of("flurries", "snow", "blizzard")).toBeGreaterThan(0.1);
    expect(winter.of("flurries", "snow", "blizzard")).toBeLessThan(0.35);
    expect(winter.of("blizzard")).toBeLessThan(0.05);
    expect(winter.of("clear", "cloudy")).toBeGreaterThan(0.5);
    const summer = share("summer");
    expect(summer.of("clear")).toBeGreaterThan(0.5);
    expect(summer.of("flurries", "snow", "blizzard")).toBe(0);
    for (const s of SEASONS) {
      expect(share(s).hours, s).toBeGreaterThan(3);
      expect(share(s).hours, s).toBeLessThan(10);
    }
  });

  it("walks on from the recorded weather, the same for everyone", () => {
    const seasonAt = always("winter");
    const log = { 1000: "cloudy" };
    const a = weatherAt(1001, { seed: "wallachia-2", seasonAt, log });
    expect(a).toBe(nextWeather("cloudy", "winter", chance("wallachia-2", 1001, "sky")));
    expect(Object.keys(chancesFrom("cloudy", "winter"))).toContain(a);
    expect(weatherAt(1001, { seed: "wallachia-2", seasonAt, log })).toBe(a);
    // Twelve segments on: the walk from the record, step by step.
    expect(weatherAt(1012, { seed: "wallachia-2", seasonAt, log })).toBe(walk(1000, "cloudy", 1012, seasonAt, "wallachia-2"));
    // Recorded segments keep their weather: stepping back brings it back.
    expect(weatherAt(1000, { seed: "wallachia-2", seasonAt, log })).toBe("cloudy");
    // Another world walks its own way.
    const mine = Array.from({ length: 100 }, (_, k) => weatherAt(2000 + k, { seed: "wallachia-2", seasonAt }));
    const theirs = Array.from({ length: 100 }, (_, k) => weatherAt(2000 + k, { seed: "scribbler-test", seasonAt }));
    expect(mine).not.toEqual(theirs);
  });

  it("carries on from a weather the GM pinned, once the pin is lifted", () => {
    const seasonAt = always("summer");
    const after = new Set<string>();
    for (let n = 0; n < 300; n++) after.add(weatherAt(n + 1, { seed: "pin", seasonAt, log: { [n]: "storm" } }));
    expect([...after].sort()).toEqual(Object.keys(chancesFrom("storm", "summer")).sort());
  });

  it("settles a sky of its own after a long skip, with no record near", () => {
    const seasonAt = always("autumn");
    const far = weatherAt(50000, { seed: "w", seasonAt, log: { 100: "storm" } });
    expect(far).toBe(walk(50000 - SETTLE, "clear", 50000, seasonAt, "w"));
    expect(weatherAt(100 + MAX_WALK, { seed: "w", seasonAt, log: { 100: "storm" } })).toBe(walk(100, "storm", 100 + MAX_WALK, seasonAt, "w"));
  });

  it("keeps the record short", () => {
    const log = Object.fromEntries(Array.from({ length: 2000 }, (_, k) => [k, "clear"]));
    const kept = trimLog(log, 1000);
    expect(Object.keys(kept).length).toBe(801);
    expect(kept[1000]).toBe("clear");
    expect(kept[0]).toBeUndefined();
  });

  it("draws snowflakes small enough on a city scene to read as falling snow, and at Foundry's size on maps", () => {
    expect(flakeScale(100, 5, "ft")).toBe(1);
    expect(flakeScale(140, 5, "ft")).toBe(1);
    expect(flakeScale(70, 5, "ft")).toBe(1);
    // A city scene (50 px to 25 ft) is ten times coarser than a battle map; flakes shrink 3 times.
    expect(flakeScale(50, 25, "ft")).toBe(FLAKES_SHRINK_MOST);
    expect(FLAKES_SHRINK_MOST).toBe(3);
    expect(flakeScale(50, 200, "ft")).toBe(FLAKES_SHRINK_MOST);
    expect(flakeScale(100, 6, "m")).toBeCloseTo(20 / (100 / (6 * 3.28084)) / 2, 5);
    expect(flakeScale(100, 1.5, "m")).toBe(1);
    expect(flakeScale(0, 0, "")).toBe(1);
  });

  it("draws Foundry's effects stronger, with a second layer of snow, without changing Foundry's own", () => {
    // Foundry's configs as client/config.mjs has them (classes left out).
    const FOUNDRY: Record<string, any> = {
      rain: { id: "rain", effects: [{ id: "rainShader", config: { opacity: 0.25, tint: [0.7, 0.9, 1], intensity: 1, strength: 1, rotation: 0.2618, speed: 0.2 } }] },
      rainStorm: { id: "rainStorm", effects: [{ id: "fogShader", config: { slope: 1.5, intensity: 0.05, speed: -55, scale: 25 } }, { id: "rainShader", config: { opacity: 0.45, intensity: 1.5, strength: 1.5 } }] },
      fog: { id: "fog", effects: [{ id: "fogShader", config: { slope: 0.45, intensity: 0.4, speed: 0.4 } }] },
      snow: { id: "snow", effects: [{ id: "snowShader", config: { tint: [0.85, 0.95, 1], direction: 0.5, speed: 2, scale: 2.5 } }] },
      blizzard: { id: "blizzard", effects: [{ id: "snowShader", config: { tint: [0.95, 1, 1], direction: 0.8, speed: 8, scale: 2.5 } }, { id: "fogShader", config: { slope: 1, intensity: 0.15, speed: -4 } }] },
      leaves: { id: "leaves", effects: [{ id: "leavesParticles", particles: [{ count: 200 }] }] },
    };
    const before = JSON.stringify(FOUNDRY);
    const make = (w: string, k = 1) => effectFor(FOUNDRY[WEATHER[w].effect], w, k);
    const cfg = (w: string, id: string, k = 1) => make(w, k).effects.find((e: any) => e.id === id).config;
    // A ladder: drizzle is short, thin drops falling slowly; rain long streaks; a storm denser and brighter than rain.
    const drizzle = cfg("drizzle", "rainShader"), rain = cfg("rain", "rainShader"), storm = cfg("storm", "rainShader");
    expect(drizzle.resolution[1]).toBeGreaterThan(80);
    expect(rain.resolution ?? [3200, 80]).toEqual([3200, 80]);
    expect(drizzle.strength).toBeLessThan(rain.strength);
    expect(drizzle.speed).toBeLessThan(rain.speed);
    expect(rain.opacity).toBeGreaterThan(0.25);
    expect(storm.opacity).toBeGreaterThan(rain.opacity);
    expect(storm.strength).toBeGreaterThan(rain.strength);
    // Light snow: dimmer flakes than snow, and one layer to snow's two.
    const light = cfg("flurries", "snowShader"), full = cfg("snow", "snowShader");
    expect(Math.max(...light.tint)).toBeLessThan(Math.min(...full.tint));
    expect(cfg("storm", "fogShader").scale).toBe(25);
    expect(cfg("fog", "fogShader").intensity).toBeGreaterThan(cfg("mist", "fogShader").intensity);
    expect(cfg("mist", "fogShader").intensity).toBeGreaterThan(0.4);
    // Snow: two layers, each with its own id (Foundry keeps effects by id), both shrunk on a city.
    const snow = make("snow", 3).effects;
    expect(snow.map((e: any) => e.id)).toEqual(["snowShader", "snowShaderGmm1"]);
    expect(snow[0].config.scale).toBeCloseTo(7.5, 5);
    expect(snow[1].config.scale).toBeCloseTo(5.1, 5);
    expect(make("flurries").effects).toHaveLength(1);
    const blizzard = make("blizzard").effects;
    expect(blizzard.map((e: any) => e.id)).toEqual(["snowShader", "fogShader", "snowShaderGmm1"]);
    expect(blizzard[2].config.speed).toBe(6);
    expect(blizzard[1].config.intensity).toBeGreaterThan(0.15);
    expect(make("leaves").effects[0].particles).toEqual([{ count: 200 }]);
    expect(make("clear")).toBeNull();
    expect(make("cloudy")).toBeNull();
    expect(JSON.stringify(FOUNDRY)).toBe(before);
  });

  it("dims the day in bad weather without putting out the daylight, and leaves the night alone", () => {
    const midday = SEGMENTS.findIndex((s: { key: string }) => s.key === "Midday");
    const dusk = SEGMENTS.findIndex((s: { key: string }) => s.key === "Dusk");
    const night = SEGMENTS.findIndex((s: { key: string }) => s.key === "Night");
    expect(lightingFor(midday, { dim: WEATHER.clear.dim }).darknessLevel).toBe(0);
    const storm = lightingFor(midday, { dim: WEATHER.storm.dim });
    expect(storm.darknessLevel).toBe(0.25);
    // A heavy storm lights the lamps.
    expect(storm.darknessLevel).toBeGreaterThanOrEqual(LAMPS_LIT_FROM);
    expect(storm.globalLight.bright).toBe(false);
    const duskStorm = lightingFor(dusk, { dim: WEATHER.blizzard.dim });
    expect(duskStorm.darknessLevel).toBe(OVERCAST_DARKEST);
    expect(duskStorm.darknessLevel).toBeLessThanOrEqual(DAYLIGHT_UNTIL);
    expect(lightingFor(night, { dim: WEATHER.storm.dim })).toEqual(lightingFor(night));
    expect(lightingFor(midday, { dim: WEATHER.rain.dim, overview: true }).darknessLevel).toBe(WEATHER.rain.dim);
    // Overcast dims a little; the lamps stay off.
    expect(lightingFor(midday, { dim: WEATHER.cloudy.dim }).darknessLevel).toBeLessThan(LAMPS_LIT_FROM);
  });
});
