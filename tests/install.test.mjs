import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [script, ...args], {cwd:root, encoding:'utf8'});
test('installer refuses to choose a DSH profile implicitly', () => {
  const result = run(['--source', 'local', '--dry-run']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--profile/);
  assert.doesNotMatch(result.stdout, /\$.*dsh/);
});
test('local installer plans exactly one package without executing DSH', () => {
  const result = run(['--source=local', '--profile=offline-plan', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const command = result.stdout.split('\n').find(line => line.startsWith('$ '));
  assert.ok(command.includes(pathToFileURL(root.replace(/\/$/, '')).href), command);
  assert.equal((command.match(/file:/g) || []).length, 1);
  assert.match(result.stdout, /没有修改任何 profile/);
});
test('npm installer plans the single package version and honors an explicit version', () => {
  const result = run(['--source', 'npm', '--profile', 'offline-plan', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dsh-plugin-workbench-suite@0\.1\.0/);
  const override = run(['--source', 'npm', '--version', '0.2.0-beta.1', '--profile', 'offline-plan', '--dry-run']);
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /dsh-plugin-workbench-suite@0\.2\.0-beta\.1/);
});
test('invalid source, profile, positional arguments and incomplete values fail before commands', () => {
  for (const args of [
    ['both', '--profile', 'offline-plan'],
    ['--source', 'remote', '--profile', 'offline-plan'],
    ['--profile', '../web'],
    ['--profile', '--dry-run'],
    ['--source', 'npm', '--version', 'latest', '--profile', 'offline-plan'],
    ['--unknown', '--profile', 'offline-plan'],
  ]) {
    const result = run([...args, '--dry-run']);
    assert.equal(result.status, 2, args.join(' '));
    assert.doesNotMatch(result.stdout, /\$.*dsh/);
  }
});
