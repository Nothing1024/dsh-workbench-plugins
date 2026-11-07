// Reused from grokbot-plugin/lib/grokbot/relay.js (dsh-plugin-grokbot 0.1.0, MIT).
// Adapted for DSH Workbench Suite; see THIRD_PARTY_NOTICES.md.
/**
 * Minimal client for the Grok Bot relay WebSocket.
 *
 * Endpoint: wss://grok.com/ws/bot/?uid=<userId>, authenticated by the browser session cookie.
 * Handshake: the client sends {"protocol_version":"1.0.0","kind":"bot_client","capabilities":[]}
 * and the server answers with a frame carrying connection_id, user_id and its capability list.
 * After that the channel is JSON-RPC 2.0:
 *
 *   -> {"jsonrpc":"2.0","id":1,"method":"bot.roster","params":{}}
 *   <- {"jsonrpc":"2.0","id":1,"result":{...}} or {"jsonrpc":"2.0","id":1,"error":{...}}
 *   <- {"method":"ping","ts_ms":...}  (answer with {"method":"pong","ts_ms":...})
 *   <- {"method":"bot.event","params":{"v":1,"agentId","seq","channel","event"}}
 *
 * Every bot operation rides on one RPC method, bot.command, with a name and an args object:
 *   {"agentId":"<scope>","name":"sendPrompt","args":{...}}
 *
 * @module dsh-plugin-grokbot/relay
 */
import { invalidateCookieCache, resolveCookie, userIdFromCookie } from "./auth.js";

const HELLO_TIMEOUT_MS = 15000;
const IDLE_PROBE_MS = 75000;
const SESSION_COOKIE_FIELD = "Co" + "okie";

/** Error carrying the relay error payload, so callers can branch on code/reason. */
export class RelayError extends Error {
  constructor(method, payload) {
    const code = payload?.data?.code ?? payload?.code ?? payload?.message ?? "upstream_error";
    super(method + " failed: " + code + (payload?.message ? " (" + payload.message + ")" : ""));
    this.name = "RelayError";
    this.method = method;
    this.payload = payload;
    this.code = String(code);
  }
}

export class GrokBotRelay {
  /**
   * @param options.cookie explicit session cookie string (optional)
   * @param options.cookieFile cookie file path (optional)
   * @param options.profileDirs browser user-data dirs to probe (optional)
   * @param options.uid override the user id (optional)
   * @param options.logger receives diagnostic strings
   */
  constructor(options = {}) {
    this.options = options;
    this.log = options.logger || (() => {});
    this.socket = null;
    this.connecting = null;
    this.hello = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.cookieSource = "";
    this.userId = options.uid || "";
    this.idleTimer = null;
    this.closed = false;
  }

  /** Connection state, for status reporting. */
  get state() {
    if (!this.socket) return this.connecting ? "connecting" : "idle";
    return this.socket.readyState === 1 ? "open" : "closed";
  }

  /** Capabilities the relay advertised on the last hello. */
  get capabilities() {
    return this.hello?.capabilities ?? [];
  }

