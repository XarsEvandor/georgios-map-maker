/**
 * Architect: turns the plan's zones into a building. Rooms get target areas from their
 * type (rooms.ts); a scored search over many candidate floor plans picks one whose rooms
 * have sensible sizes and proportions, touch the rooms they connect to, and reach the
 * outside where they need to. Small rooms may become annexes, which gives L, T and U
 * shaped buildings. Walls, doors and windows are derived from a cell grid, so any
 * rectilinear outline works. Units are grid squares.
 */

import type { Connection, ScenePlan, Side, Zone } from "./plan";
import type { Rng } from "./rng";
import { specOf, targetArea, type RoomSpec } from "./rooms";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Segment {
  a: [number, number];
  b: [number, number];
}

export interface DoorPlacement {
  /** Door center in squares, on a wall. */
  at: [number, number];
  /** Wall the door sits on: "outer" (the building outline) or an interior wall index. */
  wall: "outer" | number;
  between: [string, string];
  /** Unit vector along the wall. */
  dir: [number, number];
  /** Width in squares. */
  width?: number;
  /** The building's main entrance. */
  main?: boolean;
  /** A gate: wide double door with a frame; its leaves are drawn by Foundry so they can swing. */
  gate?: boolean;
  /** Foundry door state. */
  state?: "closed" | "locked" | "open";
  /** Blown apart: an open gap with wreckage of this kind. */
  broken?: "medieval" | "scifi";
  /** Connection id from the plan. */
  conn?: string;
}

export interface WindowPlacement {
  at: [number, number];
  dir: [number, number];
  zone: string;
  width: number;
}

export type LayoutZone = Zone & { rect: Rect; outdoor?: boolean };

export interface Layout {
  map: { w: number; h: number };
  /** Bounding box of the building (w = 0 when there is none). */
  building: Rect;
  /** Building outline, clockwise, in squares (empty when there is no building). */
  outline: Array<[number, number]>;
  zones: LayoutZone[];
  interiorWalls: Segment[];
  doors: DoorPlacement[];
  windows: WindowPlacement[];
  /** Which sides of each indoor zone face the outside. */
  exterior: Record<string, Side[]>;
  /** Side of the building that faces the road. */
  front: Side;
  /** Stretches of the outer wall that have collapsed (ruined buildings). */
  breaches?: Segment[];
  /** Zones that did not fit (map too small); they are left out. */
  dropped?: string[];
  /** Spine plans: the corridor zone and the direction you walk along it from the entrance. */
  spine?: { zone: string; walk: [number, number] };
  /** Enclosed buildings: outside the walls is unseen darkness except this approach in front of the entrance. */
  approach?: Rect;
}

/**
 * Ground under a roof (or underground) in squares, where the weather stays out. A `hole` cuts
 * open sky out of the other shapes.
 */
export interface Shelter {
  points: Array<[number, number]>;
  hole?: boolean;
}

/**
 * Where the weather stays out of a building map: the building, or for an enclosed one (part of
 * a castle or a dungeon) everything but the approach.
 */
export function shelterOf(layout: Layout): Shelter[] {
  const box = (r: Rect): Array<[number, number]> => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  if (layout.approach) return [{ points: box({ x: 0, y: 0, w: layout.map.w, h: layout.map.h }) }, { points: box(layout.approach), hole: true }];
  if (layout.outline.length < 3) return [];
  return [{ points: layout.outline.map(([x, y]) => [x, y] as [number, number]) }];
}

const SIDES: Side[] = ["north", "east", "south", "west"];
/** Width of a gate's frame art over its opening (features.ts GATE_ARTS). */
export const GATE_FRAME_RATIO = 1.75;
const OUTWARD: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

interface Prog {
  zone: Zone;
  spec: RoomSpec;
  area: number;
}

interface Candidate {
  rects: Map<string, Rect>;
  score: number;
}

