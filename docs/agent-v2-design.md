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

每个 Run 固定 session、container、模型、人格、预算、任务契约和取消域。root 的非简单任务必须记录计划；child 的本地计划可选，但一旦创建就必须完成全部步骤后才能通过 `complete_task` 退出。`complete_task` 是带结构化证据的首选结束路径，但 root 模型的非空普通文本也会作为完成尝试。两条 root 路径共享计划、真实 container revision 和验证门；不满足时普通文本不会先作为最终消息展示。失败验证会撤销旧 pass。

恢复永远创建新 runId、AbortController 和事件侧链，并记录 `parentRunId`。旧请求、进程、PID 和控制器不会复活。刷新时活动父 Run、子 Run 和 delegated task 都变为 `interrupted`。

## 3. 一轮执行

1. 检查 Run 与 root-family 的时间、模型轮数和工具总数预算。
2. 确保容器已恢复，读取真实 workspace revision。
3. 计算完整请求预算：系统提示、工具 schema、媒体估算和 transcript；必要时自动 compact。
4. 调用模型；网络、429 与 5xx 仅做有限退避。主请求 PTL 最多尝试三次，每次删除最旧 20% 的完整消息组；连续失败后写入确定性摘要并打开熔断。
5. assistant tool call 与匹配 tool result 作为完整组进入 transcript。终止控制调用只能位于批次末尾，否则整批拒绝。
6. 最多四路执行并发安全只读工具；`apply_patch`、`materialize_resource` 和 `shell_run` 使用容器级 mutation lease。所有前台 shell 都按真实 exit status 和命令结束后的 revision 记录验证，不解析命令名、脚本、参数、端口或 shell 组合；后台 shell 只记录进程进度并撤销旧 pass。shell 进程结束形成显式 revision 边界。
7. 工具批次后进入独立 watchdog 约束的同步阶段，flush 工作区、更新任务、保存单一 checkpoint 和事件尾序号。超时/失败先把 Run 投影为可恢复 failed，再做有界的尽力持久化，不能因 snapshot/IndexedDB 悬挂而长期显示运行中；最后成功 checkpoint 保持不变。
8. 同一工具与参数连续第三次出现时只给一次 recovery guidance；第四次仍重复则立即失败，不把预算耗尽在无效兜底循环中。
9. root 的必需计划以及任何已创建的 child 计划都必须完成；root 还要满足当前 workspace revision 验证才能结束。验证相关性和真实性由系统 prompt 约束，要求选择适合任务的检查、保留失败退出码、禁止用无关成功命令伪造证据，并在后续写入后重新验证。

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

- `spawn_subagent({ task_id, role, prompt, write_scope? })`
- `wait_subagents({ run_ids })`
- `message_subagent({ run_id, message })`
- `stop_subagent({ run_id })`

每个 delegated task 使用内部唯一持久化 ID；模型提供的 `taskId` 只是业务标签，重复标签不会覆盖其他任务。子 Agent 拥有独立 runId、事件侧链、上下文、预算和 AbortController，只继承父摘要、Task Contract、资源 manifest、workspace revision 和明确目标，不复制父 transcript。

约束：

