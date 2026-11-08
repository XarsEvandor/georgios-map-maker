/**
 * Azgaar's Fantasy Map Generator "full JSON" export, read into a plain model: Voronoi cells
 * (height, biome, people, borders), towns ("burgs"), states, provinces, cultures, religions,
 * rivers, routes, markers and the name bases each culture names things from.
 */

import type { Pt } from "../city/city";

export type { Pt };

export interface AzCell {
  i: number;
  /** Centre (map pixels). */
  p: Pt;
  /** Corner vertex ids, in order. */
  v: number[];
  /** Neighbour cell ids. */
  c: number[];
  /** Height 0-100; land from 20. */
  h: number;
  area: number;
  /** Feature id (ocean, lake, island). */
  f: number;
  /** Distance to coast: 1 on the shore, negative in water. */
  t: number;
  /** Nearest water cell for a harbour, and harbour quality. */
  haven: number;
  harbor: number;
  /** River id running through, 0 for none. */
  r: number;
  biome: number;
  /** Rural population, thousands. */
  pop: number;
  culture: number;
  religion: number;
  state: number;
  province: number;
  burg: number;
}

export interface AzBurg {
  i: number;
  cell: number;
  x: number;
  y: number;
  name: string;
  culture: number;
  state: number;
  capital: number;
  port: number;
  /** Thousands. */
  population: number;
  citadel: number;
  plaza: number;
  walls: number;
  shanty: number;
  temple: number;
  type: string;
  group?: string;
  feature: number;
}

export interface AzState {
  i: number;
  name: string;
  culture: number;
  capital: number;
  color: string;
  form?: string;
  formName?: string;
  fullName?: string;
  expansionism: number;
  type?: string;
}

export interface AzProvince {
  i: number;
  state: number;
  center: number;
  burg: number;
  name: string;
  formName?: string;
  fullName?: string;
  color?: string;
}

export interface AzCulture {
  i: number;
  name: string;
  base: number;
  type?: string;
  color?: string;
  center?: number;
}

export interface AzReligion {
  i: number;
  name: string;
  type?: string;
  form?: string;
  culture?: number;
  deity?: string;
  expansionism?: number;
  color?: string;
  center?: number;
}

export interface AzRiver {
  i: number;
  name: string;
  type: string;
  cells: number[];
  width: number;
  discharge: number;
  mouth: number;
  source: number;
}

export interface AzRoute {
  i: number;
  group: "roads" | "trails" | "searoutes" | string;
  /** [x, y, cell] triples. */
  points: Array<[number, number, number]>;
}

export interface AzMarker {
  i: number;
  type: string;
  icon: string;
  x: number;
  y: number;
  cell: number;
}

export interface AzNameBase {
  i: number;
  name: string;
  min: number;
  max: number;
  /** Letters allowed to double. */
  d: string;
  /** Chance of multi-word names. */
  m: number;
  names: string[];
}

