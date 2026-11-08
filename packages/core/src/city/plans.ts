/**
 * Battle-map plans for a city's hot spots and for areas the DM picks: street-level maps of
 * an area (market, gate, docks, any box), and interiors sized to the building's footprint
 * (tavern, temple, keep) built with the ordinary room generator.
 */

import type { ScenePlan, Zone, Connection } from "../gen/plan";
import { bboxOf, M_PER_SQUARE, type Box, type City, type HotSpot } from "./city";

export interface CityPlanOptions {
  /** Cache key of the city (fetch.ts cityKey). */
  key: string;
  /** Map ids are prefixed with this (letters, digits, - _). */
  prefix: string;
  time?: "day" | "dusk" | "night";
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 1_000_000;
}

/** A street-level map of a box of the city (metres), at most 120 m a side. */
export function areaPlan(city: City, area: Box, opts: CityPlanOptions & { id: string; title: string }): ScenePlan {
  const a: Box = { x: area.x, y: area.y, w: Math.max(15, Math.min(120, area.w)), h: Math.max(15, Math.min(120, area.h)) };
  return {
    id: `${opts.prefix}-${opts.id}`.slice(0, 64),
    title: opts.title,
    seed: seedOf(`${opts.key}:${opts.id}`),
    genre: "medieval",
    size: { w: Math.ceil(a.w / M_PER_SQUARE), h: Math.ceil(a.h / M_PER_SQUARE) },
    mood: { time: opts.time ?? "day", wear: "lived-in" },
    versions: { count: 1, picked: "v1" },
    levels: [{ id: "ground", zones: [{ id: "streets", type: "street.area" }] }],
    street: { city: opts.key, area: a },
  };
}

/** The plan for a hot spot: its street area, or an interior sized to its building. */
export function hotspotPlan(city: City, hs: HotSpot, opts: CityPlanOptions): ScenePlan {
  const title = `${city.name}: ${hs.label}`;
  if (hs.area) return areaPlan(city, hs.area, { ...opts, id: hs.id, title });
  const bb = bboxOf(hs.building ?? [hs.at, hs.at]);
  // The building's footprint in squares, with room for its yard.
  const fw = Math.max(10, Math.round(bb.w / M_PER_SQUARE)), fh = Math.max(10, Math.round(bb.h / M_PER_SQUARE));
  const size = { w: Math.min(60, fw + 8), h: Math.min(60, fh + 8) };
  let genre: ScenePlan["genre"] = "medieval";
  let zones: Zone[] = [];
  let connections: Connection[] = [];
  if (hs.kind === "tavern" || hs.kind === "inn") {
    zones = [{ id: "common", type: "tavern.common_room", area: fw * fh > 220 ? "large" : "medium" }, { id: "kitchen", type: "tavern.kitchen" }, { id: "storage", type: "tavern.storage", area: "small" }, { id: "guests", type: "tavern.guest_room", area: "small" }];
    connections = [{ from: "common", to: "outside" }, { from: "common", to: "kitchen" }, { from: "kitchen", to: "storage" }, { from: "common", to: "guests" }];
  } else if (hs.kind === "temple") {
    genre = "gothic";
    zones = [{ id: "nave", type: "gothic.nave", area: fw * fh > 500 ? "large" : "medium" }, { id: "vestry", type: "gothic.vestry", area: "small" }];
    connections = [{ from: "nave", to: "outside" }, { from: "nave", to: "vestry" }];
  } else if (hs.kind === "wizard") {
    genre = "gothic";
    zones = [{ id: "study", type: "gothic.study", area: "large" }, { id: "vault", type: "gothic.vault", area: "small" }, { id: "bedroom", type: "gothic.bedroom", area: "small" }];
    connections = [{ from: "study", to: "outside" }, { from: "study", to: "vault" }, { from: "study", to: "bedroom" }];
  } else {
    genre = "gothic";
    const big = fw * fh > 900;
    zones = [{ id: "hall", type: "gothic.hall", area: "large" }, { id: "dining", type: "gothic.dining", area: big ? "large" : "medium" }, { id: "study", type: "gothic.study" }, { id: "bedroom", type: "gothic.bedroom" }, ...(big ? [{ id: "ballroom", type: "gothic.ballroom", area: "medium" as const }] : [])];
    connections = [{ from: "hall", to: "outside" }, { from: "hall", to: "dining" }, { from: "hall", to: "study" }, { from: "dining", to: "bedroom" }, ...(big ? [{ from: "hall", to: "ballroom" }] : [])];
  }
  return {
    id: `${opts.prefix}-${hs.id}`.slice(0, 64),
    title,
    seed: seedOf(`${opts.key}:${hs.id}`),
    genre,
    size,
    mood: { time: opts.time ?? "day", wear: "lived-in", lighting: hs.kind === "keep" || hs.kind === "wizard" ? "dim" : undefined },
    versions: { count: 1, picked: "v1" },
    levels: [{ id: "ground", zones, connections }],
  };
}
