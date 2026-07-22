# 架构与依赖边界

本文描述当前生产代码的模块职责、单向依赖和关键数据流。它是实现变更的边界说明；Agent 的执行规则见 [Agent Core v2 设计](agent-v2-design.md)，发布验证见 [验收清单](refactor-acceptance.md)。

```text
shared → entities → features → widgets → pages → app
```

- `shared` 提供浏览器存储、i18n、LLM/SSE、跨功能契约、通用 UI 与样式 token；不得依赖业务功能。
- `entities` 包含消息、Agent、会话、容器、文件的领域类型，以及只协调工作区元数据与持久化状态的 workspace store。
- `features` 实现独立用例：Agent Core、会话标题、终端、文件管理、设置。
- `widgets` 只组合功能。Workspace 负责页面状态与布局，Sidebar 负责工作区资源入口。

## 目录职责

| 目录 | 职责 | 可以依赖 | 不应依赖 |
| --- | --- | --- | --- |
| `src/app` | 应用根、全局样式、Provider 装配 | `pages`、`shared` | `features` 的具体实现细节 |
| `src/pages` | 页面级状态与路由入口 | `widgets`、`features` 的公开接口、`shared` | 运行时底层实现 |
| `src/widgets` | 多个功能的页面组合 | `features`、`entities`、`shared` | 反向依赖 `pages` |
| `src/features` | 可独立交付的用户用例 | `entities`、`shared` | 其他 feature 的内部模块 |
| `src/entities` | 领域类型和工作区元数据 | `shared` | UI、运行时与 feature 实现 |
| `src/shared` | 框架无关的基础设施和通用 UI | 同目录内的低层模块 | 业务领域和页面模块 |

跨层调用应通过导出的类型、Hook 或运行时契约完成。若一个能力需要同时被 Agent、终端和文件管理器使用，应优先在 `shared/contracts` 或实体层定义契约，而不是在组件之间传递实现对象。

## 两条核心数据流

```text
用户请求
  → AgentEngine → AgentModelClient → OpenAI-compatible API
  ← 工具调用 / 文本 ← SSE 解析
  → AgentToolRegistry → AgentWorkspaceRuntime → WebContainer
  → AgentEventStore → V2PersistenceRepository → IndexedDB
  → React 投影（聊天、RunBoard、终端）

浏览器启动
  → Workspace store 加载 workspace 元数据
  → WebContainer 挂载文件快照
  → 恢复终端历史与 Agent event ledger
  → 活动 Run 标记为 interrupted
  → 用户显式继续时创建新的 Run
```

第一条链中的 AgentEngine 不依赖 React；UI 只读取 Run 和事件的投影。第二条链严格按顺序恢复，避免在文件系统尚未挂载时把旧终端或 Agent 状态展示为可用。

## 关键契约

- `AgentWorkspaceRuntime` 是 Agent Core 与 WebContainer 的唯一边界：受容器根目录约束的文件读取/搜索/写入、前后台进程、输出游标、取消与事件订阅。`WebContainerAgentRuntime` 拥有进程；终端仅渲染和手动控制它。所有容器路径唯一由 `getContainerRoot(containerId)` 生成；它是相对于 `WebContainer.workdir` 的 `.sunam/workspaces/{containerId}`，交互 Shell 使用 `workdir` 拼出的绝对路径，禁止从 Agent、终端或文件管理器各自拼接根目录。
- `features/agent-core` 是唯一的 Agent 执行内核。每个 Run 拥有固定的 session、container、模型、人格、Task Contract、Chaos Contract、预算和 append-only 事件序列；不存在旧的纯 loop 或运行时回退路径。
- Tool Registry 以 schema、只读/并发属性和结构化 `AgentToolResult` 描述工具。只读工具至多四路并发，写入和命令按容器串行；所有工具结果回流下一次模型请求。验证命令无论成功或失败都会成为不可伪造的证据，这些证据将被加入 Task Contract。
- LLM API 层独立构造 OpenAI-compatible 请求、解析 SSE、列模型；Agent Core 通过 `AgentModelClient` 使用它，因此未来协议只能新增 Adapter，不能进入执行内核。
- `V2PersistenceRepository` 是唯一的持久化入口。它在 IndexedDB `sunam-v2` 中以版本化 record 存放 workspace、Run、append-only event、checkpoint、Agent 终端历史、容器文件系统快照和隔离区；不存在全局内存降级。损坏或未知版本的 record 会隔离，关键 workspace 记录损坏时暂停编辑且绝不写入替代工作区。
- Agent Event Store 以内存作为热缓存、以 v2 ledger 作为事实来源；它从不导入旧消息或旧 Run。启动时活动 Run 会标记为 `interrupted`，只能依据 checkpoint **新建** Run 续作，旧 PID、AbortController 与实时订阅绝不恢复。
- 设置使用独立的 `sunam_v2_*` 键；工作数据只在 `sunam-v2` 数据库中读取。旧 `sunam_*` 键、旧工作区、消息、终端历史和旧数据库从不读取、转换、删除或备份，不存在向下兼容路径。
- `WorkspaceRuntimeProvider` 是 WebContainer 单例的 UI 生命周期边界：在 Workspace 懒加载后才创建 `WebContainerAgentRuntime`，在 `pagehide` 和卸载时 flush 快照。文件系统 watch 经防抖快照调度器串行写入，避免重叠导出。
- `shared/i18n` 提供 `zh-CN`、`en-US`、`ja-JP` 三份类型安全词条；选定语言在首屏直接成为当前词典，不先渲染中文占位。

## 变更守则

- 新增模型协议时，实现 `AgentModelClient` 适配器；不要在 `AgentEngine` 中加入供应商分支。
- 新增工具时，先在 `AgentToolRegistry` 定义输入 schema、只读属性、并发安全性、超时和结果语义。默认最小权限和串行执行。
- 文件路径必须通过容器根目录和现有路径工具解析，不能信任来自模型或 UI 的原始路径。
- 任何持久化格式变更都要更新 record 校验、版本化/隔离策略和相应测试；不能以静默内存回退替代持久化失败。
- 需要跨模块复用的状态先确认其领域归属：工作区元数据属于 `entities`，浏览器运行时归 `features/runtime`，通用浏览器能力归 `shared`。

## 性能原则

- 页面未配置 API Key 时不加载 Workspace、WebContainer、xterm、文件管理或 Agent Core；Runtime Provider 不在应用根部初始化 WebContainer。
- 切换终端标签不销毁 xterm；文件面板首次加载后保持实例。
- 流式 assistant delta 是 transient 事件，不进入长期 transcript；上下文达到阈值后由 Context Composer 摘要，连续失败后确定性裁剪。
- Agent 终端输出按 session 持久化，切换标签和刷新后可恢复；输出显示仍有长度边界，避免无上限的 DOM/上下文增长。
- `V2PersistenceRepository` 只保留在线运行实际使用的类型化读写接口；IndexedDB 不可用时暂停编辑并提示重试，不使用易造成数据错觉的内存降级。
