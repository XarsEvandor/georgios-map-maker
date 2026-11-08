import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ScenePlan } from "@gmm/core";
import { testIndex } from "../../core/test/fixtures";
import { AssetSource } from "../src/assets/source";
import type { ChatEvent, LlmBackend } from "../src/llm/backend";
import { CompanionServer, tokenOk } from "../src/server/server";
import { MapStore } from "../src/server/store";

const TOKEN = "t".repeat(48);
const tavern = JSON.parse(await readFile(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;

class FakeBackend implements LlmBackend {
  readonly name = "api" as const;
  async send(message: string, onEvent: (e: ChatEvent) => void) {
    onEvent({ type: "text", text: `echo: ${message}` });
    onEvent({ type: "done" });
  }
  async close() {}
}

let server: CompanionServer;
let base: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "gmm-"));
  const index = testIndex();
  const store = new MapStore(dir, index, new AssetSource(index));
  await store.load();
  server = new CompanionServer({ store, token: TOKEN, port: 0, backend: () => new FakeBackend() });
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => server.stop());

const rpc = async (method: string, params: unknown, token: string | null = TOKEN, origin?: string) => {
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify({ id: 1, method, params }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
};

describe("companion server", () => {
  it("compares tokens safely", () => {
    expect(tokenOk(TOKEN, TOKEN)).toBe(true);
    expect(tokenOk("short", TOKEN)).toBe(false);
    expect(tokenOk(undefined, TOKEN)).toBe(false);
  });

  it("answers health without a token but nothing else", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await rpc("ping", {}, null)).status).toBe(401);
    expect((await rpc("ping", {}, "x".repeat(48))).status).toBe(401);
    expect((await rpc("ping", {})).body.result.ok).toBe(true);
    expect((await fetch(`${base}/image/a/v1?token=wrong`)).status).toBe(401);
  });

  it("sends CORS headers for the Foundry page", async () => {
    const r = await rpc("ping", {}, TOKEN, "https://foundry.example.com");
    expect(r.headers.get("access-control-allow-origin")).toBe("https://foundry.example.com");
    expect(r.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("rejects unknown methods and oversized bodies", async () => {
    expect((await rpc("fs.readFile", { path: "C:/Windows/win.ini" })).body.error.message).toMatch(/unknown method/);
    const big = await fetch(`${base}/rpc`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "x".repeat(3 * 1024 * 1024) }).catch((e) => e);
    expect(big instanceof Error || (big as Response).status === 400).toBe(true);
  });

  it("refuses map ids that try to leave the data folder", async () => {
    const bad = { ...tavern, id: "../../evil" };
    const r = await rpc("tools.call", { name: "set_plan", input: { plan: bad } });
    expect(r.body.result.isError).toBe(true);
    expect((await rpc("maps.get", { mapId: "..\\..\\evil" })).body.error).toBeDefined();
  });

  it("runs the tools end to end", async () => {
    const tools = (await rpc("tools.list", {})).body.result.map((t: any) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["set_plan", "apply_directive", "render_preview", "lock", "search_assets"]));
    const set = (await rpc("tools.call", { name: "set_plan", input: { plan: tavern } })).body.result;
    expect(set.isError).toBeFalsy();
    expect(set.content[0].text).toMatch(/Generated/);
    const bad = (await rpc("tools.call", { name: "apply_directive", input: { map_id: tavern.id, directive: { id: "x", forbid: "not-a-list" } } })).body.result;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/forbid/);
    const ok = (await rpc("tools.call", { name: "apply_directive", input: { map_id: tavern.id, directive: { id: "nobeds", forbid: ["bed"], source: "dm-chat" } } })).body.result;
    expect(ok.isError).toBeFalsy();
    const got = (await rpc("maps.get", { mapId: tavern.id })).body.result;
    expect(got.plan.directives.some((d: any) => d.id === "nobeds")).toBe(true);
    expect(got.versions.every((v: any) => !v.summary.byType.bed)).toBe(true);
    const lock = (await rpc("tools.call", { name: "lock", input: { map_id: tavern.id, pieces: [1, 2] } })).body.result;
    expect(lock.isError).toBeFalsy();
    const exp = (await rpc("maps.export", { mapId: tavern.id, pps: 100 })).body.result;
    expect(exp.scene.walls.length).toBeGreaterThan(4);
    expect(exp.imagePath).toMatch(/^\/image\//);
  });

  it("streams chat events over the WebSocket and needs the token", async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=nope`);
      ws.on("open", () => resolve("opened"));
      ws.on("error", reject);
      ws.on("unexpected-response", () => reject(new Error("rejected")));
    })).rejects.toThrow();
    const events = await new Promise<any[]>((resolve, reject) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=${TOKEN}`);
      const got: any[] = [];
      ws.on("open", () => ws.send(JSON.stringify({ id: 7, method: "chat.send", params: { chatId: "c1", text: "hello" } })));
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        got.push(m);
        if (m.type === "chat" && m.event.type === "done") {
          ws.close();
          resolve(got);
        }
      });
      ws.on("error", reject);
    });
    expect(events.some((e) => e.id === 7 && e.result?.accepted)).toBe(true);
    expect(events.some((e) => e.type === "chat" && e.event.text === "echo: hello")).toBe(true);
  });
});

describe("locks across a companion restart", () => {
  it("keeps locked pieces when the store loads the map again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gmm-locks-"));
    const index = testIndex();
    const tavernPlan = JSON.parse(await readFile(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
    const a = new MapStore(dir, index, new AssetSource(index));
    await a.setPlan({ ...tavernPlan, versions: { count: 2, picked: "v1" } });
    const s = await a.addLocks(tavernPlan.id, [{ id: "kitchen", region: { x: 0, y: 0, w: 80, h: 80 } }]);
    const before = s.gen.versions[0]!.placed.map((p) => p.key).sort();
    // A fresh store, as after a restart, reads the plan and the saved pieces.
    const b = new MapStore(dir, index, new AssetSource(index));
    await b.load();
    const after = b.get(tavernPlan.id).gen.versions[0]!.placed.map((p) => p.key).sort();
    expect(after).toEqual(before);
  });
});

describe("city links", async () => {
  const { cityKey, cityLink } = await import("../src/city/fetch");
  it("accepts watabou city-generator links only, and ignores an export parameter", () => {
    expect(cityLink("https://watabou.github.io/city-generator/?seed=1&export=json").toString()).toBe("https://watabou.github.io/city-generator/?seed=1");
    expect(cityKey("https://watabou.github.io/city-generator/?seed=1")).toBe(cityKey("https://watabou.github.io/city-generator/?seed=1&export=png"));
    for (const bad of ["http://watabou.github.io/city-generator/?seed=1", "https://evil.example/city-generator/", "https://watabou.github.io/one-page-dungeon/", "file:///c:/x", "javascript:alert(1)"]) expect(() => cityLink(bad)).toThrow();
  });
});
