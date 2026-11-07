// Reused from grokbot-plugin/lib/grokbot/web.js (dsh-plugin-grokbot 0.1.0, MIT).
// The workspace source remains read-only; local safety adaptations are noted below.
/**
 * The Grok Bots console as a DSH web surface.
 *
 * The standalone viewer (viewer/server.mjs) and the DSH web profile serve the exact same
 * handlers and the exact same page; only the mount point differs. Everything here talks to
 * the plugin's relay, so the tools and the page share one connection and one cookie.
 *
 * @module dsh-plugin-grokbot/web
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every bot record from listAgents, normalised for the page. */
export async function listBots(relay) {
  const agents = await relay.command("", "listAgents", {});
  return agents
    .map((agent) => ({
      id: agent.id,
      name: agent.name || "(unnamed)",
      description: agent.description || "",
      state: agent.isRunning ? "running" : agent.awaitingUserResponse ? "waiting" : agent.hasUnread ? "unread" : "idle",
      isRunning: Boolean(agent.isRunning),
      hasUnread: Boolean(agent.hasUnread),
      awaitingUserResponse: Boolean(agent.awaitingUserResponse),
      hidden: Boolean(agent.isHiddenFromSidebar),
      createdAt: agent.createdAt ?? null,
      updatedAt: agent.updatedAt ?? null,
      isGroup: Boolean(agent.isGroup),
      memberIds: agent.memberIds ?? [],
      lastMessagePreview: agent.lastMessagePreview || "",
    }))
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

/**
 * The sidebar layout: pinnedAgentIds + sidebarSections live in host settings, so the page
 * renders exactly the same groups grok.com shows. Members are resolved to bot records and
 * carry their live state; ids that no longer exist are reported as missing.
 */
export async function layout(relay) {
  const [settings, bots] = await Promise.all([relay.command("", "getHostSettings", {}), listBots(relay)]);
  const byId = new Map(bots.map((b) => [b.id, b]));
  const pinned = settings?.pinnedAgentIds ?? [];
  const sections = (settings?.sidebarSections ?? []).map((section) => {
    const members = (section.agentIds ?? []).map((id) => byId.get(id)).filter(Boolean);
    return {
      id: section.id,
      name: section.name,
      collapsed: Boolean(section.isCollapsed),
      agentIds: section.agentIds ?? [],
      missing: (section.agentIds ?? []).length - members.length,
      bots: members,
    };
  });
  const grouped = new Set(sections.flatMap((s) => s.agentIds));
  return {
    pinned,
    pinnedBots: pinned.map((id) => byId.get(id)).filter(Boolean),
    sections,
    ungrouped: bots.filter((b) => !grouped.has(b.id)),
    bots,
  };
}

/** Decode one page of the offbox transcript (base64 JSON bodies). */
export function decodeOffbox(rows) {
  const out = [];
  for (const row of rows ?? []) {
    try {
      const entry = JSON.parse(Buffer.from(String(row.body ?? ""), "base64").toString("utf8"));
      if (entry && typeof entry === "object") out.push(entry);
    } catch { /* skip a malformed body */ }
  }
  return out.sort((a, b) => Number(a.entryVersion ?? 0) - Number(b.entryVersion ?? 0));
}

/** Newest page of a transcript, or an older page when a cursor is given. */
async function transcript(relay, agentId, limit, cursor) {
  if (cursor) {
    const page = await relay.rpc("bot.transcript.offbox", { agentId, cursor });
    // Offbox cursors advance by whole pages; truncating drops entries permanently.
    // limit applies only to the initial getAgentTranscriptTail request below.
    return { entries: decodeOffbox(page.entries), cursor: page.nextCursor ? String(page.nextCursor) : "" };
  }
  const page = await relay.command(agentId, "getAgentTranscriptTail", { id: agentId, limit });
  return { entries: page.entries ?? [], cursor: page.nextBeforeSeq == null ? "" : String(page.nextBeforeSeq) };
}

function slimValue(value, depth = 0) {
  if (value == null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => slimValue(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(data|bytes|contentBase64|thumbnailData|buffer|contentBytes)$/i.test(key) && typeof item === "string" && item.length > 240) {
      out[key] = "[omitted]";
    } else {
      out[key] = slimValue(item, depth + 1);
    }
  }
  return out;
}

/** Flatten one relay entry into what the page renders. Rich types keep a structured payload. */
function shape(entry) {
  const kind = entry.kind ?? "entry";
  let role = "system";
  let text = "";
  let payload = null;
  if (kind === "message") {
    role = entry.role === "user" ? "user" : "bot";
    text = String(entry.content ?? "");
  } else if (kind === "send-message") {
    role = "bot";
    const message = entry.message && typeof entry.message === "object" ? entry.message : {};
    if (message.type === "text") {
      text = String(message.content ?? "");
    } else {
      payload = slimValue(message);
      text = "[" + String(message.type ?? "?") + "] " + JSON.stringify(payload ?? {});
    }
  } else if (kind === "notice") {
    role = "notice";
    text = String(entry.text ?? "");
  } else {
    payload = slimValue(entry);
    text = "[" + kind + "] " + JSON.stringify(entry).slice(0, 600);
  }
  const shaped = { kind, role, text, at: entry.timestampMs ?? null, version: entry.entryVersion ?? null };
  if (payload) shaped.payload = payload;
  return shaped;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error("bad json"), { status: 400 })); } });
    req.on("error", reject);
  });
}

