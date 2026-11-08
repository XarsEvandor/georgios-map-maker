/**
 * Steering an aged world by hand: changes the DM asks for, laid over the rolled history after
 * it runs, so the dice and everything else stay as they were. A steer is plain JSON (a world's
 * steer.json), applied in order.
 *
 * "invasion": an outside power takes a block of land round a town, cutting across provinces
 * and borders the way a fresh conquest does. The towns it takes change hands as they stand: no
 * sacks, no renamings. The invaders get a realm of their own, seated in the largest town taken.
 */

import { isLand, type AzWorld } from "./azgaar";
import type { AgedState, AgedWorld } from "./history";

export interface InvasionSteer {
  kind: "invasion";
  /** The invaders' name, as the realm is shown. */
  name: string;
  /** A town's name (as in the aged world) or a cell id: the middle of the land taken. */
  at: string | number;
  /** Share of the realms' land taken (default 0.03). */
  share?: number;
  /** Year (default: the aged world's year, "a few months back"). */
  year?: number;
  color?: string;
}

export type Steer = InvasionSteer;

/** What a steer touched, so the build can rewrite only that prose. */
export interface SteerRecord {
  steer: Steer;
  realms: number[];
  towns: number[];
}

/** Applies steers in order to a copy of the world. */
export function applySteers(az: AzWorld, aged: AgedWorld, steers: Steer[]): AgedWorld & { steers: SteerRecord[] } {
  const w = structuredClone(aged) as AgedWorld & { steers: SteerRecord[] };
  w.steers = [];
  for (const s of steers) {
    if (s.kind === "invasion") w.steers.push(invade(az, w, s));
    else throw new Error(`unknown steer ${(s as { kind: string }).kind}`);
  }
  w.events.sort((a, b) => a.year - b.year);
  return w;
}

function invade(az: AzWorld, w: AgedWorld, o: InvasionSteer): SteerRecord {
  const C = az.cells;
  const year = o.year ?? w.year;
  const state = w.cells.state;
  const seat0 = typeof o.at === "number" ? undefined : w.burgs.find((b) => b.alive && b.name.toLowerCase() === o.at.toString().toLowerCase());
  const start = typeof o.at === "number" ? o.at : seat0?.cell;
  if (start === undefined || !C[start] || !isLand(C[start]!) || !state[start]) throw new Error(`invasion: no realm land at "${o.at}"`);
  const realmLand = state.filter((x, i) => x > 0 && isLand(C[i]!)).length;
  const want = Math.max(1, Math.round(realmLand * (o.share ?? 0.03)));
  // No realm's seat falls: the invaders hold a corner, not a crown.
  const capitals = new Set(w.burgs.filter((b) => b.alive && b.capital).map((b) => b.cell));
  if (capitals.has(start)) throw new Error(`invasion: "${o.at}" is a capital`);

  // The block: realm land nearest the middle, grown cell by cell so it stays in one piece.
  const [sx, sy] = C[start]!.p;
  const d = (i: number) => Math.hypot(C[i]!.p[0] - sx, C[i]!.p[1] - sy);
  const taken = new Set<number>([start]);
  const edge = new Set<number>(C[start]!.c);
  while (taken.size < want && edge.size) {
    let best = -1;
    for (const x of edge) if (best < 0 || d(x) < d(best)) best = x;
    edge.delete(best);
    if (!isLand(C[best]!) || !state[best] || capitals.has(best)) continue;
    taken.add(best);
    for (const n of C[best]!.c) if (!taken.has(n)) edge.add(n);
  }
  // Pockets of realm land left inside the block go with it.
  for (const x of [...edge]) if (isLand(C[x]!) && state[x] && !capitals.has(x) && C[x]!.c.every((n) => taken.has(n) || !isLand(C[n]!))) taken.add(x);

  const id = Math.max(...w.states.map((s) => s.id)) + 1;
  const towns = w.burgs.filter((b) => b.alive && taken.has(b.cell));
  const seat = [...towns].sort((a, b) => b.population - a.population)[0];
  const victims = new Map<number, number>();
  for (const x of taken) victims.set(state[x]!, (victims.get(state[x]!) ?? 0) + 1);
  const cultures = new Map<number, number>();
  for (const x of taken) cultures.set(w.cells.culture[x]!, (cultures.get(w.cells.culture[x]!) ?? 0) + 1);

  const realm: AgedState = {
    id, name: o.name, form: "", fullName: o.name,
    // The people under them are the land's own; the invaders' faith is unknown.
    culture: [...cultures].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0, religion: -1,
    capital: seat?.id ?? 0, color: o.color ?? "#2f7f86", founded: year, origin: "invasion", invader: true, alive: true, cells: taken.size,
  };
  w.states.push(realm);
  for (const [v, n] of victims) {
    const s = w.states.find((x) => x.id === v)!;
    s.cells -= n;
    const lost = towns.filter((b) => b.state === v).sort((a, b) => b.population - a.population);
    w.events.push({ year, kind: "invasion", states: [id, v], burgs: lost.map((b) => b.id), n });
  }
  for (const x of taken) state[x] = id;
  for (const b of towns) { b.state = id; b.capital = b.id === seat?.id; }

  // The block becomes a region of its own, cut out of the provinces it crosses.
  for (const r of w.regions) r.cells = r.cells.filter((x) => !taken.has(x));
  w.regions = w.regions.filter((r) => r.cells.length);
  w.regions.push({ id: Math.max(...w.regions.map((r) => r.id)) + 1, name: seat?.name ?? o.name, state: id, cells: [...taken] });
  return { steer: o, realms: [id, ...victims.keys()], towns: towns.map((b) => b.id) };
}
