const PREFIX = '/__dsh_herdr/';
const ROUTES = new Map([
  [`${PREFIX}session`, 'GET'],
  [`${PREFIX}events`, 'GET'],
  [`${PREFIX}action`, 'POST'],
]);
const ACTIONS = new Map([
  ['workspace-create', ['cwd', 'label']],
  ['workspace-rename', ['workspace_id', 'label']],
  ['workspace-close', ['workspace_id']],
  ['tab-create', ['workspace_id', 'cwd', 'label']],
  ['tab-rename', ['tab_id', 'workspace_id', 'label']],
  ['tab-close', ['tab_id', 'workspace_id']],
  ['pane-rename', ['pane_id', 'tab_id', 'workspace_id', 'label']],
  ['pane-close', ['pane_id', 'tab_id', 'workspace_id']],
]);
const BODY_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const REQUEST_TIMEOUT = 10_000;
const HEARTBEAT_INTERVAL = 15_000;

class ChannelError extends Error {
  constructor(status, code, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload ?? { error: { code, message } };
  }
}

function loopbackOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError(`${label} must be an HTTP loopback origin`);
  }
  return url;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validSnapshot(snapshot) {
  return object(snapshot)
    && Array.isArray(snapshot.workspaces) && snapshot.workspaces.every(w => object(w) && typeof w.workspace_id === 'string')
    && Array.isArray(snapshot.tabs) && snapshot.tabs.every(t => object(t) && typeof t.tab_id === 'string' && typeof t.workspace_id === 'string')
    && Array.isArray(snapshot.panes) && snapshot.panes.every(p => object(p) && typeof p.pane_id === 'string' && typeof p.tab_id === 'string' && typeof p.workspace_id === 'string');
}

function validateAction(value) {
  if (!object(value) || !ACTIONS.has(value.action)) {
    throw new ChannelError(400, 'invalid_action', 'Choose a supported workspace, tab, or pane action');
  }
  const allowed = ACTIONS.get(value.action);
  if (Object.keys(value).some(key => key !== 'action' && !allowed.includes(key))) {
    throw new ChannelError(400, 'unsupported_field', 'The action contains an unsupported field');
  }
  const [kind, verb] = value.action.split('-');
  const fields = {};
  for (const key of ['workspace_id', 'tab_id', 'pane_id']) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 256
          || value[key].trim() !== value[key] || /[\u0000-\u001f\u007f]/.test(value[key])) {
        throw new ChannelError(400, `invalid_${key}`, `${key} must be a nonempty ID of at most 256 characters`);
      }
      fields[key] = value[key];
    }
  }
  const target = verb === 'create' ? (kind === 'tab' ? 'workspace_id' : null) : `${kind}_id`;
  if (target && !Object.hasOwn(fields, target)) {
    throw new ChannelError(400, `missing_${target}`, `${target} is required`);
  }
  if (Object.hasOwn(value, 'label')) {
    if (typeof value.label !== 'string' || value.label.length > 80 || /[\u0000-\u001f\u007f]/.test(value.label)) {
      throw new ChannelError(400, 'invalid_label', 'label must be a string of at most 80 characters without control characters');
    }
    const label = value.label.trim();
    if (label) fields.label = label;
  }
  if (verb === 'rename' && !fields.label) throw new ChannelError(400, 'missing_label', 'label is required');
  if (Object.hasOwn(value, 'cwd')) {
    if (typeof value.cwd !== 'string' || !value.cwd.trim() || value.cwd.length > 4096 || /[\u0000\r\n]/.test(value.cwd)) {
      throw new ChannelError(400, 'invalid_cwd', 'cwd must be a nonempty directory path of at most 4096 characters');
    }
    fields.cwd = value.cwd;
  }
  // Optional containing IDs constrain the target; they are never sent as extra upstream options.
  const body = {};
  if (target) body[target] = fields[target];
  if (fields.label !== undefined) body.label = fields.label;
  if (fields.cwd !== undefined) body.cwd = fields.cwd;
  return { kind, verb, fields, body, path: `/api/${kind}/${verb}` };
}

