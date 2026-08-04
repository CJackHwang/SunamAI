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
| `src/features/agent-core` | AgentEngine、context、工具、资源处理、子 Agent coordinator、能力注册表（`capability/`） | 通过 contracts 使用 runtime/persistence；不穿透其他 feature 内部模块。 |
| `src/features/runtime` | WebContainer 文件、进程、资源 materialize、快照和 revision；`CapabilityAwareRuntime` 纯聊天降级 | 是运行时实现唯一归属；终端组件不拥有 Agent runtime。 |
| `src/features/terminal-session` | 终端标签、服务预览和终端用例 | 只使用公开 runtime/contracts。 |
| `src/features/chat`、`file-manager`、`settings` | 独立交互用例 | 不能直接导入其他 feature 的内部类型。 |
| `src/widgets/capability` | 能力库面板与上下文（`CapabilityProvider`/`CapabilityPanel`/`CapabilitySwitch`） | 组合 registry 清单、持久化配置与运行时可用性；不写第二份清单。 |
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

`AgentEngine` 不依赖 React 或供应商分支。`AgentModelClient` 负责 capabilities、context profile、token estimator、usage 和 content-part 映射。`AgentToolResult` 可以返回 `modelContent` 与 `resourceReferences`，但持久化 sanitizer 不允许 Blob/Base64 进入 ledger。懒加载的 `ConfiguredPage` 页面壳持有 Sidebar 与 Workspace 共用的 Agent controller；临时的 root/child view selection 只存在于 React，不写入 workspace metadata。每个 child 使用独立 Engine/Run/TaskContract，因此它的可选 plan 只投影到自己的只读页面；完成通知逐个返回 root，不共享或改写 sibling task 状态。

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
  ├─ explore child (read-only)
  ├─ task child (complete tools, no delegation)
  └─ up to 3 mixed-role lifecycles concurrently
       ↓ structured notification
Root synthesis → current container revision gate
```

父子 Run 共享 root-family 预算和 container mutation lease，但事件、上下文、取消域和 checkpoint 独立。最多三个 `explore | task` 子 Run 可同时推理和读取；apply/materialize/shell 等实际 mutation 通过进程内全局 container lease 逐次执行，因此不同 root family 操作同一容器也会串行。root Chat 与状态只投影 depth-zero Run；Sidebar 预读可见 session 的轻量 child Run 摘要，只有实际存在 child 的历史行才提供折叠入口，选中后 Workspace 才按需读取并投影该 `runId` 的只读 transcript。停止一个 child 只作用于它自己的取消域。旧持久化 `implement | verify` 记录继续读取，但统一显示为 `task`。

### 能力库（Capability Library）

Agent 可感知的每个工具都必须通过 `defineTool` 携带 `capability` 声明（**编译期强制**，缺声明无法编译），并登记进 `CapabilityRegistry` 模块宿主。能力库面板、引擎工具 allow-set 与系统提示词一律读注册表当前状态，不存在第二份手写清单。

```text
defineTool → capability 声明（module / defaultEnabled / warnOnDisable / dependencies）
  → CapabilityRegistry（core 启动注册、不可卸载；extension 运行时热插拔，id `ext:<pluginId>`）
  → resolveEnabledTools(config, availability) 派生 allow-set
  → AgentEngine.enabledTools ∩ 子角色工具集
  → 系统提示词按可用能力动态生成
