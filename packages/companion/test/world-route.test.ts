import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { worldRoute } from "../src/world/route";

describe("maps.route: the way between two towns, in words and as a picture", () => {
  it("answers with the route and a picture of the map with the way drawn on it, or with the nearest names", async () => {
    const data = await mkdtemp(join(tmpdir(), "gmm-route-"));
    const dir = join(data, "worlds", "testworld");
    await mkdir(dir, { recursive: true });
    const aged = {
      burgs: [null, { id: 1, name: "Narkoc", cell: 1, x: 100, y: 100, state: 1 }, { id: 2, name: "Midhollow", cell: 3, x: 200, y: 100, state: 1, alive: false }, { id: 3, name: "Zugkatil", cell: 5, x: 200, y: 200, state: 1 }],
      routes: [{ group: "roads", points: [[100, 100, 1], [150, 100, 2], [200, 100, 3]] }, { group: "trails", points: [[200, 100, 3], [200, 150, 4], [200, 200, 5]] }],
      cells: { state: [0, 1, 1, 1, 1, 1], biome: [0, 4, 4, 4, 6, 6] },
      states: [null, { id: 1, name: "March" }],
    };
    await writeFile(join(dir, "aged.json"), JSON.stringify(aged));
    await writeFile(join(dir, "map.json"), JSON.stringify({ width: 1600, height: 1600, scale: 5 }));
    await writeFile(join(dir, "bundle.json"), JSON.stringify({ grid: { size: 100, distance: 6 }, image: { file: "map.webp" } }));
    await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#c8d8a8" } }).webp().toFile(join(dir, "map.webp"));
    const r = await worldRoute(data, "testworld", "narkoc", "Zugkatil");
    expect(r.found).toBe(true);
    // 100 + 100 units at 5 px a unit and 6 mi per 100 px.
    expect(Math.round(r.route!.miles)).toBe(60);
    expect(r.route!.towns).toEqual(["Midhollow (ruins)"]);
    expect(r.text).toContain("Narkoc to Zugkatil: 60 mi by the shortest way");
    expect(r.text).toContain("Narkoc is the green dot, Zugkatil the red one");
    const pic = await sharp(Buffer.from(r.image!.data, "base64")).metadata();
    expect([r.image!.media_type, pic.format]).toEqual(["image/jpeg", "jpeg"]);
    expect(Math.max(pic.width!, pic.height!)).toBeLessThanOrEqual(1400);
    const lost = await worldRoute(data, "testworld", "Nokron", "Zugkatil");
    expect(lost.found).toBe(false);
    expect(lost.unknown![0]!.name).toBe("Nokron");
    expect(lost.text).toContain('No town called "Nokron" on the map; the nearest names: ');
    await expect(worldRoute(data, "../etc", "a", "b")).rejects.toThrow(/bad world id/);
    // Through a town on the way: its stop is marked, and the text says so.
    const via = await worldRoute(data, "testworld", "Narkoc", "Zugkatil", { via: ["Midhollow"], image: false });
    expect(via.route!.via).toEqual(["Midhollow"]);
    expect(via.route!.stops.map((s) => s.name)).toEqual(["Narkoc", "Midhollow", "Zugkatil"]);
    expect(via.text).toContain("Narkoc to Zugkatil through Midhollow: 60 mi");
    expect(via.image).toBeUndefined();
    // A stop that is no town is named back with its nearest names; so is a start.
    const lostVia = await worldRoute(data, "testworld", "Narkoc", "Zugkatil", { via: ["Midholow", "Atlantis"] });
    expect(lostVia.found).toBe(false);
    expect(lostVia.unknown!.map((u) => u.name)).toEqual(["Atlantis"]);
    // Towns clicked on the map come by id, in order.
    const clicked = await worldRoute(data, "testworld", "", "", { ids: [1, 2, 3], image: false });
    expect([clicked.found, clicked.route!.via, Math.round(clicked.route!.miles)]).toEqual([true, ["Midhollow"], 60]);
    expect((await worldRoute(data, "testworld", "", "", { ids: [1, 99] })).text).toBe("No town with the id 99 on the map.");
    // By land only, when asked: no second way offered.
    const land = await worldRoute(data, "testworld", "Narkoc", "Zugkatil", { land: true, image: false });
    expect([land.land, land.text?.includes("By land only, as asked")]).toEqual([null, true]);
  });
});
