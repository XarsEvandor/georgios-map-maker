/**
 * War maps: an army's camp, or the field where armies fight, from 2MT's camp, siege, battle and
 * sci-fi packs. One square is 5 ft.
 *
 * A camp: a palisade (real walls in Foundry) with a gate toward the field and watchtowers at its
 * front corners; the general's command tent at the back, open to show its war table, the general's
 * chair and the army's banners; officers' tents beside it in the army's colour; rows of soldiers'
 * tents along an avenue from the gate; fires with log seats, a supply depot, a horse line, archery
 * butts, siege engines inside the gate and stakes in front of it.
 *
 * A field: grass trampled to dirt and mud, scorched and cratered; each side's barricade line along
 * its edge with its banners; the dead of every side, their shields in their side's colour, nearer
 * their own line; dead horses, arrows, wrecked and burning siege engines; a road out (by the edge the
 * plan names, else a free one); and, when
 * asked, machines standing in glowing craters, joined by cables and glowing.
 */

import { PX_PER_SQUARE as S, type AssetRecord } from "../assets/model";
import { DDMapBuilder } from "../ddmap/builder";
import type { Vec2 } from "../ddmap/godot";
import type { Catalog } from "./catalog";
import { Cell, Grid, LAYER, LIGHTS, makeCtx, place, type Ctx, type Placed } from "./dress";
import type { ElementInfo, GeneratedMap, GeneratedVersion } from "./generate";
import type { Layout, Shelter } from "./layout";
import { noise2, smoothstep } from "./noise";
import type { ScenePlan, Side } from "./plan";
import { Rng } from "./rng";
import { buildStyles, type Wear } from "./style";

type Vec = [number, number];

const AMBIENT = { day: "ffffffff", dusk: "ffd2c2a8", night: "ff6a7290" } as const;
/** The glow of the machines: a sick violet. */
const MACHINE_LIGHT = { range: 7, color: "ffb46cff", intensity: 1 };