```

- 双层开关：模块总开关控制用户侧功能块（容器关 → 隐藏终端/文件/服务），工具子开关控制 AI 侧可感知工具；总开关关 → 该模块工具强制关。Agent运行时工具标「不建议关闭」。
- 可用性：容器为 `enabled | restricted`（受限 = boot 失败，开关即重试入口，不强制禁用）；`resolveEnabledTools` 在 restricted 时整体排除虚拟容器模块。
- 纯聊天降级：容器关/受限时 `CapabilityAwareRuntime` 提供聊天运行时——容器操作 no-op/空值，资源读取（`list_resources`/`read_resource_text`/`read_resource_image`）始终走 IndexedDB（与容器无关，附件仍可分析）；run 绑定哨兵 `__chat__` containerId，持久化 schema 不变；completion 门在 `containerAvailable=false` 或 `shellAvailable=false` 时跳过 workspace 验证。
- 关闭即释放：`disposeWorkspaceRuntime()` flush 快照落盘 → `runtime.dispose()` → `resetWebContainer()` → 清空单例；重开走全新 boot，工作区从 IndexedDB 快照恢复（revision 一并恢复）。Agent run（含子 agent）活跃时容器开关锁定，禁止关闭/重试。
- 容器启动中（重开/受限重试）：composer 显示「容器启动中」并禁用输入，Sunam 电脑/终端显示加载态；移动视图默认停在聊天页，用户主动启动时才跳到容器页面。
- 合并的「Sunam的电脑」视图：终端/用户 shell/服务/文件四个子视图合并到单一电脑页，由底部胶囊型灵动岛分段切换（点击、移动端横向滑动、方向键）；顶部模块选择器收敛为 电脑 + 能力库，移动端底部导航为 对话 / 电脑 / 能力库。胶囊轨道用聊天背景同款灰（`--color-bg`）配白色滑块，高度/底部间距/上间距对齐聊天输入框与任务列表，黑色终端面板左右上边距与胶囊间距一致（`--capsule-gap`，10px）；空间不足时各段收敛为纯 icon，并以 `useLayoutSizeAnimation`（spatial `--motion-slow --motion-sheet`）伸缩过渡。xterm 终端移动端通过触摸拖动手势（纵向主导 → 合成 WheelEvent）支持滚动。

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

Workspace store 在 hydrate 前接收当前 locale 的非持久化创建默认值。首次工作区、reset、后续新会话和新容器使用创建当下的语言；持久化结构仍只保存最终字符串。历史中、英、日默认空会话由统一 helper 识别，自定义名称和已有记录不会因切换语言被改写。

### 规范工作区路径

WebContainer 使用真实 workdir `/home/workspace`，每个 Sunam 容器的项目根固定为 `/home/workspace/<containerId>`。`containerId` 是不可变所有权边界，容器名称只是标签；重命名不会迁移目录。文件 API 使用相对 workdir 的 `<containerId>`，Agent 提示词和 shell 环境保留可直接执行的规范绝对路径；终端环境栏与文件管理器面包屑只把当前容器项目根显示为 `/`，不会暴露或伪造另一套可执行路径。

主 Agent、任务型子 Agent和用户终端均以 `<containerId>` 为 `cwd`，并共享 `SUNAM_WORKSPACE=/home/workspace/<containerId>`、`SUNAM_CONTAINER_ID=<containerId>`。它们的 `HOME` 统一为 `/home/workspace`，故 `jsh` 的 `.jshrc` 等运行时文件位于项目根之外。文件工具只接受相对路径或当前规范绝对路径，并在写入前拒绝 `/home/user`、旧 `.sunam/workspaces`、伪 `/containers`、其他/重复 container root 和 traversal。快照仍是按 `containerId` 保存的无根内容树，无需数据库迁移。

文件管理器的“导出完整工作区”直接调用 WebContainer ZIP export，并始终以当前容器根为目标，即使用户正在浏览子目录。该用户下载不传快照 exclusions，因此包含隐藏文件、依赖与构建输出；持久化快照仍按恢复策略排除这些生成内容。两种导出不共享范围策略，完整 ZIP 下载也不改变 workspace revision。

### 服务与端口生命周期

`WebContainerAgentRuntime` 与 WebContainer 共享单例生命周期，并通过 runtime service registry 统一拥有 Agent shell、用户终端、端口事件和停止动作。每次受控启动记录 launch ID、来源、容器、进程句柄、状态和时间；Node 子进程通过 `.sunam/runtime` 下的 preload 在 `net.Server.listen` 成功后写入实际 PID/port/launch ID。该目录位于容器项目根之外，不进入工作区快照。

端口依次处于 identifying、managed、stopping 或 orphaned。managed 端口使用保留句柄或监听器报告的 PID 精确停止；UI 不根据端口猜 PID。orphaned 仅代表历史遗留或运行时状态损坏，服务面板会明确提示“强制重启关闭”。该动作必须由用户确认，先 flush 全部快照，再重启全局 WebContainer；快照失败时不 teardown，所有错误保持可见。

## 关键契约

### `AgentWorkspaceRuntime`

Agent Core 与 WebContainer 的唯一边界：

- container-scoped tree/read/search/apply；
- session-scoped resource list/read/image/materialize；
-真实 workspace revision 与 flush；
- Agent-owned foreground/background `shell_run`、进程观察/输入/停止；
- `(sessionId, runId, containerId)` 所有权；
- runtime 进程事件和只供 Agent 读取的有限用户终端缓冲；Agent 不能向用户交互 shell 注入输入。
- runtime-owned launch/port registry、用户终端启动、managed port stop 和 snapshot-first global restart。

所有 WebContainer 相对根由 `getContainerRoot(containerId)` 生成，公开绝对根由 `getContainerPublicPath(containerId)` 生成；任何调用方都不能自行拼接、创建显示别名或绕过 `resolveContainerPath()`。

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
- child 删除在单事务中移除其 Run/event/checkpoint/delegated task，保留父记录和 session-scoped resources；新 root 第一次 spawn 前只裁剪旧 family 的终态 child。
- session/container 删除前取消并等待命中范围的活动父/子 Run；随后在单事务内同步 workspace 元数据和关联数据，防止删除后数据复活。
- session 删除清理该 session 的 Run/event/checkpoint/resource/task 与 terminal history；container 删除清理该 container 的 Run 侧链、资源归属和 snapshot，不宣称删除无法按 container 定位的 session terminal history。
- Run/Event/Checkpoint/Message/Resource/AgentTask 的嵌套字段都经过 schema guard；malformed record 被隔离，资源 Blob 只存 resources。
- Run、checkpoint、terminal、snapshot 写入分别串行。
- 快照调度器保留至多一个排队 follow-up；显式 flush 先取消尚未触发的 debounce，避免同一变更重复保存。即使当前写入失败，follow-up 也会继续执行，失败不会毒化后续队列。

### Workspace store

store 提供 selector 和无变化短路。相同 session status 不触发 IndexedDB 写入；组件只订阅实际使用切片。普通 workspace save、session/container 删除和 reset 共用同一串行队列，reload 先等待队列排空；repository 层也串行相同操作，避免旧保存覆盖新删除元数据。

Agent 工具批次后的 snapshot/Run/event/checkpoint 同步有独立 watchdog。同步开始时先投影 observing 状态；超时或失败时先将 Run 投影为 recoverable failed，再进行有界的尽力持久化，因此损坏的 snapshot/IndexedDB await 不能让 UI 无限停留在运行中。已成功保存的上一 checkpoint 不被失败路径覆盖。

## 运行与渲染性能

- SSE delta 最多 30 次/秒合并更新，结束强制 flush；未终止 buffer 上限 1 MiB，provider error 结构化上抛。
- OpenAI-compatible nullable content/reasoning 在 SSE adapter 边界规范化；AgentEngine 保留最终消息的 reasoning，React 只负责投影。
- Chat 投影一次建立 `tool_call_id → result` 索引，避免逐消息扫描造成 O(n²)。
- 一条 assistant 消息把正文、思考过程和工具调用投影在同一气泡内。`useLayoutSizeAnimation` 与 `shared/ui/motion` 是尺寸动画的唯一复用边界：一次复合布局变化只由最近的外层气泡持有宽高动画，嵌套 disclosure 直接提交最终原生状态，避免折叠与工具插入互相争夺尺寸。大幅横向变化按最高平均速度 `1px/ms` 延长时长，小变化保持空间动效的标准节奏。
- `useChatAutoScroll` 是聊天滚动的唯一所有者，观察显式 transcript 内容边界。位于底部时即时校正流式内容、Markdown 布局和尺寸动画产生的高度变化；只有用户主动“回到底部”才使用平滑滚动。用户的上滚、触摸、键盘或滚动条意图会立即脱离跟随，布局更新不能把阅读位置误判为用户操作。
- 思考过程、工具参数与工具结果各自使用相同的 `96px` 内部滚动视口，不叠加外层高度裁剪；工具详情以及 RunBoard 的断点/子任务详情默认折叠。UI motion 按 fast feedback、spring direct manipulation、sheet layout 和 exit 四类共享 token；React presence 保留时间覆盖对应 CSS 退场时长，所有动效受全局 reduced-motion 约束。
- 初始仅读最近 250 events；上滚自动分页；DOM 固定在当前 250-message 窗口。
- 子 Agent transcript 仅在 Sidebar 选择对应二级入口后按 run 查询最近 250 events；root 页面不加载或渲染 child 消息。
- 历史 Markdown 使用 `content-visibility`。只有 5,000-event 基准仍无法满足帧预算时才引入动态高度虚拟列表。
- 文件列表不读取每个文件全文计算大小；打开、下载或显式读取后再缓存真实大小。
- 快照导出前排除依赖、构建产物、coverage、Playwright 输出和缓存；10,000 文件/100 MiB 超限保留最后成功版本。
- 未配置 API 时不加载 Workspace、WebContainer、xterm 和 Agent Core；文件管理器与终端按需拆包。

## 变更守则

- 新模型协议实现新的 `AgentModelClient` adapter，不在 Engine 中加入供应商判断。
- 新资源类型实现 `ResourceProcessor`，不修改 AgentEngine。
- 新工具先定义 schema、权限、并发、超时、结果和持久化边界，并**必填 `capability` 声明**（module 归属、默认开关、依赖）；默认串行和最小权限。缺声明即编译失败。
- 能力开关只影响 AI 侧工具注入；关闭后 agent 不感知、自然终止，不做运行时强制失败。
- feature 间只通过公共入口或 `shared/contracts` 交互；禁止引用其他 feature 内部类型。
- 任何 persistence schema 变更必须同步版本、validator、quarantine、删除语义、恢复测试和文档。
- 写入工作区的能力必须参与真实 container revision 与 mutation lease；验证必须绑定同一 revision。
- shell 是不透明 mutation boundary：进程结束时 runtime 主动推进 revision，不能只依赖异步文件 watch。
- UI 嵌套圆角遵循仓库根 `AGENTS.md` 的同心半径规则。
- 架构、持久化、公共行为、验证门或依赖策略发生变化时，同步更新 README 与 `docs/` 中所有受影响 Markdown；验证记录不得保留已经解除的阻塞信息。

## 当前架构基线

2026-08-03，架构边界检查已随一次完整门禁通过（`npm run check`，含能力注册审计 tripwire）。当前生产构建初始 JS 为 88.03 KiB gzip、总 JS 为 335.95 KiB gzip、`dist` 为 1.44 MiB；核心自动化 59 文件/370 测试，E2E 15/15、真实 WebContainer 3/3，视觉 3/4（移动端「能力库」入口基线待重生成）。覆盖率为 statements 91.04%、branches 83.28%、functions 90.73%、lines 94.94%。生产依赖审计返回 `found 0 vulnerabilities`；开发期 PWA/Workbox advisory 仍按 [依赖策略](dependency-advisories.md) 跟踪。本轮不声明连续两次完整门禁要求的优化冻结复验。
