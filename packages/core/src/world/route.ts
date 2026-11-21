/**
 * Travel on the world map: the shortest way between two towns along the world's roads, trails and
 * sea lanes (Azgaar's routes, kept in the aged world), how long each stretch is, the towns, realms
 * and terrain it passes, and the way by land only when the shortest one takes a boat. Lengths come
 * from the map's own scale. Town names are matched loosely ("narkoc", "Narkóc"), and a name that
 * matches no town gets the nearest names back as suggestions.
 */

/** The parts of an aged world (aged.json) a route needs. */
export interface RouteWorld {
  burgs: Array<{ id: number; name: string; cell: number; x: number; y: number; state: number; population?: number; capital?: boolean; port?: boolean; alive?: boolean } | null>;
  routes: Array<{ group: string; points: Array<[number, number, number]> }>;
  cells: { state: number[]; biome: number[] };
  states: Array<{ id: number; name: string; fullName?: string } | null>;
}

/** Azgaar's default biomes, by id. */
export const BIOMES = ["sea", "hot desert", "cold desert", "savanna", "grassland", "tropical seasonal forest", "temperate deciduous forest", "tropical rainforest", "temperate rainforest", "taiga", "tundra", "glacier", "wetland"];

export type LegKind = "road" | "trail" | "sea" | "open ground";
const KIND: Record<string, LegKind> = { roads: "road", trails: "trail", searoutes: "sea" };

export interface RouteLeg {
  kind: LegKind;
  miles: number;
  /** The towns at the stretch's ends, where a town stands there. */
  from?: string;
  to?: string;
}

export interface Route {
  from: string;
  to: string;
  miles: number;
  straightMiles: number;
  legs: RouteLeg[];
  byKind: Partial<Record<LegKind, number>>;
  /** Towns the way passes through, in order (not its ends). */
  towns: string[];
  /** Realms crossed, in order. */
  realms: string[];
  /** Miles of each terrain, most first. */
  terrain: Array<{ terrain: string; miles: number }>;
  /** The way in world-map pixels, for drawing it, and the kind of each step between two points. */
  points: Array<[number, number]>;
  steps: LegKind[];
}

