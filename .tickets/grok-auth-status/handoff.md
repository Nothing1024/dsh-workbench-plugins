# Grok Auth 与状态执行入口

执行环境为 Codex，所有命令从仓库根执行。
需求合同见 spec.md 第 2 章，任务见 tickets/，证据见 evidence/。
架构由原检测页面增加手动配置，状态改为单个三字标记。
依赖顺序 T-001 → T-002 → T-003；关键条目 BR-001、BR-002、BR-003、INV-001。
使用 board.py --next 领取任务；先 in_progress，再 in_review，验证和 Evidence 齐全后 done；每次变更后运行 validate_package.py。
不要中途问是否继续，除非所有剩余 ticket 都阻塞。
真实验收从页面入口操作，并检查实际 HTTP 保存和重启读取，不以静态源码检查代替。
测试仅使用假账号，Auth 不写日志、不返回客户端原文；不执行发布、push 或真实登录。
T-003 通过后将 spec Status 改为 Done，保留非空证据后归档。
