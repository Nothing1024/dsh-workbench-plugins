# Tickets

本目录是需求包的执行状态源。每个 `T-xxx.md` 是一个可独立交给 Agent 的 ticket（对应 GitHub/Gitea issue），frontmatter 保存看板字段，正文保存这条工作的背景、验收、技术方案、验证和证据。

## 目录规则

- `spec.md` 是需求合同：业务规则、用户路径、不变量和总体验收只在这里定义。
- `tickets/T-xxx.md` 是执行单元：一条 ticket 只做一件能在约 1–2 小时内交付、能在一次审查中验收的工作；预计超过半天就继续拆。
- `evidence/T-xxx/` 保存该 ticket 的命令输出、截图、日志或 API 样例。
- `board.py` 生成状态视图；不要另建 CSV 或手工维护第二块状态表。

## Frontmatter

必填字段：`id`、`title`、`type`、`status`、`priority`、`phase`、`role`、`parent`、`depends_on`、`owner`、`estimate`、`labels`、`links`。

`status` 只能是：

- `open`：可开工，但仍可能被 `depends_on` 阻塞；
- `in_progress`：正在实现；
- `in_review`：实现和本 ticket 的验证已完成，等待审查或真实场景核验；
- `blocked`：被依赖、环境或权限卡住，必须在 `reason` 写明原因；
- `done`：验收和证据都已落盘；
- `deferred`：用户明确暂缓，必须在 `reason` 写明原因。

`parent` 写 `ROOT` 表示直接属于 `spec.md`，也可以写另一个 ticket ID；`depends_on` 只写依赖方，`board.py` 会反推哪些 ticket 被它阻塞。`links` 只引用 `spec.md` 第 2 章已经定义的 `BR/UF/INV/EVD` ID。

`role` 可写 `task`、`phase-exit`、`real-run`、`final-regression` 或 `review`。每个非最后阶段用一个 `phase-exit` ticket 收口；最后阶段必须有 `real-run` 和 `final-regression` 两条 ticket。

## 状态迁移

```text
open → in_progress → in_review → done
                 ↘ blocked → in_progress
                 ↘ deferred（需用户决定）
```

状态变更用命令写回 ticket：

```bash
python3 $SPEC_SKILL/scripts/board.py .tickets/release-preparation --set-status T-001 in_progress
python3 $SPEC_SKILL/scripts/board.py .tickets/release-preparation --set-status T-001 blocked --reason "等待测试账号"
```

`board.py --next` 优先列出 P0、无阻塞、被更多 ticket 依赖的工作；个人同时 `in_progress` 的 ticket 建议不超过 2–3 条。每次状态迁移后都重新运行 `validate_package.py`，并把过程证据写入对应 `evidence/T-xxx/`。
