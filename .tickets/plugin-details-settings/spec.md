# 插件详情页设置 Spec

> Version: 0.1.0 | Date: 2026-11-07 | Status: Done | Board: tickets

## 0. 一页纸人话摘要

- 给使用工作台插件的用户，在 DSH 插件列表点开本插件后配置来源、Herdr 与 Grok Auth。
- 现有表单和保存方式继续使用，只迁移展示位置与打开设置的入口。
- 一个合并插件贡献一个配置区域，内部按三个来源组织。
- 侧边栏的设置按钮直接打开本插件详情页。
- 不修改在用的 DSH profile，不连接真实 Grok 账号，不发布包。

## 1. 事实基线

### 1.1 需求来源与置信度
用户指出 DSH 插件详情页已有专门设置区域，并要求修改。置信度高。仓库在基线 4bc090c 无未提交改动；执行环境为本机 Codex。

### 1.2 任务类型与验收重点
frontend / bugfix：配置区域注册、真实插件页入口、保存错误保留输入及导航、卸载资源清理。

### 1.3 已验证事实

| 事实 | 来源命令 | 输出摘要 |
|---|---|---|
| 三个模块注册在内置插件标签页 | `rg -n settings.plugins.tab src` | 三处注册 |
| DSH 支持按组合包名配置 | 阅读本机 DSH ui-plugin-manager 的 README.zh.md 与 slot-contract.d.ts | plugins.bundle.config keyed slot |
| DSH 提供打开组合包的服务 | 阅读 ui-plugin-manager 的 index.d.ts 与 client.js | pluginNavigation.openBundle |
| 原有测试没有检查设置位置 | `node --test tests/workbench.test.mjs` | 添加入口断言后，0 不等于 1，预期失败 |

### 1.4 假设清单
无阻塞假设；真实 UI 使用独立临时 DSH profile 和模拟 Auth。

### 1.5 变更记录
2026-11-07：按用户确认迁移配置位置，保留现有表单与保存接口。

## 2. 业务合同

### 2.1 BR 业务规则

| 规则 ID | 规则 | 正例 | 反例 | 验证 |
|---|---|---|---|---|
| BR-001 | 本插件详情页有一个配置区域，容纳三个设置分区 | 点开本插件即可切换 Grok、Herdr、工作台来源 | 配置出现在内置清单或仅弹窗 | 客户端注册测试与浏览器 |
| BR-002 | 两个业务面板的设置入口打开本插件详情页 | Grok 或 Herdr 点击设置后看到插件详情与配置 | 进入全局设置的内置插件分区 | 浏览器与导航测试 |
| BR-003 | 原有设置读写沿用 | Auth 保存后清空、移除后无手动配置 | 浏览器保存 Auth 原文 | 既有回归与浏览器 |

### 2.2 UF 用户验收场景（索引）

| 场景 ID | Given | When | Then | 验证 | Evidence |
|---|---|---|---|---|---|
| UF-001 | 合并插件已启用 | 插件列表点开本插件 | 看到三个分区并配置 Auth | 浏览器 | EVD-002 |
| UF-002 | 在 Grok 或 Herdr 面板 | 点击插件设置 | 进入同一插件详情页 | 浏览器 | EVD-002 |

### 2.3 核心业务流程（步骤级交互脚本）

#### UF-001：从列表打开设置
前置状态：独立临时 profile 已启用插件。

| 步骤 | 用户动作 | 界面即时反馈 | 系统行为 | 用户看到的结果 |
|---|---|---|---|---|
| 1 | 侧栏点击插件并打开本插件 | 展示详情 | 渲染 bundle config | 三个设置分区 |
| 2 | 切换到 Grok bot 并填写模拟 Auth | 密码输入 | 沿用现有保存接口 | 保存后输入清空 |
| 3 | 离开再进入并移除手动 Auth | 显示来源与移除反馈 | 沿用删除接口 | 无手动配置 |

失败分支：
- 无效 Auth：显示错误，保留输入；修改后重试。
- 设置请求失败：显示原有错误，不退出插件详情页；恢复服务后重试。

界面状态机：列表 → 详情 → 工作台来源 / Herdr / Grok bot → 保存中 → 成功 / 错误 → 可重试。
入口接线清单：侧栏插件、组合包卡片、三个分区控件、Auth 保存和移除。

#### UF-002：从业务面板打开设置
前置状态：插件已加载，业务面板可打开。

