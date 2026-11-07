import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerGrokRoutes } from '../src/grok/service.mjs';
import { GrokBotRelay } from '../src/grok/relay.js';

const PREFIX = '/__dsh_grok/api';
const NONCE = '12345678-1234-4abc-8abc-123456789abc';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// All bot commands are recorded in memory. No original tests or real credentials are used.
async function fixture(t, config = {}) {
  const f = {
    factoryCalls: [], commands: [], rpcs: [], authorizations: 0, unmounts: 0,
    auth: true, routes: [], disposers: [], errors: [],
    agents: [
      { id: 'bot-1', name: 'Alpha', updatedAt: 20, isRunning: false, hasUnread: true },
      { id: 'bot-2', name: 'Beta', updatedAt: 10, isRunning: true, awaitingUserResponse: true },
    ],
    settings: { pinnedAgentIds: ['bot-1', 'missing-pin'], unknownHostField: { keep: true }, sidebarSections: [
      { id: 'section-1', name: 'Group One', agentIds: ['bot-1', 'missing-bot'], isCollapsed: true, futureField: { keep: 1 } },
      { id: 'section-2', name: 'Group Two', agentIds: ['bot-2'], isCollapsed: false, futureField: { keep: 2 } },
    ] },
    tail: { entries: [{ kind: 'message', role: 'user', content: 'hello', timestampMs: 12, entryVersion: 4 }], nextBeforeSeq: 3 },
    offbox: { entries: [
      { body: Buffer.from(JSON.stringify({ kind: 'notice', text: 'older', entryVersion: 1 })).toString('base64') },
      { body: 'invalid-base64' },
    ], nextCursor: 'next-cursor' },
  };
  f.relay = {
    state: 'idle', userId: 'private-user-id', cookieSource: 'private-cookie-source', closeCalls: 0,
    async command(agentId, command, args) {
      f.commands.push({ agentId, command, args: structuredClone(args) });
      this.state = 'open';
      await f.onCommand?.(agentId, command, args);
      if (f.commandError) throw f.commandError;
      if (command === 'listAgents') return structuredClone(f.agents);
      if (command === 'getHostSettings') return structuredClone(f.settings);
      if (command === 'setHostSettings') { Object.assign(f.settings, structuredClone(args)); return {}; }
      if (command === 'getAgentTranscriptTail') return structuredClone(f.tail);
      if (command === 'interruptAgentRun') return { hadActiveRun: true };
      if (command === 'updateAgent') return { id: args.id, ...args.profile };
      return {};
    },
    async rpc(method, args) {
      f.rpcs.push({ method, args: structuredClone(args) });
      if (f.rpcError) throw f.rpcError;
      if (method === 'bot.status') return { runState: 'ready' };
      if (method === 'bot.usage') return { planLabel: 'test', usagePercent: 12, nextResetAtMs: 42, hasAvailableUsage: true };
      if (method === 'bot.transcript.offbox') return structuredClone(f.offbox);
      throw new Error('unexpected fake RPC');
    },
    close() { this.closeCalls++; this.state = 'closed'; },
  };
  const child = {
    connection: {
      authorizeIndex(_req, res) {
        f.authorizations++;
        f.onAuthorize?.();
        if (f.authError) throw f.authError;
        if (f.auth === 'owned') { res.writeHead(401); res.end('host unauthorized'); return false; }
        return f.auth;
      },
    },
    webServer: {
      getOrigin: () => f.origin,
      register(route) {
        f.routes.push(route);
        f.handler = route.handler;
        return () => { f.unmounts++; f.routes.splice(f.routes.indexOf(route), 1); };
      },
    },
    effect(fn) { const dispose = fn(); f.disposers.push(dispose); return dispose; },
  };
  f.child = child;
  const injectionResult = Symbol('injected');
  const ctx = { inject(deps, callback) { f.injected = deps; callback(child); return injectionResult; } };
  assert.equal(registerGrokRoutes(ctx, { ...config, relayFactory(options) { f.factoryCalls.push(options); return f.relay; } }), injectionResult);
  f.dispose = () => { for (const dispose of f.disposers) dispose(); };
  const server = http.createServer({ maxHeaderSize: 64 * 1024 }, (req, res) => {
    const handler = f.routes[0]?.handler ?? (f.useDisposedHandler ? f.handler : null);
    if (!handler) { res.writeHead(404); res.end(); return; }
    Promise.resolve(handler(req, res)).catch(error => { f.errors.push(error); res.destroy(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  f.origin = 'http://127.0.0.1:' + server.address().port;
  f.request = (route, options = {}) => new Promise((resolve, reject) => {
    const method = options.method ?? 'GET';
    const headers = {};
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      if (options.origin !== null) headers.origin = options.origin ?? f.origin;
    }
    Object.assign(headers, options.headers);
    for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const req = http.request(f.origin, { method, path: options.path ?? PREFIX + '/' + route, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let body;
        try { body = JSON.parse(text); } catch { /* HEAD and host-owned errors may be empty/plain text. */ }
        resolve({ status: res.statusCode, headers: res.headers, body, text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (options.chunks) { for (const chunk of options.chunks) req.write(chunk); req.end(); }
    else req.end(payload);
  });
  f.post = (route, body, options = {}) => f.request(route, { method: 'POST', body, ...options });
  t.after(async () => {
    f.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(f.errors, []);
  });
  return f;
}

function noRelay(f) {
  assert.equal(f.factoryCalls.length, 0);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.rpcs, []);
}

test('registers only the authenticated prefix and status does not construct/connect a relay', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.injected, ['webServer', 'connection']);
  assert.equal(f.routes.length, 1);
  assert.equal(f.routes[0].kind, 'prefix');
  assert.equal(f.routes[0].path, PREFIX);
  const response = await f.request('status');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connection: 'idle', runState: null, usage: null, counts: null });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(f.authorizations, 1);
  noRelay(f);
  f.dispose();
  f.dispose();
  assert.equal(f.unmounts, 1);
  assert.equal(f.relay.closeCalls, 0);
});

test('authorization is required and fails closed for absent, false, non-boolean or throwing guards', async t => {
  const f = await fixture(t);
  f.auth = false;
  assert.equal((await f.request('layout')).status, 401);
  f.auth = 'owned';
  assert.equal((await f.request('layout')).text, 'host unauthorized');
  f.auth = 'true';
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'no' })).status, 401);
  f.authError = Object.assign(new Error('private credential content'), { code: 'private-code' });
  const thrown = await f.request('layout');
  assert.equal(thrown.status, 503);
  assert.deepEqual(thrown.body, { error: 'Grok authorization unavailable' });
  delete f.child.connection;
  const missing = await f.request('layout');
  assert.equal(missing.status, 503);
  assert.doesNotMatch(missing.text, /private/);
  noRelay(f);
});

