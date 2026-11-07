import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const authFile = config => resolve(config.cookieFile ?? join(homedir(), '.dsh', 'grokbot', 'cookie.txt'));

export function normalizeManualAuth(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写 Grok Cookie 或 SSO 值。');
  if (Buffer.byteLength(value) > 32 * 1024 || /[\x00-\x1f\x7f]/.test(value.trim())) throw new Error('Auth 格式无效或内容过长。');
  let cookie = value.trim().replace(/^cookie:\s*/i, '');
  if (/^[A-Za-z0-9._~+/-]+={0,2}$/.test(cookie)) cookie = 'sso=' + cookie;
  if (!cookie.split(';').some(part => /^(?:sso|sso-rw)=\S+$/.test(part.trim()))) {
    throw new Error('请填写包含 sso 或 sso-rw 的 Cookie，或单独填写 SSO 值。');
  }
  return cookie;
}

export async function hasManualAuth(config = {}) {
  try { return !!normalizeManualAuth(await readFile(authFile(config), 'utf8')); }
  catch { return false; }
}

export async function saveManualAuth(value, config = {}) {
  const cookie = normalizeManualAuth(value);
  const file = authFile(config);
  await mkdir(dirname(file), {recursive:true, mode:0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, cookie + '\n', {mode:0o600, flag:'wx'});
    await rename(temporary, file);
  } finally { await rm(temporary, {force:true}); }
}

export async function removeManualAuth(config = {}) {
  await rm(authFile(config), {force:true});
}
