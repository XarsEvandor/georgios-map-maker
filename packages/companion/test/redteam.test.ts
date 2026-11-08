/** Hostile files: the pack reader and renderer must refuse them quickly. */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testIndex } from "../../core/test/fixtures";
import { readPckIndex } from "../src/assets/pck";
import { AssetSource } from "../src/assets/source";
import { renderMap } from "../src/render/render";

function header(count: number): Buffer {
  const b = Buffer.alloc(4 + 4 + 12 + 64 + 4);
  b.writeUInt32LE(0x43504447, 0); // GDPC
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(count, 4 + 4 + 12 + 64);
  return b;
}

describe("PCK reader against hostile packs", () => {
  it("reads a well-formed tiny pack", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pck-"));
    const path = Buffer.from("res://packs/X/a.json\0\0\0\0");
    const entry = Buffer.alloc(4 + path.length + 16 + 16);
    entry.writeUInt32LE(path.length, 0);
    path.copy(entry, 4);
    entry.writeBigUInt64LE(200n, 4 + path.length);
    entry.writeBigUInt64LE(2n, 4 + path.length + 8);
    const f = join(dir, "ok.dungeondraft_pack");
    await writeFile(f, Buffer.concat([header(1), entry, Buffer.alloc(120)]));
    const ix = await readPckIndex(f);
    expect(ix.entries).toEqual([{ path: "res://packs/X/a.json", offset: 200, size: 2 }]);
  });

  it("refuses absurd path lengths and file counts without allocating them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pck-"));
    const huge = Buffer.alloc(4);
    huge.writeUInt32LE(0xfffffff0, 0);
    await writeFile(join(dir, "a.dungeondraft_pack"), Buffer.concat([header(1), huge]));
    await expect(readPckIndex(join(dir, "a.dungeondraft_pack"))).rejects.toThrow(/path length/);
    await writeFile(join(dir, "b.dungeondraft_pack"), header(4_000_000_000));
    await expect(readPckIndex(join(dir, "b.dungeondraft_pack"))).rejects.toThrow(/file count/);
    await writeFile(join(dir, "c.dungeondraft_pack"), Buffer.from("PK\u0003\u0004 not a pck"));
    await expect(readPckIndex(join(dir, "c.dungeondraft_pack"))).rejects.toThrow(/not a Godot PCK/);
    await writeFile(join(dir, "d.dungeondraft_pack"), header(5));
    await expect(readPckIndex(join(dir, "d.dungeondraft_pack"))).rejects.toThrow(/unexpected end/);
  });
});

describe("renderer against hostile maps", () => {
  const src = new AssetSource(testIndex());
  const base = (w: number, h: number, objects: unknown[] = []) => ({ world: { width: w, height: h, levels: { "0": { objects, walls: [], patterns: [], paths: [], lights: [], terrain: {} } } } });

  it("refuses absurd sizes and element counts", async () => {
    await expect(renderMap(base(100000, 100000), src, { pps: 64 })).rejects.toThrow(/too large/);
    await expect(renderMap(base(-5, 10), src, { pps: 64 })).rejects.toThrow(/too large/);
    const many = Array.from({ length: 25_000 }, (_, i) => ({ position: "Vector2( 0, 0 )", texture: "res://x", layer: 100, node_id: i.toString(16) }));
    await expect(renderMap(base(10, 10, many), src, { pps: 16 })).rejects.toThrow(/too many/);
  });

  it("escapes label text in the SVG overlay", async () => {
    const png = await renderMap(base(4, 4), src, { pps: 16, labels: [{ x: 1, y: 1, text: `</text><script>alert(1)</script>` }] });
    expect(png.length).toBeGreaterThan(100);
  });
});