test('rejects cross-origin, same-site, missing Origin, Host spoofing and text/plain CSRF', async t => {
  const f = await fixture(t);
  for (const origin of [null, 'null', 'https://evil.invalid', f.origin + '/', f.origin + '.evil', f.origin.replace('http:', 'https:'), 'http://127.0.0.1:1']) {
    assert.equal((await f.post('send', { id: 'bot-1', prompt: 'blocked' }, { origin })).status, 403, String(origin));
  }
  for (const site of ['cross-site', 'same-site', 'unexpected']) {
    assert.equal((await f.request('layout', { headers: { 'sec-fetch-site': site } })).status, 403);
  }
  assert.equal((await f.request('layout', { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'blocked' }, { headers: { host: 'evil.invalid', 'x-forwarded-host': new URL(f.origin).host, 'x-forwarded-proto': 'http' } })).status, 403);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'blocked' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'blocked' }, { headers: { origin: [f.origin, f.origin] } })).status, 400);
  noRelay(f);
});

test('unknown paths and wrong methods never reach a relay', async t => {
  const f = await fixture(t);
  for (const [route, method, expected, allow] of [
    ['layout', 'POST', 405, 'GET'], ['bots', 'PATCH', 405, 'GET'], ['status', 'OPTIONS', 405, 'GET'],
    ['send', 'GET', 405, 'POST'], ['rename', 'PUT', 405, 'POST'], ['delete', 'DELETE', 405, 'POST'],
    ['group', 'GET', 405, 'POST'], ['pin', 'HEAD', 405, 'POST'], ['anything', 'GET', 404],
  ]) {
    const response = await f.request(route, { method });
    assert.equal(response.status, expected, route);
    if (allow) assert.equal(response.headers.allow, allow);
  }
  assert.equal((await f.request('', { path: PREFIX })).status, 404);
  assert.equal((await f.request('', { path: PREFIX + '-other/layout' })).status, 404);
  assert.equal((await f.request('', { path: '//evil.invalid' + PREFIX + '/layout' })).status, 400);
  assert.equal((await f.request('', { path: PREFIX + '/layout\\other' })).status, 400);
  noRelay(f);
});

