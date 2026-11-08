/**
 * Sends one chat message to a running companion and prints the streamed events.
 *   npx tsx packages/companion/src/cli/chat-smoke.ts "message" [--port 47110]
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: "string", default: "47110" }, timeout: { type: "string", default: "240" } } });
const token = (await readFile("data/companion-token.txt", "utf8")).trim();
const ws = new WebSocket(`ws://127.0.0.1:${values.port}/ws?token=${token}`);
const t0 = Date.now();
const timer = setTimeout(() => { console.log("TIMEOUT"); process.exit(3); }, Number(values.timeout) * 1000);
ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "chat.send", params: { chatId: "smoke", text: positionals[0] ?? "Call list_room_types, then reply with only the number of room types." } })));
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.type === "chat") {
    const e = m.event;
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.type}${e.tool ? ` ${e.tool}` : ""}${e.text ? `: ${String(e.text).slice(0, 300)}` : ""}`);
    if (e.type === "done") { clearTimeout(timer); ws.close(); process.exit(0); }
  } else if (m.error) console.log("error:", m.error.message);
});
ws.on("error", (e) => { console.log("ws error", e.message); process.exit(2); });
