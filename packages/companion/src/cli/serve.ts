/**
 * Start the companion.
 *   npm run serve            (claude -p backend, uses your Claude subscription)
 *   GMM_BACKEND=api ANTHROPIC_API_KEY=... npm run serve   (Anthropic API backend)
 * Env: GMM_PORT (47110), GMM_DATA (data), GMM_INDEX (data/asset-index.json), GMM_DD_EXE.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetIndex } from "@gmm/core";
import { AssetSource } from "../assets/source";
import { ApiBackend } from "../llm/api";
import { ClaudeCliBackend } from "../llm/claude-cli";
import { CompanionServer } from "../server/server";
import { MapStore } from "../server/store";
import { loadIndex } from "../assets/load";

const data = resolve(process.env.GMM_DATA ?? "data");
const port = Number(process.env.GMM_PORT ?? 47110);
const indexFile = resolve(process.env.GMM_INDEX ?? join(data, "asset-index.json"));
const backendKind = process.env.GMM_BACKEND === "api" ? "api" : "claude-cli";

await mkdir(data, { recursive: true });
const tokenFile = join(data, "companion-token.txt");
let token: string;
try {
  token = (await readFile(tokenFile, "utf8")).trim();
} catch {
  token = randomBytes(24).toString("hex");
  await writeFile(tokenFile, token, { mode: 0o600 });
}

const index = await loadIndex(indexFile);
const src = new AssetSource(index);
const store = new MapStore(data, index, src);
await store.load();

const here = dirname(fileURLToPath(import.meta.url));
const proxy = resolve(here, "../llm/mcp-proxy.ts");
const tsxLoader = resolve(here, "../../../../node_modules/tsx/dist/esm/index.mjs");
const server = new CompanionServer({
  store,
  token,
  port,
  dungeondraftExe: process.env.GMM_DD_EXE,
  log: (m) => console.log(m),
  backend: () =>
    backendKind === "api"
      ? new ApiBackend(store, { effort: "medium" })
      : new ClaudeCliBackend({ workDir: data, rpcUrl: `http://127.0.0.1:${port}`, token, model: process.env.GMM_MODEL, proxyCommand: [process.execPath, "--import", `file:///${tsxLoader.replace(/\\/g, "/")}`, proxy] }),
});
await server.start();
console.log(`Georgios' Map Maker companion on http://127.0.0.1:${server.port} (backend: ${backendKind})`);
console.log(`Token for the Foundry module settings is in ${tokenFile}`);
console.log(`${store.list().length} saved maps; index with ${index.assets.length} assets.`);
const stop = async () => {
  await server.stop();
  await src.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