test('validates query, identifiers, UTF-8 byte limits and JSON shapes before lazy construction', async t => {
  const f = await fixture(t);
  for (const route of [
    'transcript', 'transcript?id=bot-1&id=bot-2', 'transcript?id=bot-1&limit=0', 'transcript?id=bot-1&limit=201',
    'transcript?id=bot-1&limit=1.5', 'transcript?id=bot-1&limit=NaN', 'transcript?id=%00',
    'transcript?id=' + 'a'.repeat(257), 'transcript?id=bot-1&cursor=' + 'a'.repeat(4097),
    'transcript?id=bot-1&cursor=bad%0Acursor', 'layout?unexpected=1',
  ]) assert.equal((await f.request(route)).status, 400, route.slice(0, 80));
  assert.equal((await f.request('transcript?id=bot-1&cursor=' + 'x'.repeat(8300))).status, 414);
  for (const [route, body] of [
    ['send', null], ['send', []], ['send', { id: ['bot-1'], prompt: 'x' }], ['send', { id: 'bot-1', prompt: {} }],
    ['send', { id: 'bot-1', prompt: ' ' }], ['send', { id: 'bot-1', prompt: '界'.repeat(34000) }],
    ['rename', { id: 'bot-1', name: '界'.repeat(86) }], ['rename', { id: 'bot-1', name: 'bad\nname' }],
    ['rename', { id: 'bot-1', name: 'valid', command: 'deleteAgents' }], ['delete', { id: 'bot-1', force: 'true' }],
    ['group', { name: 'valid', ids: {} }], ['group', { name: 'valid', ids: ['../bad'] }],
    ['group', { name: 'valid', ids: Array(501).fill('bot-1') }], ['pin', { id: 'bot-1', pinned: 0 }],
  ]) assert.equal((await f.post(route, body)).status, 400, route);
  for (const raw of ['', '{', 'true', '[]', Buffer.from([0xff, 0xfe])]) {
    assert.equal((await f.post('send', undefined, { raw })).status, 400);
  }
  assert.equal((await f.request('layout', { raw: 'x', headers: { 'content-length': '1' } })).status, 400);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'x' }, { headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await f.post('send', undefined, { raw: 'x'.repeat(128 * 1024 + 1) })).status, 413);
  assert.equal((await f.post('send', undefined, { chunks: ['x'.repeat(65536), 'x'.repeat(65537)] })).status, 413);
  noRelay(f);
});

