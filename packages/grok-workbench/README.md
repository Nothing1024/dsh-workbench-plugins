# Grok 工作台（dsh-plugin-grok-workbench）

独立的 Grok bot 来源：侧栏机器人列表 + 主区对话。

- **依赖** `dsh-plugin-workbench-sources`，**不再依赖** Herdr。只装本包 + 来源壳即可使用。
- **设置**：DSH **设置 → 内置插件 → Grok bot**，或侧栏「更多 → 插件设置」。
- 可检测 / 重新加载 grok.com 会话（浏览器已登录、cookie 文件或环境变量），打开 grok.com 登录页，以及清除本地会话缓存。不会在界面上展示 cookie 内容。