- 最大深度 1；子 Agent 不能再委派。
- 每个 root 最多 6 个子 Run，同时最多运行 3 个任意角色的 child lifecycle。
- 新任务只区分 `explore` 与 `task`：explore 只读；task 拥有完整 workspace/resource/process/control 工具但不能递归委派，并可受 write scope 约束。
- `spawn_subagent` 对模型发布顶层 `type: object` 的参数 schema；角色条件通过 object refinement 校验，避免兼容服务在模型执行前拒绝 union-root function schema。
- root prompt 明确要求只读调查选 explore，编辑、命令、验证或进程工作选 task；独立任务必须先全部 spawn 再 wait。每次 wait 只消费一个尚未上报的终态通知，父 Agent 检查后继续等待其余任务。
- explore/task 可并行推理和读取；任何 root family 以及其他 family 对同一 container 的 apply/materialize/shell mutation 都由全局容器 lease 串行化。
- 旧 `implement | verify` 持久化记录保持可读并显示为 task，但新 spawn schema 拒绝旧角色。
- 每个子 Run 完整复制当前 root Run 的 model-turn、tool-call 和 wall-clock 上限，并使用独立计数器；父或兄弟的消耗不会缩短该 child 的预算。parent cancellation 仍会停止 child，mutation lease 仍跨 family 串行写入。
- 子 Agent 完成不受强制 workspace verification 门禁限制；验证是可选证据，任何已执行检查仍必须如实上报。root 自身的计划、revision 与 verification 完成门保持不变。
- notification 返回 status、summary、evidence、changed paths、verification records、workspace revision、usage 和 blocked reason。通知一个 child 只写 root 的综合任务状态，不取消或改写任何 sibling Run/delegated task。
- parent 等待结果时把真实 revision 合并到自己的任务；child 写入使旧验证失效，child failed verification 也撤销父级旧 pass。
- 父级取消会等待子任务到达终态并停止所属进程，然后父 Run 才完成取消。

主聊天的消息、流式文本、active/latest Run、RunBoard 和 session 状态只投影 depth-zero Run。Sidebar 预读可见父会话的轻量 child Run 摘要，普通会话保持无箭头单行，只有确实保留 child 的会话才显示折叠入口；子项以 `role + delegatedTaskId` 作为不可改名、不可置顶的身份，选择后才按 `runId` 读取该 child 最近 250 条事件。子页点击父会话只返回父 transcript 并保持列表展开，已经位于父页时再次点击才折叠。child 删除菜单 portal 到 viewport 并复用普通侧栏菜单；置顶会话以 Pin 替换 History，不追加第二枚图标。会话生成、运行、成功未读、失败未读统一使用固定状态槽，与折叠箭头和操作按钮分别占位。子页面隐藏输入和上传；仅当该 child 自己创建了 plan 时显示隔离的 RunBoard。运行态只提供停止当前 child，终态只提供返回父 Agent。单 child 停止或完成不会取消父 Run 或改变兄弟 child。

RunBoard 仍以树形摘要展示子任务，但断点和子任务详情默认折叠，并复用工具调用的固有尺寸动画和 reduced-motion 回退。RunBoard 只显示当前 revision 的正向已验收状态，不显示未验收徽标。child transcript 永不注入主聊天。v1 不实现 team、mailbox、递归 swarm、teammate 互聊或并行 writer。

## 7. 工具和权限

每个工具必须声明 Zod schema、只读/并发属性、数据影响、超时和结果类型。角色白名单在构造子 Run 时冻结。