/** Splits a rectangle among zones by area (squarified-ish recursive slicing). */
function slice(rect: Rect, zs: Prog[], rng: Rng, out: Map<string, Rect>): boolean {
  if (zs.length === 1) {
    out.set(zs[0]!.zone.id, rect);
    return true;
  }
  const total = zs.reduce((s, z) => s + z.area, 0);
  // Pick the split point whose area ratio is closest to a half, with a little noise.
  let best = 1, bestD = Infinity, acc = 0;
  for (let k = 1; k < zs.length; k++) {
    acc += zs[k - 1]!.area;
    const d = Math.abs(acc / total - 0.5) + rng.range(0, 0.12);
    if (d < bestD) { bestD = d; best = k; }
  }
  const A = zs.slice(0, best), B = zs.slice(best);
  const ratio = A.reduce((s, z) => s + z.area, 0) / total;
  const prefer = rect.w > rect.h ? true : rect.w < rect.h ? false : rng.next() < 0.5;
  const order = rng.next() < 0.15 ? [!prefer, prefer] : [prefer, !prefer];
  for (const vert of order) {
    const len = vert ? rect.w : rect.h;
    const minA = Math.max(...A.map((z) => z.spec.minSide)), minB = Math.max(...B.map((z) => z.spec.minSide));
    let cut = Math.round(len * ratio);
    cut = Math.max(minA, Math.min(len - minB, cut));
    if (cut < minA || len - cut < minB) continue;
    const [ra, rb]: [Rect, Rect] = vert
      ? [{ x: rect.x, y: rect.y, w: cut, h: rect.h }, { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }]
      : [{ x: rect.x, y: rect.y, w: rect.w, h: cut }, { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut }];
    return slice(ra, A, rng, out) && slice(rb, B, rng, out);
  }
  return false;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Length of the edge two rects share (0 when they don't touch). */
export function sharedLength(a: Rect, b: Rect): number {
  if (a.x + a.w === b.x || b.x + b.w === a.x) return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  if (a.y + a.h === b.y || b.y + b.h === a.y) return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  return 0;
}

function bbox(rects: Iterable<Rect>): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Side of a rect's edges that touch the building outline. */
function exteriorSides(r: Rect, all: Rect[]): Side[] {
  const sides: Side[] = [];
  const touches = (side: Side) => {
    // An edge faces outside where no other rect lies right beyond it.
    const probe: Rect = side === "north" ? { x: r.x, y: r.y - 1, w: r.w, h: 1 }
      : side === "south" ? { x: r.x, y: r.y + r.h, w: r.w, h: 1 }
      : side === "west" ? { x: r.x - 1, y: r.y, w: 1, h: r.h }
      : { x: r.x + r.w, y: r.y, w: 1, h: r.h };
    // Count covered cells along the probe.
    const len = side === "north" || side === "south" ? r.w : r.h;
    let covered = 0;
    for (const o of all) if (o !== r && overlaps(o, probe)) {
      covered += side === "north" || side === "south"
        ? Math.min(o.x + o.w, probe.x + probe.w) - Math.max(o.x, probe.x)
        : Math.min(o.y + o.h, probe.y + probe.h) - Math.max(o.y, probe.y);
    }
    return len - covered >= 2;
  };
  for (const s of SIDES) if (touches(s)) sides.push(s);
  return sides;
}

function candidate(prog: Prog[], conns: Connection[], avail: { w: number; h: number }, rng: Rng): Candidate | undefined {
  const sorted = [...prog].sort((a, b) => b.area - a.area);
  const largest = sorted[0]!.area;
  const annex: Prog[] = [];
  for (const p of [...sorted.slice(1)].reverse()) {
    if (annex.length < 2 && sorted.length - annex.length > 1 && p.area <= largest * 0.45 && rng.next() < 0.35) annex.push(p);
  }
  const main = sorted.filter((p) => !annex.includes(p));
  // Plan order with the big rooms first, lightly shuffled.
  const order = main.length > 2 && rng.next() < 0.6 ? [main[0]!, ...rng.shuffle(main.slice(1))] : rng.shuffle([...main]);
  const mainArea = main.reduce((s, p) => s + p.area, 0);
  // Main block proportions; a dominant long room (a nave) sets them.
  const lead = main[0]!;
  const r = lead.spec.minAspect && lead.area >= mainArea * 0.6 ? rng.range(lead.spec.minAspect, Math.min(lead.spec.maxAspect, 2.3)) : rng.range(1.0, 1.65);
  const wide = avail.w >= avail.h ? rng.next() < 0.85 : rng.next() < 0.15;
  let bw = Math.round(Math.sqrt(mainArea * r)), bh = Math.round(mainArea / bw);
  if (!wide) [bw, bh] = [bh, bw];
  if (bw > avail.w) { bw = avail.w; bh = Math.round(mainArea / bw); }
  if (bh > avail.h) { bh = avail.h; bw = Math.min(avail.w, Math.round(mainArea / bh)); }
  const rects = new Map<string, Rect>();
  if (!slice({ x: 0, y: 0, w: bw, h: bh }, order, rng, rects)) return undefined;

  // Annexes stick out of the main block.
  for (const a of annex) {
    let placed = false;
    for (let t = 0; t < 8 && !placed; t++) {
      const d0 = Math.max(a.spec.minSide, Math.round(Math.sqrt(a.area / rng.range(1, 1.5))));
      const L = Math.max(a.spec.minSide, Math.round(a.area / d0));
      const side = rng.pick(SIDES);
      const along = side === "north" || side === "south" ? bw : bh;
      if (L > along) continue;
      const flush = rng.next() < 0.6;
      const off = flush ? (rng.next() < 0.5 ? 0 : along - L) : rng.int(0, along - L);
      const rect: Rect = side === "north" ? { x: off, y: -d0, w: L, h: d0 }
        : side === "south" ? { x: off, y: bh, w: L, h: d0 }
        : side === "west" ? { x: -d0, y: off, w: d0, h: L }
        : { x: bw, y: off, w: d0, h: L };
      if ([...rects.values()].some((o) => overlaps(o, rect))) continue;
      rects.set(a.zone.id, rect);
      placed = true;
    }
    if (!placed) return undefined;
  }
  const box = bbox(rects.values());
  if (box.w > avail.w || box.h > avail.h) return undefined;
  for (const [id, rr] of rects) rects.set(id, { ...rr, x: rr.x - box.x, y: rr.y - box.y });

  // Score: lower is better.
  let score = 0;
  const all = [...rects.values()];
  for (const p of prog) {
    const rr = rects.get(p.zone.id)!;
    const a = rr.w * rr.h;
    score += (2 * Math.abs(a - p.area)) / p.area;
    const asp = Math.max(rr.w, rr.h) / Math.min(rr.w, rr.h);
    if (asp > p.spec.maxAspect) score += 6 * (asp - p.spec.maxAspect);
    if (p.spec.minAspect && asp < p.spec.minAspect) score += 5 * (p.spec.minAspect - asp);
    if (Math.min(rr.w, rr.h) < p.spec.minSide) score += 20;
    if (p.spec.exterior && !exteriorSides(rr, all).length) score += 5;
  }
  const ids = new Set(prog.map((p) => p.zone.id));
  for (const c of conns) {
    if (!ids.has(c.from) || !ids.has(c.to)) continue;
    if (sharedLength(rects.get(c.from)!, rects.get(c.to)!) < 2) score += 4;
  }
  const fill = prog.reduce((s, p) => { const rr = rects.get(p.zone.id)!; return s + rr.w * rr.h; }, 0) / (box.w * box.h);
  if (fill < 0.62) score += (0.62 - fill) * 12;
  // A little reward for annexes: they make the outline less boxy.
  score -= annex.length * 0.25;
  return { rects, score };
}

/** Rotates a rect a quarter turn clockwise k times about the origin (y down). */
function turn(r: Rect, k: number): Rect {
  let o = r;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) o = { x: -(o.y + o.h), y: o.x, w: o.h, h: o.w };
  return o;
}

/**
 * Spine plans: a long corridor; rooms open off its left and right walls where the plan
 * says ("along" 0 = entrance, 1 = far end), and one room may sit past its far end. Built
 * walking north from an entrance on the south side, then turned to fit the map.
 */
function spineCandidate(prog: Prog[], conns: Connection[], avail0: { w: number; h: number }, rng: Rng, enclosed = false): (Candidate & { walk: [number, number] }) | undefined {
  // Enclosed: one square of dark on three sides, five of approach in front (the usual margin is two a side).
  const avail = enclosed ? { w: avail0.w + 2, h: avail0.h + 2 } : avail0;
  const spine = prog.find((p) => p.spec.spine)!;
  const sid = spine.zone.id;
  const link = (p: Prog) => conns.find((c) => (c.from === sid && c.to === p.zone.id) || (c.to === sid && c.from === p.zone.id));
  // Along the map's long side; a square-ish map may go either way.
  const vertical = avail.h > avail.w * 1.2 ? true : avail.w > avail.h * 1.2 ? false : rng.next() < 0.5;
  const along = (vertical ? avail.h : avail.w) - (enclosed ? 4 : 0), across = vertical ? avail.w : avail.h;
  const others = prog.filter((p) => p !== spine);
  const end = others.filter((p) => link(p)?.wall === "end").slice(0, 1);
  const sides = others.filter((p) => !end.includes(p));
  // Gates on the short walls are centered, so the corridor width shares their parity.
  const shortGates = conns.filter((c) => (c.from === sid || c.to === sid) && (c.to === "outside" || c.wall === "end" || end.some((e) => e.zone.id === c.to || e.zone.id === c.from)));
  const gw = Math.max(1, ...shortGates.map((c) => c.width ?? (c.via === "gate" ? 3 : 1)));
  // A framed gate in the far wall needs the hall wider than its opening (frame art is about 1.75x).
  const endGate = shortGates.find((c) => c.via === "gate" && c.to !== "outside" && !c.broken);
  const frameW = endGate ? Math.ceil(GATE_FRAME_RATIO * (endGate.width ?? 3) + 0.6) : 0;
  const r = rng.range(spine.spec.minAspect ?? 2.6, Math.min(spine.spec.maxAspect, 4.5));
  let cw = Math.max(spine.spec.minSide, gw + 2, frameW, Math.round(Math.sqrt(spine.area / r)));
  if ((cw - gw) % 2) cw += 1;
  let L = Math.max(Math.round(cw * (spine.spec.minAspect ?? 2)), Math.round(spine.area / cw));
  // End room: at least as wide as the corridor, centered on it.
  let endRect: Rect | undefined;
  if (end[0]) {
    const p = end[0];
    let ew = Math.max(cw, Math.round(Math.sqrt(p.area * rng.range(1.1, 1.6))));
    if ((ew - cw) % 2) ew += 1;
    const eh = Math.max(p.spec.minSide, Math.round(p.area / ew));
    endRect = { x: (cw - ew) / 2, y: -eh, w: ew, h: eh };
  }
  if (L + (endRect?.h ?? 0) > along) L = along - (endRect?.h ?? 0);
  if (L < cw * 1.5) return undefined;
  const rects = new Map<string, Rect>([[sid, { x: 0, y: 0, w: cw, h: L }]]);
  if (endRect) rects.set(end[0]!.zone.id, endRect);
  // Side rooms: given walls first, the rest alternate.
  let alt = rng.next() < 0.5 ? "left" : "right";
  const placedSide: Record<"left" | "right", Rect[]> = { left: [], right: [] };
  const ordered = [...sides].sort((a, b) => (link(a)?.along ?? 0.5) - (link(b)?.along ?? 0.5));
  const perSide = { left: ordered.filter((p) => link(p)?.wall === "left").length, right: ordered.filter((p) => link(p)?.wall === "right").length };
  let k = 0;
  for (const p of ordered) {
    const c = link(p);
    const wall = (c?.wall === "left" || c?.wall === "right" ? c.wall : (alt = alt === "left" ? "right" : "left")) as "left" | "right";
    const dw = c?.width ?? (c?.via === "gate" ? 3 : 1);
    const d = Math.max(p.spec.minSide, Math.round(Math.sqrt(p.area / rng.range(1, 1.4))));
    let l = Math.max(p.spec.minSide, dw + 2, Math.round(p.area / d));
    l = Math.min(l, L);
    const t = c?.along ?? (k + 1) / (sides.length + 1);
    k++;
    void perSide;
    let y0 = Math.round(L * (1 - t) - l / 2);
    // A framed gate in the far wall reaches into the hall; side doors keep clear of it.
    const keep = endGate ? Math.ceil(0.75 * (endGate.width ?? 3)) : 0;
    y0 = Math.max(keep, Math.min(L - l, y0));
    // Clear of rooms already on this wall.
    for (let guard = 0; guard < 4; guard++) {
      const hit = placedSide[wall].find((o) => y0 < o.y + o.h && o.y < y0 + l);
      if (!hit) break;
      y0 = y0 + l / 2 < hit.y + hit.h / 2 ? hit.y - l : hit.y + hit.h;
    }
    if (y0 < 0 || y0 + l > L || placedSide[wall].some((o) => y0 < o.y + o.h && o.y < y0 + l)) return undefined;
    const rect: Rect = wall === "left" ? { x: -d, y: y0, w: d, h: l } : { x: cw, y: y0, w: d, h: l };
    placedSide[wall].push(rect);
    rects.set(p.zone.id, rect);
  }
  const box0 = bbox(rects.values());
  if (box0.w > across) return undefined;
  const k4 = vertical ? (rng.next() < 0.5 ? 0 : 2) : rng.next() < 0.5 ? 1 : 3;
  for (const [id, rr] of rects) rects.set(id, turn(rr, k4));
  const box = bbox(rects.values());
  for (const [id, rr] of rects) rects.set(id, { ...rr, x: rr.x - box.x, y: rr.y - box.y });
  if (box.w > avail.w || box.h > avail.h) return undefined;
  const walk: [number, number] = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as Array<[number, number]>)[k4]!;
  let score = 0;
  for (const p of prog) {
    const rr = rects.get(p.zone.id)!;
    score += (2 * Math.abs(rr.w * rr.h - p.area)) / p.area;
  }
  return { rects, score, walk };
}

