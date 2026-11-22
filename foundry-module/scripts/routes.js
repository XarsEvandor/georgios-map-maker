/**
 * Ways on the world map. The companion measures the way between towns (through other towns when
 * asked, by land only when asked) and this draws it on the world map scene: a pale halo, the way
 * coloured by kind (red road, orange trail, blue sea, brown open ground), a dot on each town asked
 * for (green start, gold stops, red end) and a label. The drawings are hidden from players until the
 * GM reveals them (the Route tool's "players see it", or the drawing HUD's eye), and flagged, so the next way replaces them and Clear
 * removes them. "Here" is the town of the scene the GM has open.
 */

import { MODULE_ID, esc } from "./lib.js";

const KIND_COLOR = { road: "#c0281e", trail: "#d4621a", sea: "#1d5fae", "open ground": "#8a6a2e" };
const STOP_COLOR = { start: "#1e8f3a", via: "#e0a92e", end: "#c0281e" };

const flag = (scene, key) => scene?.getFlag(MODULE_ID, key);

/** The city scene a place map belongs to (by the city key both carry). */
function cityScene(scene) {
  const key = flag(scene, "city");
  if (!key) return undefined;
  if (flag(scene, "cityName")) return scene;
  return game.scenes.find((s) => flag(s, "city") === key && flag(s, "cityName"));
}

/** The Map Maker world a scene belongs to: the world map's own, a city's, or a place's city's. */
export function worldOf(scene) {
  return flag(scene, "world") ?? flag(scene, "worldOf") ?? flag(cityScene(scene), "worldOf");
}

/** The town of a scene (a city, or a place in one); undefined on the world map and elsewhere. */
export function hereOf(scene = globalThis.canvas?.scene) {
  return flag(cityScene(scene), "cityName");
}

/** A world's map scene. */
export function worldMapOf(world) {
  return game.scenes.find((s) => flag(s, "worldMap") && flag(s, "world") === world);
}

const isRoute = (d) => !!d.getFlag(MODULE_ID, "route");

