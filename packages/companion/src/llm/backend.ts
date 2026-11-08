/** One interface for the two Claude backends (DESIGN.md section 13). */

export interface ChatEvent {
  type: "text" | "tool" | "done" | "error";
  text?: string;
  tool?: string;
}

export interface LlmBackend {
  readonly name: "api" | "claude-cli";
  /** Sends one DM message; events stream back until "done" or "error". */
  send(message: string, onEvent: (e: ChatEvent) => void): Promise<void>;
  close(): Promise<void>;
}
