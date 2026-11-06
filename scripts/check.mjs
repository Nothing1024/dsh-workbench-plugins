#!/usr/bin/env node
import {readdir, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'packages');
const expected = {
  'workbench-sources': {name: 'dsh-plugin-workbench-sources', dependency: null},
  'herdr-live': {name: 'dsh-plugin-herdr-live', dependency: 'dsh-plugin-workbench-sources'},
  'grok-workbench': {name: 'dsh-plugin-grok-workbench', dependency: 'dsh-plugin-workbench-sources'},
};
const sourceDependency = 'dsh-plugin-workbench-sources';
const sourceManifest = JSON.parse(await readFile(join(packageRoot, 'workbench-sources', 'package.json'), 'utf8'));
const failures = [];
const jsFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.tmp') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) jsFiles.push(path);
  }
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

await walk(root);
for (const path of jsFiles.sort()) {
  const result = spawnSync(process.execPath, ['--check', path], {encoding: 'utf8'});
  if (result.status !== 0) failures.push(`node --check 失败：${relative(root, path)}\n${result.stderr || result.stdout}`);
}

const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
check(rootManifest.private === true, '根 package.json 必须保持 private: true');
check(JSON.stringify(rootManifest.workspaces) === JSON.stringify(['packages/*']), '根 package.json workspaces 必须是 ["packages/*"]');
for (const [directory, rule] of Object.entries(expected)) {
  const packagePath = join(packageRoot, directory);
  const manifest = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
  check(manifest.name === rule.name, `${directory}: name 不正确`);
  check(manifest.version === sourceManifest.version, `${directory}: 版本应与来源壳一致（Changesets fixed 组）`);
  check(manifest.private !== true, `${directory}: 不应声明 private: true`);
  check(manifest.main === 'index.js', `${directory}: main 必须是 index.js`);
  check(Array.isArray(manifest.files) && manifest.files.includes('client.js') && manifest.files.includes('index.js'), `${directory}: files 白名单缺少入口`);
  check(manifest.license === 'SEE LICENSE IN LICENSE', `${directory}: license 应指向占位 LICENSE`);
  check(manifest.repository?.directory === `packages/${directory}`, `${directory}: repository.directory 不正确`);
  check(manifest.dsh?.client?.platform === 'web', `${directory}: dsh.client.platform 必须是 web`);
  check(Array.isArray(manifest.dsh?.client?.inject), `${directory}: 缺少 dsh.client.inject`);
  check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', `${directory}: 缺少 DSH 激活 patch`);
  if (rule.dependency) check(typeof manifest.peerDependencies?.[rule.dependency] === 'string' && manifest.peerDependenciesMeta?.[rule.dependency]?.optional !== true, `${directory}: 缺少来源壳的必需 peer dependency`);
  if (rule.dependency) check(manifest.dsh.client.inject.includes(sourceDependency), `${directory}: dsh.client.inject 缺少 ${sourceDependency}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`check passed: ${jsFiles.length} JavaScript/MJS files parsed; package metadata and dependency graph validated.`);
}
