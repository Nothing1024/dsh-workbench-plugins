// Reused from grokbot-plugin/lib/grokbot/auth.js (dsh-plugin-grokbot 0.1.0, MIT).
// Adapted for DSH Workbench Suite; see THIRD_PARTY_NOTICES.md.
/**
 * Cookie acquisition for grok.com.
 *
 * Grok Bot relay WebSocket authenticates with the browser session cookie
 * (sso / sso-rw), so a headless client needs a cookie header. Sources, in order:
 *
 * 1. an explicit cookie string (plugin config or GROK_COOKIE / GROK_SSO),
 * 2. a cookie file the user maintains (default ~/.dsh/grokbot/cookie.txt),
 * 3. the in-memory copy from an earlier read in this process,
 * 4. the DevTools endpoint of an already-running Chromium-family browser:
 *    Storage.getCookies over CDP returns the decrypted cookies. This reads from
 *    the browser that is already open, so it needs no Keychain prompt and never
 *    focuses or switches a tab. Chrome serves one DevTools client at a time and
 *    can take seconds to admit a new one, so this is slow and not always
 *    available; that is why the result is also written to the disk cache.
 * 5. the disk cache the plugin wrote itself (~/.dsh/grokbot/cookie.cache.json,
 *    mode 0600, 12h TTL). Only a fallback for when the browser will not talk.
 *
 * @module dsh-plugin-grokbot/auth
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** How long a successful cookie read is reused before hitting the browser again. */
const COOKIE_TTL_MS = 5 * 60 * 1000;
/** How long the on-disk fallback copy stays usable after the browser last answered. */
const DISK_TTL_MS = 12 * 60 * 60 * 1000;

let cache = { at: 0, header: "", source: "" };
let cacheKey = "";

/** The plugin's own cookie cache file (fallback only; the browser stays authoritative). */
function diskCachePath() {
  return path.join(os.homedir(), ".dsh", "grokbot", "cookie.cache.json");
}

/** Persist a freshly read header so a slow or busy browser cannot block the next start. */
function writeDiskCache(header, source) {
  try {
    const file = diskCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ header, source, at: Date.now() }), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } catch {
    // a cache we cannot write is not an error
  }
}

/** Read the on-disk fallback copy, honouring its TTL. */
function readDiskCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(diskCachePath(), "utf8"));
    if (!raw?.header || typeof raw.header !== "string") return null;
    if (Date.now() - Number(raw.at ?? 0) > DISK_TTL_MS) return null;
    return { at: Number(raw.at ?? 0), header: raw.header, source: "cache:" + String(raw.source ?? "browser") };
  } catch {
    return null;
  }
}

/** Candidate browser user-data directories, most likely first. */
export function defaultProfileDirs() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      path.join(base, "Google", "Chrome"),
      path.join(base, "Google", "Chrome Beta"),
      path.join(base, "Google", "Chrome Canary"),
      path.join(base, "Chromium"),
      path.join(base, "BraveSoftware", "Brave-Browser"),
      path.join(base, "Microsoft Edge"),
      path.join(base, "Vivaldi"),
    ];
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(base, "Google", "Chrome", "User Data"),
      path.join(base, "Chromium", "User Data"),
      path.join(base, "BraveSoftware", "Brave-Browser", "User Data"),
      path.join(base, "Microsoft", "Edge", "User Data"),
    ];
  }
  const base = path.join(home, ".config");
  return [
    path.join(base, "google-chrome"),
    path.join(base, "chromium"),
    path.join(base, "BraveSoftware", "Brave-Browser"),
    path.join(base, "microsoft-edge"),
  ];
}

/**
 * Read the DevToolsActivePort file a Chromium browser writes when it is
 * listening for a debugger. Returns null when the browser is not debuggable.
 */
function readDevToolsPort(profileDir) {
  const file = path.join(profileDir, "DevToolsActivePort");
  try {
    const [portLine, wsPath] = fs.readFileSync(file, "utf8").trim().split("\n");
    const port = Number(portLine);
    if (!Number.isInteger(port) || port <= 0 || !wsPath) return null;
    return { port, wsPath: wsPath.trim() };
  } catch {
    return null;
  }
}

