/**
 * Georgios' Map Maker: Foundry VTT v13 module.
 * Opens a panel (GM only) to chat with Claude, pick a version, and build the scene.
 */

import { CompanionClient, MODULE_ID, esc, latestMap, leafFileName, miniMarkdown, renderFileName, sceneData, withLeafTextures } from "./lib.js";
import { importDialog, importWorld, listWorlds } from "./worlds.js";
import { attachStats, PEOPLE_LOOK, populate, ringUp, statsPossible } from "./people.js";
import { registerAreaTool } from "./area-tool.js";
import { backgroundOf, registerClock, ROOFS_LOOK, syncScenes } from "./clock.js";
import { offerStart, openCompanions } from "./launcher.js";

const t = (key) => game.i18n.localize(`GMM.${key}`);

/** fetch, plus an offer to start the companion when it does not answer at all. */
async function companionFetch(...args) {
  try {
    return await fetch(...args);
  } catch (e) {
    if (e instanceof TypeError) offerStart("maps", "Georgios' Map Maker companion");
    throw e;
  }
}

function client() {
  const url = game.settings.get(MODULE_ID, "companionUrl");
  const token = game.settings.get(MODULE_ID, "token");
  if (!token) throw new Error(t("NoToken"));
  return new CompanionClient(url, token, companionFetch);
}

async function upload(blob, name, type = "image/webp") {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const dir = `${MODULE_ID}`;
  try { await FP.createDirectory("data", dir); } catch { /* exists */ }
  const file = new File([blob], name, { type });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) throw new Error("upload to Foundry failed");
  return res.path;
}

/**
 * Foundry 14 keeps the background on the scene's Level documents (scene levels); v13 on the
 * scene itself. Sets it on the initial level when the scene has levels.
 */
async function setBackground(scene, src) {
  if (!scene.levels) return;
  const level = scene.levels.get(scene._source.initialLevel) ?? scene.levels.contents[0];
  if (level) await level.update({ "background.src": src });
  else await scene.createEmbeddedDocuments("Level", [{ name: "Ground", background: { src } }]);
}

/** Creates or updates the scene for a map version, with walls, doors and lights. */
async function buildScene(c, mapId, versionId, opts = {}) {
  const pps = opts.pps ?? game.settings.get(MODULE_ID, "pps");
  const exported = await c.rpc("maps.export", { mapId, version: versionId, pps });
  const blob = await c.image(exported.imagePath);
  const src = await upload(blob, renderFileName(mapId, versionId));
  // Gate leaves: Foundry draws them on the door and swings them open.
  const leaves = {};
  for (const l of exported.leaves ?? []) {
    try {
      leaves[l.portal] = await upload(await c.image(l.path), leafFileName(mapId, versionId, l.portal), "image/png");
    } catch (e) {
      console.warn(`${MODULE_ID} | gate leaf ${l.portal} not uploaded`, e);
    }
  }
  const data = sceneData(exported, src, mapId, versionId);
  data.flags[MODULE_ID].lamps = LAMPS_LOOK;
  // The clock's weather falls on maps that keep it out of their buildings (an older companion sends none).
  if (Array.isArray(exported.scene.sheltered)) data.flags[MODULE_ID].roofs = ROOFS_LOOK;
  if (opts.folder) data.folder = opts.folder;
  let scene = game.scenes.find((s) => s.getFlag(MODULE_ID, "mapId") === mapId);
  if (scene) {
    await scene.update(data);
    await scene.deleteEmbeddedDocuments("Wall", scene.walls.map((w) => w.id));
    await scene.deleteEmbeddedDocuments("AmbientLight", scene.lights.map((l) => l.id));
  } else {
    scene = await Scene.create(data);
  }
  await setBackground(scene, src);
  await scene.createEmbeddedDocuments("Wall", withLeafTextures(exported.scene.walls, leaves));
  await scene.createEmbeddedDocuments("AmbientLight", exported.scene.lights);
  await setShelter(scene, exported.scene.sheltered);
  // The export carries the map's own darkness; the clock sets every scene's.
  await syncScenes();
  if (canvas?.scene?.id === scene.id) dropStrayRegionHighlights();
  if (!opts.quiet) ui.notifications.info(`${t("SceneBuilt")}: ${scene.name}`);
  return scene;
}

/**
 * One hidden region over the map's roofed buildings (or all but an enclosed map's approach) with
 * Foundry's Suppress Weather behaviour: the clock's rain and snow fall in the streets, not indoors.
 * Replaces the module's earlier one.
 */
async function setShelter(scene, sheltered) {
  if (!Array.isArray(sheltered)) return;
  const old = scene.regions?.filter((r) => r.getFlag(MODULE_ID, "sheltered")).map((r) => r.id) ?? [];
  if (old.length) await scene.deleteEmbeddedDocuments("Region", old);
  const shapes = sheltered.filter((s) => s.points?.length >= 6).map((s) => ({ type: "polygon", points: s.points, hole: !!s.hole }));
  if (!shapes.length) return;
  await scene.createEmbeddedDocuments("Region", [{
    name: t("Indoors"), color: "#5b6b82", shapes,
    behaviors: [{ type: "suppressWeather", name: t("NoWeatherIndoors") }],
    flags: { [MODULE_ID]: { sheltered: true } },
  }]);
  if (canvas?.scene?.id === scene.id) setTimeout(dropStrayRegionHighlights, 50);
}

