/** Dungeondraft bridge: open maps in Dungeondraft, watch for saves, enable packs (DESIGN.md section 10). */

import { execFile, spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_DD_EXE = "C:\\Program Files\\Dungeondraft\\Dungeondraft.exe";

/** Launches Dungeondraft with a map file (Dungeondraft 1.2.0.1 opens a path given on its command line). */
export function openInDungeondraft(file: string, exe = DEFAULT_DD_EXE): void {
  if (!/\.dungeondraft_map$/i.test(file)) throw new Error("only .dungeondraft_map files can be opened");
  const p = spawn(exe, [file], { detached: true, stdio: "ignore", shell: false, windowsHide: false });
  p.unref();
}

export function dungeondraftRunning(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq Dungeondraft.exe", "/NH"], { windowsHide: true }, (err, out) => resolve(!err && /Dungeondraft\.exe/i.test(out)));
  });
}

/**
 * Watches a map file and calls onSave with the parsed JSON after Dungeondraft writes it.
 * Debounced; partial writes are retried.
 */
export function watchMapFile(file: string, onSave: (map: Record<string, unknown>) => void | Promise<void>, ignoreUntil?: () => number): FSWatcher {
  let timer: NodeJS.Timeout | undefined;
  let last = "";
  const fire = async (attempt = 0) => {
    try {
      const text = await readFile(file, "utf8");
      if (text === last) return;
      const map = JSON.parse(text);
      last = text;
      if (ignoreUntil && Date.now() < ignoreUntil()) return;
      await onSave(map);
    } catch {
      if (attempt < 5) setTimeout(() => void fire(attempt + 1), 400);
    }
  };
  void readFile(file, "utf8").then((t) => (last = t)).catch(() => {});
  return watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void fire(), 800);
  });
}

/**
 * Adds pack ids to Dungeondraft's active asset packs (config.ini). Only call this when the
 * DM asked for it, and only while Dungeondraft is closed (it rewrites the file on exit).
 */
export async function enablePacksInDungeondraft(packIds: string[], appData = process.env.APPDATA ?? ""): Promise<{ added: string[] }> {
  if (await dungeondraftRunning()) throw new Error("close Dungeondraft first; it overwrites its settings when it exits");
  const file = join(appData, "Dungeondraft", "config.ini");
  const text = await readFile(file, "utf8");
  const m = /^active_asset_packs=\[(.*)\]\s*$/m.exec(text);
  const current = m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
  const valid = packIds.filter((id) => /^[A-Za-z0-9_-]{1,32}$/.test(id));
  const added = valid.filter((id) => !current.includes(id));
  if (!added.length) return { added };
  const line = `active_asset_packs=[ ${[...current, ...added].map((id) => `"${id}"`).join(", ")} ]`;
  const next = m ? text.replace(m[0], line) : text.replace(/\[Assets\]\s*\n/, `[Assets]\n\n${line}\n`);
  await writeFile(`${file}.gmm-backup`, text);
  await writeFile(file, next);
  return { added };
}
