/**
 * `claude -p` backend: one long-lived Claude Code process per chat, fed with stream-json
 * messages, with only our MCP tools available. Uses the DM's Claude subscription.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ChatEvent, LlmBackend } from "./backend";
import { SYSTEM_PROMPT } from "./prompt";

export interface CliOptions {
  /** Folder for the generated MCP config and system prompt files. */
  workDir: string;
  /** Companion RPC address and token, passed to the MCP proxy. */
  rpcUrl: string;
  token: string;
  /** Command that starts the MCP proxy, e.g. ["node", "--import", "tsx", ".../mcp-proxy.ts"]. */
  proxyCommand: string[];
  claudePath?: string;
  model?: string;
  maxTurns?: number;
}

/**
 * Finds the Claude Code executable: GMM_CLAUDE, then `claude` on PATH, then the binary
 * bundled with the VS Code extension (newest version).
 */
export function findClaude(): string {
  if (process.env.GMM_CLAUDE) return process.env.GMM_CLAUDE;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  try {
    const ext = join(home, ".vscode", "extensions");
    const dirs = readdirSync(ext).filter((d) => d.startsWith("anthropic.claude-code")).sort().reverse();
    for (const d of dirs) {
      const exe = join(ext, d, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude");
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* no VS Code extensions folder */
  }
  return "claude";
}

export class ClaudeCliBackend implements LlmBackend {
  readonly name = "claude-cli" as const;
  private proc?: ChildProcessWithoutNullStreams;
  private pending?: { onEvent: (e: ChatEvent) => void; resolve: () => void };

  constructor(private readonly opts: CliOptions) {}

  private async start(): Promise<void> {
    const mcpConfig = join(this.opts.workDir, "mcp-config.json");
    const promptFile = join(this.opts.workDir, "system-prompt.md");
    const [cmd, ...args] = this.opts.proxyCommand;
    await writeFile(mcpConfig, JSON.stringify({ mcpServers: { gmm: { command: cmd, args, env: { GMM_RPC_URL: this.opts.rpcUrl, GMM_TOKEN: this.opts.token } } } }));
    await writeFile(promptFile, SYSTEM_PROMPT);
    // A set ANTHROPIC_API_KEY would switch claude -p to API billing; subscription mode removes it.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const argv = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt-file", promptFile,
      "--strict-mcp-config", "--mcp-config", mcpConfig,
      "--allowedTools", "mcp__gmm",
      // Only the map tools: no shell, files, skills or web. ToolSearch stays so MCP tools can load.
      "--tools", "ToolSearch",
      // Keep the DM's own Claude Code setup (CLAUDE.md, skills, hooks) out of the map builder.
      "--setting-sources", "local",
      "--max-turns", String(this.opts.maxTurns ?? 30),
      "--model", this.opts.model ?? "opus",
    ];
    // No shell: arguments go to the process as-is, so nothing in them can be interpreted.
    // A neutral working folder: claude walks up from its cwd collecting CLAUDE.md files.
    const cwd = join(tmpdir(), "georgios-map-maker-claude");
    await mkdir(cwd, { recursive: true });
    this.proc = spawn(this.opts.claudePath ?? findClaude(), argv, { env, cwd, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.onLine(line));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", (code) => {
      this.pending?.onEvent({ type: "error", text: `claude exited (${code}). Is Claude Code installed and signed in?` });
      this.pending?.resolve();
      this.pending = undefined;
      this.proc = undefined;
    });
    this.proc.on("error", (e) => {
      this.pending?.onEvent({ type: "error", text: `could not start claude: ${e.message}` });
      this.pending?.resolve();
      this.pending = undefined;
    });
  }

  private onLine(line: string): void {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const p = this.pending;
    if (!p) return;
    if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text) p.onEvent({ type: "text", text: b.text });
        if (b.type === "tool_use") p.onEvent({ type: "tool", tool: String(b.name).replace(/^mcp__gmm__/, "") });
      }
    } else if (ev.type === "result") {
      if (ev.is_error) p.onEvent({ type: "error", text: String(ev.result ?? "claude reported an error") });
      p.onEvent({ type: "done" });
      p.resolve();
      this.pending = undefined;
    }
  }

  async send(message: string, onEvent: (e: ChatEvent) => void): Promise<void> {
    if (!this.proc) await this.start();
    if (this.pending) throw new Error("a message is already in progress");
    await new Promise<void>((resolve) => {
      this.pending = { onEvent, resolve };
      this.proc!.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: message }] } })}\n`);
    });
  }

  async close(): Promise<void> {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
  }
}