function sendJson(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Build the API handler. The same function answers the standalone viewer and the DSH route.
 * @param getRelay returns the shared relay client
 */
export function createApi(getRelay) {
  return async function api(req, res, url) {
    const relay = getRelay();
    const p = url.pathname;

    if (p === "/api/bots") return sendJson(res, 200, { bots: await listBots(relay) });
    if (p === "/api/layout") return sendJson(res, 200, await layout(relay));

    if (p === "/api/status") {
      try { await relay.connect(); } catch { /* reported below as a disconnected relay */ }
      const out = { connection: relay.state, userId: relay.userId, cookie: relay.cookieSource };
      try { out.runState = (await relay.rpc("bot.status", {}))?.runState ?? null; } catch (e) { out.runState = "unavailable: " + e.message; }
      try {
        const u = await relay.rpc("bot.usage", {});
        out.usage = { plan: u?.planLabel ?? null, percent: u?.usagePercent ?? null, resetsAt: u?.nextResetAtMs ?? null, available: u?.hasAvailableUsage ?? null };
      } catch { out.usage = null; }
      const bots = await listBots(relay);
      out.counts = {
        total: bots.length,
        running: bots.filter((b) => b.isRunning).length,
        unread: bots.filter((b) => b.hasUnread).length,
        waiting: bots.filter((b) => b.awaitingUserResponse).length,
      };
      return sendJson(res, 200, out);
    }

    if (p === "/api/transcript") {
      const id = url.searchParams.get("id") || "";
      if (!id) return sendJson(res, 400, { error: "id is required" });
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 60, 1), 200);
      const page = await transcript(relay, id, limit, url.searchParams.get("cursor") || "");
      return sendJson(res, 200, { entries: page.entries.map(shape), cursor: page.cursor });
    }

    if (p === "/api/send" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      const prompt = String(body.prompt || "").trim();
      if (!id || !prompt) return sendJson(res, 400, { error: "id and prompt are required" });
      // The host adapter validates and deduplicates the stable nonce supplied by its client.
      await relay.command(id, "sendPrompt", { agentId: id, prompt, clientNonce: body.clientNonce });
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/interrupt" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "id is required" });
      const result = await relay.command(id, "interruptAgentRun", { id });
      return sendJson(res, 200, { hadActiveRun: Boolean(result?.hadActiveRun) });
    }

    if (p === "/api/delete" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "id is required" });
      if (body.force !== true) {
        const agent = (await listBots(relay)).find((b) => b.id === id);
        if (agent?.isRunning) return sendJson(res, 409, { error: "bot is running; pass force to delete anyway" });
      }
      await relay.command(id, "deleteAgents", { ids: [id] });
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/group" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!name) return sendJson(res, 400, { error: "name is required" });
      const settings = await relay.command("", "getHostSettings", {});
      const sections = settings?.sidebarSections ?? [];
      const existing = sections.find((s) => String(s.name).toLowerCase() === name.toLowerCase());
      const wanted = new Set(ids);
      // Retain unknown/collapse fields and stale ids when editing one section.
      const next = sections.map((s) => ({ ...s, agentIds: (s.agentIds ?? []).filter((id) => !wanted.has(id)) }));
      const index = next.findIndex((s) => s.id === existing?.id);
      if (index === -1) next.unshift({ id: "section-" + crypto.randomUUID(), name, agentIds: ids, isCollapsed: false });
      else next[index].agentIds = [...new Set([...next[index].agentIds, ...ids])];
      await relay.command("", "setHostSettings", { sidebarSections: next });
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/group-rename" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      const name = String(body.name || "").trim();
      if (!id || !name) return sendJson(res, 400, { error: "id and name are required" });
      const settings = await relay.command("", "getHostSettings", {});
      const next = (settings?.sidebarSections ?? []).map((s) => s.id === id ? { ...s, name } : { ...s });
      await relay.command("", "setHostSettings", { sidebarSections: next });
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/group-delete" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "id is required" });
      const settings = await relay.command("", "getHostSettings", {});
      const next = (settings?.sidebarSections ?? []).filter((s) => s.id !== id);
      await relay.command("", "setHostSettings", { sidebarSections: next });
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/pin" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "id is required" });
      const settings = await relay.command("", "getHostSettings", {});
      const current = settings?.pinnedAgentIds ?? [];
      const next = body.pinned === false ? current.filter((x) => x !== id) : [...new Set([...current, id])];
      await relay.command("", "setHostSettings", { pinnedAgentIds: next });
      return sendJson(res, 200, { pinned: next });
    }

    return sendJson(res, 404, { error: "not found" });
  };
}

/** Read the single-page UI from disk (shared with the standalone viewer). */
export function readPageHtml(apiBase) {
  const html = fs.readFileSync(path.join(HERE, "..", "..", "viewer", "index.html"), "utf8");
  const tag = '<script>window.__GROKBOT_API_BASE__ = ' + JSON.stringify(apiBase) + ';</script>';
  return html.replace("</head>", tag + "</head>");
}
