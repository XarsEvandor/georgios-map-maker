/**
 * The sundial at the table (DESIGN.md section 38). A map built with a sundial carries, in its scene
 * flags, where the hands stand, which gem answers to which hand (the GM's secret) and a key the
 * plaza and the vestibule under it share. Each hand's shadow is a tile pivoting on the tower; each
 * gem has a hidden light. The GM cranks a hand here: every scene with the same key turns that hand
 * and lights the gems that sit under their own hand. No companion needed.
 */

import { MODULE_ID } from "./lib.js";

export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const HANDS = ["hour", "minute", "second"];

/** A hand's tile rotation (degrees, clockwise, 0 at XII); seen from below the dial runs the other way. */
export function handRotation(numeral, mirrored = false) {
  const deg = (numeral % 12) * 30;
  return mirrored ? (360 - deg) % 360 : deg;
}

/** Which gems light when the hands stand at `hands`: the ones under their own hand, and only when every hand rests on a gem. */
export function litGems(gems, hands) {
  const onGem = HANDS.every((h) => gems.some((g) => g.numeral % 12 === hands[h] % 12));
  return gems.map((g) => onGem && hands[g.hand] % 12 === g.numeral % 12);
}

/** The sundial of a scene, or undefined. */
export function sundialOf(scene = canvas?.scene) {
  return scene?.getFlag(MODULE_ID, "sundial");
}

/** Every scene sharing the sundial's key (the plaza and the vestibule under it). */
function scenesOf(key) {
  return game.scenes.filter((s) => s.getFlag(MODULE_ID, "sundial")?.key === key);
}

/** Turns one hand on every scene of the sundial and lights the gems accordingly. Returns the new standing. */
export async function crank(hand, steps = 1, scene = canvas?.scene) {
  const sd = sundialOf(scene);
  if (!sd) {
    ui.notifications.warn("Map Maker: this scene has no sundial.");
    return undefined;
  }
  if (!HANDS.includes(hand)) throw new Error(`no such hand: ${hand}`);
  const stopped = { ...sd.stopped, [hand]: ((((sd.stopped[hand] - 1 + steps) % 12) + 12) % 12) + 1 };
  return setHands(stopped, sd.key);
}

/** Puts every hand where `stopped` says (numerals 1..12) on every scene of the sundial; lights the gems that sit under their own hand. */
export async function setHands(stopped, key = sundialOf()?.key) {
  const scenes = scenesOf(key);
  if (!scenes.length) throw new Error("no scene has this sundial");
  let lit = [];
  for (const s of scenes) {
    const d = s.getFlag(MODULE_ID, "sundial");
    const tiles = s.tiles.filter((t) => t.getFlag(MODULE_ID, "sundial")?.hand).map((t) => ({ _id: t.id, rotation: handRotation(stopped[t.getFlag(MODULE_ID, "sundial").hand], !!d.mirrored) }));
    if (tiles.length) await s.updateEmbeddedDocuments("Tile", tiles);
    lit = litGems(d.gems, stopped);
    const lights = s.lights.filter((l) => l.getFlag(MODULE_ID, "sundial")?.gem !== undefined).map((l) => {
      const i = d.gems.findIndex((g) => g.numeral === l.getFlag(MODULE_ID, "sundial").gem);
      return { _id: l.id, hidden: !(i >= 0 && lit[i]) };
    });
    if (lights.length) await s.updateEmbeddedDocuments("AmbientLight", lights);
    await s.setFlag(MODULE_ID, "sundial", { ...d, stopped });
  }
  const d = scenes[0].getFlag(MODULE_ID, "sundial");
  const where = HANDS.map((h) => `${h} ${ROMAN[(stopped[h] - 1) % 12]}`).join(", ");
  const glow = d.gems.filter((_, i) => lit[i]).map((g) => g.color);
  const all = d.gems.length && glow.length === d.gems.length;
  ui.notifications.info(`Sundial: ${where}. ${all ? "Every gem burns steady: the field drops." : glow.length ? `Steady: ${glow.join(", ")}.` : "The gems stay dark."}`);
  return { stopped, lit };
}

/** A small window for the GM: a button per hand and direction, and the hands' standing. */
export function sundialDialog() {
  const sd = sundialOf();
  if (!sd) return ui.notifications.warn("Map Maker: open the plaza or the vestibule of a sundial first.");
  const Base = foundry.applications.api.ApplicationV2;
  class SundialWindow extends Base {
    static DEFAULT_OPTIONS = { id: "gmm-sundial", classes: ["gmm-sundial"], window: { title: "Sundial", resizable: false }, position: { width: 300 } };
    async _renderHTML() {
      const d = sundialOf();
      if (!d) return `<p>No sundial on this scene.</p>`;
      const lit = litGems(d.gems, d.stopped);
      const rows = HANDS.map((h) => `<div class="gmm-sundial-row"><button type="button" data-hand="${h}" data-steps="-1">&minus;</button><span>${h}: <b>${ROMAN[(d.stopped[h] - 1) % 12]}</b></span><button type="button" data-hand="${h}" data-steps="1">+</button></div>`).join("");
      const gems = d.gems.map((g, i) => `<span style="color:${lit[i] ? "#e8c84a" : "#777"}">${g.color} ${ROMAN[g.numeral - 1]}${lit[i] ? " (lit)" : ""}</span>`).join(" &middot; ");
      return `<section class="gmm-sundial-body" style="padding:6px 8px;display:flex;flex-direction:column;gap:6px">${rows}<p style="margin:4px 0 0">${gems}</p><p style="margin:0;font-size:0.85em;opacity:0.8">Secret: ${d.gems.map((g) => `${g.color} = ${g.hand}`).join(", ")}</p></section>`;
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      content.querySelectorAll("button[data-hand]").forEach((b) => b.addEventListener("click", async () => {
        await crank(b.dataset.hand, Number(b.dataset.steps));
        this.render();
      }));
    }
  }
  const win = new SundialWindow();
  win.render({ force: true });
  return win;
}

/** The "Sundial" macro in the macro directory, made once, so the GM can crank from the hotbar. */
export async function ensureSundialMacro() {
  if (!game.user.isGM || game.macros.find((m) => m.getFlag(MODULE_ID, "sundial"))) return;
  await Macro.create({
    name: "Sundial",
    type: "script",
    img: "icons/svg/clockwork.svg",
    scope: "global",
    command: `game.modules.get("${MODULE_ID}").api.sundial.dialog();`,
    flags: { [MODULE_ID]: { sundial: true } },
  });
  ui.notifications.info("Map Maker: a Sundial macro is in the macro directory; drag it to the hotbar to crank the hands.");
}
