# Changesets

每个可发布行为变更新增一个 Markdown changeset，例如 `npx changeset`。

- 三个包当前保持 `0.1.0`，使用 fixed 组统一递增。
- `dsh-plugin-workbench-sources` 的浏览器槽位契约发生破坏性变化时，应与 Herdr / Grok 一起记录兼容性说明。
- 只运行 `npm run version:packages` 生成版本和 CHANGELOG 变更；本仓库不会在 CI 中自动 publish。
