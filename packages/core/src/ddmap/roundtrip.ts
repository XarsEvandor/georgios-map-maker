/**
 * Dungeondraft round trip (DESIGN.md section 10): compares the map we generated with the
 * file the DM saved in Dungeondraft, by node id, and turns hand edits into plan
 * directives and locks so later regenerations keep them.
 */

import { PX_PER_SQUARE as S } from "../assets/model";
import type { ElementInfo } from "../gen/generate";
import type { Directive, Lock } from "../gen/plan";
import { parseVector2, parseVector2Array } from "./godot";

export interface MapChange {
  kind: "added" | "removed" | "moved" | "changed";
  section: "objects" | "walls" | "patterns" | "lights" | "paths" | "portals" | "other";
  nodeId: string;
  texture?: string;
  /** Position in squares, when the element has one. */
  at?: [number, number];
  element?: ElementInfo;
  detail?: string;
}

export interface RoundTripResult {
  changes: MapChange[];
  directives: Directive[];
  locks: Lock[];
  /** Edits we can't express as directives (new levels, water, roofs, text, caves...). */
  unmapped: string[];
}

type AnyMap = Record<string, any>;

function byId(list: any[] | undefined): Map<string, any> {
  return new Map((list ?? []).map((e) => [String(e.node_id), e]));
}

function squares(pos: string): [number, number] {
  const [x, y] = parseVector2(pos);
  return [Math.round((x / S) * 100) / 100, Math.round((y / S) * 100) / 100];
}

function bbox(points: [number, number][]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p[0] / S), ys = points.map((p) => p[1] / S);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: Math.floor(x) - 0.5, y: Math.floor(y) - 0.5, w: Math.ceil(Math.max(...xs) - x) + 1, h: Math.ceil(Math.max(...ys) - y) + 1 };
}

/**
 * Diffs two maps. `elements` maps the generated map's node ids to plan elements.
 * `idPrefix` makes the produced directive ids unique per save.
 */
export function diffMaps(generated: AnyMap, saved: AnyMap, elements: Record<string, ElementInfo>, idPrefix = "dd"): RoundTripResult {
  const g = generated.world?.levels?.["0"] ?? {};
  const s = saved.world?.levels?.["0"] ?? {};
  const changes: MapChange[] = [];
  const unmapped: string[] = [];
  const levelsG = Object.keys(generated.world?.levels ?? {});
  const levelsS = Object.keys(saved.world?.levels ?? {});
  if (levelsS.length !== levelsG.length) unmapped.push(`level count changed (${levelsG.length} -> ${levelsS.length})`);
  for (const key of ["water", "roofs", "texts", "cave", "materials", "tiles"] as const) {
    if (JSON.stringify(g[key]) !== JSON.stringify(s[key])) unmapped.push(`${key} edited`);
  }
  if (JSON.stringify(g.terrain) !== JSON.stringify(s.terrain)) unmapped.push("terrain repainted");

  for (const section of ["objects", "lights", "patterns", "walls", "paths"] as const) {
    const a = byId(g[section]), b = byId(s[section]);
    for (const [id, eb] of b) {
      const ea = a.get(id);
      if (!ea) {
        changes.push({ kind: "added", section, nodeId: id, texture: eb.texture, at: eb.position ? squares(eb.position) : undefined });
        continue;
      }
      if (JSON.stringify(ea) === JSON.stringify(eb)) continue;
      const moved = ea.position !== eb.position || ea.rotation !== eb.rotation || ea.scale !== eb.scale || ea.points !== eb.points || ea.edit_points !== eb.edit_points;
      changes.push({
        kind: moved ? "moved" : "changed",
        section,
        nodeId: id,
        texture: eb.texture,
        at: eb.position ? squares(eb.position) : undefined,
        element: elements[id],
        detail: ea.texture !== eb.texture ? `texture ${ea.texture} -> ${eb.texture}` : undefined,
      });
    }
    for (const [id, ea] of a) {
      if (!b.has(id)) changes.push({ kind: "removed", section, nodeId: id, texture: ea.texture, at: ea.position ? squares(ea.position) : undefined, element: elements[id] });
    }
  }
  // Doors live inside walls.
  const portals = (lv: any) => new Map<string, any>((lv.walls ?? []).flatMap((w: any) => (w.portals ?? []).map((p: any) => [String(p.node_id), p])));
  const pg = portals(g), ps = portals(s);
  for (const [id, p] of ps) {
    if (!pg.has(id)) changes.push({ kind: "added", section: "portals", nodeId: id, texture: p.texture, at: squares(p.position) });
    else if (JSON.stringify(pg.get(id)) !== JSON.stringify(p)) changes.push({ kind: "changed", section: "portals", nodeId: id, texture: p.texture, at: squares(p.position), element: elements[id] });
  }
  for (const [id, p] of pg) if (!ps.has(id)) changes.push({ kind: "removed", section: "portals", nodeId: id, texture: p.texture, at: squares(p.position), element: elements[id] });

  const directives: Directive[] = [];
  const locks: Lock[] = [];
  let n = 0;
  const nextId = () => `${idPrefix}${++n}`;
  for (const c of changes) {
    if (c.section === "objects") {
      if (c.kind === "removed") {
        // A piece the DM deleted: keep that spot exactly as edited (empty) on regeneration.
        if (c.at) locks.push({ id: nextId(), region: { x: c.at[0] - 0.6, y: c.at[1] - 0.6, w: 1.2, h: 1.2 }, source: "dm-dungeondraft" });
      } else {
        // Added, moved or changed pieces stay exactly where the DM put them.
        locks.push({ id: nextId(), elements: [c.nodeId], source: "dm-dungeondraft" });
      }
    } else if (c.section === "walls" || c.section === "patterns" || c.section === "portals" || c.section === "paths") {
      const src = c.kind === "removed" ? g : s;
      const el = (src[c.section === "portals" ? "walls" : c.section] ?? []).find((e: any) => String(e.node_id) === c.nodeId);
      const pts: [number, number][] = el?.points ? parseVector2Array(el.points) : c.at ? [[c.at[0] * S, c.at[1] * S]] : [];
      if (pts.length) locks.push({ id: nextId(), region: bbox(pts), source: "dm-dungeondraft" });
    } else if (c.section === "lights" && c.kind !== "removed") {
      locks.push({ id: nextId(), elements: [c.nodeId], source: "dm-dungeondraft" });
    }
  }
  // Collapse duplicate forbids.
  const seen = new Set<string>();
  const uniq = directives.filter((d) => {
    const k = "forbid" in d ? `f:${d.zone}:${d.forbid.join()}` : d.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { changes, directives: uniq, locks, unmapped };
}
