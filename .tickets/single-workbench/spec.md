# 合并工作台插件 Spec

> Version: 0.1.0 | Date: 2026-11-07 | Status: Done | Board: tickets

## 0. 一页纸人话摘要

给 DSH 工作台用户安装一个插件，同时使用 DSH 会话、Herdr 和 Grok。
三个来源默认开启，Herdr 本机代理随插件启动。
源码按来源栏、Herdr、Grok 三个目录分开，保留现有业务行为和凭据修复。
通过单包构建、安装、实际加载、回归和打包检查验收。
本次不修改原始接入目录，不发布 npm，不推送远端。

## 1. 事实基线

### 1.1 需求来源与置信度
用户要求把三个插件合并成一个，内部目录清晰，并明确三个来源默认开启。置信度高。
### 1.2 任务类型与验收重点
refactor 与 CLI packaging；改变包边界，保留业务界面与服务行为。没有新增页面。
### 1.3 已验证事实
`git status --short` 显示五个凭据修复相关文件未提交，需要一并保留。
`cat package.json` 与包清单确认现有三个 workspace；全部 99 项测试通过。
`cloud_board.py --check-access` 返回 2：仓库没有 origin，采用本地记录。
`npm view dsh-plugin-workbench-suite name version --json` 返回 E404；采用该暂定包名。
### 1.4 假设清单
首发保持 0.1.0，继续保留待确认许可证和仓库地址。发布操作不在本次范围。

## 2. 业务合同

### 2.1 BR 业务规则
| 规则 ID | 规则 | 正例 | 反例 | 影响范围 | 验证方式 |
|---|---|---|---|---|---|
| BR-001 | 一个包启用三个来源 | 单次安装产生一个插件入口和三个标签 | 还需要安装三个包 | 包入口 | 安装与浏览器入口验证 |
| BR-002 | 三个来源默认开启 | 启动代理并挂载 Grok 路由 | 默认隐藏 Herdr 或 Grok | 默认行为 | 启动验证 |
### 2.2 UF 用户验收场景（索引）
| 场景 ID | Given | When | Then | 角色 | 验证方式 | Evidence |
|---|---|---|---|---|---|---|
| UF-001 | 有独立临时 profile | 安装并加载单包 | 单个插件入口，三个来源可用 | 安装用户 | CLI + 服务请求 | EVD-001 |
### 2.3 核心业务流程（步骤级交互脚本）
#### UF-001: 安装和加载
1. 用户指定 profile；安装器打印单包命令。
2. 从 file 或 tarball 安装，DSH 读取唯一激活 patch。
3. 宿主入口启动 Herdr 代理并注册 Grok 路由，浏览器入口注册三个来源。
失败分支一：缺少 profile，安装器明确拒绝，不执行 DSH。
失败分支二：未知参数，安装器明确拒绝，不执行 DSH。
状态机：参数校验 → 打印计划 → 安装 → 启用；参数错误 → 退出。
入口接线清单：`scripts/install.mjs`、`index.js`、`src/client.js`、`cordis.patch.yml`。
### 2.4 INV 不变量
| 不变量 ID | 内容 | 关联 BR/UF | 验证方式 |
|---|---|---|---|
| INV-001 | 保留现有业务测试与凭据修复，不接触真实账号 | BR-001, UF-001 | 全量离线测试 |
| INV-002 | 不发布、不推送、不修改原始接入目录 | BR-002 | 操作记录和 git diff |
### 2.5 EVD 证据清单
| 证据 ID | 类型 | 期望证据 | 保存位置 |
|---|---|---|---|
| EVD-001 | log | 安装、宿主启动及客户端加载 | `evidence/UF-001/runtime.log` |
| EVD-002 | log | 完整构建测试和打包检查 | `evidence/final/checks.log` |
### 2.6 角色与权限矩阵
不适用：保留既有服务权限和请求检查，无新权限规则。
### 2.7 负向场景
UF-001 的两条参数失败路径必须拒绝执行安装。
### 2.8 非目标
不新增来源开关界面，不重新设计现有业务界面，不发布包或修改在用 profile。

## 3. 技术方案
### 3.1 架构 Before / After
三个 workspace → 根目录一个发布包，src/sources、src/herdr、src/grok 内部模块，浏览器构建为唯一 DSH factory。
### 3.2 模块改造
迁移宿主模块，合并浏览器 apply，安装器只安装一个包，改造元数据、构建、检查与文档。
### 3.3 三段式定位清单
| 文件 | 稳定定位 | 搜索定位 | 行号 hint | 备注 |
|---|---|---|---|---|
| `scripts/install.mjs` | `parseArgs` | `rg "parseArgs" scripts/install.mjs` | 按搜索结果 | 单包安装 |
| `package.json` | `release:publish` | `rg "release:publish" package.json` | 按搜索结果 | 唯一发布包 |
### 3.4 API / 数据 / 权限 / 路由影响
保持 Herdr 和 Grok HTTP 路由、存储位置、协议与凭据规则。

## 4. Ticket map 与执行顺序
- [T-001](tickets/T-001.md)：实现单包与模块迁移。
- [T-002](tickets/T-002.md)：真实安装和入口加载。
- [T-003](tickets/T-003.md)：最终回归。
仅一个阶段 P1，依赖按 ticket frontmatter。

## 5. 验收与 Review 协议
### 5.1 命令级验证
`npm run build`、`npm run check`、`npm test`、`npm run pack:dry-run`。
### 5.2 真实场景全套测试
环境准备：独立 DSH_HOME，使用假本机上游服务，无真实账号。
启动命令：`npm run verify:install -- --dsh-anchor <本机已安装的DSH包入口>`；入口是包的公开 apply 和真实 DSH 客户端模块加载器。
访问入口：`scripts/install.mjs`、临时本机 HTTP 端口。
| UF | 执行方式 | 操作来源 | 必须核对的点 | Evidence |
|---|---|---|---|---|
| UF-001 主路径 | CLI + HTTP | 公开包入口 | 唯一插件、三个来源、代理和路由 | `evidence/UF-001/runtime.log` |
| UF-001 缺少 profile | CLI | 安装命令 | 不执行 DSH | `evidence/UF-001/runtime.log` |
| UF-001 未知参数 | CLI | 安装命令 | 不执行 DSH | `evidence/UF-001/runtime.log` |
### 5.3 Evidence
实现记录在 evidence/T-001/，真实场景在 evidence/UF-001/，最终回归在 evidence/final/。
### 5.4 Review
核对单包依赖、客户端唯一 factory、三个标签、停用资源释放与无敏感文件打包。