/**
 * Foundry 14 leaves a stray highlight behind when a scene is rebuilt with its region replaced: a
 * grey copy of the "Indoors" region over every building, for the GM, until the page reloads. The
 * highlights of regions no longer on the layer go.
 */
function dropStrayRegionHighlights() {
  const highlights = canvas?.regions?._highlights;
  if (!highlights?.children) return;
  const live = new Set(canvas.regions.placeables);
  for (const m of [...highlights.children]) if (m.region && !live.has(m.region)) m.destroy({ children: true });
}
Hooks.on("canvasReady", () => setTimeout(dropStrayRegionHighlights, 0));

/** Maps built before the weather: their roofs (setShelter) from the companion, without building them again. */
async function ensureRoofs(scene, c = client()) {
  const exported = await c.rpc("maps.export", { mapId: scene.getFlag(MODULE_ID, "mapId"), version: scene.getFlag(MODULE_ID, "version"), pps: scene.grid.size });
  if (!Array.isArray(exported.scene?.sheltered)) throw new Error("the companion is older than the module: restart it");
  await setShelter(scene, exported.scene.sheltered);
  await scene.setFlag(MODULE_ID, "roofs", ROOFS_LOOK);
}

// ---------------------------------------------------------------------------------------
// Cities: world map pin -> city scene -> battle maps of its hot spots, built in the background.

const CITY_ICONS = { market: "icons/svg/coins.svg", keep: "icons/svg/castle.svg", temple: "icons/svg/temple.svg", tavern: "icons/svg/tankard.svg", inn: "icons/svg/tankard.svg", gate: "icons/svg/tower.svg", docks: "icons/svg/anchor.svg", wizard: "icons/svg/book.svg", lighthouse: "icons/svg/sun.svg", area: "icons/svg/house.svg" };
const STREET_PPS = 70;
const building = new Set();

async function folderFor(name) {
  return game.folders.find((f) => f.type === "Scene" && f.name === name) ?? Folder.create({ name, type: "Scene" });
}

/** The city's journal: one page per place, so players can see the pins and read about them. */
async function cityJournal(info) {
  let j = game.journal.find((e) => e.getFlag(MODULE_ID, "city") === info.key);
  if (!j) j = await JournalEntry.create({ name: `${info.name}: places`, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }, flags: { [MODULE_ID]: { city: info.key } } });
  return j;
}

async function pageFor(journal, id, name, text, secret = false) {
  let page = journal.pages.find((p) => p.getFlag(MODULE_ID, "place") === id);
  // Secret places (a thieves' den, a fence): the page is closed to players, which hides the pin from them.
  const ownership = secret ? { ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } } : {};
  if (!page) [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name, type: "text", text: { content: `<p>${esc(text)}</p>` }, ...ownership, flags: { [MODULE_ID]: { place: id, secret } } }]);
  return page;
}

/** A place's pin on the city scene (shops carry their trade's icon). */
function pinFor(h, cityKey, journal, page) {
  return {
    x: h.x, y: h.y, entryId: journal?.id, pageId: page?.id, text: h.label,
    texture: { src: h.icon ?? CITY_ICONS[h.kind] ?? CITY_ICONS.area, tint: "#888888" },
    iconSize: h.onDemand ? 44 : 56, fontSize: h.onDemand ? 26 : 32, global: true,
    flags: { [MODULE_ID]: { place: h.id, city: cityKey, onDemand: !!h.onDemand, street: !!h.street } },
  };
}

/**
 * Bumped when cities gain new kinds of places; older city scenes get the missing pins when the GM
 * opens them. 2: shops. 3: services, the underworld, the law, mansions, the garrison, stables
 * (mansions and the garrison have their own art, so the city is drawn again too).
 */
const PINS_LOOK = 3;

/** Adds the pins a city scene is missing (places added since it was opened), leaving the others as they are. */
async function addNewPins(scene) {
  const cityKey = scene.getFlag(MODULE_ID, "city");
  const c = client();
  const cityName = scene.getFlag(MODULE_ID, "cityName") ?? scene.name;
  let hotspots;
  if ((scene.getFlag(MODULE_ID, "pins") ?? 1) < 3) {
    // Mansions and the garrison change the city's art: draw it again (pins keep their places).
    ui.notifications.info(`Map Maker: drawing ${cityName} again with its mansions and garrison, about half a minute...`);
    const info = await c.rpc("city.refresh", { city: cityKey });
    const src = await upload(await c.image(info.imagePath), `city-${info.key}-${Date.now()}.webp`);
    await scene.update({ "background.src": src });
    await setBackground(scene, src);
    hotspots = info.hotspots;
  } else ({ hotspots } = await c.rpc("city.places", { city: cityKey }));
  const have = new Set(scene.notes.map((n) => n.getFlag(MODULE_ID, "place")).filter(Boolean));
  const fresh = hotspots.filter((h) => !have.has(h.id));
  if (fresh.length) {
    const journal = game.journal.find((e) => e.getFlag(MODULE_ID, "city") === cityKey);
    const notes = [];
    for (const h of fresh) notes.push(pinFor(h, cityKey, journal, journal ? await pageFor(journal, h.id, h.label, `${h.label} in ${cityName}.`, !!h.secret) : undefined));
    await scene.createEmbeddedDocuments("Note", notes);
    const secret = fresh.filter((h) => h.secret).length;
    ui.notifications.info(`Map Maker: ${fresh.length} places added to ${cityName}${secret ? ` (${secret} secret, shown only to you)` : ""}. Double-click a pin to build its map.`);
  }
  await scene.setFlag(MODULE_ID, "pins", PINS_LOOK);
}

