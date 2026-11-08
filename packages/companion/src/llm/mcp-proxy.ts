/**
 * MCP server (stdio) that `claude -p` starts. It forwards every tool call to the running
 * companion over its local HTTP RPC, so there is one source of truth for map state.
 * Env: GMM_RPC_URL (e.g. http://127.0.0.1:47110), GMM_TOKEN.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const url = process.env.GMM_RPC_URL ?? "http://127.0.0.1:47110";
const token = process.env.GMM_TOKEN ?? "";

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const server = new Server({ name: "georgios-map-maker", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = (await rpc("tools.list", {})) as Array<{ name: string; description: string; input_schema: object }>;
  return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const r = (await rpc("tools.call", { name: req.params.name, input: req.params.arguments ?? {} })) as { content: any[]; isError?: boolean };
    return { content: r.content, isError: r.isError };
  } catch (e) {
    return { content: [{ type: "text", text: `companion error: ${(e as Error).message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
