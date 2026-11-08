/**
 * Adopts a map the DM saved in Dungeondraft as the version's current state, so locks by
 * node id keep hand-placed pieces on the next regeneration.
 */

import { PX_PER_SQUARE as S, type AssetRecord } from "../assets/model";
import { parseVector2 } from "../ddmap/godot";
import type { Catalog } from "./catalog";
import type { Placed } from "./dress";
import type { ElementInfo, GeneratedVersion } from "./generate";
import type { Layout } from "./layout";

export function adoptSavedMap(saved: Record<string, any>, version: GeneratedVersion, layout: Layout, cat: Catalog): GeneratedVersion {
  const level = saved.world?.levels?.["0"] ?? {};
  const byRes = new Map<string, AssetRecord>();
  for (const a of cat.index.assets) byRes.set(a.res, a);
  const zoneAt = (x: number, y: number) => {
    const indoor = layout.zones.find((z) => z.rect.w < layout.map.w && x >= z.rect.x && x <= z.rect.x + z.rect.w && y >= z.rect.y && y <= z.rect.y + z.rect.h);
    return (indoor ?? layout.zones.find((z) => x >= z.rect.x && x <= z.rect.x + z.rect.w && y >= z.rect.y && y <= z.rect.y + z.rect.h) ?? layout.zones[0]!).id;
  };
  const elements: Record<string, ElementInfo> = {};
  const placed: Placed[] = [];
  const oldByKey = new Map(version.placed.map((p) => [p.key, p]));
  for (const o of level.objects ?? []) {
    const id = String(o.node_id);
    const prev = version.elements[id];
    const asset = byRes.get(o.texture);
    const [px, py] = parseVector2(o.position);
    const x = px / S, y = py / S;
    const [sx] = parseVector2(o.scale ?? "Vector2( 1, 1 )");
    const key = prev?.key ?? `dd:${id}`;
    const old = oldByKey.get(key);
    const type = asset?.types[0] ?? prev?.type ?? "unknown";
    const fp: [number, number] = asset?.footprint ? [asset.footprint[0] * Math.abs(sx), asset.footprint[1] * Math.abs(sx)] : [1, 1];
    const turned = Math.abs(Math.round((o.rotation ?? 0) / (Math.PI / 2))) % 2 === 1;
    elements[id] = { kind: "object", key, zone: prev?.zone ?? zoneAt(x, y), feature: prev?.feature ?? "dungeondraft", type, asset: asset?.id ?? o.texture, directive: prev?.directive };
    if (!asset) continue; // a built-in Dungeondraft asset we can't index; the lock keeps it via the saved map
    placed.push({
      key,
      zone: elements[id]!.zone!,
      feature: elements[id]!.feature!,
      type,
      asset,
      x,
      y,
      rotation: o.rotation ?? 0,
      scale: Math.abs(sx),
      layer: o.layer ?? 100,
      footprint: turned ? [fp[1], fp[0]] : fp,
      parent: old?.parent,
      directive: prev?.directive,
      light: old?.light,
      customColor: o.custom_color,
    });
  }
  for (const section of ["walls", "patterns", "lights", "paths"] as const) {
    for (const e of level[section] ?? []) {
      const id = String(e.node_id);
      elements[id] = version.elements[id] ?? { kind: section === "walls" ? "wall" : section === "patterns" ? "floor" : section === "lights" ? "light" : "path", key: `dd:${id}` };
      if (section === "walls") for (const p of e.portals ?? []) elements[String(p.node_id)] = version.elements[String(p.node_id)] ?? { kind: "door", key: `dd:${p.node_id}` };
    }
  }
  return { ...version, map: saved, elements, placed, notes: [...version.notes, "adopted the map saved in Dungeondraft"] };
}
