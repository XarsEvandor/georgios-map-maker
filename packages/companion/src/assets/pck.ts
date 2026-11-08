/**
 * Reader for Godot PCK archives, the format of .dungeondraft_pack files.
 * Supports pack format 1 (Godot 3, used by Dungeondraft 1.x) and format 2 (Godot 4 layout).
 */

import { open, type FileHandle } from "node:fs/promises";

export interface PckEntry {
  /** Path inside the archive, such as "res://packs/5v983XvZ/textures/objects/Bed 1.webp". */
  path: string;
  /** Absolute byte offset of the file data. */
  offset: number;
  size: number;
}

export interface PckIndex {
  format: number;
  godot: string;
  entries: PckEntry[];
}

const MAGIC = 0x43504447; // "GDPC"

class Cursor {
  private buf = Buffer.alloc(0);
  private start = 0; // file position of buf[0]
  pos = 0; // absolute file position

  constructor(private readonly fh: FileHandle) {}

  private async ensure(n: number): Promise<void> {
    const have = this.start + this.buf.length - this.pos;
    if (have >= n) return;
    const want = Math.max(n, 1 << 20);
    const next = Buffer.alloc(want);
    const { bytesRead } = await this.fh.read(next, 0, want, this.pos);
    if (bytesRead < n) throw new Error(`unexpected end of PCK file at byte ${this.pos}`);
    this.buf = next.subarray(0, bytesRead);
    this.start = this.pos;
  }

  async bytes(n: number): Promise<Buffer> {
    await this.ensure(n);
    const at = this.pos - this.start;
    this.pos += n;
    return this.buf.subarray(at, at + n);
  }

  async u32(): Promise<number> {
    return (await this.bytes(4)).readUInt32LE(0);
  }

  async u64(): Promise<number> {
    const v = (await this.bytes(8)).readBigUInt64LE(0);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PCK offset too large");
    return Number(v);
  }
}

export async function readPckIndex(file: string): Promise<PckIndex> {
  const fh = await open(file, "r");
  try {
    const c = new Cursor(fh);
    if ((await c.u32()) !== MAGIC) throw new Error(`${file} is not a Godot PCK file`);
    const format = await c.u32();
    const godot = `${await c.u32()}.${await c.u32()}.${await c.u32()}`;
    let fileBase = 0;
    if (format >= 2) {
      await c.u32(); // pack flags
      fileBase = await c.u64();
    }
    await c.bytes(16 * 4); // reserved
    const count = await c.u32();
    // Sanity limits: a real Dungeondraft pack has at most a few thousand files with short paths.
    if (count > 500_000) throw new Error(`${file}: implausible file count ${count}`);
    const entries: PckEntry[] = [];
    for (let i = 0; i < count; i++) {
      const len = await c.u32();
      if (len > 4096) throw new Error(`${file}: implausible path length ${len}`);
      const raw = await c.bytes(len);
      const end = raw.indexOf(0);
      const path = raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
      const offset = (await c.u64()) + fileBase;
      const size = await c.u64();
      await c.bytes(16); // md5
      if (format >= 2) await c.u32(); // per-file flags
      entries.push({ path, offset, size });
    }
    return { format, godot, entries };
  } finally {
    await fh.close();
  }
}

/** Opens a pack once and reads many files from it. Call close() when done. */
export class PckReader {
  private constructor(private readonly fh: FileHandle) {}

  static async open(file: string): Promise<PckReader> {
    return new PckReader(await open(file, "r"));
  }

  async read(entry: PckEntry): Promise<Buffer> {
    if (entry.size > 512 * 1024 * 1024) throw new Error(`${entry.path}: file too large to read (${entry.size} bytes)`);
    const buf = Buffer.alloc(entry.size);
    const { bytesRead } = await this.fh.read(buf, 0, entry.size, entry.offset);
    if (bytesRead !== entry.size) throw new Error(`short read for ${entry.path}`);
    return buf;
  }

  async close(): Promise<void> {
    await this.fh.close();
  }
}
