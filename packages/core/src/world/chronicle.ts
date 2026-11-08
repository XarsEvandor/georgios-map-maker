/**
 * Plain dated lines from an aged world's event log, for the prose writer and for the town and
 * realm pages. Names follow the time: towns and old realms go by their old names in the first
 * half of the age, by their new ones after.
 */

import type { AgedBurg, AgedState, AgedWorld, WorldEvent } from "./history";

export interface Namer {
  town(id: number, year: number): string;
  realm(id: number, year: number): string;
  region(id: number, year: number): string;
  religion(id: number): string;
  /** The town nearest a cell, by its name at the time. */
  near(cell: number, year: number, cells: Array<[number, number]>): string;
}

export function namer(w: AgedWorld): Namer {
  const mid = w.startYear + (w.year - w.startYear) / 2;
  const town = new Map(w.burgs.map((b) => [b.id, b]));
  const realm = new Map(w.states.map((s) => [s.id, s]));
  const region = new Map(w.regions.map((r) => [r.id, r]));
  return {
    town: (id, year) => { const b = town.get(id); return b ? (year < mid && b.oldName ? b.oldName : b.name) : "a lost town"; },
    realm: (id, year) => { const s = realm.get(id); return s ? (year < mid && s.oldName ? s.oldName : s.name) : "the wild lands"; },
    region: (id, year) => { const r = region.get(id); return r ? (year < mid && r.oldName ? r.oldName : r.name) : "a province"; },
    religion: (id) => w.religions.find((r) => r.i === id)?.name ?? "a faith",
    near: (cell, year, cells) => {
      const p = cells[cell];
      if (!p) return "the border";
      let best: AgedBurg | undefined, bd = Infinity;
      for (const b of w.burgs) { const d = Math.hypot(b.x - p[0], b.y - p[1]); if (d < bd && (!b.founded || b.founded <= year)) { bd = d; best = b; } }
      return best ? (year < mid && best.oldName ? best.oldName : best.name) : "the border";
    },
  };
}

/** One event as a sentence. `cells` gives cell centres (for battles). */
export function eventText(e: WorldEvent, n: Namer, cells: Array<[number, number]>): string {
  const y = e.year;
  const A = e.states[0] !== undefined ? n.realm(e.states[0], y) : "", B = e.states[1] !== undefined ? n.realm(e.states[1], y) : "";
  const T = (i = 0) => (e.burgs[i] !== undefined ? n.town(e.burgs[i]!, y) : "");
  const towns = e.burgs.map((b) => n.town(b, y));
  switch (e.kind) {
    case "war": return e.n ? `${y}: ${A} defeated ${B} and took ${e.n} ${e.n === 1 ? "province" : "provinces"}.` : `${y}: ${A} and ${B} fought a border war that moved no borders.`;
    case "battle": return `${y}: ${A} beat ${B} in battle near ${n.near(e.cell ?? -1, y, cells)}.`;
    case "conquest": return `${y}: ${A} took ${n.region(e.n ?? -1, y)} from ${B}${towns.length ? ` (${listOf(towns)})` : ""}.`;
    case "sack": return `${y}: ${A} sacked ${T()}${e.n ? `; about ${round(e.n)} people died or fled` : ""}.`;
    case "razed": return `${y}: ${A} burned ${T()} to the ground. It was never rebuilt.`;
    case "capital_lost": return `${y}: ${A} captured ${T()}, capital of ${B}; its court moved to ${T(1)}.`;
    case "annexed": return `${y}: ${B} came to an end, swallowed by ${A}.`;
    case "independence": return `${y}: ${A} broke away from ${B}${e.n ? ` with ${e.n} ${e.n === 1 ? "province" : "provinces"}` : ""}${T() ? `, ruled from ${T()}` : ""}.`;
    case "partition": return `${y}: civil war split ${B}; a rival claimant ruled ${e.n} provinces as ${A}${T() ? ` from ${T()}` : ""}.`;
    case "union": return `${y}: ${B} joined ${A} by marriage and treaty.`;
    case "colonize": return `${y}: settlers from ${A} claimed empty land${towns.length ? ` round ${listOf(towns)}` : ""}.`;
    case "founded": return `${y}: ${T()} was founded in ${A}.`;
    case "fort": return `${y}: ${A} built the fort of ${T()} on its contested border.`;
    case "walls": return `${y}: ${T()} raised stone walls.`;
    case "plague": return `${y}: plague spread out of ${T()} through ${e.burgs.length} towns; about ${round(e.n ?? 0)} died.`;
    case "schism": return `${y}: ${n.religion(e.religions?.[1] ?? -1)} split from ${n.religion(e.religions?.[0] ?? -1)} in ${A}.`;
    case "capital_moved": return `${y}: ${A} moved its capital from ${T()} to ${T(1)}.`;
    case "abandoned": return `${y}: the last people left ${T()}.`;
    case "invasion": return `${y}: the ${A} invaded ${B} and took ${towns.length ? `the land round ${listOf(towns)}` : "a stretch of its land"}.`;
  }
}

function listOf(xs: string[]): string {
  const u = [...new Set(xs)];
  if (u.length <= 3) return u.join(", ");
  return `${u.slice(0, 3).join(", ")} and ${u.length - 3} more`;
}

function round(people: number): string {
  if (people >= 10000) return `${Math.round(people / 1000)} thousand`;
  if (people >= 1000) return `${(people / 1000).toFixed(1)} thousand`;
  return String(Math.round(people / 10) * 10);
}

/** The peoples of a realm's land, most first: cells held and people in its towns (thousands). */
export function peoplesOf(w: AgedWorld, s: AgedState): Array<{ culture: number; cells: number; townsfolk: number }> {
  const m = new Map<number, { culture: number; cells: number; townsfolk: number }>();
  const get = (c: number) => m.get(c) ?? m.set(c, { culture: c, cells: 0, townsfolk: 0 }).get(c)!;
  w.cells.state.forEach((x, i) => { if (x === s.id) get(w.cells.culture[i]!).cells++; });
  for (const b of w.burgs) if (b.alive && b.state === s.id) get(b.culture).townsfolk += b.population;
  return [...m.values()].sort((a, b) => b.cells + b.townsfolk - (a.cells + a.townsfolk));
}

/** The events that touch a town, oldest first. */
export function townEvents(w: AgedWorld, b: AgedBurg): WorldEvent[] {
  return w.events.filter((e) => e.burgs.includes(b.id) && !(e.kind === "conquest" && e.burgs.length > 3));
}

/** The events that touch a realm, oldest first. */
export function realmEvents(w: AgedWorld, s: AgedState): WorldEvent[] {
  return w.events.filter((e) => e.states.includes(s.id) && e.kind !== "walls" && e.kind !== "founded" && e.kind !== "sack");
}

/** The important events in a span of years (no walls, foundings or single sacks). */
export function majorEvents(w: AgedWorld, from: number, to: number): WorldEvent[] {
  const big = new Set(["war", "conquest", "capital_lost", "annexed", "independence", "partition", "union", "plague", "schism", "razed", "capital_moved", "invasion"]);
  // The last age runs to the present year inclusive.
  return w.events.filter((e) => e.year >= from && (e.year < to || (to === w.year && e.year === to)) && big.has(e.kind) && !(e.kind === "war" && !e.n));
}