/** Bumped when the city's night image changes; city scenes get theirs again on the GM's next look. */
const NIGHT_LOOK = 1;
const nighting = new Set();

/** True when a city scene has no night image yet, or its day image changed since (the city was drawn again). */
function nightDue(scene) {
  const shown = backgroundOf(scene);
  const night = scene.getFlag(MODULE_ID, "nightSrc");
  return scene.getFlag(MODULE_ID, "night") !== NIGHT_LOOK || !night || (shown !== night && shown !== scene.getFlag(MODULE_ID, "daySrc"));
}

/**
 * Gives a city scene its night image: the city from above at night, its windows, street lamps,
 * squares, towers and gates alight (companion city.night). The clock shows it from nightfall to
 * first light and the day image the rest of the time.
 */
async function ensureNight(scene) {
  if (nighting.has(scene.id)) return;
  nighting.add(scene.id);
  try {
    const key = scene.getFlag(MODULE_ID, "city");
    const shown = backgroundOf(scene);
    // The day image is what the scene shows, unless it is showing the night one.
    const daySrc = shown && shown !== scene.getFlag(MODULE_ID, "nightSrc") ? shown : scene.getFlag(MODULE_ID, "daySrc");
    if (!key || !daySrc) return;
    const c = client();
    const info = await c.rpc("city.night", { city: key });
    const nightSrc = await upload(await c.image(info.imagePath), `city-${key}-night-${Date.now()}.webp`);
    await scene.update({ [`flags.${MODULE_ID}.daySrc`]: daySrc, [`flags.${MODULE_ID}.nightSrc`]: nightSrc, [`flags.${MODULE_ID}.night`]: NIGHT_LOOK });
    await syncScenes();
  } finally {
    nighting.delete(scene.id);
  }
}

/** Opens a city from its watabou city-generator link: city scene for everyone, then the hot spots build. */
async function openCity(url, name) {
  if (!game.user.isGM) return ui.notifications.warn(t("GMOnly"));
  // The scene the GM is on (the world map) becomes the city's way back, unless it is itself a city or a place.
  const from = canvas.scene && !canvas.scene.getFlag(MODULE_ID, "city") ? canvas.scene.id : undefined;
  const fromWorld = from ? canvas.scene.getFlag(MODULE_ID, "world") : undefined;
  const c = client();
  ui.notifications.info(`Map Maker: opening ${name ?? "the city"}...`);
  const info = await c.rpc("city.open", { url, name });
  const src = await upload(await c.image(info.imagePath), `city-${info.key}-${Date.now()}.webp`);
  const folder = await folderFor(`${info.name}`);
  const data = {
    name: `${info.name} (city)`, folder: folder.id, width: info.width, height: info.height, padding: 0,
    background: { src }, grid: { type: 1, size: info.gridPx, distance: info.gridFt, units: "ft" },
    tokenVision: false, environment: { darknessLevel: 0 }, flags: { [MODULE_ID]: { city: info.key, cityName: info.name } },
  };
  let scene = game.scenes.find((s) => s.getFlag(MODULE_ID, "city") === info.key && !s.getFlag(MODULE_ID, "mapId"));
  const world = from ?? scene?.getFlag(MODULE_ID, "worldScene");
  if (world) data.flags[MODULE_ID].worldScene = world;
  // The world bundle too, so the way back survives the world map being imported again elsewhere.
  const worldOf = fromWorld ?? scene?.getFlag(MODULE_ID, "worldOf");
  if (worldOf) data.flags[MODULE_ID].worldOf = worldOf;
  if (scene) await scene.update(data);
  else scene = await Scene.create(data);
  await setBackground(scene, src);
  const journal = await cityJournal(info);
  const old = scene.notes.filter((n) => n.getFlag(MODULE_ID, "place")).map((n) => n.id);
  if (old.length) await scene.deleteEmbeddedDocuments("Note", old);
  const notes = [];
  for (const h of info.hotspots) {
    const page = await pageFor(journal, h.id, h.label, `${h.label} in ${info.name}.`, !!h.secret);
    notes.push(pinFor(h, info.key, journal, page));
  }
  await scene.createEmbeddedDocuments("Note", notes);
  await scene.setFlag(MODULE_ID, "pins", PINS_LOOK);
  await scene.activate();
  const now = info.hotspots.filter((h) => !h.onDemand).length;
  ui.notifications.info(`Map Maker: ${info.name} is open. Building ${now} places in the background; the others build when you open them.`);
  prebuild(c, scene, info, folder).catch((e) => ui.notifications.error(`Map Maker: ${e.message}`));
  ensureNight(scene).catch((e) => console.warn(`${MODULE_ID} | night image for ${info.name}`, e));
  return scene;
}

/** Builds each hot spot's battle map in turn (interiors first, they are quick); its pin lights up when ready. */
async function prebuild(c, cityScene, info, folder) {
  const order = ["tavern", "temple", "keep", "market", "gate", "docks"];
  const spots = info.hotspots.filter((h) => !h.onDemand).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const h of spots) await buildPlace(c, cityScene, info.key, h.id, { hotspot: h.id }, folder, !!h.street);
  ui.notifications.info(`Map Maker: all places in ${info.name} are ready.`);
}

