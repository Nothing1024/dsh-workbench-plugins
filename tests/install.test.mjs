import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8'});

test('installer refuses to choose a DSH profile implicitly', () => {
  const result = run(['both', '--source', 'local', '--dry-run']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--profile/);
  assert.doesNotMatch(result.stdout, /\$.*dsh/);
});

test('local installer plans each exact combination without executing DSH', () => {
  for (const [combo, directories] of Object.entries({both: ['workbench-sources', 'herdr-live', 'grok-workbench'], herdr: ['workbench-sources', 'herdr-live'], grok: ['workbench-sources', 'grok-workbench']})) {
    const result = run([combo, '--source=local', '--profile=offline-plan', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    const command = result.stdout.split('\n').find(line => line.startsWith('$ '));
    for (const directory of directories) assert.ok(command.includes(pathToFileURL(resolve(root, 'packages', directory)).href), command);
    assert.equal((command.match(/file:/g) || []).length, directories.length);
    assert.match(result.stdout, /没有修改任何 profile/);
  }
});

test('npm installer reads the default package version and honors an explicit version', () => {
  const result = run(['grok', '--source', 'npm', '--profile', 'offline-plan', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dsh-plugin-workbench-sources@0\.1\.0/);
  assert.match(result.stdout, /dsh-plugin-grok-workbench@0\.1\.0/);
  assert.doesNotMatch(result.stdout, /dsh-plugin-herdr-live@/);
  const override = run(['herdr', '--source', 'npm', '--version', '0.2.0-beta.1', '--profile', 'offline-plan', '--dry-run']);
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /dsh-plugin-herdr-live@0\.2\.0-beta\.1/);
});

test('invalid source, profile, combination and incomplete arguments fail before commands', () => {
  for (const args of [
    ['other', '--profile', 'offline-plan'],
    ['both', '--source', 'remote', '--profile', 'offline-plan'],
    ['both', '--profile', '../web'],
    ['both', '--profile', '--dry-run'],
    ['both', '--source', 'npm', '--version', 'latest', '--profile', 'offline-plan'],
    ['both', '--unknown', '--profile', 'offline-plan'],
  ]) {
    const result = run([...args, '--dry-run']);
    assert.equal(result.status, 2, args.join(' '));
    assert.doesNotMatch(result.stdout, /\$.*dsh/);
  }
});
