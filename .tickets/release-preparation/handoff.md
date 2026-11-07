# 发布准备 Handoff

目标按 spec.md 第 2 章执行。执行者 Codex；浏览器用 ego-browser，代码与 CLI 在仓库根运行。
基线 41eb2c6，MIT 与版权名已由用户确认；GitHub 账号 Nothing1024，npm 登录失效。
T-001 → T-002 → T-003。board.py 写状态，每次迁移 validate_package.py。
先修复已知配置保存问题并真实回放，再完成全量回归、敏感信息扫描和产物。
EVD 见 evidence/T-001/result.log、evidence/browser/result.log、evidence/final/checks.log。
不得修改在用配置、伪造许可来源或报告 npm 正式发布成功。
验收后设 spec Done，提交可恢复记录并 retire_package.py 删除过程包。