async function buildPlace(c, cityScene, cityKey, placeId, request, folder, street) {
  if (building.has(`${cityKey}:${placeId}`)) return;
  building.add(`${cityKey}:${placeId}`);
  try {
    const res = await c.rpc("city.build", { city: cityKey, ...request });
    const scene = await buildScene(c, res.mapId, res.version, { pps: street ? STREET_PPS : undefined, folder: folder.id, quiet: true });
    await scene.setFlag(MODULE_ID, "city", cityKey);
    await scene.setFlag(MODULE_ID, "look", STREET_LOOK);
    // Townsfolk where the furniture says they would be.
    await populate(c, scene).catch((e) => console.warn(`${MODULE_ID} | townsfolk not placed on ${scene.name}`, e));
    const note = cityScene.notes.find((n) => n.getFlag(MODULE_ID, "place") === placeId);
    if (note) await note.update({ "texture.tint": "#ffffff", [`flags.${MODULE_ID}.scene`]: scene.id });
    ui.notifications.info(`Map Maker: ${res.title} is ready.`);
    return scene;
  } finally {
    building.delete(`${cityKey}:${placeId}`);
  }
}

/** Double-clicking a ready place opens its battle map for the GM; with Shift, for everyone. */
Hooks.on("activateNote", (note, options) => {
  const sceneId = note.document.getFlag(MODULE_ID, "scene");
  if (!game.user.isGM || !note.document.getFlag(MODULE_ID, "place")) return true;
  const scene = sceneId && game.scenes.get(sceneId);
  if (!scene) {
    const doc = note.document;
    const cityKey = doc.getFlag(MODULE_ID, "city"), placeId = doc.getFlag(MODULE_ID, "place");
    // Places built on demand start building the first time they are opened.
    if (doc.getFlag(MODULE_ID, "onDemand") && !building.has(`${cityKey}:${placeId}`)) {
      ui.notifications.info(`Map Maker: building ${doc.text}, about half a minute...`);
      const cityScene = doc.parent;
      folderFor(cityScene.getFlag(MODULE_ID, "cityName") ?? cityScene.name)
        .then((folder) => buildPlace(client(), cityScene, cityKey, placeId, { hotspot: placeId }, folder, !!doc.getFlag(MODULE_ID, "street")))
        .then((built) => built?.view())
        .catch((e) => ui.notifications.error(`Map Maker: ${e.message}`));
    } else ui.notifications.info("Map Maker: still building this place.");
    return false;
  }
  const ev = globalThis.event;
  if (ev?.shiftKey) scene.activate();
  else scene.view();
  return false;
});

/**
 * A box drawn with the "Map an area" tool on a city scene (canvas pixels) becomes a battle map
 * of that area, with a pin where the box was.
 */
async function buildArea(cityScene, box) {
  const cityKey = cityScene.getFlag(MODULE_ID, "city");
  const DialogV2 = foundry.applications.api.DialogV2;
  const ok = await DialogV2.confirm({ window: { title: "Georgios' Map Maker" }, content: `<p>${esc(t("AreaConfirm"))}</p>` });
  if (!ok) return;
  // The companion measures from the city image's corner; the scene may have padding round it.
  const d = canvas.dimensions;
  const rect = { x: box.x - d.sceneX, y: box.y - d.sceneY, w: box.w, h: box.h };
  const c = client();
  const folder = await folderFor(cityScene.getFlag(MODULE_ID, "cityName") ?? cityScene.name);
  const journal = game.journal.find((e) => e.getFlag(MODULE_ID, "city") === cityKey);
  const placeId = `area-${Math.round(rect.x)}-${Math.round(rect.y)}`;
  const page = journal ? await pageFor(journal, placeId, "Streets", "A street the party went to.") : undefined;
  await cityScene.createEmbeddedDocuments("Note", [{ x: box.x + box.w / 2, y: box.y + box.h / 2, entryId: journal?.id, pageId: page?.id, text: "Streets", texture: { src: CITY_ICONS.area, tint: "#888888" }, iconSize: 48, fontSize: 28, global: true, flags: { [MODULE_ID]: { place: placeId, city: cityKey } } }]);
  ui.notifications.info("Map Maker: building that area...");
  try {
    const scene = await buildPlace(c, cityScene, cityKey, placeId, { rect }, folder, true);
    if (scene) scene.view();
  } catch (e) {
    ui.notifications.error(`Map Maker: ${e.message}`);
  }
}

/** City links (Azgaar's "City Map" in a city's journal) open as city scenes for the GM. */
document.addEventListener("click", async (ev) => {
  const a = ev.target?.closest?.('a[href*="watabou.github.io/city-generator"]');
  if (!a || !game.user?.isGM) return;
  ev.preventDefault();
  ev.stopPropagation();
  const name = new URL(a.href).searchParams.get("name") ?? undefined;
  const DialogV2 = foundry.applications.api.DialogV2;
  const ok = await DialogV2.confirm({ window: { title: "Georgios' Map Maker" }, content: `<p>Open ${esc(name ?? "this city")} as a city scene for your players?</p>` });
  if (!ok) return;
  // The journal the link sat in would cover the city scene: close it.
  const sheet = foundry.applications.instances?.get(a.closest(".application")?.id ?? "");
  sheet?.close();
  openCity(a.href, name).catch((e) => ui.notifications.error(`Map Maker: ${e.message}`));
}, true);

class MapMakerPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gmm-panel",
    classes: ["gmm-panel"],
    window: { title: "Georgios' Map Maker", resizable: true },
    position: { width: 760, height: 720 },
  };

  constructor(options) {
    super(options);
    this.c = client();
    this.chatId = foundry.utils.randomID();
    this.log = [];
    this.mapId = null;
    this.map = null;
    this.thumbs = new Map();
    this.busy = false;
    this.off = this.c.onMessage((m) => this.onCompanion(m));
    // Reopen on the map worked on last, so Build scene works after a reload.
    this.c.rpc("maps.list").then((list) => {
      if (this.mapId) return;
      this.mapId = latestMap(list);
      if (this.mapId) this.refresh();
    }).catch(() => {});
  }

  async onCompanion(m) {
    if (m.type === "chat" && m.chatId === this.chatId) {
      const e = m.event;
      if (e.type === "text") this.log.push({ who: "claude", text: e.text });
      if (e.type === "tool") this.log.push({ who: "tool", text: e.tool });
      if (e.type === "error") this.log.push({ who: "error", text: e.text });
      if (e.type === "done") this.busy = false;
      this.render();
    }
    if (m.type === "map.changed") {
      this.mapId = m.mapId ?? this.mapId;
      await this.refresh();
      if (m.dungeondraft) this.log.push({ who: "tool", text: `${t("DungeondraftSaved")} (${m.dungeondraft.changes})` });
    }
  }

  async refresh() {
    if (!this.mapId) return this.render();
    try {
      this.map = await this.c.rpc("maps.get", { mapId: this.mapId });
      for (const url of this.thumbs.values()) URL.revokeObjectURL(url);
      this.thumbs.clear();
      for (const v of this.map.versions) {
        const blob = await this.c.image(`/image/${encodeURIComponent(this.mapId)}/${encodeURIComponent(v.id)}`, { pps: 20 });
        this.thumbs.set(v.id, URL.createObjectURL(blob));
      }
    } catch (e) {
      this.log.push({ who: "error", text: e.message });
    }
    this.render();
  }

  async _renderHTML() {
    const picked = this.map?.plan?.versions?.picked;
    const versions = (this.map?.versions ?? []).map((v) => `
      <figure class="gmm-version ${picked === v.id ? "picked" : ""}" data-version="${esc(v.id)}">
        ${this.thumbs.get(v.id) ? `<img src="${this.thumbs.get(v.id)}" alt="${esc(v.name)}">` : `<div class="gmm-noimg"></div>`}
        <figcaption>${esc(v.id)}: ${esc(v.name)}</figcaption>
      </figure>`).join("");
    const log = this.log.map((l) => (l.who === "claude" ? `<div class="gmm-claude">${miniMarkdown(l.text)}</div>` : `<p class="gmm-${l.who}">${l.who === "tool" ? "&#9881; " : ""}${esc(l.text)}</p>`)).join("");
    return `
      <section class="gmm-body">
        <div class="gmm-log">${log || `<p class="gmm-hint">${esc(t("Hint"))}</p>`}</div>
        ${versions ? `<div class="gmm-versions">${versions}</div>` : ""}
        <div class="gmm-actions">
          <button type="button" data-action="build" ${this.mapId ? "" : "disabled"}>${esc(t("BuildScene"))}</button>
          <button type="button" data-action="dd" ${this.mapId ? "" : "disabled"}>${esc(t("OpenDungeondraft"))}</button>
          <button type="button" data-action="packs" ${this.mapId ? "" : "disabled"}>${esc(t("EnablePacks"))}</button>
          <button type="button" data-action="shuffle" ${this.mapId ? "" : "disabled"}>${esc(t("Shuffle"))}</button>
        </div>
        <form class="gmm-input">
          <textarea name="text" rows="3" placeholder="${esc(t("Placeholder"))}" ${this.busy ? "disabled" : ""}></textarea>
          <button type="submit" ${this.busy ? "disabled" : ""}>${esc(this.busy ? t("Working") : t("Send"))}</button>
        </form>
      </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const logEl = content.querySelector(".gmm-log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    content.querySelector("form.gmm-input")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const text = ev.target.elements.text.value.trim();
      if (text) this.send(text);
    });
    content.querySelectorAll(".gmm-version").forEach((el) => el.addEventListener("click", () => this.pick(el.dataset.version)));
    content.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", () => this.action(el.dataset.action)));
  }

  async send(text) {
    this.log.push({ who: "dm", text });
    this.busy = true;
    this.render();
    const hint = this.mapId ? `[Current map: ${this.mapId}]\n` : "";
    try {
      await this.c.call("chat.send", { chatId: this.chatId, text: hint + text });
    } catch (e) {
      this.busy = false;
      this.log.push({ who: "error", text: e.message });
      this.render();
    }
  }

  async pick(version) {
    if (!this.mapId) return;
    await this.c.rpc("maps.pick", { mapId: this.mapId, version });
    this.log.push({ who: "tool", text: `${t("Picked")} ${version}` });
    await this.refresh();
  }

  async action(name) {
    try {
      if (name === "build") await buildScene(this.c, this.mapId, this.map?.plan?.versions?.picked);
      if (name === "dd") {
        await this.c.rpc("dd.open", { mapId: this.mapId });
        this.log.push({ who: "tool", text: t("OpenedDungeondraft") });
      }
      if (name === "packs") {
        const r = await this.c.rpc("dd.enablePacks", { mapId: this.mapId });
        this.log.push({ who: "tool", text: `${t("PacksEnabled")}: ${r.added.length}` });
      }
      if (name === "shuffle") await this.c.rpc("maps.reseed", { mapId: this.mapId });
    } catch (e) {
      this.log.push({ who: "error", text: e.message });
    }
    this.render();
  }

  async close(options) {
    this.off?.();
    this.c.ws?.close();
    for (const url of this.thumbs.values()) URL.revokeObjectURL(url);
    return super.close(options);
  }
}

let panel = null;
function openPanel() {
  if (!game.user.isGM) return ui.notifications.warn(t("GMOnly"));
  try {
    panel ??= new MapMakerPanel();
    panel.render({ force: true });
  } catch (e) {
    ui.notifications.error(e.message);
  }
}

// ---------------------------------------------------------------------------------------
// Way back up: on a place, "back to the city" and "world map"; on a city, "world map".
// Click views it (GM only); Shift-click activates it for everyone.

/** The city scene a place belongs to, and the world map a city was opened from. */
function wayUp(scene) {
  if (!scene) return [];
  const key = scene.getFlag(MODULE_ID, "city");
  if (!key) return [];
  const city = scene.getFlag(MODULE_ID, "mapId") ? game.scenes.find((s) => s.getFlag(MODULE_ID, "city") === key && !s.getFlag(MODULE_ID, "mapId")) : scene;
  const world = city && (game.scenes.get(city.getFlag(MODULE_ID, "worldScene")) ?? game.scenes.find((s) => s.getFlag(MODULE_ID, "worldMap") && s.getFlag(MODULE_ID, "world") && s.getFlag(MODULE_ID, "world") === city.getFlag(MODULE_ID, "worldOf")));
  const out = [];
  if (city && city !== scene) out.push({ scene: city, icon: "fa-solid fa-city", label: city.getFlag(MODULE_ID, "cityName") ?? city.name });
  if (world) out.push({ scene: world, icon: "fa-solid fa-earth-europe", label: t("WorldMap") });
  return out;
}

function renderWayUp() {
  document.getElementById("gmm-way-up")?.remove();
  if (!game.user?.isGM) return;
  const targets = wayUp(canvas.scene);
  if (!targets.length) return;
  const bar = document.createElement("div");
  bar.id = "gmm-way-up";
  for (const tg of targets) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<i class="${tg.icon}"></i> ${esc(tg.label)}`;
    b.title = t("WayUpHint");
    b.addEventListener("click", (ev) => (ev.shiftKey ? tg.scene.activate() : tg.scene.view()));
    bar.append(b);
  }
  const clock = document.getElementById("gmm-clock");
  if (clock) clock.after(bar);
  else document.body.append(bar);
}

