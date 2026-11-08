/**
 * A thousand years of history over an Azgaar world, in 25-year steps. Deterministic for a seed.
 *
 * Constant war keeps the world medieval: neighbours fight most generations and take whole
 * provinces; big realms crack along provinces of other cultures; small kin realms join by
 * marriage; empty land is settled. Towns grow on roads, rivers and coasts, are sacked in war,
 * some burned for good, and new ones rise at good sites and as frontier forts. Walls go up where
 * the fighting is. Peoples take on their rulers' tongue and faith; churches split; forests are
 * cleared round the big towns. Every step is logged as dated events for the chronicle.
 */

import { Rng } from "../gen/rng";
import { isLand, type AzRoute, type AzWorld, type Pt } from "./azgaar";
import { drift, NameMaker } from "./names";

export type EventKind =
  | "war" | "battle" | "conquest" | "sack" | "razed" | "capital_lost" | "annexed" | "independence" | "union"
  | "colonize" | "founded" | "fort" | "walls" | "plague" | "schism" | "capital_moved" | "abandoned" | "partition" | "invasion";

export interface WorldEvent {
  year: number;
  kind: EventKind;
  /** States involved (winner first). */
  states: number[];
  /** Towns involved. */
  burgs: number[];
  /** A cell (battles). */
  cell?: number;
  /** Regions changing hands, people lost (thousands), etc. */
  n?: number;
  /** Religion involved (schisms: [old, new]). */
  religions?: number[];
}

export interface AgedState {
  id: number;
  name: string;
  form: string;
  fullName: string;
  culture: number;
  religion: number;
  capital: number;
  color: string;
  founded: number;
  ended?: number;
  origin: "old" | "rebellion" | "union" | "invasion";
  /** Came from outside the map (a steer): nothing is known of them but their name. */
  invader?: boolean;
  /** The realm it broke from (rebellions). */
  parent?: number;
  /** Original Azgaar name (old states). */
  oldName?: string;
  alive: boolean;
  cells: number;
}

export interface AgedBurg {
  id: number;
  name: string;
  /** The name in the start year (old towns). */
  oldName?: string;
  cell: number;
  x: number;
  y: number;
  culture: number;
  state: number;
  /** Thousands. */
  population: number;
  capital: boolean;
  port: boolean;
  river: boolean;
  coast: boolean;
  /** Direction of the sea for the city generator, 0..2 (fraction of a half turn). */
  sea?: number;
  walls: boolean;
  citadel: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  /** Trade routes through the town. */
  hub: boolean;
  founded?: number;
  ruined?: number;
  alive: boolean;
  /** Seed for the city generator. */
  seed: number;
  kind: "town" | "fort";
}

export interface AgedReligion {
  i: number;
  name: string;
  type: string;
  /** The church it split from. */
  parent?: number;
  founded?: number;
}

export interface AgedRegion {
  id: number;
  name: string;
  oldName?: string;
  state: number;
  cells: number[];
}

export interface AgedMarker {
  type: string;
  icon: string;
  x: number;
  y: number;
  cell: number;
  /** Ruins: the town; battlefields: the year. */
  burg?: number;
  year?: number;
}

export interface AgedWorld {
  name: string;
  startYear: number;
  year: number;
  eraShort: string;
  seed: string;
  /** Per cell, by cell id. */
  cells: { state: number[]; culture: number[]; religion: number[]; biome: number[]; pop: number[] };
  states: AgedState[];
  burgs: AgedBurg[];
  religions: AgedReligion[];
  regions: AgedRegion[];
  routes: AzRoute[];
  markers: AgedMarker[];
  events: WorldEvent[];
}

export interface AgeOptions {
  years?: number;
  step?: number;
  seed?: string;
  /** Chance per generation that two neighbours fight (default 0.45: constant war). */
  war?: number;
}

const FOREST = new Set([5, 6, 7, 8, 9]);
const KEEP_MARKERS = new Set(["volcanoes", "hot-springs", "water-sources", "mines", "bridges", "lighthouses", "waterfalls", "dungeons", "lake-monsters", "sea-monsters", "hill-monsters", "sacred-forests", "statues", "ruins", "caves", "portals", "rifts", "necropolises", "battlefields", "libraries"]);
const PALETTE = ["#c9744f", "#5f8fb4", "#9a7bb5", "#6fa36b", "#c4a24a", "#b85c6e", "#4f9c9a", "#a3885f", "#7f7fb8", "#b5794a", "#5e9e7a", "#a85d8f", "#8a9a3d", "#c26a3a", "#4c7fa8", "#9c6b52"];

