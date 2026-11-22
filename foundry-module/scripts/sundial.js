/**
 * The sundial at the table (DESIGN.md section 38). A map built with a sundial carries, in its scene
 * flags, where the tower's one shadow stands, how many gems burn, and the gems in the order the
 * shadow has to rest on them (the GM's secret). The shadow is a tile pivoting on the tower; each
 * gem has a hidden light; the gate to the stair is a locked door wall. The GM cranks the shadow
 * here, one numeral at a time: the next gem in order lights when the shadow rests on it, a gem out
 * of turn puts them all out, and with every gem burning the gate's lock turns. No companion needed.
 */

import { MODULE_ID } from "./lib.js";

export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** The shadow tile's rotation (degrees, clockwise, 0 at XII). */
export function shadowRotation(numeral) {
  return (((numeral % 12) + 12) % 12) * 30;
}

const wrap = (n) => ((((n - 1) % 12) + 12) % 12) + 1;

/** What happens when the shadow rests on `numeral` with `progress` gems lit: lit, done, wrong (all out) or none. */
export function shadowRests(gems, progress, numeral) {
  const i = gems.findIndex((g) => wrap(g.numeral) === wrap(numeral));
  if (i < 0 || i < progress) return { progress, event: "none" };
  if (i === progress) {
    const p = progress + 1;
    return { progress: p, event: p === gems.length ? "done" : "lit" };
  }
  return { progress: 0, event: "wrong" };
}

/** The sundial of a scene, or undefined. */
export function sundialOf(scene = canvas?.scene) {
  return scene?.getFlag(MODULE_ID, "sundial");
}

/** Turns the shadow `steps` numerals on (negative: back) and settles what the gems and the gate do. Returns the new standing. */
export async function crank(steps = 1, scene = canvas?.scene) {
  const sd = sundialOf(scene);
  if (!sd) {
    ui.notifications.warn("Map Maker: this scene has no sundial.");
    return undefined;
  }
  const numeral = wrap((sd.shadow ?? sd.stopped) + Number(steps || 0));
  const r = shadowRests(sd.gems, sd.progress ?? 0, numeral);
  return setShadow({ shadow: numeral, progress: r.progress }, scene, r.event);
}

/**
 * Puts the shadow on `shadow` (a numeral) with `progress` gems lit, on the scene: the tile turns,
 * the first `progress` gems show their light, the gate is locked unless every gem burns.
 */
export async function setShadow({ shadow, progress }, scene = canvas?.scene, event = "set") {
  const sd = sundialOf(scene);
  if (!sd) throw new Error("this scene has no sundial");
  const numeral = wrap(shadow ?? sd.shadow ?? sd.stopped);
  const lit = Math.max(0, Math.min(sd.gems.length, Number(progress ?? 0)));
  const tiles = scene.tiles.filter((t) => t.getFlag(MODULE_ID, "sundial")?.shadow).map((t) => ({ _id: t.id, rotation: shadowRotation(numeral) }));
  if (tiles.length) await scene.updateEmbeddedDocuments("Tile", tiles);
  const lights = scene.lights.filter((l) => l.getFlag(MODULE_ID, "sundial")?.gem !== undefined).map((l) => {
    const f = l.getFlag(MODULE_ID, "sundial");
    const order = f.order ?? sd.gems.findIndex((g) => g.numeral === f.gem) + 1;
    return { _id: l.id, hidden: !(order >= 1 && order <= lit) };
  });
  if (lights.length) await scene.updateEmbeddedDocuments("AmbientLight", lights);
  const open = lit >= sd.gems.length;
  const ds = open ? CONST.WALL_DOOR_STATES.CLOSED : CONST.WALL_DOOR_STATES.LOCKED;
  const gates = scene.walls.filter((w) => w.getFlag(MODULE_ID, "sundial")?.gate && w.ds !== ds && w.ds !== CONST.WALL_DOOR_STATES.OPEN).map((w) => ({ _id: w.id, ds }));
  if (gates.length) await scene.updateEmbeddedDocuments("Wall", gates);
  await scene.setFlag(MODULE_ID, "sundial", { ...sd, shadow: numeral, progress: lit });
  const gem = sd.gems[lit - 1];
  const said = {
    lit: `The ${gem?.color ?? ""} gem burns steady (${lit} of ${sd.gems.length}).`,
    done: "Every gem burns steady: the gate's lock turns.",
    wrong: "The gems go dark.",
    none: lit ? `${lit} of ${sd.gems.length} steady.` : "The gems stay dark.",
    set: open ? "Every gem burns; the gate is open." : lit ? `${lit} of ${sd.gems.length} steady.` : "The gems are dark; the gate is locked.",
  }[event] ?? "";
  ui.notifications.info(`Sundial: the shadow rests on ${ROMAN[numeral - 1]}. ${said}`);
  return { shadow: numeral, progress: lit, event };
}

/** Back to the start: the shadow where the map put it, the gems dark, the gate locked. */
export async function resetSundial(scene = canvas?.scene) {
  const sd = sundialOf(scene);
  if (!sd) throw new Error("this scene has no sundial");
  return setShadow({ shadow: sd.stopped, progress: 0 }, scene, "set");
}

/** A small window for the GM: back and forward a numeral, the shadow's standing, the gems in order, the secret, reset. */
export function sundialDialog() {
  const sd = sundialOf();
  if (!sd) return ui.notifications.warn("Map Maker: open the sundial's map first.");
  const Base = foundry.applications.api.ApplicationV2;
  class SundialWindow extends Base {
    static DEFAULT_OPTIONS = { id: "gmm-sundial", classes: ["gmm-sundial"], window: { title: "Sundial", resizable: false }, position: { width: 320 } };
    async _renderHTML() {
      const d = sundialOf();
      if (!d) return `<p>No sundial on this scene.</p>`;
      const shadow = d.shadow ?? d.stopped, lit = d.progress ?? 0;
      const row = `<div class="gmm-sundial-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><button type="button" data-steps="-1" title="Crank back one numeral">&larr; back</button><span>shadow on <b style="font-size:1.3em">${ROMAN[shadow - 1]}</b></span><button type="button" data-steps="1" title="Crank forward one numeral">forward &rarr;</button></div>`;
      const gems = d.gems.map((g, i) => `<span style="color:${i < lit ? "#e8c84a" : "#777"}">${i + 1}. ${g.color} ${ROMAN[g.numeral - 1]}${i < lit ? " (lit)" : ""}</span>`).join(" &middot; ");
      const gate = lit >= d.gems.length ? "the gate's lock has turned" : "the gate is locked";
      return `<section class="gmm-sundial-body" style="padding:6px 8px;display:flex;flex-direction:column;gap:6px">${row}<p style="margin:4px 0 0">${gems}</p><p style="margin:0;font-size:0.9em">${lit} of ${d.gems.length} steady; ${gate}.</p><p style="margin:0;font-size:0.85em;opacity:0.8">Secret: the shadow must rest on them in that order.</p><div style="display:flex;justify-content:flex-end"><button type="button" data-reset="1" title="Shadow back where the map put it, gems dark, gate locked">reset</button></div></section>`;
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      content.querySelectorAll("button[data-steps]").forEach((b) => b.addEventListener("click", async () => {
        await crank(Number(b.dataset.steps));
        this.render();
      }));
      content.querySelector("button[data-reset]")?.addEventListener("click", async () => {
        await resetSundial();
        this.render();
      });
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
  ui.notifications.info("Map Maker: a Sundial macro is in the macro directory; drag it to the hotbar to crank the shadow.");
}
