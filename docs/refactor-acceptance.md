# 重构验收清单

## 自动化门禁

- `npm run typecheck`、`npm run lint`、`npm run test:coverage`、`npm run build`、`npm run check:bundle`、`npm run test:e2e` 全部通过。
- 核心领域与基础服务覆盖率最低为 lines/statements 85%、functions 85%、branches 80%。
- Playwright 以 Chromium 验证首次 API 配置门禁，并在 1440×900 与 390×844 保存视觉基线，最大像素差异比为 0.2%。
- `npm run test:runtime` 使用假 API Key 启动真实 WebContainer，不发送模型请求，用于验证生产 COEP/COOP 环境。

## 数据兼容性

1. 升级前写入的 `sunam_api_key`、`sunam_base_url`、`sunam_api_model`、`sunam_model` 可直接读取。
2. `sunam_workspace_state` 中会话、容器、置顶和选中状态可恢复；失效选中项回退到首项。
3. `sunam_messages_<sessionId>` 与 `sunam_ai_term_history_<sessionId>` 可恢复；非法 JSON 保留备份后安全回退。
4. `sunam-webcontainer` IndexedDB 快照库、PWA manifest 和 COEP/COOP 头部保持兼容。

## 发布前真实 Chromium 冒烟

1. 配置 API、拉取模型、保存后刷新页面确认设置与语言保留。
2. 新建/重命名/置顶/删除会话和容器，确认侧栏状态与历史消息一致。
3. 发起流式任务，验证停止、工具调用、后台进程的状态/输入/终止及会话未读状态。
4. 在容器中创建服务，确认端口列表；创建、上传、改名、移动、预览和下载文件。
5. 刷新页面确认会话、终端历史、文件快照恢复；在 900px 断点两侧检查移动导航。
