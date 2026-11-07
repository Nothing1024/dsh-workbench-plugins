# 插件详情页设置 Handoff

目标：按 spec.md 第 2 章把现有配置迁移到本插件详情页。
执行者：Codex；浏览器工具为 ego-browser；不依赖用户回填截图。
基线：4bc090c，工作区此前干净。先运行定向注册测试确认失败，再实现。

依赖：T-001 → T-002 → T-003。用 board.py 领取、更新状态，每次迁移执行 validate_package.py。
证据：evidence/T-001/result.log、evidence/browser/result.log、evidence/final/checks.log。
命令都在仓库根执行；源码路径从仓库根解析，证据从本目录解析。
只使用隔离的临时 profile 和模拟 Auth；不修改在用 DSH，不连接真实账号，不推送或发布。
全部验收后将 spec 标为 Done，并按 retire_package.py 留存可恢复提交后删除过程包。
