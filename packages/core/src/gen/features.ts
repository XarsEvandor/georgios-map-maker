/**
 * Set pieces (DESIGN.md section 19): gates with frames whose leaves Foundry swings open,
 * gates blown apart (medieval or sci-fi wreckage), gallery walls hung with art in mirrored
 * pairs, and one long carpet down a hall that frays, tears and gaps when worn.
 */

import type { AssetRecord } from "../assets/model";
import { PX_PER_SQUARE } from "../assets/model";
import type { DoorPlacement } from "./layout";
import type { ModifyDirective } from "./plan";
import type { GalleryStep, RunnerStep } from "./recipes";
import {
  aabb, artOffset, Cell, forbidden, frontSize, INSET, LAYER, LIGHTS, pick, pickWeighted, place, rectAt, rotationFor,
  type Ctx, type Room, type Vec,
} from "./dress";

const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];
const rotate = (v: Vec, r: number): Vec => [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)];
const sidePoint = (s: Room["sides"][number], t: number, depth: number): Vec => add(add(s.origin, s.along, t), s.inward, depth);

// ---------------------------------------------------------------------------------------
// Colors

const NAMED: Record<string, string> = {
  red: "ff9a2a2a", crimson: "ff8c1c28", scarlet: "ffa8282a", maroon: "ff5a1a20", burgundy: "ff5e1b2a", wine: "ff5e1b2a", blood: "ff6e141a",
  purple: "ff5a3a6e", violet: "ff6a4a8a", blue: "ff3a5080", navy: "ff26304e", green: "ff3f5e3a", emerald: "ff2f6a4a", teal: "ff2f6a6a",
  gold: "ffb08a3a", golden: "ffb08a3a", yellow: "ffc0a040", orange: "ffb0602a", brown: "ff6b4a32", black: "ff2c2626", grey: "ff6e6a66",
  gray: "ff6e6a66", white: "ffd8d2c4", ivory: "ffd8ceb4", pink: "ffb07080",
};

/** ARGB for a color name ("crimson", "dark red", "faded gold") or a hex value. */
export function colorOf(c?: string): string | undefined {
  if (!c) return undefined;
  const k = c.trim().toLowerCase();
  const hex = k.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(hex)) return `ff${hex}`;
  if (/^[0-9a-f]{8}$/.test(hex)) return hex;
  const base = k.split(/[\s-]+/).reverse().find((w) => NAMED[w]);
  if (!base) return undefined;
  let col = NAMED[base]!;
  const f = /\b(dark|deep|faded|old|dull)\b/.test(k) ? 0.72 : /\b(bright|light|pale)\b/.test(k) ? 1.25 : 1;
  if (f !== 1) {
    col = "ff" + [2, 4, 6].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(col.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("");
  }
  return col;
}

const FRAYED = /fray|torn|tatter|rag|worn|old|shred|threadbare|moth|rotten|ruin/i;

// ---------------------------------------------------------------------------------------
// Gates

/**
 * Gate art with a frame drawn into the map and closed leaves Foundry draws (and swings).
 * `box` is where the closed leaves sit in the `leaves` image, as fractions of its size;
 * the frame is placed so that box's center lands on the door's center on the wall.
 */
export interface GateArt {
  frame: string;
  /** Art with the leaves shut; the same as `frame` when the leaves are cut out of one drawing. */
  leaves: string;
  pack: RegExp;
  box: [number, number, number, number];
  /** Where it goes: the entrance from outside, or a gate between rooms. */
  use: "entrance" | "inner";
  /** "toward": the art rises into the room you approach from; "away": it stands upright for someone approaching (front-view drawings). */
  rise: "toward" | "away";
}

export const GATE_ARTS: GateArt[] = [
  // Measured from the difference between the closed and open drawings (pixels 232-874 x 180-462 of 1106x530).
  { frame: "Gate - Iron - Door (Open)", leaves: "Gate - Iron - Door (Closed)", pack: /Living Depths/i, box: [0.2098, 0.3396, 0.7902, 0.8717], use: "inner", rise: "toward" },
  // Wrought-iron double gate between gargoyle pillars; the leaves span columns 0.245-0.77, arch top to base.
  { frame: "Iron Fence Gate 2", leaves: "Iron Fence Gate 2", pack: /Haunted Graveyard/i, box: [0.245, 0.19, 0.77, 0.825], use: "entrance", rise: "away" },
];