/** Builds the cell grid: room index per square, -1 outside. */
function cellGrid(W: number, H: number, rooms: Array<{ id: string; rect: Rect }>): Int16Array {
  const g = new Int16Array(W * H).fill(-1);
  rooms.forEach((r, i) => {
    for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) g[y * W + x] = i;
  });
  return g;
}

/** Clockwise outline of all room cells (one loop; rooms are always connected). */
function traceOutline(g: Int16Array, W: number, H: number): Array<[number, number]> {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : g[y * W + x]!);
  // Directed boundary edges, clockwise around the inside (y down).
  const next = new Map<string, [number, number]>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) < 0) continue;
    if (at(x, y - 1) < 0) next.set(key(x, y), [x + 1, y]);
    if (at(x + 1, y) < 0) next.set(key(x + 1, y), [x + 1, y + 1]);
    if (at(x, y + 1) < 0) next.set(key(x + 1, y + 1), [x, y + 1]);
    if (at(x - 1, y) < 0) next.set(key(x, y + 1), [x, y]);
  }
  if (!next.size) return [];
  const start = [...next.keys()].sort()[0]!;
  const pts: Array<[number, number]> = [];
  let cur = start;
  for (let guard = 0; guard <= next.size; guard++) {
    const [x, y] = cur.split(",").map(Number) as [number, number];
    pts.push([x, y]);
    const n = next.get(cur);
    if (!n) break;
    cur = key(n[0], n[1]);
    if (cur === start) break;
  }
  // Drop collinear points.
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length]!, c = pts[i]!, n = pts[(i + 1) % pts.length]!;
    if ((p[0] === c[0] && c[0] === n[0]) || (p[1] === c[1] && c[1] === n[1])) continue;
    out.push(c);
  }
  return out;
}

