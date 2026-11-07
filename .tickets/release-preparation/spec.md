# 发布准备 Spec

> Version: 0.1.0 | Date: 2026-11-07 | Status: InProgress | Board: tickets

## 0. 一页纸人话摘要

- 给本插件准备可安装的 npm 0.1.0 包和可公开的 GitHub 仓库。
- 许可证按用户确认的 MIT，版权名 Nothing1024；保留 Grok 复用来源说明。
- 仓库目标 Nothing1024/dsh-workbench-plugins；包名沿用 dsh-plugin-workbench-suite。
- 修正已知的 Herdr 端口保存顺序，验证保存与重启后读取。
- 检查全部 Git 历史及 npm 包中的敏感信息，保留公开账号署名。
- 不在登录失效时尝试正式 npm 发布，不修改在用 DSH 的配置。

## 1. 事实基线

### 1.1 需求来源与置信度
用户要求准备 npm 包和公开仓库，并确认 MIT、Nothing1024。置信度高。基线 41eb2c6，初始工作区干净。

### 1.2 任务类型与验收重点
infra / bugfix / frontend：元数据、许可证、配置保存、发布包安装、历史隐私、真实 DSH 配置页验证。

### 1.3 已验证事实

| 事实 | 来源命令 | 输出摘要 |
|---|---|---|
| GitHub 账号可用 | gh auth status | Nothing1024 |
| 仓库目标不存在 | gh repo view Nothing1024/dsh-workbench-plugins | 未找到仓库 |
| npm 认证无效 | npm whoami | E401 |
| 包名尚无注册记录 | npm view dsh-plugin-workbench-suite | E404，不代表已保留 |
| 原 Grok 包声明 MIT | 阅读原包 package.json 与三个模块 | 无独立 LICENSE 或版权通知 |
| 全部历史未发现密钥 | gitleaks git --all | 0 个发现 |
| Herdr 先写浏览器再保存服务端 | 阅读 src/herdr/client.js | 端口改变后 POST 会使用新地址 |

### 1.4 假设清单
默认以当前登录的 Nothing1024 创建同名公开仓库；npm 仅准备产物，正式发布需恢复登录。

### 1.5 变更记录
2026-11-07：用户确认许可证。修复范围限定为配置保存和可复核的发布准备。

## 2. 业务合同

### 2.1 BR 业务规则

| 规则 ID | 规则 | 正例 | 反例 | 验证 |
|---|---|---|---|---|
| BR-001 | 发布元数据和 MIT 许可没有占位内容 | 正式仓库地址、版权名与完整许可 | REPLACE_ME 或 LICENSE 占位 | 检查及打包 |
| BR-002 | 修改 Herdr 端口先向仍在运行的代理保存，成功后更新浏览器 | POST 到旧端口，保存新端口，重启读取 | 请求不存在的新端口或失败却写入浏览器 | 定向测试与浏览器 |
| BR-003 | 公开源码与包不包含私密凭据和开发者本机路径 | 全历史、文件白名单检查 | 发布 .env、真实 Auth、私有路径 | gitleaks 与文件扫描 |
| BR-004 | 提供可安装 tarball、校验值及公开仓库 | 安装同一产物且仓库 main 可访问 | 只说准备好了，没有实际文件 | CLI 与 GitHub 查询 |

### 2.2 UF 用户验收场景（索引）

| 场景 ID | Given | When | Then | 验证 | Evidence |
|---|---|---|---|---|---|
| UF-001 | 临时 DSH 已启用插件 | 设置页修改 Herdr 端口并保存 | 请求旧代理、保存成功、重启读取新端口 | browser / HTTP | EVD-002 |
| UF-002 | 发布文件准备齐全 | 安装 tarball 并读取公开仓库 | 包入口可用、main 对应候选提交 | CLI | EVD-003 |

### 2.3 核心业务流程

#### UF-001：保存与重启
前置状态：独立 DSH_HOME、模拟上游、隔离的偏好文件。

| 步骤 | 用户动作 | 即时反馈 | 系统行为 | 可见结果 |
|---|---|---|---|---|
| 1 | 插件详情页打开 Herdr | 展示接入字段 | 读取现有偏好 | 当前代理地址可用 |
| 2 | 修改端口，保存 | 显示保存中 | 旧代理写入新偏好 | 提示重启后生效 |
| 3 | 重启测试服务 | 读取新偏好 | 新端口监听 | 新地址可连接 |

失败分支：
- 代理未响应：错误提示保留表单，不更新浏览器偏好；恢复后重试。
- 无效端口或非回环来源：原有校验拒绝，不提交配置。

界面状态机：可编辑 → 保存中 → 成功待重启 / 错误可重试。
入口接线清单：插件列表、本插件详情页、Herdr 分区、保存按钮。

