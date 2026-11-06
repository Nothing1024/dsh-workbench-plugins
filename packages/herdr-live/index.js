import {writeFile} from 'node:fs/promises';
import {createOvisProxy} from './proxy.mjs';
import {readHerdrPrefs, resolveHerdrConfig} from './prefs.mjs';

/** 启动本机 Ovis 门面代理。接入地址优先读 ~/.dsh/herdr-live/prefs.json，其次才是环境变量默认值。 */
export async function apply(ctx) {
  const prefs = await readHerdrPrefs();
  const config = resolveHerdrConfig(prefs, process.env);
  const proxy = createOvisProxy({
    upstreamOrigin: config.upstreamOrigin,
    parentOrigin: config.parentOrigin,
    port: config.proxyPort,
  });
  ctx.effect(() => () => proxy.close());
  const address = await proxy.listen();
  if (process.env.DSH_HERDR_PROXY_METADATA) {
    await writeFile(process.env.DSH_HERDR_PROXY_METADATA, JSON.stringify({
      ...address,
      pid: process.pid,
      implementation: 'native DSH project/terminal sidebar; original Ovis application and PTY with bounded selection adapter',
      startedAt: new Date().toISOString(),
    }, null, 2) + '\n', {mode: 0o600});
  }
  console.info(`Herdr: real Ovis facade ${address.origin} -> ${address.upstream}`);
}
