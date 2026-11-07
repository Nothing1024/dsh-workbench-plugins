import {writeFile} from 'node:fs/promises';
import {createOvisProxy} from './proxy.mjs';
import {readHerdrPrefs, resolveHerdrConfig} from './prefs.mjs';

/** 启动本机 Ovis 代理；显式配置优先，否则读取用户偏好与启动环境变量。 */
export function apply(ctx, preferences) {
  return ctx.inject(['webServer'], async child => {
    const defaults = {parentOrigin:child.webServer.getOrigin()};
    const prefs = preferences ? {...defaults, ...preferences} : await readHerdrPrefs(defaults);
    const config = resolveHerdrConfig(prefs, preferences ? {} : process.env);
    const proxy = createOvisProxy({
      upstreamOrigin: config.upstreamOrigin,
      parentOrigin: config.parentOrigin,
      port: config.proxyPort,
    });
    child.effect(() => () => proxy.close());
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
  });
}