#### UF-002：发布产物
前置状态：元数据、许可、配置修复和验证齐全。

| 步骤 | 用户动作 | 即时反馈 | 系统行为 | 可见结果 |
|---|---|---|---|---|
| 1 | 使用本次 tarball 安装 | 安装结果 | 解析服务与浏览器入口 | 单包可用 |
| 2 | 打开公开仓库 | GitHub 页面 | 查询 main | 源码和许可证可查看 |

失败分支：
- 包内容不符或扫描发现真实密钥：停止公开，修复后重新生成。
- npm 认证失败：保留本地 tarball，说明登录问题，不假报正式发布成功。

界面状态机：检查 → 打包 → 安装验证 → 公开仓库；npm 保持待登录发布。
入口接线清单：npm pack、安装检查、GitHub main。

### 2.4 INV 不变量

| 不变量 ID | 内容 | 关联 | 验证 |
|---|---|---|---|
| INV-001 | 保持单包、三个来源默认开启与已有 Auth、代理来源限制 | BR-002, BR-004 | 全量测试与安装 |
| INV-002 | 不操作真实账号或在用 profile，不泄露凭据 | BR-003 | 隔离环境与历史审计 |

### 2.5 EVD 证据清单

| 证据 ID | 类型 | 期望 | 保存位置 |
|---|---|---|---|
| EVD-001 | log | 元数据与来源核对 | `evidence/T-001/result.log` |
| EVD-002 | browser/log | 保存、失败、重启验证 | `evidence/browser/result.log` |
| EVD-003 | log | 回归、扫描、包与仓库 | `evidence/final/checks.log` |

### 2.6 权限
GitHub Nothing1024 可创建仓库。npm 当前未授权。只使用临时配置进行业务测试。

### 2.7 负向场景
不得带入私密文件；失败保存不能切换连接；不虚构上游版权通知；不假报 npm 发布。

### 2.8 非目标
真实 Grok 与 Ovis 业务验收、改变许可范围以外的业务、重写 Git 历史、自动发布 npm。

## 3. 技术方案

### 3.1 Before / After
Before：发布占位、Herdr 端口先变更、缺少可交付包。
After：正式元数据和 MIT、先保存代理后更新浏览器、已验证的产物和公开仓库。

### 3.2 模块改造
清单、许可证与文档更新；Herdr 配置保存修正；必要的启动来源默认值与隔离验证支持；CI 检查和发布包输出。

### 3.3 三段式定位清单

| 文件 | 稳定定位 | 搜索定位 | 行号 hint | 备注 |
|---|---|---|---|---|
| package.json | repository | `rg "repository" package.json` | L28 | 发布身份 |
| src/herdr/client.js | herdrConfigRequest | `rg "herdrConfigRequest" src/herdr/client.js` | L53 | 保存请求 |
| src/herdr/proxy.mjs | handleMeta | `rg "handleMeta" src/herdr/proxy.mjs` | L112 | 写入偏好 |
| src/herdr/prefs.mjs | writeHerdrPrefs | `rg "writeHerdrPrefs" src/herdr/prefs.mjs` | L44 | 持久化 |
| scripts/verify-install.mjs | verifyResolution | `rg "verifyResolution" scripts/verify-install.mjs` | L36 | 安装验证 |

### 3.4 影响
保留已有配置字段和请求信任规则，修正保存时序；不添加远程命令或额外后台服务。

## 4. Ticket map 与执行顺序

- [T-001](tickets/T-001.md)：元数据与 MIT。
- [T-002](tickets/T-002.md)：配置修复和真实 DSH 验证，依赖 T-001。
- [T-003](tickets/T-003.md)：回归、扫描与发布产物，依赖 T-002。
最后阶段 real-run → final-regression。

## 5. 验收与 Review

### 5.1 命令验证
`npm run check`、`npm test`、`npm run pack:dry-run`、`npm run verify:install`、gitleaks、npm pack。

### 5.2 真实场景
环境准备：独立临时 DSH_HOME、偏好文件和模拟上游；不使用真实账号。
启动命令：`dsh --profile settings-verify --no-open --port 0`。
访问入口：该临时 DSH 打印的本机 URL；使用 ego-browser。

| UF | 执行方式 | 操作来源 | 核对点 | Evidence |
|---|---|---|---|---|
| UF-001, UF-002 | browser / CLI | 2.3 | 保存顺序、重启、tarball 安装 | `evidence/browser/result.log` |

### 5.3 Evidence
T-001 放许可和元数据结果；browser 放真实回放；final 放全部回归和输出索引。

### 5.4 Review
验证无 P0/P1 遗留，文件可安装、隐私扫描通过后再公开；npm 未登录必须明确说明。
