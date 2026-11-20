/**
 * Which of a scene's townsfolk tokens survive when Map Maker places the townsfolk again (a rebuild,
 * or an upgrade of how it places them). It used to delete every token it had placed, so an NPC the
 * GM had played from a placeholder (moved into a house, renamed, linked to an actor) was lost with
 * the rest. Now, for each old token:
 * - kept as it is: the GM moved it (Map Maker records where it put each token; nothing else moves
 *   townsfolk), renamed it (a token another module has taken over counts as renamed only once its
 *   name has lost the "<given>, <role>" shape such modules keep), or linked it to an actor;
 * - reused in place: it is the same placeholder as one about to be placed (same name), so whatever
 *   another module made of it stays;
 * - removed: an untouched placeholder the new placement no longer has.
 * Tokens placed before the record existed have no placement: a move cannot be seen, and a rename is
 * judged by Map Maker's own naming ("Alys, dockworker").
 * No Foundry globals here, so it can be tested outside Foundry.
 */

export const OWN = "georgios-map-maker";

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Map Maker's own name for a placeholder: "<given>, <role>". */
export const placeholderName = (p) => `${p.name}, ${p.role}`;

/** True when a name still is Map Maker's placeholder for this role. */
export function looksPlaceholder(name, role) {
  return new RegExp(`^[^,]+,\\s*${escapeRe(role ?? "")}$`, "i").test(String(name ?? ""));
}

/** Why an old token is kept ("moved", "renamed", "linked"), or null. */
export function keepReason(tk) {
  const f = tk.flags?.[OWN] ?? {};
  const placed = f.placed;
  if (placed && (Math.abs((tk.x ?? 0) - placed.x) > 1 || Math.abs((tk.y ?? 0) - placed.y) > 1)) return "moved";
  if (tk.actorLink) return "linked";
  const foreign = Object.keys(tk.flags ?? {}).some((k) => k !== OWN && k !== "core");
  const renamed = placed?.name ? tk.name !== placed.name : !looksPlaceholder(tk.name, f.role);
  // A module that recasts placeholders keeps their shape ("Tokk, dockworker"); a name without it
  // ("Alice") is the GM's, whatever else has touched the token.
  if (renamed && (!foreign || !looksPlaceholder(tk.name, f.role))) return "renamed";
  return null;
}

/** The placeholder an old token stands for (its recorded name, or its name while it still is one). */
export function identityOf(tk) {
  const f = tk.flags?.[OWN] ?? {};
  if (f.placed?.name) return f.placed.name;
  return looksPlaceholder(tk.name, f.role) ? tk.name : null;
}

/**
 * Sorts a scene's old townsfolk tokens against the people about to be placed.
 * old: [{ id, name, x, y, actorLink, flags }]; fresh: [{ name, role, px, py, ... }] (Map Maker's people).
 * Every kept token stands for one of the fresh people, so none is placed twice: the one with its
 * name, else the nearest one of its role still free. (A shop rebuilt with its counter elsewhere
 * used to get a second keeper behind the new counter while the GM's keeper stood by the old one.)
 * Returns { keep: [{ id, reason, index? }], reuse: [{ id, index }], drop: [id], create: [index] };
 * a kept token's index is the fresh person it stands for.
 */
export function reconcile(old, fresh) {
  const keep = [];
  const rest = [];
  for (const tk of old) {
    const reason = keepReason(tk);
    if (reason) keep.push({ id: tk.id, reason, identity: identityOf(tk), tk });
    else rest.push(tk);
  }
  const byName = new Map();
  fresh.forEach((p, index) => {
    const n = placeholderName(p);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(index);
  });
  const used = new Set();
  const byNameFree = (name) => (name ? (byName.get(name) ?? []).find((i) => !used.has(i)) : undefined);
  // Names first: kept tokens, then the placeholders to reuse.
  for (const k of keep) {
    const index = byNameFree(k.identity);
    if (index !== undefined) {
      used.add(index);
      k.index = index;
    }
  }
  const reuse = [];
  const drop = [];
  for (const tk of rest) {
    const index = byNameFree(identityOf(tk));
    if (index === undefined) drop.push(tk.id);
    else {
      used.add(index);
      reuse.push({ id: tk.id, index });
    }
  }
  // Then a kept token without a name match takes the nearest free person of its role.
  for (const k of keep) {
    if (k.index !== undefined) continue;
    const role = String(k.tk.flags?.[OWN]?.role ?? "");
    let best;
    let bestD = Infinity;
    fresh.forEach((p, i) => {
      if (used.has(i) || String(p.role) !== role) return;
      const d = Math.hypot((k.tk.x ?? 0) - (p.px ?? 0), (k.tk.y ?? 0) - (p.py ?? 0));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best !== undefined) {
      used.add(best);
      k.index = best;
    }
  }
  const create = fresh.map((_, i) => i).filter((i) => !used.has(i));
  return { keep: keep.map(({ id, reason, index }) => ({ id, reason, ...(index !== undefined ? { index } : {}) })), reuse, drop, create };
}
