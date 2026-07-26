# 架构与依赖边界

本文描述当前生产代码的模块职责、单向依赖和关键数据流。Agent 行为见 [Agent Runtime 设计](agent-v2-design.md)，发布门禁见 [验收清单](refactor-acceptance.md)。

```text
shared → entities → features → widgets → pages → app
```

## 目录职责

| 目录 | 职责 | 边界 |
| --- | --- | --- |
| `src/shared` | LLM/SSE、跨功能 contracts、i18n、通用浏览器能力、UI | 不依赖业务领域、feature、widget 或页面。 |
| `src/entities` | message、agent、resource、workspace 领域类型与 v3 persistence | 可依赖 shared；不依赖 UI 和 feature 实现。 |
| `src/features/agent-core` | AgentEngine、context、工具、资源处理、子 Agent coordinator | 通过 contracts 使用 runtime/persistence；不穿透其他 feature 内部模块。 |
| `src/features/runtime` | WebContainer 文件、进程、资源 materialize、快照和 revision | 是运行时实现唯一归属；终端组件不拥有 Agent runtime。 |
| `src/features/terminal-session` | 终端标签、服务预览和终端用例 | 只使用公开 runtime/contracts。 |
| `src/features/chat`、`file-manager`、`settings` | 独立交互用例 | 不能直接导入其他 feature 的内部类型。 |
| `src/widgets/workspace` | Workspace 与 DualTerminal 等跨功能组合 | 组合 features/entities/shared；不被低层反向依赖。 |
| `src/widgets/sidebar` | 会话、容器和导航组合 | 只调用 workspace store 公共操作。 |
| `src/pages` | 页面入口与状态编排 | 依赖 widgets 和 feature 公共入口。 |
| `src/app` | 根 Provider、全局样式、字体和应用启动 | 不承载业务运行时实现。 |

架构边界由 `scripts/check-architecture.mjs` 检查，并纳入 `npm run check`。TypeScript 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`。

## 核心数据流

### Agent 与工具

```text
用户输入 / resource IDs
  → AgentEngine
  → ContextComposer（完整请求 token 预算）
  → AgentModelClient
  → OpenAI-compatible adapter / SSE
  ← assistant content + tool calls + usage
  → AgentToolRegistry
  → AgentWorkspaceRuntime
  → WebContainer / resources / processes
  → AgentEventStore
  → V3PersistenceRepository
  → React 投影（Chat、RunBoard、Terminal、Services）
```

`AgentEngine` 不依赖 React 或供应商分支。`AgentModelClient` 负责 capabilities、context profile、token estimator、usage 和 content-part 映射。`AgentToolResult` 可以返回 `modelContent` 与 `resourceReferences`，但持久化 sanitizer 不允许 Blob/Base64 进入 ledger。

首屏 workspace store 通过类型化代理懒加载 v3 数据层；hydrate、事务和错误语义不变，但完整 IndexedDB validator/repository 不进入初始脚本。

### 资源附件

```text
File selection
  → UI limit validation
  → ResourceProcessorRegistry core validation
  → MIME sniff / image model copy / SHA-256 dedupe
  → resources store (Blob)
  → message/event/checkpoint (resource ID only)
  → resource tools or model adapter on demand
```

所有资源读取再次检查 session。持久化 resource ID 引用与新 File 一样计入每条 8 个和 50 MiB 总量；缺失、跨 session 或无有效来源的引用直接失败。图片只有在视觉请求边界临时转成 data URL；无法解码并验证 2048px 上限时安全拒绝。adapter 仅在 415 或 400/422 错误明确指向 vision/image/content-part 时重试资源引用路径，其他请求错误原样上抛。

### 子 Agent

```text
Root AgentEngine
  → AgentFamilyCoordinator
  ├─ explore child × up to 3
  ├─ implement child (exclusive)
  └─ verify child (exclusive)
       ↓ structured notification
Root synthesis → current container revision gate
```

父子 Run 共享 root-family 预算和 container mutation lease，但事件、上下文、取消域和 checkpoint 独立。Container lease 使用进程内全局队列，因此不同 root family 操作同一容器也会串行。

### 启动与恢复

```text
Workspace store → load sunam-v3 workspace
  → ensure WebContainer root
  → mount latest complete snapshot
  → restore terminal history
  → load latest 250 session events + Runs/tasks
  → active parent/child state becomes interrupted
  → resume reads checkpoint + latest run sequence + current workspace revision
  → create a new Run
