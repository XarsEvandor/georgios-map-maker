/**
 * Pure helpers for the Foundry module: companion client and scene data.
 * No Foundry globals here, so these can be tested outside Foundry.
 */

export const MODULE_ID = "georgios-map-maker";

/** Normalizes the companion address: http(s) only, no trailing slash, localhost by default. */
export function companionBase(url) {
  const u = new URL(url || "http://127.0.0.1:47110");
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("companion address must start with http:// or https://");
  return `${u.protocol}//${u.host}`;
}

export class CompanionClient {
  constructor(url, token, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.base = companionBase(url);
    this.token = token;
    this.fetch = fetchImpl;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.listeners = new Set();
  }

  async rpc(method, params = {}) {
    const res = await this.fetch(`${this.base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ id: this.nextId++, method, params }),
    });
    const body = await res.json().catch(() => ({ error: { message: `companion answered ${res.status}` } }));
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  /** Image bytes for a render path returned by the companion (token sent as a header). */
  async image(path, query = {}) {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    const res = await this.fetch(u.toString(), { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`render failed (${res.status})`);
    return res.blob();
  }

  connect(WebSocketImpl = globalThis.WebSocket) {
    if (this.ws && this.ws.readyState <= 1) return this.ws;
    const wsUrl = `${this.base.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocketImpl(wsUrl);
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    };
    return this.ws;
  }

  /** WebSocket call (used for chat, which streams events back). */
  call(method, params = {}) {
    const ws = this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const send = () => ws.send(JSON.stringify({ id, method, params }));
      ws.readyState === 1 ? send() : ws.addEventListener("open", send, { once: true });
    });
  }

  onMessage(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Scene document data for Foundry v13 from the companion's export. */
export function sceneData(exported, backgroundSrc, mapId, versionId) {
  const s = exported.scene;
  return {
    name: s.name,
    width: s.width,
    height: s.height,
    padding: s.padding,
    background: { src: backgroundSrc },
    grid: { type: s.grid.type, size: s.grid.size, distance: s.grid.distance, units: s.grid.units },
    environment: { darknessLevel: s.darkness },
    tokenVision: true,
    flags: { [MODULE_ID]: { mapId, version: versionId, credit: s.notes } },
  };
}

/** Safe file name for an uploaded render. */
export function renderFileName(mapId, versionId) {
  return `${String(mapId).replace(/[^a-z0-9_-]/gi, "_")}-${String(versionId).replace(/[^a-z0-9_-]/gi, "_")}-${Date.now()}.webp`;
}

/** Safe file name for an uploaded gate leaf texture. */
export function leafFileName(mapId, versionId, portal) {
  return `${String(mapId).replace(/[^a-z0-9_-]/gi, "_")}-${String(versionId).replace(/[^a-z0-9_-]/gi, "_")}-leaf-${String(portal).replace(/[^a-z0-9]/gi, "")}-${Date.now()}.png`;
}

/**
 * Points each gate's door animation at its uploaded leaf texture ("leaf:<portal>" placeholders
 * from the companion). Gates whose leaf failed to upload get no animation.
 */
export function withLeafTextures(walls, uploaded) {
  return walls.map((w) => {
    const t = w.animation?.texture;
    if (typeof t !== "string" || !t.startsWith("leaf:")) return w;
    const path = uploaded[t.slice(5)];
    return path ? { ...w, animation: { ...w.animation, texture: path } } : { ...w, animation: null };
  });
}

/**
 * Claude's replies as safe HTML: the text is escaped first, then **bold**, *italic*,
 * `code` and "- " list lines become markup. Nothing from the text can inject tags.
 */
export function miniMarkdown(text) {
  const lines = esc(text).split(/\r?\n/);
  const inline = (l) => l.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = [];
  let list = false;
  for (const l of lines) {
    const m = /^\s*[-*] (.*)$/.exec(l);
    if (m) {
      if (!list) { out.push("<ul>"); list = true; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (list) { out.push("</ul>"); list = false; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : "");
  }
  if (list) out.push("</ul>");
  return out.join("");
}

/** The map updated most recently (to reopen the panel on it after a reload). */
export function latestMap(list) {
  return [...(list ?? [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.id ?? null;
}

/** Escapes text for insertion into HTML. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