export interface GateLeaf {
  /** Index into layout.doors. */
  door: number;
  /** Image holding both closed leaves, and where in it (fractions). */
  asset: string;
  box: [number, number, number, number];
  /** The leaves stand on the wall line by their bottom edge and rise toward `side`. */
  side: [number, number];
  /** The leaves are part of the frame's own drawing: cut them out where Foundry draws them. */
  erase?: boolean;
}

/** Room a door is approached from: the one nearer the main entrance (or outside). */
function approach(ctx: Ctx, d: DoorPlacement): string {
  if (d.between[1] === "outside") return "outside";
  const main = ctx.layout.doors.find((x) => x.main)?.between[0];
  if (ctx.layout.spine && d.between.includes(ctx.layout.spine.zone)) return ctx.layout.spine.zone;
  const dist = new Map<string, number>(main ? [[main, 0]] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of ctx.layout.doors) {
      const [a, b] = x.between;
      if (b === "outside") continue;
      if (dist.has(a) && !dist.has(b)) { dist.set(b, dist.get(a)! + 1); grew = true; }
      if (dist.has(b) && !dist.has(a)) { dist.set(a, dist.get(b)! + 1); grew = true; }
    }
  }
  const [a, b] = d.between;
  return (dist.get(a) ?? 99) <= (dist.get(b) ?? 99) ? a : b;
}

/** Unit normal of a door's wall pointing toward the zone (or outside). */
function normalToward(ctx: Ctx, d: DoorPlacement, zone: string): Vec {
  const n: Vec = [d.dir[1], -d.dir[0]];
  const probe = add(d.at, n, 0.5);
  const z = ctx.layout.zones.find((x) => !x.outdoor && probe[0] > x.rect.x && probe[0] < x.rect.x + x.rect.w && probe[1] > x.rect.y && probe[1] < x.rect.y + x.rect.h);
  const hit = z?.id ?? "outside";
  return hit === zone ? n : [-n[0], -n[1]];
}

/** Places an object so that a point of its image (fractions) lands on `at`. */
function placeByImagePoint(ctx: Ctx, a: AssetRecord, frac: Vec, at: Vec, rot: number, scale: number, layer: number, zone: string, feature: string): ReturnType<typeof place> {
  const off: Vec = [((frac[0] - 0.5) * a.size[0]) / PX_PER_SQUARE, ((frac[1] - 0.5) * a.size[1]) / PX_PER_SQUARE];
  const center = add(at, rotate(off, rot), -scale);
  // place() takes the visible center; convert from the image center.
  const visible = add(center, rotate(artOffset(a), rot), scale);
  return place(ctx, { asset: a, role: a.tag?.role ?? "gate", at: visible, rot, scale, layer, zone, feature, occupy: "force", light: false });
}

/**
 * Frames, towers and flanking lights for gates. Returns where Foundry finds each gate's
 * closed leaves (doors without frame art use their portal texture; generate.ts decides).
 */
