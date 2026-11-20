/**
 * Townsfolk on building-level maps. The companion says who stands where (maps.people); each
 * person becomes a token on one of a few shared dnd5e stat blocks kept in a "Townsfolk" actor
 * folder, so the GM can drag them about, hide them, or roll for them if a brawl starts. The art
 * is the dnd5e system's own top-down figures (free with the system). The tokens carry a flag,
 * so a rebuild replaces them and nothing else.
 */

import { placeholderName, reconcile } from "./keep.js";
import { MODULE_ID } from "./lib.js";

const TOKENS = "systems/dnd5e/tokens";
/** Stat block (dnd5e SRD monsters) and figure for each kind of person. */
const KINDS = {
  commoner: { stat: "Commoner", art: "humanoid/Commoner" },
  noble: { stat: "Noble", art: "humanoid/Noble" },
  guard: { stat: "Guard", art: "humanoid/Guard" },
  knight: { stat: "Knight", art: "humanoid/Knight" },
  veteran: { stat: "Veteran", art: "humanoid/Veteran" },
  thug: { stat: "Thug", art: "humanoid/Thug" },
  priest: { stat: "Priest", art: "humanoid/Priest" },
  acolyte: { stat: "Acolyte", art: "humanoid/Acolyte" },
  mage: { stat: "Mage", art: "humanoid/Mage" },
  apprentice: { stat: "Commoner", art: "humanoid/ApprenticeWizard" },
  minstrel: { stat: "Commoner", art: "heroes/BardLute" },
};
/** Soft cloth tints, so a room full of the same figure reads as different people. */
const TINTS = ["#ffffff", "#ffffff", "#f3e6d6", "#e2ece4", "#ece0ee", "#e4e7f6", "#f6eed6", "#eadcd6"];

/** A gold ring on a parchment disc: dark-clothed figures stand out on wood, stone and grass alike. */
const RING = { enabled: true, colors: { ring: "#e0a92e", background: "#d9c9a3" }, effects: 1, subject: { scale: 1 } };

const actors = new Map();
/** Set once a stat block cannot be made this session, so the rest do not try (and fill the screen with errors). */
let noStats = false;

/**
 * Whether this world can make dnd5e actors: the system must be built for this Foundry generation.
 * (dnd5e 5.x on Foundry 14 fails its own data validation for every new actor; 6.x is the Foundry 14 release.)
 */
export function statsPossible() {
  if (game.system.id !== "dnd5e" || noStats) return false;
  const verified = Number(String(game.system.compatibility?.verified ?? "0").split(".")[0]);
  return verified >= game.release.generation;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function townsfolkFolder() {
  return game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, "townsfolk")) ?? Folder.create({ name: "Townsfolk", type: "Actor", flags: { [MODULE_ID]: { townsfolk: true } } });
}

/**
 * The shared actor for a stat block, made once from the dnd5e SRD monsters; failing that, a bare
 * NPC of that name; failing that, none (the tokens still stand and move, only without stats).
 */
function actorFor(stat) {
  if (!statsPossible()) return Promise.resolve(game.actors.find((a) => a.getFlag(MODULE_ID, "townsfolk") === stat) ?? null);
  if (!actors.has(stat)) {
    actors.set(stat, (async () => {
      const have = game.actors.find((a) => a.getFlag(MODULE_ID, "townsfolk") === stat);
      if (have) return have;
      const folder = await townsfolkFolder();
      const flags = { [MODULE_ID]: { townsfolk: stat } };
      const Cls = CONFIG.Actor.documentClass;
      // Plain creation from the compendium entry's data (no importFromCompendium: Foundry 14
      // keeps the entry's id there and would replace any actor that already has it).
      try {
        const pack = game.packs.get("dnd5e.monsters");
        const entry = pack ? (await pack.getIndex()).find((e) => e.name === stat) : undefined;
        const src = entry ? await pack.getDocument(entry._id) : undefined;
        if (src) {
          const data = src.toObject();
          delete data._id;
          delete data.sort;
          delete data.ownership;
          data.folder = folder.id;
          data.flags = { ...(data.flags ?? {}), ...flags };
          data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: false };
          data._stats = { compendiumSource: src.uuid };
          const made = await Cls.create(data);
          if (made) return made;
        }
      } catch (e) {
        console.error(`${MODULE_ID} | ${stat} from the dnd5e monsters failed; making a plain NPC`, e);
      }
      try {
        const made = await Cls.create({ name: stat, type: "npc", folder: folder.id, flags, prototypeToken: { actorLink: false } });
        if (made) return made;
      } catch (e) {
        console.error(`${MODULE_ID} | plain ${stat} NPC failed; tokens go without an actor`, e);
      }
      noStats = true;
      return null;
    })().catch((e) => {
      actors.delete(stat);
      console.error(`${MODULE_ID} | townsfolk actor ${stat}`, e);
      return null;
    }));
  }
  return actors.get(stat);
}