export interface Scale {
  /** World-map pixels per Azgaar unit (map.json "scale"). */
  pxPerUnit: number;
  /** Miles per world-map pixel (bundle grid: distance / size). */
  milesPerPx: number;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

const likeness = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/** The town a name means, or the nearest names when it is not clear. */
export function findTown(w: RouteWorld, name: string): { town?: NonNullable<RouteWorld["burgs"][number]>; suggestions: string[] } {
  const q = norm(name);
  const towns = w.burgs.filter((b): b is NonNullable<typeof b> => !!b && !!b.name);
  // Of namesakes, a living town before ruins, then the biggest.
  const exact = towns.filter((b) => norm(b.name) === q).sort((a, b) => Number(b.alive !== false) - Number(a.alive !== false) || (b.population ?? 0) - (a.population ?? 0));
  if (exact.length) return { town: exact[0], suggestions: [] };
  const scored = towns.map((b) => ({ b, s: Math.max(likeness(q, norm(b.name)), norm(b.name).startsWith(q) && q.length >= 4 ? 0.9 : 0) })).sort((x, y) => y.s - x.s);
  const [best, second] = scored;
  // The nearest names, even loose ones: the assistant (or the GM) knows which was meant.
  const suggestions = [...new Set(scored.filter((x) => x.s >= 0.2).map((x) => x.b.name))].slice(0, 5);
  if (best && best.s >= 0.8 && (!second || best.s - second.s >= 0.1)) return { town: best.b, suggestions };
  return { suggestions };
}

class Heap {
  private a: Array<[number, number]> = [];
  get size() {
    return this.a.length;
  }
  push(item: [number, number]) {
    const a = this.a;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

interface Edge {
  to: number;
  miles: number;
  kind: LegKind;
}

/** The network: cells joined by the routes' stretches; a town off every route walks to the nearest point on one. */
function network(w: RouteWorld, s: Scale, land: boolean) {
  const edges = new Map<number, Edge[]>();
  const pos = new Map<number, [number, number]>();
  const milesPerUnit = s.pxPerUnit * s.milesPerPx;
  const add = (a: number, b: number, miles: number, kind: LegKind) => {
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a)!.push({ to: b, miles, kind });
  };
  for (const r of w.routes) {
    const kind = KIND[r.group] ?? "road";
    if (land && kind === "sea") continue;
    for (let i = 1; i < r.points.length; i++) {
      const [x1, y1, c1] = r.points[i - 1]!;
      const [x2, y2, c2] = r.points[i]!;
      if (c1 === c2) continue;
      pos.set(c1, [x1, y1]);
      pos.set(c2, [x2, y2]);
      const miles = Math.hypot(x2 - x1, y2 - y1) * milesPerUnit;
      add(c1, c2, miles, kind);
      add(c2, c1, miles, kind);
    }
  }
  return { edges, pos, milesPerUnit };
}

/** The shortest way between two towns; land: never by sea. Null when they are the same town. */
export function findRoute(w: RouteWorld, a: NonNullable<RouteWorld["burgs"][number]>, b: NonNullable<RouteWorld["burgs"][number]>, s: Scale, o: { land?: boolean } = {}): Route | null {
  if (a.id === b.id) return null;
  const { edges, pos, milesPerUnit } = network(w, s, !!o.land);
  // A town no route touches walks over open ground to one of the nearest points of the network
  // (the four nearest, so it never has to walk away from where it is going).
  for (const t of [a, b]) {
    if (edges.has(t.cell)) {
      pos.set(t.cell, pos.get(t.cell) ?? [t.x, t.y]);
      continue;
    }
    const near = [...pos].filter(([c]) => c !== t.cell && edges.has(c)).map(([c, [x, y]]) => ({ c, d: Math.hypot(x - t.x, y - t.y) })).sort((p, q) => p.d - q.d).slice(0, 4);
    pos.set(t.cell, [t.x, t.y]);
    const add = (p: number, q: number, d: number) => (edges.get(p) ?? edges.set(p, []).get(p)!).push({ to: q, miles: d * milesPerUnit, kind: "open ground" });
    for (const n of near) {
      add(t.cell, n.c, n.d);
      add(n.c, t.cell, n.d);
    }
  }
  const dist = new Map<number, number>([[a.cell, 0]]);
  const prev = new Map<number, { from: number; edge: Edge }>();
  const heap = new Heap();
  heap.push([0, a.cell]);
  const done = new Set<number>();
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === b.cell) break;
    for (const e of edges.get(u) ?? []) {
      const nd = d + e.miles;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, edge: e });
        heap.push([nd, e.to]);
      }
    }
  }
  const straightMiles = Math.hypot(a.x - b.x, a.y - b.y) * milesPerUnit;
  // No way along the network: straight over open ground.
  const steps: Array<{ from: number; to: number; edge: Edge }> = [];
  if (dist.has(b.cell)) {
    for (let c = b.cell; prev.has(c);) {
      const p = prev.get(c)!;
      steps.unshift({ from: p.from, to: c, edge: p.edge });
      c = p.from;
    }
  } else {
    steps.push({ from: a.cell, to: b.cell, edge: { to: b.cell, miles: straightMiles, kind: "open ground" } });
  }
  const townAt = new Map(w.burgs.filter((x): x is NonNullable<typeof x> => !!x).map((x) => [x.cell, x.alive === false ? `${x.name} (ruins)` : x.name]));
  const legs: RouteLeg[] = [];
  const byKind: Partial<Record<LegKind, number>> = {};
  const terrain = new Map<string, number>();
  const realms: string[] = [];
  const towns: string[] = [];
  const stateName = (id: number) => w.states.find((x) => x?.id === id)?.name;
  for (const st of steps) {
    const kind = st.edge.kind;
    byKind[kind] = (byKind[kind] ?? 0) + st.edge.miles;
    const last = legs.at(-1);
    if (last && last.kind === kind) {
      last.miles += st.edge.miles;
      last.to = townAt.get(st.to);
    } else legs.push({ kind, miles: st.edge.miles, from: townAt.get(st.from), to: townAt.get(st.to) });
    const ground = kind === "sea" ? "sea" : BIOMES[w.cells.biome[st.from] ?? -1] ?? "unknown";
    terrain.set(ground, (terrain.get(ground) ?? 0) + st.edge.miles);
    const realm = stateName(w.cells.state[st.to] ?? 0);
    if (realm && realms.at(-1) !== realm) realms.push(realm);
    const town = townAt.get(st.to);
    if (town && st.to !== b.cell && towns.at(-1) !== town) towns.push(town);
  }
  const firstRealm = stateName(w.cells.state[a.cell] ?? 0);
  if (firstRealm && realms[0] !== firstRealm) realms.unshift(firstRealm);
  // A leg that starts nowhere named starts where the one before it ended.
  for (let i = 0; i < legs.length; i++) legs[i]!.from ??= i ? legs[i - 1]!.to : a.name;
  if (legs.length) legs.at(-1)!.to = b.name;
  const px = (c: number): [number, number] => {
    const [x, y] = pos.get(c) ?? [a.x, a.y];
    return [Math.round(x * s.pxPerUnit), Math.round(y * s.pxPerUnit)];
  };
  return {
    from: a.name, to: b.name, miles: dist.get(b.cell) ?? straightMiles, straightMiles, legs, byKind,
    towns, realms,
    terrain: [...terrain].sort((x, y) => y[1] - x[1]).map(([t, miles]) => ({ terrain: t, miles })),
    points: [px(a.cell), ...steps.map((st) => px(st.to))],
    steps: steps.map((st) => st.edge.kind),
  };
}

const mi = (n: number) => `${Math.round(n)} mi`;

/** The route in plain words, for the GM's assistant. */
export function routeText(r: Route, land?: Route | null): string {
  const lines = [
    `${r.from} to ${r.to}: ${mi(r.miles)} by the shortest way (${mi(r.straightMiles)} in a straight line).`,
    `Stretches, in order: ${r.legs.map((l) => `${l.kind} ${mi(l.miles)}${l.from && l.to ? ` (${l.from} to ${l.to})` : ""}`).join("; ")}.`,
    `In all: ${Object.entries(r.byKind).map(([k, v]) => `${k} ${mi(v!)}`).join(", ")}.`,
    r.towns.length ? `Towns on the way: ${r.towns.join(", ")}.` : "No towns on the way.",
    r.realms.length ? `Realms: ${r.realms.join(", then ")}.` : "",
    r.terrain.length ? `Terrain: ${r.terrain.map((t) => `${t.terrain} ${mi(t.miles)}`).join(", ")}.` : "",
  ];
  if (land && r.byKind.sea) {
    lines.push(`By land only (no boat): ${mi(land.miles)}: ${Object.entries(land.byKind).map(([k, v]) => `${k} ${mi(v!)}`).join(", ")}${land.towns.length ? `, through ${land.towns.join(", ")}` : ""}.`);
  }
  return lines.filter(Boolean).join("\n");
}
