# 重构验收清单

## 自动化门禁

- `npm run typecheck`、`npm run lint`、`npm run test:coverage`、`npm run build`、`npm run check:bundle`、`npm run test:e2e` 全部通过。
- 核心领域与基础服务覆盖率最低为 lines/statements 85%、functions 85%、branches 80%。
- Playwright 以 Chromium 验证首次 API 配置门禁，并在 1440×900 与 390×844 保存视觉基线，最大像素差异比为 0.2%。
- `npm run test:runtime` 使用假 API Key 启动真实 WebContainer，不发送模型请求，用于验证生产 COEP/COOP 环境。

## v2 开发态重置

1. 仅 `sunam_v2_*` 设置键可读取；任何旧 `sunam_*` 设置键都必须被忽略，不存在 schema migration。
2. 工作区、会话、容器、终端输出与 WebContainer 文件系统均不做跨刷新恢复；启动 v2 即建立新的内存工作区。
3. 不存在旧 `sunam_messages_*`、`sunam_ai_term_history_*` 或 `sunam-webcontainer` 数据库的读取、转换或备份路径。
4. Agent Event Store 只在当前页面保存 v2 事件；v2 Run 的 checkpoint/中断恢复逻辑不得向后兼容旧 loop 的状态，刷新后不恢复。

## 发布前真实 Chromium 冒烟

1. 配置 API、拉取模型、保存后刷新页面确认设置与语言保留。
2. 新建/重命名/置顶/删除会话和容器，确认侧栏状态与历史消息一致。
3. 发起 v2 Run，验证计划、流式进度、结构化工具结果、完成门、后台进程的状态/输入/终止及会话未读状态；修改工作区后不得在没有成功验证证据时完成。
4. 取消或中断 v2 Run，确认其显示为被中断，并可从 checkpoint 新建 Run 继续；不得恢复旧 PID 或宣称旧进程仍在运行。
5. 在容器中创建服务，确认端口列表；创建、上传、改名、移动、预览和下载文件。
6. 刷新页面确认进入新的工作区、旧终端输出和文件系统不恢复；在 900px 断点两侧检查移动导航。
