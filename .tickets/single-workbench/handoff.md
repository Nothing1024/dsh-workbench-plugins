# 单包工作台执行入口

执行环境：Codex；所有命令在仓库根目录执行。
目标见 spec.md，第 2 章是唯一需求合同。包内资料为 tickets/ 与 evidence/。
架构：三个独立包改为一个根包，内部来源栏、Herdr、Grok 分开。
依赖顺序：T-001 → T-002 → T-003；BR-001、BR-002 定义合并和默认行为，INV-001 保留业务。
使用 `python3 $SPEC_SKILL/scripts/board.py .tickets/single-workbench --next` 领取工作。
先写 in_progress，验证并留 evidence 后写 in_review，审查后写 done；每次状态变更运行 validate_package.py。
不要中途问是否继续，除非所有剩余 ticket 都阻塞。
不触碰原始源码目录、真实账号或在用 profile，不执行发布、push 或远端创建。
真实安装和服务加载按 spec.md 第 5.2 节执行，不以单测代替安装入口验证。
T-003 验证通过才把 spec Status 改 Done。所有 evidence 必须非空。
