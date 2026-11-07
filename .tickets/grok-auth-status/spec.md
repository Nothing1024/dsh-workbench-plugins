# Grok Auth 与状态显示 Spec

> Version: 0.1.0 | Date: 2026-11-07 | Status: Done | Board: tickets

## 0. 一页纸人话摘要

给 Grok bot 用户提供手动填写和移除 Auth 的设置。
保存的 Auth 只留在 DSH 所在机器，保存后输入框清空，不返回原文。
机器人只显示一个三字状态，未读回复与待查看合为待查看。
运行、等待、待查看、空闲分别使用蓝、橙、紫、灰色。
保留既有自动检测和机器人业务，不连接真实账号，不发布或推送。

## 1. 事实基线
### 1.1 需求来源与置信度
用户明确要求手动配置 Grok bot Auth、状态三字、未读回复与待查看合并并换色；置信度高。
### 1.2 类型与验收重点
frontend/backend；配置保存和浏览器实际交互，状态排版截图与完整回归。
### 1.3 已验证事实
`git status --short` 为空；基线为 9ad4876。
`rg pendingLabel src/grok/client.js` 确认侧栏和对话标题都会追加第二个待查看标记。
`sed -n '104,164p' src/grok/client.js` 确认当前设置仅检测和清缓存，没有 Auth 输入。
`cloud_board.py --check-access` 返回 2，没有 origin，采用本地记录。
### 1.4 假设
ASM-001：Auth 接受完整 Cookie 或单独 SSO 值；优先级保留显式启动配置优先，手动文件次之，最后自动检测。
ASM-002：颜色按蓝、橙、紫、灰实现；这是未指定具体色号时的默认值。

## 2. 业务合同
### 2.1 BR 业务规则
| 规则 ID | 规则 | 正例 | 反例 | 范围 | 验证 |
|---|---|---|---|---|---|
| BR-001 | 可保存和移除手动 Auth，不返回原文 | 保存后重启仍可读取，界面仅显示状态 | 放入浏览器 localStorage 或响应返回 Cookie | Auth | HTTP 与浏览器 |
| BR-002 | 一个三字机器人状态 | 运行中、待输入、待查看、空闲中 | 未读回复加待查看两个标记 | 侧栏、标题、详情 | 浏览器 |
| BR-003 | 状态使用不同颜色 | 蓝、橙、紫、灰 | 全部沿用原强调色 | 状态标记 | 浏览器计算样式 |
### 2.2 UF 场景
| 场景 ID | Given | When | Then | 角色 | 验证方式 | Evidence |
|---|---|---|---|---|---|---|
| UF-001 | 打开 Grok 设置 | 保存、重启并移除假 Auth | 持久化且不显示原文 | 用户 | 浏览器与 HTTP | EVD-001 |
| UF-002 | 有四种状态的机器人 | 查看侧栏、打开未读机器人 | 三字、单标记、颜色分开 | 用户 | 浏览器 | EVD-001 |
### 2.3 核心业务流程
#### UF-001: 手动 Auth
主路径：打开账号与会话设置 → 填写密码样式输入框 → 保存并应用 → 输入框清空并显示已配置 → 重启服务后仍可检测 → 移除后清除手动文件。
失败分支一：空值或格式错误，保存被拒绝，保留输入并显示错误。
失败分支二：未登录 DSH 或来源错误，接口拒绝写入，文件不变。
状态机：未配置 → 编辑中 → 保存中 → 已配置；错误回到编辑中；移除回到未配置。
入口接线清单：GrokSettingsPanel、Grok 路由、固定本机 Cookie 文件、现有会话解析器。
#### UF-002: 状态显示
主路径：打开 Grok 来源 → 侧栏显示四种单标记 → 打开未读机器人 → 标题和详情都显示待查看。
失败分支一：运行中且有未读标记时保留运行中，不追加第二个标记。
失败分支二：没有未读的空闲机器人只显示空闲中，不误标待查看。
状态机：沿用服务端 running、waiting、unread、idle；只调整文案和样式。
入口接线清单：机器人列表行、对话标题、详情区、共享状态标签与颜色样式。
### 2.4 INV 不变量
| 不变量 ID | 内容 | 关联 | 验证 |
|---|---|---|---|
| INV-001 | 保留现有认证与同源检查，真实账号和在用 profile 不受影响 | BR-001 | 权限负向测试 |
| INV-002 | 保留消息发送、上传、缓存与单包默认启用行为 | BR-002 | 全量测试 |
### 2.5 EVD 证据
| 证据 ID | 类型 | 期望 | 位置 |
|---|---|---|---|
| EVD-001 | browser/log | Auth 操作与状态截图 | `evidence/browser/result.log` |
| EVD-002 | log | 完整回归和打包 | `evidence/final/checks.log` |
### 2.6 权限
沿用 DSH 登录认证与同源限制；不增加账号授权流程。
### 2.7 负向场景
拒绝无效 Auth 和未授权保存；接口只返回配置是否存在。
### 2.8 非目标
不登录真实 Grok，不修改 Herdr 设置，不重新设计工作台，不发布或推送。