test('reuses one lazy relay for compatible layout, bots, transcript, status and fixed mutation commands', async t => {
  const f = await fixture(t, { cookieFile: '/fake/cookie.txt', profileDirs: [], cacheCookie: false });
  const layout = await f.request('layout', { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(layout.status, 200);
  assert.deepEqual(layout.body.pinned, ['bot-1', 'missing-pin']);
  assert.equal(layout.body.sections[0].missing, 1);
  assert.equal(layout.body.sections[0].collapsed, true);
  assert.equal((await f.request('bots')).body.bots.length, 2);
  const transcript = await f.request('transcript?id=bot-1&limit=2');
  assert.deepEqual(transcript.body, { entries: [{ kind: 'message', role: 'user', text: 'hello', at: 12, version: 4 }], cursor: '3' });
  const older = await f.request('transcript?id=bot-1&cursor=before&limit=2');
  assert.equal(older.body.entries[0].text, 'older');
  assert.equal(older.body.cursor, 'next-cursor');
  const status = await f.request('status');
  assert.deepEqual(status.body, { connection: 'open', runState: 'ready', usage: { plan: 'test', percent: 12, resetsAt: 42, available: true }, counts: { total: 2, running: 1, unread: 1, waiting: 1 } });
  assert.doesNotMatch(status.text, /private|userId|cookie/);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: '  local fake only  ', clientNonce: NONCE }, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
  const sent = f.commands.find(row => row.command === 'sendPrompt');
  assert.deepEqual({ ...sent, args: { ...sent.args, clientNonce: 'nonce' } }, { agentId: 'bot-1', command: 'sendPrompt', args: { agentId: 'bot-1', prompt: 'local fake only', clientNonce: 'nonce' } });
  assert.equal(sent.args.clientNonce, NONCE);
  assert.deepEqual((await f.post('interrupt', { id: 'bot-1' })).body, { hadActiveRun: true });
  assert.deepEqual((await f.post('rename', { id: 'bot-1', name: '  New Name  ' })).body, { ok: true });
  assert.deepEqual(f.commands.find(row => row.command === 'updateAgent'), { agentId: 'bot-1', command: 'updateAgent', args: { id: 'bot-1', profile: { name: 'New Name' } } });
  assert.equal((await f.post('delete', { id: 'bot-1' })).status, 200);
  assert.equal(f.factoryCalls.length, 1);
  assert.equal(f.factoryCalls[0].cookieFile, '/fake/cookie.txt');
  assert.deepEqual(f.factoryCalls[0].profileDirs, []);
  assert.equal(f.factoryCalls[0].cacheCookie, false);
  f.dispose();
  assert.equal(f.relay.closeCalls, 1);
  assert.equal(f.unmounts, 1);
});

test('auth inspection and the relay use the same explicit cookie without exposing its value', async t => {
  const cookie = 'sso=synthetic-explicit-account; x-userid=explicit-account';
  const f = await fixture(t, {cookie, cookieFile:'/fake/other-account.txt', profileDirs:[], cacheCookie:false});
  const auth = await f.request('auth');
  assert.equal(auth.status, 200);
  assert.equal(auth.body.userId, 'explicit-account');
  assert.doesNotMatch(auth.text, /synthetic-explicit-account/);
  assert.equal((await f.request('bots')).status, 200);
  assert.equal(f.factoryCalls[0].cookie, cookie);
});

test('offbox cursors preserve whole pages even when the tail limit is smaller', async t => {
  const f = await fixture(t);
  f.offbox = { entries: Array.from({ length: 100 }, (_, i) => ({
    body: Buffer.from(JSON.stringify({ kind: 'message', role: 'user', content: String(i + 1), entryVersion: i + 1 })).toString('base64'),
  })), nextCursor: 'page-before-100' };
  const response = await f.request('transcript?id=bot-1&cursor=page-100&limit=80');
  assert.equal(response.status, 200);
  assert.equal(response.body.entries.length, 100);
  assert.equal(response.body.entries[0].text, '1');
  assert.equal(response.body.entries[99].text, '100');
  assert.equal(response.body.cursor, 'page-before-100');
});

test('canonicalizes listener default ports but accepts only a plain trusted origin', async t => {
  const f = await fixture(t);
  for (const [advertised, origin, host] of [
    ['http://127.0.0.1:80', 'http://127.0.0.1', '127.0.0.1:80'],
    ['https://127.0.0.1:443', 'https://127.0.0.1', '127.0.0.1'],
  ]) {
    f.child.webServer.getOrigin = () => advertised;
    assert.equal((await f.request('status', { headers: { origin, host } })).status, 200);
  }
  for (const advertised of ['http://127.0.0.1/', 'http://127.0.0.1/path', 'http://127.0.0.1?x=1', 'http://user:pass@127.0.0.1', 'file://127.0.0.1']) {
    f.child.webServer.getOrigin = () => advertised;
    assert.equal((await f.request('status')).status, 503);
  }
  noRelay(f);
});

test('uses the verified raw cookie file default and blocks running deletion unless explicitly forced', async t => {
  const f = await fixture(t);
  const blocked = await f.post('delete', { id: 'bot-2' });
  assert.equal(blocked.status, 409);
  assert.equal(f.commands.filter(row => row.command === 'deleteAgents').length, 0);
  assert.equal(f.factoryCalls[0].cookieFile, join(homedir(), '.dsh', 'grokbot', 'cookie.txt'));
  assert.equal((await f.post('delete', { id: 'bot-2', force: true })).status, 200);
  assert.deepEqual(f.commands.at(-1), { agentId: 'bot-2', command: 'deleteAgents', args: { ids: ['bot-2'] } });
});

test('serializes concurrent group and pin transactions while preserving metadata and missing ids', async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const allAuthorized = deferred();
  let reads = 0;
  f.onAuthorize = () => { if (f.authorizations === 3) allAuthorized.resolve(); };
  f.onCommand = async (_id, command) => {
    if (command === 'getHostSettings' && ++reads === 1) { entered.resolve(); await release.promise; }
  };
  const first = f.post('group-rename', { id: 'section-1', name: 'Renamed' });
  await entered.promise;
  const second = f.post('group', { name: 'New Group', ids: ['bot-2', 'bot-2'] });
  const third = f.post('pin', { id: 'bot-2' });
  await allAuthorized.promise;
  assert.equal(reads, 1);
  release.resolve();
  for (const response of await Promise.all([first, second, third])) assert.equal(response.status, 200);
  const old = f.settings.sidebarSections.find(s => s.id === 'section-1');
  assert.deepEqual(old, { id: 'section-1', name: 'Renamed', agentIds: ['bot-1', 'missing-bot'], isCollapsed: true, futureField: { keep: 1 } });
  const emptied = f.settings.sidebarSections.find(s => s.id === 'section-2');
  assert.deepEqual(emptied, { id: 'section-2', name: 'Group Two', agentIds: [], isCollapsed: false, futureField: { keep: 2 } });
  const added = f.settings.sidebarSections.find(s => s.name === 'New Group');
  assert.deepEqual(added.agentIds, ['bot-2']);
  assert.deepEqual(f.settings.pinnedAgentIds, ['bot-1', 'missing-pin', 'bot-2']);
  assert.deepEqual(f.settings.unknownHostField, { keep: true });
  assert.equal((await f.post('group-delete', { id: added.id })).status, 200);
  assert.equal(f.settings.sidebarSections.some(s => s.id === added.id), false);
  assert.deepEqual(f.settings.sidebarSections.find(s => s.id === 'section-1'), old);
  assert.equal((await f.post('pin', { id: 'bot-2', pinned: false })).status, 200);
  assert.deepEqual(f.settings.pinnedAgentIds, ['bot-1', 'missing-pin']);
});

