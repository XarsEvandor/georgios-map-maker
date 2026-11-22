/**
 * Map sessions: plan + generated versions, persisted under <data>/sessions/<map id>/.
 * Every plan change regenerates with the previous generation (so locks hold).
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  adoptSavedMap, allHotSpots, areaPlan, Catalog, diffMaps, generate, GENRE_SETTINGS, hotspotPlan, parseCity, placePeople, PlanError, shelterOf, toFoundryScene, TRADES, validatePlan, ZONE_TYPES,
  type Box, type Person, type City, type HotSpot, type Pt,
  type AssetIndex, type Directive, type FoundrySceneData, type GeneratedMap, type GeneratedVersion, type Genre, type Lock, type RoundTripResult, type ScenePlan,
} from "@gmm/core";
import sharp from "sharp";
import type { AssetSource } from "../assets/source";
import { leafImage, renderMap, type RenderOptions } from "../render/render";
import { cityKey, cityLink, fetchCityJson } from "../city/fetch";
import { cityScale, renderCity, type CityImage } from "../city/render";
import { renderCityNight } from "../city/night";

/** What the Foundry module needs to make a city scene. */
export interface CityInfo {
  key: string;
  name: string;
  width: number;
  height: number;
  gridPx: number;
  gridFt: number;
  /** Pixels per metre of the city image. */
  ppm: number;
  /** onDemand: built when the DM first opens it; street: a street-level map (else an interior). */
  hotspots: CityPlace[];
}

/** A place with a pin on the city scene (pixels of the city image). Shops carry their trade and icon; set pieces the GM's notes. */
export interface CityPlace { id: string; kind: string; label: string; x: number; y: number; onDemand?: boolean; street?: boolean; trade?: string; icon?: string; secret?: boolean; notes?: string }

function placesOf(city: City, toPx: (p: Pt) => Pt): CityPlace[] {
  return allHotSpots(city).map((h) => ({
    id: h.id, kind: h.kind, label: h.label, x: Math.round(toPx(h.at)[0]), y: Math.round(toPx(h.at)[1]),
    ...(h.onDemand ? { onDemand: true } : {}), ...(h.area ? { street: true } : {}), ...(h.trade ? { trade: h.trade } : {}),
    ...(h.icon ?? (h.trade ? TRADES[h.trade].icon : undefined) ? { icon: h.icon ?? TRADES[h.trade!].icon } : {}), ...(h.secret ? { secret: true } : {}),
    ...(h.notes ? { notes: h.notes } : {}),
  }));
}

export interface MapSession {
  id: string;
  plan: ScenePlan;
  gen: GeneratedMap;
  updatedAt: string;
}

/** Furniture types worth numbering for chat references ("table 3"). */
const LABELED = new Set(["table", "bar_counter", "hearth", "bed", "altar", "pew", "sarcophagus", "coffin", "statue", "wardrobe", "bookcase", "shelf", "sofa", "chest", "throne"]);

export interface Label {
  n: number;
  key: string;
  type: string;
  zone: string;
  x: number;
  y: number;
}

export class MapStore {
  private readonly sessions = new Map<string, MapSession>();
  private readonly catalogs = new Map<Genre, Catalog>();
  private readonly renders = new Map<string, Promise<Buffer>>();
  private readonly cities = new Map<string, { city: City; image?: CityImage }>();
  readonly root: string;

  constructor(readonly dataDir: string, readonly index: AssetIndex, readonly src: AssetSource) {
    this.root = resolve(dataDir, "sessions");
  }

  catalog(genre: Genre): Catalog {
    let c = this.catalogs.get(genre);
    if (!c) {
      c = new Catalog(this.index, GENRE_SETTINGS[genre]);
      this.catalogs.set(genre, c);
    }
    return c;
  }

