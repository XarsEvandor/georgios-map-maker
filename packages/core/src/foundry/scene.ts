/**
 * Converts a Dungeondraft map into Foundry VTT (v13) scene data: walls, doors, windows and
 * lights, in scene pixels at the render's pixels-per-square. See DESIGN.md section 12.
 */

import { PX_PER_SQUARE } from "../assets/model";
import { parseVector2, parseVector2Array, type Vec2 } from "../ddmap/godot";

/** Foundry wall sense values (CONST.WALL_SENSE_TYPES): none 0, limited 10, normal 20. */
const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20 } as const;
/** Foundry door types (CONST.WALL_DOOR_TYPES): none 0, door 1, secret 2. */
const DOOR = { NONE: 0, DOOR: 1 } as const;
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
  config: { dim: number; bright: number; color: string; alpha: number; attenuation?: number; luminosity?: number; animation?: { type: string; speed: number; intensity: number } };
  flags: Record<string, unknown>;
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
  notes: string;
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
      },
      flags: { "georgios-map-maker": { light: l.node_id } },
    };
  });
  const ambient = level.environment?.ambient_light ?? "ffffffff";
  const lum = (parseInt(ambient.slice(2, 4), 16) * 0.299 + parseInt(ambient.slice(4, 6), 16) * 0.587 + parseInt(ambient.slice(6, 8), 16) * 0.114) / 255;
  return {
    name: opts.name,
    width: Math.round(world.width * opts.pps),
    height: Math.round(world.height * opts.pps),
    padding: 0,
    grid: { type: 1, size: opts.pps, distance: dist, units: opts.gridUnits ?? "ft" },
    darkness: Math.round(Math.max(0, Math.min(1, 1 - lum)) * 100) / 100,
    walls,
    lights,
    notes: opts.credit ?? "Map assets: 2-Minute Tabletop (CC BY-NC 4.0). Built with Georgios' Map Maker.",
  };
}