interface UnitEdge {
  /** Midpoint of the unit edge. */
  at: [number, number];
  dir: [number, number];
  rooms: [number, number];
}

/**
 * Lays out the plan's single level. Outdoor zones (rooms.ts `outdoor`, or types in
 * `outdoorTypes`) take the open ground beside the building; with no indoor zones there is
 * no building.
 */
export function layoutBuilding(plan: ScenePlan, rng: Rng, outdoorTypes: Set<string> = new Set()): Layout {
  const level = plan.levels[0]!;
  let W = plan.size.w, H = plan.size.h;
  const isOut = (z: Zone) => !!specOf(z.type).outdoor || outdoorTypes.has(z.type);
  const indoor = level.zones.filter((z) => !isOut(z));
  const outdoor = level.zones.filter(isOut);
  // Connections always run from a room: "forecourt -> hall" becomes "hall -> forecourt".
  const outIds = new Set(["outside", ...outdoor.map((z) => z.id)]);
  const inIds = new Set(indoor.map((z) => z.id));
  const levelConns = (level.connections ?? []).map((c) => (outIds.has(c.from) && inIds.has(c.to) ? { ...c, from: c.to, to: c.from } : c));
  const empty = (front: Side = "south"): Layout => ({
    map: { w: W, h: H }, building: { x: 0, y: 0, w: 0, h: 0 }, outline: [], zones: [], interiorWalls: [], doors: [], windows: [], exterior: {}, front,
  });
  if (!indoor.length) {
    const L = empty();
    L.zones = outdoor.map((z) => ({ ...z, rect: { x: 0, y: 0, w: W, h: H }, outdoor: true }));
    return L;
  }

  // Room program, scaled down if the map can't hold it.
  const margin = 2;
  const avail = { w: W - 2 * margin, h: H - 2 * margin };
  const maxArea = avail.w * avail.h * (outdoor.length ? 0.55 : 0.82);
  let prog: Prog[] = indoor.map((z) => ({ zone: z, spec: specOf(z.type), area: targetArea(specOf(z.type), z.area) * rng.range(0.92, 1.08) }));
  const dropped: string[] = [];
  const sum = () => prog.reduce((s, p) => s + p.area, 0);
  // With three or more rooms, no room takes more than about two thirds of the building.
  const spineProg = prog.find((p) => p.spec.spine);
  if (prog.length >= 3 && !spineProg) {
    for (const p of prog) {
      const others = sum() - p.area;
      if (p.area > others * 2) p.area = Math.max(p.spec.area[0], others * 2);
    }
  }
  if (sum() > maxArea) {
    const f = maxArea / sum();
    prog = prog.map((p) => ({ ...p, area: Math.max(p.spec.minSide * p.spec.minSide, p.area * f) }));
  }
  while (sum() > maxArea * 1.05 && prog.length > 1) {
    // Drop the least important room: not the entrance, the smallest.
    const victims = prog.filter((p) => !p.spec.entrance).sort((a, b) => a.area - b.area);
    const v = victims[0] ?? prog[prog.length - 1]!;
    dropped.push(v.zone.id);
    prog = prog.filter((p) => p !== v);
  }
  const conns = levelConns.filter((c) => c.to !== "outside" && c.to !== "beyond");
  const enclosed = plan.enclosed ?? (levelConns.some((c) => c.to === "beyond") && !outdoor.length);
  // The corridor's entrance gate sets its width too.
  const spineConns = levelConns.map((c) => (outIds.has(c.to) ? { ...c, to: "outside" } : c));

  let best: (Candidate & { walk?: [number, number] }) | undefined;
  for (let i = 0; i < 400; i++) {
    const c = spineProg && prog.includes(spineProg) ? spineCandidate(prog, spineConns, avail, rng, enclosed) : candidate(prog, conns, avail, rng);
    if (c && (!best || c.score < best.score)) best = c;
  }
  if (!best) {
    // Fall back to one room per zone in a row; only hit on absurd plans.
    const L = empty();
    L.dropped = level.zones.map((z) => z.id);
    return L;
  }

  // Place the building on the map.
  const box = bbox(best.rects.values());
  let bx: number, by: number;
  if (outdoor.length) {
    const horizontal = W - box.w >= H - box.h;
    bx = horizontal ? (rng.next() < 0.5 ? margin : W - margin - box.w) : Math.round((W - box.w) / 2 + rng.range(-1.5, 1.5));
    by = horizontal ? Math.round((H - box.h) / 2 + rng.range(-1.5, 1.5)) : (rng.next() < 0.5 ? margin : H - margin - box.h);
  } else if (enclosed) {
    // Part of something bigger: one square of darkness around the walls, an approach in front.
    const fs: Side = best.walk ? (best.walk[1] === -1 ? "south" : best.walk[1] === 1 ? "north" : best.walk[0] === 1 ? "west" : "east") : "south";
    const mg = (s: Side) => (s === fs ? 5 : 1);
    W = Math.min(W, box.w + mg("west") + mg("east"));
    H = Math.min(H, box.h + mg("north") + mg("south"));
    bx = mg("west");
    by = mg("north");
  } else {
    // A building alone: crop the map to it plus a margin for the approach and the yard,
    // as hand-made battle maps do. The plan's size is the most the map may be.
    const M = 4;
    W = Math.min(W, box.w + 2 * M);
    H = Math.min(H, box.h + 2 * M);
    bx = Math.round((W - box.w) / 2 + rng.range(-0.6, 0.6));
    by = Math.round((H - box.h) / 2 + rng.range(-0.6, 0.6));
  }
  bx = Math.max(1, Math.min(W - 1 - box.w, bx));
  by = Math.max(1, Math.min(H - 1 - box.h, by));
  const rooms = prog.map((p) => {
    const r = best!.rects.get(p.zone.id)!;
    return { prog: p, id: p.zone.id, rect: { x: r.x + bx, y: r.y + by, w: r.w, h: r.h } };
  });
  const building: Rect = { x: bx, y: by, w: box.w, h: box.h };

  // Front: the side with the most open ground in front of it.
  const room: Record<Side, number> = { north: by, south: H - (by + box.h), west: bx, east: W - (bx + box.w) };
  let front0 = (["south", "east", "west", "north"] as Side[]).reduce((a, s) => (room[s] > room[a] + 0.5 ? s : a), "south" as Side);
  // A corridor's entrance is the short side you walk in from.
  if (best.walk) front0 = best.walk[1] === -1 ? "south" : best.walk[1] === 1 ? "north" : best.walk[0] === 1 ? "west" : "east";

  const g = cellGrid(W, H, rooms);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : g[y * W + x]!);
  const outline = traceOutline(g, W, H);
  const isCorner = (x: number, y: number) => outline.some((p) => p[0] === x && p[1] === y);

  // Unit edges: exterior (room | outside) and interior (room | room).
  const ext: Array<UnitEdge & { side: Side }> = [];
  const inner: UnitEdge[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = at(x, y);
    if (r < 0) continue;
    if (at(x, y - 1) < 0) ext.push({ at: [x + 0.5, y], dir: [1, 0], rooms: [r, -1], side: "north" });
    if (at(x, y + 1) < 0) ext.push({ at: [x + 0.5, y + 1], dir: [1, 0], rooms: [r, -1], side: "south" });
    if (at(x - 1, y) < 0) ext.push({ at: [x, y + 0.5], dir: [0, 1], rooms: [r, -1], side: "west" });
    if (at(x + 1, y) < 0) ext.push({ at: [x + 1, y + 0.5], dir: [0, 1], rooms: [r, -1], side: "east" });
    const right = at(x + 1, y), down = at(x, y + 1);
    if (right >= 0 && right !== r) inner.push({ at: [x + 1, y + 0.5], dir: [0, 1], rooms: [r, right] });
    if (down >= 0 && down !== r) inner.push({ at: [x + 0.5, y + 1], dir: [1, 0], rooms: [r, down] });
  }

  // Interior walls: merge collinear contiguous unit edges.
  const interiorWalls: Segment[] = [];
  const lines = new Map<string, number[]>();
  for (const e of inner) {
    const vert = e.dir[1] === 1;
    const k = vert ? `v${e.at[0]}` : `h${e.at[1]}`;
    const t = vert ? e.at[1] - 0.5 : e.at[0] - 0.5;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push(t);
  }
  for (const [k, ts] of lines) {
    ts.sort((a, b) => a - b);
    const c = Number(k.slice(1));
    let s0 = ts[0]!, prev = ts[0]!;
    const flush = (a: number, b: number) => interiorWalls.push(k[0] === "v" ? { a: [c, a], b: [c, b + 1] } : { a: [a, c], b: [b + 1, c] });
    for (const t of ts.slice(1)) {
      if (t !== prev + 1) { flush(s0, prev); s0 = t; }
      prev = t;
    }
    flush(s0, prev);
  }
  const wallIndexOf = (p: [number, number]) => interiorWalls.findIndex((s) =>
    s.a[0] === s.b[0] ? p[0] === s.a[0] && p[1] > s.a[1] && p[1] < s.b[1] : p[1] === s.a[1] && p[0] > s.a[0] && p[0] < s.b[0]);

  const idx = new Map(rooms.map((r, i) => [r.id, i]));
  const doors: DoorPlacement[] = [];
  const used = new Set<string>();
  const ekey = (e: UnitEdge) => `${e.at[0]},${e.at[1]}`;
  const nearUsed = (e: UnitEdge, d = 1.6) => doors.some((o) => Math.hypot(o.at[0] - e.at[0], o.at[1] - e.at[1]) < d);
  /** A unit edge is a good door spot when neither end touches a corner or another wall. */
  const clear = (e: UnitEdge) => {
    const [x, y] = e.at;
    const ends: Array<[number, number]> = e.dir[0] ? [[x - 0.5, y], [x + 0.5, y]] : [[x, y - 0.5], [x, y + 0.5]];
    for (const [px, py] of ends) {
      if (isCorner(px, py)) return false;
      // Another wall meets this point if the cells around it hold more than two rooms.
      const around = new Set([at(px - 1, py - 1), at(px, py - 1), at(px - 1, py), at(px, py)]);
      if (around.size > 2) return false;
    }
    return true;
  };
  const linked = new Set<string>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  /**
   * A door `w` squares wide on one straight run of unit edges, as near the middle of the
   * run (or `prefer`) as it can be, its ends clear of corners and other walls.
   */
  const wideRun = (edges: UnitEdge[], w: number, prefer?: [number, number]): UnitEdge[] | undefined => {
    const lines = new Map<string, UnitEdge[]>();
    for (const e of edges) {
      const k = e.dir[0] ? `h${e.at[1]}` : `v${e.at[0]}`;
      (lines.get(k) ?? lines.set(k, []).get(k)!).push(e);
    }
    const endsClear = (p: [number, number]) => {
      if (isCorner(p[0], p[1])) return false;
      const around = new Set([at(p[0] - 1, p[1] - 1), at(p[0], p[1] - 1), at(p[0] - 1, p[1]), at(p[0], p[1])]);
      return around.size <= 2;
    };
    let found: { run: UnitEdge[]; d: number } | undefined;
    for (const [k, list] of lines) {
      const horiz = k[0] === "h";
      const tOf = (e: UnitEdge) => (horiz ? e.at[0] : e.at[1]);
      list.sort((p, q) => tOf(p) - tOf(q));
      const ts = list.map(tOf);
      const m = (Math.min(...ts) + Math.max(...ts)) / 2;
      const mid: [number, number] = horiz ? [m, list[0]!.at[1]] : [list[0]!.at[0], m];
      for (let i = 0; i + w <= list.length; i++) {
        const run = list.slice(i, i + w);
        const t0 = tOf(run[0]!);
        if (run.some((e, j) => tOf(e) !== t0 + j || used.has(ekey(e)))) continue;
        const p0: [number, number] = horiz ? [t0 - 0.5, run[0]!.at[1]] : [run[0]!.at[0], t0 - 0.5];
        const p1: [number, number] = horiz ? [t0 + w - 0.5, run[0]!.at[1]] : [run[0]!.at[0], t0 + w - 0.5];
        if (!endsClear(p0) || !endsClear(p1)) continue;
        const c: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const target = prefer ?? mid;
        const crowded = doors.some((o) => Math.hypot(o.at[0] - c[0], o.at[1] - c[1]) < (w + (o.width ?? 1)) / 2 + 1);
        const d = Math.hypot(c[0] - target[0], c[1] - target[1]) + (crowded ? 100 : 0);
        if (!found || d < found.d) found = { run, d };
      }
    }
    return found && found.d < 100 ? found.run : undefined;
  };
  const extras = (c?: Connection): Partial<DoorPlacement> => {
    if (!c) return {};
    const o: Partial<DoorPlacement> = {};
    if (c.via === "gate") o.gate = true;
    if (c.state) o.state = c.state;
    if (c.broken) o.broken = c.broken;
    if (c.id) o.conn = c.id;
    return o;
  };
  const widthOf = (c?: Connection) => Math.max(1, Math.min(6, c?.width ?? (c?.via === "gate" ? 3 : c?.broken ? 2 : 1)));
  const centerOf = (run: UnitEdge[]): [number, number] => {
    const a0 = run[0]!.at, a1 = run[run.length - 1]!.at;
    return [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
  };

  const addInterior = (a: number, b: number, c?: Connection): boolean => {
    if (linked.has(pairKey(a, b))) return true;
    const edges = inner.filter((e) => (e.rooms[0] === a && e.rooms[1] === b) || (e.rooms[0] === b && e.rooms[1] === a));
    const w = widthOf(c);
    if (w > 1 || c?.via === "gate" || c?.broken || best!.walk) {
      const run = wideRun(edges, w) ?? (w > 1 ? wideRun(edges, w - 1) : undefined);
      if (run) {
        const at0 = centerOf(run);
        const wi = wallIndexOf(at0);
        if (wi >= 0) {
          doors.push({ at: at0, wall: wi, between: [rooms[a]!.id, rooms[b]!.id], dir: run[0]!.dir, width: run.length, ...extras(c) });
          for (const e of run) used.add(ekey(e));
          linked.add(pairKey(a, b));
          return true;
        }
      }
    }
    let cands = edges.filter((e) => clear(e) && !nearUsed(e));
    if (!cands.length) cands = edges.filter((e) => !nearUsed(e, 1));
    if (!cands.length) return false;
    const e = rng.pick(cands);
    const wi = wallIndexOf(e.at);
    if (wi < 0) return false;
    doors.push({ at: e.at, wall: wi, between: [rooms[a]!.id, rooms[b]!.id], dir: e.dir, ...extras(c) });
    used.add(ekey(e));
    linked.add(pairKey(a, b));
    return true;
  };

  const addOutside = (a: number, side?: Side, main = false, c?: Connection): boolean => {
    let edges = ext.filter((e) => e.rooms[0] === a);
    const w = widthOf(c);
    if (w > 1 || c?.via === "gate" || (main && best!.walk)) {
      const s0 = best!.walk && main ? front0 : side;
      const list = s0 ? edges.filter((e) => e.side === s0) : edges;
      const run = wideRun(list, w) ?? (w > 1 ? wideRun(list, w - 1) : undefined);
      if (run) {
        doors.push({ at: centerOf(run), wall: "outer", between: [rooms[a]!.id, "outside"], dir: run[0]!.dir, main, width: run.length, ...extras(c) });
        for (const e of run) used.add(ekey(e));
        return true;
      }
    }
    const rr = rooms[a]!.rect;
    if (main && rooms[a]!.prog.spec.doorOnShortSide && rr.w !== rr.h) {
      const short = rr.w < rr.h ? ["north", "south"] : ["west", "east"];
      const onShort = edges.filter((e) => short.includes(e.side));
      if (onShort.length) {
        edges = onShort;
        if (!side || !short.includes(side)) side = (short as Side[]).sort((p, q) => room[q] - room[p])[0];
      }
    }
    const pref = side ? edges.filter((e) => e.side === side) : [];
    for (const list of [pref, edges]) {
      const cands = list.filter((e) => clear(e) && !nearUsed(e, 2));
      if (!cands.length) continue;
      // Main doors sit near the middle of the room's wall run; others anywhere.
      let e: UnitEdge;
      if (main) {
        const xs = cands.map((c) => (c.dir[0] ? c.at[0] : c.at[1]));
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        e = [...cands].sort((p, q) => Math.abs((p.dir[0] ? p.at[0] : p.at[1]) - mid) - Math.abs((q.dir[0] ? q.at[0] : q.at[1]) - mid) + rng.range(-0.8, 0.8))[0]!;
      } else e = rng.pick(cands);
      doors.push({ at: e.at, wall: "outer", between: [rooms[a]!.id, "outside"], dir: e.dir, main, width: 1, ...extras(c) });
      used.add(ekey(e));
      return true;
    }
    return false;
  };

  /**
   * A door into the unseen rest of the building: in the outer wall, on the corridor wall the
   * plan names (left, right, end) at its "along" position, never on the entrance side.
   */
  const addBeyond = (a: number, c: Connection): boolean => {
    const w = widthOf(c);
    let edges = ext.filter((e) => e.rooms[0] === a && e.side !== front0);
    let prefer: [number, number] | undefined;
    const r = rooms[a]!.rect;
    if (best!.walk && c.wall) {
      const walk = best!.walk;
      const left: [number, number] = [walk[1], -walk[0]];
      const dir: [number, number] = c.wall === "end" ? walk : c.wall === "left" ? left : [-left[0], -left[1]];
      const sideName: Side = dir[0] === 1 ? "east" : dir[0] === -1 ? "west" : dir[1] === 1 ? "south" : "north";
      edges = edges.filter((e) => e.side === sideName);
      if (c.wall !== "end") {
        const len = Math.abs(walk[0]) ? r.w : r.h;
        // Keep clear of a framed gate in the far wall.
        const endGate = levelConns.find((x) => x.from === c.from && x.wall === "end" && x.via === "gate" && !x.broken);
        const keep = endGate ? Math.ceil(0.75 * (endGate.width ?? 3)) : 1;
        const p = Math.min(len * (c.along ?? 0.5), len - keep - w / 2 - 0.5);
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const half = (Math.abs(dir[0]) ? r.w : r.h) / 2;
        prefer = [cx + dir[0] * half + walk[0] * (p - len / 2), cy + dir[1] * half + walk[1] * (p - len / 2)];
      }
    }
    const run = wideRun(edges, w, prefer) ?? (w > 1 ? wideRun(edges, w - 1, prefer) : undefined);
    if (!run) return false;
    doors.push({ at: centerOf(run), wall: "outer", between: [rooms[a]!.id, "beyond"], dir: run[0]!.dir, width: run.length, ...extras(c) });
    for (const e of run) used.add(ekey(e));
    return true;
  };

  const outdoorIds = new Set(outdoor.map((z) => z.id));
  const allConns = levelConns;
  // The entrance first (its side is the front), then doors into the unseen beyond, then the rest.
  const order = (c: Connection) => (c.to === "outside" || outdoorIds.has(c.to) ? 0 : c.to === "beyond" ? 2 : 1);
  for (const c of [...allConns].sort((p, q) => order(p) - order(q))) {
    if (c.via === "opening") continue;
    const a = idx.get(c.from);
    if (a === undefined) continue;
    if (c.to === "beyond") {
      addBeyond(a, c);
      continue;
    }
    if (c.to === "outside" || outdoorIds.has(c.to)) addOutside(a, c.side ?? (rooms[a]!.prog.spec.entrance ? front0 : undefined), !doors.some((d) => d.main), c);
    else {
      const b = idx.get(c.to);
      if (b !== undefined) addInterior(a, b, c);
    }
  }
  // Main entrance on the front, if the plan didn't place one.
  if (!doors.some((d) => d.main)) {
    const ent = rooms.findIndex((r) => r.prog.spec.entrance);
    const e = ent >= 0 ? ent : 0;
    if (!addOutside(e, front0, true)) addOutside(e, undefined, true);
  }
  // A back door for rooms that want outside access (kitchens), sometimes.
  rooms.forEach((r, i) => {
    if (r.prog.spec.exterior && !r.prog.spec.entrance && !doors.some((d) => d.between[0] === r.id && d.between[1] === "outside") && rng.next() < 0.55) {
      addOutside(i, SIDES.filter((s) => s !== front0)[rng.int(0, 2)]);
    }
  });

  // The front is wherever the main door ended up.
  const mainDoor = doors.find((d) => d.main);
  const front: Side = mainDoor ? ext.find((e) => e.at[0] === mainDoor.at[0] && e.at[1] === mainDoor.at[1])?.side ?? front0 : front0;

  // Every room reachable from the entrance.
  const hub = idx.get(doors.find((d) => d.main)?.between[0] ?? rooms[0]!.id) ?? 0;
  const reach = () => {
    const seen = new Set([hub]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of doors) {
        if (d.between[1] === "outside") continue;
        const a = idx.get(d.between[0])!, b = idx.get(d.between[1])!;
        if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; }
      }
    }
    return seen;
  };
  for (let guard = 0; guard < rooms.length * 3; guard++) {
    const seen = reach();
    if (seen.size === rooms.length) break;
    let done = false;
    for (let i = 0; i < rooms.length && !done; i++) {
      if (seen.has(i)) continue;
      const targets = [...seen].sort((p, q) => sharedLength(rooms[q]!.rect, rooms[i]!.rect) - sharedLength(rooms[p]!.rect, rooms[i]!.rect));
      for (const t of targets) if (sharedLength(rooms[t]!.rect, rooms[i]!.rect) >= 1 && addInterior(i, t)) { done = true; break; }
    }
    if (!done) break;
  }
  const seen = reach();
  rooms.forEach((r, i) => { if (!seen.has(i)) addOutside(i); });

  // Windows along outside walls.
  const windows: WindowPlacement[] = [];
  rooms.forEach((r, i) => {
    const every = r.prog.spec.windowEvery;
    if (!every) return;
    for (const side of SIDES) {
      const run = ext.filter((e) => e.rooms[0] === i && e.side === side).sort((p, q) => (p.dir[0] ? p.at[0] - q.at[0] : p.at[1] - q.at[1]));
      if (run.length < 3) continue;
      const start = rng.int(1, Math.min(every, run.length - 2));
      for (let k = start; k < run.length - 1; k += every) {
        const e = run[k]!;
        if (!clear(e) || used.has(ekey(e)) || nearUsed(e, 1.6) || windows.some((w) => Math.hypot(w.at[0] - e.at[0], w.at[1] - e.at[1]) < 1.5)) continue;
        windows.push({ at: e.at, dir: e.dir, zone: r.id, width: 1 });
      }
    }
  });

  const exterior: Record<string, Side[]> = {};
  rooms.forEach((r, i) => (exterior[r.id] = SIDES.filter((s) => ext.some((e) => e.rooms[0] === i && e.side === s))));

  // Ruined buildings: one or two stretches of outer wall have fallen, away from doors, windows and corners.
  const breaches: Segment[] = [];
  // Not in an enclosed building: its walls back onto the rest of the castle, so a collapse would read as another way out.
  if (plan.mood?.wear === "ruined" && outline.length && !enclosed) {
    const edges = outline.map((p, i) => [p, outline[(i + 1) % outline.length]!] as [[number, number], [number, number]]).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= 5);
    // Doors survive; a fallen stretch may take a window with it.
    const blocked = doors.map((d) => d.at);
    for (const [a, b] of rng.shuffle(edges).slice(0, rng.int(1, 2))) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const gap = rng.int(2, 3);
      for (let t = 0; t < 8; t++) {
        const s0 = rng.int(1, Math.floor(len - gap - 1));
        const p0: [number, number] = [a[0] + u[0] * s0, a[1] + u[1] * s0], p1: [number, number] = [a[0] + u[0] * (s0 + gap), a[1] + u[1] * (s0 + gap)];
        const near = blocked.some((q) => Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]) < 0.1 && (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1] > s0 - 1.2 && (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1] < s0 + gap + 1.2);
        if (near) continue;
        breaches.push({ a: p0, b: p1 });
        for (let k = windows.length - 1; k >= 0; k--) {
          const w = windows[k]!.at;
          const along = (w[0] - a[0]) * u[0] + (w[1] - a[1]) * u[1];
          if (Math.abs((w[0] - a[0]) * u[1] - (w[1] - a[1]) * u[0]) < 0.1 && along > s0 - 0.6 && along < s0 + gap + 0.6) windows.splice(k, 1);
        }
        break;
      }
    }
  }

  // Outdoor zones take the open ground, biggest stretch first.
  const regions: Array<{ side: Side; rect: Rect }> = [
    { side: "west" as Side, rect: { x: 0, y: 0, w: building.x - 1, h: H } },
    { side: "east" as Side, rect: { x: building.x + building.w + 1, y: 0, w: W - (building.x + building.w + 1), h: H } },
    { side: "north" as Side, rect: { x: 0, y: 0, w: W, h: building.y - 1 } },
    { side: "south" as Side, rect: { x: 0, y: building.y + building.h + 1, w: W, h: H - (building.y + building.h + 1) } },
  ].filter((r) => r.rect.w >= 3 && r.rect.h >= 3).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  const zones: LayoutZone[] = rooms.map((r) => ({ ...r.prog.zone, rect: r.rect }));
  outdoor.forEach((z, i) => {
    const reg = regions[i % Math.max(1, regions.length)];
    zones.push({ ...z, rect: reg ? reg.rect : { x: 0, y: 0, w: W, h: H }, outdoor: true });
  });

  const spine = best.walk && spineProg ? { zone: spineProg.zone.id, walk: best.walk } : undefined;
  // The approach: the open strip in front of the entrance, the whole width of the map.
  const approach: Rect | undefined = !enclosed ? undefined
    : front === "south" ? { x: 0, y: building.y + building.h, w: W, h: H - (building.y + building.h) }
    : front === "north" ? { x: 0, y: 0, w: W, h: building.y }
    : front === "west" ? { x: 0, y: 0, w: building.x, h: H }
    : { x: building.x + building.w, y: 0, w: W - (building.x + building.w), h: H };
  const laid: Layout = { map: { w: W, h: H }, building, outline, zones, interiorWalls, doors, windows, exterior, front, dropped: dropped.length ? dropped : undefined, breaches: breaches.length ? breaches : undefined, spine, approach };
  return approach && plan.approach ? widenApproach(laid, plan.approach) : laid;
}

