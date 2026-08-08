# 架构与依赖边界

本文描述当前生产代码的模块职责、单向依赖和关键数据流。Agent 行为见 [Agent 运行设计](agent-v2-design.md)，能力清单见 [FEATURES](FEATURES.md)，发布门禁见 [验收清单](refactor-acceptance.md)。

```text
shared → entities → features → widgets → pages → app
```

## 目录职责

| 目录 | 职责 | 边界 |
| --- | --- | --- |
| `src/shared` | LLM/SSE、跨功能 contracts、i18n、配置 store（providers/personas/settings）、通用浏览器能力、UI | 不依赖业务领域、feature、widget 或页面。 |
| `src/entities` | message、agent、resource、workspace 领域类型与 v3 persistence | 可依赖 shared；不依赖 UI 和 feature 实现。 |
| `src/features/agent-core` | pi 引擎（`pi/`）、工具、事件桥接、驱动抽象（`driver/`）、资源处理、子 agent 协调、能力注册表（`capability/`） | 通过 contracts 使用 runtime/persistence；不穿透其他 feature 内部模块。 |
| `src/features/runtime` | Succinix 容器运行时（文件 RPC、host 生命周期、快照双层、进程注册表）、资源 materialize、revision；`CapabilityAwareRuntime` 纯聊天降级 | 是运行时实现唯一归属；终端组件不拥有 Agent runtime。 |
| `src/features/settings` | 独立设置页状态与面板（供应商 / 皮套 / 关于） | 组合 shared 配置 store；不进初始 bundle 的预设随设置页懒加载。 |
| `src/features/terminal-session` | 终端标签、服务预览和终端用例 | 只使用公开 runtime/contracts。 |
| `src/features/chat`、`file-manager` | 独立交互用例 | 不能直接导入其他 feature 的内部类型。 |
| `src/widgets/capability` | 能力库面板与上下文（`CapabilityProvider`/`CapabilityPanel`/`CapabilitySwitch`） | 组合 registry 清单、持久化配置与运行时可用性；不写第二份清单。 |
| `src/widgets/workspace` | Workspace 与 ComputerView 等跨功能组合 | 组合 features/entities/shared；不被低层反向依赖。 |
| `src/widgets/sidebar` | 会话、容器和导航组合 | 只调用 workspace store 公共操作。 |
| `src/widgets/settings` | 设置交互 | 组合 shared/entities；不被低层反向依赖。 |
| `src/pages` | 页面入口与状态编排（`SettingsPage` 三栏目） | 依赖 widgets 和 feature 公共入口。 |
| `src/app` | 根 Provider、全局样式、字体和应用启动 | 不承载业务运行时实现。 |

架构边界由 `scripts/check-architecture.mjs` 检查，并纳入 `npm run check`。TypeScript 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`。

## 核心数据流

### Agent 与工具（pi 通道）

```text
用户输入 / resource IDs
  → AgentDriver（默认 PiDriver）
  → PiSession（pi Agent 生命周期，懒加载）
  → pi Agent（AgentAgent：streamFn → models.streamSimple）
  → pi-ai Models（openai-completions / anthropic-messages adapter）
  ← assistant content + tool calls + usage
  → pi AgentTool（18 工具，TypeBox schema 适配）
  → AgentWorkspaceRuntime
  → Succinix（run_command / manage_process 等走文件 RPC）
  → PiEventBridge → AgentEvent
  → v3 event store（刷新后 UI 列表可恢复）
  → React 投影（Chat、RunBoard、Terminal、Services）
