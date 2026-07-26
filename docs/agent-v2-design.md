# Sunam Agent Runtime 设计

本文描述当前已落地的 Agent 执行内核、自动上下文系统、资源附件、持久化恢复和子 Agent Runtime。文件名中的 `v2` 是历史路径；正文所称 Agent Core v2 指执行内核代际，工作数据库是独立的 `sunam-v3`。

Sunam 借鉴 [Claude Code 分析仓库](https://github.com/liuup/claude-code-analysis) 的可迁移原则：执行内核与 UI 解耦、工具调用按完整轮次管理、事实事件先行持久化、恢复重建而非复活、上下文按预算自动收缩。Sunam 不复制 Claude 的固定 200k 常量，而由模型适配器提供 profile。

## 1. 运行结构

```text
React Workspace / RunBoard
  └─ WorkspaceRuntimeProvider
       ├─ WebContainerAgentRuntime
       │    ├─ WorkspaceFileSystem
       │    ├─ ProcessRegistry
       │    ├─ WorkspaceSnapshotCoordinator
       │    └─ session-scoped resources
       └─ AgentEngine
            ├─ TaskContract / ChaosContract / Budget
            ├─ ContextComposer
            ├─ AgentToolRegistry
            ├─ ResourceProcessorRegistry
            ├─ AgentFamilyCoordinator
            └─ AgentEventEmitter → AgentEventStore
                                  → V3PersistenceRepository (sunam-v3)
```

`AgentEngine` 不依赖 React。UI 只订阅 Run/Event 投影；WebContainer 行为通过 `AgentWorkspaceRuntime` 注入；供应商协议只存在于 `AgentModelClient` adapter。

## 2. Run 状态机与完成门

```text
preparing → planning → acting → observing / verifying
任意活动态 → cancelling → cancelled
任意活动态 → failed
刷新活动 Run → interrupted → 新 Run 继续
外部阻塞 → awaiting_user
计划、证据、当前 revision 验证通过 → completed
```

每个 Run 固定 session、container、模型、人格、预算、任务契约和取消域。非简单任务必须记录计划；`complete_task` 是带结构化证据的首选结束路径，但模型的非空普通文本也会作为完成尝试。两条路径共享计划、真实 container revision 和验证门；不满足时普通文本不会先作为最终消息展示。失败验证会撤销旧 pass。

恢复永远创建新 runId、AbortController 和事件侧链，并记录 `parentRunId`。旧请求、进程、PID 和控制器不会复活。刷新时活动父 Run、子 Run 和 delegated task 都变为 `interrupted`。

## 3. 一轮执行

1. 检查 Run 与 root-family 的时间、模型轮数和工具总数预算。
2. 确保容器已恢复，读取真实 workspace revision。
3. 计算完整请求预算：系统提示、工具 schema、媒体估算和 transcript；必要时自动 compact。
4. 调用模型；网络、429 与 5xx 仅做有限退避。主请求 PTL 最多尝试三次，每次删除最旧 20% 的完整消息组；连续失败后写入确定性摘要并打开熔断。
5. assistant tool call 与匹配 tool result 作为完整组进入 transcript。终止控制调用只能位于批次末尾，否则整批拒绝。
6. 最多四路执行并发安全只读工具；`apply_patch`、`materialize_resource` 和 `shell_run` 使用容器级 mutation lease。所有前台 shell 都按真实 exit status 和命令结束后的 revision 记录验证，不解析命令名、脚本、参数、端口或 shell 组合；后台 shell 只记录进程进度并撤销旧 pass。shell 进程结束形成显式 revision 边界。
7. 工具批次后 flush 工作区、更新任务、保存单一 checkpoint 和事件尾序号。
8. 同一工具与参数连续第三次出现时只给一次 recovery guidance；第四次仍重复则立即失败，不把预算耗尽在无效兜底循环中。
9. 计划和当前 workspace revision 验证满足后才能完成；验证相关性和真实性由系统 prompt 约束，要求选择适合任务的检查、保留失败退出码、禁止用无关成功命令伪造证据，并在后续写入后重新验证。

## 4. 自动上下文压缩

`ModelContextProfile` 提供：context window、默认输出额度、总结预留和安全缓冲。已知模型映射到明确 profile；未知 OpenAI-compatible 模型使用保守 32k。有效窗口先扣除输出、总结和安全额度。

压缩规则：

- transcript、系统提示、工具 schema 和图片估算达到有效窗口 90% 前自动触发；没有按钮、设置或确认框。
- assistant tool call 与对应 tool result 永不拆散。
- micro-compaction 只去重内容 digest 相同、期间没有相关路径变更的旧读取；并行工具按 `tool_call_id` 独立归属。
- 旧低价值输出替换为短预览和稳定 digest；失败、写入、验证、用户反馈和最新读取保留。
- summary 输入剥离图片、Blob、文档正文、Base64 和可重注入资源，只保留 `[image_resource: id]`、`[resource: id]` 等事实标记。
- semantic summary 禁用工具。只有 PTL 会每次裁掉最旧 20% 完整组并重试，最多三次；网络/限流失败直接进入确定性 fallback，不因网络错误丢弃更多历史。
- 超大单轮按模型 estimator 二分裁剪；中文、emoji 和混合代码不使用固定四字符假设。
- 模型文本与资源范围读取共享保守 Unicode estimator；中日韩字符和 emoji 不会按拉丁字符低估。
- compact 后重注入 Task Contract、计划、证据、workspace revision、event tail、最多 5 个最近相关文件片段、活跃资源 ID 和子 Agent 状态。
- 小 profile 最多重注入最近 4 张图片，大 profile 最多 8 张；其他媒体保留 durable ID。
- compact 成功后立即覆盖 Run summary 和 checkpoint，降低刷新发生在下一工具批次前时的状态丢失风险。

`context_compacted` 记录 before/after token、event tail、workspace revision、重注入资源 ID 和 fallback reason。恢复通过 repository 查询目标 Run 的真实最新 sequence，不依赖当前 250-event UI 窗口。

## 5. 资源附件

`AgentResource` 元数据包含：`id、sessionId、originatingRunId、name、kind、mimeType、size、sha256、createdAt`。Blob 与可选模型图片副本只存入 `resources` store；消息、事件和 checkpoint 仅保存资源 ID。

限制在 UI 与 `ResourceProcessorRegistry` 两层执行：每条消息最多 8 个；文本 2 MiB、图片 10 MiB、二进制 20 MiB、单批 50 MiB。已持久化 resource ID 也计入数量和总量，缺失、跨 session 或没有 File/resource ID 的附件直接失败。处理流程在整批通过前不写库。

- 文本/代码：检测明显二进制内容，通过 `read_resource_text` 按行和 token 范围读取。
- PNG/JPEG/WebP/GIF：嗅探真实 MIME，最长边 2048，模型副本 ≤1.5 MiB，原图保留；浏览器无法解码并验证尺寸时安全拒绝。
- 其他二进制：保存元数据和 Blob，可通过 `materialize_resource` 复制到工作区。
- 同一 session 按 SHA-256 去重。容器删除时若另一个 Run 仍引用资源，会重置来源归属；最后引用删除后再回收 Blob。
- `read_resource_text`、`read_resource_image`、`materialize_resource` 和视觉 adapter 都校验当前 session，不能只凭资源 ID 跨会话读取。
- 模型明确拒绝视觉输入时缓存该模型能力并自动重试文本/资源引用路径；415 可直接判定，400/422 必须包含 vision/image/multimodal/content-part 证据，其他错误不做无效兜底。

持久化 sanitizer 会递归移除 Blob、ArrayBuffer、data URL 和长 Base64。资源文本读取正文只存在于当前内存 transcript；持久化 event/checkpoint 保存资源引用标记。

## 6. 子 Agent Runtime

根 Agent 通过以下工具分工：

- `spawn_subagent({ taskId, role, prompt, writeScope? })`
- `wait_subagents({ runIds })`
- `message_subagent({ runId, message })`
- `stop_subagent({ runId })`

每个 delegated task 使用内部唯一持久化 ID；模型提供的 `taskId` 只是业务标签，重复标签不会覆盖其他任务。子 Agent 拥有独立 runId、事件侧链、上下文、预算和 AbortController，只继承父摘要、Task Contract、资源 manifest、workspace revision 和明确目标，不复制父 transcript。

约束：

- 最大深度 1；子 Agent 不能再委派。
- 每个 root 最多 6 个子 Run，同时最多 3 个 explore。
- explore 只读；implement 允许 read/search/apply_patch/materialize 且受 write scope；verify 只允许识别出的前台验证命令。
- implement 与 verify 独占调度；任何 root family 以及其他 family 对同一 container 的 mutation 都由全局容器 lease 串行化。
- 子 Run 上限 20 model turns、50 tool calls、5 分钟；root family 共享 90 turns、225 calls、15 分钟。
- notification 返回 status、summary、evidence、changed paths、verification records、workspace revision、usage 和 blocked reason。
- parent 等待结果时把真实 revision 合并到自己的任务；child 写入使旧验证失效，child failed verification 也撤销父级旧 pass。
- 父级取消会等待子任务到达终态并停止所属进程，然后父 Run 才完成取消。

RunBoard 以树形摘要展示子任务；展开子任务时按 run 索引读取最近 250 条事件并显示最近 transcript，不注入主聊天。v1 不实现 team、mailbox、递归 swarm、teammate 互聊或并行 writer。

## 7. 工具和权限

每个工具必须声明 Zod schema、只读/并发属性、数据影响、超时和结果类型。角色白名单在构造子 Run 时冻结。

- 所有文件路径通过容器根目录解析并拒绝逃逸。
- 进程所有权是 `(sessionId, runId, containerId)`；不匹配的观察、输入和停止失败。
- verify shell 只要求 foreground；不使用通用命令解析器猜测项目验证语义，也不允许启动后台服务。
- 后台 `shell_run` 用于服务等持续进程，不单独制造 workspace mutation；如果它实际写文件或退出，权威 revision 漂移仍会使完成门要求重新验证。
- 验证后仍可继续读取或运行前台检查；前台命令会在新的 shell revision 上刷新真实 exit evidence，后续 workspace 写入仍要求再次检查。
- Agent 只能读取有界用户终端缓冲，不能向用户交互 shell 写入；所有命令都必须通过 Agent-owned `shell_run` 执行并受进程所有权与 mutation lease 约束。
- write scope 同时约束 `apply_patch` 与 `materialize_resource`。
- `AgentToolResult.modelContent` 和 `resourceReferences` 可影响下一次模型内容，但不会把 Blob 放入 ledger。

## 8. v3 持久化与恢复

生产数据库为 `sunam-v3`。旧 v2 database/repository/schema 等生产实现已删除，隔离测试直接使用原始 IndexedDB API 建立旧库。浏览器中的 `sunam-v2` 仍保留，但生产代码不打开、不读取、不迁移、不删除。Local Storage 设置仍使用 `sunam_v2_*` 以保留连接和语言配置。

v3 stores：workspace、runs、events、checkpoints、terminalHistory、snapshots、resources、agentTasks、quarantine。

- events append-only，按 session/run + sequence 建索引；session 时间线与单个 Run 均提供最多 250 条的页面查询，主聊天自动向上分页，子 Run transcript 按展开动作加载。
- 每个 Run 只有一个覆盖式 checkpoint，保存摘要、最近完整消息组、event tail、workspace revision 和资源 ID。
- 普通 workspace save、session/container 删除和 reset 在 store 与 repository 两层进入统一串行队列；reload 等待队列排空，避免旧保存覆盖删除结果。
- 删除 session/container 前先取消并等待所有命中范围的活动父/子 Run 收尾，再执行 workspace 元数据和关联数据的同一事务，避免旧 execution 在删除后写回数据。
- session 删除清理对应 Run、事件、checkpoint、资源、任务和 session-scoped terminal history；container 删除清理 container-scoped Run 侧链、资源归属和 snapshot。terminal history 不按 container 存储，因此不作无法兑现的 container 级清理承诺。
- Run、Event、Checkpoint、Message、资源和 delegated task 都执行深层 schema 校验；损坏 record 保留到 quarantine，读取返回 issue，没有伪装成功的内存回退。
- Run、checkpoint、terminal 和 snapshot 各自串行写入；显式 snapshot flush 会取消未触发的 debounce。一次活动快照失败不会吞掉已经排队的后续保存，后续保存会自动继续，最后完整快照始终保留。
- 快照在导出前排除 `node_modules`、`.git`、dist、coverage、Playwright 输出和常见缓存；上限 10,000 文件/100 MiB。超限保留最后一个完整快照，不写半份。
- 文件 watch 在空闲窗口合并保存，并在 checkpoint、进程结束、`pagehide` 和 runtime dispose 时 flush。

## 9. 仍属后续路线

- Claude Messages、OpenAI Responses 等额外 adapter。
- PDF、音频等新的 `ResourceProcessor`。
- Skills、MCP 和插件权限/审计层。
- team、mailbox、递归 swarm 或并行 writer；只有普通 subagent 数据证明不足时再评估。
- 只有 5,000-event 基准证明固定 250 DOM 窗口仍不够时，才引入动态高度虚拟列表。

## 10. 当前实现基线

2026-07-26 的最终工作区已连续两次通过完整 `npm run check:all`。核心自动化为 36 个测试文件、175 个测试；E2E 7/7、视觉 4/4、真实 WebContainer 3/3。真实 Runtime 已覆盖移动端切换后后台进程和端口保持、资源 materialize 后快照排除生成目录，以及父 Run 取消级联停止 verify 子进程。

当前覆盖率为 statements 91.24%、branches 83.05%、functions 90.40%、lines 94.97%；初始/总 JS 为 84.94/314.09 KiB gzip，生产 `dist` 1.34 MiB，生产依赖 high/critical 为零。该基线表示上下文、资源、v3 persistence 与普通 subagent 的第一版已经越过优化冻结门，后续功能仍需遵守本设计中的预算、revision、持久化和取消边界。

自动化门槛和真实浏览器场景见 [发布与优化冻结验收](refactor-acceptance.md)，模块依赖见 [架构说明](architecture.md)。