export interface AzWorld {
  name: string;
  /** Map size in Azgaar pixels. */
  width: number;
  height: number;
  /** Kilometres per map pixel. */
  kmPerPx: number;
  year: number;
  era: string;
  eraShort: string;
  seed: string;
  cells: AzCell[];
  vertices: Pt[];
  /** The (up to three) cells meeting at each vertex; ids past the last cell are off the map. */
  vertexCells: number[][];
  burgs: AzBurg[];
  states: AzState[];
  provinces: AzProvince[];
  cultures: AzCulture[];
  religions: AzReligion[];
  rivers: AzRiver[];
  routes: AzRoute[];
  markers: AzMarker[];
  nameBases: AzNameBase[];
  biomes: { name: string[]; color: string[]; habitability: number[] };
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Reads an Azgaar full JSON export (File > Export > JSON, "full"). Throws on anything else. */
export function parseAzgaar(json: unknown): AzWorld {
  const j = json as Record<string, any>;
  const pack = j?.pack;
  if (!pack || !Array.isArray(pack.cells) || !Array.isArray(pack.burgs)) throw new Error("not an Azgaar full JSON export (no pack.cells / pack.burgs)");
  const opts = j.settings?.options ?? {};
  const cells: AzCell[] = pack.cells.map((c: any) => ({
    i: num(c.i), p: [num(c.p?.[0]), num(c.p?.[1])] as Pt, v: (c.v ?? []).map(Number), c: (c.c ?? []).map(Number),
    h: num(c.h), area: num(c.area), f: num(c.f), t: num(c.t), haven: num(c.haven), harbor: num(c.harbor), r: num(c.r),
    biome: num(c.biome), pop: num(c.pop), culture: num(c.culture), religion: num(c.religion), state: num(c.state), province: num(c.province), burg: num(c.burg),
  }));
  const vertices: Pt[] = (pack.vertices ?? []).map((v: any) => [num(v?.p?.[0]), num(v?.p?.[1])] as Pt);
  const vertexCells: number[][] = (pack.vertices ?? []).map((v: any) => (v?.c ?? []).map(Number));
  const burgs: AzBurg[] = pack.burgs.filter((b: any) => b && b.i && !b.removed).map((b: any) => ({
    i: num(b.i), cell: num(b.cell), x: num(b.x), y: num(b.y), name: String(b.name ?? ""), culture: num(b.culture), state: num(b.state),
    capital: num(b.capital), port: num(b.port), population: num(b.population), citadel: num(b.citadel), plaza: num(b.plaza), walls: num(b.walls),
    shanty: num(b.shanty), temple: num(b.temple), type: String(b.type ?? "Generic"), group: b.group, feature: num(b.feature),
  }));
  const states: AzState[] = (pack.states ?? []).filter((s: any) => s && !s.removed).map((s: any) => ({
    i: num(s.i), name: String(s.name ?? ""), culture: num(s.culture), capital: num(s.capital), color: String(s.color ?? "#999999"),
    form: s.form, formName: s.formName, fullName: s.fullName, expansionism: num(s.expansionism, 1), type: s.type,
  }));
  const provinces: AzProvince[] = (pack.provinces ?? []).filter((p: any) => p && p.i && !p.removed).map((p: any) => ({
    i: num(p.i), state: num(p.state), center: num(p.center), burg: num(p.burg), name: String(p.name ?? ""), formName: p.formName, fullName: p.fullName, color: p.color,
  }));
  const cultures: AzCulture[] = (pack.cultures ?? []).filter((c: any) => c && !c.removed).map((c: any) => ({ i: num(c.i), name: String(c.name), base: num(c.base), type: c.type, color: c.color, center: c.center }));
  const religions: AzReligion[] = (pack.religions ?? []).filter((r: any) => r && !r.removed).map((r: any) => ({
    i: num(r.i), name: String(r.name), type: r.type, form: r.form, culture: r.culture, deity: r.deity, expansionism: num(r.expansionism, 1), color: r.color, center: r.center,
  }));
  const rivers: AzRiver[] = (pack.rivers ?? []).filter((r: any) => r && r.i).map((r: any) => ({
    i: num(r.i), name: String(r.name ?? ""), type: String(r.type ?? "River"), cells: (r.cells ?? []).map(Number), width: num(r.width), discharge: num(r.discharge), mouth: num(r.mouth), source: num(r.source),
  }));
  const routes: AzRoute[] = (pack.routes ?? []).filter((r: any) => r && Array.isArray(r.points)).map((r: any) => ({ i: num(r.i), group: String(r.group ?? "roads"), points: r.points.map((q: any) => [num(q[0]), num(q[1]), num(q[2])]) }));
  const markers: AzMarker[] = (pack.markers ?? []).map((m: any) => ({ i: num(m.i), type: String(m.type ?? ""), icon: String(m.icon ?? ""), x: num(m.x), y: num(m.y), cell: num(m.cell) }));
  const nameBases: AzNameBase[] = (j.nameBases ?? []).map((b: any, i: number) => ({
    i: num(b.i, i), name: String(b.name ?? ""), min: num(b.min, 4), max: num(b.max, 10), d: String(b.d ?? ""), m: num(b.m), names: String(b.b ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }));
  return {
    name: String(j.info?.mapName ?? j.settings?.mapName ?? "World"),
    width: num(j.info?.width, 1920), height: num(j.info?.height, 1080),
    kmPerPx: num(j.settings?.distanceScale, 1),
    year: num(opts.year, 0), era: String(opts.era ?? ""), eraShort: String(opts.eraShort ?? ""), seed: String(j.info?.seed ?? j.grid?.seed ?? "0"),
    cells, vertices, vertexCells, burgs, states, provinces, cultures, religions, rivers, routes, markers, nameBases,
    biomes: { name: j.biomesData?.name ?? [], color: j.biomesData?.color ?? [], habitability: (j.biomesData?.habitability ?? []).map(Number) },
  };
}

/** A cell's outline (map pixels). */
export function cellPolygon(w: AzWorld, cell: AzCell): Pt[] {
  return cell.v.map((v) => w.vertices[v]!).filter(Boolean);
}

export const isLand = (c: AzCell) => c.h >= 20;

/**
 * Cell edges where `split(a, b)` holds between the two cells on either side (b is -1 off the map),
 * chained into polylines of vertex ids. Each edge is visited once.
 */
export function edgeLines(w: AzWorld, split: (a: number, b: number) => boolean): number[][] {
  const N = w.cells.length;
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const c of w.cells) {
    const v = c.v;
    for (let k = 0; k < v.length; k++) {
      const a = v[k]!, b = v[(k + 1) % v.length]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      const other = (w.vertexCells[a] ?? []).find((x) => x !== c.i && (w.vertexCells[b] ?? []).includes(x));
      const o = other === undefined || other >= N ? -1 : other;
      if (!split(c.i, o)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  // Chain edges that share vertices into polylines.
  const at = new Map<number, number[]>();
  edges.forEach(([a, b], i) => { (at.get(a) ?? at.set(a, []).get(a)!).push(i); (at.get(b) ?? at.set(b, []).get(b)!).push(i); });
  const used = new Array<boolean>(edges.length).fill(false);
  const lines: number[][] = [];
  const walk = (start: number, from: number) => {
    const line = [from];
    let cur = from, e = start;
    while (e >= 0 && !used[e]) {
      used[e] = true;
      const [a, b] = edges[e]!;
      cur = a === cur ? b : a;
      line.push(cur);
      e = (at.get(cur) ?? []).find((x) => !used[x]) ?? -1;
    }
    return line;
  };
  // Open ends first, so lines don't start mid-way; then the closed loops.
  for (const [v, list] of at) if (list.length === 1 && !used[list[0]!]) lines.push(walk(list[0]!, v));
  edges.forEach(([a], i) => { if (!used[i]) lines.push(walk(i, a)); });
  return lines;
}
