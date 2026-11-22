/**
 * Converts a Dungeondraft map into Foundry VTT (v13) scene data: walls, doors, windows and
 * lights, in scene pixels at the render's pixels-per-square. See DESIGN.md section 12.
 */

import { PX_PER_SQUARE } from "../assets/model";
import { parseVector2, parseVector2Array, type Vec2 } from "../ddmap/godot";
import type { Shelter } from "../gen/layout";
import { handRotation, type SundialOut } from "../gen/sundial";

/** Foundry wall sense values (CONST.WALL_SENSE_TYPES): none 0, limited 10, normal 20. */
const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20 } as const;
/** Foundry door types (CONST.WALL_DOOR_TYPES): none 0, door 1, secret 2. */
const DOOR = { NONE: 0, DOOR: 1 } as const;
/** Lamps and fires shine once the scene is at least this dark (dawn, dusk and night on the module's clock). */
export const LAMPS_LIT_FROM = 0.25;
/** Foundry door states (CONST.WALL_DOOR_STATES). */
const DOOR_STATE = { closed: 0, open: 1, locked: 2 } as const;

/** What the generator knows about a door (generate.ts ElementInfo), by portal node id. */
export interface DoorMeta {
  state?: "closed" | "locked" | "open";
  width?: number;
  leaf?: { px: number; align: "center" | "edge"; side?: [number, number]; erase?: boolean };
}

/** Foundry door animation (Wall.animation); `texture` starts as "leaf:<portal id>" until uploaded. */
export interface FoundryDoorAnimation {
  type: string;
  double: boolean;
  direction: 1 | -1;
  duration: number;
  flip: boolean;
  strength: number;
  texture: string;
}

export interface FoundryWall {
  c: [number, number, number, number];
  move: number;
  sight: number;
  light: number;
  sound: number;
  door: number;
  ds: number;
  animation?: FoundryDoorAnimation;
  flags: Record<string, unknown>;
}

export interface FoundryLight {
  x: number;
  y: number;
  /** Off until something turns it on (a sundial's gem). */
  hidden?: boolean;
  config: { dim: number; bright: number; color: string; alpha: number; attenuation?: number; luminosity?: number; animation?: { type: string; speed: number; intensity: number }; darkness: { min: number; max: number } };
  flags: Record<string, unknown>;
}

/** A tile the module uploads an image for (`texture.src` starts as "hand:<hand>" for a sundial's shadow). */
export interface FoundryTile {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  alpha: number;
  sort: number;
  texture: { src: string };
  flags: Record<string, unknown>;
}

/** A map pin for the GM alone (no journal entry): on a sundial, the way down, which builds `place` when double-clicked. */
export interface FoundryPin {
  x: number;
  y: number;
  text: string;
  icon: string;
  place?: string;
  flags: Record<string, unknown>;
}

/** Someone standing on the map as a token (scene pixels, top-left corner), with stats by `kind`. */
export interface FoundryCastToken {
  name: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
}

export interface FoundrySceneData {
  name: string;
  width: number;
  height: number;
  padding: number;
  grid: { type: 1; size: number; distance: number; units: string };
  /** 0 (bright) to 1 (dark). */
  darkness: number;
  walls: FoundryWall[];
  lights: FoundryLight[];
  /** Where the weather stays out, as Foundry polygon points (x, y, x, y...); holes cut open sky out. The module makes one Suppress Weather region of them. */
  sheltered: Array<{ points: number[]; hole?: boolean }>;
  notes: string;
  /** Set pieces: a sundial's hands (tiles), its way down (a pin) and the frozen cast (tokens), with what the GM's crank needs in `flags.sundial`. */
  tiles?: FoundryTile[];
  pins?: FoundryPin[];
  tokens?: FoundryCastToken[];
  flags?: Record<string, unknown>;
}

export interface SceneOptions {
  name: string;
  /** Pixels per grid square of the background image. */
  pps: number;
  gridDistance?: number;
  gridUnits?: string;
  credit?: string;
  /** Door states and gate leaves, by portal node id. */
  doors?: Record<string, DoorMeta>;
  /** Wall node ids drawn only for looks (quay and pier edges): no Foundry walls for them. */
  decorative?: Set<string>;
  /** Roofed ground in squares (GeneratedVersion.sheltered). */
  sheltered?: Shelter[];
  /** The sundial set piece of the map (GeneratedVersion.sundial). */
  sundial?: SundialOut;
}

/**
 * A sundial's Foundry side: each hand's shadow as a tile twice its length, pivoting on the tower
 * (its image has the shadow on the upper half, so turning the tile turns the hand round the
 * tower); a hidden coloured light under each gem; a GM-only pin on the way down; the frozen cast as
 * tokens; and in the scene flags what the crank needs: the hands' numerals, which gem answers to
 * which hand, and the key the plaza and the vestibule share.
 */