Hooks.on("canvasReady", renderWayUp);

/**
 * Places built before townsfolk existed get them the first time the GM looks at them; townsfolk
 * placed without stats (dnd5e not yet updated for this Foundry) get them once it can make actors.
 */
const populating = new Set();
let toldAboutStats = false;
let toldAboutRefresh = false;

/** Bumped when street maps change their look; older street scenes are rebuilt when the GM opens them. 2: buildings from inside. 3: services, mansions, the garrison. 4: lights at night. 5: street lamps. 6: shops stand out (sign, goods out front, terracotta floor, no bedrooms). */
const STREET_LOOK = 6;

/**
 * Rebuilds an older street map in place (image, walls, lights, townsfolk). Other places of a city
 * are rebuilt only when their lights are older (LAMPS_LOOK); otherwise just marked.
 */
async function refreshStreet(scene) {
  const c = client();
  const mapId = scene.getFlag(MODULE_ID, "mapId");
  const info = await c.rpc("maps.get", { mapId });
  if (info.plan?.street || scene.getFlag(MODULE_ID, "lamps") !== LAMPS_LOOK) {
    ui.notifications.info(`Map Maker: bringing ${scene.name} up to date (lights for the night), a moment...`);
    await buildScene(c, mapId, scene.getFlag(MODULE_ID, "version"), { pps: scene.grid.size, folder: scene.folder?.id, quiet: true });
    await populate(c, scene).catch((e) => console.warn(`${MODULE_ID} | townsfolk not placed on ${scene.name}`, e));
    ui.notifications.info(`Map Maker: ${scene.name} is ready.`);
  }
  if (scene.getFlag(MODULE_ID, "roofs") !== ROOFS_LOOK) await ensureRoofs(scene, c);
  await scene.setFlag(MODULE_ID, "look", STREET_LOOK);
}
Hooks.on("canvasReady", () => {
  const scene = canvas.scene;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!scene?.getFlag(MODULE_ID, "mapId") || !scene.getFlag(MODULE_ID, "city") || populating.has(scene.id)) return;
  // Street maps from before buildings showed their insides: built again once, on the GM's first look.
  if (scene.getFlag(MODULE_ID, "look") !== STREET_LOOK) {
    populating.add(scene.id);
    refreshStreet(scene)
      .catch((e) => {
        console.error(`${MODULE_ID} | refreshing ${scene.name}`, e);
        // Once a session: usually the companion is not running, and it is tried again next time.
        if (!toldAboutRefresh) ui.notifications.warn(`Map Maker: could not check ${scene.name} for the new look (${e.message}). Is the companion running?`);
        toldAboutRefresh = true;
      })
      .finally(() => populating.delete(scene.id));
    return;
  }
  const people = scene.tokens.filter((tk) => tk.getFlag(MODULE_ID, "person"));
  // No townsfolk yet, or placed by an older rule (PEOPLE_LOOK): placed (again).
  const fresh = scene.getFlag(MODULE_ID, "people") === undefined || scene.getFlag(MODULE_ID, "peopleLook") !== PEOPLE_LOOK;
  const bare = people.some((tk) => !tk.actorId);
  const unringed = people.some((tk) => !tk.ring?.enabled);
  if (bare && !statsPossible() && !toldAboutStats && game.system.id === "dnd5e") {
    toldAboutStats = true;
    ui.notifications.info(`Map Maker: the townsfolk have no stat blocks yet: dnd5e ${game.system.version} is not made for Foundry ${game.release.generation}. Update the dnd5e system and they get them where they stand.`);
  }
  if (!fresh && !(bare && statsPossible()) && !unringed) return;
  populating.add(scene.id);
  (async () => {
    if (fresh) {
      const n = await populate(client(), scene);
      if (n) ui.notifications.info(`Map Maker: ${n} townsfolk on ${scene.name}.`);
      return;
    }
    if (bare && statsPossible()) {
      const n = await attachStats(scene);
      if (n) ui.notifications.info(`Map Maker: stat blocks given to ${n} townsfolk on ${scene.name}.`);
    }
    if (unringed) await ringUp(scene);
  })()
    .catch((e) => {
      console.error(`${MODULE_ID} | townsfolk on ${scene.name}`, e);
      ui.notifications.error(`Map Maker: townsfolk not placed: ${e.message} (details in the console, F12)`);
    })
    .finally(() => populating.delete(scene.id));
});
Hooks.on("updateScene", (scene) => { if (scene.id === canvas.scene?.id) renderWayUp(); });