```

`PiSession` 是唯一静态依赖 pi 包的位置，由 `useAgentV2` 通过动态 import 懒加载，保证 pi 的
~100KiB gzip 不进初始 bundle。`AgentDriver` 抽象把壳（UI）与实现解耦：内置 `PiDriver` 默认，
ClaudeCode / Codex CLI 桥为可选实验。事件桥接沿用统一模型：实现把回复/状态变化翻译成
`AgentEvent`，经 `onEvent`/`onRunChange` 交给 UI 状态层。

`AgentWorkspaceRuntime` 是 Agent core 与容器的唯一边界。`run_command` / `manage_process` 等
进程类工具通过 Succinix 文件 RPC 执行；`read_resource_*` / `materialize_resource` 等资源工具
始终走 IndexedDB（与容器无关，纯聊天降级时附件仍可分析）。

### Succinix 容器集成面

```text
Agent shell / 用户终端
  → SuccinixClient（文件 RPC）
  → wc.fs 写 /cmd.json（单槽信箱）
  → host（TerminalExecutor 常驻 node 进程，轮询 50ms）
  → node|npm|npx → 真实 Node.js / python|pip → Pyodide daemon / 其余 → Lifo
  → 写 /result-<id>.json（每请求独立结果文件）
  → 浏览器读到即删
  ← ok / exitCode / stdout / stderr / runtime / cwd
```

- host 是 Succinix 项目的 TerminalExecutor（`@succinix/engine`），经
  `scripts/sync-succinix-assets.mjs` 同步运行时资产到 `public/succinix/`（gitignore）。
- 进程表携带 `scope`（`system` / `container` / `unknown`）与可选 `containerId`，Sunam 按
  虚拟容器过滤查询、拦截跨容器 kill，UI 标记受保护系统进程为不可停止。
- 端口事件来自 Succinix 端口注册表（`server-ready` → 预览 URL）；服务面板对 managed 端口
  提供精确停止，不从端口反推 PID。orphaned 端口需要用户确认「强制重启关闭」，先 flush 全部
  快照再重启全局 WebContainer。
- 快照双层：Succinix 自动文件快照（IndexedDB `succinix-persist`，文本优先、诚实排除）+ Sunam
  agent 会话 checkpoint（`sunam-v3`），保存时机协调避免双写冲突。

### 资源附件

```text
File selection
  → UI limit validation
  → ResourceProcessorRegistry core validation
  → MIME sniff / image model copy / SHA-256 dedupe
  → resources store (Blob, IndexedDB)
  → message/event/checkpoint (resource ID only)
  → pi 多模态 user 消息（图片内嵌 data URL + 资源清单）或 resource tools on demand
```

所有资源读取再次检查 session。持久化 resource ID 引用与新 File 一样计入每条 8 个和 50 MiB
总量；缺失、跨 session 或无有效来源的引用直接失败。图片只有在构造 pi 视觉请求或
`read_resource_image` 边界临时转成 data URL；无法解码并验证 2048px 上限时安全拒绝。pi 通道
**没有**旧引擎的「模型拒绝视觉时降级为文本」探测回退：配置的模型不支持图片时带图请求如实
失败。

### 子 Agent（pi 通道）

```text
Root PiSession
  → PiSubagentCoordinator
  ├─ explore child（只读，独立 PiSession 实例）
  ├─ task child（完整工具，不可委派）
  └─ 最多 3 路并发 lifecycle（每 root 6 个、深度 1）
       ↓ structured notification
Root synthesis → 当前 Succinix revision gate
```

每个 delegated task 使用内部唯一持久化 ID；模型提供的 `taskId` 只是业务标签。子 agent 是独立
PiSession 实例（`persistSession: false`，不占独立 pi 会话，避免历史串扰）。子 Run 完整继承
root 的 model-turn/tool-call/wall-clock 上限并独立计数；父或兄弟的消耗不会提前耗尽该 child。
任何 root family 对同一容器的 mutation（apply/materialize/shell）由全局容器 lease 串行。
`ask_user` / `ask_parent` 的阻塞语义在 pi 自治循环中不保留：适配器把问题作为工具结果回传模型，
由模型在回复中向用户提问。`complete_task` 不映射为 pi `terminate`，模型以最终回复呈现完成摘要。

### 能力库（Capability Library）

Agent 可感知的每个工具都必须通过 `defineTool` 携带 `capability` 声明（**编译期强制**，缺声明
无法编译），并登记进 `CapabilityRegistry` 模块宿主。能力库面板、pi 工具 allow-set 与系统提示词
一律读注册表当前状态，不存在第二份手写清单。

```text
defineTool → capability 声明（module / defaultEnabled / warnOnDisable / dependencies）
  → CapabilityRegistry（core 启动注册、不可卸载；extension 运行时热插拔，id `ext:<pluginId>`）
  → resolveEnabledPiTools(config, availability) 派生 allow-set
  → PiSession.enabledTools ∩ 角色工具集
  → 系统提示词按可用能力动态生成
