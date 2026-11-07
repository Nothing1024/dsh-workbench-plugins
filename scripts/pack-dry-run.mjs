#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd:root, encoding:'utf8'});
if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
const files = JSON.parse(result.stdout)[0].files.map(file => file.path).sort();
const expected = new Set(['package.json', 'CHANGELOG.md']);
async function addFiles(relative) {
  if (relative.endsWith('/')) {
    for (const entry of await readdir(join(root, relative), {withFileTypes:true})) await addFiles(relative + entry.name + (entry.isDirectory() ? '/' : ''));
  } else expected.add(relative);
}
for (const entry of manifest.files) await addFiles(entry);
const forbidden = /(?:^|\/)(?:node_modules|\.git|\.tickets|\.env(?:\.|$)|cookie(?:\.|\/)|credentials?|runtime|tmp|coverage|.*\.log$)/i;
const failures = files.filter(file => !expected.has(file) || forbidden.test(file));
for (const file of expected) if (file !== 'CHANGELOG.md' && !files.includes(file)) failures.push('missing: ' + file);
if (failures.length) throw new Error('Unexpected package contents: ' + failures.join(', '));
console.log(`${manifest.name}@${manifest.version}: ${files.length} files`);
for (const file of files) console.log('  - ' + file);
