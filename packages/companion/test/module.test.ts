/** The Foundry module's client code, run against a real companion server. */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ScenePlan } from "@gmm/core";
// @ts-expect-error plain JS module without types
import { CompanionClient, companionBase, esc, latestMap, leafFileName, miniMarkdown, renderFileName, sceneData, withLeafTextures } from "../../../foundry-module/scripts/lib.js";
import { testIndex } from "../../core/test/fixtures";
import { AssetSource } from "../src/assets/source";
import type { ChatEvent, LlmBackend } from "../src/llm/backend";
import { CompanionServer } from "../src/server/server";
import { MapStore } from "../src/server/store";

const TOKEN = "m".repeat(48);
const tavern = JSON.parse(await readFile(new URL("../../../examples/plans/tavern.json", import.meta.url), "utf8")) as ScenePlan;
let server: CompanionServer;
let url: string;

class Scripted implements LlmBackend {
  readonly name = "api" as const;
  async send(_m: string, on: (e: ChatEvent) => void) {
    on({ type: "tool", tool: "set_plan" });
    on({ type: "text", text: "Built three versions." });
    on({ type: "done" });
  }
  async close() {}
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "gmm-mod-"));
  const index = testIndex();
  const store = new MapStore(dir, index, new AssetSource(index));
  server = new CompanionServer({ store, token: TOKEN, port: 0, backend: () => new Scripted() });
  await server.start();
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => server.stop());

describe("Foundry module helpers", () => {
  it("normalizes the companion address", () => {
    expect(companionBase("http://127.0.0.1:47110/")).toBe("http://127.0.0.1:47110");
    expect(() => companionBase("javascript:alert(1)")).toThrow();
    expect(() => companionBase("file:///C:/x")).toThrow();
  });

  it("escapes HTML and makes safe file names", () => {
    expect(esc(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(renderFileName("../../evil", "v1")).toMatch(/^______evil-v1-\d+\.webp$/);
  });

  it("talks to the companion: plan, export, scene data and chat", async () => {
    const c = new CompanionClient(url, TOKEN);
    await c.rpc("maps.setPlan", { plan: tavern });
    const map = await c.rpc("maps.get", { mapId: tavern.id });
    expect(map.versions).toHaveLength(3);
    const exported = await c.rpc("maps.export", { mapId: tavern.id, version: "v2", pps: 100 });
    const data = sceneData(exported, "georgios-map-maker/x.webp", tavern.id, "v2");
    expect(data.background.src).toBe("georgios-map-maker/x.webp");
    expect(data.grid.size).toBe(100);
    expect(data.flags["georgios-map-maker"].mapId).toBe(tavern.id);
    expect(data.environment.darknessLevel).toBeGreaterThan(0);
    const bad = new CompanionClient(url, "wrong");
    await expect(bad.rpc("maps.list")).rejects.toThrow(/token/);

    const events: any[] = [];
    c.connect(WebSocket);
    const done = new Promise<void>((resolve) => c.onMessage((m: any) => { events.push(m); if (m.type === "chat" && m.event.type === "done") resolve(); }));
    const ack = await c.call("chat.send", { chatId: "x", text: "a tavern please" });
    expect(ack.accepted).toBe(true);
    await done;
    expect(events.map((e) => e.event?.type)).toEqual(expect.arrayContaining(["tool", "text", "done"]));
    c.ws.close();
  });
});

describe("Foundry module: gates and the panel", () => {
  it("points gate animations at uploaded leaves and drops ones that failed", () => {
    const walls = [{ animation: { type: "swing", texture: "leaf:6" } }, { animation: { type: "swing", texture: "leaf:9" } }, { c: [0, 0, 1, 1] }];
    const out = withLeafTextures(walls, { 6: "georgios-map-maker/leaf6.png" });
    expect(out[0].animation.texture).toBe("georgios-map-maker/leaf6.png");
    expect(out[1].animation).toBeNull();
    expect(out[2]).toEqual({ c: [0, 0, 1, 1] });
    expect(leafFileName("castle/../x", "v1", "6/..")).toMatch(/^castle____x-v1-leaf-6-\d+\.png$/);
  });
  it("renders Claude's markdown without letting markup through", () => {
    const html = miniMarkdown("I built **the gate**.\n- <img src=x onerror=alert(1)> *dark*\n- `code`");
    expect(html).toContain("<strong>the gate</strong>");
    expect(html).toContain("<ul><li>");
    expect(html).toContain("<em>dark</em>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("reopens on the map changed last", () => {
    expect(latestMap([{ id: "a", updatedAt: "2026-11-06T10:00:00Z" }, { id: "b", updatedAt: "2026-11-06T12:00:00Z" }])).toBe("b");
    expect(latestMap([])).toBeNull();
  });
});