/** City scenes get the pins they are missing, and their night image, on the GM's first look. */
let toldAboutPins = false;
Hooks.on("canvasReady", () => {
  const scene = canvas.scene;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!scene?.getFlag(MODULE_ID, "city") || scene.getFlag(MODULE_ID, "mapId")) return;
  const pins = scene.getFlag(MODULE_ID, "pins") !== PINS_LOOK;
  if (!pins && !nightDue(scene)) return;
  // New pins first (they may draw the city again), then its night image.
  (pins ? addNewPins(scene) : Promise.resolve()).then(() => (nightDue(scene) ? ensureNight(scene) : undefined)).catch((e) => {
    console.error(`${MODULE_ID} | new pins or night image for ${scene.name}`, e);
    if (!toldAboutPins) ui.notifications.warn(`Map Maker: could not bring ${scene.name} up to date (${e.message}). Is the companion running?`);
    toldAboutPins = true;
  });
});

/**
 * Bumped when the module's lights change; maps built before are rebuilt (image, walls, lights) on
 * the GM's first look, since the lights come with new pieces in the picture. 1: lamps light from
 * dusk to dawn with the clock. 2: a light in every room, burning hearths, torches by public doors,
 * braziers at gates and on markets, lanterns on piers. 3: street lamps. City maps go through refreshStreet.
 */
const LAMPS_LOOK = 3;
let toldAboutLamps = false;

async function refreshLamps(scene) {
  ui.notifications.info(`Map Maker: bringing ${scene.name} up to date (lights for the night), a moment...`);
  await buildScene(client(), scene.getFlag(MODULE_ID, "mapId"), scene.getFlag(MODULE_ID, "version"), { pps: scene.grid.size, folder: scene.folder?.id, quiet: true });
  ui.notifications.info(`Map Maker: ${scene.name} is ready.`);
}
Hooks.on("canvasReady", () => {
  const scene = canvas.scene;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!scene?.getFlag(MODULE_ID, "mapId") || scene.getFlag(MODULE_ID, "city") || scene.getFlag(MODULE_ID, "lamps") === LAMPS_LOOK || populating.has(scene.id)) return;
  populating.add(scene.id);
  refreshLamps(scene).finally(() => populating.delete(scene.id)).catch((e) => {
    console.error(`${MODULE_ID} | lamps for ${scene.name}`, e);
    if (!toldAboutLamps) ui.notifications.warn(`Map Maker: could not give ${scene.name} its lamps (${e.message}). Is the companion running?`);
    toldAboutLamps = true;
  });
});

/**
 * Maps from before the weather get their roofs (unless a rebuild above gives them): all of them in
 * the background when the GM loads the world, so the weather shows on every map, not only on the
 * ones the GM has opened; and any left over on the GM's first look.
 */