/**
 * Grows an enclosed building's map in front of its entrance: the approach reaches `depth`
 * squares from the wall and the map is at least `width` wide, the building centred across it.
 * Everything laid out moves with it; nothing inside changes.
 */
export function widenApproach(L: Layout, o: { depth?: number; width?: number }): Layout {
  const a = L.approach;
  if (!a) return L;
  const vertical = L.front === "north" || L.front === "south";
  const extra = Math.max(0, Math.round((o.depth ?? 0) - (vertical ? a.h : a.w)));
  const across = vertical ? L.map.w : L.map.h;
  const grow = Math.max(0, Math.round((o.width ?? 0) - across));
  const side = Math.floor(grow / 2);
  const dx = vertical ? side : L.front === "west" ? extra : 0;
  const dy = vertical ? (L.front === "north" ? extra : 0) : side;
  const W = L.map.w + (vertical ? grow : extra), H = L.map.h + (vertical ? extra : grow);
  const mv = (p: [number, number]): [number, number] => [p[0] + dx, p[1] + dy];
  const mr = <T extends Rect>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy });
  const b = mr(L.building);
  const approach: Rect = L.front === "south" ? { x: 0, y: b.y + b.h, w: W, h: H - (b.y + b.h) }
    : L.front === "north" ? { x: 0, y: 0, w: W, h: b.y }
    : L.front === "west" ? { x: 0, y: 0, w: b.x, h: H }
    : { x: b.x + b.w, y: 0, w: W - (b.x + b.w), h: H };
  return {
    ...L, map: { w: W, h: H }, building: b, outline: L.outline.map(mv), zones: L.zones.map((z) => ({ ...z, rect: mr(z.rect) })),
    interiorWalls: L.interiorWalls.map((s) => ({ a: mv(s.a), b: mv(s.b) })), doors: L.doors.map((d) => ({ ...d, at: mv(d.at) })),
    windows: L.windows.map((w) => ({ ...w, at: mv(w.at) })), breaches: L.breaches?.map((s) => ({ a: mv(s.a), b: mv(s.b) })), approach,
  };
}