test('returns only static errors for relay failures and safely degrades connected status', async t => {
  const f = await fixture(t);
  await f.request('layout');
  const privateError = Object.assign(new Error('credential=fake-private /fake/local/path'), { status: 418, code: 'private-code', payload: { token: 'private-token' } });
  f.commandError = privateError;
  const failed = await f.request('layout');
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.body, { error: 'Grok request failed' });
  f.rpcError = privateError;
  const status = await f.request('status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { connection: 'open', runState: null, usage: null, counts: null });
  assert.doesNotMatch(status.text, /private|credential|fake|418/);
});

test('a failed settings transaction does not poison later updates', async t => {
  const f = await fixture(t);
  let fails = true;
  f.onCommand = (_id, command) => {
    if (command === 'getHostSettings' && fails) { fails = false; throw new Error('fake private failure'); }
  };
  assert.equal((await f.post('group-rename', { id: 'section-1', name: 'Failed' })).status, 502);
  assert.equal((await f.post('group-rename', { id: 'section-1', name: 'Recovered' })).status, 200);
  assert.equal(f.settings.sidebarSections[0].name, 'Recovered');
});

test('dispose cancels queued settings work and blocks late writes from in-flight work', async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const queuedAuthorized = deferred();
  f.onAuthorize = () => { if (f.authorizations === 2) queuedAuthorized.resolve(); };
  f.onCommand = async (_id, command) => {
    if (command === 'getHostSettings') { entered.resolve(); await release.promise; }
  };
  const first = f.post('group-rename', { id: 'section-1', name: 'Never Written' });
  await entered.promise;
  const second = f.post('pin', { id: 'bot-2' });
  await queuedAuthorized.promise;
  f.dispose();
  release.resolve();
  assert.equal((await first).status, 503);
  assert.equal((await second).status, 503);
  assert.equal(f.commands.filter(row => row.command === 'getHostSettings').length, 1);
  assert.equal(f.commands.filter(row => row.command === 'setHostSettings').length, 0);
  assert.equal(f.relay.closeCalls, 1);
  f.useDisposedHandler = true;
  assert.equal((await f.request('layout')).status, 503);
  assert.equal(f.factoryCalls.length, 1);
});

