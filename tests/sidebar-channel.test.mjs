import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createSidebarChannel } from '../packages/herdr-live/sidebar-channel.mjs';

const PARENT = 'http://127.0.0.1:50759';
const API = '/__dsh_herdr/';

function snapshot(status = 'idle') {
  return {
    version: 'harmless-stub', protocol: 1, agents: [], layouts: [],
    workspaces: [1, 2].map(i => ({ workspace_id: `w${i}`, label: `Workspace ${i}`, agent_status: status })),
    tabs: [1, 2].map(i => ({ tab_id: `t${i}`, workspace_id: `w${i}`, label: `Tab ${i}`, agent_status: status })),
    panes: [1, 2].map(i => ({ pane_id: `p${i}`, tab_id: `t${i}`, workspace_id: `w${i}`, label: `Pane ${i}`, agent_status: status })),
  };
}

function waitFor(bus, check, milliseconds = 3000) {
  const found = check();
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bus.off('change', changed); reject(new Error('Stub condition timed out')); }, milliseconds);
    function changed() {
      const value = check();
      if (!value) return;
      clearTimeout(timer);
      bus.off('change', changed);
      resolve(value);
    }
    bus.on('change', changed);
  });
}

function serverFrame(value, opcode = 1) {
  const body = typeof value === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  if (body.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
  const header = Buffer.alloc(4);
  header[0] = 0x80 | opcode;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

async function fixture(t, options = {}) {
  const bus = new EventEmitter();
  const upstreamSockets = new Set();
  const facadeSockets = new Set();
  const peers = new Set();
  const f = { bus, peers, seen: [], frames: [], upgrades: [], currentSnapshot: snapshot(), ...options };
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const record = { path: req.url, method: req.method, headers: req.headers, text: Buffer.concat(chunks).toString() };
      if (record.text) { try { record.body = JSON.parse(record.text); } catch {} }
      f.seen.push(record);
      if (req.url === '/api/session' && f.onSession?.(req, res, record)) { bus.emit('change'); return; }
      const answer = req.url === '/api/session' ? (f.sessionAnswer ?? { status: 200, body: { snapshot: f.currentSnapshot } })
        : (f.actionAnswer ?? { status: 200, body: { ok: true } });
      res.writeHead(answer.status, { 'Content-Type': 'application/json', 'Set-Cookie': 'stub=never-forward', ...answer.headers });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
      bus.emit('change');
    });
  });
  upstream.on('connection', socket => { upstreamSockets.add(socket); socket.once('close', () => upstreamSockets.delete(socket)); });
  upstream.on('upgrade', (req, socket, head) => {
    f.upgrades.push({ path: req.url, headers: req.headers });
    if (f.rejectUpgrades) { socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); bus.emit('change'); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    peers.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => { peers.delete(socket); bus.emit('change'); });
    let buffer = Buffer.alloc(0);
    function data(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        const masked = Boolean(buffer[1] & 128);
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
        if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
        if (buffer.length < offset + (masked ? 4 : 0) + length) return;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        offset += masked ? 4 : 0;
        const body = Buffer.from(buffer.subarray(offset, offset + length));
        if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        buffer = buffer.subarray(offset + length);
        if (opcode === 1) { f.frames.push(JSON.parse(body.toString())); bus.emit('change'); }
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); bus.emit('change'); return; }
      }
    }
    socket.on('data', data);
    if (head.length) data(head);
    if (f.wsSnapshot !== false) socket.write(serverFrame({ type: 'snapshot', snapshot: f.currentSnapshot }));
    bus.emit('change');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  f.upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  f.channel = createSidebarChannel({ upstreamOrigin: f.upstreamOrigin, parentOrigin: PARENT });
  const facade = http.createServer((req, res) => {
    const owned = f.channel.handle(req, res, f.origin);
    assert.equal(typeof owned, 'boolean', 'handle returns ownership synchronously');
    if (!owned) { res.writeHead(404); res.end('ordinary facade route'); }
  });
  facade.on('connection', socket => { facadeSockets.add(socket); socket.once('close', () => facadeSockets.delete(socket)); });
  await new Promise(resolve => facade.listen(0, '127.0.0.1', resolve));
  f.origin = `http://127.0.0.1:${facade.address().port}`;
  f.send = value => { for (const peer of peers) peer.write(serverFrame(value)); };
  f.wait = check => waitFor(bus, check);
  f.request = (path = 'session', args = {}) => request(f.origin + (path.startsWith('/') ? path : API + path), args);
  f.post = body => f.request('action', { method: 'POST', body });
  f.events = () => eventStream(f.origin + API + 'events');
  t.after(async () => {
    await f.channel.close();
    for (const socket of [...facadeSockets, ...upstreamSockets]) socket.destroy();
    await Promise.all([new Promise(resolve => facade.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  });
  return f;
}

function request(url, { method = 'GET', headers = {}, body, rawBody, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const text = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = http.request(url, {
      method, headers: { Origin: PARENT, ...(text === undefined ? {} : { 'Content-Type': 'application/json' }), ...(chunked ? { 'Transfer-Encoding': 'chunked' } : {}), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let value;
        try { value = JSON.parse(text); } catch { value = text; }
        resolve({ status: res.statusCode, headers: res.headers, body: value });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (chunked && text !== undefined) { req.write(text.slice(0, 8000)); req.write(text.slice(8000)); req.end(); }
    else req.end(text);
  });
}

function eventStream(url) {
  return new Promise((resolve, reject) => {
    const bus = new EventEmitter();
    const events = [];
    const req = http.get(url, { headers: { Origin: PARENT } }, res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /^text\/event-stream/);
      let pending = '';
      res.setEncoding('utf8');
      res.on('data', text => {
        pending += text;
        while (pending.includes('\n\n')) {
          const at = pending.indexOf('\n\n');
          const frame = pending.slice(0, at);
          pending = pending.slice(at + 2);
          const name = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7) ?? 'message';
          const payload = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          events.push(payload ? { event: name, data: JSON.parse(payload) } : { event: 'comment', text: frame });
          bus.emit('change');
        }
      });
      res.on('error', () => {});
      resolve({
        res, req, events,
        wait: (check, milliseconds) => waitFor(bus, () => events.find(check), milliseconds),
        async close() {
          if (res.destroyed) return;
          const ended = once(res, 'close');
          req.destroy(); res.destroy(); await ended;
        },
      });
    });
    req.on('error', reject);
  });
}

test('origins must be plain loopback HTTP origins', () => {
  for (const value of ['https://127.0.0.1:1', 'http://outside.example', 'http://127.0.0.1:1/path', 'http://operator@127.0.0.1:1', 'http://127.0.0.1:1/?x=1']) {
    assert.throws(() => createSidebarChannel({ upstreamOrigin: value, parentOrigin: PARENT }));
    assert.throws(() => createSidebarChannel({ upstreamOrigin: 'http://127.0.0.1:1', parentOrigin: value }));
  }
});

test('only the three exact scoped routes are owned, with exact parent Origin and facade Host', async t => {
  const f = await fixture(t);
  for (const path of ['session', 'events', 'action']) {
    const method = path === 'action' ? 'POST' : 'GET';
    for (const headers of [{ Origin: '' }, { Origin: f.origin }, { Origin: 'https://foreign.example' }, { Host: 'localhost:1234' }]) {
      const response = await f.request(path, { method, headers });
      assert.equal(response.status, 403);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(response.headers.vary, 'Origin');
    }
  }
  assert.equal((await f.request('/api/session')).status, 404);
  assert.equal((await f.request('/__dsh_herdr/unknown')).status, 404);
  assert.equal((await f.request('/__dsh_herdr/events/extra')).status, 404);
  assert.equal((await f.request('session', { method: 'POST' })).status, 405);
  assert.equal((await f.request('action')).status, 405);
  assert.equal(f.seen.length, 0);
  assert.equal(f.upgrades.length, 0);
});

test('preflights expose only the parent origin, allowed methods and Content-Type', async t => {
  const f = await fixture(t);
  for (const path of ['session', 'events', 'action']) {
    const allowed = await f.request(path, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], PARENT);
    assert.equal(allowed.headers['access-control-allow-methods'], 'GET, POST, OPTIONS');
    assert.equal(allowed.headers['access-control-allow-headers'], 'Content-Type');
    assert.equal(allowed.headers['access-control-allow-credentials'], undefined);
  }
  for (const headers of [{ 'Access-Control-Request-Headers': 'Authorization' }, { 'Access-Control-Request-Headers': 'content-type, X-Herdr-Machine' }, { 'Access-Control-Request-Method': 'DELETE' }]) {
    assert.equal((await f.request('action', { method: 'OPTIONS', headers })).status, 403);
  }
  assert.equal((await f.request('action', { method: 'OPTIONS', headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal(f.seen.length, 0);
});

test('session reads only local /api/session and constructs upstream headers without browser identity', async t => {
  const f = await fixture(t);
  const response = await f.request('session?machine_id=untrusted-remote', { headers: {
    Cookie: 'fixture=browser-only', Authorization: 'Bearer fixture-only', Referer: 'https://foreign.example',
    Forwarded: 'for=203.0.113.4', 'X-Forwarded-Host': 'foreign.example', 'X-Forwarded-User': 'fake-user',
    'X-Herdr-Machine': 'untrusted', 'Tailscale-User-Login': 'fake@example.invalid',
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { snapshot: f.currentSnapshot });
  assert.equal(response.headers['access-control-allow-origin'], PARENT);
  assert.equal(response.headers.vary, 'Origin');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].path, '/api/session');
  assert.equal(f.seen[0].headers.host, new URL(f.upstreamOrigin).host);
  assert.equal(f.seen[0].headers.origin, f.upstreamOrigin);
  assert.equal(f.seen[0].headers['x-herdr-machine'], '1');
  for (const header of ['cookie', 'authorization', 'referer', 'forwarded', 'x-forwarded-host', 'x-forwarded-user', 'tailscale-user-login']) {
    assert.equal(f.seen[0].headers[header], undefined);
  }
  assert.equal(f.upgrades.length, 0, 'GET does not start observation');
});

test('all eight actions use dedicated upstream routes and only their native payload fields', async t => {
  const f = await fixture(t);
  const cases = [
    [{ action: 'workspace-create', cwd: '/stub/folder', label: ' New project ' }, '/api/workspace/create', { cwd: '/stub/folder', label: 'New project' }],
    [{ action: 'workspace-rename', workspace_id: 'w1', label: 'Renamed' }, '/api/workspace/rename', { workspace_id: 'w1', label: 'Renamed' }],
    [{ action: 'workspace-close', workspace_id: 'w1' }, '/api/workspace/close', { workspace_id: 'w1' }],
    [{ action: 'tab-create', workspace_id: 'w1', cwd: '/stub/folder', label: ' Shell ' }, '/api/tab/create', { workspace_id: 'w1', cwd: '/stub/folder', label: 'Shell' }],
    [{ action: 'tab-rename', tab_id: 't1', workspace_id: 'w1', label: 'Build' }, '/api/tab/rename', { tab_id: 't1', label: 'Build' }],
    [{ action: 'tab-close', tab_id: 't1', workspace_id: 'w1' }, '/api/tab/close', { tab_id: 't1' }],
    [{ action: 'pane-rename', pane_id: 'p1', workspace_id: 'w1', tab_id: 't1', label: 'Logs' }, '/api/pane/rename', { pane_id: 'p1', label: 'Logs' }],
    [{ action: 'pane-close', pane_id: 'p1', workspace_id: 'w1', tab_id: 't1' }, '/api/pane/close', { pane_id: 'p1' }],
  ];
  for (const [body, path, payload] of cases) {
    const before = f.seen.length;
    assert.deepEqual((await f.post(body)).body, { ok: true });
    assert.equal(f.seen.length, before + 2, 'each mutation validates a newly fetched snapshot');
    const [read, write] = f.seen.slice(before);
    assert.equal(read.path, '/api/session');
    assert.equal(read.method, 'GET');
    assert.equal(write.path, path);
    assert.equal(write.method, 'POST');
    assert.deepEqual(write.body, payload);
    assert.equal(write.headers.origin, f.upstreamOrigin);
    assert.equal(write.headers['x-herdr-machine'], '1');
  }
  assert.equal(f.upgrades.length, 0, 'management without an SSE consumer does not start WS observation');
});

test('unsupported actions, spawn flags and invalid field types or lengths never reach upstream', async t => {
  const f = await fixture(t);
  const invalid = [
    null, [], {}, { action: 'pane-focus', pane_id: 'p1' },
    { action: 'workspace-create', endpoint: '/api/pane/input' },
    { action: 'workspace-create', agent: { kind: 'codex' } },
    { action: 'workspace-create', first_message: 'must not run' },
    { action: 'workspace-create', machine_id: 'remote' },
    { action: 'workspace-close', workspace_id: 'w1', close_group: true },
    { action: 'workspace-rename', workspace_id: 1, label: 'Test' },
    { action: 'workspace-close', workspace_id: '' },
    { action: 'workspace-close', workspace_id: 'x'.repeat(257) },
    { action: 'tab-create' }, { action: 'tab-close', tab_id: ' t1 ' },
    { action: 'pane-close', pane_id: 'p1', tab_id: null },
    { action: 'workspace-create', cwd: null }, { action: 'workspace-create', cwd: '' },
    { action: 'workspace-create', cwd: '/'.repeat(4097) }, { action: 'workspace-create', cwd: '/tmp\u0000no' },
    { action: 'workspace-create', label: 1 }, { action: 'workspace-create', label: 'a'.repeat(81) },
    { action: 'workspace-rename', workspace_id: 'w1', label: '  ' },
    { action: 'pane-rename', pane_id: 'p1', label: 'bad\nlabel' },
  ];
  for (const body of invalid) assert.equal((await f.post(body)).status, 400, JSON.stringify(body));
  assert.equal(f.seen.length, 0);
  assert.equal((await f.request('action', { method: 'POST', rawBody: '{' })).status, 400);
  assert.equal((await f.request('action', { method: 'POST', rawBody: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(f.seen.length, 0);
});

test('action body is bounded for both content-length and chunked requests, while exactly 16 KiB works', async t => {
  const f = await fixture(t);
  const valid = JSON.stringify({ action: 'workspace-create' });
  const boundary = valid + ' '.repeat(16 * 1024 - Buffer.byteLength(valid));
  assert.equal((await f.request('action', { method: 'POST', rawBody: boundary })).status, 200);
  const before = f.seen.length;
  for (const chunked of [false, true]) {
    const response = await f.request('action', { method: 'POST', rawBody: boundary + ' ', chunked });
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'body_too_large');
  }
  assert.equal(f.seen.length, before);
});

test('fresh target membership and containing workspace/tab relationships constrain every mutation', async t => {
  const f = await fixture(t);
  for (const body of [
    { action: 'workspace-close', workspace_id: 'missing' },
    { action: 'tab-close', tab_id: 'missing' },
    { action: 'pane-close', pane_id: 'missing' },
    { action: 'tab-create', workspace_id: 'missing' },
  ]) assert.equal((await f.post(body)).status, 404);
  for (const body of [
    { action: 'tab-close', tab_id: 't1', workspace_id: 'w2' },
    { action: 'pane-close', pane_id: 'p1', workspace_id: 'w2' },
    { action: 'pane-rename', pane_id: 'p1', tab_id: 't2', label: 'No' },
  ]) assert.equal((await f.post(body)).status, 409);
  f.currentSnapshot.panes[0].workspace_id = 'w2';
  assert.equal((await f.post({ action: 'pane-close', pane_id: 'p1' })).status, 409);
  f.currentSnapshot = snapshot();
  f.currentSnapshot.workspaces = f.currentSnapshot.workspaces.filter(w => w.workspace_id !== 'w1');
  assert.equal((await f.post({ action: 'tab-close', tab_id: 't1' })).status, 409);
  assert.ok(f.seen.every(row => row.path === '/api/session'));
});

test('upstream JSON error status and body survive, text errors are scoped JSON and redirects are never followed', async t => {
  const f = await fixture(t);
  const error = { error: { code: 'workspace_has_worktrees', message: 'Close the child worktree first', details: ['stub-child'] } };
  f.actionAnswer = { status: 409, body: error };
  const mutation = await f.post({ action: 'workspace-close', workspace_id: 'w1' });
  assert.equal(mutation.status, 409);
  assert.deepEqual(mutation.body, error);
  f.sessionAnswer = { status: 503, body: { error: { code: 'herdr_disconnected', message: 'The test bridge is unavailable' } } };
  const unavailable = await f.request();
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, f.sessionAnswer.body);
  const before = f.seen.length;
  assert.equal((await f.post({ action: 'pane-close', pane_id: 'p1' })).status, 503);
  assert.equal(f.seen.length, before + 1, 'a failed validation read prevents dispatch');
  f.sessionAnswer = { status: 502, body: 'stub gateway failed' };
  assert.deepEqual((await f.request()).body, { error: { code: 'upstream_error', message: 'stub gateway failed' } });
  f.sessionAnswer = { status: 302, body: { error: { code: 'stub_redirect', message: 'Do not follow me' } }, headers: { Location: '/must-not-follow' } };
  assert.equal((await f.request()).status, 302);
  assert.ok(f.seen.every(row => row.path !== '/must-not-follow'));
  f.sessionAnswer = { status: 200, body: { snapshot: { panes: [] } } };
  const malformed = await f.request();
  assert.equal(malformed.status, 502);
  assert.equal(malformed.body.error.code, 'invalid_snapshot');
});

test('SSE shares one local observer, forwards snapshots, and closes the socket with the last consumer', async t => {
  const f = await fixture(t);
  const a = await f.events();
  await a.wait(e => e.data?.snapshot);
  await f.wait(() => f.frames.length === 1);
  assert.deepEqual(f.frames, [{ type: 'role', mode: 'observe' }]);
  assert.equal(f.upgrades[0].path, '/ws');
  for (const header of ['cookie', 'authorization', 'forwarded', 'x-forwarded-for', 'origin']) assert.equal(f.upgrades[0].headers[header], undefined);
  const b = await f.events();
  await b.wait(e => e.data?.snapshot);
  assert.equal(f.upgrades.length, 1);
  await b.wait(e => e.event === 'connection' && e.data.state === 'connected');
  const changed = snapshot('working');
  f.send({ type: 'snapshot', snapshot: changed });
  await a.wait(e => e.data?.snapshot?.panes[0].agent_status === 'working');
  await b.wait(e => e.data?.snapshot?.panes[0].agent_status === 'working');
  await a.close();
  assert.equal(f.peers.size, 1);
  await b.close();
  await f.wait(() => f.peers.size === 0);
  const count = f.upgrades.length;
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(f.upgrades.length, count, 'the last consumer cancels reconnect attempts');
  assert.ok(f.frames.every(frame => frame.type === 'role' && frame.mode === 'observe'));
});

test('session-changed and pane-status coalesce reads and publish accurate enriched snapshot state', async t => {
  const f = await fixture(t, { wsSnapshot: false });
  const stream = await f.events();
  await stream.wait(e => e.data?.snapshot);
  await f.wait(() => f.frames.length === 1);
  const before = f.seen.length;
  let held;
  f.onSession = (_req, res) => { held = res; return true; };
  for (let i = 0; i < 20; i++) f.send({ type: 'session-changed' });
  await f.wait(() => held);
  assert.equal(f.seen.length, before + 1, 'burst before read becomes one read');
  for (let i = 0; i < 20; i++) f.send({ type: 'pane-status', pane_id: 'p1', agent_status: 'blocked' });
  f.currentSnapshot = snapshot('blocked');
  f.currentSnapshot.panes[0].background_tasks = 2;
  f.currentSnapshot.panes[0].background_wait = true;
  f.currentSnapshot.panes[0].plan = { done: 1, total: 3 };
  f.onSession = null;
  held.writeHead(200, { 'Content-Type': 'application/json' });
  held.end(JSON.stringify({ snapshot: snapshot('idle') }));
  const updated = await stream.wait(e => e.data?.snapshot?.panes[0].agent_status === 'blocked');
  assert.deepEqual(updated.data.snapshot, f.currentSnapshot);
  assert.equal(f.seen.length, before + 2, 'in-flight invalidations cause one trailing read');
  assert.deepEqual(f.frames, [{ type: 'role', mode: 'observe' }]);
  await stream.close();
});

test('sustained in-flight invalidations publish every completed read and retain a trailing read', async t => {
  let socket;
  const sent = [];
  class ObserveSocket extends EventTarget {
    readyState = 0;
    constructor() {
      super();
      socket = this;
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(text) { sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
  }
  t.mock.method(globalThis, 'WebSocket', function () { return new ObserveSocket(); });
  let reads = 0;
  const f = await fixture(t, { onSession(_req, res) {
    const current = snapshot(`refresh-${++reads}`);
    // Deliver both invalidations synchronously during every read, before its
    // response resolves. There is never a quiet read in which to publish later.
    for (const type of ['pane-status', 'session-changed']) {
      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type }) }));
    }
    res.end(JSON.stringify({ snapshot: current }));
    return true;
  } });
  const stream = await f.events();
  for (let i = 1; i <= 3; i++) {
    await stream.wait(e => e.data?.snapshot?.panes[0].agent_status === `refresh-${i}`);
  }
  assert.deepEqual(stream.events.filter(e => e.data?.snapshot).slice(0, 3)
    .map(e => e.data.snapshot.panes[0].agent_status), ['refresh-1', 'refresh-2', 'refresh-3']);
  f.onSession = null;
  f.currentSnapshot = snapshot('trailing');
  await stream.wait(e => e.data?.snapshot?.panes[0].agent_status === 'trailing');
  assert.deepEqual(sent, [{ type: 'role', mode: 'observe' }]);
  await stream.close();
});

test('an incoming newer WS snapshot wins over a stale in-flight refresh', async t => {
  const f = await fixture(t, { wsSnapshot: false });
  const stream = await f.events();
  await stream.wait(e => e.data?.snapshot);
  let held;
  f.onSession = (_req, res) => { held = res; return true; };
  f.send({ type: 'session-changed' });
  await f.wait(() => held);
  f.send({ type: 'snapshot', snapshot: snapshot('done') });
  await stream.wait(e => e.data?.snapshot?.panes[0].agent_status === 'done');
  const mark = stream.events.length;
  held.end(JSON.stringify({ snapshot: snapshot('idle') }));
  f.onSession = null;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(stream.events.slice(mark).filter(e => e.data?.snapshot).length, 0);
  await stream.close();
});

test('management uses a fresh snapshot even while SSE retains an older target', async t => {
  const f = await fixture(t);
  const stream = await f.events();
  await stream.wait(e => e.data?.snapshot?.panes.some(p => p.pane_id === 'p1'));
  f.currentSnapshot = snapshot();
  f.currentSnapshot.panes = f.currentSnapshot.panes.filter(p => p.pane_id !== 'p1');
  const response = await f.post({ action: 'pane-close', pane_id: 'p1' });
  assert.equal(response.status, 404);
  assert.equal(f.seen.filter(row => row.method === 'POST').length, 0);
  await stream.close();
});

test('observation reconnects only while consumed and always repeats observe without attach or input', async t => {
  const f = await fixture(t);
  const stream = await f.events();
  await f.wait(() => f.frames.length === 1);
  for (const peer of f.peers) peer.destroy();
  await stream.wait(e => e.event === 'connection' && e.data.state === 'disconnected' && e.data.retry_ms);
  await f.wait(() => f.frames.length === 2);
  assert.equal(f.upgrades.length, 2);
  assert.deepEqual(f.frames, [{ type: 'role', mode: 'observe' }, { type: 'role', mode: 'observe' }]);
  f.rejectUpgrades = true;
  for (const peer of f.peers) peer.destroy();
  await f.wait(() => f.peers.size === 0);
  await stream.close();
  const count = f.upgrades.length;
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(f.upgrades.length, count);
});

test('SSE heartbeats are comments and do not send application frames upstream', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(t);
  const stream = await f.events();
  await stream.wait(e => e.data?.snapshot);
  await f.wait(() => f.frames.length === 1);
  t.mock.timers.tick(15_000);
  await stream.wait(e => e.event === 'comment' && e.text.startsWith(': heartbeat '));
  assert.deepEqual(f.frames, [{ type: 'role', mode: 'observe' }]);
  await stream.close();
});

test('last-consumer removal cancels an in-flight refresh, and channel.close cancels outstanding reads', async t => {
  const f = await fixture(t, { wsSnapshot: false });
  let held;
  let upstreamClosed = false;
  f.onSession = (_req, res) => { held = res; res.on('close', () => { upstreamClosed = true; f.bus.emit('change'); }); return true; };
  const stream = await f.events();
  await f.wait(() => held);
  await stream.close();
  await f.wait(() => upstreamClosed && f.peers.size === 0);
  held = null;
  upstreamClosed = false;
  const pending = f.request();
  await f.wait(() => held);
  await f.channel.close();
  const cancelled = await pending;
  assert.equal(cancelled.status, 503);
  assert.equal(cancelled.body.error.code, 'request_aborted');
  assert.equal((await f.request()).status, 503);
  await f.channel.close();
});

test('close ends every SSE response and reports the closed connection state', async t => {
  const f = await fixture(t);
  const stream = await f.events();
  await stream.wait(e => e.data?.snapshot);
  const ended = once(stream.res, 'end');
  await f.channel.close();
  await ended;
  assert.ok(stream.events.some(e => e.event === 'connection' && e.data.state === 'closed'));
  await f.wait(() => f.peers.size === 0);
});
