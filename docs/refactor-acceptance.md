# 重构验收清单

## 自动化门禁

- `npm run typecheck`、`npm run lint`、`npm run test:coverage`、`npm run build`、`npm run check:bundle`、`npm run test:e2e` 全部通过。
- 核心领域与基础服务覆盖率最低为 lines/statements 85%、functions 85%、branches 80%。
- Playwright 以 Chromium 验证首次 API 配置门禁，并在 1440×900 与 390×844 保存视觉基线，最大像素差异比为 0.2%。
- `npm run test:runtime` 使用假 API Key 启动真实 WebContainer，不发送模型请求，用于验证生产 COEP/COOP 环境。

## v2 隔离与可恢复性

1. 仅 `sunam_v2_*` 设置键和 IndexedDB `sunam-v2` 可读取；任何旧 `sunam_*` 键、`sunam_messages_*`、`sunam_ai_term_history_*` 或旧数据库都必须被忽略，不存在 schema migration 或兼容导入。
2. 刷新后 workspace、会话/容器元数据、Agent 终端输出、事件、checkpoint 与 WebContainer 文件快照均可从 v2 恢复；恢复顺序为 workspace → snapshot mount → terminal history → event ledger。
3. 恢复中的活动 Run 必须降级为 `interrupted`；“继续”必须新建 runId 和新的取消域，禁止重用旧 PID、AbortController、流式连接或宣称进程仍在运行。
4. 损坏、未知版本或格式不正确的 v2 record/备份必须保留在隔离区或被拒绝；不得静默覆盖。导入冲突必须重映射 ID，且需要为孤立 Run/Checkpoint 建立可选择的 session/container 元数据。
5. 工作区被 Agent 改动后，完成前必须有至少一条成功验证证据；失败验证、未完成计划、预算耗尽、空响应循环或取消都不得伪造完成。

## 发布前真实 Chromium 冒烟

1. 配置 API、拉取模型、保存后刷新页面确认设置与语言保留。
2. 新建/重命名/置顶/删除会话和容器，确认侧栏状态与历史消息一致。
3. 发起 v2 Run，验证计划、流式进度、结构化工具结果、完成门、后台进程的状态/输入/终止及会话未读状态；修改工作区后不得在没有成功验证证据时完成。
4. 取消或中断 v2 Run，刷新后确认其显示为被中断，并可从 checkpoint 新建 Run 继续；不得恢复旧 PID 或宣称旧进程仍在运行。
5. 在容器中创建服务，确认端口列表；创建、上传、改名、移动、预览和下载文件。
6. 创建文件、启动/停止服务、输出 Agent 日志后刷新页面，确认 v2 workspace、快照和终端历史恢复；备份/import API 保留为后续接入点，当前设置页不展示数据管理入口。在 900px 断点两侧检查移动导航。
7. 服务链接必须以 `noopener noreferrer` 打开；在 Chrome 中点击本地服务后不得自动打开 DevTools 或保留 `window.opener`。