```

旧 v2 repository/schema/database 等生产模块已完全删除；隔离测试只用原始 IndexedDB API 建立旧库。生产代码不打开、读取、迁移或删除 `sunam-v2`，设置仍从 `sunam_v2_*` Local Storage 键读取。

## 关键契约

### `AgentWorkspaceRuntime`

Agent Core 与 WebContainer 的唯一边界：

- container-scoped tree/read/search/apply；
- session-scoped resource list/read/image/materialize；
-真实 workspace revision 与 flush；
- Agent-owned foreground/background `shell_run`、进程观察/输入/停止；
- `(sessionId, runId, containerId)` 所有权；
- runtime 进程事件和只供 Agent 读取的有限用户终端缓冲；Agent 不能向用户交互 shell 注入输入。

所有根路径由 `getContainerRoot(containerId)` 生成，任何调用方都不能自行拼接或绕过路径解析。

### `AgentModelClient`

- `capabilities`：vision、files、tool calls；
- `getContextProfile()`：窗口、输出、summary reserve、安全缓冲；
- `estimateTokens()`：用于完整请求预算与裁剪；
- `complete()`：统一 message、tool calls、stream delta 和 usage；
- adapter 负责内部 content parts 到供应商 wire format 的映射。

### `V3PersistenceRepository`

`sunam-v3` 当前包含 9 个 store：workspace、runs、events、checkpoints、terminalHistory、snapshots、quarantine、resources、agentTasks。

- event append-only；按稳定 session timeline 和单 Run 分别提供最多 250 条的页面查询，并有 run latest sequence 查询。
- checkpoint 主键是 runId，每 Run 覆盖同一条。
- delegated task 使用内部唯一 ID，模型 taskId 是普通标签。
- session/container 删除前取消并等待命中范围的活动父/子 Run；随后在单事务内同步 workspace 元数据和关联数据，防止删除后数据复活。
- session 删除清理该 session 的 Run/event/checkpoint/resource/task 与 terminal history；container 删除清理该 container 的 Run 侧链、资源归属和 snapshot，不宣称删除无法按 container 定位的 session terminal history。
- Run/Event/Checkpoint/Message/Resource/AgentTask 的嵌套字段都经过 schema guard；malformed record 被隔离，资源 Blob 只存 resources。
- Run、checkpoint、terminal、snapshot 写入分别串行。
- 快照调度器保留至多一个排队 follow-up；显式 flush 先取消尚未触发的 debounce，避免同一变更重复保存。即使当前写入失败，follow-up 也会继续执行，失败不会毒化后续队列。

### Workspace store

store 提供 selector 和无变化短路。相同 session status 不触发 IndexedDB 写入；组件只订阅实际使用切片。普通 workspace save、session/container 删除和 reset 共用同一串行队列，reload 先等待队列排空；repository 层也串行相同操作，避免旧保存覆盖新删除元数据。

## 运行与渲染性能

- SSE delta 最多 30 次/秒合并更新，结束强制 flush；未终止 buffer 上限 1 MiB，provider error 结构化上抛。
- Chat 投影一次建立 `tool_call_id → result` 索引，避免逐消息扫描造成 O(n²)。
- 初始仅读最近 250 events；上滚自动分页；DOM 固定在当前 250-message 窗口。
- 子 Agent transcript 在展开子任务时按 run 查询最近 250 events，默认只渲染摘要。
- 历史 Markdown 使用 `content-visibility`。只有 5,000-event 基准仍无法满足帧预算时才引入动态高度虚拟列表。
- 文件列表不读取每个文件全文计算大小；打开、下载或显式读取后再缓存真实大小。
- 快照导出前排除依赖、构建产物、coverage、Playwright 输出和缓存；10,000 文件/100 MiB 超限保留最后成功版本。
- 未配置 API 时不加载 Workspace、WebContainer、xterm 和 Agent Core；文件管理器与终端按需拆包。

## 变更守则

- 新模型协议实现新的 `AgentModelClient` adapter，不在 Engine 中加入供应商判断。
- 新资源类型实现 `ResourceProcessor`，不修改 AgentEngine。
- 新工具先定义 schema、权限、并发、超时、结果和持久化边界；默认串行和最小权限。
- feature 间只通过公共入口或 `shared/contracts` 交互；禁止引用其他 feature 内部类型。
- 任何 persistence schema 变更必须同步版本、validator、quarantine、删除语义、恢复测试和文档。
- 写入工作区的能力必须参与真实 container revision 与 mutation lease；验证必须绑定同一 revision。
- shell 是不透明 mutation boundary：进程结束时 runtime 主动推进 revision，不能只依赖异步文件 watch。
- UI 嵌套圆角遵循仓库根 `AGENTS.md` 的同心半径规则。
- 架构、持久化、公共行为、验证门或依赖策略发生变化时，同步更新 README 与 `docs/` 中所有受影响 Markdown；验证记录不得保留已经解除的阻塞信息。

## 当前架构基线

2026-07-26，架构边界检查已作为 `npm run check` 的固定步骤连续通过两次完整门禁。当前生产构建初始 JS 为 84.92 KiB gzip、总 JS 为 313.28 KiB gzip、`dist` 为 1.34 MiB；核心自动化 35 文件/166 测试，E2E 7/7、视觉 4/4、真实 WebContainer 3/3。生产依赖审计为零，剩余 8 个 high 仅来自开发期 PWA/Workbox 链，并按 [依赖策略](dependency-advisories.md) 跟踪。
