#!/usr/bin/env node
import {readdir, readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const failures = [], jsFiles = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
async function walk(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (['node_modules', '.git', '.tmp', '.tickets'].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) jsFiles.push(file);
  }
}
await walk(root);
for (const file of jsFiles.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding:'utf8'});
  check(result.status === 0, `${relative(root, file)}: ${result.stderr || result.stdout}`);
}
check(manifest.name === 'dsh-plugin-workbench-suite', 'Expected the single workbench package name');
check(manifest.private !== true && manifest.workspaces === undefined, 'The root must be one publishable package without workspaces');
check(manifest.main === 'index.js' && manifest.exports?.['.'] === './index.js', 'Missing host entry');
check(manifest.exports?.['./client'] === './dist/client.js', 'Missing built client entry');
check(manifest.dsh?.client?.platform === 'web', 'Missing DSH web client declaration');
check(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-plugin-manager'), 'Plugin details settings require the DSH plugin manager');
check(JSON.stringify(manifest.dsh?.client?.external) === JSON.stringify(['react', 'react-dom']), 'Client externals must come from the host');
check(!Object.keys({...manifest.dependencies, ...manifest.peerDependencies}).some(name => name.startsWith('dsh-plugin-')), 'Internal modules must not depend on other workbench packages');
check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'Missing activation patch');
check(manifest.license === 'MIT', 'Expected the MIT license selected for this release');
check(!/REPLACE_ME|PLACEHOLDER/i.test(JSON.stringify({repository:manifest.repository, homepage:manifest.homepage, bugs:manifest.bugs})), 'Release metadata contains placeholders');
check(manifest.repository?.url === 'git+https://github.com/Nothing1024/dsh-workbench-plugins.git', 'Missing release repository URL');
check(manifest.publishConfig?.access === 'public' && manifest.publishConfig?.registry === 'https://registry.npmjs.org/', 'Missing public npm registry declaration');
const license = await readFile(join(root, 'LICENSE'), 'utf8');
check(license.startsWith('MIT License\n') && license.includes('Copyright (c) 2026 Nothing1024') && !/PLACEHOLDER|待确认/.test(license), 'Missing final MIT license and copyright notice');
for (const file of ['index.js', 'src/client.js', 'src/sources/client.js', 'src/herdr/index.js', 'src/grok/index.js', 'dist/client.js', 'cordis.patch.yml']) {
  try { await access(join(root, file)); } catch { failures.push(`Missing ${file}`); }
}
const client = await readFile(join(root, 'dist/client.js'), 'utf8');
check((client.match(/__ModuleLoader__\.load\(/g) || []).length === 1, 'Client bundle must register exactly one plugin factory');
check(!/dsh-plugin-(?:workbench-sources|herdr-live|grok-workbench)/.test(client), 'Old package identities remain in the client bundle');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`check passed: ${jsFiles.length} JavaScript/MJS files; one package, one host entry and one client factory.`);