/** The city generator's coast direction: where the nearest open water lies, as a fraction of a half turn (0..2). */
export function seaDirection(w: AzWorld, cell: number): number | undefined {
  const c = w.cells[cell];
  if (!c) return undefined;
  const water = c.c.map((n) => w.cells[n]!).filter((n) => n && n.h < 20);
  if (!water.length) return undefined;
  const dx = water.reduce((s, n) => s + n.p[0] - c.p[0], 0), dy = water.reduce((s, n) => s + n.p[1] - c.p[1], 0);
  const a = Math.atan2(dy, dx);
  // Measured a quarter turn round from screen x, as Azgaar writes it (checked against 43 real links).
  return Math.round(((((a / Math.PI - 0.5) % 2) + 2) % 2) * 100) / 100;
}

export function ageWorld(w: AzWorld, opts: AgeOptions = {}): AgedWorld {
  const years = opts.years ?? 1000, step = opts.step ?? 25, warP = opts.war ?? 0.45;
  const rng = new Rng(`age:${opts.seed ?? w.seed}`);
  const C = w.cells;
  const N = C.length;
  const land = C.map(isLand);
  const state = C.map((c) => (land[c.i] ? c.state : 0));
  const culture = C.map((c) => c.culture);
  const religion = C.map((c) => c.religion);
  const biome = C.map((c) => c.biome);
  const pop = C.map((c) => c.pop);
  const names = new NameMaker(w.nameBases);
  names.reserve(...w.burgs.map((b) => b.name), ...w.states.map((s) => s.name), ...w.provinces.map((p) => p.name));
  const baseOf = (cult: number) => w.cultures.find((c) => c.i === cult)?.base ?? w.cultures[1]?.base ?? 0;
  const events: WorldEvent[] = [];
  const log = (e: WorldEvent) => events.push(e);
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // Routes through each cell: trade.
  const trade = new Array<number>(N).fill(0);
  const routes: AzRoute[] = w.routes.map((r) => ({ ...r, points: r.points.map((p) => [...p] as [number, number, number]) }));
  for (const r of routes) for (const p of r.points) if (r.group !== "trails") trade[p[2]] = (trade[p[2]] ?? 0) + 1;

  // Regions: the provinces, plus clusters of unclaimed land. Wars and rebellions move whole regions.
  const region = new Array<number>(N).fill(0);
  const regions = new Map<number, { id: number; name: string; cells: number[] }>();
  for (const p of w.provinces) regions.set(p.i, { id: p.i, name: p.name, cells: [] });
  for (const c of C) if (land[c.i] && c.province && regions.has(c.province)) { region[c.i] = c.province; regions.get(c.province)!.cells.push(c.i); }
  let nextRegion = Math.max(0, ...w.provinces.map((p) => p.i)) + 1;
  for (const c of C) {
    if (!land[c.i] || region[c.i]) continue;
    const id = nextRegion++;
    const reg = { id, name: "", cells: [] as number[] };
    regions.set(id, reg);
    const queue = [c.i];
    region[c.i] = id;
    while (queue.length && reg.cells.length < 25) {
      const x = queue.shift()!;
      reg.cells.push(x);
      for (const n of C[x]!.c) if (land[n] && !region[n] && state[n] === state[c.i] && !C[n]!.province) { region[n] = id; queue.push(n); }
    }
    for (const x of queue) region[x] = 0;
  }
  // Leftover cells (queue overflow) join a neighbouring region.
  for (let pass = 0; pass < 5; pass++) for (const c of C) if (land[c.i] && !region[c.i]) { const n = c.c.find((x) => region[x]); if (n !== undefined) { region[c.i] = region[n]!; regions.get(region[n]!)!.cells.push(c.i); } }
  const regionNeighbours = new Map<number, Set<number>>();
  for (const c of C) {
    if (!land[c.i]) continue;
    for (const n of c.c) if (land[n] && region[n] !== region[c.i]) (regionNeighbours.get(region[c.i]!) ?? regionNeighbours.set(region[c.i]!, new Set()).get(region[c.i]!)!).add(region[n]!);
  }
  const regionState = (r: number) => state[regions.get(r)!.cells[0]!] ?? 0;
  const setRegionState = (r: number, s: number) => { for (const x of regions.get(r)!.cells) state[x] = s; };

  // Towns.
  const seedBase = Number(String(w.seed).replace(/\D/g, "").slice(0, 9)) || 1;
  const burgs: AgedBurg[] = w.burgs.map((b) => {
    const c = C[b.cell]!;
    const coast = !!b.port || (c.t === 1 && (C[c.haven]?.h ?? 100) < 20);
    return {
      id: b.i, name: b.name, oldName: b.name, cell: b.cell, x: b.x, y: b.y, culture: b.culture, state: b.state, population: b.population,
      capital: !!b.capital, port: !!b.port, river: c.r > 0, coast, sea: coast ? seaDirection(w, b.cell) : undefined,
      walls: !!b.walls, citadel: !!b.citadel, plaza: !!b.plaza, temple: !!b.temple, shanty: !!b.shanty, hub: trade[b.cell]! >= 3,
      alive: true, seed: seedBase * 10000 + b.i, kind: "town",
    };
  });
  let nextBurg = Math.max(0, ...burgs.map((b) => b.id)) + 1;
  const burgAt = new Map<number, AgedBurg>();
  for (const b of burgs) burgAt.set(b.cell, b);
  const aliveBurgs = () => burgs.filter((b) => b.alive);
  const burgsIn = (r: number) => regions.get(r)!.cells.map((x) => burgAt.get(x)).filter((b): b is AgedBurg => !!b && b.alive);

  // States.
  const states: AgedState[] = w.states.filter((s) => s.i > 0).map((s, k) => ({
    id: s.i, name: s.name, oldName: s.name, form: s.form ?? "", fullName: s.fullName ?? s.name, culture: s.culture, religion: 0, capital: s.capital,
    color: PALETTE[k % PALETTE.length]!, founded: w.year, origin: "old", alive: true, cells: 0,
  }));
  const expansion = new Map(w.states.map((s) => [s.i, s.expansionism]));
  let nextState = Math.max(0, ...states.map((s) => s.id)) + 1;
  const st = (id: number) => states.find((s) => s.id === id);
  const regionsOf = (s: number) => [...regions.keys()].filter((r) => regionState(r) === s);
  const capitalOf = (s: AgedState) => burgs.find((b) => b.id === s.capital && b.alive);
  const largest = (list: AgedBurg[]) => [...list].sort((a, b) => b.population - a.population)[0];
  const majority = (vals: number[]) => {
    const m = new Map<number, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  };
  const regionCulture = (r: number) => majority(regions.get(r)!.cells.map((x) => culture[x]!).filter((c) => c > 0));

  const newState = (year: number, culture0: number, rs: number[], origin: "rebellion" | "union", parent?: number): AgedState => {
    const cap = largest(rs.flatMap(burgsIn));
    const s: AgedState = {
      id: nextState++, name: names.coin(baseOf(culture0), rng), form: "", fullName: "", culture: culture0, religion: 0, capital: cap?.id ?? 0,
      color: PALETTE[(nextState * 5) % PALETTE.length]!, founded: year, origin, parent, alive: true, cells: 0,
    };
    states.push(s);
    expansion.set(s.id, rng.range(1, 2.5));
    for (const r of rs) setRegionState(r, s.id);
    for (const b of rs.flatMap(burgsIn)) b.capital = b.id === s.capital;
    return s;
  };

  const loseRegion = (year: number, r: number, from: AgedState, to: AgedState, warlike: boolean) => {
    setRegionState(r, to.id);
    for (const b of burgsIn(r)) {
      b.state = to.id;
      if (!warlike) continue;
      if (rng.next() < 0.22) {
        const before = b.population;
        b.population *= rng.range(0.65, 0.9);
        if (b.population < 0.5 && !b.walls && rng.next() < 0.3) {
          b.alive = false;
          b.ruined = year;
          log({ year, kind: "razed", states: [to.id, from.id], burgs: [b.id] });
        } else log({ year, kind: "sack", states: [to.id, from.id], burgs: [b.id], n: Math.round((before - b.population) * 1000) });
      }
    }
    if (from.capital && burgsIn(r).some((b) => b.id === from.capital)) {
      const old = from.capital;
      const rest = regionsOf(from.id).flatMap(burgsIn);
      const next = largest(rest);
      for (const b of burgs) if (b.id === old) b.capital = false;
      if (next) {
        from.capital = next.id;
        next.capital = true;
        log({ year, kind: "capital_lost", states: [to.id, from.id], burgs: [old, next.id] });
      } else from.capital = 0;
    }
    if (!regionsOf(from.id).length) {
      from.alive = false;
      from.ended = year;
      log({ year, kind: "annexed", states: [to.id, from.id], burgs: [] });
    }
  };

  for (let year = w.year + step; year <= w.year + years; year += step) {
    const alive = states.filter((s) => s.alive);
    const strength = new Map<number, number>();
    for (const s of alive) {
      const rs = regionsOf(s.id);
      const people = rs.reduce((t, r) => t + regions.get(r)!.cells.reduce((u, x) => u + pop[x]!, 0), 0) + rs.flatMap(burgsIn).reduce((t, b) => t + b.population * 1.5, 0);
      // Big realms overreach: their armies spread thin.
      const reach = rs.length > 8 ? (8 / rs.length) ** 0.9 : 1;
      strength.set(s.id, people * reach * (1 + (expansion.get(s.id) ?? 1) * 0.15) * rng.range(0.6, 1.4));
    }
    const atWar = new Set<number>();
    const contested = new Set<number>();

    // Wars between neighbours.
    const pairs: Array<[number, number]> = [];
    for (const [r, ns] of regionNeighbours) {
      const a = regionState(r);
      if (!a) continue;
      for (const n of ns) {
        const b = regionState(n);
        if (b && b !== a && a < b && !pairs.some(([x, y]) => x === a && y === b)) pairs.push([a, b]);
      }
    }
    for (const [a, b] of rng.shuffle(pairs)) {
      const A = st(a)!, B = st(b)!;
      if (!A.alive || !B.alive || rng.next() > warP) continue;
      const sa = strength.get(a) ?? 1, sb = strength.get(b) ?? 1;
      const pA = sa / (sa + sb);
      const [win, lose] = rng.next() < pA ? [A, B] : [B, A];
      atWar.add(a).add(b);
      const margin = Math.abs(pA - 0.5);
      const front = regionsOf(lose.id).filter((r) => [...(regionNeighbours.get(r) ?? [])].some((n) => regionState(n) === win.id));
      for (const r of front) contested.add(r);
      // A border cell between them, for the battle.
      const borderCell = front.flatMap((r) => regions.get(r)!.cells).find((x) => C[x]!.c.some((n) => state[n] === win.id));
      let k = rng.next() < 0.25 ? 0 : 1 + (rng.next() < margin * 1.5 ? 1 : 0) + (margin > 0.3 && rng.next() < 0.5 ? 1 : 0);
      const taken: number[] = [];
      for (const r of rng.shuffle(front)) {
        if (k-- <= 0) break;
        // The last region with the capital falls only to a crushing win.
        if (regionsOf(lose.id).length === 1 && margin < 0.25) break;
        taken.push(r);
      }
      log({ year, kind: "war", states: [win.id, lose.id], burgs: [], n: taken.length });
      if (borderCell !== undefined && (taken.length >= 2 || rng.next() < 0.35)) log({ year, kind: "battle", states: [win.id, lose.id], burgs: [], cell: borderCell });
      for (const r of taken) {
        const held = burgsIn(r);
        log({ year, kind: "conquest", states: [win.id, lose.id], burgs: held.map((b) => b.id), n: r });
        loseRegion(year, r, lose, win, true);
        if (!lose.alive) break;
      }
      // Both sides bleed along the front.
      for (const r of front) for (const x of regions.get(r)!.cells) pop[x]! *= 0.95;
    }

    // Rebellions: big or mixed realms crack.
    for (const s of states.filter((x) => x.alive)) {
      const rs = regionsOf(s.id);
      if (rs.length < 4) continue;
      const cultures = new Set(rs.map(regionCulture));
      const p = Math.min(0.6, 0.05 + 0.05 * (cultures.size - 1) + 0.02 * (rs.length - 4));
      if (rng.next() > p) continue;
      const capRegion = rs.find((r) => burgsIn(r).some((b) => b.id === s.capital));
      // Distance in regions from the capital.
      const depth = new Map<number, number>();
      if (capRegion !== undefined) {
        depth.set(capRegion, 0);
        const q = [capRegion];
        while (q.length) {
          const r = q.shift()!;
          for (const n of regionNeighbours.get(r) ?? []) if (regionState(n) === s.id && !depth.has(n)) { depth.set(n, depth.get(r)! + 1); q.push(n); }
        }
      }
      const candidates = rs.filter((r) => r !== capRegion).sort((x, y) => (depth.get(y) ?? 9) + (regionCulture(y) !== s.culture ? 2 : 0) - ((depth.get(x) ?? 9) + (regionCulture(x) !== s.culture ? 2 : 0)));
      const seedR = candidates[0];
      if (seedR === undefined) continue;
      const cult = regionCulture(seedR) || s.culture;
      const set = [seedR];
      const want = Math.max(1, Math.min(8, Math.floor(rs.length / 3)));
      for (let i = 0; i < set.length && set.length < want; i++) for (const n of regionNeighbours.get(set[i]!) ?? []) if (set.length < want && regionState(n) === s.id && n !== capRegion && !set.includes(n) && (regionCulture(n) === cult || rng.next() < 0.3)) set.push(n);
      if (!set.flatMap(burgsIn).length) continue;
      const rebel = newState(year, cult, set, "rebellion", s.id);
      for (const b of set.flatMap(burgsIn)) b.state = rebel.id;
      log({ year, kind: "independence", states: [rebel.id, s.id], burgs: rebel.capital ? [rebel.capital] : [], n: set.length });
    }

    // Civil war: a realm grown past a third of the land splits in two, the far provinces under a rival claimant.
    const landCount = land.filter(Boolean).length;
    for (const s of states.filter((x) => x.alive)) {
      const rs = regionsOf(s.id);
      const share = rs.reduce((t, r) => t + regions.get(r)!.cells.length, 0) / landCount;
      if (share < 0.3 || rng.next() > 0.3) continue;
      const capRegion = rs.find((r) => burgsIn(r).some((b) => b.id === s.capital)) ?? rs[0]!;
      // The region farthest from the capital seeds the rival half.
      const depth = new Map<number, number>([[capRegion, 0]]);
      const q = [capRegion];
      while (q.length) {
        const r = q.shift()!;
        for (const n of regionNeighbours.get(r) ?? []) if (regionState(n) === s.id && !depth.has(n)) { depth.set(n, depth.get(r)! + 1); q.push(n); }
      }
      const far = [...depth].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (far === undefined || far === capRegion) continue;
      const half: number[] = [far];
      const goal = Math.floor(rs.length * rng.range(0.35, 0.5));
      for (let i = 0; i < half.length && half.length < goal; i++) {
        for (const n of regionNeighbours.get(half[i]!) ?? []) if (half.length < goal && regionState(n) === s.id && n !== capRegion && !half.includes(n) && (depth.get(n) ?? 0) >= (depth.get(half[i]!) ?? 0) - 1) half.push(n);
      }
      if (half.length < 3 || !half.flatMap(burgsIn).length) continue;
      const cult = majority(half.map(regionCulture).filter((c) => c > 0)) || s.culture;
      const rival = newState(year, cult, half, "rebellion", s.id);
      for (const b of half.flatMap(burgsIn)) b.state = rival.id;
      log({ year, kind: "partition", states: [rival.id, s.id], burgs: rival.capital ? [rival.capital] : [], n: half.length });
    }

    // Unions: small realms of one people join by marriage or treaty.
    const small = states.filter((s) => s.alive && regionsOf(s.id).length <= 3);
    for (const a of small) for (const b of small) {
      if (!a.alive || !b.alive || a.id >= b.id || a.culture !== b.culture || rng.next() > 0.06) continue;
      const touching = regionsOf(a.id).some((r) => [...(regionNeighbours.get(r) ?? [])].some((n) => regionState(n) === b.id));
      if (!touching) continue;
      const [big, lesser] = (strength.get(a.id) ?? 0) >= (strength.get(b.id) ?? 0) ? [a, b] : [b, a];
      for (const r of regionsOf(lesser.id)) loseRegion(year, r, lesser, big, false);
      for (const bb of burgs) if (bb.state === lesser.id) bb.capital = false;
      lesser.alive = false;
      lesser.ended = year;
      log({ year, kind: "union", states: [big.id, lesser.id], burgs: [] });
    }

    // A realm left without a single town is swallowed by a neighbour.
    for (const s of states.filter((x) => x.alive)) {
      const rs = regionsOf(s.id);
      if (!rs.length || rs.flatMap(burgsIn).length) continue;
      const nb = [...new Set(rs.flatMap((r) => [...(regionNeighbours.get(r) ?? [])].map(regionState)))].filter((x) => x > 0 && x !== s.id && st(x)?.alive);
      if (!nb.length) continue;
      const taker = st(rng.pick(nb))!;
      for (const r of rs) loseRegion(year, r, s, taker, false);
    }

    // Settlers claim empty land next to a realm.
    for (const r of regions.keys()) {
      if (regionState(r) !== 0) continue;
      const claimants = [...(regionNeighbours.get(r) ?? [])].map(regionState).filter((s) => s > 0);
      if (!claimants.length || rng.next() > 0.3) continue;
      const s = st(rng.pick(claimants))!;
      setRegionState(r, s.id);
      for (const b of burgsIn(r)) b.state = s.id;
      log({ year, kind: "colonize", states: [s.id], burgs: burgsIn(r).map((b) => b.id), n: r });
    }

    // Plague: rides the roads and sea lanes out of a big port.
    if (rng.next() < 0.12) {
      const ports = aliveBurgs().filter((b) => b.port || b.population > 5);
      if (ports.length) {
        const origin = rng.weighted(ports, (b) => b.population);
        let lost = 0;
        const hit: number[] = [];
        for (const b of aliveBurgs()) {
          if (dist([b.x, b.y], [origin.x, origin.y]) > 260) continue;
          const before = b.population;
          b.population *= rng.range(0.55, 0.8);
          lost += before - b.population;
          hit.push(b.id);
        }
        for (const c of C) if (land[c.i] && dist(c.p, [origin.x, origin.y]) < 260) pop[c.i]! *= 0.8;
        log({ year, kind: "plague", states: [state[origin.cell] ?? 0], burgs: [origin.id, ...hit.filter((h) => h !== origin.id)], n: Math.round(lost * 1000) });
      }
    }

    // Growth.
    for (const b of aliveBurgs()) {
      // A medieval city outgrows its food and its water: growth stalls towards a hundred thousand.
      let g = 0.013 + 0.012 * Math.min(3, trade[b.cell] ?? 0) / 3 + (b.port ? 0.01 : 0) + (b.river ? 0.006 : 0) + (b.capital ? 0.015 : 0) + rng.range(-0.04, 0.045) - Math.max(0, b.population - 20) / 1200;
      if (contested.has(region[b.cell]!)) g -= 0.06;
      b.population = Math.max(0.05, b.population * (1 + g));
      if (b.population < 0.12 && rng.next() < 0.5) {
        b.alive = false;
        b.ruined = year;
        log({ year, kind: "abandoned", states: [b.state], burgs: [b.id] });
      }
    }
    for (const c of C) if (land[c.i]) pop[c.i]! *= contested.has(region[c.i]!) ? 0.97 : 1.01;

    // New towns at good sites; forts on contested borders.
    const sites = rng.shuffle(C.filter((c) => land[c.i] && state[c.i] > 0 && (w.biomes.habitability[biome[c.i]!] ?? 0) > 0)).slice(0, 220);
    const scored = sites.map((c) => ({ c, score: pop[c.i]! + 3 * Math.min(2, trade[c.i] ?? 0) + (c.r ? 2 : 0) + (c.t === 1 && c.harbor ? 2 : 0) + (contested.has(region[c.i]!) ? 2 : 0) + rng.range(0, 2) }))
      .sort((a, b) => b.score - a.score);
    let founded = 0;
    const want = rng.int(1, 4);
    for (const { c } of scored) {
      if (founded >= want) break;
      if (burgs.some((b) => dist([b.x, b.y], c.p) < 34)) continue;
      const fort = contested.has(region[c.i]!) && rng.next() < 0.6;
      const s = st(state[c.i]!)!;
      const cult = culture[c.i] || s.culture;
      const coast = c.t === 1 && (C[c.haven]?.h ?? 100) < 20;
      const b: AgedBurg = {
        id: nextBurg, name: names.coin(baseOf(cult), rng), cell: c.i, x: c.p[0], y: c.p[1], culture: cult, state: s.id,
        population: fort ? rng.range(0.25, 0.6) : rng.range(0.4, 1.2), capital: false, port: coast && c.harbor > 0 && rng.next() < 0.5, river: c.r > 0, coast,
        sea: coast ? seaDirection(w, c.i) : undefined, walls: fort, citadel: fort, plaza: false, temple: false, shanty: false, hub: (trade[c.i] ?? 0) >= 3,
        founded: year, alive: true, seed: seedBase * 10000 + nextBurg, kind: fort ? "fort" : "town",
      };
      nextBurg++;
      burgs.push(b);
      burgAt.set(c.i, b);
      founded++;
      log({ year, kind: fort ? "fort" : "founded", states: [s.id], burgs: [b.id] });
    }

    // Walls where the fighting is; markets, temples and slums as towns grow.
    for (const b of aliveBurgs()) {
      const front = contested.has(region[b.cell]!);
      if (!b.walls && b.population >= 1.5 && ((front && rng.next() < 0.35) || rng.next() < 0.03)) { b.walls = true; log({ year, kind: "walls", states: [b.state], burgs: [b.id] }); }
      if (!b.citadel && b.capital && b.population >= 4 && rng.next() < 0.3) b.citadel = true;
      if (!b.plaza && b.population >= 2.5 && rng.next() < 0.1) b.plaza = true;
      if (!b.temple && b.population >= 3 && rng.next() < 0.08) b.temple = true;
      if (!b.shanty && b.population >= 15 && rng.next() < 0.1) b.shanty = true;
    }

    // A capital moves to a much greater city.
    for (const s of states.filter((x) => x.alive)) {
      const cap = capitalOf(s);
      const best = largest(regionsOf(s.id).flatMap(burgsIn));
      if (!best || best === cap) continue;
      if (!cap || (best.population > cap.population * 2.5 && rng.next() < 0.15)) {
        if (cap) cap.capital = false;
        best.capital = true;
        s.capital = best.id;
        if (cap) log({ year, kind: "capital_moved", states: [s.id], burgs: [cap.id, best.id] });
      }
    }

    // Peoples take on their rulers' tongue and faith.
    for (const s of states.filter((x) => x.alive)) {
      const capCell = capitalOf(s)?.cell;
      s.religion = capCell !== undefined ? religion[capCell]! : s.religion;
    }
    for (const c of C) {
      if (!land[c.i] || !state[c.i]) continue;
      const s = st(state[c.i]!)!;
      if (culture[c.i] !== s.culture && rng.next() < 0.035) culture[c.i] = s.culture;
      if (s.religion && religion[c.i] !== s.religion && rng.next() < 0.04) religion[c.i] = s.religion;
    }
    for (const b of aliveBurgs()) b.culture = culture[b.cell] || b.culture;

    // Schisms: a church spread across realms splits along a border.
    if (rng.next() < 0.05) {
      const counts = new Map<number, Set<number>>();
      for (const c of C) if (land[c.i] && religion[c.i] && state[c.i]) (counts.get(religion[c.i]!) ?? counts.set(religion[c.i]!, new Set()).get(religion[c.i]!)!).add(state[c.i]!);
      const wide = [...counts].filter(([r, ss]) => ss.size >= 2 && w.religions.find((x) => x.i === r)?.type === "Organized" || (ss.size >= 3 && r > 0));
      if (wide.length) {
        const [old, ss] = rng.pick(wide);
        const breakaway = st(rng.pick([...ss]))!;
        const neu = 1000 + events.filter((e) => e.kind === "schism").length + 1;
        for (const c of C) if (state[c.i] === breakaway.id && religion[c.i] === old) religion[c.i] = neu;
        breakaway.religion = neu;
        log({ year, kind: "schism", states: [breakaway.id], burgs: [], religions: [old, neu] });
      }
    }

    // Forests cleared round the big towns, fens drained.
    for (const b of aliveBurgs()) {
      if (b.population < 3) continue;
      const ring = new Set([b.cell, ...C[b.cell]!.c]);
      for (const x of [...ring]) for (const n of C[x]!.c) ring.add(n);
      for (const x of ring) {
        if (FOREST.has(biome[x]!) && rng.next() < 0.05) biome[x] = 4;
        else if (biome[x] === 12 && b.population >= 5 && rng.next() < 0.03) biome[x] = 4;
      }
    }

    // Roads: every century, each capital gets a road to its great towns.
    if ((year - w.year) % 100 === 0) {
      for (const s of states.filter((x) => x.alive)) {
        const cap = capitalOf(s);
        if (!cap) continue;
        const targets = regionsOf(s.id).flatMap(burgsIn).filter((b) => b !== cap && b.population >= 3 && !(trade[b.cell]! > 0 && trade[cap.cell]! > 0)).sort((a, b) => dist([a.x, a.y], [cap.x, cap.y]) - dist([b.x, b.y], [cap.x, cap.y])).slice(0, 2);
        for (const t of targets) {
          const path = landPath(w, land, cap.cell, t.cell);
          if (!path) continue;
          routes.push({ i: routes.length, group: "roads", points: path.map((x) => [C[x]!.p[0], C[x]!.p[1], x]) });
          for (const x of path) trade[x] = (trade[x] ?? 0) + 1;
        }
      }
    }
  }

  // ---- The world as it stands: names, forms, regions, markers. ----
  const finalYear = w.year + years;
  // Shanty towns only round the great walled cities: the city generator's slums multiply a plan's
  // buildings five-fold. (A last pass, so the dice above roll the same as before.)
  for (const b of burgs) if (b.shanty && !(b.walls && b.population >= 30)) b.shanty = false;
  const totalLand = land.filter(Boolean).length;
  for (const s of states) {
    s.cells = state.filter((x) => x === s.id).length;
    if (s.origin === "old") s.name = drift(s.oldName ?? s.name, rng, 2);
  }
  const aliveStates = states.filter((s) => s.alive);
  for (const s of aliveStates) {
    const share = s.cells / totalLand;
    const cap = capitalOf(s);
    const holy = s.religion >= 1000 || (w.religions.find((r) => r.i === s.religion)?.type === "Organized" && rng.next() < 0.15);
    s.form = share >= 0.25 ? "Empire" : share >= 0.12 ? (holy ? "Holy Kingdom" : "Kingdom") : share >= 0.05 ? rng.pick(["Duchy", "Principality", "Grand Duchy"]) : share >= 0.02 ? rng.pick(["County", "March", "Barony"]) : cap && cap.population >= 5 ? "Free City" : "Lordship";
    // "March of March": a title that repeats the name takes another.
    if (s.form.toLowerCase() === s.name.toLowerCase()) s.form = share >= 0.12 ? "Kingdom" : "Duchy";
    s.fullName = s.form === "Free City" ? `Free City of ${cap!.name}` : `${s.form} of ${s.name}`;
  }
  for (const b of burgs) {
    if (b.founded) {
      if (finalYear - b.founded > 500) b.name = drift(b.name, rng, 1);
      continue;
    }
    const roll = rng.next();
    const changed = b.culture !== (w.burgs.find((x) => x.i === b.id)?.culture ?? b.culture);
    if (changed && roll < 0.35) b.name = names.coin(baseOf(b.culture), rng);
    else if (roll < 0.85 || b.population > 15) b.name = drift(b.name, rng, b.population > 15 ? 1 : rng.int(1, 3));
  }
  for (const s of aliveStates) if (s.form === "Free City") s.fullName = `Free City of ${capitalOf(s)?.name ?? s.name}`;

  const outRegions: AgedRegion[] = [...regions.values()].filter((r) => r.cells.length).map((r) => {
    const town = largest(burgsIn(r.id));
    const name = r.name ? drift(r.name, rng, 2) : town?.name ?? names.coin(baseOf(regionCulture(r.id)), rng);
    return { id: r.id, name, oldName: r.name || undefined, state: regionState(r.id), cells: r.cells };
  });

  const markers: AgedMarker[] = w.markers.filter((m) => KEEP_MARKERS.has(m.type)).map((m) => ({ type: m.type, icon: m.icon, x: m.x, y: m.y, cell: m.cell }));
  for (const b of burgs) if (!b.alive) markers.push({ type: "ruins", icon: "🏚️", x: b.x, y: b.y, cell: b.cell, burg: b.id, year: b.ruined });
  // The great battles: those that moved two regions or more, at most 24.
  const battles = events.filter((e) => e.kind === "battle" && e.cell !== undefined);
  for (const e of rng.shuffle(battles).slice(0, 24)) markers.push({ type: "battlefields", icon: "⚔️", x: C[e.cell!]!.p[0], y: C[e.cell!]!.p[1], cell: e.cell!, year: e.year });

  const religions: AgedReligion[] = w.religions.map((r) => ({ i: r.i, name: r.name, type: r.type ?? "Folk" }));
  for (const e of events.filter((x) => x.kind === "schism")) {
    const [old, neu] = e.religions!;
    const s = st(e.states[0]!)!;
    const x = names.coin(baseOf(s.culture), rng);
    religions.push({ i: neu!, name: rng.pick([`${x}ism`, `Church of ${x}`, `Way of ${x}`, `${x} Rite`]), type: "Organized", parent: old, founded: e.year });
  }

  return {
    name: w.name, startYear: w.year, year: finalYear, eraShort: w.eraShort, seed: String(opts.seed ?? w.seed),
    cells: { state, culture, religion, biome, pop },
    states, burgs, religions, regions: outRegions, routes, markers, events,
  };
}