/** Removes the drawn way from the world map (every world's, when none is named). */
export async function clearRoute(world) {
  let removed = 0;
  for (const scene of game.scenes.filter((s) => flag(s, "worldMap") && (!world || flag(s, "world") === world))) {
    const ids = scene.drawings.filter(isRoute).map((d) => d.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Drawing", ids);
    removed += ids.length;
  }
  return removed;
}

/** An open line through points (world map pixels), as drawing data. */
function lineData(points, color, width, alpha) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x, y, bezierFactor: 0, fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: width, strokeColor: color, strokeAlpha: alpha,
    shape: { type: "p", points: points.flatMap(([px, py]) => [px - x, py - y]), width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}

/** A round dot on a town. */
function dotData([x, y], color, size) {
  return {
    x: x - size / 2, y: y - size / 2, fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: color, fillAlpha: 1,
    strokeWidth: Math.max(2, Math.round(size / 8)), strokeColor: "#ffffff", strokeAlpha: 1,
    shape: { type: "e", width: size, height: size },
  };
}

/**
 * Draws a measured way on its world map, replacing the way drawn before; hidden from the players
 * unless `reveal`. Returns where it went ({ scene, name, revealed }), or undefined when this Foundry
 * world has no map scene for that world.
 * @param {string} world
 * @param {{ from: string, to: string, via?: string[], miles: number, points: number[][], steps: string[], stops: Array<{name: string, point: number[]}> }} route
 */
export async function drawRoute(world, route, { land = false, reveal = false } = {}) {
  const scene = worldMapOf(world);
  if (!scene) return undefined;
  await clearRoute(world);
  const g = scene.grid.size || 100;
  const width = Math.max(6, Math.round(g * 0.16));
  const flags = { [MODULE_ID]: { route: true, world } };
  const shapes = [lineData(route.points, "#fff6de", Math.round(width * 1.9), 0.6)];
  // One line per stretch of the same kind of way.
  for (let i = 0; i < route.steps.length;) {
    let j = i;
    while (j + 1 < route.steps.length && route.steps[j + 1] === route.steps[i]) j++;
    shapes.push(lineData(route.points.slice(i, j + 2), KIND_COLOR[route.steps[i]] ?? KIND_COLOR.road, width, 0.95));
    i = j + 1;
  }
  const dot = Math.round(g * 0.55);
  route.stops.forEach((s, i) => shapes.push(dotData(s.point, i === 0 ? STOP_COLOR.start : i === route.stops.length - 1 ? STOP_COLOR.end : STOP_COLOR.via, dot)));
  // The label, over the end of the way.
  const fontSize = Math.min(256, Math.max(24, Math.round(g * 0.6)));
  const text = `${route.from} → ${route.to}${route.via?.length ? ` (via ${route.via.join(", ")})` : ""}: ${Math.round(route.miles)} mi${land ? ", by land" : ""}`;
  const boxW = Math.round(text.length * fontSize * 0.56);
  const boxH = Math.round(fontSize * 1.6);
  const [ex, ey] = route.stops.at(-1).point;
  shapes.push({
    x: ex - boxW / 2, y: ey - dot - boxH, shape: { type: "r", width: boxW, height: boxH }, fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0,
    text, fontSize, textColor: "#fff6de", textAlpha: 1,
  });
  const top = Math.max(0, ...scene.drawings.map((d) => d.sort ?? 0)) + 1;
  await scene.createEmbeddedDocuments("Drawing", shapes.map((s, i) => ({ ...s, hidden: !reveal, sort: top + i, author: game.user.id, flags })));
  if (canvas.scene?.id === scene.id) await panTo(route.points);
  return { scene: scene.id, name: scene.name, revealed: !!reveal };
}

/** Pans and zooms the canvas so the whole way shows. */
async function panTo(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const w = Math.max(400, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(400, Math.max(...ys) - Math.min(...ys));
  const scale = Math.max(0.1, Math.min(1, 0.8 * Math.min(window.innerWidth / w, window.innerHeight / h)));
  await canvas.animatePan({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, scale, duration: 600 });
}

/** Opens the world map with the drawn way on it, and shows the whole way. */
export async function showRoute(world) {
  const scenes = game.scenes.filter((s) => flag(s, "worldMap") && (!world || flag(s, "world") === world));
  const scene = scenes.find((s) => s.drawings.some(isRoute)) ?? scenes[0];
  if (!scene) return false;
  if (canvas.scene?.id !== scene.id) await scene.view();
  const pts = scene.drawings.filter((d) => isRoute(d) && d.shape.type === "p").flatMap((d) => {
    const p = d.shape.points;
    const out = [];
    for (let i = 0; i < p.length; i += 2) out.push([d.x + p[i], d.y + p[i + 1]]);
    return out;
  });
  if (pts.length) await panTo(pts);
  return true;
}

/**
 * The Route tool: From (the open scene's town to begin with), Through, To, By land only; Draw
 * measures and draws the way and shows it in words, Clear removes it.
 * @param {(o: object) => Promise<object>} route  the module's api.route
 */
export async function routeDialog(route, t) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const here = hereOf() ?? "";
  const content = `<div class="gmm-route-form">
    <label>${esc(t("Route.From"))} <input type="text" name="from" value="${esc(here)}" autofocus></label>
    <label>${esc(t("Route.Via"))} <input type="text" name="via" placeholder="${esc(t("Route.ViaHint"))}"></label>
    <label>${esc(t("Route.To"))} <input type="text" name="to"></label>
    <label class="gmm-check"><input type="checkbox" name="land"> ${esc(t("Route.Land"))}</label>
    <label class="gmm-check"><input type="checkbox" name="reveal"> ${esc(t("Route.Reveal"))}</label>
  </div>`;
  const picked = await DialogV2.wait({
    window: { title: t("Route.Title"), icon: "fa-solid fa-route" },
    content,
    buttons: [
      { action: "draw", label: t("Route.Draw"), icon: "fa-solid fa-route", default: true, callback: (event, button) => ({ action: "draw", form: new foundry.applications.ux.FormDataExtended(button.form).object }) },
      { action: "clear", label: t("Route.Clear"), icon: "fa-solid fa-eraser", callback: () => ({ action: "clear" }) },
    ],
    rejectClose: false,
  });
  if (!picked) return;
  if (picked.action === "clear") {
    const n = await clearRoute();
    return ui.notifications.info(n ? t("Route.Cleared") : t("Route.NothingToClear"));
  }
  const f = picked.form;
  const from = String(f.from ?? "").trim();
  const to = String(f.to ?? "").trim();
  if (!from || !to) return ui.notifications.warn(t("Route.NeedEnds"));
  const via = String(f.via ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  let answer;
  try {
    answer = await route({ from, to, via, land: !!f.land, reveal: !!f.reveal, image: false, draw: true });
  } catch (e) {
    return ui.notifications.error(`Map Maker: ${e.message}`);
  }
  const lines = String(answer.text ?? "").split("\n").filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join("");
  const where = answer.drawn ? `<p class="gmm-meta">${esc(game.i18n.format(answer.drawn.revealed ? "GMM.Route.DrawnShown" : "GMM.Route.DrawnOn", { scene: answer.drawn.name }))}</p>` : "";
  await DialogV2.prompt({ window: { title: answer.found ? `${answer.route.from} → ${answer.route.to}` : t("Route.Title"), icon: "fa-solid fa-route" }, content: `${lines}${where}`, rejectClose: false });
}
