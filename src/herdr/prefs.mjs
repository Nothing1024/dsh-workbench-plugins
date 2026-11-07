import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {mkdir, readFile, writeFile} from 'node:fs/promises';

export const PREFS_PATH = process.env.DSH_HERDR_PREFS_FILE
  ? resolve(process.env.DSH_HERDR_PREFS_FILE)
  : join(homedir(), '.dsh', 'herdr-live', 'prefs.json');

export const DEFAULTS = {
  upstreamOrigin: 'http://127.0.0.1:7317',
  parentOrigin: 'http://127.0.0.1:50759',
  proxyPort: 50760,
};

export function loopbackOrigin(value, label = 'origin') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.href.includes('@') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} 必须是 HTTP 回环地址，例如 http://127.0.0.1:7317`);
  }
  return url;
}

export function sanitizeHerdrPrefs(raw = {}) {
  const prefs = {...DEFAULTS};
  if (raw && typeof raw === 'object') {
    if (raw.upstreamOrigin) prefs.upstreamOrigin = loopbackOrigin(raw.upstreamOrigin, 'Ovis / Herdr 接入地址').origin;
    if (raw.parentOrigin) prefs.parentOrigin = loopbackOrigin(raw.parentOrigin, 'DSH 父页面地址').origin;
    const port = Number(raw.proxyPort);
    if (Number.isInteger(port) && port > 0 && port <= 65535) prefs.proxyPort = port;
    if (raw.frameOrigin) prefs.frameOrigin = loopbackOrigin(raw.frameOrigin, '代理 / iframe 地址').origin;
  }
  if (!prefs.frameOrigin) prefs.frameOrigin = `http://127.0.0.1:${prefs.proxyPort}`;
  return prefs;
}

export async function readHerdrPrefs(defaults = {}) {
  try {
    return sanitizeHerdrPrefs({...defaults, ...JSON.parse(await readFile(PREFS_PATH, 'utf8'))});
  } catch {
    return sanitizeHerdrPrefs(defaults);
  }
}

export async function writeHerdrPrefs(patch) {
  const next = sanitizeHerdrPrefs({...await readHerdrPrefs(), ...patch});
  await mkdir(dirname(PREFS_PATH), {recursive: true, mode: 0o700});
  await writeFile(PREFS_PATH, JSON.stringify(next, null, 2) + '\n', {mode: 0o600});
  return next;
}

/** 环境变量在进程启动时覆盖已保存的偏好，方便预览脚本指定端口。 */
export function resolveHerdrConfig(prefs, env = process.env) {
  const merged = sanitizeHerdrPrefs({
    ...prefs,
    upstreamOrigin: env.DSH_HERDR_UPSTREAM || prefs.upstreamOrigin,
    parentOrigin: env.DSH_HERDR_PARENT_ORIGIN || prefs.parentOrigin,
    proxyPort: env.DSH_HERDR_PROXY_PORT ? Number(env.DSH_HERDR_PROXY_PORT) : prefs.proxyPort,
  });
  return merged;
}