/** One JSON-RPC call over a fresh CDP browser socket. */
function cdpCall(ws, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error(method + " timed out")), timeoutMs);
    const onMessage = (event) => {
      let frame;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (frame.error) reject(new Error(method + " failed: " + JSON.stringify(frame.error)));
      else resolve(frame.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Pull grok.com cookies out of a running browser through its DevTools endpoint.
 * @returns a cookie header string, or null when no browser answered.
 */
async function cookiesFromBrowser(profileDirs, timeoutMs) {
  const failures = [];
  for (const dir of profileDirs) {
    const endpoint = readDevToolsPort(dir);
    if (!endpoint) continue;
    // Chrome accepts a new DevTools client slowly when it is busy (seconds, not
    // milliseconds) and occasionally drops the first upgrade, so retry before giving up.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const ws = new WebSocket("ws://127.0.0.1:" + endpoint.port + endpoint.wsPath);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
          ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
          ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("connect failed")); }, { once: true });
        });
        const result = await cdpCall(ws, "Storage.getCookies", {}, timeoutMs);
        // A lookalike domain such as notgrok.com is not part of grok.com.
        const cookies = (result.cookies || []).filter((c) => {
          const domain = String(c.domain || "").replace(/^\./, "").toLowerCase();
          return domain === "grok.com" || domain.endsWith(".grok.com");
        });
        if (cookies.length > 0) {
          return { header: cookies.map((c) => c.name + "=" + c.value).join("; "), source: "browser:" + path.basename(dir) };
        }
        failures.push(path.basename(dir) + ": no grok.com cookie (not signed in?)");
        break;
      } catch (error) {
        if (attempt === 3) failures.push(path.basename(dir) + ": " + error.message);
        else await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      } finally {
        try { ws.close(); } catch { /* already closed */ }
      }
    }
  }
  return { header: "", failures };
}

/** Read a cookie file; accepts a raw header line or a "Cookie: ..." line. */
function cookiesFromFile(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return null;
    const header = text.replace(/^cookie:\s*/i, "").replace(/\s+/g, " ").trim();
    return header.includes("=") ? header : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the cookie header for grok.com.
 * @param options.cookie explicit cookie string
 * @param options.cookieFile cookie file path
 * @param options.profileDirs browser user-data dirs to probe
 * @param options.force skip the in-memory cache
 */
export async function resolveCookie(options = {}) {
  const explicit = options.cookie || process.env.GROK_COOKIE || process.env.GROK_SSO;
  if (explicit) return { header: explicit.trim().replace(/^cookie:\s*/i, ""), source: "config" };

  const file = path.resolve(options.cookieFile || path.join(os.homedir(), ".dsh", "grokbot", "cookie.txt"));
  const profileDirs = options.profileDirs || defaultProfileDirs();
  const key = JSON.stringify([file, profileDirs, options.cacheCookie !== false]);
  const fromFile = cookiesFromFile(file);
  if (fromFile) {
    cacheKey = key;
    cache = { at: Date.now(), header: fromFile, source: "file:" + file };
    return cache;
  }

  if (!options.force && cacheKey === key && cache.header && Date.now() - cache.at < COOKIE_TTL_MS) return cache;

  const fromBrowser = await cookiesFromBrowser(profileDirs, options.timeoutMs || 20000);
  if (fromBrowser.header) {
    cacheKey = key;
    cache = { at: Date.now(), header: fromBrowser.header, source: fromBrowser.source };
    if (options.cacheCookie !== false) writeDiskCache(cache.header, cache.source);
    return cache;
  }

  const fromDisk = options.cacheCookie === false ? null : readDiskCache();
  if (fromDisk) {
    cacheKey = key;
    cache = fromDisk;
    return cache;
  }

  const detail = fromBrowser.failures.length ? " [" + fromBrowser.failures.join("; ") + "]" : " [no debuggable browser found]";
  throw new Error(
    "grokbot: no grok.com session cookie found" + detail + ". Sign in to grok.com in Chrome, or set the plugin cookie " +
    "config (or GROK_COOKIE), or write the header to ~/.dsh/grokbot/cookie.txt.",
  );
}

/** Drop the in-memory and on-disk copies so the next call re-reads the browser. */
export function invalidateCookieCache({ cacheCookie = true } = {}) {
  cache = { at: 0, header: "", source: "" };
  cacheKey = "";
  if (cacheCookie) {
    try { fs.rmSync(diskCachePath(), { force: true }); } catch { /* nothing to remove */ }
  }
}

/** The signed-in user id, from the x-userid cookie when present. */
export function userIdFromCookie(header) {
  const match = header.match(/(?:^|;\s*)x-userid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}
