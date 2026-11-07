import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GrokBotRelay } from './relay.js';
import { createApi, listBots } from './web.js';
import { invalidateCookieCache, resolveCookie, userIdFromCookie } from './auth.js';

const PREFIX = '/__dsh_grok/api';
const MAX_URL_BYTES = 8192;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PROMPT_BYTES = 100000;
const BODY_TIMEOUT_MS = 15000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;
const MAX_ATTACHMENTS = 10;
const UPLOAD_TIMEOUT_MS = 90000;
const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico', 'tif', 'tiff',
  'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'rtf', 'log',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt',
  'sh', 'bash', 'zsh', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'zip', 'tar', 'gz', 'tgz', 'mp3', 'wav', 'm4a', 'ogg', 'mp4', 'webm', 'mov',
]);
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/heic', 'image/heif',
  'image/tiff', 'image/x-icon', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'application/xml', 'text/xml', 'text/html', 'application/rtf', 'text/rtf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation', 'application/zip', 'application/x-tar', 'application/gzip',
  'application/x-gzip', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/ogg', 'video/mp4', 'video/webm',
  'video/quicktime', 'application/octet-stream',
]);
const METHODS = new Map([
  ...['bots', 'layout', 'status', 'transcript', 'auth'].map(path => [path, 'GET']),
  ...['send', 'interrupt', 'rename', 'delete', 'group', 'group-rename', 'group-delete', 'pin', 'upload', 'auth-refresh', 'auth-clear'].map(path => [path, 'POST']),
]);

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, body, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...headers,
  });
  res.end(JSON.stringify(body));
}

function header(req, name) {
  let count = 0;
  for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2) {
    if (String(req.rawHeaders[i]).toLowerCase() === name) count++;
  }
  const value = req.headers?.[name];
  if (count > 1 || (value !== undefined && typeof value !== 'string')) {
    throw new RequestError(400, 'Invalid request headers');
  }
  return value;
}

function checkOrigin(req, server) {
  // getOrigin is the bound listener's authority. Never trust Host/X-Forwarded-* as its source.
  let expected;
  try { expected = server.getOrigin(); } catch { throw new RequestError(503, 'Grok service unavailable'); }
  let url;
  try { url = new URL(expected); } catch { throw new RequestError(503, 'Grok service unavailable'); }
  if (!['http:', 'https:'].includes(url.protocol) || !/^https?:\/\/[^/?#]+$/.test(expected) || url.username || url.password) {
    throw new RequestError(503, 'Grok service unavailable');
  }
  // URL serialization removes default :80/:443; browser Origin uses the same serialization.
  expected = url.origin;
  const host = header(req, 'host');
  let hostOrigin;
  try {
    if (!host || /[\s/\\?#@]/.test(host)) throw new Error('Invalid authority');
    hostOrigin = new URL(url.protocol + '//' + host).origin;
  } catch { throw new RequestError(403, 'Same origin required'); }
  if (hostOrigin !== expected) throw new RequestError(403, 'Same origin required');
  const origin = header(req, 'origin');
  if ((req.method === 'POST' || origin !== undefined) && origin !== expected) {
    throw new RequestError(403, 'Same origin required');
  }
  const site = header(req, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new RequestError(403, 'Same origin required');
  }
  return expected;
}

function validateQuery(url, route) {
  const allowed = route === 'transcript' ? new Set(['id', 'limit', 'cursor']) : new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new RequestError(400, 'Invalid query');
    }
  }
  if (route !== 'transcript') return;
  id(url.searchParams.get('id'));
  const limit = url.searchParams.get('limit');
  if (limit !== null && (!/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 200)) {
    throw new RequestError(400, 'Invalid transcript limit');
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (Buffer.byteLength(cursor) > 4096 || /[\x00-\x20\x7f]/.test(cursor))) {
    throw new RequestError(400, 'Invalid transcript cursor');
  }
}

function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) {
    throw new RequestError(400, 'Invalid id');
  }
  return value;
}

function name(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 256 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RequestError(400, 'Invalid name');
  }
  return value.trim();
}