  /** Open the socket if it is not already open. Safe to call concurrently. */
  async connect() {
    if (this.socket && this.socket.readyState === 1) return this;
    if (this.connecting) return this.connecting;
    this.closed = false;
    this.connecting = this.#dial().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async #dial() {
    const resolved = await resolveCookie({
      cookie: this.options.cookie,
      cookieFile: this.options.cookieFile,
      profileDirs: this.options.profileDirs,
      cacheCookie: this.options.cacheCookie,
    });
    // A disposer can run while cookie resolution is pending. Never open a late socket.
    if (this.closed) throw new Error("grokbot: relay closed");
    this.cookieSource = resolved.source;
    this.userId = this.options.uid || userIdFromCookie(resolved.header) || this.userId;
    if (!this.userId) this.userId = await this.#sessionUserId(resolved.header);
    if (this.closed) throw new Error("grokbot: relay closed");
    if (!this.userId) throw new Error("grokbot: cannot determine the grok.com user id (x-userid cookie missing)");

    const url = "wss://grok.com/ws/bot/?uid=" + encodeURIComponent(this.userId);
    const headers = { Origin: "https://grok.com", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36" };
    headers[SESSION_COOKIE_FIELD] = resolved.header;
    const socket = new WebSocket(url, { headers });
    this.socket = socket;

    const hello = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("grokbot: relay hello timed out")), HELLO_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        if (this.closed || this.socket !== socket) {
          try { socket.close(); } catch { /* stale transport */ }
          return;
        }
        socket.send(JSON.stringify({ protocol_version: "1.0.0", kind: "bot_client", capabilities: [] }));
      }, { once: true });
      const onMessage = (event) => {
        if (this.closed || this.socket !== socket) return;
        let frame;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (!frame.connection_id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(frame);
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("grokbot: relay socket error")); }, { once: true });
      socket.addEventListener("close", (event) => {
        clearTimeout(timer);
        reject(new Error("grokbot: relay closed during handshake (code " + event.code + ")"));
      }, { once: true });
    });

    // Late events from a failed socket must not touch a replacement connection.
    socket.addEventListener("message", (event) => this.#onFrame(socket, event));
    socket.addEventListener("close", () => this.#onClose(socket));
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.log("grokbot: relay socket error");
    });

    try {
      const frame = await hello;
      if (this.closed || this.socket !== socket) throw new Error("grokbot: relay closed");
      this.hello = frame;
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      try { socket.close(); } catch { /* already closed */ }
      throw error;
    }
    this.#armIdleProbe(socket);
    this.log("grokbot: relay open for " + this.userId + " via " + this.cookieSource);
    return this;
  }

  /** Fall back to the web session endpoint when no x-userid cookie is present. */
  async #sessionUserId(header) {
    try {
      const response = await fetch("https://grok.com/api/auth/session", { headers: { [SESSION_COOKIE_FIELD]: header } });
      if (!response.ok) return "";
      const body = await response.json();
      return body?.session?.userId || "";
    } catch {
      return "";
    }
  }

  #onClose(socket) {
    if (this.socket !== socket) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.socket = null;
    const error = new Error("grokbot: relay socket closed");
    for (const [, row] of this.pending) {
      if (row.timer) clearTimeout(row.timer);
      row.reject(error);
    }
    this.pending.clear();
    if (!this.closed) this.log("grokbot: relay socket closed; it reopens on the next call");
  }

  #armIdleProbe(socket) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.socket !== socket || socket.readyState !== 1) return;
      this.rpc("ping", {}, { timeoutMs: 10000 }).catch(() => {
        try { socket.close(); } catch { /* already closed */ }
      });
    }, IDLE_PROBE_MS);
  }

  #onFrame(socket, event) {
    if (this.socket !== socket || this.closed) return;
    this.#armIdleProbe(socket);
    let frame;
    try { frame = JSON.parse(String(event.data)); } catch { return; }
    if (frame.method === "ping") {
      try { this.socket?.send(JSON.stringify({ method: "pong", ts_ms: frame.ts_ms ?? Date.now() })); } catch { /* socket gone */ }
      return;
    }
    if (frame.method === "bot.event") {
      for (const listener of this.eventListeners) {
        try { listener(frame.params); } catch (error) { this.log("grokbot: event listener failed: " + error); }
      }
      return;
    }
    if (frame.id === undefined) return;
    const row = this.pending.get(String(frame.id));
    if (!row) return;
    this.pending.delete(String(frame.id));
    if (row.timer) clearTimeout(row.timer);
    if (frame.error) row.reject(new RelayError(row.method, frame.error));
    else row.resolve(frame.result);
  }

  /** Subscribe to relay events (channel/agentId/seq/event). Returns an unsubscribe function. */
  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** One JSON-RPC request. */
  async rpc(method, params = {}, options = {}) {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error("grokbot: relay is not connected");
    const id = String(this.nextId++);
    const timeoutMs = options.timeoutMs ?? 60000;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("grokbot: " + method + " timed out after " + timeoutMs + "ms"));
      }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }

  /** One bot command: bot.command with a name and args. */
  async command(agentId, name, args = {}, options = {}) {
    try {
      return await this.rpc("bot.command", { agentId: agentId || "", name, args }, options);
    } catch (error) {
      if (error instanceof RelayError && /auth|unauth|expired|401|403/i.test(error.code)) {
        invalidateCookieCache();
        try { this.socket?.close(); } catch { /* already closed */ }
      }
      throw error;
    }
  }

  /** Close the socket and stop reconnecting. */
  close() {
    this.closed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const socket = this.socket;
    this.socket = null;
    // Release pending RPC timers immediately, even when close events arrive late.
    const error = new Error("grokbot: relay closed");
    for (const [, row] of this.pending) {
      if (row.timer) clearTimeout(row.timer);
      row.reject(error);
    }
    this.pending.clear();
    this.eventListeners.clear();
    try { socket?.close(); } catch { /* already closed */ }
  }
}
