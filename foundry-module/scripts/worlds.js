/**
 * World bundles (Data/georgios-map-maker/worlds/<id>/bundle.json + map.webp), made by the
 * companion's world-build: import one into this world as a scene with pins and a journal folder.
 * Everything made is flagged with the bundle id, so importing again replaces it cleanly and
 * moving a world to another Foundry world is: copy the folder, press Import there.
 */

const MODULE_ID = "georgios-map-maker";
const ROOT = "georgios-map-maker/worlds";

/** The bundles in Data/georgios-map-maker/worlds. */
export async function listWorlds() {
  try {
    const res = await foundry.applications.apps.FilePicker.implementation.browse("data", ROOT);
    const out = [];
    for (const dir of res.dirs) {
      try {
        const b = await fetch(`${dir}/bundle.json`, { cache: "no-store" }).then((r) => r.json());
        if (b?.format === "gmm-world") out.push({ id: b.id, title: b.title, path: dir });
      } catch {
        /* not a bundle */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Removes what an earlier import of this bundle made, except its world map scene (cities link to it by id). */
async function removeImport(id) {
  const scenes = game.scenes.filter((s) => s.getFlag(MODULE_ID, "world") === id && !s.getFlag(MODULE_ID, "worldMap")).map((s) => s.id);
  if (scenes.length) await Scene.deleteDocuments(scenes);
  const journals = game.journal.filter((j) => j.getFlag(MODULE_ID, "world") === id).map((j) => j.id);
  if (journals.length) await JournalEntry.deleteDocuments(journals);
  const folders = game.folders.filter((f) => f.getFlag(MODULE_ID, "world") === id);
  // Children before parents.
  folders.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
  // The scene folder stays with the scene.
  for (const f of folders) if (f.type !== "Scene") await f.delete();
}

/** Imports a bundle: a journal folder tree, a scene with the map, a pin per place. Returns the scene. */
export async function importWorld(path, { activate = true } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM can import a world.");
  const b = await fetch(`${path}/bundle.json`, { cache: "no-store" }).then((r) => r.json());
  if (b?.format !== "gmm-world") throw new Error("not a world bundle");
  ui.notifications.info(`Map Maker: importing ${b.title}...`);
  await removeImport(b.id);
  const flags = { [MODULE_ID]: { world: b.id } };
  const root = await Folder.create({ name: b.title, type: "JournalEntry", flags });
  const folders = { "": root.id };
  for (const name of b.folders) folders[name] = (await Folder.create({ name, type: "JournalEntry", folder: root.id, flags })).id;
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const made = [];
  for (let i = 0; i < b.journals.length; i += 100) {
    const chunk = b.journals.slice(i, i + 100).map((j) => ({
      name: j.name, folder: folders[j.folder] ?? root.id, ownership: { default: OBS },
      pages: j.pages.map((p) => ({ name: p.name, type: "text", text: { content: p.html, format: 1 } })),
      flags: { [MODULE_ID]: { world: b.id, key: j.key } },
    }));
    made.push(...(await JournalEntry.createDocuments(chunk)));
  }
  const byKey = new Map(made.map((j) => [j.getFlag(MODULE_ID, "key"), j]));
  const src = `${path}/${b.image.file}`;
  const sceneFolder = game.folders.find((f) => f.type === "Scene" && f.getFlag(MODULE_ID, "world") === b.id) ?? (await Folder.create({ name: b.title, type: "Scene", flags }));
  // A cache-busting query, so a re-render shows at once.
  const data = {
    name: b.title, folder: sceneFolder.id, width: b.image.width, height: b.image.height, padding: 0, background: { src: `${src}?v=${b.image.v ?? Date.now()}` },
    grid: { type: 1, size: b.grid.size, distance: b.grid.distance, units: b.grid.units, alpha: 0 }, tokenVision: false, environment: { darknessLevel: 0 },
    flags: { [MODULE_ID]: { world: b.id, worldMap: true, imageV: b.image.v ?? null } },
  };
  // Re-imports update the world map in place: cities opened from it keep their way back.
  let scene = game.scenes.find((s) => s.getFlag(MODULE_ID, "world") === b.id && s.getFlag(MODULE_ID, "worldMap"));
  if (scene) {
    const old = scene.notes.map((n) => n.id);
    if (old.length) await scene.deleteEmbeddedDocuments("Note", old);
    await scene.update(data);
  } else scene = await Scene.create(data);
  if (scene.levels) {
    const level = scene.levels.get(scene._source.initialLevel) ?? scene.levels.contents[0];
    if (level) await level.update({ "background.src": data.background.src });
  }
  const notes = b.pins.map((p) => {
    const j = byKey.get(p.journal);
    return {
      x: p.x, y: p.y, text: p.label, entryId: j?.id, pageId: j?.pages.contents[0]?.id, global: true, iconSize: p.size, fontSize: p.global ? 30 : 22,
      textColor: "#f4ead2", texture: { src: p.icon, tint: "#f4ead2" }, flags: { [MODULE_ID]: { world: b.id, key: p.key } },
    };
  });
  for (let i = 0; i < notes.length; i += 200) await scene.createEmbeddedDocuments("Note", notes.slice(i, i + 200));
  if (activate) await scene.activate();
  await scene.view();
  ui.notifications.info(`Map Maker: ${b.title} imported (${made.length} journals, ${notes.length} pins).`);
  return scene;
}

/**
 * A world map redrawn by the companion (the bundle's picture has a new fingerprint) shows the new
 * picture: only the scene's background changes; pins, journals and drawings stay. Run by the GM on
 * load. Returns the names of the scenes refreshed.
 */
export async function refreshWorldMaps() {
  if (!game.user.isGM) return [];
  const done = [];
  for (const scene of game.scenes.filter((s) => s.getFlag(MODULE_ID, "worldMap") && s.getFlag(MODULE_ID, "world"))) {
    const id = scene.getFlag(MODULE_ID, "world");
    let b;
    try {
      b = await fetch(`${ROOT}/${id}/bundle.json`, { cache: "no-store" }).then((r) => r.json());
    } catch {
      continue; // No bundle here (moved or deleted): leave the scene alone.
    }
    const v = b?.image?.v;
    if (!v || scene.getFlag(MODULE_ID, "imageV") === v) continue;
    const src = `${ROOT}/${id}/${b.image.file}?v=${v}`;
    await scene.update({ "background.src": src, [`flags.${MODULE_ID}.imageV`]: v });
    if (scene.levels) {
      const level = scene.levels.get(scene._source.initialLevel) ?? scene.levels.contents[0];
      if (level) await level.update({ "background.src": src });
    }
    done.push(scene.name);
  }
  if (done.length) ui.notifications.info(`Map Maker: the world map was redrawn (${done.join(", ")}).`);
  return done;
}

/** A dialog listing the bundles, with an Import button for each. */
export async function importDialog() {
  const worlds = await listWorlds();
  const DialogV2 = foundry.applications.api.DialogV2;
  if (!worlds.length) return DialogV2.prompt({ window: { title: "Georgios' Map Maker" }, content: `<p>No world bundles found in <code>Data/${ROOT}</code>. Build one with the companion's world-build command.</p>` });
  const buttons = worlds.map((w) => ({ action: w.id, label: w.title, callback: () => w }));
  const picked = await DialogV2.wait({ window: { title: "Import a world" }, content: "<p>Pick a world to import into this Foundry world. Importing again replaces the earlier import.</p>", buttons, rejectClose: false });
  const w = worlds.find((x) => x.id === picked?.id || x.id === picked);
  if (w) return importWorld(w.path);
}