function sundialScene(sd: SundialOut, pps: number, dist: number): Pick<FoundrySceneData, "tiles" | "pins" | "tokens" | "flags"> & { lights: FoundryLight[] } {
  const P = (p: [number, number]): [number, number] => [Math.round(p[0] * pps), Math.round(p[1] * pps)];
  const [cx, cy] = P(sd.at);
  const flag = (extra: Record<string, unknown>) => ({ "georgios-map-maker": { sundial: { key: sd.key, ...extra } } });
  const tiles: FoundryTile[] = sd.hands.map((h, i) => {
    const L = Math.max(pps, Math.round(h.length * pps));
    const W = Math.max(16, Math.round(h.width * pps * 2.4));
    return { x: cx - Math.round(W / 2), y: cy - L, width: W, height: 2 * L, rotation: handRotation(h.numeral, sd.mirrored), alpha: 1, sort: 10 + i, texture: { src: `hand:${h.hand}` }, flags: flag({ hand: h.hand, numeral: h.numeral, mirrored: sd.mirrored, pivot: [cx, cy] }) };
  });
  const lights: FoundryLight[] = sd.gems.map((g) => {
    const [x, y] = P(g.at);
    return {
      x, y, hidden: true,
      config: { dim: dist * 3, bright: dist, color: g.rgb, alpha: 0.7, attenuation: 0.5, luminosity: 0.6, animation: { type: "pulse", speed: 2, intensity: 4 }, darkness: { min: 0, max: 1 } },
      flags: flag({ gem: g.numeral, color: g.color, hand: g.hand }),
    };
  });
  const pins: FoundryPin[] = [];
  if (sd.door) {
    const [x, y] = P(sd.door);
    pins.push({ x, y, text: "The way down (the hour shadow's tip)", icon: "icons/svg/cave.svg", ...(sd.belowPlace ? { place: sd.belowPlace } : {}), flags: flag({ door: true }) });
  }
  const tokens: FoundryCastToken[] = (sd.cast ?? []).map((m) => ({
    name: m.name, kind: m.kind, x: Math.round((m.x - 0.5) * pps), y: Math.round((m.y - 0.5) * pps),
    // Token art faces down the image: rotation 0 is facing south, turning clockwise.
    rotation: Math.round(((Math.atan2(-m.facing[0], m.facing[1]) * 180) / Math.PI + 360) % 360),
  }));
  const flags = { sundial: { key: sd.key, mirrored: sd.mirrored, stopped: sd.stopped, pivot: [cx, cy], radius: Math.round(sd.radius * pps), gems: sd.gems.map((g) => ({ numeral: g.numeral, color: g.color, hand: g.hand })) } };
  return { tiles, lights, pins, tokens, flags };
}

function argbToHex(argb: string): string {
  return `#${argb.slice(2, 8)}`;
}

/** Splits a wall segment around the doors on it, returning plain and door pieces. */
function splitSegment(a: Vec2, b: Vec2, doors: Array<{ center: Vec2; half: number; closed: boolean; window: boolean; id: string }>): Array<{ a: Vec2; b: Vec2; door?: (typeof doors)[number] }> {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return [];
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const on = doors
    .map((d) => ({ d, t: (d.center[0] - a[0]) * ux + (d.center[1] - a[1]) * uy, off: Math.abs((d.center[0] - a[0]) * -uy + (d.center[1] - a[1]) * ux) }))
    .filter((x) => x.off < 32 && x.t > -1 && x.t < len + 1)
    .sort((x, y) => x.t - y.t);
  const out: Array<{ a: Vec2; b: Vec2; door?: (typeof doors)[number] }> = [];
  let t0 = 0;
  const at = (t: number): Vec2 => [a[0] + ux * t, a[1] + uy * t];
  for (const { d, t } of on) {
    const s = Math.max(t0, t - d.half), e = Math.min(len, t + d.half);
    if (s - t0 > 0.5) out.push({ a: at(t0), b: at(s) });
    if (e - s > 0.5) out.push({ a: at(s), b: at(e), door: d });
    t0 = Math.max(t0, e);
  }
  if (len - t0 > 0.5) out.push({ a: at(t0), b: b });
  return out;
}

