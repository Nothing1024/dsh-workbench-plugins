#!/usr/bin/env node
// Install a selected plugin combination into an explicitly named DSH profile.
// This script never selects or edits a profile by default: --profile is required.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirs = {
  sources: 'workbench-sources',
  herdr: 'herdr-live',
  grok: 'grok-workbench',
};
const combinations = {
  both: ['sources', 'herdr', 'grok'],
  herdr: ['sources', 'herdr'],
  grok: ['sources', 'grok'],
  // Kept as a small compatibility convenience for source-only debugging.
  sources: ['sources'],
};
const usage = `用法：
  node scripts/install.mjs --source local|npm <both|herdr|grok> --profile <name> [--dry-run]

选项：
  --source local|npm  local 默认使用仓库内 packages/*；npm 使用包名@版本
  --profile <name>   必填；不会默认选择或修改任何 DSH profile
  --version <ver>    npm 来源的版本，默认读取三个包的当前版本（0.1.0）
  --dry-run           只打印命令，不调用 dsh
`;

function fail(message) {
  console.error(`安装脚本：${message}`);
  console.error(usage);
  process.exitCode = 2;
}

function readManifest(key) {
  const directory = resolve(root, 'packages', packageDirs[key]);
  return JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
}

function parseArgs(argv) {
  let source = 'local';
  let combo;
  let profile;
  let version = process.env.DSH_WORKBENCH_PLUGINS_VERSION;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const readValue = flag => {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} 需要一个值`);
      return value;
    };
    if (arg === '--source') source = readValue('--source');
    else if (arg.startsWith('--source=')) source = arg.slice('--source='.length);
    else if (arg === '--profile') profile = readValue('--profile');
    else if (arg.startsWith('--profile=')) profile = arg.slice('--profile='.length);
    else if (arg === '--version') version = readValue('--version');
    else if (arg.startsWith('--version=')) version = arg.slice('--version='.length);
    else if (arg.startsWith('--')) throw new Error(`未知选项：${arg}`);
    else if (combo === undefined) combo = arg;
    else throw new Error(`多余参数：${arg}`);
  }
  combo ||= 'both';
  if (!Object.hasOwn(combinations, combo)) throw new Error(`组合必须是 both、herdr 或 grok（也可用 sources），收到：${combo}`);
  if (!['local', 'npm'].includes(source)) throw new Error(`--source 必须是 local 或 npm，收到：${source}`);
  if (!profile) throw new Error('--profile 是必填项；脚本不会默认修改 web 或其它 profile');
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) throw new Error('--profile 只能包含 ASCII 字母、数字、下划线和连字符');
  if (version !== undefined && !/^(?:0|[1-9]\d*)(?:\.\d+){2}(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`npm 来源需要明确的 semver 版本，例如 0.1.0；收到：${version ?? '(空)'}`);
  }
  return {source, combo, profile, version, dryRun};
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function specFor(key, source, version) {
  const manifest = readManifest(key);
  if (source === 'npm') return `${manifest.name}@${version ?? manifest.version}`;
  return pathToFileURL(resolve(root, 'packages', packageDirs[key])).href;
}

if (process.argv.slice(2).some(arg => arg === '--help' || arg === '-h')) {
  console.log(usage);
  process.exit(0);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (!options) process.exit();

const keys = combinations[options.combo];
console.log(`安装组合：${options.combo}；来源：${options.source}；profile：${options.profile}`);
console.log(options.dryRun ? '模式：dry-run（不会调用 dsh）' : '模式：执行；只会操作上面明确指定的 profile');
const args = ['plugin', '--profile', options.profile, 'add', ...keys.map(key => specFor(key, options.source, options.version))];
console.log(`$ ${['dsh', ...args].map(shellQuote).join(' ')}`);
if (!options.dryRun) {
  const result = spawnSync('dsh', args, {cwd: root, stdio: 'inherit'});
  if (result.error) {
    console.error(`无法启动 dsh：${result.error.message}`);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    console.error(`dsh 安装失败，退出码：${result.status ?? 1}`);
    process.exitCode = result.status ?? 1;
  }
}
if (!process.exitCode) console.log(options.dryRun ? '计划已生成；没有修改任何 profile。' : '完成。请重启对应 DSH 窗口；不要和 *-ui-opt 预览包同时安装。');