export function dressGates(ctx: Ctx, rooms: Room[]): GateLeaf[] {
  const out: GateLeaf[] = [];
  ctx.layout.doors.forEach((d, i) => {
    if (!d.gate || d.broken) return;
    const w = d.width ?? 3;
    const from = approach(ctx, d);
    const n = normalToward(ctx, d, from);
    const inside = d.between.find((z) => z !== from && z !== "outside") ?? d.between[0];
    const zone = from === "outside" ? d.between[0] : from;
    const along: Vec = [d.dir[0], d.dir[1]];
    if (from === "outside") {
      // A grand entrance gate from art (gothic): the frame stands upright for those approaching.
      const entry = ctx.plan.genre === "gothic" ? GATE_ARTS.filter((g) => g.use === "entrance").map((g) => ({ g, frame: ctx.cat.named(g.frame, g.pack)[0] })).find((x) => x.frame) : undefined;
      const inRoom = rooms.find((r) => r.zone.id === d.between[0]);
      if (entry && inRoom) {
        const { g, frame } = entry;
        const boxW = ((g.box[2] - g.box[0]) * frame!.size[0]) / PX_PER_SQUARE;
        let scale = w / boxW;
        const roomW = Math.abs(along[0]) ? inRoom.inner.w : inRoom.inner.h;
        const fullW = ((frame!.trim?.[2] ?? frame!.size[0]) / PX_PER_SQUARE) * scale;
        if (fullW > roomW + 0.4) scale *= (roomW + 0.4) / fullW;
        const rise: Vec = g.rise === "away" ? [-n[0], -n[1]] : n;
        const rot = rotationFor(frame!, [-rise[0], -rise[1]]);
        placeByImagePoint(ctx, frame!, [(g.box[0] + g.box[2]) / 2, g.box[3]], d.at, rot, scale, LAYER.overhead, d.between[0], "gate_frame");
        out.push({ door: i, asset: frame!.id, box: g.box, side: rise, erase: g.leaves === g.frame });
        const depth = ((g.box[3] - (frame!.trim ? frame!.trim[1] / frame!.size[1] : 0)) * frame!.size[1] * scale) / PX_PER_SQUARE;
        const fw = fullW * (scale / (w / boxW));
        ctx.grid.mark(rectAt(add(d.at, rise, depth / 2), Math.abs(along[0]) ? [fw, depth] : [depth, fw]), Cell.Solid, true);
        const fire = pick(ctx, zone, "brazier", { maxSide: 1.4 });
        if (fire) for (const sgn of [-1, 1]) {
          place(ctx, { asset: fire, role: "brazier", at: add(add(d.at, along, sgn * (w / 2 + 0.3)), n, 1.8), rot: 0, layer: LAYER.furniture, zone, feature: "gate_braziers", occupy: "force", light: LIGHTS.brazier });
        }
        return;
      }
      // Set into a bigger building (enclosed): guardian statues flank the gate on the approach.
      if (ctx.layout.approach) {
        const guard = ctx.cat.ofRole("statue").filter((a) => {
          const [fw, fh] = a.footprint!;
          return Math.min(fw, fh) >= 0.8 && Math.max(fw, fh) <= 1.8 && a.tag!.fit >= 2 && a.tag!.condition !== "broken" && (a.look?.chroma ?? 0) < 16 && (a.look?.meanLab[0] ?? 50) < 50 && /gargoyle|demon|harpy|guardian|knight|warrior|angel/i.test(a.name) && !/small|mini|ice|gold|crystal|garden|fountain|bust|base|plinth|pedestal|claw|crumbl|head|bright|white|light|marble/i.test(a.name);
        }).sort((a, b) => a.id.localeCompare(b.id));
        const g = guard.length ? ctx.rng.pick(guard) : undefined;
        for (const sgn of [-1, 1]) {
          if (g) place(ctx, { asset: g, role: "statue", at: add(add(d.at, along, sgn * (w / 2 + 0.75)), n, 0.85), rot: rotationFor(g, n), layer: LAYER.furniture, zone, feature: "gate_guards", occupy: "force", light: false });
        }
        const fire = pick(ctx, zone, "brazier", { maxSide: 1.4 });
        if (fire) for (const sgn of [-1, 1]) {
          place(ctx, { asset: fire, role: "brazier", at: add(add(d.at, along, sgn * (w / 2 + 0.3)), n, 2.3), rot: 0, layer: LAYER.furniture, zone, feature: "gate_braziers", occupy: "force", light: LIGHTS.brazier });
        }
        return;
      }
      // A castle gate: round towers astride the wall on both sides, braziers in front.
      const tower = ctx.cat.named("Gatehouse, tower, roof (4x4)")[0];
      if (tower && ctx.plan.genre) {
        const r = Math.max(...tower.footprint!) / 2;
        for (const sgn of [-1, 1]) {
          const at = add(add(d.at, along, sgn * (w / 2 + r * 0.9)), n, r * 0.35);
          place(ctx, { asset: tower, role: "tower", at, rot: ctx.rng.range(0, Math.PI * 2), layer: LAYER.overhead, zone, feature: "gate_towers", occupy: "force", light: false });
        }
      }
      const fire = pick(ctx, zone, "brazier", { maxSide: 1.4 });
      if (fire) for (const sgn of [-1, 1]) {
        place(ctx, { asset: fire, role: "brazier", at: add(add(d.at, along, sgn * (w / 2 + 0.2)), n, 1.6), rot: 0, layer: LAYER.furniture, zone, feature: "gate_braziers", occupy: "force", light: LIGHTS.brazier });
      }
      return;
    }
    const room = rooms.find((r) => r.zone.id === from);
    void inside;
    // Frame art for gothic gates; scaled so its leaves span the opening, never wider than the room.
    const art = ctx.plan.genre === "gothic" ? GATE_ARTS.filter((g) => g.use === "inner").map((g) => ({ g, frame: ctx.cat.named(g.frame, g.pack)[0], leaves: ctx.cat.named(g.leaves, g.pack)[0] })).find((x) => x.frame && x.leaves) : undefined;
    let frameW = w, frameDepth = 0.4;
    if (art && room) {
      const { g, frame, leaves } = art;
      const boxW = ((g.box[2] - g.box[0]) * leaves!.size[0]) / PX_PER_SQUARE;
      let scale = w / boxW;
      const roomW = Math.abs(along[0]) ? room.inner.w : room.inner.h;
      const fullW = (frame!.size[0] / PX_PER_SQUARE) * scale;
      if (fullW > roomW - 0.2) scale *= (roomW - 0.2) / fullW;
      // The art's bottom edge is the wall line; the arch rises into the approach room.
      const rot = rotationFor(frame!, [-n[0], -n[1]]);
      const cx = (g.box[0] + g.box[2]) / 2;
      placeByImagePoint(ctx, frame!, [cx, g.box[3]], d.at, rot, scale, LAYER.overhead, from, "gate_frame");
      frameW = (frame!.footprint![0]) * scale;
      const depth = (g.box[3] * frame!.size[1]) / PX_PER_SQUARE * scale;
      frameDepth = depth;
      out.push({ door: i, asset: leaves!.id, box: g.box, side: n });
      // The frame stands in front of the wall: keep furniture off it.
      ctx.grid.mark(rectAt(add(d.at, n, depth / 2), Math.abs(along[0]) ? [frameW, depth] : [depth, frameW]), Cell.Solid, true);
    }
    // Lights flank the gate on the approach side, in front of its frame.
    if (room) {
      const lightRole = ["candelabra", "brazier", "torch"].find((r) => !forbidden(ctx, from, r) && pick(ctx, from, r, { maxSide: 1.3, lit: true }));
      const lamp = lightRole ? pick(ctx, from, lightRole, { maxSide: 1.3, lit: true }) : undefined;
      if (lamp) for (const sgn of [-1, 1]) {
        for (const [off, out] of [[frameW / 2 + 0.25, 0.6], [w / 2 + 0.1, frameDepth + 0.55], [w / 2 - 0.3, frameDepth + 0.9]] as Array<[number, number]>) {
          const at = add(add(d.at, along, sgn * off), n, out);
          if (place(ctx, { asset: lamp, role: lightRole!, at, rot: 0, layer: LAYER.furniture, zone: from, feature: "gate_lights", occupy: "solid" })) break;
        }
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------
// Wrecked gates

/**
 * A gate blown apart from the far side: the opening gapes, its leaves and bars lie thrown
 * across the floor in front of it, scorched stone and rubble fan out. Medieval wrecks are
 * bent iron and portcullis bars; sci-fi wrecks are warped plates, a door slab and live wires.
 */
export function dressWrecks(ctx: Ctx, rooms: Room[]): void {
  void rooms;
  ctx.layout.doors.forEach((d) => {
    if (!d.broken) return;
    const w = d.width ?? 2;
    const from = approach(ctx, d);
    const zone = from === "outside" ? d.between[0] : from;
    const back = d.between.find((z) => z !== from && z !== "outside" && z !== "beyond");
    const n = normalToward(ctx, d, from);
    const along: Vec = [d.dir[0], d.dir[1]];
    const rng = ctx.rng;
    const at = (depth: number, spread: number): Vec => add(add(d.at, n, depth), along, spread);
    const lay = (a: AssetRecord | undefined, p: Vec, scale: number, layer: number, feature: string, rot = rng.range(0, Math.PI * 2), z = zone) => {
      if (!a) return undefined;
      // Wreckage lies on open floor: never over the gate frame or the walls.
      const box = rectAt(p, aabb(a, rot, scale), -0.15);
      if (layer >= LAYER.floorClutter && !ctx.grid.fits(box, (c) => c !== Cell.Wall && c !== Cell.Solid)) return undefined;
      return place(ctx, { asset: a, role: a.tag?.role ?? "debris", at: p, rot, scale, layer, zone: z, feature, occupy: "force", light: false });
    };
    // Blast marks: round bursts, sized to the opening (sci-fi ones still glow).
    const bursts = ctx.cat.ofRole("scorch").filter((a) => /scorch \d|soot stains - 6/i.test(a.name) && (d.broken === "scifi" ? true : !/glowing/i.test(a.name)) && Math.min(...a.footprint!) >= 0.7);
    const burst = (size: number, depth: number, z: string) => {
      const a = bursts.length ? rng.pick(bursts) : undefined;
      if (a) lay(a, at(depth, rng.range(-0.2, 0.2)), size / Math.max(...a.footprint!), LAYER.decal, "wreck_scorch", undefined, z);
    };
    burst(w * 0.95, 0.8, zone);
    burst(w * 0.6, 1.8, zone);
    if (back) burst(w * 0.55, -0.7, back);
    const cracks = ctx.cat.ofRole("crack").filter((a) => /crack|gouge|shatter/i.test(a.name) && !/crater|prefab|dirt|wood|floorboard|rubble/i.test(a.name) && Math.max(...a.footprint!) <= 2.2);
    for (let k = 0; k < 2 && cracks.length; k++) lay(rng.pick(cracks), at(rng.range(0.4, 1.4), rng.range(-w / 2, w / 2)), rng.range(0.8, 1.1), LAYER.decal, "wreck_cracks");
    const rubble0 = ctx.cat.ofRole("debris").filter((a) => /rubble|stone|brick/i.test(a.name) && Math.max(...a.footprint!) <= 1.8 && !/wood|plank|paper|food|glass|forest|overgrown|celestial|icy|iridescent|blueish|reddish|greenish|sandstone|crystal|gold|lava/i.test(a.name));
    // Rubble matches the stone around it: dark in a dark castle.
    const darkRubble = rubble0.filter((a) => (a.look?.meanLab[0] ?? 50) < 42 && !/white/i.test(a.name));
    const rubble = ctx.style.dark && darkRubble.length >= 2 ? darkRubble : rubble0;
    for (let k = 0, t = 0; k < 5 && t < 15 && rubble.length; t++) if (lay(rng.pick(rubble), at(rng.range(0.4, 2.6), rng.range(-w / 2 - 0.6, w / 2 + 0.6)), rng.range(0.6, 0.95), LAYER.floorClutter, "wreck_rubble")) k++;
    if (d.broken === "medieval") {
      const leaf = ctx.cat.ofRole("gate").filter((a) => a.tag?.condition === "broken");
      // The two bent leaves: one flung into the room, one hanging askew in the gap.
      const sc = Math.max(0.9, (w * 0.55) / (leaf[0]?.footprint?.[0] ?? 2));
      for (let t = 0; t < 6 && !lay(leaf[0], at(rng.range(1.4, 2.4), rng.range(-0.5, 0.5) * w), sc, LAYER.furniture, "wreck_gate"); t++);
      lay(leaf[0], at(0.55, rng.range(-0.2, 0.2) * w), sc * 0.95, LAYER.furniture, "wreck_gate", Math.atan2(along[1], along[0]) + rng.range(-0.5, 0.5));
    } else {
      const plates = ctx.cat.offGenre("scifi", "debris").filter((a) => /warped/i.test(a.name));
      const wires = ctx.cat.offGenre("scifi", "debris").filter((a) => /wire/i.test(a.name));
      const slab = ctx.cat.offGenre("scifi", "door").sort((a, b) => Math.abs(a.footprint![0] - w * 0.6) - Math.abs(b.footprint![0] - w * 0.6))[0];
      const shuffled = rng.shuffle([...plates]);
      for (let k = 0; k < Math.min(3, shuffled.length); k++) {
        for (let t = 0; t < 6 && !lay(shuffled[k], at(rng.range(0.9, 2.8), (k - 1) * w * 0.38 + rng.range(-0.4, 0.4)), rng.range(0.55, 0.8), LAYER.furniture, "wreck_plates"); t++);
      }
      for (let t = 0; t < 6 && slab && !lay(slab, at(rng.range(1.6, 2.6), rng.range(-0.3, 0.3) * w), (w * 0.75) / slab.footprint![0], LAYER.furniture, "wreck_door", Math.atan2(along[1], along[0]) + rng.range(-0.9, 0.9)); t++);
      // Torn cables still spark in the gap.
      for (let k = 0; k < Math.min(2, wires.length); k++) {
        const p = lay(rng.pick(wires), at(rng.range(0.1, 0.6), (k ? 1 : -1) * w * 0.32), rng.range(0.55, 0.75), LAYER.floorClutter, "wreck_wires");
        if (p && k === 0) p.light = { range: 1.6, color: "ff8fc8f0", intensity: 0.55 };
      }
    }
  });
}

// ---------------------------------------------------------------------------------------
// Gallery walls

/** Art in mirrored pairs along both long walls, statues or armor between, wall lights in the rhythm. */
export function runGallery(ctx: Ctx, room: Room, step: GalleryStep): void {
  const zone = room.zone.id;
  const { inner } = room;
  const horiz = inner.w >= inner.h;
  const sides = room.sides.filter((s) => (horiz ? s.along[0] !== 0 : s.along[1] !== 0));
  if (sides.length !== 2) return;
  const len = sides[0]!.length;
  const margin = 0.7;
  const n = Math.max(1, Math.floor((len - 2 * margin) / step.every));
  const pitch = (len - 2 * margin) / n;
  // Openings in either long wall block the slot on both walls, so the pairs stay mirrored.
  const blocked = (t: number, half: number) => room.doors.some((d) => {
    const s = sides.find((x) => x.side === d.side);
    if (!s) return false;
    const td = s.along[0] ? d.at[0] - s.origin[0] : d.at[1] - s.origin[1];
    return Math.abs(td - t) < (d.width ?? 1) / 2 + half + 0.35;
  });
  const artRole = step.art.find((r) => !forbidden(ctx, zone, r) && galleryArt(ctx, r).length);
  const targetW = Math.min(pitch - 0.9, 2.1);
  if (artRole) {
    const pool = galleryArt(ctx, artRole);
    const deck = ctx.rng.shuffle([...pool]);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = margin + (i + 0.5) * pitch;
      if (blocked(t, targetW / 2)) continue;
      for (const s of sides) {
        // Every painting different while the deck lasts.
        const a = deck[k++ % deck.length];
        if (!a) continue;
        const { width, depth } = frontSize(a);
        const scale = Math.max(1, Math.min(4, targetW / width));
        const p = sidePoint(s, t, (depth * scale) / 2 - INSET * 0.55);
        place(ctx, { asset: a, role: artRole, at: p, rot: rotationFor(a, s.inward), scale, layer: LAYER.overhead, zone, feature: step.id, occupy: "force", light: false });
      }
    }
  }
  // Between the paintings: a standing piece, or a wall light, alternating.
  const lightRole = step.lights.find((r) => !forbidden(ctx, zone, r) && pick(ctx, zone, r, { placement: ["wallmount"], lit: true }));
  const lamp = lightRole ? pick(ctx, zone, lightRole, { placement: ["wallmount"], lit: true }) : undefined;
  const standDeck = galleryStands(ctx, zone, step);
  for (let i = 0; i <= n; i++) {
    const t = margin + i * pitch;
    const light = i % 2 === 0;
    if (light) {
      if (!lamp || blocked(t, 0.3)) continue;
      for (const s of sides) {
        const { depth } = frontSize(lamp);
        place(ctx, { asset: lamp, role: lightRole!, at: sidePoint(s, t, depth / 2 - INSET * 0.8), rot: rotationFor(lamp, s.inward), layer: LAYER.overhead, zone, feature: `${step.id}_lights`, occupy: "force", light: LIGHTS[lightRole!] ?? LIGHTS.sconce });
      }
      continue;
    }
    const got = standDeck.length ? standDeck[(i >> 1) % standDeck.length] : pickWeighted(ctx, zone, step.stands, { maxSide: 1.5, composite: false });
    if (!got || blocked(t, 0.6)) continue;
    const { width, depth } = frontSize(got.asset);
    if (width > pitch - 0.3) continue;
    // Mirrored: the same piece faces its twin across the hall.
    for (const s of sides) {
      const p = sidePoint(s, t, depth / 2 + 0.06);
      place(ctx, { asset: got.asset, role: got.role, at: p, rot: rotationFor(got.asset, s.inward), layer: LAYER.furniture, zone, feature: `${step.id}_stands`, occupy: "solid" });
    }
  }
}

/** Hung art for a gallery: face-on canvases of a decent size first (edge-on frames read as windows). */
function galleryArt(ctx: Ctx, role: string): AssetRecord[] {
  const all = ctx.cat.ofRole(role).filter((a) => a.tag!.placement === "wallmount" && a.tag!.fit >= 2 && !/whimsical|modern|exotic/.test(a.tag!.style ?? "") && !/perspective|isometric/i.test(a.name));
  const faceOn = all.filter((a) => /face-on|drawn flat/i.test(a.tag!.note ?? "") && !/edge-on/i.test(a.tag!.note ?? ""));
  const list = faceOn.length >= 4 ? faceOn : all;
  const gothic = ctx.plan.genre === "gothic" ? list.filter((a) => a.tag!.style === "gothic" || a.tag!.condition === "worn") : [];
  const pick2 = gothic.length >= 4 ? [...gothic, ...list.filter((a) => !gothic.includes(a)).slice(0, 4)] : list;
  return pick2.sort((a, b) => a.id.localeCompare(b.id));
}

/** Statues and armor for a gallery: life-size pieces (0.7 to 1.5 squares), intact. */
function galleryStands(ctx: Ctx, zone: string, step: GalleryStep): Array<{ role: string; asset: AssetRecord }> {
  const out: Array<{ role: string; asset: AssetRecord }> = [];
  for (const [role, wgt] of step.stands) {
    if (forbidden(ctx, zone, role)) continue;
    const list = ctx.cat.ofRole(role).filter((a) => {
      const [w, h] = a.footprint!;
      return Math.min(w, h) >= 0.7 && Math.max(w, h) <= 1.7 && a.tag!.fit >= 2 && a.tag!.condition !== "broken" && !/whimsical|modern|exotic/.test(a.tag!.style ?? "") && (a.look?.chroma ?? 0) < 24 && !/perspective|isometric|gold|crystal|ice|snow|frozen|small|mini|bust|head|toy|garden|fountain/i.test(a.name);
    });
    // A dark castle wants dark stone and iron, not white marble.
    const shade = ctx.style.dark ? list.filter((a) => (a.look?.meanLab[0] ?? 50) < 50 && !/bright|white|marble|light/i.test(a.name)) : list;
    if (shade.length >= 2) list.splice(0, list.length, ...shade);
    const pref = list.filter((a) => a.tag!.style === "gothic" || a.tag!.style === "ornate");
    const use = (pref.length >= 2 ? pref : list).sort((a, b) => a.id.localeCompare(b.id));
    for (let k = 0; k < Math.min(use.length, Math.ceil(wgt)); k++) out.push({ role, asset: ctx.rng.pick(use) });
  }
  return ctx.rng.shuffle(out);
}

// ---------------------------------------------------------------------------------------
// Carpets

/** One long carpet down the room, centered on its gates; worn carpets tear, fray and gap. */
export function runRunner(ctx: Ctx, room: Room, step: RunnerStep, mods: ModifyDirective[]): void {
  const zone = room.zone.id;
  if (forbidden(ctx, zone, "runner") || forbidden(ctx, zone, "rug")) return;
  const { inner } = room;
  const horiz = inner.w >= inner.h;
  const len = horiz ? inner.w : inner.h, across = horiz ? inner.h : inner.w;
  const color = colorOf(mods.find((m) => m.color)?.color);
  const cond = mods.find((m) => m.condition)?.condition ?? "";
  const frayed = FRAYED.test(cond) || (!cond && (ctx.wear === "ruined" || ctx.wear === "grimy"));
  // Centered on a door in a short wall (the gates), else on the room.
  const shortDoor = room.doors.find((d) => (horiz ? d.side === "west" || d.side === "east" : d.side === "north" || d.side === "south"));
  const c0 = shortDoor ? (horiz ? shortDoor.at[1] : shortDoor.at[0]) : horiz ? inner.y + inner.h / 2 : inner.x + inner.w / 2;
  const width = Math.max(1.3, Math.min(3, across * step.width));
  const plain = ctx.cat.ofRole("runner").filter((a) => a.tag!.condition !== "broken" && a.tag!.placement === "rug" && !/perspective|isometric/i.test(a.name));
  const long = plain.filter((a) => Math.max(...a.footprint!) >= 5 && Math.min(...a.footprint!) <= 2.8 && (a.tag!.tone === "tintable" || (!color && (a.look?.chroma ?? 0) < 22)));
  const piece = long.length ? ctx.rng.pick([...long].sort((a, b) => a.id.localeCompare(b.id))) : pick(ctx, zone, "runner", { placement: ["rug"], composite: false });
  if (!piece) return;
  const torn = ctx.cat.ofRole("rug_torn").filter((a) => (a.tag!.tone === "tintable" || a.colorable) && a.footprint![0] > a.footprint![1] * 2).sort((a, b) => a.id.localeCompare(b.id));
  const tornPiece = torn[0];
  const start = 0.45, end = len - 0.75;
  const total = end - start;
  // Stretches along the hall: plain carpet, with a torn stretch and a ragged end when frayed.
  type Seg = { asset: AssetRecord; len: number; torn: boolean };
  const segs: Seg[] = [];
  if (frayed && tornPiece && total > 9) {
    const tMid = Math.min(3.6, total * 0.18), tEnd = Math.min(2.8, total * 0.14);
    const plainLen = total - tMid - tEnd;
    const cut = ctx.rng.range(0.38, 0.62);
    segs.push({ asset: piece, len: plainLen * cut, torn: false }, { asset: tornPiece, len: tMid, torn: true }, { asset: piece, len: plainLen * (1 - cut), torn: false }, { asset: tornPiece, len: tEnd, torn: true });
  } else segs.push({ asset: piece, len: total, torn: false });
  if (ctx.rng.next() < 0.5) segs.reverse();
  const axis: Vec = horiz ? [1, 0] : [0, 1];
  const perp: Vec = horiz ? [0, 1] : [1, 0];
  const origin: Vec = horiz ? [inner.x, c0] : [c0, inner.y];
  let u = start;
  for (const seg of segs) {
    const a = seg.asset;
    const aLong = Math.max(...a.footprint!), aShort = Math.min(...a.footprint!);
    const sc = width / aShort;
    // Tiles of at most one piece's length, stretched along the hall to fill the stretch exactly.
    const k = Math.max(1, Math.round(seg.len / (aLong * sc)));
    const tile = seg.len / k;
    const overlap = seg.torn ? 0.1 : 0.18;
    const stretch = (tile + overlap) / (aLong * sc);
    const base = (a.footprint![0] >= a.footprint![1]) === horiz ? 0 : Math.PI / 2;
    for (let i = 0; i < k; i++) {
      const at = add(add(origin, axis, u + (i + 0.5) * tile), perp, frayed ? ctx.rng.range(-0.05, 0.05) : 0);
      const rot = base + (ctx.rng.next() < 0.5 ? Math.PI : 0) + (frayed ? ctx.rng.range(-0.012, 0.012) : 0);
      place(ctx, { asset: a, role: "runner", at, rot, scale: sc, stretch, layer: LAYER.rug, zone, feature: step.id, occupy: "low", color: color ?? ctx.style.fabric, light: false });
    }
    u += seg.len;
  }
  // Keep furniture off the carpet.
  ctx.grid.mark(rectAt(add(origin, axis, start + total / 2), horiz ? [total, width] : [width, total]), Cell.Path, true);
  if (!frayed) return;
  // Grime ground into a worn carpet, and threads of it torn loose.
  const stains = [...ctx.cat.ofRole("grime"), ...ctx.cat.ofRole("dirt"), ...ctx.cat.ofRole("stain")].filter((a) => Math.max(...a.footprint!) <= 1.4 && /dust|dirt|grime|stain|smudge|water|scuff/i.test(a.name) && !/grass|leaf|snow|mud|honey|paint|oil|track|paw|food|wine/i.test(a.name));
  for (let k = 0; k < Math.round(total / 4) && stains.length; k++) {
    const at = add(add(origin, axis, start + ctx.rng.range(0.5, total - 0.5)), perp, ctx.rng.range(-width / 3, width / 3));
    place(ctx, { asset: ctx.rng.pick(stains), role: "stain", at, rot: ctx.rng.range(0, Math.PI * 2), scale: ctx.rng.range(0.6, 0.95), layer: LAYER.floorClutter, zone, feature: `${step.id}_wear`, occupy: "low", light: false });
  }
  for (let k = 0; k < 2 && tornPiece; k++) {
    const at = add(add(origin, axis, start + ctx.rng.range(1, total - 1)), perp, (ctx.rng.next() < 0.5 ? -1 : 1) * (width / 2 + ctx.rng.range(0.25, 0.6)));
    place(ctx, { asset: tornPiece, role: "runner", at, rot: ctx.rng.range(0, Math.PI * 2), scale: 0.22, layer: LAYER.rug, zone, feature: `${step.id}_scraps`, occupy: "low", color: color ?? ctx.style.fabric, light: false });
  }
}