```

- 双层开关：模块总开关控制用户侧功能块（容器关 → 隐藏终端/文件/服务），工具子开关控制 AI 侧
  可感知工具；总开关关 → 该模块工具强制关。Agent运行时工具标「不建议关闭」。
- 可用性：容器为 `enabled | restricted`（受限 = boot 失败，开关即重试入口，不强制禁用）；
  `resolveEnabledPiTools` 在 restricted 时整体排除虚拟容器模块。
- 纯聊天降级：容器关/受限时 `CapabilityAwareRuntime` 提供聊天运行时——容器操作 no-op/空值，
  资源读取始终走 IndexedDB；run 绑定哨兵 `__chat__` containerId，持久化 schema 不变；
  completion 门在 `containerAvailable=false` 或 `shellAvailable=false` 时跳过工作区验证。
- 关闭即释放：`disposeWorkspaceRuntime()` flush 快照落盘 → runtime dispose → 清空单例；
  重开走全新 boot，工作区从 IndexedDB 快照恢复（revision 一并恢复）。Agent run（含子 agent）
  活跃时容器开关锁定，禁止关闭/重试。

### 启动与恢复

```text
Workspace store → load sunam-v3 workspace
  → ensure Succinix/WebContainer root
  → mount latest complete snapshot
  → restore terminal history
  → load latest 250 session events + Runs/tasks
  → active parent/child state becomes interrupted
  → resume：PiSession 打开/创建 IndexedDB 会话 → seedHistory 重建 Agent 转录
  → create a new Run