/**
 * The outer wall as open polylines when stretches have fallen (breaches), else the closed loop.
 * Breaches must lie on outline edges.
 */
export function outerWallRuns(outline: Array<[number, number]>, breaches: Segment[] = []): Array<{ points: Array<[number, number]>; loop: boolean }> {
  if (!breaches.length) return [{ points: outline, loop: true }];
  const n = outline.length;
  // Arc-length position of every outline vertex and of each breach.
  const at: number[] = [0];
  for (let i = 1; i <= n; i++) at.push(at[i - 1]! + Math.hypot(outline[i % n]![0] - outline[i - 1]![0], outline[i % n]![1] - outline[i - 1]![1]));
  const P = at[n]!;
  const pos = (p: [number, number]): number => {
    for (let i = 0; i < n; i++) {
      const a = outline[i]!, b = outline[(i + 1) % n]!;
      const len = at[i + 1]! - at[i]!;
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
      const q: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) return at[i]! + t * len;
    }
    return -1;
  };
  const gaps = breaches.map((s) => [pos(s.a), pos(s.b)].sort((x, y) => x - y) as [number, number]).filter((g) => g[0] >= 0).sort((x, y) => x[0] - y[0]);
  if (!gaps.length) return [{ points: outline, loop: true }];
  const point = (s: number): [number, number] => {
    const v = ((s % P) + P) % P;
    for (let i = 0; i < n; i++) if (v <= at[i + 1]! + 1e-9) {
      const a = outline[i]!, b = outline[(i + 1) % n]!;
      const t = (v - at[i]!) / (at[i + 1]! - at[i]! || 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    return outline[0]!;
  };
  const runs: Array<{ points: Array<[number, number]>; loop: boolean }> = [];
  for (let k = 0; k < gaps.length; k++) {
    const start = gaps[k]![1], end = gaps[(k + 1) % gaps.length]![0] + (k + 1 === gaps.length ? P : 0);
    if (end - start < 0.5) continue;
    const pts: Array<[number, number]> = [point(start)];
    for (let i = 0; i < 2 * n; i++) {
      const v = at[i % n]! + Math.floor(i / n) * P;
      if (v > start + 1e-6 && v < end - 1e-6) pts.push(outline[i % n]!);
    }
    pts.push(point(end));
    runs.push({ points: pts, loop: false });
  }
  return runs;
}

/** Outward normal of a building side. */
export function outward(side: Side): [number, number] {
  return OUTWARD[side];
}
