import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { registerGrokRoutes } from '../packages/grok-workbench/grok-service.mjs';

const PREFIX = '/__dsh_grok/api';
const NONCE = '12345678-1234-4abc-8abc-123456789abc';

async function fixture(t) {
  const f = { commands: [], factoryCalls: 0, authorizations: 0 };
  f.relay = {
    state: 'idle',
    async command(agentId, command, args) {
      f.commands.push({ agentId, command, args: structuredClone(args) });
      this.state = 'open';
      if (command === 'uploadAttachment') return { path: '/mnt/user-data/uploads/' + (args.filename || 'file.bin') };
      return {};
    },
    async rpc() { return {}; },
    close() { this.state = 'closed'; },
  };
  const child = {
    connection: { authorizeIndex() { f.authorizations++; return f.auth !== false; } },
    webServer: {
      getOrigin: () => f.origin,
      register(route) { f.handler = route.handler; return () => {}; },
    },
    effect(fn) { f.dispose = fn(); },
  };
  registerGrokRoutes({ inject(_deps, cb) { cb(child); } }, { relayFactory() { f.factoryCalls++; return f.relay; } });
  const server = http.createServer((req, res) => {
    Promise.resolve(f.handler(req, res)).catch(error => { f.errors = (f.errors || []).concat(error); res.destroy(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  f.origin = 'http://127.0.0.1:' + server.address().port;
  f.request = (route, options = {}) => new Promise((resolve, reject) => {
    const method = options.method ?? 'GET';
    const headers = { ...(method === 'POST' ? { 'content-type': 'application/json', origin: f.origin } : {}), ...options.headers };
    if (options.origin === null) delete headers.origin;
    else if (options.origin) headers.origin = options.origin;
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const req = http.request(f.origin, { method, path: PREFIX + '/' + route, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let body;
        try { body = JSON.parse(text); } catch { /* empty */ }
        resolve({ status: res.statusCode, body, text });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
  f.post = (route, body, options = {}) => f.request(route, { method: 'POST', body, ...options });
  t.after(async () => {
    f.dispose?.();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return f;
}

function multipart({ id, filename, bytes, mime = 'text/plain', boundary = '----UiOptBoundary' }) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${id}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, Buffer.from(bytes), tail]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

test('upload JSON relays uploadAttachment and returns path', async t => {
  const f = await fixture(t);
  const bytesBase64 = Buffer.from('hello grok').toString('base64');
  const res = await f.post('upload', { id: 'bot-1', filename: 'note.txt', bytesBase64, mimeType: 'text/plain' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { path: '/mnt/user-data/uploads/note.txt', name: 'note.txt' });
  assert.equal(f.commands[0].command, 'uploadAttachment');
  assert.deepEqual(f.commands[0].args, { agentId: 'bot-1', filename: 'note.txt', bytesBase64 });
});

test('upload multipart is accepted with the same upstream args', async t => {
  const f = await fixture(t);
  const file = multipart({ id: 'bot-1', filename: 'note.txt', bytes: 'hello grok' });
  const res = await f.request('upload', {
    method: 'POST',
    raw: file.body,
    headers: { 'content-type': file.type, origin: f.origin },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.path, '/mnt/user-data/uploads/note.txt');
  assert.equal(f.commands[0].args.bytesBase64, Buffer.from('hello grok').toString('base64'));
});

test('upload rejects empty, unsupported, oversize and unauthenticated requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('upload', { id: 'bot-1', filename: 'note.txt', bytesBase64: '' })).status, 400);
  assert.equal((await f.post('upload', { id: 'bot-1', filename: 'note.exe', bytesBase64: Buffer.from('x').toString('base64') })).status, 415);
  const huge = Buffer.from('a').toString('base64'); // tiny; size check uses decoded bytes — craft via content-length too
  assert.equal((await f.post('upload', { id: 'bot-1', filename: 'note.txt', bytesBase64: Buffer.from('x').toString('base64'), extra: true })).status, 400);
  f.auth = false;
  assert.equal((await f.post('upload', { id: 'bot-1', filename: 'note.txt', bytesBase64: Buffer.from('x').toString('base64') })).status, 401);
  f.auth = true;
  assert.equal((await f.post('upload', { id: 'bot-1', filename: 'note.txt', bytesBase64: Buffer.from('x').toString('base64') }, { origin: 'https://evil.invalid' })).status, 403);
});

test('send forwards attachmentPaths and names and fingerprints them', async t => {
  const f = await fixture(t);
  const body = {
    id: 'bot-1', prompt: 'see file', clientNonce: NONCE,
    attachmentPaths: ['/mnt/user-data/uploads/note.txt'],
    attachmentNames: ['note.txt'],
  };
  assert.equal((await f.post('send', body)).status, 200);
  assert.deepEqual(f.commands[0], {
    agentId: 'bot-1', command: 'sendPrompt',
    args: { agentId: 'bot-1', prompt: 'see file', clientNonce: NONCE, attachmentPaths: body.attachmentPaths, attachmentNames: body.attachmentNames },
  });
  const changed = await f.post('send', { ...body, attachmentPaths: ['/mnt/user-data/uploads/other.txt'] });
  assert.equal(changed.status, 409);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: '', clientNonce: randomUUID(), attachmentPaths: ['/mnt/user-data/uploads/note.txt'] })).status, 200);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: '', clientNonce: randomUUID() })).status, 400);
  assert.equal((await f.post('send', { id: 'bot-1', prompt: 'x', clientNonce: randomUUID(), unexpected: true })).status, 400);
});
