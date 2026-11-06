# DSH 工作台插件

把 DSH 会话、Herdr / Ovis 和 Grok bot 放到同一条工作台来源栏。三个包均为原生 ESM，浏览器入口使用 DSH 的 `__ModuleLoader__`，不需要额外构建。

| 包 | 初始版本 | 职责 |
| --- | --- | --- |
| `dsh-plugin-workbench-sources` | 0.1.0 | 来源栏薄壳，只注册「DSH 会话」；浏览器模块导出 `SOURCE_TAB_SLOT` / `SourceTab` |
| `dsh-plugin-herdr-live` | 0.1.0 | Herdr 项目 / 终端侧栏、Ovis iframe、本机代理与桥接 |
| `dsh-plugin-grok-workbench` | 0.1.0 | Grok 机器人列表、对话、附件上传与会话设置 |

Herdr 和 Grok 都把来源壳声明为必需的 `peerDependencies`，共用同一份来源栏。Grok 不依赖 Herdr。React、ReactDOM 与官方 DSH UI 插件由宿主提供，不随本包再安装一份。

当前是发布准备版本：尚未执行 npm publish；仓库地址、npm 账号 / scope、许可证和公开范围仍待确认。`repository` / `homepage` 中的 `REPLACE_ME` 与 `LICENSE` 必须在正式发布前替换。

## 安装

运行插件需要 Node.js 22.4+、可用的 `dsh` CLI 及其 pnpm。开发工具 Changesets 3 要求 Node.js 22.11 / 24 / 26+ 和 npm 10.9+，建议使用 Node.js 24。当前加载契约依据本机 DSH `0.2.1-rc.5` 核对；运行验证使用 Node.js 24。本仓库不会自行修改你的现有 profile。安装脚本必须显式传 `--profile`；以下使用独立的 `workbench-demo`，也可以换成你决定使用的 profile。

先进入仓库根目录。默认来源为 `local`，默认组合为 `both`。三种组合：

| 组合 | 安装包 | 来源标签 |
| --- | --- | --- |
| `both` | 来源壳 + Herdr + Grok | DSH 会话 / Herdr / Grok bot |
| `herdr` | 来源壳 + Herdr | DSH 会话 / Herdr |
| `grok` | 来源壳 + Grok | DSH 会话 / Grok bot |

本地 `file:` 安装：

```bash
node scripts/install.mjs both --source local --profile workbench-demo --dry-run
node scripts/install.mjs both --source local --profile workbench-demo
node scripts/install.mjs herdr --source local --profile workbench-demo
node scripts/install.mjs grok --source local --profile workbench-demo
```

npm 安装（需要先完成正式发布，当前无法从 registry 安装这些尚未发布的包）：

```bash
node scripts/install.mjs both --source npm --profile workbench-demo --version 0.1.0 --dry-run
node scripts/install.mjs both --source npm --profile workbench-demo --version 0.1.0
node scripts/install.mjs herdr --source npm --profile workbench-demo --version 0.1.0
node scripts/install.mjs grok --source npm --profile workbench-demo --version 0.1.0
```

脚本会先打印一条完整的 `dsh plugin --profile … add …` 命令，再调用 DSH。npm 版本默认读取各包当前版本，也可通过 `--version` 或 `DSH_WORKBENCH_PLUGINS_VERSION` 固定；不使用浮动 `latest`。`--dry-run` 只打印，不安装。不传 `--profile` 会直接报错。

安装组合只添加所列包，不会卸载其它包；例如在已装 both 的 profile 上再装 grok，不会自动移除 Herdr。装完重启对应 DSH 窗口。不要在同一 profile 混装 `*-ui-opt` 预览包。

## 设置

入口为 **设置 → 内置插件**。宿主槽位不可用时，Herdr 标题栏设置按钮 / Grok「更多 → 插件设置」提供插件内面板。

- **工作台来源**：显示「DSH 会话」标签、标签顺序；偏好保存在浏览器 localStorage。
- **Herdr**：Ovis URL（默认 `http://127.0.0.1:7317`）、代理端口（默认 `50760`）、DSH 父页面 origin、测试连接 / 保存 / 重连。父页面 origin 应填实际 DSH 地址，默认值沿用预览地址 `http://127.0.0.1:50759`。只接受本机 HTTP 回环地址；改代理端口后需要重启 DSH。
- **Grok bot**：检测 / 重新加载 / 清除本地会话缓存、打开 grok.com 登录页、中继状态。界面不会显示 cookie 值。

Herdr 偏好使用 `~/.dsh/herdr-live/prefs.json`；启动环境变量 `DSH_HERDR_UPSTREAM`、`DSH_HERDR_PARENT_ORIGIN`、`DSH_HERDR_PROXY_PORT` 优先。Grok 读取显式配置 / `GROK_COOKIE` / `GROK_SSO`、用户 cookie 文件、可调试浏览器、12 小时缓存。仓库不包含这些用户数据。

## 开发与检查

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run pack:dry-run
npm run verify:install
npm run changeset -- status
```

每包保留 `main`、`./client` 和 `./package.json` 导出。`dsh.bundle` 指向包内激活 patch；来源壳和两业务包必须作为相应组合启用。DSH 客户端的 `require('dsh-plugin-workbench-sources')` 查找浏览器模块表，不能替换成 Node 的主入口。详见 [安装与契合](docs/安装与契合.md)。

修改 JS / MJS 无须编译，但 DSH 的 `file:` 安装可能是快照：修改后重新安装并重启。测试使用本地假服务 / VM，不连接真实 Grok 账号，不写你的 DSH 配置。

版本管理使用 Changesets，三包在 fixed 组内共同递增，初始均为 `0.1.0`：

```bash
npm run changeset
npm run version:packages
```

第二条命令会实际改动版本与 changelog，提交前检查 diff。本次整理没有执行它，也未生成新的发布版本。GitHub Actions 草稿只运行检查、离线测试和 pack dry-run，没有发布、push 或建远端操作。发布前所需决定见 [发布准备](docs/发布准备.md)。

## 已知未完成

- grok.com 附件资源库（`attachUpload`）尚未接入。
- 历史附件没有专用预览代理；当前按已有 URL / payload 展示。
- 改代理端口需要重启 DSH。
- 许可证与第三方版权通知仍需最终确认。