function extensionOf(filename) {
  const base = String(filename || '').split('/').pop() || '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

function sanitizeFilename(value) {
  if (typeof value !== 'string') throw new RequestError(400, 'Invalid filename');
  let filename = value.replace(/\\/g, '/').split('/').pop().trim();
  filename = filename.replace(/[\x00-\x1f\x7f]/g, '');
  if (!filename || filename === '.' || filename === '..') throw new RequestError(400, 'Invalid filename');
  if (Buffer.byteLength(filename) > 255) throw new RequestError(400, 'Invalid filename');
  const ext = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new RequestError(415, 'Unsupported file type');
  return filename;
}

function assertMimeAllowed(mime, filename) {
  const type = String(mime || '').trim().toLowerCase();
  if (!type || type === 'application/octet-stream') return;
  if (!ALLOWED_MIME.has(type)) throw new RequestError(415, 'Unsupported file type');
  if (type.startsWith('image/') && !['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico', 'tif', 'tiff'].includes(extensionOf(filename))) {
    throw new RequestError(415, 'Unsupported file type');
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) {
    throw new RequestError(400, 'Invalid file data');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new RequestError(400, 'Invalid file data');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length) throw new RequestError(400, 'Empty file');
  return bytes;
}

function validateUploadBytes(filename, mime, bytes) {
  const name = sanitizeFilename(filename);
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new RequestError(400, 'Empty file');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new RequestError(413, 'File too large');
  assertMimeAllowed(mime, name);
  return { filename: name, bytes };
}

function attachmentPath(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 2048 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RequestError(400, 'Invalid attachment path');
  }
  return value.trim();
}

function attachmentName(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 255 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RequestError(400, 'Invalid attachment name');
  }
  return value.trim();
}

function attachmentList(value, map, label) {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new RequestError(400, label);
  return value.map(map);
}

function sendFingerprint(body) {
  return createHash('sha256')
    .update(body.prompt)
    .update('\0')
    .update(JSON.stringify(body.attachmentPaths ?? []))
    .update('\0')
    .update(JSON.stringify(body.attachmentNames ?? []))
    .digest('hex');
}

function validateBody(route, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'JSON object required');
  const fields = {
    send: ['id', 'prompt', 'clientNonce', 'attachmentPaths', 'attachmentNames'], interrupt: ['id'], rename: ['id', 'name'], delete: ['id', 'force'],
    group: ['name', 'ids'], 'group-rename': ['id', 'name'], 'group-delete': ['id'], pin: ['id', 'pinned'],
  }[route];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new RequestError(400, 'Invalid request fields');
  const out = {};
  if (route !== 'group') out.id = id(body.id);
  if (route === 'rename' || route === 'group' || route === 'group-rename') out.name = name(body.name);
  if (route === 'send') {
    if (typeof body.prompt !== 'string' || Buffer.byteLength(body.prompt) > MAX_PROMPT_BYTES) {
      throw new RequestError(400, 'Invalid prompt');
    }
    out.prompt = body.prompt.trim();
    if (typeof body.clientNonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientNonce)) {
      throw new RequestError(400, 'Invalid client nonce');
    }
    out.clientNonce = body.clientNonce.toLowerCase();
    if (Object.hasOwn(body, 'attachmentPaths')) {
      out.attachmentPaths = attachmentList(body.attachmentPaths, attachmentPath, 'Invalid attachment paths');
    }
    if (Object.hasOwn(body, 'attachmentNames')) {
      if (!out.attachmentPaths) throw new RequestError(400, 'Invalid request fields');
      out.attachmentNames = attachmentList(body.attachmentNames, attachmentName, 'Invalid attachment names');
      if (out.attachmentNames.length !== out.attachmentPaths.length) throw new RequestError(400, 'Invalid attachment names');
    }
    if (!out.prompt && !out.attachmentPaths?.length) throw new RequestError(400, 'Invalid prompt');
  }
  if (route === 'group') {
    if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.length > 500)) {
      throw new RequestError(400, 'Invalid group members');
    }
    out.ids = [...new Set((body.ids ?? []).map(value => id(value)))];
  }
  for (const key of ['force', 'pinned']) {
    if (!fields.includes(key) || !Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== 'boolean') throw new RequestError(400, 'Invalid request fields');
    out[key] = body[key];
  }
  return out;
}

