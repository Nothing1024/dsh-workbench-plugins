# Changelog

## Unreleased

- 单个 `dsh-plugin-workbench-suite` 包提供 DSH 会话、Herdr 和 Grok 三个默认开启的来源。
- 内部源码按 `src/sources`、`src/herdr`、`src/grok` 组织，浏览器构建输出一个模块。
- 提供单包本地与 npm 安装、独立环境安装验证及打包白名单检查。
- Grok 优先读取所选凭据文件，按来源区分内存缓存，使用私有文件替换磁盘缓存；认证检查和实际连接使用一致的显式凭据。
- 首发版本为 0.1.0；发布账号、正式仓库地址、许可证和完整第三方版权通知待确认。