/** "#e07b1a" -> "ffe07b1a" (the ARGB Dungeondraft tints with). */
export function argbOf(hex: string): string {
  const h = hex.replace("#", "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(h) ? `ff${h}` : "ffb0b0b0";
}

/** The pieces a war map is made of, picked by name from the packs that have them. */
function warKit(cat: Catalog) {
  const ok = (a: AssetRecord) => !a.error && !!a.footprint && cat.packs.get(a.pack)?.readAllowed !== false;
  const all = cat.index.assets.filter((a) => ok(a));
  const packOf = (a: AssetRecord) => cat.packs.get(a.pack)?.name ?? "";
  const of = (kind: string, name: RegExp, pack?: RegExp) => all.filter((a) => a.kind === kind && name.test(a.name) && (!pack || pack.test(packOf(a)))).sort((a, b) => a.id.localeCompare(b.id));
  const obj = (name: RegExp, pack?: RegExp) => of("object", name, pack);
  const one = (name: RegExp, pack?: RegExp) => obj(name, pack)[0];
  const terrain = (name: RegExp, pack: RegExp) => cat.index.assets.find((a) => a.kind === "terrain" && !a.error && name.test(a.name) && pack.test(packOf(a)) && cat.packs.get(a.pack)?.readAllowed !== false);
  const ORC = /Orc Warcamp/;
  const lit = (list: AssetRecord[]) => list.filter((a) => / - Fire\b|Fire - Torch - Fire/.test(a.name));
  return {
    ground: {
      grass: terrain(/^Texture_grass$/, /Fort Foul Luck/) ?? terrain(/^Lush Grass D - Green - 10x10$/, /Green Hill/),
      dirt: terrain(/^Texture - Dirt - 10x10$/, /Grass & Road Assets 2/),
      mud: terrain(/^Texture_mud$/, /Fort Foul Luck/) ?? terrain(/^Texture - Dirt - 10x10 - Sodden$/, /Grass & Road Assets 2/),
      sodden: terrain(/^Texture - Dirt - 10x10 - Sodden$/, /Grass & Road Assets 2/) ?? terrain(/^Texture_mud$/, /Fort Foul Luck/),
    },
    road: of("path", /^Path - Dirt Path$/, /Farmer's Field/)[0] ?? of("path", /^Ribbon - Dirt Trail_path$/, /Grass & Road Assets 2/)[0],
    trail: of("path", /^Ribbon - Dirt Trail_path$/, /Grass & Road Assets 2/)[0],
    cable: of("path", /^cyberpunkstreet_wires 2 - 4x1$/, /Cyberpunk Street/)[0],
    palisade: of("wall", /^Structure - Palisade - Large_wall$/, ORC)[0],
    gate: one(/^Structure - Palisade - Gate 2 - 7x2$/, ORC),
    tower: one(/^Structure - Tower - 5x5$/, ORC),
    stakes: one(/^Structure - Stakes - 3x2$/, ORC),
    commandTent: one(/^Structure - Tent - Interior 1 - 10x9$/, ORC),
    officerTent: one(/^Structure - Tent - Exterior 2 - 7x7 - Colorable$/, ORC) ?? one(/^Structure - Tent - Exterior 2 - 7x7$/, ORC),
    soldierTents: [...obj(/^Canvas Tent [1-7]$/, /Bandit Camp/), ...obj(/^Canvas Tent \d$/, /Forest Camp/), ...obj(/^Tent, (square|narrow)$/, /Camp Tokens/)],
    rug: one(/^Furniture - Rug 1 - 3x3 - Colorable$/, ORC),
    table: one(/^Makeshift Table/, /Bandit Camp/) ?? one(/^Furniture - Table/, ORC),
    desk: one(/^Writing Desk/, /Bandit Camp/),
    chiefChair: one(/^Furniture - Chair - Chief - 2x2 - Colorable$/, ORC),
    chairs: obj(/^Furniture - Chair \d/, ORC).filter((a) => !a.colorable),
    box: one(/^Furniture - Box/, ORC),
    bannerUp: obj(/^Banner - Upright \d - 2x1 - Colorable$/, ORC),
    bannerDraped: obj(/^Banner - Draped \d - 2x\d - Colorable$/, ORC),
    braziers: lit(obj(/^Fire - Brazier - Metal - Fire/, ORC)),
    campfires: lit(obj(/^Fire - Campfire - Fire/, ORC)),
    bonfires: lit(obj(/^Fire - Bonfire - Fire/, ORC)),
    torches: lit(obj(/^Fire - Torch - Fire/, ORC)),
    logSeats: [...obj(/^Fallen Log Seat/, /Bandit Camp/), ...obj(/^Log seat$/, /Camp Tokens/)],
    bedrolls: [...obj(/^Bedroll/, /Bandit Camp/), ...obj(/^Bedroll$/, /Camp Tokens/)],
    crates: [...obj(/^Crate/, /Bandit Camp/), ...obj(/^Food Crate/, /Bandit Camp/)],
    barrels: obj(/^Barrel/, /Bandit Camp/),
    sacks: [...obj(/^Sacks/, /Bandit Camp/), ...obj(/^Clutter, pile, sack$/, /Camp Tokens/)],
    cargo: one(/^Cart - Cargo - 3x3 - Colorable$/, ORC),
    wagons: [...obj(/^Wagon/, /Forest Camp/), ...obj(/^Bandit Cart \d|^Bandit Cart$/, /Bandit Camp/)],
    horses: obj(/^Animal - Horse \d$/, /Farm Friends/),
    rail: one(/^Structure - Fence - Logs 1 - 3x2$/, ORC),
    targets: obj(/^Archery Target \d - 2x[23]$/, /Archery Range Plus/),
    racks: obj(/^Object - Weapon - (Spear|Sword - Large|Axe - Large)/, ORC),
    siege: obj(/^(Catapult|Ballista|Trebuchet)( \(|, great)/, /Castle Siege Weapons/),
    cauldron: one(/^Food - Cauldron - 2x2$/, ORC),
    barricades: obj(/^Barricade [12] - (Spiked|Logs) - \dx3$/, /Goblin Camp/),
    craters: obj(/^Crater Stamp/, /Fallen Star/),
    glow: obj(/^glowingcrater_glowing crater, (void|magenta)$/, /Glowing Crater/),
    machines: obj(/^Tech - Scfi-Fi Machine \d+ - Dark$/, /Cosmic Lab/).filter((a) => Math.max(...a.footprint!) >= 2.4 && Math.max(...a.footprint!) <= 6.5),
    dead: cat.ofRole("corpse").filter((a) => ok(a) && /Blood and Bodies/.test(packOf(a)) && !/Horse|Donkey|Skelet|Bone|Rat|Bird|Cow|Pig|Dog|Cat/i.test(a.name) && !a.colorable && Math.max(...a.footprint!) <= 2.6),
    deadHorses: obj(/^Horse \d(\.\d+)?( - Bloody)?$/, /Blood and Bodies/),
    shields: obj(/^Debris - Shield \d - Colorable$/, /Blood and Bodies/),
    arrows: obj(/^Arrows - (Large|Medium)$/, /Blood and Bodies/),
    blood: cat.ofRole("blood").filter((a) => ok(a) && /Blood and Bodies/.test(packOf(a)) && !a.colorable && Math.max(...a.footprint!) <= 3),
    scorch: cat.ofRole("scorch").filter((a) => ok(a) && !a.colorable && Math.max(...a.footprint!) <= 5),
    debris: obj(/^Debris - (Axe|Sword|Spear|Helmet|Armou?r)/, /Blood and Bodies/),
  };
}

type Kit = ReturnType<typeof warKit>;

/** Builds the versions of a war map. The plan carries what it is (plan.war) and the mood. */
export function generateWar(plan: ScenePlan, cat: Catalog, opts: { date?: Date } = {}): GeneratedMap {
  if (!plan.war) throw new Error("not a war plan");
  const { w, h } = plan.size;
  const zone = plan.levels[0]!.zones[0]!;
  const layout: Layout = {
    map: { w, h }, building: { x: 0, y: 0, w: 0, h: 0 }, outline: [], interiorWalls: [], doors: [], windows: [], exterior: {}, front: "south",
    zones: [{ ...zone, rect: { x: 0, y: 0, w, h }, outdoor: true }],
  };
  const rng = new Rng(plan.seed);
  const wear = (plan.mood?.wear ?? "grimy") as Wear;
  const styles = buildStyles(cat, plan.genre, wear, ["tent", "campfire", "crate", "barrel", "sack", "debris", "corpse", "blood", "scorch", "weapon", "banner"], plan.versions?.count ?? 1, rng.fork("styles"));
  if (!styles.length) throw new Error("the asset library has no pieces for a war map");
  const kit = warKit(cat);
  const versions = styles.map((st) => warVersion(plan, layout, cat, kit, st, styles, opts));
  return { plan, layout, versions };
}

function warVersion(plan: ScenePlan, layout: Layout, cat: Catalog, kit: Kit, st: ReturnType<typeof buildStyles>[number], styles: ReturnType<typeof buildStyles>, opts: { date?: Date }): GeneratedVersion {
  const war = plan.war!;
  const { w, h } = layout.map;
  const b = new DDMapBuilder({ width: w, height: h, ambientLight: AMBIENT[plan.mood?.time ?? "day"], date: opts.date });
  const elements: Record<string, ElementInfo> = {};
  const notes: string[] = [];
  const use = (a?: AssetRecord) => {
    if (a) b.usePack(cat.manifestFor(a.pack));
    return a;
  };
  const px = (p: readonly [number, number]): Vec2 => [p[0] * S, p[1] * S];
  const grid = new Grid(w, h);
  const ctx: Ctx = makeCtx({ plan, layout, cat, style: st, styles, locked: [] }, grid, `war:${st.id}`);
  const zoneId = layout.zones[0]!.id;
  const rng = new Rng(`${plan.seed}:${st.id}:war`);
  const sheltered: Shelter[] = [];
  const inMap = (p: Vec, m = 1) => p[0] >= m && p[1] >= m && p[0] <= w - m && p[1] <= h - m;
  const put = (asset: AssetRecord | undefined, at: Vec, o: { rot?: number; feature: string; role: string; layer?: number; occupy?: "solid" | "clutter" | "low" | "force"; color?: string; scale?: number; light?: Placed["light"] | false; pad?: number }) => {
    if (!asset || !inMap(at, 0.3)) return undefined;
    return place(ctx, { asset, role: o.role, at, rot: o.rot ?? 0, layer: o.layer ?? LAYER.furniture, zone: zoneId, feature: o.feature, occupy: o.occupy ?? "solid", ...(o.color ? { color: argbOf(o.color) } : {}), ...(o.scale ? { scale: o.scale } : {}), ...(o.light !== undefined ? { light: o.light } : {}), ...(o.pad ? { pad: o.pad } : {}) });
  };
  /** A piece from a list, or none when the library has no such pieces. */
  const any = (list: AssetRecord[]) => (list.length ? rng.pick(list) : undefined);
  const scatter = (list: AssetRecord[], n: number, where: (rng: Rng) => Vec | undefined, o: Parameters<typeof put>[2], tries = 6) => {
    let placed = 0;
    for (let i = 0; i < n && list.length; i++) {
      for (let t = 0; t < tries; t++) {
        const at = where(rng);
        if (at && put(rng.pick(list), at, { ...o, rot: o.rot ?? rng.range(0, Math.PI * 2) })) {
          placed++;
          break;
        }
      }
    }
    return placed;
  };

  const n1 = noise2(plan.seed % 9973), n2 = noise2((plan.seed * 13) % 9931);
  const g = kit.ground;
  const groundTex = [g.grass, g.dirt, g.mud, g.sodden].map((t) => use(t)?.res);
  const paint = (wear: (x: number, y: number) => { dirt: number; mud: number; wet?: number }) => {
    if (groundTex.some((t) => !t)) return notes.push("ground textures missing: plain ground");
    b.paintTerrain(groundTex as string[], (tx, ty) => {
      const x = (tx + 0.5) / 4, y = (ty + 0.5) / 4;
      const { dirt, mud, wet = 0 } = wear(x, y);
      const grass = Math.max(0, 1 - dirt - mud - wet);
      const tot = Math.max(1e-6, grass + dirt + mud + wet);
      return [(255 * grass) / tot, (255 * dirt) / tot, (255 * mud) / tot, (255 * wet) / tot];
    });
  };

  if (war.kind === "camp") buildCamp();
  else buildField();

  // Objects and lights.
  const placed: Placed[] = ctx.placed;
  for (const p of placed) {
    use(p.asset);
    const id = b.addObject({ at: px([p.x, p.y]), texture: p.asset.res, rotation: p.rotation, scale: p.scale, layer: p.layer, customColor: p.customColor, shadow: p.layer >= 300 && p.layer < 700 });
    elements[id] = { kind: "object", key: p.key, zone: p.zone, feature: p.feature, type: p.type, asset: p.asset.id };
    if (p.light) {
      const lid = b.addLight({ at: px(p.center ?? [p.x, p.y]), range: Math.max(1.5, p.light.range), color: p.light.color, intensity: p.light.intensity ?? 1 });
      elements[lid] = { kind: "light", key: `${p.key}/light`, zone: p.zone };
    }
  }
  const byType: Record<string, number> = {};
  for (const p of placed) byType[p.type] = (byType[p.type] ?? 0) + 1;
  const map = b.build();
  return {
    id: st.id,
    name: war.kind === "camp" ? `${war.sides[0]?.name ?? "Army"} camp` : "Battlefield",
    palette: { anchorPack: st.anchorPack, tone: st.tone, tint: st.tint, floors: {} },
    map, elements, placed, sheltered,
    notes: [...b.warnings, ...ctx.notes, ...notes],
    summary: {
      objects: placed.length,
      lights: Object.values(elements).filter((e) => e.kind === "light").length,
      doors: 0, windows: 0, byType, packs: [...b.manifest.keys()],
    },
  };

  // ------------------------------------------------------------------------------------------
  // The camp, laid out with its gate on one edge: u runs along that edge, v from it inward.
  function buildCamp() {
    const side = war.sides[0]!;
    const color = side.color;
    const edge: Side = side.edge ?? "south";
    const along = edge === "south" || edge === "north" ? w : h;
    const deep = edge === "south" || edge === "north" ? h : w;
    const T = (u: number, v: number): Vec => edge === "south" ? [u, h - v] : edge === "north" ? [w - u, v] : edge === "east" ? [w - v, u] : [v, h - u];
    // The direction (in map space) of a direction (du, dv) in camp space; and the rotation that turns an
    // image's "down" toward it.
    const D = (du: number, dv: number): Vec => edge === "south" ? [du, -dv] : edge === "north" ? [-du, dv] : edge === "east" ? [-dv, du] : [dv, -du];
    const rotTo = (du: number, dv: number) => { const [x, y] = D(du, dv); return Math.atan2(y, x) - Math.PI / 2; };
    const OUT = rotTo(0, -1); // facing the gate and the field beyond
    const IN = rotTo(0, 1);

    const pal = { u0: 3, u1: along - 3, v0: 5, v1: deep - 3 };
    const mid = along / 2;
    const gateHalf = 3.5;
    const avenue = { u0: mid - 3, u1: mid + 3 };

    const fires: Vec[] = [];

    // The palisade: one run from the gate round the back to the gate again; real walls in Foundry.
    const wallTex = use(kit.palisade);
    if (wallTex) {
      const run: Vec[] = [[mid - gateHalf, pal.v0], [pal.u0, pal.v0], [pal.u0, pal.v1], [pal.u1, pal.v1], [pal.u1, pal.v0], [mid + gateHalf, pal.v0]].map(([u, v]) => T(u, v));
      const id = b.addWall({ points: run.map(px), texture: wallTex.res, shadow: true }).id;
      elements[id] = { kind: "wall", key: "palisade", zone: zoneId, asset: wallTex.id };
      // Keep pieces off the wall line.
      for (let i = 0; i + 1 < run.length; i++) {
        const [a, c] = [run[i]!, run[i + 1]!];
        grid.mark({ x: Math.min(a[0], c[0]) - 0.7, y: Math.min(a[1], c[1]) - 0.7, w: Math.abs(c[0] - a[0]) + 1.4, h: Math.abs(c[1] - a[1]) + 1.4 }, Cell.Wall);
      }
    } else notes.push("no palisade wall texture");
    put(kit.gate, T(mid, pal.v0), { rot: Math.atan2(D(1, 0)[1], D(1, 0)[0]), feature: "gate", role: "gate", occupy: "force", layer: LAYER.furniture });
    // The avenue from the gate to the command tent: a trodden path, kept clear of tents.
    const cmdV = pal.v1 - 7.5;
    const [a0, a1] = [T(avenue.u0, pal.v0 - 1), T(avenue.u1, cmdV - 4)];
    grid.mark({ x: Math.min(a0[0], a1[0]), y: Math.min(a0[1], a1[1]), w: Math.abs(a1[0] - a0[0]), h: Math.abs(a1[1] - a0[1]) }, Cell.Path);

    // Watchtowers at the front corners, flying the army's banner; torches at the gate.
    for (const u of [pal.u0 + 2.6, pal.u1 - 2.6]) {
      put(kit.tower, T(u, pal.v0 + 2.6), { rot: OUT, feature: "towers", role: "tower", occupy: "force" });
      put(any(kit.bannerDraped), T(u, pal.v0 + 5.2), { rot: OUT, feature: "banners", role: "banner", color, occupy: "clutter", layer: LAYER.overhead - 50 });
    }
    for (const s of [-1, 1]) {
      put(kit.torches[0], T(mid + s * (gateHalf + 1.2), pal.v0 + 1.2), { feature: "gate", role: "torch", light: LIGHTS.torch, occupy: "clutter" });
      put(any(kit.bannerUp), T(mid + s * (gateHalf + 2.6), pal.v0 + 1.4), { rot: OUT, feature: "banners", role: "banner", color, occupy: "clutter" });
    }
    // Stakes in front of the palisade, leaving the way to the gate open.
    for (let u = pal.u0 + 2; u < pal.u1 - 1; u += 3.4) if (Math.abs(u - mid) > gateHalf + 2.5) put(kit.stakes, T(u, pal.v0 - 2.2), { rot: OUT, feature: "stakes", role: "stakes", occupy: "solid" });

    // The command tent: open, with the war table, the general's chair facing the entrance, chairs,
    // a rug in the army's colour, braziers and banners at the door.
    const cmd = T(mid, cmdV);
    const tent = put(kit.commandTent, cmd, { rot: IN, feature: "command", role: "tent", occupy: "force", layer: LAYER.decal + 20 });
    if (tent) {
      const [fw, fh] = tent.footprint;
      sheltered.push({ points: [[cmd[0] - fw / 2, cmd[1] - fh / 2], [cmd[0] + fw / 2, cmd[1] - fh / 2], [cmd[0] + fw / 2, cmd[1] + fh / 2], [cmd[0] - fw / 2, cmd[1] + fh / 2]] });
      grid.mark({ x: cmd[0] - fw / 2, y: cmd[1] - fh / 2, w: fw, h: fh }, Cell.Free);
      // Inside the tent only: its edges are cloth.
      grid.mark({ x: cmd[0] - fw / 2 - 0.6, y: cmd[1] - fh / 2 - 0.6, w: fw + 1.2, h: 0.9 }, Cell.Wall);
      grid.mark({ x: cmd[0] - fw / 2 - 0.6, y: cmd[1] + fh / 2 - 0.3, w: fw + 1.2, h: 0.9 }, Cell.Wall);
      grid.mark({ x: cmd[0] - fw / 2 - 0.6, y: cmd[1] - fh / 2, w: 0.9, h: fh }, Cell.Wall);
      grid.mark({ x: cmd[0] + fw / 2 - 0.3, y: cmd[1] - fh / 2, w: 0.9, h: fh }, Cell.Wall);
    } else notes.push("no command tent art");
    put(kit.rug, T(mid, cmdV), { rot: IN, feature: "command", role: "rug", color, layer: LAYER.rug, occupy: "low", scale: 1.5 });
    put(kit.table ?? kit.desk, T(mid, cmdV), { rot: IN, feature: "command", role: "table_medium", occupy: "solid" });
    put(kit.chiefChair, T(mid, cmdV + 2.1), { rot: rotTo(0, -1), feature: "command", role: "chair", color, occupy: "solid" });
    for (const [du, dv] of [[-2.2, 0.3], [2.2, 0.3], [-1.2, -1.9], [1.2, -1.9]] as const) put(any(kit.chairs), T(mid + du, cmdV + dv), { rot: Math.atan2(-D(du, dv)[1], -D(du, dv)[0]) - Math.PI / 2, feature: "command", role: "chair", occupy: "solid" });
    put(kit.box, T(mid + 3.1, cmdV + 2.6), { rot: IN, feature: "command", role: "chest", occupy: "solid" });
    for (const s of [-1, 1]) {
      put(any(kit.braziers), T(mid + s * 3.2, cmdV - 2.4), { feature: "command", role: "brazier", light: LIGHTS.brazier, occupy: "solid" });
      put(any(kit.bannerUp), T(mid + s * 2.4, cmdV - 5.6), { rot: OUT, feature: "banners", role: "banner", color, occupy: "clutter" });
    }

    // The officers' tents beside it, in the army's colour.
    for (const s of [-1, 1]) {
      const at = T(mid + s * 11, pal.v1 - 6.5);
      put(kit.officerTent, at, { rot: rotTo(-s, 0), feature: "officers", role: "tent", color, occupy: "solid", pad: 0.6 });
    }

    // Rows of soldiers' tents either side of the avenue, facing their lanes, fires between the rows.
    const rowsTop = pal.v1 - 12, rowsBottom = pal.v0 + 7;
    for (const s of [-1, 1]) {
      const uIn = s < 0 ? avenue.u0 - 1.5 : avenue.u1 + 1.5;
      const uOut = s < 0 ? pal.u0 + 2 : pal.u1 - 2;
      let row = 0;
      for (let v = rowsTop; v > rowsBottom; v -= 5, row++) {
        let placedInRow = 0;
        for (let u = uIn + s * 2.1; s < 0 ? u > uOut + 1.4 : u < uOut - 1.4; u += s * 4.1) {
          const t = any(kit.soldierTents);
          if (put(t, T(u, v), { rot: row % 2 ? OUT : IN, feature: "soldiers", role: "tent", occupy: "solid", pad: 0.3 })) placedInRow++;
        }
        // A fire in the lane below every other row, with log seats round it.
        if (placedInRow) {
          const fu = uIn + s * (Math.abs(uOut - uIn) / 2), fv = v - 3.2;
          const f = put(any(kit.campfires), T(fu, fv), { feature: "fires", role: "campfire", light: LIGHTS.campfire, occupy: "solid", pad: 0.4 });
          if (f) {
            fires.push(T(fu, fv));
            for (const a of [0, Math.PI * 0.66, Math.PI * 1.33]) put(any(kit.logSeats), T(fu + Math.cos(a) * 1.9, fv + Math.sin(a) * 1.4), { rot: a + Math.PI / 2, feature: "fires", role: "log", occupy: "clutter" });
            scatter(kit.bedrolls, 2, (r) => T(fu + r.range(-3, 3), fv + r.range(-1.6, 1.6)), { feature: "fires", role: "bedroll", occupy: "clutter", layer: LAYER.rug });
          }
        }
      }
    }

    // The supply depot in one back corner: crates, barrels, sacks, a cargo cart in the colour, a wagon.
    const depot = (s: number): Vec => [s < 0 ? pal.u0 + 6 : pal.u1 - 6, pal.v1 - 6];
    const dep = depot(rng.next() < 0.5 ? -1 : 1);
    for (let t = 0; t < 8; t++) if (put(kit.cargo, T(dep[0] + rng.range(-3, 3), dep[1] - rng.range(0, 4)), { rot: rotTo(1, 0), feature: "supplies", role: "cart", color, occupy: "solid" })) break;
    for (let t = 0; t < 8; t++) if (put(any(kit.wagons), T(dep[0] + rng.range(-4, 4), dep[1] - rng.range(0, 5)), { rot: rotTo(0, 1), feature: "supplies", role: "wagon", occupy: "solid" })) break;
    scatter([...kit.crates, ...kit.barrels, ...kit.sacks], 14, (r) => T(dep[0] + r.range(-4, 4), dep[1] + r.range(-1.5, 3)), { feature: "supplies", role: "crate", occupy: "solid" });
    put(kit.cauldron, T(dep[0] + (dep[0] < mid ? 4 : -4), dep[1] + 2), { feature: "supplies", role: "cauldron", occupy: "solid" });
    // The horse line in the other back corner: a rail and the horses tied along it.
    const hl: Vec = [dep[0] < mid ? pal.u1 - 7 : pal.u0 + 7, pal.v1 - 4];
    for (let i = -1; i <= 1; i++) put(kit.rail, T(hl[0] + i * 2, hl[1]), { rot: rotTo(0, 1), feature: "horses", role: "fence", occupy: "solid" });
    for (let i = 0; i < 5; i++) put(any(kit.horses), T(hl[0] - 4 + i * 2, hl[1] - 1.8), { rot: OUT + rng.range(-0.25, 0.25), feature: "horses", role: "horse", occupy: "solid" });
    // Archery butts by the front palisade; siege engines just inside the gate, facing out.
    for (let i = 0; i < 3; i++) put(any(kit.targets), T(pal.u0 + 4 + i * 2.5, pal.v0 + 2.2), { rot: IN, feature: "training", role: "target", occupy: "solid" });
    for (const s of [-1, 1]) put(any(kit.siege), T(mid + s * 8.5, pal.v0 + 4.2), { rot: OUT, feature: "siege", role: "siege", occupy: "solid", pad: 0.3 });
    // More tents wherever there is room left (a camp is crowded).
    scatter(kit.soldierTents, 14, (r) => T(r.range(pal.u0 + 3, pal.u1 - 3), r.range(pal.v0 + 6, pal.v1 - 3)), { feature: "soldiers", role: "tent", occupy: "solid", pad: 0.3, rot: undefined }, 10);
    // Weapon racks and a little camp clutter.
    scatter(kit.racks, 6, (r) => T(r.range(pal.u0 + 3, pal.u1 - 3), r.range(rowsBottom, rowsTop)), { feature: "clutter", role: "weapon", occupy: "solid" });
    scatter([...kit.crates, ...kit.barrels, ...kit.sacks, ...kit.bedrolls], 14, (r) => T(r.range(pal.u0 + 2, pal.u1 - 2), r.range(pal.v0 + 2, pal.v1 - 2)), { feature: "clutter", role: "debris", occupy: "solid" });

    // Ground (painted last, round the fires): grass outside; worn dirt within the palisade, mud along the avenue and round the fires.
    paint((x, y) => {
      const [u, v] = edge === "south" ? [x, h - y] : edge === "north" ? [w - x, y] : edge === "east" ? [y, w - x] : [h - y, x];
      const inside = u > pal.u0 && u < pal.u1 && v > pal.v0 && v < pal.v1;
      const patch = n1(x / 7, y / 7), speck = n2(x / 1.6, y / 1.6);
      const onAvenue = u > avenue.u0 - 0.5 && u < avenue.u1 + 0.5 && v < pal.v1 - 12;
      const byFire = fires.some((f) => Math.hypot(f[0] - x, f[1] - y) < 3.2);
      const dirt = inside ? 0.55 + 0.35 * patch + (speck - 0.5) * 0.2 : smoothstep(0.62, 0.85, patch) * 0.6 + (v < pal.v0 + 1.5 && Math.abs(u - mid) < 6 ? 0.6 : 0);
      const mud = onAvenue ? 0.5 + 0.4 * speck : byFire ? 0.45 : inside ? smoothstep(0.7, 0.95, patch) * 0.4 : 0;
      return { dirt: Math.min(1, dirt), mud };
    });

  }

  // ------------------------------------------------------------------------------------------
  function buildField() {
    const sides = war.sides;
    const edgeDist = (p: Vec, e: Side) => (e === "north" ? p[1] : e === "south" ? h - p[1] : e === "west" ? p[0] : w - p[0]);
    const inward = (e: Side): Vec => (e === "north" ? [0, 1] : e === "south" ? [0, -1] : e === "west" ? [1, 0] : [-1, 0]);
    const facing = (e: Side) => { const v = inward(e); return Math.atan2(v[1], v[0]) - Math.PI / 2; };
    const roadEdge: Side | undefined = war.road ?? (["north", "south", "east", "west"] as Side[]).find((e) => !sides.some((s) => s.edge === e));
    const centre: Vec = [w / 2, h / 2];
    // Where the road meets its edge, along that edge (a line leaves a gap for it).
    const roadT = roadEdge === "north" || roadEdge === "south" ? w * (roadEdge === "north" ? 0.55 : 0.45) : h * 0.5;
    const craters: Vec[] = [];
    const machines: Vec[] = [];
    // Where the machines stand: a ring round the middle.
    const nm = Math.max(0, Math.min(5, war.machines ?? 0));
    for (let i = 0; i < nm; i++) {
      const a = (i / Math.max(1, nm)) * Math.PI * 2 + rng.range(-0.3, 0.3) + Math.PI / 6;
      machines.push([centre[0] + Math.cos(a) * Math.min(w, h) * 0.2, centre[1] + Math.sin(a) * Math.min(w, h) * 0.2]);
    }
    for (let i = 0; i < 7; i++) craters.push([rng.range(8, w - 8), rng.range(8, h - 8)]);

    // Ground: trampled to dirt and mud through the middle, sodden in the craters, grass at the edges.
    paint((x, y) => {
      const p: Vec = [x, y];
      const edge = Math.min(...(["north", "south", "east", "west"] as Side[]).map((e) => edgeDist(p, e)));
      const fight = smoothstep(2, 14, edge);
      const patch = n1(x / 6, y / 6), speck = n2(x / 1.7, y / 1.7);
      const dirt = fight * (0.45 + 0.4 * patch) + (speck - 0.5) * 0.15;
      const mud = fight * smoothstep(0.55, 0.85, n2(x / 5 + 40, y / 5 + 11)) * 0.7;
      const wet = Math.max(0, ...craters.map((c) => 1 - Math.hypot(c[0] - x, c[1] - y) / 3.2), ...machines.map((m) => (1 - Math.hypot(m[0] - x, m[1] - y) / 4.5) * 0.8));
      return { dirt: Math.max(0, Math.min(1, dirt)), mud, wet: Math.max(0, wet) };
    });

    // The road out (toward the village) across the free edge, a worn trail along it.
    if (roadEdge && kit.road) {
      const a: Vec = roadEdge === "north" ? [roadT, -1] : roadEdge === "south" ? [roadT, h + 1] : roadEdge === "west" ? [-1, roadT] : [w + 1, roadT];
      const pts: Vec[] = [a, [(a[0] + centre[0]) / 2 + rng.range(-3, 3), (a[1] + centre[1]) / 2 + rng.range(-3, 3)], [centre[0] + rng.range(-4, 4), centre[1] + rng.range(-2, 2)]];
      const id = b.addPath({ points: pts.map(px), texture: use(kit.road)!.res, width: 5 * S * 0.6, layer: LAYER.decal });
      elements[id] = { kind: "path", key: "road", zone: zoneId, asset: kit.road.id };
    }

    // The machines first: each in a glowing crater, glowing, cables between them into the ground.
    for (const [i, m] of machines.entries()) {
      put(any(kit.glow), m, { rot: rng.range(0, Math.PI * 2), feature: "machines", role: "crater", layer: LAYER.decal + 10, occupy: "force", scale: 1.6 });
      const mach = put(kit.machines[(i * 3 + 1) % Math.max(1, kit.machines.length)], m, { rot: rng.range(0, Math.PI * 2), feature: "machines", role: "machine", occupy: "solid", pad: 1.2, light: MACHINE_LIGHT, scale: 1.4 });
      if (!mach) notes.push("a machine did not fit");
    }
    if (kit.cable && machines.length > 1) {
      for (let i = 0; i < machines.length; i++) {
        const a = machines[i]!, c = machines[(i + 1) % machines.length]!;
        const midp: Vec = [(a[0] + c[0]) / 2 + rng.range(-3, 3), (a[1] + c[1]) / 2 + rng.range(-3, 3)];
        const id = b.addPath({ points: [a, midp, c].map(px), texture: use(kit.cable)!.res, width: S * 0.8, layer: LAYER.decal + 5 });
        elements[id] = { kind: "path", key: `cable#${i}`, zone: zoneId, asset: kit.cable.id };
      }
    }
    // Craters of the fighting (not on the machines).
    for (const c of craters) if (!machines.some((m) => Math.hypot(m[0] - c[0], m[1] - c[1]) < 6)) put(any(kit.craters), c, { rot: rng.range(0, Math.PI * 2), feature: "craters", role: "crater", layer: LAYER.decal, occupy: "low", scale: rng.range(0.45, 0.7) });

    // Each side's line along its edge: barricades with gaps, banners behind, a siege engine or a wreck.
    for (const s of sides) {
      const e = s.edge;
      if (!e) continue;
      const lenAlong = e === "north" || e === "south" ? w : h;
      const at = (t: number, d: number): Vec => (e === "north" ? [t, d] : e === "south" ? [t, h - d] : e === "west" ? [d, t] : [w - d, t]);
      for (let t = 6; t < lenAlong - 6; t += 8.5) {
        if (rng.next() < 0.2 || (e === roadEdge && Math.abs(t - roadT) < 5)) continue;
        put(any(kit.barricades), at(t + rng.range(-1, 1), 5 + rng.range(-0.6, 0.6)), { rot: facing(e) + rng.range(-0.12, 0.12), feature: `line:${s.name}`, role: "barricade", occupy: "solid" });
      }
      // One engine still shooting behind the line, one wrecked and burning out in front of it.
      for (let t = 0; t < 8; t++) if (put(any(kit.siege), at(rng.range(lenAlong * 0.2, lenAlong * 0.8), 2.4), { rot: facing(e), feature: `line:${s.name}`, role: "siege", occupy: "solid" })) break;
      for (let t = 0; t < 8; t++) {
        const wreck = at(rng.range(lenAlong * 0.25, lenAlong * 0.75), rng.range(9, 15));
        if (!put(any(kit.siege), wreck, { rot: facing(e) + rng.range(-1.2, 1.2), feature: "wrecks", role: "siege", occupy: "solid" })) continue;
        put(any(kit.bonfires), [wreck[0] + 0.6, wreck[1] + 0.4], { feature: "wrecks", role: "campfire", light: LIGHTS.firepit, occupy: "force", layer: LAYER.surface });
        break;
      }
      // The side's banners, behind its barricades.
      let flown = 0;
      for (let t = 0; t < 20 && flown < 5; t++) if (put(any(kit.bannerDraped), at(rng.range(6, lenAlong - 6), 2.6), { rot: facing(e), feature: `line:${s.name}`, role: "banner", color: s.color, occupy: "clutter", scale: 1.3 })) flown++;
      // Arrows stuck in the ground before the line.
      scatter(kit.arrows, 8, (r) => at(r.range(5, lenAlong - 5), r.range(7, 12)), { feature: "arrows", role: "weapon", occupy: "low", layer: LAYER.floorClutter });
    }

    // The dead, thickest where the lines met; each side's shields lie nearer its own line.
    const fightAt = (r: Rng): Vec => {
      const p: Vec = [r.range(6, w - 6), r.range(6, h - 6)];
      const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]) / (Math.min(w, h) / 2);
      return r.next() < 1.05 - d ? p : [r.range(10, w - 10), r.range(10, h - 10)];
    };
    scatter(kit.dead, Math.round((w * h) / 70), fightAt, { feature: "dead", role: "corpse", occupy: "clutter", layer: LAYER.floorClutter + 10 });
    scatter(kit.scorch, 12, fightAt, { feature: "scorch", role: "scorch", occupy: "low", layer: LAYER.decal + 20 });
    scatter(kit.deadHorses, 6, fightAt, { feature: "dead", role: "corpse", occupy: "clutter", layer: LAYER.floorClutter + 10 });
    scatter(kit.blood, Math.round((w * h) / 90), fightAt, { feature: "blood", role: "blood", occupy: "low", layer: LAYER.decal + 30 });
    scatter(kit.debris, 20, fightAt, { feature: "debris", role: "weapon", occupy: "clutter", layer: LAYER.floorClutter });
    for (const s of sides) {
      if (!s.edge) continue;
      const e = s.edge;
      scatter(kit.shields, 9, (r) => {
        const p = fightAt(r);
        const t = r.range(0.35, 0.75);
        const edgeP: Vec = e === "north" ? [p[0], 4] : e === "south" ? [p[0], h - 4] : e === "west" ? [4, p[1]] : [w - 4, p[1]];
        return [edgeP[0] + (p[0] - edgeP[0]) * t, edgeP[1] + (p[1] - edgeP[1]) * t];
      }, { feature: `dead:${s.name}`, role: "weapon", color: s.color, occupy: "clutter", layer: LAYER.floorClutter + 5 });
    }
    notes.push(`sides: ${sides.map((s) => `${s.name} (${s.edge})`).join(", ")}${machines.length ? `; ${machines.length} machines` : ""}${roadEdge ? `; road out to the ${roadEdge}` : ""}`);
  }
}
