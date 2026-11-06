# 工作台来源（dsh-plugin-workbench-sources）

极薄的 DSH 插件：负责在侧栏顶部挂载来源栏，并注册「DSH 会话」标签。

- 浏览器模块导出 `SOURCE_TAB_SLOT`（`workbench.sources`）和 `SourceTab`，供 Herdr / Grok 注册自己的来源标签。
- 不拥有任何业务侧栏或主区面板。
- 设置入口：DSH **设置 → 内置插件 → 工作台来源**（也可在本插件设置里开关会话标签、调整顺序）。

只装业务插件而不装本包时，不会出现来源条。

安装：`dsh plugin --profile <profile> add dsh-plugin-workbench-sources@0.1.0`（正式发布后）。包内 bundle patch 会启用来源壳；Node 主入口只导出 host apply。当前许可证与仓库地址仍待确认。