test('requires a strict stable client nonce before constructing a relay', async t => {
  const f = await fixture(t);
  for (const clientNonce of [undefined, null, '', {}, 'random', '12345678-1234-1abc-8abc-123456789abc', '12345678-1234-4abc-0abc-123456789abc', NONCE + 'x']) {
    assert.equal((await f.post('send', { id: 'bot-1', prompt: 'fake only', clientNonce })).status, 400);
  }
  noRelay(f);
});

test('deduplicates in-flight and successful sends, rejects payload conflicts and scopes nonce by bot', async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const duplicateAuthorized = deferred();
  f.onAuthorize = () => { if (f.authorizations === 2) duplicateAuthorized.resolve(); };
  f.onCommand = async (_id, command) => {
    if (command === 'sendPrompt') { entered.resolve(); await release.promise; }
  };
  const payload = { id: 'bot-1', prompt: 'fake only', clientNonce: NONCE };
  const first = f.post('send', payload);
  await entered.promise;
  const second = f.post('send', { ...payload, clientNonce: NONCE.toUpperCase() });
  await duplicateAuthorized.promise;
  assert.equal(f.commands.filter(row => row.command === 'sendPrompt').length, 1);
  assert.equal((await f.post('send', { ...payload, prompt: 'different' })).status, 409);
  release.resolve();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal((await f.post('send', payload)).status, 200);
  assert.equal(f.commands.filter(row => row.command === 'sendPrompt').length, 1);
  assert.equal((await f.post('send', { ...payload, id: 'bot-2' })).status, 200);
  assert.equal(f.commands.filter(row => row.command === 'sendPrompt').length, 2);
  assert.equal(f.commands[0].args.clientNonce, NONCE);
});

test('retries a failed send with the original nonce while retaining its payload fingerprint', async t => {
  const f = await fixture(t);
  const payload = { id: 'bot-1', prompt: 'fake only', clientNonce: randomUUID() };
  f.commandError = new Error('fake private failure');
  assert.equal((await f.post('send', payload)).status, 502);
  assert.equal((await f.post('send', { ...payload, prompt: 'different' })).status, 409);
  f.commandError = null;
  assert.equal((await f.post('send', payload)).status, 200);
  assert.equal((await f.post('send', payload)).status, 200);
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[0].args.clientNonce, payload.clientNonce);
  assert.equal(f.commands[1].args.clientNonce, payload.clientNonce);
});