  /** Session folder, refusing ids that would escape the data folder. */
  private dir(id: string): string {
    if (!/^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(id) || id.includes("..")) throw new Error(`bad map id ${JSON.stringify(id)}`);
    const d = resolve(this.root, id.replace(/:/g, "_"));
    if (!d.startsWith(this.root + sep)) throw new Error("map id escapes the data folder");
    return d;
  }

  async load(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const name of await readdir(this.root)) {
      try {
        const plan = JSON.parse(await readFile(join(this.root, name, "plan.json"), "utf8")) as ScenePlan;
        // Locks keep pieces from the last generation: hand it back so they survive a restart.
        const previous = plan.locks?.length ? await this.loadPieces(join(this.root, name), plan) : undefined;
        await this.regenerate(plan, false, previous);
      } catch {
        /* skip broken sessions */
      }
    }
  }

  list(): Array<{ id: string; title?: string; genre: string; versions: number; picked?: string; updatedAt: string }> {
    return [...this.sessions.values()].map((s) => ({ id: s.id, title: s.plan.title, genre: s.plan.genre, versions: s.gen.versions.length, picked: s.plan.versions?.picked, updatedAt: s.updatedAt }));
  }

  get(id: string): MapSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no map with id ${id}`);
    return s;
  }

  version(id: string, version?: string): GeneratedVersion {
    const s = this.get(id);
    const vid = version ?? s.plan.versions?.picked ?? s.gen.versions[0]?.id;
    const v = s.gen.versions.find((x) => x.id === vid);
    if (!v) throw new Error(`map ${id} has no version ${vid}`);
    return v;
  }

  /** Validates, generates and saves a plan (new or replacing an existing one). */
  async setPlan(plan: ScenePlan): Promise<MapSession> {
    const issues = validatePlan(plan, ZONE_TYPES);
    if (issues.length) throw new PlanError(issues);
    return this.regenerate(plan, true);
  }

  /** The pieces of the last saved generation (pieces.json), with their asset records looked up again. */
  private async loadPieces(dir: string, plan: ScenePlan): Promise<GeneratedMap | undefined> {
    try {
      const saved = JSON.parse(await readFile(join(dir, "pieces.json"), "utf8")) as { picked?: string; versions: Array<{ id: string; elements: GeneratedVersion["elements"]; placed: Array<Record<string, unknown> & { asset: string }> }> };
      const byId = new Map(this.index.assets.map((a) => [a.id, a]));
      const versions = saved.versions.map((v) => ({
        id: v.id, elements: v.elements,
        placed: v.placed.flatMap((p) => (byId.has(p.asset) ? [{ ...p, asset: byId.get(p.asset)! }] : [])),
      })) as unknown as GeneratedVersion[];
      return { plan: { ...plan, versions: { ...(plan.versions ?? {}), picked: saved.picked ?? plan.versions?.picked } }, layout: undefined as never, versions };
    } catch {
      return undefined;
    }
  }

  private async regenerate(plan: ScenePlan, save: boolean, prior?: GeneratedMap): Promise<MapSession> {
    const previous = this.sessions.get(plan.id)?.gen ?? prior;
    const city = plan.street ? await this.city(plan.street.city) : undefined;
    const gen = generate(plan, this.catalog(plan.genre), { previous, city });
    const s: MapSession = { id: plan.id, plan, gen, updatedAt: new Date().toISOString() };
    this.sessions.set(plan.id, s);
    for (const key of [...this.renders.keys()]) if (key.startsWith(`${plan.id}|`)) this.renders.delete(key);
    if (save) await this.save(s);
    return s;
  }

  private async save(s: MapSession): Promise<void> {
    const d = this.dir(s.id);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "plan.json"), JSON.stringify(s.plan, null, 1));
    for (const v of s.gen.versions) await writeFile(join(d, `${v.id}.dungeondraft_map`), `${JSON.stringify(v.map, null, "\t")}\n`);
    // Pieces by asset id, so locks still hold after the companion restarts.
    const pieces = { picked: s.plan.versions?.picked, versions: s.gen.versions.map((v) => ({ id: v.id, elements: v.elements, placed: v.placed.map((p) => ({ ...p, asset: p.asset.id })) })) };
    await writeFile(join(d, "pieces.json"), JSON.stringify(pieces));
  }

  mapFile(id: string, version?: string): string {
    return join(this.dir(id), `${this.version(id, version).id}.dungeondraft_map`);
  }

  async mutate(id: string, change: (plan: ScenePlan) => ScenePlan): Promise<MapSession> {
    const next = change(structuredClone(this.get(id).plan));
    return this.setPlan(next);
  }

  applyDirective(id: string, d: Directive): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, directives: [...(p.directives ?? []).filter((x) => x.id !== d.id), d] }));
  }

  removeDirective(id: string, directiveId: string): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, directives: (p.directives ?? []).filter((x) => x.id !== directiveId) }));
  }

  addLocks(id: string, locks: Lock[]): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, locks: [...(p.locks ?? []), ...locks] }));
  }

  /** Removes the locks with these ids, or every lock when none are given. */
  removeLocks(id: string, ids?: string[]): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, locks: ids?.length ? (p.locks ?? []).filter((l) => !ids.includes(l.id)) : [] }));
  }

  pick(id: string, version: string): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, versions: { ...(p.versions ?? {}), picked: version } }));
  }

  /** New seed: a fresh layout; directives and locks stay. */
  reseed(id: string): Promise<MapSession> {
    return this.mutate(id, (p) => ({ ...p, seed: (p.seed * 1103515245 + 12345) % 2 ** 31 }));
  }

  labels(id: string, version?: string): Label[] {
    const v = this.version(id, version);
    let n = 0;
    return v.placed
      .filter((p) => !p.parent && LABELED.has(p.type))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((p) => ({ n: ++n, key: p.key, type: p.type, zone: p.zone, x: p.x, y: p.y }));
  }

  /** Rendered image, cached per map, version and options. */
  render(id: string, version: string | undefined, opts: RenderOptions & { labeled?: boolean } = {}): Promise<Buffer> {
    const v = this.version(id, version);
    const key = `${id}|${v.id}|${createHash("sha1").update(JSON.stringify([opts, this.get(id).updatedAt])).digest("hex")}`;
    let r = this.renders.get(key);
    if (!r) {
      const labels = opts.labeled ? this.labels(id, v.id).map((l) => ({ x: l.x, y: l.y, text: String(l.n) })) : undefined;
      r = renderMap(v.map, this.src, { leaves: this.leaves(id, v.id), leafMode: "closed", etchings: v.sundial?.etchings, ...opts, labels });
      this.renders.set(key, r);
      r.catch(() => this.renders.delete(key));
    }
    return r;
  }

  /** Gate leaves of a version, by portal node id. */
  leaves(id: string, version?: string): NonNullable<RenderOptions["leaves"]> {
    const v = this.version(id, version);
    const out: NonNullable<RenderOptions["leaves"]> = {};
    for (const [nid, e] of Object.entries(v.elements)) if (e.kind === "door" && e.leaf) out[nid] = { ...e.leaf, width: e.width ?? 1 };
    return out;
  }

  exportScene(id: string, version?: string, pps = 100): FoundrySceneData {
    const s = this.get(id);
    const v = this.version(id, version);
    const doors = Object.fromEntries(Object.entries(v.elements).filter(([, e]) => e.kind === "door").map(([nid, e]) => [nid, { key: e.key, state: e.state, width: e.width, leaf: e.leaf }]));
    const decorative = new Set(Object.entries(v.elements).filter(([, e]) => e.kind === "wall" && /^(quay|pier)#/.test(e.key)).map(([nid]) => nid));
    return toFoundryScene(v.map, { name: `${s.plan.title ?? s.id} (${v.name})`, pps, doors, decorative, sheltered: v.sheltered ?? shelterOf(s.gen.layout), sundial: v.sundial });
  }

  /**
   * A sundial tower's shadow as a PNG for its Foundry tile: the image is twice the shadow's reach,
   * the shadow on its upper half from the tower's wall out to its tip, as wide as the tower at the
   * wall and narrowing a little, soft-edged, darkest at the wall.
   */
  async shadowPng(id: string, version: string | undefined, pps = 100): Promise<Buffer> {
    const v = this.version(id, version);
    const sh = v.sundial?.shadow;
    if (!sh) throw new Error(`map ${id} has no sundial`);
    const L = Math.max(pps, Math.round(sh.length * pps)), W = Math.max(16, Math.round(sh.width * pps * 1.25));
    const cx = W / 2, yWall = L - sh.from * pps, yTip = Math.max(2, L * 0.03);
    const wallHalf = (sh.width * pps) / 2, tipHalf = wallHalf * 0.6;
    const f = (n: number) => n.toFixed(1);
    const svg = `<svg width="${W}" height="${2 * L}" xmlns="http://www.w3.org/2000/svg">`
      + `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0b0a10" stop-opacity="${sh.alpha.toFixed(2)}"/><stop offset="0.8" stop-color="#0b0a10" stop-opacity="${(sh.alpha * 0.8).toFixed(2)}"/><stop offset="1" stop-color="#0b0a10" stop-opacity="0"/></linearGradient></defs>`
      + `<path d="M${f(cx - wallHalf)} ${f(yWall)} L${f(cx + wallHalf)} ${f(yWall)} L${f(cx + tipHalf)} ${f(yTip + tipHalf)} A${f(tipHalf)} ${f(tipHalf)} 0 0 0 ${f(cx - tipHalf)} ${f(yTip + tipHalf)} Z" fill="url(#g)"/></svg>`;
    return sharp(Buffer.from(svg)).blur(Math.max(0.8, wallHalf * 0.08)).png().toBuffer();
  }

  /** Townsfolk for a built map, in scene pixels (token top-left corners), with the way each faces as a token rotation. */
  people(id: string, version?: string, pps = 100): Array<Person & { px: number; py: number; rotation: number }> {
    const s = this.get(id);
    const v = this.version(id, version);
    const people = placePeople({ layout: s.gen.layout, placed: v.placed, map: v.map, elements: v.elements, seed: `${s.plan.seed}:${v.id}`, time: s.plan.mood?.time ?? "day" });
    // Token art faces down the image: rotation 0 is facing south, turning clockwise.
    return people.map((p) => ({ ...p, px: Math.round((p.x - 0.5) * pps), py: Math.round((p.y - 0.5) * pps), rotation: Math.round(((Math.atan2(-p.facing[0], p.facing[1]) * 180) / Math.PI + 360) % 360) }));
  }

  /** One closed gate leaf as a PNG for Foundry's door animation (left leaf of a pair). */
  async leafPng(id: string, version: string | undefined, portal: string): Promise<Buffer> {
    const leaf = this.leaves(id, version)[portal];
    if (!leaf) throw new Error(`no gate leaf for ${portal}`);
    return leafImage(this.src, leaf, { half: leaf.width >= 2, pad: true });
  }

  /** Adopts a map saved in Dungeondraft: diff, lock the edits, keep the saved file as the version. */
  async adoptDungeondraftSave(id: string, saved: Record<string, any>, version?: string): Promise<RoundTripResult> {
    const s = this.get(id);
    const v = this.version(id, version);
    const result = diffMaps(v.map, saved, v.elements, `dd${Date.now().toString(36)}-`);
    if (!result.changes.length && !result.unmapped.length) return result;
    const adopted = adoptSavedMap(saved, v, s.gen.layout, this.catalog(s.plan.genre));
    s.gen = { ...s.gen, versions: s.gen.versions.map((x) => (x.id === v.id ? adopted : x)) };
    s.plan = { ...s.plan, locks: [...(s.plan.locks ?? []), ...result.locks], directives: [...(s.plan.directives ?? []), ...result.directives], versions: { ...(s.plan.versions ?? {}), picked: v.id } };
    s.updatedAt = new Date().toISOString();
    for (const key of [...this.renders.keys()]) if (key.startsWith(`${id}|`)) this.renders.delete(key);
    await writeFile(join(this.dir(id), "plan.json"), JSON.stringify(s.plan, null, 1));
    return result;
  }

  // -------------------------------------------------------------------------------------
  // Cities

  private cityDir(): string {
    return resolve(this.dataDir, "cities");
  }

  /** A city by cache key: from memory, or from its cached export. */
  async city(key: string): Promise<City> {
    if (!/^[0-9a-f]{8,40}$/.test(key)) throw new Error("bad city key");
    const hit = this.cities.get(key);
    if (hit) return hit.city;
    const meta = JSON.parse(await readFile(join(this.cityDir(), `${key}.meta.json`), "utf8")) as { url: string; name: string; set?: Parameters<typeof parseCity>[1]["set"] };
    const json = JSON.parse(await readFile(join(this.cityDir(), `${key}.json`), "utf8"));
    const city = parseCity(json, meta);
    this.cities.set(key, { city });
    return city;
  }

  /** Opens a city from its watabou city-generator link: layout, hot spots, and the city image. */
  async openCity(url: string, name?: string): Promise<CityInfo> {
    const link = cityLink(url);
    const key = cityKey(url);
    const cityName = (name ?? link.searchParams.get("name") ?? "City").slice(0, 60);
    await mkdir(this.cityDir(), { recursive: true });
    const json = await fetchCityJson(url, this.dataDir);
    // Set pieces the DM wrote into the city's meta file stay through a fresh open.
    const old = await readFile(join(this.cityDir(), `${key}.meta.json`), "utf8").then((s) => JSON.parse(s) as { set?: Parameters<typeof parseCity>[1]["set"] }).catch(() => undefined);
    const meta = { url: link.toString(), name: cityName, ...(old?.set ? { set: old.set } : {}) };
    await writeFile(join(this.cityDir(), `${key}.meta.json`), JSON.stringify(meta));
    const city = parseCity(json, meta);
    const image = await renderCity(city, this.src, this.index);
    this.cities.set(key, { city, image });
    await writeFile(join(this.cityDir(), `${key}.webp`), image.image);
    return {
      key, name: cityName, width: image.width, height: image.height, gridPx: image.gridPx, gridFt: image.gridFt, ppm: image.ppm,
      hotspots: placesOf(city, image.toPx),
    };
  }

  /** Draws a city already opened again from its saved layout (new places of interest change its art). */
  async refreshCity(key: string): Promise<CityInfo> {
    // The meta file may have gained set pieces since the city was read: read it again.
    this.cities.delete(key);
    const city = await this.city(key);
    const meta = JSON.parse(await readFile(join(this.cityDir(), `${key}.meta.json`), "utf8")) as { name: string };
    const image = await renderCity(city, this.src, this.index);
    this.cities.set(key, { city, image });
    await writeFile(join(this.cityDir(), `${key}.webp`), image.image);
    return { key, name: meta.name, width: image.width, height: image.height, gridPx: image.gridPx, gridFt: image.gridFt, ppm: image.ppm, hotspots: placesOf(city, image.toPx) };
  }

  /** The places of a city already opened (pins for its scene), without drawing the city again. */
  async cityPlaces(key: string): Promise<CityPlace[]> {
    const city = await this.city(key);
    return placesOf(city, cityScale(city).toPx);
  }

  /** Whether the city has set pieces the DM asked for (meta.json `set`): they change the city's art, so its scene is drawn again. */
  async citySet(key: string): Promise<boolean> {
    return !!(await this.city(key)).set;
  }

  async cityImage(key: string): Promise<Buffer> {
    if (!/^[0-9a-f]{8,40}$/.test(key)) throw new Error("bad city key");
    return readFile(join(this.cityDir(), `${key}.webp`));
  }

  /** The city at night (city/night.ts), kept beside its day image and drawn again whenever the day image is newer. */
  async cityNightImage(key: string): Promise<Buffer> {
    if (!/^[0-9a-f]{8,40}$/.test(key)) throw new Error("bad city key");
    const dayFile = join(this.cityDir(), `${key}.webp`), nightFile = join(this.cityDir(), `${key}.night.webp`);
    const [d, n] = await Promise.all([stat(dayFile), stat(nightFile).catch(() => undefined)]);
    if (n && n.mtimeMs >= d.mtimeMs) return readFile(nightFile);
    const image = await renderCityNight(await readFile(dayFile), await this.city(key));
    await writeFile(nightFile, image);
    return image;
  }

  private async hotspot(key: string, id: string): Promise<{ city: City; hs: HotSpot }> {
    const city = await this.city(key);
    const hs = allHotSpots(city).find((h) => h.id === id);
    if (!hs) throw new Error(`no hot spot ${id} in ${city.name}`);
    return { city, hs };
  }

  private prefix(key: string, city: City): string {
    return `${city.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "city"}-${key.slice(0, 6)}`;
  }

  /** Builds (or returns, if built before) the battle map of a hot spot. */
  async buildHotspot(key: string, id: string, time?: "day" | "dusk" | "night"): Promise<MapSession> {
    const { city, hs } = await this.hotspot(key, id);
    const plan = hotspotPlan(city, hs, { key, prefix: this.prefix(key, city), time });
    return this.sessions.get(plan.id) ?? this.setPlan(plan);
  }

  /** Builds a street-level map of a box of the city image (pixels of the city scene). */
  async buildArea(key: string, rect: { x: number; y: number; w: number; h: number }, time?: "day" | "dusk" | "night"): Promise<MapSession> {
    const city = await this.city(key);
    const ppm = this.cities.get(key)?.image?.ppm ?? (await this.openCity(city.url, city.name)).ppm;
    const b = city.bounds;
    const area: Box = { x: b.x + rect.x / ppm, y: b.y + rect.y / ppm, w: rect.w / ppm, h: rect.h / ppm };
    const id = `area-${Math.round(area.x)}-${Math.round(area.y)}`.replace(/-+/g, "-");
    const plan = areaPlan(city, area, { key, prefix: this.prefix(key, city), id, title: `${city.name}: streets`, time });
    return this.setPlan(plan);
  }

  /** Short text summary of a map for Claude and the panel. */
  summary(id: string): string {
    const s = this.get(id);
    const lines = [`Map ${s.id}: ${s.plan.title ?? ""} (${s.plan.genre}, ${s.plan.size.w}x${s.plan.size.h} squares, seed ${s.plan.seed})`];
    lines.push(`Zones: ${s.gen.layout.zones.map((z) => `${z.id} [${z.type}] ${z.rect.w}x${z.rect.h} at ${z.rect.x},${z.rect.y}`).join("; ")}`);
    for (const v of s.gen.versions) {
      lines.push(`${v.id}${s.plan.versions?.picked === v.id ? " (picked)" : ""} "${v.name}": ${v.summary.objects} pieces, ${v.summary.lights} lights. ${Object.entries(v.summary.byType).map(([t, n]) => `${t} ${n}`).join(", ")}`);
      if (v.notes.length) lines.push(`  notes: ${v.notes.slice(0, 6).join(" | ")}`);
    }
    lines.push(`Directives: ${(s.plan.directives ?? []).map((d) => d.id + ":" + Object.keys(d).find((k) => ["pin", "free", "forbid", "modify", "restyle"].includes(k))).join(", ") || "none"}; locks: ${(s.plan.locks ?? []).length}`);
    return lines.join("\n");
  }
}