function readJson(req) {
  const type = header(req, 'content-type');
  if (!type || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type.trim())) {
    throw new RequestError(415, 'application/json required');
  }
  const encoding = header(req, 'content-encoding');
  if (encoding !== undefined && encoding !== 'identity') throw new RequestError(415, 'Unsupported content encoding');
  const length = header(req, 'content-length');
  if (length !== undefined && !/^[0-9]+$/.test(length)) throw new RequestError(400, 'Invalid content length');
  if (length !== undefined && Number(length) > MAX_BODY_BYTES) throw new RequestError(413, 'Request body too large');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);
    };
    const fail = error => {
      cleanup();
      req.once('error', () => {});
      req.resume();
      reject(error instanceof RequestError ? error : new RequestError(400, 'Invalid request body'));
    };
    const aborted = () => fail(new RequestError(400, 'Request body interrupted'));
    const data = chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) { fail(new RequestError(413, 'Request body too large')); return; }
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      cleanup();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch { reject(new RequestError(400, 'Invalid JSON')); }
    };
    const timer = setTimeout(() => fail(new RequestError(408, 'Request body timed out')), BODY_TIMEOUT_MS);
    timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
}

function readRaw(req, maxBytes, timeoutMs) {
  const encoding = header(req, 'content-encoding');
  if (encoding !== undefined && encoding !== 'identity') throw new RequestError(415, 'Unsupported content encoding');
  const length = header(req, 'content-length');
  if (length !== undefined && !/^[0-9]+$/.test(length)) throw new RequestError(400, 'Invalid content length');
  if (length !== undefined && Number(length) > maxBytes) throw new RequestError(413, 'Request body too large');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);
    };
    const fail = error => {
      cleanup();
      req.once('error', () => {});
      req.resume();
      reject(error instanceof RequestError ? error : new RequestError(400, 'Invalid request body'));
    };
    const aborted = () => fail(new RequestError(400, 'Request body interrupted'));
    const data = chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) { fail(new RequestError(413, 'Request body too large')); return; }
      chunks.push(Buffer.from(chunk));
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => fail(new RequestError(408, 'Request body timed out')), timeoutMs);
    timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
}

function dispositionValue(headerText, key) {
  const escaped = new RegExp(key + '\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"', 'i').exec(headerText);
  if (escaped) return escaped[1].replace(/\\(.)/g, '$1');
  const plain = new RegExp(key + '\\s*=\\s*([^;]+)', 'i').exec(headerText);
  return plain ? plain[1].trim() : '';
}

function parseMultipart(buffer, type) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]{1,200})"|([^;\s]{1,200}))/i.exec(String(type || ''));
  if (!match) throw new RequestError(400, 'Invalid multipart boundary');
  const boundary = match[1] || match[2];
  if (!boundary || /[\r\n]/.test(boundary)) throw new RequestError(400, 'Invalid multipart boundary');
  const first = Buffer.from('--' + boundary);
  let offset = buffer.indexOf(first);
  if (offset < 0) throw new RequestError(400, 'Invalid multipart body');
  offset += first.length;
  const collected = {};
  let file;
  let parts = 0;
  while (offset <= buffer.length) {
    if (buffer[offset] === 0x2d && buffer[offset + 1] === 0x2d) break;
    if (buffer[offset] !== 0x0d || buffer[offset + 1] !== 0x0a) throw new RequestError(400, 'Invalid multipart body');
    offset += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), offset);
    if (headerEnd < 0) throw new RequestError(400, 'Invalid multipart body');
    const headers = buffer.subarray(offset, headerEnd).toString('latin1');
    offset = headerEnd + 4;
    const next = buffer.indexOf(Buffer.from('\r\n--' + boundary), offset);
    if (next < 0) throw new RequestError(400, 'Invalid multipart body');
    const body = buffer.subarray(offset, next);
    offset = next + 2 + first.length;
    if (++parts > 8) throw new RequestError(400, 'Invalid request fields');
    const disposition = headers.split('\r\n').find(line => /^content-disposition:/i.test(line)) || '';
    const name = dispositionValue(disposition, 'name');
    const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i.exec(disposition);
    let filename = '';
    if (star) {
      try { filename = decodeURIComponent(star[1].trim().replace(/^"(.*)"$/, '$1')); } catch { filename = ''; }
    }
    if (!filename) filename = dispositionValue(disposition, 'filename');
    const contentType = (headers.split('\r\n').find(line => /^content-type:/i.test(line)) || '').split(':').slice(1).join(':').trim();
    if (name === 'id' || name === 'filename') collected[name] = body.toString('utf8');
    else if (name === 'file') file = { filename, mime: contentType, bytes: body };
    else throw new RequestError(400, 'Invalid request fields');
  }
  if (!file) throw new RequestError(400, 'file required');
  return { id: collected.id, filename: collected.filename || file.filename, mime: file.mime, bytes: file.bytes };
}

