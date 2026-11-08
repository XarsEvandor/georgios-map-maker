/**
 * Writes a tiny hand-placed map using 2MT assets, to check that Dungeondraft opens our files.
 *   npx tsx packages/companion/src/cli/smoke-map.ts [--w 14] [--h 10] [--out data/maps/smoke.dungeondraft_map]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DDMapBuilder, PX_PER_SQUARE as S, type AssetIndex, type AssetRecord } from "@gmm/core";

const { values } = parseArgs({
  options: {
    w: { type: "string", default: "14" },
    h: { type: "string", default: "10" },
    out: { type: "string", default: "data/maps/smoke.dungeondraft_map" },
  },
});
const index = JSON.parse(await readFile(resolve("data/asset-index.json"), "utf8")) as AssetIndex;
const packByName = new Map(index.packs.map((p) => [p.name, p]));
const find = (pack: string, kind: string, pred: (a: AssetRecord) => boolean = () => true) => {
  const p = packByName.get(pack);
  if (!p) throw new Error(`pack ${pack} not found`);
  const a = index.assets.find((x) => x.pack === p.id && x.kind === kind && !x.colorable && !x.name.endsWith("_end") && pred(x));
  if (!a) throw new Error(`no ${kind} in ${pack}`);
  return { a, p };
};

const w = Number(values.w), h = Number(values.h);
const b = new DDMapBuilder({ width: w, height: h });
const wall = find("2MT Medieval Building Map Assets", "wall");
const floor = find("2MT Medieval Building Map Assets", "pattern");
const door = find("2MT Medieval Building Map Assets", "portal");
const table = find("2MT Typical Tavern", "object", (a) => a.types[0] === "table");
const chair = find("2MT Castle Furniture", "object", (a) => a.types[0] === "chair");
for (const x of [wall, floor, door, table, chair]) b.usePack(x.p.manifest);

const room: [number, number][] = [[2, 2], [w - 2, 2], [w - 2, h - 2], [2, h - 2]].map(([x, y]) => [x! * S, y! * S]);
b.addPattern({ points: room, texture: floor.a.res });
b.addWall({ points: room, loop: true, texture: wall.a.res, doors: [{ at: [(w / 2) * S, (h - 2) * S], texture: door.a.res }] });
const cx = (w / 2) * S, cy = (h / 2) * S;
b.addObject({ at: [cx, cy], texture: table.a.res });
b.addObject({ at: [cx, cy - 1.2 * S], texture: chair.a.res });
b.addObject({ at: [cx, cy + 1.2 * S], texture: chair.a.res, rotation: Math.PI });
b.addLight({ at: [cx, cy], range: 6 });
const out = resolve(values.out!);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, b.serialize());
console.log(out, { wall: wall.a.name, floor: floor.a.name, door: door.a.name, table: table.a.name, chair: chair.a.name, warnings: b.warnings });
