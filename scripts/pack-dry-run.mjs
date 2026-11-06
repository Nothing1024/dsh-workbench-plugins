#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['workbench-sources', 'herdr-live', 'grok-workbench'];
const forbidden = /(?:^|\/)(?:node_modules|\.git|\.env(?:\.|$)|cookie|token|credentials?|runtime|tmp|coverage|.*\.log$)/i;
const failures = [];
for (const name of packages) {
  const directory = join(root, 'packages', name);
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: directory, encoding: 'utf8'});
  if (result.status !== 0) {
    failures.push(`${name}: npm pack --dry-run failed\n${result.stderr || result.stdout}`);
    continue;
  }
  let records;
  try {
    records = JSON.parse(result.stdout.trim());
  } catch (error) {
    failures.push(`${name}: npm pack JSON output could not be parsed: ${error.message}`);
    continue;
  }
  const files = records[0]?.files?.map(file => file.path).sort() ?? [];
  const unsafe = files.filter(file => forbidden.test(file));
  if (unsafe.length) failures.push(`${name}: forbidden files in tarball: ${unsafe.join(', ')}`);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  // npm automatically includes a package CHANGELOG when Changesets later creates it.
  const requiredFiles = new Set(['package.json', ...manifest.files]);
  const expected = new Set([...requiredFiles, 'CHANGELOG.md']);
  for (const file of files) if (!expected.has(file)) failures.push(`${name}: file outside the exact allowlist: ${file}`);
  for (const required of requiredFiles) {
    if (!files.includes(required)) failures.push(`${name}: tarball is missing ${required}`);
  }
  console.log(`${manifest.name}@${manifest.version}: ${files.length} files`);
  for (const file of files) console.log(`  - ${file}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