## 3. 技术方案
### 3.1 架构
现有配置页面增加 Auth 表单，现有服务增加保存和移除操作，凭据文件使用私有文件替换。删除附加待查看标记，统一标签和颜色。
### 3.2 模块
Auth 持久化独立到 src/grok/auth-config.mjs，服务端复用既有保护；页面仅保留未保存的输入，不持久化到浏览器。
### 3.3 定位
| 文件 | 稳定定位 | 搜索定位 | 行号 hint | 备注 |
|---|---|---|---|---|
| `src/grok/client.js` | `GrokSettingsPanel` | `rg "GrokSettingsPanel" src/grok/client.js` | 按搜索结果 | 表单和状态 |
| `src/grok/service.mjs` | `registerGrokRoutes` | `rg "registerGrokRoutes" src/grok/service.mjs` | 按搜索结果 | 受保护的路由 |
| `src/grok/auth.js` | `invalidateCookieCache` | `rg "invalidateCookieCache" src/grok/auth.js` | 按搜索结果 | 测试隔离缓存 |
### 3.4 影响
新增同源 Auth 写入路由，保留其余 HTTP 协议和读取优先级；敏感内容不进入日志或响应。

## 4. Ticket map
- [T-001](tickets/T-001.md)：实现 Auth 和状态。
- [T-002](tickets/T-002.md)：浏览器与 HTTP 验收。
- [T-003](tickets/T-003.md)：最终回归和打包。
一个阶段 P1，依赖以 ticket frontmatter 为准。

## 5. 验收
### 5.1 命令
`npm run build`、`npm run check`、`npm test`、`npm run pack:dry-run`。
### 5.2 真实场景
环境准备：临时服务与假 Cookie，浏览器只访问测试服务；不读取真实 Cookie 或浏览器资料。
启动命令：`node .tmp/grok-ui/server.mjs`；测试脚本在实现阶段生成，端口由服务分配。
访问入口：服务输出的本机 URL，记录在本机 work 记录中；浏览器回放保存脱敏证据。
| UF | 执行方式 | 操作来源 | 核对点 | Evidence |
|---|---|---|---|---|
| UF-001 主路径与两条失败分支 | browser/HTTP | 实际配置表单与路由 | 保存、重启读取、移除、不返回秘密、拒绝无效写入 | `evidence/browser/result.log` |
| UF-002 主路径与两条失败分支 | browser | 实际列表和标题 | 单标记三字与颜色 | `evidence/browser/result.log` |
### 5.3 Evidence
实现证据位于 evidence/T-001，浏览器位于 evidence/browser，回归位于 evidence/final。
### 5.4 Review
确认配置不进入仓库、打包或浏览器持久存储，未读状态不重复，既有测试通过。