test('a browser abort does not release send deduplication before the upstream outcome', async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const retried = deferred();
  const disconnected = deferred();
  f.onAuthorize = () => { if (f.authorizations === 2) retried.resolve(); };
  f.onCommand = async (_id, command) => {
    if (command === 'sendPrompt') { entered.resolve(); await release.promise; }
  };
  const payload = { id: 'bot-1', prompt: 'fake only', clientNonce: randomUUID() };
  const req = http.request(f.origin, { method: 'POST', path: PREFIX + '/send', headers: { origin: f.origin, 'content-type': 'application/json' }, agent: false });
  req.once('error', () => disconnected.resolve());
  req.end(JSON.stringify(payload));
  await entered.promise;
  req.destroy(new Error('fake browser timeout'));
  await disconnected.promise;
  const retry = f.post('send', payload);
  await retried.promise;
  assert.equal(f.commands.length, 1);
  release.resolve();
  assert.equal((await retry).status, 200);
  assert.equal((await f.post('send', payload)).status, 200);
  assert.equal(f.commands.length, 1);
});

test('a failed old socket cannot deliver messages or close/error events into its replacement', async t => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  const logs = [];
  class FakeWebSocket extends EventTarget {
    constructor() { super(); this.readyState = 0; this.sent = []; this.closes = 0; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.closes++; this.readyState = 3; /* Deliberately deliver close later. */ }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(frame) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) })); }
    finishClose() { this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 })); }
  }
  globalThis.WebSocket = FakeWebSocket;
  // Explicit dummy data prevents all filesystem, environment and browser credential acquisition.
  const relay = new GrokBotRelay({ cookie: 'x-userid=fake-offline-user', cacheCookie: false, logger: message => logs.push(message) });
  t.after(() => { relay.close(); globalThis.WebSocket = originalWebSocket; });
  const first = relay.connect();
  const failed = assert.rejects(first, /socket error/);
  await Promise.resolve();
  const old = sockets[0];
  assert.ok(old);
  old.open();
  old.dispatchEvent(new Event('error'));
  await failed;
  assert.equal(old.closes, 1);
  assert.equal(relay.socket, null);

  const second = relay.connect();
  await Promise.resolve();
  const current = sockets[1];
  current.open();
  current.message({ connection_id: 'fake-connection-2', capabilities: [] });
  await second;
  const rpc = relay.rpc('bot.status', {}, { timeoutMs: 60000 });
  let outcome = 'pending';
  rpc.then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
  await Promise.resolve();
  const request = current.sent.find(frame => frame.method === 'bot.status');
  assert.ok(request);
  const timer = relay.idleTimer;
  const sent = current.sent.length;
  const logCount = logs.length;
  let events = 0;
  relay.onEvent(() => { events++; });
  old.message({ id: request.id, result: { runState: 'stale' } });
  old.message({ method: 'ping', ts_ms: 1 });
  old.message({ method: 'bot.event', params: { stale: true } });
  old.finishClose();
  old.dispatchEvent(new Event('error'));
  await Promise.resolve();
  assert.equal(relay.socket, current);
  assert.equal(relay.state, 'open');
  assert.equal(relay.pending.size, 1);
  assert.equal(outcome, 'pending');
  assert.equal(relay.idleTimer, timer);
  assert.equal(current.sent.length, sent);
  assert.equal(logs.length, logCount);
  assert.equal(events, 0);
  current.message({ id: request.id, result: { runState: 'ready' } });
  assert.deepEqual(await rpc, { runState: 'ready' });
});

test('the reused relay close rejects pending RPCs and releases timers without a close event', async () => {
  const relay = new GrokBotRelay();
  let socketCloses = 0;
  relay.socket = { readyState: 1, send() {}, close() { socketCloses++; } };
  relay.onEvent(() => {});
  const pending = relay.rpc('bot.status', {}, { timeoutMs: 60000 });
  await Promise.resolve();
  assert.equal(relay.pending.size, 1);
  const result = assert.rejects(pending, /relay closed/);
  relay.close();
  await result;
  assert.equal(relay.pending.size, 0);
  assert.equal(relay.eventListeners.size, 0);
  assert.equal(relay.idleTimer, null);
  assert.equal(socketCloses, 1);
  relay.close();
  assert.equal(socketCloses, 1);
});