const roofing = new Set();
let toldAboutRoofs = false;
const roofsDue = (scene) => {
  if (!scene?.getFlag(MODULE_ID, "mapId") || scene.getFlag(MODULE_ID, "roofs") === ROOFS_LOOK || roofing.has(scene.id)) return false;
  const rebuild = scene.getFlag(MODULE_ID, "city") ? scene.getFlag(MODULE_ID, "look") !== STREET_LOOK : scene.getFlag(MODULE_ID, "lamps") !== LAMPS_LOOK;
  return !rebuild;
};
async function roofScene(scene, c) {
  roofing.add(scene.id);
  try {
    await ensureRoofs(scene, c);
  } catch (e) {
    console.error(`${MODULE_ID} | roofs for ${scene.name}`, e);
    if (!toldAboutRoofs) ui.notifications.warn(`Map Maker: ${scene.name} gets no weather until it knows where its roofs are (${e.message}). Is the companion running?`);
    toldAboutRoofs = true;
    throw e;
  } finally {
    roofing.delete(scene.id);
  }
}
Hooks.on("canvasReady", () => {
  const scene = canvas.scene;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !roofsDue(scene)) return;
  roofScene(scene).catch(() => {});
});
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const due = game.scenes.filter(roofsDue);
  if (!due.length) return;
  let c;
  try {
    c = client();
  } catch {
    return;
  }
  let done = 0;
  for (const scene of due) {
    try {
      await roofScene(scene, c);
      done++;
    } catch {
      break;
    }
  }
  if (done) ui.notifications.info(`Map Maker: ${done} map${done === 1 ? "" : "s"} now keep the weather out of their buildings, so the weather shows on them too.`);
});

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "companionUrl", { name: "GMM.CompanionUrl", hint: "GMM.CompanionUrlHint", scope: "client", config: true, type: String, default: "http://127.0.0.1:47110" });
  game.settings.register(MODULE_ID, "launcherUrl", { name: "GMM.Launcher.Url", hint: "GMM.Launcher.UrlHint", scope: "client", config: true, type: String, default: "http://127.0.0.1:47100" });
  // Client scope keeps the token in this browser only; world settings would reach every player.
  game.settings.register(MODULE_ID, "token", { name: "GMM.Token", hint: "GMM.TokenHint", scope: "client", config: true, type: String, default: "" });
  // Actor files already imported from the drop folder (importActors).
  game.settings.register(MODULE_ID, "importedActors", { scope: "world", config: false, type: Array, default: [] });
  // Token change files already applied from the drop folder (importUpdates).
  game.settings.register(MODULE_ID, "importedUpdates", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "pps", { name: "GMM.Resolution", hint: "GMM.ResolutionHint", scope: "world", config: true, type: Number, default: 100, choices: { 70: "70", 100: "100", 140: "140", 200: "200" } });
  // "Import a world" in the module settings opens the bundle picker.
  class ImportWorldMenu extends foundry.applications.api.ApplicationV2 {
    async render() {
      importDialog().catch((e) => ui.notifications.error(`Map Maker: ${e.message}`));
      return this;
    }
  }
  game.settings.registerMenu(MODULE_ID, "importWorld", { name: "GMM.ImportWorld", label: "GMM.ImportWorldLabel", hint: "GMM.ImportWorldHint", icon: "fa-solid fa-earth-europe", type: ImportWorldMenu, restricted: true });
  // The left toolbar's "Georgios' Modules" group: the "Map an area" tool and the panel button
  // (Georgios Scribbler adds its buttons to the same group).
  registerAreaTool({ openPanel, onArea: buildArea, t, openCompanions });
  // The clock bar at the top, and every scene's light following it.
  registerClock();
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { open: openPanel, buildScene: (mapId, version) => buildScene(client(), mapId, version), openCity, importWorld, importDialog, listWorlds, populate: (scene = canvas.scene) => populate(client(), scene) };
  if (game.user.isGM && game.users.activeGM?.id === game.user.id) {
    importActors()
      .then(() => importUpdates())
      .catch((e) => console.error(`${MODULE_ID} | imports`, e));
  }
});

/**
 * Token changes dropped into Data/georgios-map-maker/imports/updates, applied once on the GM's
 * next load. Each .json file: { id, note?, actorTokens: [{ actor, update }] }; every update goes
 * to the actor's prototype token and to all of its tokens already placed in any scene.
 */
async function importUpdates() {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  let files = [];
  try {
    ({ files } = await FP.browse("data", `${MODULE_ID}/imports/updates`));
  } catch {
    return; // No drop folder.
  }
  const done = new Set(game.settings.get(MODULE_ID, "importedUpdates") ?? []);
  for (const file of files.filter((f) => f.toLowerCase().endsWith(".json"))) {
    const job = await (await fetch(file)).json();
    const tag = job.id ?? file;
    if (done.has(tag)) continue;
    let tokens = 0, actors = 0;
    for (const { actor: id, update } of job.actorTokens ?? []) {
      const actor = game.actors.get(id);
      if (!actor) continue;
      await actor.update(Object.fromEntries(Object.entries(update).map(([k, v]) => [`prototypeToken.${k}`, v])));
      actors++;
      for (const scene of game.scenes) {
        const ups = scene.tokens.filter((tk) => tk.actorId === id).map((tk) => ({ _id: tk.id, ...update }));
        if (ups.length) { await scene.updateEmbeddedDocuments("Token", ups); tokens += ups.length; }
      }
    }
    done.add(tag);
    await game.settings.set(MODULE_ID, "importedUpdates", [...done]);
    ui.notifications.info(`Map Maker: ${job.note ?? tag} (${actors} actors, ${tokens} placed tokens).`);
  }
}

/**
 * Actors dropped into Data/georgios-map-maker/imports/actors (one actor's data per .json file,
 * embedded items and effects included) are created once in this world, on the GM's next load.
 * No token is placed. A file is never imported twice, even after the actor is deleted.
 */
async function importActors() {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  let files = [];
  try {
    ({ files } = await FP.browse("data", `${MODULE_ID}/imports/actors`));
  } catch {
    return; // No drop folder.
  }
  const done = new Set(game.settings.get(MODULE_ID, "importedActors") ?? []);
  for (const file of files.filter((f) => f.toLowerCase().endsWith(".json"))) {
    const data = await (await fetch(file)).json();
    const tag = data.flags?.[MODULE_ID]?.importedFrom ?? file;
    if (done.has(tag)) continue;
    if (!game.actors.get(data._id)) {
      await Actor.implementation.create(data, { keepId: true });
      ui.notifications.info(`Map Maker: ${data.name} added to the actors.`);
    }
    done.add(tag);
    await game.settings.set(MODULE_ID, "importedActors", [...done]);
  }
}

Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".gmm-open")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gmm-open";
  btn.innerHTML = `<i class="fa-solid fa-dungeon"></i> ${esc(t("Open"))}`;
  btn.addEventListener("click", openPanel);
  (root.querySelector(".header-actions") ?? root.querySelector("header") ?? root).append(btn);
});