export function toFoundryScene(map: Record<string, any>, opts: SceneOptions): FoundrySceneData {
  const world = map.world;
  const level = world.levels["0"];
  const k = opts.pps / PX_PER_SQUARE;
  const dist = opts.gridDistance ?? 5;
  const walls: FoundryWall[] = [];
  const round = (v: number) => Math.round(v * k);
  for (const w of level.walls ?? []) {
    if (opts.decorative?.has(w.node_id)) continue;
    const pts = parseVector2Array(w.points);
    const doors = (w.portals ?? []).map((p: any) => ({
      center: parseVector2(p.position),
      half: p.radius ?? 128,
      closed: p.closed !== false,
      window: /window/i.test(p.texture ?? ""),
      id: p.node_id as string,
    }));
    const n = w.loop ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      for (const piece of splitSegment(a, b, doors)) {
        const isWindow = piece.door?.window;
        const meta = piece.door ? opts.doors?.[piece.door.id] : undefined;
        const ds = piece.door && !isWindow ? (meta?.state ? DOOR_STATE[meta.state] : piece.door.closed ? 0 : 1) : 0;
        const wall: FoundryWall = {
          c: [round(piece.a[0]), round(piece.a[1]), round(piece.b[0]), round(piece.b[1])],
          move: SENSE.NORMAL,
          sight: isWindow ? SENSE.NONE : SENSE.NORMAL,
          // Windows: you see through them, but lamplight stays in (open panes threw searchlight beams across the ground).
          light: SENSE.NORMAL,
          sound: SENSE.NORMAL,
          door: piece.door && !isWindow ? DOOR.DOOR : DOOR.NONE,
          ds,
          flags: { "georgios-map-maker": { wall: w.node_id, portal: piece.door?.id } },
        };
        // Gates: Foundry draws the closed leaves and swings them open.
        if (piece.door && meta?.leaf) {
          const th = Math.atan2(piece.b[1] - piece.a[1], piece.b[0] - piece.a[0]);
          const side = meta.leaf.side ?? [0, 0];
          // The texture's top is the side its leaves rise toward (edge-aligned art).
          const flip = meta.leaf.align === "edge" ? Math.sin(th) * side[0] - Math.cos(th) * side[1] < 0 : false;
          wall.animation = { type: "swing", double: (meta.width ?? 1) >= 2, direction: 1, duration: 1600, flip, strength: 1, texture: `leaf:${piece.door.id}` };
          wall.flags = { ...wall.flags, core: { textureGridSize: meta.leaf.px } };
        }
        walls.push(wall);
      }
    }
  }
  const lights: FoundryLight[] = (level.lights ?? []).map((l: any) => {
    const [x, y] = parseVector2(l.position);
    // Whole grid steps read best in Foundry (5 ft at the default 5 ft grid).
    const dim = Math.max(dist, Math.round(((l.range ?? 5) * dist) / dist) * dist);
    const fire = /^ffff(a|b)/i.test(l.color ?? "");
    return {
      x: round(x),
      y: round(y),
      config: {
        dim,
        // A small bright core and a soft fall-off: pools of light, not floodlights.
        bright: Math.round((dim * 0.35) / dist) * dist,
        color: argbToHex(l.color ?? "ffeccd8b"),
        alpha: Math.min(0.5, 0.3 * (l.intensity ?? 1)),
        attenuation: fire ? 0.75 : 0.6,
        luminosity: 0.45,
        ...(fire ? { animation: { type: "torch", speed: 3, intensity: 3 } } : {}),
        // Off by day: the clock darkens the scene at dusk and they come on.
        darkness: { min: LAMPS_LIT_FROM, max: 1 },
      },
      flags: { "georgios-map-maker": { light: l.node_id } },
    };
  });
  const ambient = level.environment?.ambient_light ?? "ffffffff";
  const lum = (parseInt(ambient.slice(2, 4), 16) * 0.299 + parseInt(ambient.slice(4, 6), 16) * 0.587 + parseInt(ambient.slice(6, 8), 16) * 0.114) / 255;
  const dial = opts.sundial ? sundialScene(opts.sundial, opts.pps, dist) : undefined;
  return {
    name: opts.name,
    width: Math.round(world.width * opts.pps),
    height: Math.round(world.height * opts.pps),
    padding: 0,
    grid: { type: 1, size: opts.pps, distance: dist, units: opts.gridUnits ?? "ft" },
    darkness: Math.round(Math.max(0, Math.min(1, 1 - lum)) * 100) / 100,
    walls,
    lights: dial ? [...lights, ...dial.lights] : lights,
    sheltered: (opts.sheltered ?? []).map((sh) => ({ points: polygonPoints(sh.points, opts.pps), ...(sh.hole ? { hole: true } : {}) })).filter((sh) => sh.points.length >= 6),
    notes: opts.credit ?? "Map assets: 2-Minute Tabletop (CC BY-NC 4.0). Built with Georgios' Map Maker.",
    ...(dial ? { tiles: dial.tiles, pins: dial.pins, tokens: dial.tokens, flags: dial.flags } : {}),
  };
}

/** A ring in squares as Foundry polygon points in scene pixels, without repeated corners (Foundry refuses zero-length edges). */
function polygonPoints(ring: Array<[number, number]>, pps: number): number[] {
  const pts: Array<[number, number]> = [];
  for (const [x, y] of ring) {
    const p: [number, number] = [Math.round(x * pps), Math.round(y * pps)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  while (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
  return pts.flat();
}