function validateTargets({ kind, verb, fields }, snapshot) {
  const workspace = id => snapshot.workspaces.find(w => w.workspace_id === id);
  const tab = id => snapshot.tabs.find(t => t.tab_id === id);
  for (const [key, rows] of [['workspace_id', snapshot.workspaces], ['tab_id', snapshot.tabs], ['pane_id', snapshot.panes]]) {
    if (fields[key] !== undefined && !rows.some(row => row[key] === fields[key])) {
      throw new ChannelError(404, `${key.slice(0, -3)}_not_found`, `No ${key.slice(0, -3)} has that ID in the local session`);
    }
  }
  if (kind === 'workspace' || (kind === 'tab' && verb === 'create')) return;
  const selected = kind === 'tab' ? tab(fields.tab_id) : snapshot.panes.find(p => p.pane_id === fields.pane_id);
  const containingTab = kind === 'tab' ? selected : tab(selected.tab_id);
  if (!containingTab || !workspace(selected.workspace_id) || containingTab.workspace_id !== selected.workspace_id
      || (fields.workspace_id !== undefined && selected.workspace_id !== fields.workspace_id)
      || (fields.tab_id !== undefined && kind === 'pane' && selected.tab_id !== fields.tab_id)) {
    throw new ChannelError(409, 'target_scope_mismatch', 'The target does not belong to the specified workspace and tab');
  }
}

