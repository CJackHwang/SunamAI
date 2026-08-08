# Sunam Agent 运行设计

本文描述当前已落地的 Agent 执行内核：**pi** 会话、驱动抽象、事件桥接、自动上下文压缩、资源
附件、持久化恢复和子 Agent 编排。文件名中的 `v2` 是历史路径；正文所称 Agent Core 指执行内核
代际。工作数据库是 `sunam-v3`，pi 会话数据库是独立的 `sunam-pi-sessions`。

Sunam 借鉴 [Claude Code 分析仓库](https://github.com/liuup/claude-code-analysis) 的可迁移
原则：执行内核与 UI 解耦、工具调用按完整轮次管理、事实事件先行持久化、恢复重建而非复活、
上下文按预算自动收缩。Sunam 不复制 Claude 的固定 200k 常量，而由模型适配器提供 profile。

旧引擎（`AgentEngine` / `AgentFamilyCoordinator` / `subagentCoordinator`）已删除；**pi 框架
（`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）是唯一执行内核**。

## 1. 运行结构

```text
React Workspace / RunBoard
  └─ WorkspaceRuntimeProvider
       ├─ Succinix runtime（文件 RPC client / host 生命周期 / 快照双层 / 进程注册表）
       │    ├─ WorkspaceFileSystem
       │    ├─ ProcessRegistry（scope + containerId）
       │    ├─ SuccinixFileSnapshot（succinix-persist）
       │    └─ session-scoped resources
       └─ AgentDriver（默认 PiDriver）
            └─ PiSession（pi Agent，懒加载）
                 ├─ pi-ai Models（openai-completions / anthropic-messages）
                 ├─ 18 个 pi AgentTool（TypeBox schema 适配）
                 ├─ PiEventBridge → AgentEventStore → v3（sunam-v3）
                 ├─ IndexedDbSessionRepo（sunam-pi-sessions）
                 ├─ PiCompactionRunner（90% 压缩）
                 └─ PiSubagentCoordinator（3 路并发子 agent）
```

`PiSession` 是唯一静态依赖 pi 包的位置，由 `useAgentV2` 通过动态 import 懒加载，pi 的
~100KiB gzip 不进初始 bundle。UI 只订阅 Run/Event 投影；Succinix 行为通过
`AgentWorkspaceRuntime` 注入；供应商协议只存在于 pi-ai adapter。

## 2. 驱动抽象（AgentDriver）

壳（UI）→ `AgentDriver` 接口 → 实现：

```text
AgentDriver
  ├─ PiDriver（内置默认，pi 通道，P1-P5 已完成）
  ├─ ClaudeCodeDriver（适配器：调 claude CLI -p 模式，可选实验）
  └─ CodexDriver（适配器骨架：调 codex CLI，可选实验）
```

`AgentDriver` 接口对齐 piSession 的能力面（prompt / abort / steer / destroy + 事件桥接），
**不绑定 pi 类型**——纯抽象，pi 实现与未来外部 CLI 桥都实现它。`AgentDriverCapabilities`
（steer / subagents / requiresLocalEnvironment）让 `useAgentV2` 如实降级不支持的能力：
外部 CLI 桥在真实集成前不支持 steer 与子 agent，且 `requiresLocalEnvironment: true`（浏览器壳
内不可 spawn CLI）；pi 驱动三者分别为 `true / true / false`。

`PiDriver` 是 PiSession 的薄适配层：只把能力面对齐接口，piSession 内部逻辑一字不改。
`createPiDriver` 动态 import PiSession 实现懒加载。事件桥接仍由 PiSession 的 PiEventBridge
完成，经 `AgentDriverInit.onEvent/onRunChange` 交给 useAgentV2。

## 3. Run 状态机与完成门

```text
preparing → planning → acting → observing / verifying
任意活动态 → cancelling → cancelled
任意活动态 → failed
刷新活动 Run → interrupted → 新 Run 继续
外部阻塞 → awaiting_user
计划、证据、当前 revision 验证通过 → completed
```

每个 Run 固定 session、container、模型、人格（皮套）、预算、任务契约和取消域。pi 通道的
`complete_task` **不**映射为 pi `terminate`：自治循环中模型应把完成摘要作为最终回复，而非在
工具批次后静默停住。`ask_user` / `ask_parent` 的阻塞语义（awaiting_user / awaiting_parent）
在 pi 通道无法暂停等待 UI 输入：适配器把问题作为工具结果原样回传模型，由模型在后续回复中向
用户提问；`ask_parent` 在根 Agent 下本就不合法，直接以失败 throw。

恢复永远创建新 runId、AbortController 和事件侧链，并记录 `parentRunId`。旧请求、进程、PID 和
控制器不会复活。刷新时活动父 Run、子 Run 和 delegated task 都变为 `interrupted`。

## 4. 一轮执行（pi 通道）

1. 检查 Run 与 root-family 的时间、模型轮数和工具总数预算。
2. 确保 Succinix 容器已恢复，读取真实 workspace revision。
3. 计算完整请求预算：系统提示、工具 schema、媒体估算和 transcript；必要时自动 compact
   （P5，见 §7）。
4. 调用模型（pi-ai `models.streamSimple`）；网络、429 与 5xx 仅做有限退避。
5. assistant tool call 与匹配 tool result 作为完整组进入 transcript。终止控制调用只能位于
   批次末尾，否则整批拒绝。
6. 工具执行：只读类可并行，变更/进程类通过 `executionMode: 'sequential'` 强制串行；所有前台
   shell 都按真实 exit status 和命令结束后的 revision 记录验证，不解析命令名、脚本、参数、
   端口或 shell 组合；后台 shell 只记录进程进度并撤销旧 pass。
7. 工具批次后进入独立 watchdog 约束的同步阶段，flush 工作区、更新任务、保存单一 checkpoint
   和事件尾序号。超时/失败先把 Run 投影为可恢复 failed，再做有界的尽力持久化。
8. 同一工具与参数连续第三次出现时只给一次 recovery guidance；第四次仍重复则立即失败。
9. root 的必需计划以及任何已创建的 child 计划都必须完成；root 还要满足当前 workspace revision
   验证才能结束。验证相关性和真实性由系统 prompt 约束。

## 5. 事件桥接（PiEventBridge）

pi 事件流 → 现有 UI 状态层可消费的 `AgentEvent`：

- `agent_start` → `run_started` + `phase_changed`（planning）；
- `message_start`（user）→ `message` 事件（含附件 chips 元数据）；
- `message_update`（assistant）→ `assistant_delta`（transient，含 reasoning 与 streaming
  toolCalls）；
- `message_end`（toolResult）→ `message`（role:'tool'）；assistant → 落定 `message`；
  `stopReason === 'aborted'` → cancelled；`stopReason === 'error'` → failed；
- `tool_execution_start` / `tool_execution_end` → `tool_started` / `tool_finished`
  （RunBoard / 事件订阅 / v3 持久化消费）；usage.modelTurns / toolCalls 累计真实化；
- `agent_end` → `phase_changed`（completed）+ `run_finished`（summary）。

所有事件经 `store.append` 尽力而为写入 v3；transient 事件自动跳过。pi 压缩开始/结束经
`context_compaction_status`（transient）驱动现有 UI 压缩指示。

## 6. pi 会话与 IndexedDB 持久化

- **pi 会话**：`PiSession` 按现有 UI sessionId 打开或创建持久化 pi 会话（`IndexedDbSessionRepo`，
  数据库 `sunam-pi-sessions`）。`persistSession: false` 的子 agent 场景跳过会话仓库，避免子
  run 串扰根会话历史。
- **IndexedDB 会话后端**（P2）：内存态保留一份完整会话状态，所有读走内存；每次写先落一条
  `mutation` 到 IndexedDB（追加式，按 `[sessionId, seq]` 唯一），再应用到内存态。刷新/重建时
  按 seq 顺序重放全部 mutation。使用浏览器原生 IndexedDB API，不引第三方库。
- **边界（如实）**：仅单标签页、单写入者模型，不跨设备/标签页同步；受浏览器存储配额限制，
  QuotaExceeded 如实上抛；与 v3（`sunam-v3`）完全独立、互不迁移；删除工作区不会自动清理 pi
  会话记录。
- **v3 事件同步**：桥接出的 AgentEvent 经 `store.append` / `store.saveRun` 写 v3，使刷新后
  UI 聊天列表能从 v3 恢复 pi 消息；写入尽力而为，失败不阻断事件桥接。
- **刷新恢复**：凭据与会话历史就绪后，`loadHistory` 走 pi `buildSessionContext`——有
  compaction entry 时只重建「最新摘要消息 + 保留尾 + 后续消息」，再把历史 `seedHistory` 进
  agent 转录。

## 7. 自动上下文压缩

`ModelContextProfile` 提供：context window、默认输出额度、总结预留和安全缓冲。已知模型映射到
明确 profile；未知 OpenAI-compatible 模型使用保守 32k。

pi 通道把 pi 的 compaction API（`shouldCompact` / `prepareCompaction` / `compact` /
`createCompactionSummaryMessage`）编排成与旧引擎一致的「触发 → 摘要 → 裁剪 → 继续」：

- **阈值**：`PI_COMPACTION_TRIGGER_RATIO = 0.9`——上下文估算达到有效窗口 90% 前自动触发；
  `reserveTokens` 使 pi 触发点 = 旧引擎触发点（二者仅取整方式不同）。
- **保留**：`PI_COMPACTION_RETENTION_RATIO = 0.1`——`keepRecentTokens = floor(effectiveTokens
  * 0.1)`，即保留 ~10% 近期上下文（90% 压缩）。
- **摘要**：pi 默认结构化摘要 + 自定义附加指令，保留任务目标 / 已完成 / 待办 / 关键约束 /
  决策 / 文件路径 / 未解决风险。summary 输入剥离图片、Blob、文档正文、Base64。
- **持久化**：压缩结果写回 pi 会话（compaction entry），刷新后只重建「最新摘要 + 保留尾 +
  后续消息」。压缩成功后立即覆盖 Run summary 和 checkpoint。

**差异（如实标注，不隐藏）**：

- 兜底策略：旧引擎在语义压缩失败时有「确定性兜底摘要」；pi 的 `compact()` 只走 LLM 摘要，
  失败时跳过压缩继续对话（不阻断 prompt）。
- UI 事件：pi 通道只发 transient 的 `context_compaction_status`，不发非 transient
  `context_compacted`（UI 视觉零改动）；前后 token 统计仅在 PiSession 内部记录。
- 缓冲语义：pi 的 `reserveTokens` 只承担「窗口 - 触发点」差值并同时充当摘要预算，旧引擎把
  defaultOutput/summaryReserve/safetyBuffer 作为独立缓冲。
- 轮次裁剪：pi 的 `findCutPoint` 支持跨轮次剪切（被截断的 turn 前缀单独摘要），保留更激进。
- token 估算：pi 用保守字符启发式 `estimateTokens`（约 chars/4），只用于触发与统计。

## 8. 资源附件

`AgentResource` 元数据包含：`id、sessionId、originatingRunId、name、kind、mimeType、size、
sha256、createdAt`。Blob 与可选模型图片副本只存入 `resources` store；消息、事件和 checkpoint
仅保存资源 ID。

限制在 UI 与 `ResourceProcessorRegistry` 两层执行：每条消息最多 8 个；文本 2 MiB、图片
10 MiB、二进制 20 MiB、单批 50 MiB。已持久化 resource ID 也计入数量和总量，缺失、跨 session
或没有 File/resource ID 的附件直接失败。处理流程在整批通过前不写库。

- 文本/代码：检测明显二进制内容，通过 `read_resource_text` 按行和 token 范围读取。
- PNG/JPEG/WebP/GIF：嗅探真实 MIME，最长边 2048，模型副本 ≤1.5 MiB，原图保留；浏览器无法
  解码并验证尺寸时安全拒绝。
- 其他二进制：保存元数据和 Blob，可通过 `materialize_resource` 复制到工作区。
- 同一 session 按 SHA-256 去重。容器删除时若另一个 Run 仍引用资源，会重置来源归属。
- pi 多模态：用户消息内嵌图片（data URL）+ 资源清单；`read_resource_image` 的 modelContent
  （image_resource 持久引用）经 `loadImageData` 转成 pi image 内容块回传。

**如实边界**：pi 通道**没有**旧引擎的「模型拒绝视觉时降级为文本描述」探测回退。若配置的模型
不支持图片，带图消息会以供应商错误如实失败（不静默吞图）。

## 9. 子 Agent Runtime（pi 通道）

根 Agent 通过以下工具分工：

- `spawn_subagent({ task_id, role, prompt, write_scope? })`
- `wait_subagents({ run_ids })`
- `message_subagent({ run_id, message })`
- `stop_subagent({ run_id })`（模型侧以 wait/stop 语义编排）

每个 delegated task 使用内部唯一持久化 ID；模型提供的 `taskId` 只是业务标签，重复标签不会
覆盖其他任务。子 agent 是**独立 PiSession 实例**（`persistSession: false`），拥有独立 runId、
事件侧链、上下文、预算和 AbortController，只继承父摘要、Task Contract、资源 manifest、
workspace revision 和明确目标，不复制父 transcript。编排由 `PiSubagentCoordinator` 完成。

约束：

- 最大深度 1；子 Agent 不能再委派（子 agent 会话注入 `PI_CHILD_NO_DELEGATION` 哨兵 host）。
- 每个 root 最多 6 个子 Run，同时最多运行 3 个任意角色的 child lifecycle。
- 新任务只区分 `explore` 与 `task`：explore 只读；task 拥有完整 workspace/resource/process/
  control 工具但不能递归委派，并可受 write scope 约束。
- `spawn_subagent` 对模型发布顶层 `type: object` 的参数 schema；角色条件通过 object refinement
  校验，避免兼容服务在模型执行前拒绝 union-root function schema。
- explore/task 可并行推理和读取；任何 root family 以及其他 family 对同一容器的 mutation 都
  由全局容器 lease 串行化。
- 每个子 Run 完整复制当前 root Run 的 model-turn、tool-call 和 wall-clock 上限，并使用独立
  计数器；父或兄弟的消耗不会缩短该 child 的预算。parent cancellation 仍会停止 child。
- 子 Agent 完成不受强制 workspace verification 门禁限制；验证是可选证据，任何已执行检查仍
  必须如实上报。root 自身的计划、revision 与 verification 完成门保持不变。
- notification 返回 status、summary、evidence、changed paths、verification records、workspace
  revision、usage 和 blocked reason。通知一个 child 只写 root 的综合任务状态。
- parent 等待结果时把真实 revision 合并到自己的任务；child 写入使旧验证失效。

主聊天的消息、流式文本、active/latest Run、RunBoard 和 session 状态只投影 depth-zero Run。
Sidebar 预读可见父会话的轻量 child Run 摘要，只有确实保留 child 的会话才显示折叠入口；子项
以 `role + delegatedTaskId` 作为身份，选择后才按 `runId` 读取该 child 最近 250 条事件。child
transcript 永不注入主聊天。v1 不实现 team、mailbox、递归 swarm、teammate 互聊或并行 writer。

## 10. 工具和权限

每个工具必须声明 Zod schema、只读/并发属性、数据影响、超时和结果类型，并**必填 `capability`
声明**（归属模块、默认开关、`warnOnDisable`、依赖工具）——缺声明编译失败。`CapabilityRegistry`
模块宿主是工具 allow-set 的唯一真源。能力关闭只影响注入，agent 不感知、自然终止。pi 工具
schema 用手写 zod → TypeBox 映射，不引入第三方转换库；失败以 throw 呈现（pi 执行模型约定）。

18 个工具：工作区（`workspace_tree` / `read_file` / `search_workspace`）、进程
（`run_command` / `manage_process` / `read_user_terminal`）、资源（`list_resources` /
`read_resource_text` / `read_resource_image` / `materialize_resource`）、子 agent
（`spawn_subagent` / `wait_subagents` / `message_subagent`）与控制（`update_plan` /
`report_progress` / `ask_user` / `ask_parent` / `complete_task`）。

- Succinix 真实 workdir 为 `/home/workspace`，项目根是 `/home/workspace/<containerId>`。Agent、
  子 Agent、用户终端、FileManager、资源物化和快照只使用这一命名空间。
- 进程所有权是 `(sessionId, runId, containerId)`；不匹配的观察、输入和停止失败。
- 文件工具接受相对路径或当前规范绝对路径；`/home/user`、旧 `.sunam/workspaces`、伪
  `/containers`、traversal 等在读写前失败。
- 关闭已登记服务必须使用 Agent process ID，不通过端口猜 PID。显式停止异步等待一次
  post-stop revision flush。
- Agent shell 与用户终端都由 runtime service registry 登记；Succinix host 进程表携带 scope
  与 containerId，跨容器查询/kill 被过滤/拦截。
- 后台 `run_command` 用于服务等持续进程，不单独制造 workspace mutation。
- write scope 同时约束 `apply_patch`（已删）与 `materialize_resource`；文件写入走
  `run_command`（heredoc / `sed` / `node fs`）。
- `AgentToolResult.modelContent` 和 `resourceReferences` 可影响下一次模型内容，但不会把 Blob
  放入 ledger。

## 11. v3 持久化与恢复

生产数据库为 `sunam-v3`。旧 v2 database/repository/schema 等生产实现已删除，隔离测试直接使用
原始 IndexedDB API 建立旧库。浏览器中的 `sunam-v2` 仍保留，但生产代码不打开、不读取、不迁移、
不删除。Local Storage 设置仍使用 `sunam_v2_*` 以保留连接和语言配置。pi 会话数据库
`sunam-pi-sessions` 独立于 v3。

v3 stores：workspace、runs、events、checkpoints、terminalHistory、snapshots、resources、
agentTasks、quarantine。

- events append-only，按 session/run + sequence 建索引；主聊天自动向上分页，子 Run transcript
  按展开动作加载。
- 每个 Run 只有一个覆盖式 checkpoint，保存摘要、最近完整消息组、event tail、workspace
  revision 和资源 ID。
- 单独删除 child 时先等待该 Run 进入终态，再在一个事务中删除 child Run、事件、checkpoint 和
  delegated task；父记录与 session-scoped resources 保留。
- session/container 删除前先取消并等待所有命中范围的活动父/子 Run 收尾，再执行 workspace
  元数据和关联数据的同一事务。
- Run、Event、Checkpoint、Message、资源和 delegated task 都执行深层 schema 校验；损坏 record
  保留到 quarantine。
- Run、checkpoint、terminal 和 snapshot 各自串行写入；显式 snapshot flush 会取消未触发的
  debounce。一次活动快照失败不会吞掉已经排队的后续保存。
- 快照在导出前排除 `node_modules`、`.git`、dist、coverage、Playwright 输出和常见缓存；上限
  10,000 文件/100 MiB。超限保留最后一个完整快照。
- session/container 创建默认值由当前 locale 在 hydrate 前注入，数据库仍只保存最终名称字符串。

## 12. 仍属后续路线

- 更多 pi-ai adapter（Claude Messages、OpenAI Responses 等）。
- PDF、音频等新的 `ResourceProcessor`。
- Skills、MCP 和插件权限/审计层（扩展宿主 API，见 [能力库扩展指南](extension-development.md)）。
- 多标签页/多写入者 pi 会话同步。
- team、mailbox、递归 swarm 或并行 writer；只有普通 subagent 数据证明不足时再评估。

## 13. 当前实现基线

2026-08-08，pi 全面切换完成：pi 是唯一引擎，旧引擎已删除；pi 运行时懒加载，不进初始 bundle。
核心自动化 60 个测试文件、374 个测试；E2E 18/18、真实 Succinix/WebContainer 3/3，视觉 6/6。

当前覆盖率为 statements 91.04%、branches 83.28%、functions 90.73%、lines 94.94%；初始/总
JS 为 88.09/337.59 KiB gzip，生产 `dist` 1.45 MiB，生产依赖审计返回 `found 0 vulnerabilities`。
pi 通道已验证：事件桥接（流式 delta / 工具调用 / 子 agent 透传）、IndexedDB 会话恢复、
compaction 压缩后 token 显著下降、三路并发子 agent、驱动抽象与如实降级。本轮功能门禁通过，
不声明需要连续两次完整通过的优化冻结复验。

自动化门槛和真实浏览器场景见 [发布与优化冻结验收](refactor-acceptance.md)，能力清单见
[FEATURES](FEATURES.md)，模块依赖见 [架构说明](architecture.md)。