/** Cheapest land path between two cells (hills cost more). */
function landPath(w: AzWorld, land: boolean[], from: number, to: number): number[] | undefined {
  const C = w.cells;
  const cost = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = [from];
  while (open.length) {
    open.sort((a, b) => cost.get(a)! - cost.get(b)!);
    const x = open.shift()!;
    if (x === to) break;
    for (const n of C[x]!.c) {
      if (!land[n]) continue;
      const c = cost.get(x)! + 1 + Math.max(0, C[n]!.h - 40) / 15;
      if (c < (cost.get(n) ?? Infinity)) {
        cost.set(n, c);
        prev.set(n, x);
        open.push(n);
      }
    }
  }
  if (!prev.has(to)) return undefined;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]!)!);
  return path.reverse();
}

/** The city generator link for a town, built the way Azgaar builds its own. */
export function cityLink(b: AgedBurg): string {
  const people = Math.max(100, Math.round(b.population * 1000));
  const size = Math.max(6, Math.min(100, Math.round(people ** 0.375)));
  const q = new URLSearchParams({
    name: b.name, population: String(people), size: String(size), seed: String(b.seed), river: b.river ? "1" : "0", coast: b.coast ? "1" : "0",
    farms: "1", citadel: b.citadel ? "1" : "0", urban_castle: b.citadel && b.capital && b.walls ? "1" : "0", hub: b.hub ? "true" : "false",
    plaza: b.plaza ? "1" : "0", temple: b.temple ? "1" : "0", walls: b.walls ? "1" : "0", shantytown: b.shanty ? "1" : "0", gates: "-1",
  });
  if (b.coast && b.sea !== undefined) q.set("sea", String(b.sea));
  return `https://watabou.github.io/city-generator/?${q.toString()}`;
}
