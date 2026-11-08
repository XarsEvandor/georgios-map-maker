/** Finds Dungeondraft packs under an asset root and reads their metadata and tags. */

import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { familyOf, type Family } from "@gmm/core";
import { mapLimit } from "../util/pool";
import { PckReader, readPckIndex, type PckEntry, type PckIndex } from "./pck";

export interface DiscoveredPack {
  file: string;
  folder: string;
  id: string;
  name: string;
  version?: string;
  author?: string;
  family: Family;
  index: PckIndex;
  /** Path inside the pack (e.g. "textures/objects/Bed 1.webp") -> raw tag names. */
  tagsByPath: Map<string, string[]>;
  /** Other files with the same pack ID that were skipped. */
  duplicates: string[];
  /** Raw pack metadata (pack.json), copied into a map's asset_manifest. */
  meta: Record<string, unknown>;
  /** False when the pack sets allow_3rd_party_mapping_software_to_read to false. Its images are then never read. */
  readAllowed: boolean;
}

export async function findPackFiles(root: string): Promise<string[]> {
  const all = await readdir(root, { recursive: true, withFileTypes: true });
  return all
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".dungeondraft_pack"))
    .map((d) => join(d.parentPath, d.name))
    .sort((a, b) => a.localeCompare(b));
}

/** Godot writes JSON with trailing commas; strip them before parsing. */
export function parseLenientJson(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, "").replace(/,(\s*[}\]])/g, "$1"));
}

function compareVersions(a = "0", b = "0"): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function readPack(file: string): Promise<DiscoveredPack> {
  const index = await readPckIndex(file);
  const reader = await PckReader.open(file);
  try {
    let meta: Record<string, unknown> = {};
    let tagsEntry: PckEntry | undefined;
    for (const e of index.entries) {
      // Pack metadata sits at res://packs/<id>.json (one level below "packs").
      if (/^res:\/\/packs\/[^/]+\.json$/i.test(e.path)) {
        meta = parseLenientJson((await reader.read(e)).toString("utf8")) as Record<string, unknown>;
      } else if (e.path.toLowerCase().endsWith(".dungeondraft_tags")) {
        tagsEntry = e;
      }
    }
    const id = typeof meta.id === "string" ? meta.id : basename(file);
    const name = typeof meta.name === "string" ? meta.name : basename(file, ".dungeondraft_pack");
    const tagsByPath = new Map<string, string[]>();
    if (tagsEntry) {
      const parsed = parseLenientJson((await reader.read(tagsEntry)).toString("utf8")) as {
        tags?: Record<string, string[]>;
      };
      for (const [tag, paths] of Object.entries(parsed.tags ?? {})) {
        for (const p of paths) {
          const list = tagsByPath.get(p) ?? [];
          list.push(tag);
          tagsByPath.set(p, list);
        }
      }
    }
    return {
      file,
      folder: basename(dirname(file)),
      id,
      name,
      version: typeof meta.version === "string" ? meta.version : undefined,
      author: typeof meta.author === "string" ? meta.author : undefined,
      family: familyOf(name),
      index,
      tagsByPath,
      duplicates: [],
      meta,
      readAllowed: meta.allow_3rd_party_mapping_software_to_read !== false,
    };
  } finally {
    await reader.close();
  }
}

/**
 * Reads every pack under root and keeps one copy per pack ID: the highest version,
 * then the first by path.
 */
export async function discoverPacks(root: string): Promise<DiscoveredPack[]> {
  const files = await findPackFiles(root);
  const packs = await mapLimit(files, 16, readPack);
  const byId = new Map<string, DiscoveredPack>();
  for (const p of packs) {
    const kept = byId.get(p.id);
    if (!kept) {
      byId.set(p.id, p);
    } else if (compareVersions(p.version, kept.version) > 0) {
      p.duplicates.push(kept.file, ...kept.duplicates);
      byId.set(p.id, p);
    } else {
      kept.duplicates.push(p.file);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Path inside the pack, relative to res://packs/<id>/, such as "textures/objects/Bed 1.webp". */
export function packRelative(path: string, packId: string): string | undefined {
  const prefix = `res://packs/${packId}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}
