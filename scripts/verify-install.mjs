#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import http from 'node:http';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--dsh-anchor')) throw new Error('Usage: node scripts/verify-install.mjs [--dsh-anchor /absolute/path/to/dsh/package.json]');
const anchor = args.length ? resolve(args[1]) : null;
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tmp = join(root, '.tmp');
await mkdir(tmp, {recursive:true});
const work = await mkdtemp(join(tmp, 'single-install-'));
function run(command, argv, cwd, env = process.env) {
  const result = spawnSync(command, argv, {cwd, env, encoding:'utf8', timeout:120000, maxBuffer:4*1024*1024});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const pack = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], root))[0];
const tarball = join(work, pack.filename);
const installDir = join(work, 'npm');
await mkdir(installDir);
await writeFile(join(installDir, 'package.json'), JSON.stringify({name:'workbench-offline-verify', private:true}));
run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], installDir);
let dshBoot, dshClient;
if (anchor) {
  const req = createRequire(anchor);
  dshBoot = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href);
  dshClient = req.resolve('@deepseek-ai/dsh-client-modules/client');
}
async function verifyResolution(directory) {
  const req = createRequire(join(directory, 'package.json'));
  const entry = await import(pathToFileURL(req.resolve(manifest.name)).href);
  assert.equal(typeof entry.apply, 'function');
  const registrations = [];
  const context = vm.createContext({window:{__ModuleLoader__:{load:registration => registrations.push(registration)}}});
  vm.runInContext(await readFile(req.resolve(manifest.name + '/client'), 'utf8'), context);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, manifest.name);
  const seed = {react:{createElement() {}}, 'react-dom':{createPortal() {}}};
  assert.equal(typeof registrations[0].factory(name => { assert.ok(Object.hasOwn(seed, name), name); return seed[name]; }).apply, 'function');
  if (dshClient) {
    let bootstrap;
    vm.runInNewContext(await readFile(dshClient, 'utf8'), {window:{__ModuleLoader__:{load:registration => {bootstrap = registration;}}}});
    const {ClientModuleSystem} = bootstrap.factory(() => {throw new Error('Unexpected bootstrap dependency');});
    const modules = new ClientModuleSystem({manifest:{modules:[], release:'offline'}, staticModules:seed, registrationTarget:{mode:'queue', pendingQueue:[]}, bootstrapModule:{id:bootstrap.id, exports:{}}});
    modules.register(registrations[0]);
    assert.equal(typeof modules.materialize(manifest.name).exports.apply, 'function');
  }
  return entry;
}
const installed = await verifyResolution(installDir);
console.log('tarball: one host entry, one client factory, no internal peer packages; resolution passed');
if (anchor) {
  const home = join(work, 'dsh-home');
  const env = {...process.env, DSH_HOME:home, DSH_AGENTS_HOME:join(home, 'agents')};
  run(process.execPath, [join(root, 'scripts/install.mjs'), '--source', 'local', '--profile', 'workbench-verify'], root, env);
  const profileDir = join(home, 'profiles/workbench-verify');
  const profile = dshBoot.loadProfileDirectory('workbench-verify', profileDir, anchor, {userLayer:false});
  assert.deepEqual(profile.skippedBundles, []);
  const entries = dshBoot.composeEntries(profile.layers.map(layer => layer.patches));
  assert.equal(entries.filter(entry => entry.name === manifest.name).length, 1);
  assert.equal(entries.filter(entry => /^dsh-plugin-(?:workbench-sources|herdr-live|grok-workbench)$/.test(entry.name)).length, 0);
  await verifyResolution(profileDir);
  console.log('DSH file: exactly one workbench plugin activated; real DSH browser module loader passed');
}
async function listen(server) {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const upstream = http.createServer((_req, res) => {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({snapshot:{workspaces:[], tabs:[], panes:[]}}));});
let route;
const host = http.createServer((req, res) => {
  if (!route) {res.writeHead(404); res.end(); return;}
  Promise.resolve(route.handler(req, res)).catch(() => res.destroy());
});
const effects = [];
const ctx = {
  connection:{authorizeIndex:() => true},
  webServer:{getOrigin:() => hostOrigin, register(value) {route=value; return () => {route=null;};}},
  inject(_dependencies, apply) {return apply(this);},
  effect(apply) {const cleanup=apply(); if (cleanup) effects.push(cleanup); return cleanup;},
};
let hostOrigin;
try {
  const upstreamOrigin = await listen(upstream);
  hostOrigin = await listen(host);
  const reserve = http.createServer();
  const proxyOrigin = await listen(reserve);
  const proxyPort = Number(new URL(proxyOrigin).port);
  await close(reserve);
  await installed.apply(ctx, {herdr:{upstreamOrigin, parentOrigin:hostOrigin, proxyPort}, grok:{cookie:'sso=synthetic-offline; x-userid=offline-account', cookieFile:join(work, 'cookie.txt'), profileDirs:[], cacheCookie:false}});
  assert.equal(route.path, '/__dsh_grok/api');
  const status = await fetch(hostOrigin + route.path + '/status');
  assert.equal(status.status, 200);
  assert.equal((await status.json()).connection, 'idle');
  const auth = await fetch(hostOrigin + route.path + '/auth');
  assert.equal(auth.status, 200);
  assert.equal((await auth.json()).userId, 'offline-account');
  const health = await fetch(proxyOrigin + '/__dsh_herdr/health', {headers:{Origin:hostOrigin}});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).upstream.status, 200);
  console.log('public apply: Herdr proxy starts and Grok routes mount by default; fake upstream and synthetic account passed');
} finally {
  for (const cleanup of effects.reverse()) await cleanup();
  await close(host);
  await close(upstream);
}
assert.equal(route, null);
for (const argv of [[], ['--unknown', '--profile', 'isolated']]) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/install.mjs'), ...argv, '--dry-run'], {cwd:root, encoding:'utf8'});
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /\$.*dsh/);
}
console.log('missing-profile and unknown-argument branches rejected; service resources released');
console.log(`verification artifacts (ignored by Git): ${work}`);
