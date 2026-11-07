# DSH 工作台插件

`dsh-plugin-workbench-suite` 把 DSH 会话、Herdr / Ovis 和 Grok bot 放在同一条来源栏里。安装一个包，三个来源默认全部开启，使用同一个版本更新。

当前版本为 0.1.0，尚未发布到 npm；许可证、完整第三方版权通知、npm 账号和正式仓库地址仍待确认。

## 安装

运行环境：Node.js 22.4+、可用的 DSH CLI 及其 pnpm。开发构建推荐 Node.js 24 和 npm 10.9+。加载验证依据 DSH 0.2.1-rc.5。

正式发布后，使用一条命令安装：

```bash
dsh plugin --profile workbench-demo add dsh-plugin-workbench-suite@0.1.0
```

安装后重启对应 DSH 窗口。来源栏默认显示「DSH 会话」「Herdr」「Grok bot」。Herdr 的本机代理随插件启动；Ovis 服务尚未启动时，Herdr 页面会显示离线。Grok 在用户打开对应来源后读取列表，不会在插件激活时登录或发送消息。

## 目录与接口

```text
index.js                  DSH 宿主启动入口
cordis.patch.yml          唯一插件启用声明
src/
  client.js               工作台浏览器入口，组合三个内部模块
  sources/client.js       来源栏、DSH 会话标签和显示偏好
  herdr/
    index.js              启动本机代理
    client.js             Herdr 侧栏和 Ovis 页面
    proxy.mjs             HTTP / WebSocket 转发与接入配置
    sidebar-channel.mjs   项目、标签和终端管理
    embed-bridge.js       页面选择同步
    prefs.mjs             接入地址与端口偏好
  grok/
    index.js              注册 Grok 服务
    client.js             机器人列表、对话和上传界面
    service.mjs           已认证的 DSH 路由
    auth.js               用户凭据读取与缓存
    relay.js              Grok 连接与命令
    web.js                机器人、分组与历史数据处理
dist/client.js            构建出的单个浏览器模块
scripts/                  构建、安装、检查与打包验证
tests/                    离线测试
docs/                     安装和发布说明
```

包根目录导出 `apply(ctx, config)`；`./client` 指向构建后的浏览器模块。内部模块通过相对引用组合，没有工作台相关的 npm 依赖或 peer 依赖。React、ReactDOM 和 DSH 界面服务由宿主提供。

| 功能 | 位置 / 接口 |
|---|---|
| 来源栏 | `src/sources/`；内部共享 `SOURCE_TAB_SLOT` 和 `SourceTab` |
| Herdr | `src/herdr/`；`/__dsh_herdr/` 下的健康、配置、会话、事件与管理接口 |
| Grok | `src/grok/`；`/__dsh_grok/api/` 下的机器人、对话、上传与认证接口 |

## 设置与用户数据

设置页保留「工作台来源」「Herdr」「Grok bot」三个分区，它们属于同一个插件。

- 工作台来源：DSH 会话标签显示与顺序；偏好保存在浏览器 localStorage。
- Herdr：Ovis URL、代理端口、DSH 父页面地址、测试连接和保存。默认上游为 `http://127.0.0.1:7317`，代理端口为 `50760`；父页面地址需设为实际 DSH 地址。修改代理端口后需要重启。
- Grok bot：检测、重新加载和清除用户的本地会话缓存，打开 grok.com 登录页；界面不展示 cookie 内容。

Herdr 偏好保存在 `~/.dsh/herdr-live/prefs.json`；`DSH_HERDR_UPSTREAM`、`DSH_HERDR_PARENT_ORIGIN`、`DSH_HERDR_PROXY_PORT` 可在启动时覆盖默认偏好。Grok 使用用户自己的显式配置、环境变量、cookie 文件或可调试浏览器会话。仓库和 npm 包不包含这些用户数据。

## 本地开发

```bash
npm ci --ignore-scripts
npm run build
node scripts/install.mjs --source local --profile workbench-demo --dry-run
node scripts/install.mjs --source local --profile workbench-demo
```

`--profile` 必填，安装器不会默认选择在用的 profile。`--source npm` 使用包名加版本；`--version` 可指定版本，默认读取 package.json。已装旧三包的 profile 应先移除旧工作台包，再安装本包，避免重复界面和端口冲突。安装器不会自动卸载旧包。

修改 `src/` 后运行 `npm run build`，再重新安装本地插件并重启。构建把三个界面模块组合成一个 DSH 浏览器模块；npm 用户安装已构建的内容。

## 检查和版本

```bash
npm run check
npm test
npm run pack:dry-run
npm run verify:install
npm run changeset -- status
```

`verify:install` 使用独立目录验证 tarball 安装、公开宿主入口、浏览器入口和默认服务启动。测试仅使用假账号和本机临时服务。可传 `-- --dsh-anchor /绝对路径/@deepseek-ai/dsh/package.json` 增加真实 DSH 安装与模块加载器验证，不操作在用 profile。

Changesets 只管理这一个包。`npm run version:packages` 会更新版本和 changelog；正式发布命令为 `npm run release:publish`。CI 只做构建、测试和打包检查。

## 当前范围

附件资源库和历史附件专用预览尚未接入。当前使用已有 URL / payload 展示历史附件。真实账号操作和真实 Ovis 页面交互需在用户自己的环境中确认。

安装细节见 [安装与契合](docs/安装与契合.md)，发布待补信息见 [发布准备](docs/发布准备.md)，本地检查结果见 [验证结果](docs/验证结果.md)。