| 步骤 | 用户动作 | 界面即时反馈 | 系统行为 | 用户看到的结果 |
|---|---|---|---|---|
| 1 | Grok 更多菜单点插件设置 | 切换主页面 | openBundle 定位本插件 | 同一配置区域 |
| 2 | 返回 Herdr 并点插件设置 | 切换主页面 | 同一导航服务 | 同一配置区域 |

失败分支：
- 缺少插件管理器：现有业务设置弹窗仍可打开，不进入内置清单。
- 插件被停用：配置注册与监听释放，不保留可写页面。

界面状态机：业务面板 → 本插件详情；管理器不可用 → 原有设置弹窗。
入口接线清单：Grok 更多菜单、账号与会话设置、Herdr 设置按钮。

### 2.4 INV 不变量

| 不变量 ID | 内容 | 关联 | 验证 |
|---|---|---|---|
| INV-001 | 一个 npm 包，三个来源默认开启，既有业务和 Auth 权限不变 | BR-001, BR-003 | 全量回归与安装检查 |

### 2.5 EVD 证据清单

| 证据 ID | 类型 | 期望证据 | 保存位置 |
|---|---|---|---|
| EVD-001 | test | 注册和导航检查 | `evidence/T-001/result.log` |
| EVD-002 | screenshot/log | 官方 DSH 插件详情页与保存回放 | `evidence/browser/result.log` |
| EVD-003 | test/log | 全量测试、打包与安装 | `evidence/final/checks.log` |

### 2.6 角色与权限矩阵
只使用独立测试 profile；沿用 DSH 登录与同源写入约束。

### 2.7 负向场景
注册不应重复；关闭后清理；无效 Auth 不退出配置；Auth 原文不出现在响应或 localStorage。

### 2.8 非目标
不修改真实账号、在用 profile、发布身份、LICENSE 或已知的 Herdr 端口保存问题。

## 3. 技术方案

### 3.1 架构 Before / After
Before：三个 settings.plugins.tab 和打开全局内置插件分区。
After：单个 plugins.bundle.config，复用三个 SettingsPanel；导航使用 pluginNavigation.openBundle。

### 3.2 模块改造
浏览器组合入口负责合并配置；模块导出原有表单；共享来源模块提供导航；清单注入插件管理器。

### 3.3 三段式定位清单

| 文件 | 稳定定位 | 搜索定位 | 行号 hint | 备注 |
|---|---|---|---|---|
| src/client.js | factory | `rg "factory" src/client.js` | L7 | 组合设置 |
| src/grok/client.js | createGrokClient | `rg "createGrokClient" src/grok/client.js` | L67 | 替换入口 |
| src/herdr/client.js | createHerdrClient | `rg "createHerdrClient" src/herdr/client.js` | L32 | 替换入口 |
| src/sources/client.js | SettingsPanel | `rg "SettingsPanel" src/sources/client.js` | L81 | 复用表单与共享导航 |

### 3.4 API / 数据 / 权限 / 路由影响
不更改服务端接口与凭据格式；只更改浏览器注册和导航、DSH 客户端依赖声明。

## 4. Ticket map 与执行顺序

- [T-001](tickets/T-001.md)：实现与定向验证。
- [T-002](tickets/T-002.md)：依赖 T-001 的真实场景。
- [T-003](tickets/T-003.md)：依赖 T-002 的最终回归。
最后阶段按 real-run → final-regression 执行。

## 5. 验收与 Review 协议

### 5.1 命令级验证
`npm run check`、`npm test`、`npm run pack:dry-run`、`npm run verify:install`，结果写 EVD-001 与 EVD-003。

### 5.2 真实场景全套测试
环境准备：创建独立临时 DSH_HOME 和 web 模板 profile，安装本仓库；模拟 Auth、专用 cookieFile 和代理端口。启动命令：`dsh --profile settings-verify --no-open --port 0`。访问入口：其本机启动 URL。工具：ego-browser。原有在用 profile 不改动。

| UF | 执行方式 | 操作来源 | 核对点 | Evidence |
|---|---|---|---|---|
| UF-001, UF-002 | browser | 2.3 节 | 官方插件详情页、三个分区、保存和两个入口 | `evidence/browser/result.log` |

### 5.3 Evidence
实现日志存 T-001；真实页面截图与安全日志存 browser；全量回归存 final。

### 5.4 Review
逐条核对合同；没有未处理的 P0/P1 问题再设 Done；实际 DSH 页面必须有截图。