- WebContainer 真实 workdir 为 `/home/workspace`，项目根是 `/home/workspace/<containerId>`。Agent、子 Agent、用户终端、FileManager、资源物化和快照只使用这一命名空间；容器名不参与路径。
- Agent 和用户 shell 使用同一项目 `cwd` 与 `SUNAM_WORKSPACE`，但 `HOME=/home/workspace` 保持在项目根之外，避免 `.jshrc` 等启动文件进入用户目录和快照。
- 文件工具接受相对路径或当前规范绝对路径；`/home/user`、旧 `.sunam/workspaces`、伪 `/containers`、其他/重复 container root、反斜线、NUL 和 traversal 在读写前失败，错误返回当前规范根。
- 进程所有权是 `(sessionId, runId, containerId)`；不匹配的观察、输入和停止失败。
- root 的 `process_list` 可以列出同一 session/container 内由较早 Run 启动的进程；后续观察、输入和停止使用列表记录的原始完整所有权。其他 session/container 不可见，子 Agent 不获得跨 Run 进程工具。
- 关闭已登记服务必须使用 Agent process ID，不通过端口猜 PID。显式停止异步等待一次 post-stop revision flush，并同步当前任务 revision，避免服务已经关闭但完成门继续循环。
- Agent shell 与用户终端都由 runtime service registry 登记 launch ID、来源、容器和句柄。Node `listen` 由内部 preload 记录真实 PID/port；服务面板只对 managed 端口提供精确停止，不从端口反推 PID。
- 无法关联当前生命周期启动记录的端口标记为 orphaned。用户可确认“强制重启关闭”，但 runtime 必须先成功 flush 全部快照；失败时不重启。成功重启会停止全局 WebContainer 中的全部端口、终端和 Agent 后台进程。
- task 可使用前后台 shell；workspace 发生变化后必须用相关 foreground 检查在当前 revision 上完成验证，不使用通用命令解析器猜测项目验证语义。
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
- 单独删除 child 时先等待该 Run 进入终态，再在一个事务中删除 child Run、事件、checkpoint 和 delegated task；父记录与 session-scoped resources 保留，失败时入口不做乐观移除。
- 每个 root Run 第一次 spawn 前删除同 session 中其他 root family 的终态 child；活动旧 child 与当前 family 始终保留。删除父 session 仍会清理全部 child 侧链。
- 普通 workspace save、session/container 删除和 reset 在 store 与 repository 两层进入统一串行队列；reload 等待队列排空，避免旧保存覆盖删除结果。
- 删除 session/container 前先取消并等待所有命中范围的活动父/子 Run 收尾，再执行 workspace 元数据和关联数据的同一事务，避免旧 execution 在删除后写回数据。
- session 删除清理对应 Run、事件、checkpoint、资源、任务和 session-scoped terminal history；container 删除清理 container-scoped Run 侧链、资源归属和 snapshot。terminal history 不按 container 存储，因此不作无法兑现的 container 级清理承诺。
- Run、Event、Checkpoint、Message、资源和 delegated task 都执行深层 schema 校验；损坏 record 保留到 quarantine，读取返回 issue，没有伪装成功的内存回退。
- Run、checkpoint、terminal 和 snapshot 各自串行写入；显式 snapshot flush 会取消未触发的 debounce。一次活动快照失败不会吞掉已经排队的后续保存，后续保存会自动继续，最后完整快照始终保留。
- 快照在导出前排除 `node_modules`、`.git`、dist、coverage、Playwright 输出和常见缓存；上限 10,000 文件/100 MiB。超限保留最后一个完整快照，不写半份。
- 文件 watch 在空闲窗口合并保存，并在 checkpoint、进程结束、`pagehide` 和 runtime dispose 时 flush。
- session/container 创建默认值由当前 locale 在 hydrate 前注入，数据库仍只保存最终名称字符串；历史中/英/日空会话可复用，自定义名称不随语言切换。

## 9. 仍属后续路线

- Claude Messages、OpenAI Responses 等额外 adapter。
- PDF、音频等新的 `ResourceProcessor`。
- Skills、MCP 和插件权限/审计层。
- team、mailbox、递归 swarm 或并行 writer；只有普通 subagent 数据证明不足时再评估。
- 只有 5,000-event 基准证明固定 250 DOM 窗口仍不够时，才引入动态高度虚拟列表。

## 10. 当前实现基线

2026-07-27 的当前工作区已通过一次完整 `npm run check:all`。核心自动化为 41 个测试文件、236 个测试；E2E 11/11、视觉 4/4、真实 WebContainer 3/3。真实 Runtime 已覆盖移动端切换后后台进程和端口保持、资源 materialize 后快照排除生成目录、父 Run 取消级联停止 task 子进程，以及用户终端、Agent 文件工具、Agent shell 与 FileManager 的规范工作区双向可见性。

当前覆盖率为 statements 90.93%、branches 83.22%、functions 89.94%、lines 95.31%；初始/总 JS 为 87.39/321.21 KiB gzip，生产 `dist` 1.38 MiB，生产依赖 high/critical 为零。本轮功能门禁通过，但不声明需要连续两次完整通过的优化冻结复验；后续功能仍需遵守本设计中的预算、revision、持久化和取消边界。

自动化门槛和真实浏览器场景见 [发布与优化冻结验收](refactor-acceptance.md)，模块依赖见 [架构说明](architecture.md)。