```

旧 v2 repository/schema/database 等生产模块已完全删除；隔离测试只用原始 IndexedDB API 建立
旧库。生产代码不打开、读取、迁移或删除 `sunam-v2`，设置仍从 `sunam_v2_*` Local Storage 键读取。

### 独立设置页（三栏目）

`SettingsPage` 替代旧弹窗，为以后扩展留栏目位。三个栏目共享 `useAppConfig`（读 Local Storage、
写后 bump version 触发重解析，聊天/顶部选择器即时生效）：

- **供应商**：16 个预设（派生自 `@earendil-works/pi-ai` providers），每个含 base URL、API
  Key、默认模型与请求 API（`openai-completions` / `anthropic-messages`）；全局对话模型 +
  「拉取模型列表」。供应商配置在运行期派生稳定 provider id（baseUrl host），换供应商只需改
  设置，不改代码。
- **皮套**：可复用系统提示词 + 模型参数（temperature/top-p/max tokens）+ 模型绑定（`auto`
  跟随全局模型，或锁定特定供应商+模型）。启用皮套即时出现在聊天模型选择器。
- **关于**：项目信息、GitHub、AGPL-3.0、Succinix 项目链接。

### 规范工作区路径

Succinix/WebContainer 使用真实 workdir `/home/workspace`，每个 Sunam 容器的项目根固定为
`/home/workspace/<containerId>`。`containerId` 是不可变所有权边界，容器名称只是标签；重命名
不会迁移目录。文件 API 使用相对 workdir 的 `<containerId>`，Agent 提示词和 shell 环境保留可
直接执行的规范绝对路径；终端环境栏与文件管理器面包屑只把当前容器项目根显示为 `/`。

主 Agent、任务型子 Agent 和用户终端均以 `<containerId>` 为 `cwd`，并共享
`SUNAM_WORKSPACE=/home/workspace/<containerId>`、`SUNAM_CONTAINER_ID=<containerId>`。它们的
`HOME` 统一为 `/home/workspace`。文件工具只接受相对路径或当前规范绝对路径，并在写入前拒绝
`/home/user`、旧 `.sunam/workspaces`、伪 `/containers`、其他/重复 container root 和 traversal。
快照仍是按 `containerId` 保存的无根内容树。

## 关键契约

### `AgentWorkspaceRuntime`

Agent Core 与 Succinix 的唯一边界：

- container-scoped tree/read/search/apply；
- session-scoped resource list/read/image/materialize；
- 真实 workspace revision 与 flush；
- Agent-owned foreground/background `run_command`（经 Succinix 文件 RPC）、进程观察/输入/停止；
- `(sessionId, runId, containerId)` 所有权；
- runtime 进程事件和只供 Agent 读取的有限用户终端缓冲；Agent 不能向用户交互 shell 注入输入；
- runtime-owned launch/port registry、用户终端启动、managed port stop 和 snapshot-first
  global restart。

所有相对根由 `getContainerRoot(containerId)` 生成，公开绝对根由 `getContainerPublicPath(containerId)`
生成；任何调用方都不能自行拼接、创建显示别名或绕过 `resolveContainerPath()`。

### `AgentDriver`

主 Agent 驱动抽象，UI 与实现解耦：

- `id`（`pi` / `claude-code` / `codex`）与 `capabilities`（steer / subagents /
  requiresLocalEnvironment），调用方据此如实降级；
- `prompt(text)` / `abort()` / `steer?(message)` / `destroy()`；
- `AgentDriverFactoryInput` 在 `AgentDriverInit` 之上叠加应用层运行上下文（runtime / store /
  enabledTools / containerAvailable / attachments / providerApi / samplingParams）。

内置 `PiDriver` 是 PiSession 的薄适配层：只把 PiSession 的能力面对齐 `AgentDriver`，内部逻辑
一字不改。`createPiDriver` 懒加载 PiSession，pi 运行时不进初始 bundle。

### `V3PersistenceRepository`

`sunam-v3` 当前包含 9 个 store：workspace、runs、events、checkpoints、terminalHistory、snapshots、quarantine、resources、agentTasks。

- event append-only；按稳定 session timeline 和单 Run 分别提供最多 250 条的页面查询，并有
  run latest sequence 查询。
- checkpoint 主键是 runId，每 Run 覆盖同一条。
- delegated task 使用内部唯一 ID，模型 taskId 是普通标签。
- child 删除在单事务中移除其 Run/event/checkpoint/delegated task，保留父记录和 session-scoped
  resources；新 root 第一次 spawn 前只裁剪旧 family 的终态 child。
- session/container 删除前取消并等待命中范围的活动父/子 Run；随后在单事务内同步 workspace
  元数据和关联数据，防止删除后数据复活。
- Run/Event/Checkpoint/Message/Resource/AgentTask 的嵌套字段都经过 schema guard；malformed
  record 被隔离，资源 Blob 只存 resources。
- Run、checkpoint、terminal、snapshot 写入分别串行。
- 快照调度器保留至多一个排队 follow-up；显式 flush 先取消尚未触发的 debounce。即使当前写入
  失败，follow-up 也会继续执行。

### Workspace store

store 提供 selector 和无变化短路。相同 session status 不触发 IndexedDB 写入；组件只订阅实际
使用切片。普通 workspace save、session/container 删除和 reset 共用同一串行队列，reload 先
等待队列排空；repository 层也串行相同操作，避免旧保存覆盖新删除元数据。

Agent 工具批次后的 snapshot/Run/event/checkpoint 同步有独立 watchdog。同步开始时先投影
observing 状态；超时或失败时先将 Run 投影为 recoverable failed，再进行有界的尽力持久化，
因此损坏的 snapshot/IndexedDB await 不能让 UI 无限停留在运行中。已成功保存的上一 checkpoint
不被失败路径覆盖。

## 运行与渲染性能

- SSE delta 最多 30 次/秒合并更新，结束强制 flush；未终止 buffer 上限 1 MiB，provider error
  结构化上抛。
- pi 通道：OpenAI-compatible nullable content/reasoning 在 adapter 边界规范化；PiEventBridge
  保留最终消息的 reasoning，React 只负责投影。
- Chat 投影一次建立 `tool_call_id → result` 索引，避免逐消息扫描造成 O(n²)。
- 一条 assistant 消息把正文、思考过程和工具调用投影在同一气泡内。`useLayoutSizeAnimation` 与
  `shared/ui/motion` 是尺寸动画的唯一复用边界；大幅横向变化按最高平均速度 `1px/ms` 延长时长，
  小变化保持空间动效的标准节奏。
- `useChatAutoScroll` 是聊天滚动的唯一所有者。位于底部时即时校正流式内容、Markdown 布局和
  尺寸动画产生的高度变化；只有用户主动「回到底部」才使用平滑滚动。用户的上滚、触摸、键盘或
  滚动条意图会立即脱离跟随。
- 思考过程、工具参数与工具结果各自使用相同的 `96px` 内部滚动视口；工具详情以及 RunBoard 的
  断点/子任务详情默认折叠。UI motion 按 fast feedback、spring direct manipulation、sheet
  layout 和 exit 四类共享 token；所有动效受全局 reduced-motion 约束。
- 初始仅读最近 250 events；上滚自动分页；DOM 固定在当前 250-message 窗口。
- 子 Agent transcript 仅在 Sidebar 选择对应二级入口后按 run 查询最近 250 events；root 页面
  不加载或渲染 child 消息。
- 历史 Markdown 使用 `content-visibility`。只有 5,000-event 基准仍无法满足帧预算时才引入动态
  高度虚拟列表。
- 文件列表不读取每个文件全文计算大小；打开、下载或显式读取后再缓存真实大小。
- 快照导出前排除依赖、构建产物、coverage、Playwright 输出和缓存；10,000 文件/100 MiB 超限
  保留最后成功版本。
- 未配置 API 时不加载 Workspace、Succinix/WebContainer、xterm 和 pi Agent Core；文件管理器与
  终端按需拆包。

## 变更守则

- 新模型协议实现新的 pi-ai adapter，不在 pi session 中加入供应商判断。
- 新资源类型实现 `ResourceProcessor`，不修改 PiSession。
- 新工具先定义 schema、权限、并发、超时、结果和持久化边界，并**必填 `capability` 声明**；
  默认串行和最小权限。缺声明即编译失败。
- 能力开关只影响 AI 侧工具注入；关闭后 agent 不感知、自然终止，不做运行时强制失败。
- feature 间只通过公共入口或 `shared/contracts` 交互；禁止引用其他 feature 内部类型。
- 任何 persistence schema 变更必须同步版本、validator、quarantine、删除语义、恢复测试和文档。
- 写入工作区的能力必须参与真实 Succinix revision 与 mutation lease；验证必须绑定同一 revision。
- shell 是不透明 mutation boundary：进程结束时 runtime 主动推进 revision，不能只依赖异步文件 watch。
- 新增供应商渠道（预设）只改 `providerPresets` 与 pi-ai 的 api 分发，不改引擎。
- UI 嵌套圆角遵循仓库根 `AGENTS.md` 的同心半径规则。
- 架构、持久化、公共行为、验证门或依赖策略发生变化时，同步更新 README 与 `docs/` 中所有
  受影响 Markdown；验证记录不得保留已经解除的阻塞信息。

## 当前架构基线

2026-08-08，pi 全面切换完成：旧 `AgentEngine`/`AgentFamily`/`subagentCoordinator` 已删除，
pi 是唯一引擎；容器环境为 Succinix（TerminalExecutor 文件 RPC + 进程隔离 + 快照双层）；新增
独立设置页（供应商 + 皮套 + 关于）。当前生产构建初始 JS 为 88.09 KiB gzip、总 JS 为
337.59 KiB gzip（pi 懒加载通道另计）、`dist` 为 1.45 MiB；核心自动化 60 文件/374 测试，E2E
18/18、真实 Succinix 3/3、视觉 6/6。覆盖率为 statements 91.04%、branches 83.28%、functions
90.73%、lines 94.94%。生产依赖审计返回 `found 0 vulnerabilities`；开发期 PWA/Workbox advisory
仍按 [依赖策略](dependency-advisories.md) 跟踪。