async function readUpload(req) {
  const type = header(req, 'content-type') || '';
  const raw = await readRaw(req, MAX_UPLOAD_BODY_BYTES, UPLOAD_TIMEOUT_MS);
  if (/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type.trim())) {
    let parsed;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new RequestError(400, 'Invalid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400, 'JSON object required');
    if (Object.keys(parsed).some(key => !['id', 'filename', 'bytesBase64', 'mimeType'].includes(key))) {
      throw new RequestError(400, 'Invalid request fields');
    }
    const bytes = decodeBase64(parsed.bytesBase64);
    const file = validateUploadBytes(parsed.filename, parsed.mimeType, bytes);
    return { id: id(parsed.id), filename: file.filename, bytes: file.bytes };
  }
  if (/^multipart\/form-data\s*(?:;|$)/i.test(type.trim())) {
    const parsed = parseMultipart(raw, type);
    const file = validateUploadBytes(parsed.filename, parsed.mime, parsed.bytes);
    return { id: id(parsed.id), filename: file.filename, bytes: file.bytes };
  }
  throw new RequestError(415, 'multipart/form-data or application/json required');
}

async function status(relay, res) {
  const connection = ['idle', 'connecting', 'open', 'closed'].includes(relay?.state) ? relay.state : 'idle';
  const out = { connection, runState: null, usage: null, counts: null };
  // Polling status must never acquire credentials or open a connection by itself.
  if (connection !== 'open') { json(res, 200, out); return; }
  const [state, usage, bots] = await Promise.allSettled([
    relay.rpc('bot.status', {}), relay.rpc('bot.usage', {}), listBots(relay),
  ]);
  if (state.status === 'fulfilled') out.runState = state.value?.runState ?? null;
  if (usage.status === 'fulfilled') {
    const u = usage.value;
    out.usage = { plan: u?.planLabel ?? null, percent: u?.usagePercent ?? null, resetsAt: u?.nextResetAtMs ?? null, available: u?.hasAvailableUsage ?? null };
  }
  if (bots.status === 'fulfilled') out.counts = {
    total: bots.value.length, running: bots.value.filter(bot => bot.isRunning).length,
    unread: bots.value.filter(bot => bot.hasUnread).length, waiting: bots.value.filter(bot => bot.awaitingUserResponse).length,
  };
  json(res, 200, out);
}

/**
 * Mount the Grok console API on the authenticated DSH host. No login or bot operation runs at activation.
 * cookieFile defaults to ~/.dsh/grokbot/cookie.txt (raw header). auth.js separately handles the actual
 * ~/.dsh/grokbot/cookie.cache.json fallback and its 12h TTL; a cache JSON is not a cookieFile.
 * Optional profileDirs/cacheCookie/uid are forwarded to the original relay. relayFactory is an in-process
 * dependency injection seam for offline tests; it is never read from an HTTP request.
 */

function safeAuthError(error) {
  return String(error?.message || error)
    .replace(/(?:^|;\s*)(sso|sso-rw|x-userid|sso-rq)=([^;\s]+)/gi, '$1=***');
}

function cookieNamesFromHeader(header) {
  return String(header || '').split(';').map(part => part.trim().split('=')[0]).filter(Boolean);
}

function sourceLabel(source) {
  if (!source) return '未知';
  if (source === 'config') return '插件配置 / 环境变量';
  if (source.startsWith('file:')) return 'cookie 文件';
  if (source.startsWith('browser:')) return '浏览器（' + source.slice(8) + '）';
  if (source.startsWith('cache:')) return '本地缓存';
  return source;
}

async function inspectAuth(config, { force = false } = {}) {
  try {
    const resolved = await resolveCookie({
      cookie: config.cookie,
      cookieFile: config.cookieFile ?? join(homedir(), '.dsh', 'grokbot', 'cookie.txt'),
      profileDirs: config.profileDirs,
      cacheCookie: config.cacheCookie ?? true,
      force,
    });
    const names = cookieNamesFromHeader(resolved.header);
    const userId = userIdFromCookie(resolved.header);
    const signedIn = names.includes('sso') || names.includes('sso-rw') || !!userId;
    return {
      signedIn,
      cookiePresent: names.length > 0,
      cookieNames: names,
      userId: userId || null,
      source: resolved.source,
      sourceLabel: sourceLabel(resolved.source),
      message: signedIn ? '已检测到 grok.com 会话' : '读到 cookie，但缺少 sso / x-userid，可能尚未登录',
    };
  } catch (error) {
    return {
      signedIn: false,
      cookiePresent: false,
      cookieNames: [],
      userId: null,
      source: null,
      sourceLabel: '未找到',
      message: safeAuthError(error),
    };
  }
}

