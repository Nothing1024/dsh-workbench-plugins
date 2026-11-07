#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const usage = `用法：
  node scripts/install.mjs --source local|npm --profile <name> [--version <ver>] [--dry-run]
安装一个工作台插件，默认启用 DSH 会话、Herdr 和 Grok。
--source 默认 local；--profile 必填；--dry-run 只打印命令。
`;
function parseArgs(argv) {
  const options = {source:'local', version:process.env.DSH_WORKBENCH_PLUGINS_VERSION, dryRun:false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    const match = /^(--source|--profile|--version)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`未知参数：${arg}`);
    const value = match[2] ?? argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${match[1]} 需要一个值`);
    options[match[1].slice(2)] = value;
  }
  if (!options.profile) throw new Error('--profile 是必填项；不会默认选择任何 DSH profile');
  if (!/^[A-Za-z0-9_-]+$/.test(options.profile)) throw new Error('--profile 只能包含 ASCII 字母、数字、下划线和连字符');
  if (!['local', 'npm'].includes(options.source)) throw new Error('--source 必须是 local 或 npm');
  if (options.version !== undefined && !/^(?:0|[1-9]\d*)(?:\.\d+){2}(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) throw new Error('--version 需要明确版本，例如 0.1.0');
  return options;
}
if (process.argv.slice(2).some(arg => ['--help', '-h'].includes(arg))) { console.log(usage); process.exit(0); }
let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (error) { console.error(error.message + '\n' + usage); process.exit(2); }
const spec = options.source === 'local' ? pathToFileURL(root).href : `${manifest.name}@${options.version ?? manifest.version}`;
const args = ['plugin', '--profile', options.profile, 'add', spec];
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
console.log(`工作台：${manifest.name}；来源：${options.source}；profile：${options.profile}`);
console.log('$ ' + ['dsh', ...args].map(quote).join(' '));
if (options.dryRun) console.log('计划已生成；没有修改任何 profile。');
else {
  if (options.source === 'local' && !existsSync(resolve(root, 'dist/client.js'))) { console.error('本地客户端尚未构建，请先运行 npm run build。'); process.exit(1); }
  const result = spawnSync('dsh', args, {cwd:root, stdio:'inherit'});
  if (result.error) { console.error(`无法启动 dsh：${result.error.message}`); process.exitCode = 1; }
  else if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log('请重启对应 DSH 窗口，三个来源默认全部开启。');
}