function readBody(req, signal) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    return Promise.reject(new ChannelError(415, 'unsupported_media_type', 'Use Content-Type: application/json'));
  }
  if (Number(req.headers['content-length']) > BODY_LIMIT) {
    req.resume();
    return Promise.reject(new ChannelError(413, 'body_too_large', 'The action body must be at most 16 KiB'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(new ChannelError(408, 'body_timeout', 'The action body timed out')), REQUEST_TIMEOUT);
    timer.unref?.();
    function finish(error, value) {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', failed);
      req.off('aborted', aborted);
      signal.removeEventListener('abort', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    }
    function data(chunk) {
      size += chunk.length;
      if (size > BODY_LIMIT) return finish(new ChannelError(413, 'body_too_large', 'The action body must be at most 16 KiB'));
      chunks.push(chunk);
    }
    function end() {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new ChannelError(400, 'invalid_json', 'The action body must be valid JSON')); }
    }
    function failed() { finish(new ChannelError(400, 'body_error', 'The action body could not be read')); }
    function aborted() { finish(new ChannelError(503, 'request_aborted', 'The sidebar request was cancelled')); }
    req.on('data', data);
    req.once('end', end);
    req.once('error', failed);
    req.once('aborted', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/**
 * Scoped host API for the temporary DSH sidebar. It never starts services or attaches a PTY.
 * handle() is synchronous: true means this module owns the response (including rejected requests).
 * GET session and default SSE messages are {snapshot}; named `connection` events carry {state}.
 */
export function createSidebarChannel({ upstreamOrigin, parentOrigin }) {
  const upstream = loopbackOrigin(upstreamOrigin, 'Ovis upstream');
  const parent = loopbackOrigin(parentOrigin, 'DSH parent').origin;
  const wsUrl = new URL('/ws', upstream);
  wsUrl.protocol = 'ws:';
  const consumers = new Set();
  const controllers = new Set();
  const operations = new Set();
  let closed = false;
  let socket = null;
  let socketTimer = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let heartbeatTimer = null;
  let refreshTimer = null;
  let refreshFlight = null;
  let refreshNeeded = false;
  let refreshDelay = 500;
  let revision = 0;
  let latestSnapshot = null;
  let connection = { state: 'disconnected' };

  function json(res, status, body, extra = {}) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  }

  async function upstreamJson(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    timeout.unref?.();
    try {
      const response = await fetch(new URL(path, upstream), {
        method,
        // Construct every header here. No browser credentials or forwarded identity reach Ovis.
        headers: { Accept: 'application/json', Origin: upstream.origin, 'X-Herdr-Machine': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      const chunks = [];
      let bytes = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > RESPONSE_LIMIT) {
            controller.abort();
            throw new ChannelError(502, 'upstream_response_too_large', 'Ovis returned an oversized response');
          }
          chunks.push(chunk);
        }
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let payload;
      try { payload = JSON.parse(text); }
      catch {
        if (response.ok && !text) payload = { ok: true };
        else if (response.ok) throw new ChannelError(502, 'invalid_upstream_json', 'Ovis returned an invalid JSON response');
        else payload = { error: { code: 'upstream_error', message: text || `Ovis returned HTTP ${response.status}` } };
      }
      if (!response.ok) throw new ChannelError(response.status, 'upstream_error', `Ovis returned HTTP ${response.status}`, payload);
      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      if (closed || signal?.aborted) throw new ChannelError(503, 'request_aborted', 'The sidebar request was cancelled');
      if (controller.signal.aborted) throw new ChannelError(504, 'upstream_timeout', 'Ovis did not answer in time');
      throw new ChannelError(502, 'upstream_unavailable', 'Ovis is unavailable');
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  async function readSession(signal) {
    const { payload } = await upstreamJson('/api/session', { signal });
    if (!validSnapshot(payload?.snapshot)) throw new ChannelError(502, 'invalid_snapshot', 'Ovis returned an invalid local session snapshot');
    return payload.snapshot;
  }

  function writeEvent(consumer, frame) {
    const { res } = consumer;
    if (res.destroyed || res.writableEnded || res.writableLength > RESPONSE_LIMIT) {
      removeConsumer(consumer);
      res.destroy();
      return;
    }
    try { res.write(frame); } catch { removeConsumer(consumer); res.destroy(); }
  }

  function broadcast(event, value) {
    const frame = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`;
    for (const consumer of consumers) writeEvent(consumer, frame);
  }

  function state(value) {
    connection = value;
    broadcast('connection', value);
  }

  function publish(snapshot) {
    latestSnapshot = snapshot;
    revision++;
    broadcast(null, { snapshot });
  }

  function queueRefresh(delay = 25) {
    if (closed || !consumers.size) return;
    refreshNeeded = true;
    if (refreshTimer || refreshFlight) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const flight = { controller: new AbortController(), revision };
      refreshFlight = flight;
      refreshNeeded = false;
      const task = (async () => {
        let nextDelay = 25;
        try {
          const snapshot = await readSession(flight.controller.signal);
          if (refreshFlight !== flight || closed || !consumers.size) return;
          // Only a newer published snapshot wins. Invalidations still queue a trailing
          // read, but must not starve completed reads while status events keep arriving.
          if (revision === flight.revision) publish(snapshot);
          refreshDelay = 500;
          if (socket?.readyState === 1 && connection.state !== 'connected') state({ state: 'connected' });
        } catch (error) {
          if (refreshFlight !== flight || closed || !consumers.size) return;
          state({ state: 'disconnected', error: error.payload?.error ?? { code: 'upstream_unavailable', message: 'Ovis is unavailable' } });
          refreshNeeded = true;
          nextDelay = refreshDelay;
          refreshDelay = Math.min(refreshDelay * 2, 10_000);
        } finally {
          if (refreshFlight === flight) {
            refreshFlight = null;
            if (refreshNeeded) queueRefresh(nextDelay);
          }
        }
      })();
      operations.add(task);
      task.finally(() => operations.delete(task));
    }, delay);
    refreshTimer.unref?.();
  }

  function reconnect() {
    if (closed || !consumers.size || retryTimer) return;
    const retryMs = Math.min(500 * 2 ** Math.min(retryAttempt++, 5), 10_000);
    state({ state: 'disconnected', retry_ms: retryMs });
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
    retryTimer.unref?.();
  }

  function lost(ws) {
    if (socket !== ws) return;
    socket = null;
    clearTimeout(socketTimer);
    socketTimer = null;
    try { if (ws.readyState < 2) ws.close(); } catch { /* the connection is already gone */ }
    reconnect();
  }

  function connect() {
    if (closed || !consumers.size || socket) return;
    state({ state: 'connecting' });
    let ws;
    try { ws = new globalThis.WebSocket(wsUrl); }
    catch { reconnect(); return; }
    socket = ws;
    socketTimer = setTimeout(() => lost(ws), REQUEST_TIMEOUT);
    socketTimer.unref?.();
    ws.addEventListener('open', () => {
      if (socket !== ws || closed || !consumers.size) { try { ws.close(); } catch {} return; }
      clearTimeout(socketTimer);
      socketTimer = null;
      // This is the only application frame this channel ever sends to Ovis.
      try { ws.send(JSON.stringify({ type: 'role', mode: 'observe' })); }
      catch { lost(ws); return; }
      retryAttempt = 0;
      state({ state: 'connected' });
      queueRefresh();
    });
    ws.addEventListener('message', event => {
      if (socket !== ws || closed || !consumers.size || typeof event.data !== 'string' || event.data.length > RESPONSE_LIMIT) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === 'snapshot' && validSnapshot(message.snapshot)) publish(message.snapshot);
      else if (message?.type === 'session-changed' || message?.type === 'pane-status') queueRefresh();
    });
    ws.addEventListener('close', () => lost(ws));
    ws.addEventListener('error', () => lost(ws));
  }

  function stopObservation() {
    clearTimeout(retryTimer);
    clearTimeout(socketTimer);
    clearTimeout(refreshTimer);
    clearInterval(heartbeatTimer);
    retryTimer = socketTimer = refreshTimer = heartbeatTimer = null;
    refreshNeeded = false;
    refreshFlight?.controller.abort();
    refreshFlight = null;
    const ws = socket;
    socket = null;
    if (ws) { try { ws.close(); } catch {} }
    latestSnapshot = null;
    connection = { state: 'disconnected' };
    retryAttempt = 0;
    refreshDelay = 500;
  }

  function removeConsumer(consumer) {
    if (!consumers.delete(consumer)) return;
    consumer.res.off('close', consumer.remove);
    consumer.res.off('error', consumer.remove);
    consumer.req.off('aborted', consumer.remove);
    if (!consumers.size) stopObservation();
  }

  function events(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const consumer = { req, res, remove: null };
    consumer.remove = () => removeConsumer(consumer);
    consumers.add(consumer);
    res.once('close', consumer.remove);
    res.once('error', consumer.remove);
    req.once('aborted', consumer.remove);
    writeEvent(consumer, `event: connection\ndata: ${JSON.stringify(connection)}\n\n`);
    if (latestSnapshot) writeEvent(consumer, `data: ${JSON.stringify({ snapshot: latestSnapshot })}\n\n`);
    if (consumers.size === 1) {
      heartbeatTimer = setInterval(() => {
        for (const current of consumers) writeEvent(current, `: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL);
      heartbeatTimer.unref?.();
      connect();
      queueRefresh();
    }
  }

  function handle(req, res, proxyOrigin) {
    // Do not claim any other facade route or provide a generic upstream endpoint.
    const pathname = (req.url ?? '').split('?')[0];
    if (!ROUTES.has(pathname)) return false;
    let host;
    try { host = loopbackOrigin(proxyOrigin, 'Ovis facade').host; } catch { host = null; }
    res.setHeader('Vary', 'Origin');
    if (!host || req.headers.host !== host || req.headers.origin !== parent) {
      json(res, 403, { error: { code: 'forbidden_origin', message: 'This sidebar API is restricted to its DSH parent origin and facade Host' } });
      return true;
    }
    res.setHeader('Access-Control-Allow-Origin', parent);
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const requested = req.headers['access-control-request-headers'];
      const names = typeof requested === 'string' ? requested.split(',').map(name => name.trim().toLowerCase()).filter(Boolean) : [];
      if ((method !== undefined && !['GET', 'POST', 'OPTIONS'].includes(method)) || names.some(name => name !== 'content-type')) {
        json(res, 403, { error: { code: 'forbidden_preflight', message: 'Only GET, POST, OPTIONS and Content-Type are allowed' } });
      } else {
        res.writeHead(204, { 'cache-control': 'no-store', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
      }
      return true;
    }
    if (req.method !== ROUTES.get(pathname)) {
      json(res, 405, { error: { code: 'method_not_allowed', message: `Use ${ROUTES.get(pathname)} for this sidebar route` } }, { Allow: `${ROUTES.get(pathname)}, OPTIONS` });
      return true;
    }
    if (closed) {
      json(res, 503, { error: { code: 'channel_closed', message: 'The sidebar channel is closed' } });
      return true;
    }
    if (pathname === `${PREFIX}events`) { events(req, res); return true; }
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', abort);
    res.once('close', abort);
    const operation = (async () => {
      try {
        if (pathname === `${PREFIX}session`) {
          json(res, 200, { snapshot: await readSession(controller.signal) });
        } else {
          const action = validateAction(await readBody(req, controller.signal));
          // Never validate a management target against the event cache or a machine roster.
          validateTargets(action, await readSession(controller.signal));
          const result = await upstreamJson(action.path, { method: 'POST', body: action.body, signal: controller.signal });
          json(res, result.status, result.payload);
          queueRefresh();
        }
      } catch (error) {
        const scoped = error instanceof ChannelError ? error : new ChannelError(500, 'channel_error', 'The sidebar request could not be completed');
        json(res, scoped.status, scoped.payload, scoped.status === 413 ? { Connection: 'close' } : {});
      } finally {
        controllers.delete(controller);
        req.off('aborted', abort);
        res.off('close', abort);
      }
    })();
    operations.add(operation);
    operation.finally(() => operations.delete(operation));
    return true;
  }

  return {
    handle,
    async close() {
      closed = true;
      broadcast('connection', { state: 'closed' });
      for (const consumer of [...consumers]) { removeConsumer(consumer); consumer.res.end(); }
      stopObservation();
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...operations]);
    },
  };
}
