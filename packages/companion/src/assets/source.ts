/** Reads asset image bytes back out of their packs, by index id or res:// path. */

import type { AssetIndex, AssetRecord } from "@gmm/core";
import { PckReader, readPckIndex, type PckEntry } from "./pck";

export class AssetSource {
  private readonly byId = new Map<string, AssetRecord>();
  private readonly byRes = new Map<string, AssetRecord>();
  private readonly packFile = new Map<string, string>();
  private readonly entries = new Map<string, Promise<Map<string, PckEntry>>>();
  private readonly readers = new Map<string, Promise<PckReader>>();

  constructor(readonly index: AssetIndex) {
    for (const a of index.assets) {
      this.byId.set(a.id, a);
      this.byRes.set(a.res, a);
    }
    for (const p of index.packs) this.packFile.set(p.id, p.file);
  }

  asset(id: string): AssetRecord | undefined {
    return this.byId.get(id);
  }

  assetByRes(res: string): AssetRecord | undefined {
    return this.byRes.get(res);
  }

  private entryMap(packId: string): Promise<Map<string, PckEntry>> {
    let m = this.entries.get(packId);
    if (!m) {
      const file = this.packFile.get(packId);
      if (!file) throw new Error(`unknown pack ${packId}`);
      m = readPckIndex(file).then((ix) => new Map(ix.entries.map((e) => [e.path, e])));
      this.entries.set(packId, m);
    }
    return m;
  }

  private reader(packId: string): Promise<PckReader> {
    let r = this.readers.get(packId);
    if (!r) {
      r = PckReader.open(this.packFile.get(packId)!);
      this.readers.set(packId, r);
    }
    return r;
  }

  /** Image bytes for an asset id or res:// path. */
  async bytes(idOrRes: string): Promise<Buffer> {
    const a = this.byId.get(idOrRes) ?? this.byRes.get(idOrRes);
    if (!a) throw new Error(`unknown asset ${idOrRes}`);
    const entry = (await this.entryMap(a.pack)).get(a.res);
    if (!entry) throw new Error(`asset ${a.id} missing from its pack`);
    return (await this.reader(a.pack)).read(entry);
  }

  async close(): Promise<void> {
    for (const r of this.readers.values()) await (await r).close();
    this.readers.clear();
  }
}
