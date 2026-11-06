#!/usr/bin/env node
// Offline tarball installation + package/browser resolution smoke.
// Optional --dsh-anchor /absolute/path/to/@deepseek-ai/dsh/package.json also
// checks real DSH local file: installs in a new isolated home, never a live profile.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--dsh-anchor')) throw new Error('Usage: node scripts/verify-install.mjs [--dsh-anchor /absolute/path/to/dsh/package.json]');
const anchor = args.length ? resolve(args[1]) : null;
const directories = ['workbench-sources', 'herdr-live', 'grok-workbench'];
const combinations = {both: directories, herdr: directories.slice(0, 2), grok: [directories[0], directories[2]]};
const manifests = new Map(await Promise.all(directories.map(async directory => [directory, JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'))])));
const tmpRoot = join(root, '.tmp');
await mkdir(tmpRoot, {recursive: true});
const work = await mkdtemp(join(tmpRoot, 'install-verify-'));
const packs = join(work, 'packs');
await mkdir(packs);

function run(command, commandArgs, cwd, env = process.env) {
  const result = spawnSync(command, commandArgs, {cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const tarballs = new Map();
for (const directory of directories) {
  const output = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packs], join(root, 'packages', directory));
  tarballs.set(directory, join(packs, JSON.parse(output)[0].filename));
}

let dshBoot;
let dshClient;
if (anchor) {
  const dshRequire = createRequire(anchor);
  dshBoot = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
  dshClient = dshRequire.resolve('@deepseek-ai/dsh-client-modules/client');
}

async function verifyResolution(directory, combo) {
  const selected = combinations[combo];
  const req = createRequire(join(directory, 'package.json'));
  const sourceName = manifests.get('workbench-sources').name;
  const sourceManifestPath = await realpath(req.resolve(sourceName + '/package.json'));
  const table = new Map();
  const cache = new Map();
  const seed = {react: {createElement() {}}, 'react-dom': {createPortal() {}}};
  const target = {load(module) { assert.ok(!table.has(module.id)); table.set(module.id, module); }};
  const context = vm.createContext({window: {__ModuleLoader__: target}});
  for (const packageDirectory of selected) {
    const name = manifests.get(packageDirectory).name;
    const installedManifest = req.resolve(name + '/package.json');
    const ownRequire = createRequire(installedManifest);
    if (name !== sourceName) assert.equal(await realpath(ownRequire.resolve(sourceName + '/package.json')), sourceManifestPath, 'business peers must resolve the same source package');
    assert.equal(typeof (await import(pathToFileURL(req.resolve(name)).href)).apply, 'function');
    vm.runInContext(await readFile(req.resolve(name + '/client'), 'utf8'), context, {filename: name + '/client'});
  }
  function browserRequire(name) {
    if (Object.hasOwn(seed, name)) return seed[name];
    if (cache.has(name)) return cache.get(name);
    assert.ok(table.has(name), `browser module missing: ${name}`);
    const exports = table.get(name).factory(browserRequire);
    cache.set(name, exports);
    return exports;
  }
  for (const packageDirectory of selected) assert.equal(typeof browserRequire(manifests.get(packageDirectory).name).apply, 'function');
  assert.equal(browserRequire(sourceName).SOURCE_TAB_SLOT, 'workbench.sources');
  assert.equal(typeof browserRequire(sourceName).SourceTab, 'function');
  if (dshClient) {
    let bootstrap;
    const realContext = vm.createContext({window: {__ModuleLoader__: {load(module) { bootstrap = module; }}}});
    vm.runInContext(await readFile(dshClient, 'utf8'), realContext);
    const {ClientModuleSystem} = bootstrap.factory(() => { throw new Error('unexpected bootstrap dependency'); });
    const facade = {mode: 'queue', pendingQueue: []};
    const modules = new ClientModuleSystem({manifest: {modules: [], release: 'offline-verify'}, staticModules: seed, registrationTarget: facade, bootstrapModule: {id: bootstrap.id, exports: {}}});
    for (const registration of table.values()) modules.register(registration);
    for (const packageDirectory of selected) assert.equal(typeof modules.materialize(manifests.get(packageDirectory).name).exports.apply, 'function');
    assert.equal(modules.materialize(sourceName).exports.SOURCE_TAB_SLOT, 'workbench.sources');
  }
}

for (const [combo, selected] of Object.entries(combinations)) {
  const installDir = join(work, 'npm-' + combo);
  await mkdir(installDir);
  await writeFile(join(installDir, 'package.json'), JSON.stringify({name: 'offline-' + combo, private: true}));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...selected.map(directory => tarballs.get(directory))], installDir);
  await verifyResolution(installDir, combo);
  console.log(`tarball ${combo}: Node entry, shared peer, browser require${dshClient ? ', real DSH module table' : ''} passed`);
  if (anchor) {
    const home = join(work, 'dsh-' + combo);
    const profileName = 'workbench-verify';
    const env = {...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents')};
    run(process.execPath, [join(root, 'scripts/install.mjs'), combo, '--source', 'local', '--profile', profileName], root, env);
    const profileDir = join(home, 'profiles', profileName);
    const profile = dshBoot.loadProfileDirectory('workbench-verify', profileDir, anchor, {userLayer: false});
    assert.deepEqual(profile.skippedBundles, []);
    const entries = dshBoot.composeEntries(profile.layers.map(layer => layer.patches));
    for (const packageDirectory of selected) {
      const name = manifests.get(packageDirectory).name;
      assert.equal(entries.filter(entry => entry.name === name).length, 1, `${name} must be activated exactly once`);
    }
    for (const packageDirectory of directories.filter(directory => !selected.includes(directory))) {
      assert.equal(entries.filter(entry => entry.name === manifests.get(packageDirectory).name).length, 0);
    }
    await verifyResolution(profileDir, combo);
    console.log(`DSH file: ${combo}: installed and activated exactly ${selected.length} plugins; loader resolution passed`);
  }
}
console.log(`verification artifacts (ignored by Git): ${work}`);
