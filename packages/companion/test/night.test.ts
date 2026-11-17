/** The city image at night (city/night.ts): darker than the day, with warm lights on it. */

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseCity } from "@gmm/core";
import { townJson } from "../../core/test/fixtures";
import { renderCityNight } from "../src/city/night";
import { cityScale } from "../src/city/render";

describe("city at night", () => {
  it("dims the day image to a cold blue and lights it", async () => {
    const city = parseCity(townJson(), { name: "Testburg", url: "https://watabou.github.io/city-generator/?seed=1" });
    const { W, H } = cityScale(city);
    const day = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 150, g: 140, b: 120 } } }).webp().toBuffer();
    const night = await renderCityNight(day, city);
    const meta = await sharp(night).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
    const stats = await sharp(night).stats();
    const [r, g, b] = stats.channels;
    // Darker than the day on the whole, bluer than it is red, with bright warm points.
    expect(r!.mean + g!.mean + b!.mean).toBeLessThan((150 + 140 + 120) * 0.7);
    expect(b!.mean).toBeGreaterThan(r!.mean * 0.7);
    expect(r!.max).toBeGreaterThan(220);
  });
});