export function registerGrokRoutes(ctx, config = {}) {
  // Shared across dependency reactivation. Only hashes and bounded retry outcomes are retained.
  const sends = new Map();
  const SEND_CACHE_TTL_MS = 60 * 60 * 1000;
  const MAX_SEND_CACHE = 2048;
  return ctx.inject(['webServer', 'connection'], child => {
    child.effect(() => {
      let relay;
      let relayView;
      let disposed = false;
      const getRelay = () => {
        if (disposed) throw new RequestError(503, 'Grok service unavailable');
        if (!relay) {
          relay = (config.relayFactory ?? (options => new GrokBotRelay(options)))({
            cookie: config.cookie,
            cookieFile: config.cookieFile ?? join(homedir(), '.dsh', 'grokbot', 'cookie.txt'),
            profileDirs: config.profileDirs, cacheCookie: config.cacheCookie ?? true, uid: config.uid,
            // Upstream diagnostics can contain account ids, paths and relay error payloads.
            logger: () => {},
          });
          // A multi-command API transaction may resume after dispose; guard every command.
          relayView = {
            get state() { return relay.state; },
            command(...args) {
              if (disposed) throw new RequestError(503, 'Grok service unavailable');
              return relay.command(...args);
            },
            rpc(...args) {
              if (disposed) throw new RequestError(503, 'Grok service unavailable');
              return relay.rpc(...args);
            },
          };
        }
        return relayView;
      };
      const send = async body => {
        const now = Date.now();
        for (const [key, entry] of sends) if (entry.expiresAt <= now) sends.delete(key);
        const key = body.id + '\0' + body.clientNonce;
        const fingerprint = sendFingerprint(body);
        const previous = sends.get(key);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new RequestError(409, 'Client nonce already used for a different prompt');
          if (previous.promise) {
            await previous.promise;
            return;
          }
        }
        if (!previous && sends.size >= MAX_SEND_CACHE) throw new RequestError(429, 'Send retry cache is full; try again later');
        const entry = previous ?? { fingerprint, expiresAt: Infinity, promise: null };
        entry.expiresAt = Infinity;
        entry.promise = Promise.resolve().then(() => {
          const args = { agentId: body.id, prompt: body.prompt, clientNonce: body.clientNonce };
          if (body.attachmentPaths?.length) {
            args.attachmentPaths = body.attachmentPaths;
            if (body.attachmentNames?.length) args.attachmentNames = body.attachmentNames;
          }
          return getRelay().command(body.id, 'sendPrompt', args);
        });
        sends.set(key, entry);
        entry.promise.then(() => { entry.expiresAt = Date.now() + SEND_CACHE_TTL_MS; }, () => {
          // Retry failures with the same nonce, retaining the fingerprint to reject changed payloads.
          entry.promise = null;
          entry.expiresAt = Date.now() + SEND_CACHE_TTL_MS;
        });
        await entry.promise;
      };
      const api = createApi(getRelay);
      // Settings commands are read/modify/write transactions on one shared host object.
      let settingsTail = Promise.resolve();
      const settingsMutation = work => {
        const next = settingsTail.then(() => {
          if (disposed) throw new RequestError(503, 'Grok service unavailable');
          return work();
        });
        settingsTail = next.catch(() => {});
        return next;
      };
      const handler = async (req, res) => {
        try {
          if (disposed) throw new RequestError(503, 'Grok service unavailable');
          let auth;
          try { auth = child.connection; } catch { /* fail closed */ }
          if (typeof auth?.authorizeIndex !== 'function') throw new RequestError(503, 'Grok service unavailable');
          let allowed;
          try { allowed = await auth.authorizeIndex(req, res); }
          catch { throw new RequestError(503, 'Grok authorization unavailable'); }
          if (allowed !== true) {
            if (!res.headersSent && !res.writableEnded) json(res, 401, { error: 'Unauthorized' });
            req.resume();
            return;
          }
          const origin = checkOrigin(req, child.webServer);
          const target = req.url ?? '';
          if (Buffer.byteLength(target) > MAX_URL_BYTES) throw new RequestError(414, 'Request URL too long');
          if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) throw new RequestError(400, 'Invalid request URL');
          const url = new URL(target, origin);
          const route = url.pathname.slice(PREFIX.length + 1);
          const method = url.pathname.startsWith(PREFIX + '/') ? METHODS.get(route) : undefined;
          if (!method) throw new RequestError(404, 'Not found');
          if (req.method !== method) {
            json(res, 405, { error: 'Method not allowed' }, { allow: method });
            req.resume();
            return;
          }
          validateQuery(url, route);
          let body;
          if (method === 'POST') {
            if (route === 'auth-refresh' || route === 'auth-clear') {
              if ((header(req, 'content-length') ?? '0') !== '0' || header(req, 'transfer-encoding') !== undefined) {
                const payload = await readJson(req);
                if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
                  throw new RequestError(400, 'Invalid request fields');
                }
              }
              body = {};
            } else {
              body = route === 'upload' ? await readUpload(req) : validateBody(route, await readJson(req));
            }
          } else if ((header(req, 'content-length') ?? '0') !== '0' || header(req, 'transfer-encoding') !== undefined) {
            throw new RequestError(400, 'GET body not allowed');
          }
          if (disposed) throw new RequestError(503, 'Grok service unavailable');
          const resetRelay = () => {
            if (!relay) return;
            try { relay.close(); } catch { /* already closed */ }
            relay = null;
            relayView = null;
          };
          if (route === 'auth') {
            json(res, 200, await inspectAuth(config));
            return;
          }
          if (route === 'auth-refresh') {
            invalidateCookieCache();
            resetRelay();
            json(res, 200, await inspectAuth(config, { force: true }));
            return;
          }
          if (route === 'auth-clear') {
            invalidateCookieCache();
            resetRelay();
            json(res, 200, {
              signedIn: false, cookiePresent: false, cookieNames: [], userId: null, source: null, sourceLabel: '已清除',
              message: '已清除内存和本地会话缓存。~/.dsh/grokbot/cookie.txt 未改动；请重新检测或打开 grok.com 登录。',
            });
            return;
          }
          if (route === 'status') { await status(relay && getRelay(), res); return; }
          if (route === 'upload') {
            // grok.com frontend (captured from grok.js): uploadAttachment({agentId, filename, bytesBase64}) -> {path}
            // attachUpload({agentId, uploadId, filename?}) is only for grok.com asset-library items, not local files.
            // TODO: recapture if upstream later requires mimeType/sizeBytes; do not invent extra args.
            const result = await getRelay().command(body.id, 'uploadAttachment', {
              agentId: body.id, filename: body.filename, bytesBase64: body.bytes.toString('base64'),
            }, { timeoutMs: UPLOAD_TIMEOUT_MS });
            const path = typeof result?.path === 'string' ? result.path.trim() : '';
            if (!path || Buffer.byteLength(path) > 2048 || /[\x00-\x1f\x7f]/.test(path)) {
              throw new RequestError(502, 'Grok request failed');
            }
            json(res, 200, { path, name: body.filename });
            return;
          }
          if (route === 'send') {
            await send(body);
            json(res, 200, { ok: true });
            return;
          }
          if (route === 'rename') {
            await getRelay().command(body.id, 'updateAgent', { id: body.id, profile: { name: body.name } });
            json(res, 200, { ok: true });
            return;
          }
          // Feed createApi only the validated, bounded JSON. Keep its existing paths and reply shapes.
          const apiReq = method === 'POST' ? Object.assign(Readable.from([JSON.stringify(body)]), { method }) : req;
          url.pathname = '/api/' + route;
          res.setHeader('x-content-type-options', 'nosniff');
          if (route === 'pin' || route === 'group' || route.startsWith('group-')) {
            await settingsMutation(() => api(apiReq, res, url));
          } else {
            await api(apiReq, res, url);
          }
        } catch (error) {
          const known = error instanceof RequestError;
          json(res, known ? error.status : 502, { error: known ? error.message : 'Grok request failed' }, { connection: 'close' });
          req.resume();
        }
      };
      const unmount = child.webServer.register({ kind: 'prefix', path: PREFIX, handler });
      return () => {
        if (disposed) return;
        disposed = true;
        try { unmount(); } finally { relay?.close(); }
      };
    });
  });
}
