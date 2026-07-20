# 发布与重构验收清单

本清单用于影响 Agent、工作区持久化、WebContainer 或交互布局的发布前验证。它区分每次代码变更可自动执行的门禁，以及需要真实 Chromium 环境确认的场景。

## 自动化门禁

- `npm run check` 必须通过；它依次执行 TypeScript、Oxlint、覆盖率测试、生产构建和包体检查。
- 涉及页面交互时运行 `npm run test:e2e`；涉及视觉样式时运行 `npm run test:visual` 并审查基线变化。
- 涉及 WebContainer、终端、端口服务、跨源隔离或快照恢复时运行 `npm run test:runtime`。
- 核心领域与基础服务覆盖率最低为 lines/statements 85%、functions 85%、branches 80%。
- Playwright 以 Chromium 验证首次 API 配置门禁，并在 1440×900 与 390×844 保存视觉基线，最大像素差异比为 0.2%。
- `npm run test:runtime` 使用假 API Key 启动真实 WebContainer，不发送模型请求，用于验证生产 COEP/COOP 环境。

## v2 隔离与可恢复性

1. 仅 `sunam_v2_*` 设置键和 IndexedDB `sunam-v2` 可读取；任何旧 `sunam_*` 键、`sunam_messages_*`、`sunam_ai_term_history_*` 或旧数据库都必须被忽略，不做跨数据库兼容导入。当前库内受支持的 v1 record 只做 `verificationEvidence` 等小范围升级，数据库 schema 版本仍为 2。
2. 刷新后 workspace、会话/容器元数据、Agent 终端输出、事件、checkpoint 与 WebContainer 文件快照均可从 v2 恢复；恢复顺序为 workspace → snapshot mount → terminal history → event ledger。
3. 恢复中的活动 Run 必须降级为 `interrupted`；“继续”必须新建 runId 和新的取消域，禁止重用旧 PID、AbortController、流式连接或宣称进程仍在运行。
4. 损坏、未知版本或格式不正确的 v2 record 必须保留在隔离区；IndexedDB 不可用时必须暂停编辑，不得静默创建并覆盖工作区。
5. 工作区被 Agent 改动后，完成前必须有至少一条成功验证证据；失败验证、未完成计划、预算耗尽、空响应循环或取消都不得伪造完成。

## 发布前真实 Chromium 冒烟

1. 配置 API、拉取模型、保存后刷新页面确认设置与语言保留。
2. 新建/重命名/置顶/删除会话和容器，确认侧栏状态与历史消息一致；未使用的空对话同时最多一个，容器创建与重命名均不得产生重名（自动使用递增后缀）。
3. 发起 v2 Run，验证计划、流式进度、结构化工具结果、完成门、后台进程的状态/输入/终止及会话未读状态；修改工作区后不得在没有成功验证证据时完成。
4. 取消或中断 v2 Run，刷新后确认其显示为被中断，并可从 checkpoint 新建 Run 继续；不得恢复旧 PID 或宣称旧进程仍在运行。
5. 在容器中创建服务，确认端口列表；创建、上传、改名、移动、预览和下载文件。
6. 创建文件、启动/停止服务、输出 Agent 日志后刷新页面，确认 v2 workspace、快照和终端历史恢复；在 900px 断点两侧检查移动导航和服务列表内部滚动。
7. 服务链接必须以 `noopener noreferrer` 打开；在 Chrome 中点击本地服务后不得自动打开 DevTools 或保留 `window.opener`。

## 记录结果

发布说明或 Pull Request 应记录实际执行过的命令、未执行的项目及原因，以及任何需要人工复核的视觉基线或浏览器差异。不要把未运行的检查标为通过；这与 Agent 的验证证据规则一致。
