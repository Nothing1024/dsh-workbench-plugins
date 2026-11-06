# Herdr Live（dsh-plugin-herdr-live）

把本机 Ovis / Herdr 接到 DSH 侧栏和主区。

- **依赖** `dsh-plugin-workbench-sources`（来源栏壳）。本包不再挂载来源条，只注册「Herdr」标签。
- **设置**：DSH **设置 → 内置插件 → Herdr**，或侧栏标题栏的设置按钮。
- 可配置 Ovis 接入 URL、代理端口、DSH 父页面来源；支持测试连接。修改接入 URL 可在当前进程生效；**改代理端口需要重启 DSH**。

偏好保存在 `~/.dsh/herdr-live/prefs.json`。启动时若设置了 `DSH_HERDR_UPSTREAM` / `DSH_HERDR_PARENT_ORIGIN` / `DSH_HERDR_PROXY_PORT`，环境变量优先。

来源壳是必需 peer（`^0.1.0`），应与本包一起安装并启用：

```bash
dsh plugin --profile <profile> add dsh-plugin-workbench-sources@0.1.0 dsh-plugin-herdr-live@0.1.0
```

以上 npm 命令在正式发布后可用。父页面 origin 默认沿用预览地址 `http://127.0.0.1:50759`，使用时改为实际 DSH 页面地址。当前许可证与仓库地址仍待确认。
