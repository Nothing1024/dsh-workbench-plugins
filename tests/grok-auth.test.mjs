import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const source = fs.readFileSync(new URL('../src/grok/auth.js', import.meta.url), 'utf8');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-grok-auth-'));
  t.after(() => fs.rmSync(home, {recursive:true, force:true}));
  const f = {home, browserReads:0, account:'account-a'};
  const profile = path.join(home, 'browser');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '12345\n/devtools/browser/fixture');
  f.profile = profile;
  f.cacheFile = path.join(home, '.dsh/grokbot/cookie.cache.json');
  class BrowserSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(data) {
      const {id} = JSON.parse(data);
      f.browserReads++;
      const result = {cookies:[{name:'sso', value:'synthetic-' + f.account, domain:'.grok.com'}]};
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({id, result})})));
    }
    close() {}
  }
  // Keep the actual auth logic; replace only its imports and external resources.
  const code = source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({
    fs, os:{homedir:() => home}, path, randomUUID,
    process:{env:{}, platform:process.platform, pid:process.pid},
    WebSocket:BrowserSocket, setTimeout, clearTimeout,
  });
  vm.runInContext(code + '\nthis.auth = {resolveCookie, invalidateCookieCache};', context);
  f.resolve = options => context.auth.resolveCookie(options);
  f.invalidate = options => context.auth.invalidateCookieCache(options);
  f.writeCookie = (filename, account) => {
    const file = path.join(home, filename);
    fs.writeFileSync(file, 'sso=synthetic-' + account + '; x-userid=' + account, {mode:0o600});
    return file;
  };
  f.fromBrowser = options => f.resolve({cookieFile:path.join(home, 'missing.txt'), profileDirs:[profile], ...options});
  return f;
}

test('selecting another cookie file uses that account and rereads changed file contents', async t => {
  const f = fixture(t);
  const a = f.writeCookie('account-a.txt', 'account-a');
  const b = f.writeCookie('account-b.txt', 'account-b');
  const options = {profileDirs:[], cacheCookie:false};
  assert.match((await f.resolve({...options, cookieFile:a})).header, /x-userid=account-a/);
  assert.match((await f.resolve({...options, cookieFile:b})).header, /x-userid=account-b/);
  f.writeCookie('account-b.txt', 'account-c');
  assert.match((await f.resolve({...options, cookieFile:b})).header, /x-userid=account-c/);
  assert.equal(f.browserReads, 0);
});

test('browser memory cache is reused only for the same source and cache policy', async t => {
  const f = fixture(t);
  assert.match((await f.fromBrowser()).header, /synthetic-account-a/);
  f.account = 'account-b';
  assert.match((await f.fromBrowser()).header, /synthetic-account-a/);
  assert.equal(f.browserReads, 1);
  assert.match((await f.fromBrowser({cacheCookie:false})).header, /synthetic-account-b/);
  const otherProfile = path.join(f.home, 'other-browser');
  fs.mkdirSync(otherProfile);
  fs.writeFileSync(path.join(otherProfile, 'DevToolsActivePort'), '12346\n/devtools/browser/fixture');
  f.account = 'account-c';
  assert.match((await f.fromBrowser({profileDirs:[otherProfile], cacheCookie:false})).header, /synthetic-account-c/);
  assert.equal(f.browserReads, 3);
});

test('refreshing a permissive cache replaces it with a private file', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.cacheFile), {recursive:true, mode:0o700});
  fs.writeFileSync(f.cacheFile, '{}', {mode:0o644});
  fs.chmodSync(f.cacheFile, 0o644);
  await f.fromBrowser();
  assert.equal(fs.statSync(f.cacheFile).mode & 0o777, 0o600);
  assert.match(JSON.parse(fs.readFileSync(f.cacheFile, 'utf8')).header, /synthetic-account-a/);
  assert.deepEqual(fs.readdirSync(path.dirname(f.cacheFile)), ['cookie.cache.json']);
});

test('refreshing a symlink cache does not write credentials into its target', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.cacheFile), {recursive:true, mode:0o700});
  const target = path.join(f.home, 'unrelated.txt');
  fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, f.cacheFile);
  await f.fromBrowser();
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  assert.equal(fs.lstatSync(f.cacheFile).isSymbolicLink(), false);
  assert.equal(fs.statSync(f.cacheFile).mode & 0o777, 0o600);
});

test('disabling disk caching leaves the filesystem untouched', async t => {
  const f = fixture(t);
  assert.match((await f.fromBrowser({cacheCookie:false})).header, /synthetic-account-a/);
  assert.equal(fs.existsSync(f.cacheFile), false);
});

test('cache invalidation respects a disabled disk cache', async t => {
  const f = fixture(t);
  await f.fromBrowser();
  const original = fs.readFileSync(f.cacheFile, 'utf8');
  f.invalidate({cacheCookie:false});
  assert.equal(fs.readFileSync(f.cacheFile, 'utf8'), original);
  f.invalidate();
  assert.equal(fs.existsSync(f.cacheFile), false);
});
