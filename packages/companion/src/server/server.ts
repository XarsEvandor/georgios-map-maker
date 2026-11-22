/**
 * Companion server: local HTTP RPC + WebSocket for the Foundry module and the MCP proxy.
 * Binds to 127.0.0.1 only; every request needs the companion token.
 */

import { timingSafeEqual } from "node:crypto";
import type { FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ScenePlan } from "@gmm/core";
import { enablePacksInDungeondraft, openInDungeondraft, watchMapFile } from "../dd/bridge";
import type { ChatEvent, LlmBackend } from "../llm/backend";
import type { MapStore } from "./store";
import { runTool, TOOLS } from "./tools";
import { worldRoute } from "../world/route";

export interface ServerOptions {
  store: MapStore;
  token: string;
  port: number;
  host?: string;
  /** Creates a Claude backend for a new chat. */
  backend: (chatId: string) => LlmBackend;
  dungeondraftExe?: string;
  log?: (msg: string) => void;
}

const MAX_BODY = 2 * 1024 * 1024;

export function tokenOk(given: string | undefined | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export class CompanionServer {
  private http?: Server;
  private wss?: WebSocketServer;
  private readonly chats = new Map<string, { backend: LlmBackend; busy: boolean }>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly o: ServerOptions) {}

  /** RPC methods available to the module and the MCP proxy. */
  private async call(method: string, p: Record<string, any>, emit?: (msg: unknown) => void): Promise<unknown> {
    const s = this.o.store;
    switch (method) {
      case "ping":
        return { ok: true, name: "georgios-map-maker" };
      case "tools.list":
        return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
      case "tools.call": {
        const r = await runTool(s, String(p.name), p.input);
        if (typeof p.input?.map_id === "string" || p.input?.plan?.id) this.broadcast({ type: "map.changed", mapId: p.input?.map_id ?? p.input?.plan?.id });
        return r;
      }
      case "maps.list":
        return s.list();
      case "maps.get": {
        const m = s.get(String(p.mapId));
        return { plan: m.plan, summary: s.summary(m.id), versions: m.gen.versions.map((v) => ({ id: v.id, name: v.name, summary: v.summary, notes: v.notes })), labels: s.labels(m.id) };
      }
      case "maps.setPlan": {
        const m = await s.setPlan(p.plan as ScenePlan);
        this.broadcast({ type: "map.changed", mapId: m.id });
        return { summary: s.summary(m.id) };
      }
      case "maps.pick": {
        await s.pick(String(p.mapId), String(p.version));
        this.broadcast({ type: "map.changed", mapId: p.mapId });
        return { ok: true };
      }
      case "maps.reseed": {
        await s.reseed(String(p.mapId));
        this.broadcast({ type: "map.changed", mapId: p.mapId });
        return { ok: true };
      }
      case "city.open": {
        if (typeof p.url !== "string") throw new Error("url required");
        const info = await s.openCity(p.url, typeof p.name === "string" ? p.name : undefined);
        return { ...info, imagePath: `/city/${info.key}.webp` };
      }
      case "city.refresh": {
        if (!/^[0-9a-f]{8,40}$/.test(String(p.city))) throw new Error("bad city key");
        const info = await s.refreshCity(String(p.city));
        return { ...info, imagePath: `/city/${info.key}.webp` };
      }
      case "city.night": {
        // Draws (or finds) the city's night image; the module fetches it from imagePath.
        if (!/^[0-9a-f]{8,40}$/.test(String(p.city))) throw new Error("bad city key");
        await s.cityNightImage(String(p.city));
        return { key: String(p.city), imagePath: `/city/${p.city}.night.webp` };
      }
      case "city.places": {
        if (!/^[0-9a-f]{8,40}$/.test(String(p.city))) throw new Error("bad city key");
        return { hotspots: await s.cityPlaces(String(p.city)) };
      }
      case "city.build": {
        const key = String(p.city);
        const time = ["day", "dusk", "night"].includes(p.time) ? p.time : undefined;
        const m = p.hotspot ? await s.buildHotspot(key, String(p.hotspot), time) : p.rect ? await s.buildArea(key, { x: Number(p.rect.x), y: Number(p.rect.y), w: Number(p.rect.w), h: Number(p.rect.h) }, time) : undefined;
        if (!m) throw new Error("hotspot or rect required");
        return { mapId: m.id, title: m.plan.title, version: m.plan.versions?.picked ?? m.gen.versions[0]?.id };
      }
      case "maps.export": {
        const pps = Math.max(32, Math.min(256, Number(p.pps ?? 100)));
        const vid = s.version(String(p.mapId), p.version).id;
        const scene = s.exportScene(String(p.mapId), p.version, pps);
        const leaves = scene.walls.filter((w) => w.animation?.texture.startsWith("leaf:")).map((w) => ({ portal: w.animation!.texture.slice(5), path: `/leaf/${encodeURIComponent(p.mapId)}/${encodeURIComponent(vid)}/${encodeURIComponent(w.animation!.texture.slice(5))}` }));
        return { scene, imagePath: `/image/${encodeURIComponent(p.mapId)}/${encodeURIComponent(vid)}?pps=${pps}&leaves=hide`, leaves };
      }
      case "maps.people": {
        const pps = Math.max(32, Math.min(256, Number(p.pps ?? 100)));
        return { people: s.people(String(p.mapId), p.version, pps) };
      }
      case "maps.route":
        // The way between two towns of a built world, in words and as a picture (for the GM's assistant).
        return worldRoute(s.dataDir, String(p.world ?? ""), String(p.from ?? "").slice(0, 120), String(p.to ?? "").slice(0, 120), {
          image: p.image !== false,
          // Towns to pass through, in order; at most six.
          via: Array.isArray(p.via) ? p.via.slice(0, 6).map((v: unknown) => String(v ?? "").slice(0, 120)) : [],
          land: p.land === true,
          // Or the towns by id, in order (clicked on the map); at most eight.
          ids: Array.isArray(p.towns) ? p.towns.slice(0, 8).map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : undefined,
        });
      case "dd.open": {
        const file = s.mapFile(String(p.mapId), p.version);
        const version = s.version(String(p.mapId), p.version).id;
        openInDungeondraft(file, this.o.dungeondraftExe);
        const key = `${p.mapId}|${version}`;
        if (!this.watchers.has(key)) {
          this.watchers.set(key, watchMapFile(file, async (saved) => {
            const r = await s.adoptDungeondraftSave(String(p.mapId), saved, version);
            this.o.log?.(`Dungeondraft save for ${p.mapId}: ${r.changes.length} changes, ${r.locks.length} locks`);
            this.broadcast({ type: "map.changed", mapId: p.mapId, dungeondraft: { changes: r.changes.length, unmapped: r.unmapped } });
          }));
        }
        return { opened: file };
      }
      case "dd.enablePacks": {
        const v = s.version(String(p.mapId), p.version);
        const ids = ((v.map.header as any).asset_manifest as Array<{ id: string }>).map((m) => m.id);
        return enablePacksInDungeondraft(ids);
      }
      case "chat.send": {
        const chatId = String(p.chatId ?? "default").slice(0, 64);
        let chat = this.chats.get(chatId);
        if (!chat) {
          chat = { backend: this.o.backend(chatId), busy: false };
          this.chats.set(chatId, chat);
        }
        if (chat.busy) throw new Error("Claude is still working on the previous message");
        const text = String(p.text ?? "").slice(0, 8000);
        if (!text.trim()) throw new Error("empty message");
        chat.busy = true;
        const c = chat;
        void c.backend
          .send(text, (e: ChatEvent) => emit?.({ type: "chat", chatId, event: e }))
          .catch((e) => emit?.({ type: "chat", chatId, event: { type: "error", text: (e as Error).message } }))
          .finally(() => {
            c.busy = false;
            emit?.({ type: "chat", chatId, event: { type: "done" } });
          });
        return { accepted: true };
      }
      case "chat.reset": {
        const chatId = String(p.chatId ?? "default");
        await this.chats.get(chatId)?.backend.close();
        this.chats.delete(chatId);
        return { ok: true };
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // Chrome asks this before a public site may reach a local address.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.cors(req, res);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : (body as Buffer));
    };
    if (req.method === "OPTIONS") return void send(204, "", "text/plain");
    if (url.pathname === "/health") return void send(200, { ok: true, name: "georgios-map-maker" });
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token");
    if (!tokenOk(auth, this.o.token)) return void send(401, { error: { message: "missing or wrong companion token" } });
    try {
      if (req.method === "POST" && url.pathname === "/rpc") {
        const body = JSON.parse(await readBody(req)) as { id?: unknown; method?: unknown; params?: unknown };
        if (typeof body.method !== "string") return void send(400, { id: body.id, error: { message: "method required" } });
        const params = typeof body.params === "object" && body.params !== null ? (body.params as Record<string, any>) : {};
        const result = await this.call(body.method, params);
        return void send(200, { id: body.id, result });
      }
      const m = /^\/image\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const mapId = decodeURIComponent(m[1]!), version = decodeURIComponent(m[2]!);
        const pps = Math.max(16, Math.min(256, Number(url.searchParams.get("pps") ?? 64)));
        const img = await this.o.store.render(mapId, version, { pps, lighting: url.searchParams.get("lighting") === "1", labeled: url.searchParams.get("labels") === "1", format: "webp", quality: 85, ...(url.searchParams.get("leaves") === "hide" ? { leafMode: "hide" as const } : {}) });
        res.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" });
        return void res.end(img);
      }
      const cm = /^\/city\/([0-9a-f]{8,40})(\.night)?\.webp$/.exec(url.pathname);
      if (req.method === "GET" && cm) {
        const img = cm[2] ? await this.o.store.cityNightImage(cm[1]!) : await this.o.store.cityImage(cm[1]!);
        res.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" });
        return void res.end(img);
      }
      const lm = /^\/leaf\/([^/]+)\/([^/]+)\/([0-9a-f]{1,12})$/i.exec(url.pathname);
      if (req.method === "GET" && lm) {
        const png = await this.o.store.leafPng(decodeURIComponent(lm[1]!), decodeURIComponent(lm[2]!), lm[3]!);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        return void res.end(png);
      }
      send(404, { error: { message: "not found" } });
    } catch (e) {
      send(400, { error: { message: (e as Error).message } });
    }
  }

  async start(): Promise<void> {
    this.http = createServer((req, res) => void this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
    this.http.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/ws" || !tokenOk(url.searchParams.get("token"), this.o.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws);
        ws.on("close", () => this.sockets.delete(ws));
        ws.on("message", async (data) => {
          let msg: { id?: unknown; method?: unknown; params?: unknown };
          try {
            msg = JSON.parse(String(data));
          } catch {
            return ws.send(JSON.stringify({ error: { message: "bad JSON" } }));
          }
          try {
            const params = typeof msg.params === "object" && msg.params !== null ? (msg.params as Record<string, any>) : {};
            const result = await this.call(String(msg.method), params, (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)));
            ws.send(JSON.stringify({ id: msg.id, result }));
          } catch (e) {
            ws.send(JSON.stringify({ id: msg.id, error: { message: (e as Error).message } }));
          }
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(this.o.port, this.o.host ?? "127.0.0.1", () => resolve());
    });
  }

  get port(): number {
    const a = this.http?.address();
    return typeof a === "object" && a ? a.port : this.o.port;
  }

  async stop(): Promise<void> {
    for (const w of this.watchers.values()) w.close();
    for (const c of this.chats.values()) await c.backend.close();
    for (const ws of this.sockets) ws.terminate();
    this.wss?.close();
    await new Promise<void>((r) => this.http?.close(() => r()) ?? r());
  }
}
