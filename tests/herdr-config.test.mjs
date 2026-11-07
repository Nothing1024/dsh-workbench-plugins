import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'dsh-herdr-config-'));
process.env.DSH_HERDR_PREFS_FILE = join(directory, 'prefs.json');
const {readHerdrPrefs} = await import('../src/herdr/prefs.mjs');
const {createOvisProxy} = await import('../src/herdr/proxy.mjs');
const {apply} = await import('../src/herdr/index.js');
after(() => rm(directory, {recursive:true, force:true}));

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
async function freePort() {
  const server = http.createServer();
  const origin = await listen(server);
  await close(server);
  return Number(new URL(origin).port);
}

test('new Herdr preferences can use the current DSH origin instead of a fixed development port', async () => {
  const prefs = await readHerdrPrefs({parentOrigin:'http://127.0.0.1:32199'});
  assert.equal(prefs.parentOrigin, 'http://127.0.0.1:32199');
});

test('Herdr persists a changed port through its old listener and reads it after restart', async t => {
  const parentOrigin = 'http://127.0.0.1:32199';
  const upstream = http.createServer((_req,res) => {res.setHeader('content-type','application/json'); res.end('{}');});
  const upstreamOrigin = await listen(upstream);
  let proxy = createOvisProxy({upstreamOrigin, parentOrigin, port:0});
  t.after(async () => {await proxy.close(); await close(upstream);});
  const initial = await proxy.listen();
  const nextPort = await freePort();
  const body = {upstreamOrigin, parentOrigin, proxyPort:nextPort, frameOrigin:`http://127.0.0.1:${nextPort}`};
  const denied = await fetch(initial.origin+'/__dsh_herdr/config', {method:'POST', headers:{origin:'http://127.0.0.1:32200','content-type':'application/json'}, body:JSON.stringify(body)});
  assert.equal(denied.status, 403);
  await assert.rejects(readFile(process.env.DSH_HERDR_PREFS_FILE), {code:'ENOENT'});
  const response = await fetch(initial.origin+'/__dsh_herdr/config', {method:'POST', headers:{origin:parentOrigin,'content-type':'application/json'}, body:JSON.stringify(body)});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.proxyPort, Number(new URL(initial.origin).port));
  const stored = await readHerdrPrefs();
  assert.equal(stored.proxyPort, nextPort);
  assert.equal((await stat(process.env.DSH_HERDR_PREFS_FILE)).mode & 0o777, 0o600);
  await proxy.close();
  proxy = createOvisProxy({upstreamOrigin:stored.upstreamOrigin, parentOrigin:stored.parentOrigin, port:stored.proxyPort});
  const restarted = await proxy.listen();
  assert.equal(restarted.origin, body.frameOrigin);
  const health = await fetch(restarted.origin+'/__dsh_herdr/health', {headers:{origin:parentOrigin}});
  assert.equal((await health.json()).ok, true);
});

test('Herdr startup fills a partial explicit config with the active DSH origin', async t => {
  const metadata = join(directory, 'proxy-metadata.json');
  process.env.DSH_HERDR_PROXY_METADATA = metadata;
  t.after(() => {delete process.env.DSH_HERDR_PROXY_METADATA;});
  const effects = [];
  const origin = 'http://127.0.0.1:32300';
  const ctx = {
    webServer:{getOrigin:() => origin},
    inject(_deps, install) {return install(this);},
    effect(install) {effects.push(install());},
  };
  t.after(async () => {for (const dispose of effects.reverse()) await dispose();});
  await apply(ctx, {proxyPort:await freePort()});
  assert.equal(JSON.parse(await readFile(metadata,'utf8')).parentOrigin, origin);
});
