/**
 * A world bundle: everything a Foundry world needs to show an aged world, in one portable JSON
 * file next to its map image. The module's importer turns it into a scene with pins and a
 * journal folder; nothing in it refers to a particular Foundry world, so moving it is copying
 * the folder (Data/georgios-map-maker/worlds/<id>/) and pressing Import in the other world.
 */

import { cityLink, eventText, majorEvents, namer, peoplesOf, realmEvents, type AgedBurg, type AgedWorld, type AzWorld } from "@gmm/core";
import { notableTowns, townPage, type Prose } from "./write";
import { cultureText, faithText, type WorldLore } from "./lore";

export interface BundleJournal {
  /** Stable key, so a re-import replaces instead of duplicating. */
  key: string;
  name: string;
  folder: string;
  pages: Array<{ name: string; html: string }>;
}

export interface BundlePin {
  key: string;
  x: number;
  y: number;
  label: string;
  icon: string;
  size: number;
  /** Journal key it opens. */
  journal: string;
  /** Show the label at every zoom (realms, capitals). */
  global?: boolean;
}

export interface WorldBundle {
  format: "gmm-world";
  version: 1;
  id: string;
  title: string;
  year: number;
  era: string;
  /** v: a fingerprint of the picture; the module refreshes an imported world map when it changes. */
  image: { file: string; width: number; height: number; v?: string };
  /** Scene grid: pixels per square and miles per square. */
  grid: { size: number; distance: number; units: string };
  folders: string[];
  journals: BundleJournal[];
  pins: BundlePin[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const paras = (text: string) => text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");
const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

export function buildBundle(az: AzWorld, w: AgedWorld, prose: Prose | undefined, o: { id: string; title: string; map: { width: number; height: number; scale: number; v?: string }; lore?: WorldLore }): WorldBundle {
  const n = namer(w);
  const cells = az.cells.map((c) => c.p);
  const line = (e: Parameters<typeof eventText>[0]) => eventText(e, n, cells);
  const S = o.map.scale;
  const lore = o.lore;
  const cultureBare = (i: number) => az.cultures.find((c) => c.i === i)?.name ?? "mixed";
  const culture = (i: number) => cultureText(lore, cultureBare(i));
  const faith = (i: number) => w.religions.find((r) => r.i === i)?.name ?? "none";
  // The DM's lore as pages: the Lord and the peoples (players can read these, like every page here).
  const lorePages = lore
    ? [{
      name: "The Lord and the peoples",
      html: (lore.lord ? `<h3>The Lord</h3>${paras(lore.lord)}` : "")
        + (lore.era ? `<p>${esc(`Years are counted ${lore.era.short}, ${lore.era.name}, from ${lore.era.from}.`)}</p>` : "")
        + (lore.world?.length ? list(lore.world) : "")
        + `<h3>Peoples</h3>` + (lore.peoples ? `<p>${esc(lore.peoples)}</p>` : "")
        + list(az.cultures.filter((c) => c.i > 0).map((c) => cultureText(lore, c.name)).concat(lore.humans ? [lore.humans] : [])),
    }]
    : [];
  const realmName = (id: number) => w.states.find((s) => s.id === id)?.fullName ?? "no realm";
  const journals: BundleJournal[] = [];
  const pins: BundlePin[] = [];
  const notable = new Set(notableTowns(w).map((b) => b.id));

  // The world: overview, the ages, the faiths.
  journals.push({
    key: "world", name: o.title, folder: "",
    pages: [
      { name: "Overview", html: paras(prose?.overview ?? `${w.name} in ${w.year} ${w.eraShort}.`) + `<h3>Realms</h3>` + list(w.states.filter((s) => s.alive).sort((a, b) => b.cells - a.cells).map((s) => `${s.fullName}, ruled from ${w.burgs.find((b) => b.id === s.capital)?.name ?? "nowhere"}`)) },
      ...lorePages,
      ...(prose?.ages ?? []).map((a) => ({ name: `${a.from}-${a.to}: ${a.title}`, html: paras(a.text) + `<h3>Events</h3>` + list(majorEvents(w, a.from, a.to).map(line)) })),
      {
        name: "Faiths", html: list([...new Set(w.cells.religion.filter((r, i) => w.cells.state[i]))].map((r) => {
          const rel = w.religions.find((x) => x.i === r);
          return rel ? `${faithText(lore, rel.name)}${rel.parent !== undefined ? `; split from ${faith(rel.parent)} in ${rel.founded}` : ""}` : "";
        }).filter(Boolean)),
      },
      { name: "Fallen realms", html: list(w.states.filter((s) => !s.alive).map((s) => `${n.realm(s.id, s.founded)} (${s.founded}-${s.ended}): ${prose?.fallen[s.id] ?? ""}`.trim())) },
    ],
  });

  // Realms: a pin on the capital's region, labelled with the realm.
  for (const s of w.states.filter((x) => x.alive)) {
    const r = prose?.realms[s.id];
    const cap = w.burgs.find((b) => b.id === s.capital);
    const towns = w.burgs.filter((b) => b.alive && b.state === s.id).sort((a, b) => b.population - a.population);
    journals.push({
      key: `realm-${s.id}`, name: s.fullName, folder: "Realms",
      pages: [
        {
          name: "Today", html: paras(r?.today ?? "") + list(s.invader
            ? [`Seat: ${cap?.name ?? "none"}`, `People of the land: ${peoplesOf(w, s).map((p) => cultureBare(p.culture)).join(", ")}`, ...(lore?.invader?.seen ? [`Seen in its ranks: ${lore.invader.seen}`] : []), `Came: ${s.founded}`, `Towns: ${towns.length}`]
            : [...(lore?.rulers?.[s.id] ? [`Ruler: ${lore.rulers[s.id]!.ruler}`] : []), `Capital: ${cap?.name ?? "none"}`, `People: ${culture(s.culture)}`, `Faith: ${faithText(lore, faith(s.religion))}`, `Founded: ${s.founded}${s.oldName ? ` (as ${s.oldName})` : ""}`, `Towns: ${towns.length}`]),
        },
        { name: "History", html: paras(r?.history ?? "") + `<h3>Chronicle</h3>` + list(realmEvents(w, s).map(line)) },
        { name: "Towns", html: list(towns.map((b) => `${b.name}, ${Math.round(b.population * 1000).toLocaleString("en")} people${b.walls ? ", walled" : ""}${b.port ? ", port" : ""}`)) },
      ],
    });
  }

  // Towns and ruins.
  const townPin = (b: AgedBurg): Pick<BundlePin, "icon" | "size"> => {
    // Small: the map already draws the town; the pin is only a handle under it.
    if (b.capital) return { icon: "icons/svg/castle.svg", size: 26 };
    if (b.kind === "fort") return { icon: "icons/svg/tower.svg", size: 18 };
    if (b.population >= 12) return { icon: "icons/svg/city.svg", size: 22 };
    if (b.population >= 3) return { icon: b.port ? "icons/svg/anchor.svg" : "icons/svg/village.svg", size: 20 };
    return { icon: "icons/svg/house.svg", size: 16 };
  };
  for (const b of w.burgs) {
    const key = `town-${b.id}`;
    if (b.alive) {
      const realm = w.states.find((s) => s.id === b.state);
      const facts = list([
        `${Math.round(b.population * 1000).toLocaleString("en")} people`, `Realm: ${realm?.fullName ?? "none"}${b.capital ? (realm?.invader ? " (its seat)" : " (capital)") : ""}`, `People: ${culture(b.culture)}`,
        [b.walls && "walled", b.citadel && "citadel", b.port && "port", b.river && "river", b.temple && "great temple", b.plaza && "market square"].filter(Boolean).join(", ") || "open town",
      ]);
      const link = `<p><a href="${esc(cityLink(b))}" target="_blank" rel="noopener">City Map</a></p>`;
      const text = notable.has(b.id) && prose?.towns[b.id] ? paras(prose.towns[b.id]!) + `<h3>Past</h3>` + list(w.events.filter((e) => e.burgs.includes(b.id)).map(line)) : paras(townPage(az, w, b));
      journals.push({ key, name: b.name, folder: b.population >= 3 || b.capital ? "Towns" : "Villages", pages: [{ name: b.name, html: `<h2>${esc(b.name)}</h2>${facts}${link}${text}` }] });
      // Just below the town's drawing (the art stands on the town's point).
      pins.push({ key, x: Math.round(b.x * S), y: Math.round(b.y * S + 4 * S + 14), label: b.name, journal: key, global: b.capital, ...townPin(b) });
    } else {
      const name = `Ruins of ${b.oldName ?? b.name}`;
      journals.push({ key, name, folder: "Ruins", pages: [{ name, html: paras(townPage(az, w, b)) }] });
      pins.push({ key, x: Math.round(b.x * S), y: Math.round(b.y * S + 4 * S + 10), label: name, journal: key, icon: "icons/svg/ruins.svg", size: 14 });
    }
  }
  // Battlefields.
  w.markers.filter((m) => m.type === "battlefields").forEach((m, i) => {
    const e = w.events.find((x) => x.kind === "battle" && x.cell === m.cell && x.year === m.year);
    const key = `battle-${i}`;
    const title = `Battle of ${n.near(m.cell, m.year ?? w.year, cells)}, ${m.year}`;
    journals.push({ key, name: title, folder: "Battlefields", pages: [{ name: title, html: `<p>${esc(e ? line(e) : title)}</p><p>${esc("Bones and broken iron still turn up under the plough.")}</p>` }] });
    pins.push({ key, x: Math.round(m.x * S), y: Math.round(m.y * S), label: title, journal: key, icon: "icons/svg/combat.svg", size: 14 });
  });
  // Realm labels as pins at each realm's middle.
  for (const s of w.states.filter((x) => x.alive)) {
    const own = az.cells.filter((c, i) => c.h >= 20 && w.cells.state[i] === s.id);
    if (!own.length) continue;
    const cx = own.reduce((t, c) => t + c.p[0], 0) / own.length, cy = own.reduce((t, c) => t + c.p[1], 0) / own.length;
    const at = own.sort((a, b) => Math.hypot(a.p[0] - cx, a.p[1] - cy) - Math.hypot(b.p[0] - cx, b.p[1] - cy))[0]!;
    pins.push({ key: `realm-${s.id}`, x: Math.round(at.p[0] * S), y: Math.round(at.p[1] * S + 60), label: s.fullName, journal: `realm-${s.id}`, icon: "icons/svg/book.svg", size: 24, global: true });
  }

  return {
    format: "gmm-world", version: 1, id: o.id, title: o.title, year: w.year, era: w.eraShort,
    image: { file: "map.webp", width: o.map.width, height: o.map.height, ...(o.map.v ? { v: o.map.v } : {}) },
    // One Azgaar pixel is az.kmPerPx km; a square of 100 image pixels.
    grid: { size: 100, distance: Math.round(((100 / S) * az.kmPerPx * 0.621) * 10) / 10, units: "mi" },
    folders: ["Realms", "Towns", "Villages", "Ruins", "Battlefields"],
    journals, pins,
  };
}
