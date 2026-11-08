/**
 * Anthropic API backend: a manual tool loop over our map tools.
 * Model claude-opus-5-5 with adaptive thinking, explicit effort, and server-side refusal fallbacks.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MapStore } from "../server/store";
import { runTool, TOOLS } from "../server/tools";
import type { ChatEvent, LlmBackend } from "./backend";
import { SYSTEM_PROMPT } from "./prompt";

export interface ApiOptions {
  apiKey?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Safety cap on tool rounds per DM message. */
  maxRounds?: number;
}

export class ApiBackend implements LlmBackend {
  readonly name = "api" as const;
  private readonly client: Anthropic;
  private readonly messages: any[] = [];

  constructor(private readonly store: MapStore, private readonly opts: ApiOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async send(message: string, onEvent: (e: ChatEvent) => void): Promise<void> {
    this.messages.push({ role: "user", content: [{ type: "text", text: message }] });
    const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    for (let round = 0; round < (this.opts.maxRounds ?? 12); round++) {
      let response: any;
      try {
        response = await (this.client.beta.messages.create as (p: unknown) => Promise<any>)({
          model: this.opts.model ?? "claude-opus-5-5",
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: this.opts.effort ?? "medium" },
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools,
          messages: this.messages,
        });
      } catch (e) {
        const err = e as { status?: number; message?: string };
        onEvent({ type: "error", text: err.status === 401 ? "The Anthropic API key was rejected." : err.status === 429 ? "Rate limited by the Anthropic API; try again in a moment." : `API error: ${err.message ?? e}` });
        this.messages.pop();
        return;
      }
      // Keep the assistant turn exactly as returned (thinking blocks included).
      this.messages.push({ role: "assistant", content: response.content });
      for (const block of response.content) if (block.type === "text" && block.text) onEvent({ type: "text", text: block.text });
      if (response.stop_reason === "refusal") {
        onEvent({ type: "error", text: "Claude declined this request." });
        return;
      }
      const uses = response.content.filter((b: any) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !uses.length) break;
      const results = [];
      for (const u of uses) {
        onEvent({ type: "tool", tool: u.name });
        const r = await runTool(this.store, u.name, u.input);
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          is_error: !!r.isError,
          content: r.content.map((c) => (c.type === "text" ? { type: "text", text: c.text } : { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } })),
        });
      }
      this.messages.push({ role: "user", content: results });
    }
    onEvent({ type: "done" });
  }

  async close(): Promise<void> {}
}