/** Bumped when townsfolk are placed differently; maps placed before get theirs again on the GM's next look. 2: every trade's keeper (services, crafts, dens). */
export const PEOPLE_LOOK = 2;

/**
 * Puts the map's townsfolk on its scene. Townsfolk placed before are sorted (keep.js): the ones the
 * GM moved, renamed or linked stay, the same placeholders are reused, the rest give way. Returns how
 * many new tokens it placed.
 */

export async function populate(c, scene) {
  const mapId = scene.getFlag(MODULE_ID, "mapId");
  if (!mapId) return 0;
  const { people } = await c.rpc("maps.people", { mapId, version: scene.getFlag(MODULE_ID, "version"), pps: scene.grid.size });
  // The GM's NPCs survive: tokens they moved, renamed or linked stay; the same placeholder is reused.
  const old = scene.tokens.filter((tk) => tk.getFlag(MODULE_ID, "person"));
  const plan = reconcile(old.map((tk) => ({ id: tk.id, name: tk.name, x: tk.x, y: tk.y, actorLink: tk.actorLink, flags: tk.flags })), people);
  if (plan.drop.length) await scene.deleteEmbeddedDocuments("Token", plan.drop);
  const reused = plan.reuse.map(({ id, index }) => {
    const p = people[index];
    const tk = scene.tokens.get(id);
    const up = { _id: id, [`flags.${MODULE_ID}.kind`]: p.kind, [`flags.${MODULE_ID}.role`]: p.role };
    // Where Map Maker put it before is known, and the GM has not moved it: to its new spot. Placed
    // before that record existed: it stays where it stands (it may have been moved), recorded there.
    if (tk.getFlag(MODULE_ID, "placed")) Object.assign(up, { x: p.px, y: p.py, rotation: p.rotation, alpha: p.asleep ? 0.8 : 1, [`flags.${MODULE_ID}.placed`]: { x: p.px, y: p.py, name: placeholderName(p) } });
    else up[`flags.${MODULE_ID}.placed`] = { x: tk.x, y: tk.y, name: placeholderName(p) };
    return up;
  });
  if (reused.length) await scene.updateEmbeddedDocuments("Token", reused);
  if (plan.keep.length) ui.notifications.info(`Map Maker: kept ${plan.keep.length} townsfolk you moved, renamed or linked on ${scene.name}.`);
  const docs = [];
  for (const i of plan.create) {
    const p = people[i];
    const k = KINDS[p.kind] ?? KINDS.commoner;
    const actor = await actorFor(k.stat);
    const h = hash(`${mapId}:${i}:${p.name}`);
    const size = 0.88 + ((h >>> 3) % 13) / 100;
    docs.push({
      name: `${p.name}, ${p.role}`,
      actorId: actor?.id ?? null,
      actorLink: false,
      x: p.px,
      y: p.py,
      width: 1,
      height: 1,
      rotation: p.rotation,
      alpha: p.asleep ? 0.8 : 1,
      // Mirrored half the time: the figures face down the image, so a mirror keeps the facing.
      texture: { src: `${TOKENS}/${k.art}.webp`, scaleX: (h & 1 ? -1 : 1) * size, scaleY: size, tint: TINTS[(h >>> 8) % TINTS.length] },
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
      sight: { enabled: false },
      ring: RING,
      // Where and as whom Map Maker placed it: a later placement can tell the GM moved or renamed it.
      flags: { [MODULE_ID]: { person: true, kind: p.kind, role: p.role, placed: { x: p.px, y: p.py, name: placeholderName(p) } } },
    });
  }
  try {
    for (let i = 0; i < docs.length; i += 100) await scene.createEmbeddedDocuments("Token", docs.slice(i, i + 100));
  } catch (e) {
    console.error(`${MODULE_ID} | townsfolk tokens on ${scene.name}`, e, docs[0]);
    throw e;
  }
  await scene.update({ [`flags.${MODULE_ID}.people`]: docs.length + reused.length + plan.keep.length, [`flags.${MODULE_ID}.peopleLook`]: PEOPLE_LOOK });
  return docs.length;
}

/** Gives townsfolk placed without stats their stat blocks, where they stand (after dnd5e is updated). Returns how many. */
export async function attachStats(scene) {
  if (!statsPossible()) return 0;
  const bare = scene.tokens.filter((tk) => tk.getFlag(MODULE_ID, "person") && !tk.actorId);
  const updates = [];
  for (const tk of bare) {
    const actor = await actorFor((KINDS[tk.getFlag(MODULE_ID, "kind")] ?? KINDS.commoner).stat);
    if (actor) updates.push({ _id: tk.id, actorId: actor.id, actorLink: false });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}

/** Puts the ring on townsfolk placed before rings. Returns how many. */
export async function ringUp(scene) {
  const updates = scene.tokens.filter((tk) => tk.getFlag(MODULE_ID, "person") && !tk.ring?.enabled).map((tk) => ({ _id: tk.id, ring: RING }));
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}
