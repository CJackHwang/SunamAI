# Sunam Agent Core v2：能力内核与荒诞外观的分离设计

## 0. 范围与结论

本设计只解决浏览器内 ReAct Coding Agent 的执行内核：任务、模型循环、工具、上下文、恢复、取消、验证与可观测性。Skills、知识库、MCP、远程 Agent、额外模型协议和插件均只保留边界，不在本阶段实现。

目标不是复刻某个产品，而是吸收 [Claude Code 分析仓库](https://github.com/liuup/claude-code-analysis) 中最可迁移的工程原则：**执行内核独立、工具调度有序、事件先行持久化、恢复重建而非复活、上下文预算受控**。分析中将其主链概括为“Query/Agent 内核 → 工具/权限 → transcript/memory → 回流执行内核”，并明确把恢复视为一条流水线，而非把旧消息数组塞回 UI；这正是 Sunam v2 应借鉴的部分。

Sunam 的恶搞感只能来自可审计的 `ChaosContract`、UI 文案和可逆的展示彩蛋。它绝不能进入权限、文件写入、验证、预算、取消或恢复判断。也就是说：**外层疯癫，内核保守。**

## 1. 已落地的 v2 基座

```text
React Workspace
  └─ WorkspaceRuntimeProvider
       ├─ WebContainerAgentRuntime  ── AgentWorkspaceRuntime
       │    ├─ .sunam/workspaces/{containerId}（相对 WebContainer workdir）唯一根目录
       │    ├─ 进程所有权 / 输出游标 / stopRun
       │    └─ 文件 watch → 防抖 SnapshotScheduler
       └─ AgentEngine
            ├─ TaskContract + ChaosContract + Budget
            ├─ ContextComposer
            ├─ AgentToolRegistry
            └─ AgentEventEmitter → AgentEventStore
                                  → V2PersistenceRepository (sunam-v2)
```

`sunam-v2` 只保存 v2 workspace、Run、append-only event、checkpoint、Agent 终端历史、容器快照和隔离项；任何旧键或旧数据库均不读、不迁移、不备份。所有刷新后的活动 Run 都被标为 `interrupted`，点击继续时基于 checkpoint 创建全新的 runId 和 AbortController。

## 2. 从参考分析中采用的原则

| 原则 | Sunam v2 的具体规则 |
| --- | --- |
| 内核与 UI 解耦 | `AgentEngine` 不依赖 React；React 只订阅 Run/Event。运行时通过 `AgentWorkspaceRuntime` 注入。 |
| 工具分组调度 | schema 先校验；连续的只读并发安全调用以最多 4 路执行，其余串行，结果按原模型调用顺序回写。 |
| Transcript 是事实，UI 是投影 | event ledger 追加写入；`projectMessages` 由事件投影消息，而不是把组件 state 当数据源。流式 delta 是 transient，不入持久 ledger。 |
| Resume 是恢复流水线 | workspace 元数据、文件 snapshot、终端历史、event/run/checkpoint 分层加载；恢复只继承事实和摘要，不继承旧进程。 |
| 上下文应预留与熔断 | Context Composer 在 90k 字符前压缩、保留最近 28 条；三次压缩失败后确定性摘要降级，避免无限“上下文太长”循环。 |
| 失败是状态，不是字符串 | 预算耗尽、取消、模型重试、验证失败、重复工具、空响应和无进展都产生可投影事件与明确 phase。 |

参考分析特别强调：append-only 的写入路径可以简单，复杂性应放在恢复/校验层；并发工具的 UI 更新可流式，但状态变更必须按批次稳定落地。Sunam 在浏览器场景中以 IndexedDB record 和运行时快照实现同样的取舍。

## 3. Run 状态机

```text
preparing → planning → acting → observing / verifying
              ↑          │              │
              └── recovery_hint ────────┘

任意活动态 ──取消──> cancelling → cancelled
任意活动态 ──错误──> failed
浏览器刷新/重载 ───> interrupted ──“继续”──> 新 preparing Run
验证、计划、证据均满足 ─────────────────────> completed
确有外部阻塞 ───────────────────────────────> awaiting_user
```

不允许的跃迁：

- 工作区变更后无成功验证证据直接 `completed`；
- 非简单任务未记录 Plan 直接 `completed`；
- 在同一个 runId 上恢复旧 PID、流式请求或 AbortController；
- 将模型普通文本当作完成指令；
- 将失败验证标记为通过。

## 4. 一轮 ReAct 的严格算法

1. 断言取消、时间、模型轮数和工具总数预算；确保目标容器已挂载。
2. 检查上下文预算；必要时压缩为“事实摘要 + 最近消息”，并发出 `context_compacted`。
3. 组装系统提示：不可突破的运行章程、当前 Task、Plan、证据、摘要与 ChaosContract。
4. 请求模型；只对网络、429 与 5xx 做有限指数退避，事件化记录 `model_retry`。
5. 将 assistant 输出写入 ledger；若有 tool calls，按工具元数据分批执行，产生 requested / started / finished 事件及真实 tool messages。
6. 对每次工具批次刷新 Task 与 checkpoint。连续两轮没有有效进展，注入可见的 `recovery_hint`，要求重新检查工作区与任务约束。
7. 若工具请求结束：检查 Plan、变更与验证证据，然后才进入 completed；若请求用户，进入 awaiting_user。
8. 若模型无工具只给文本：简单只读任务可结束；任何需要 Plan 或验证的任务都回到 planning，拒绝“口头完工”。连续三次空响应失败。

## 5. 工具与运行时边界

工具注册表必须是唯一的工具目录，每个工具都有：稳定名称、Zod 输入 schema、只读标记、并发安全标记、数据影响说明、超时与结果类型。当前核心工具是 workspace tree/read/search、原子全文件 patch、foreground/background shell、受所有权保护的 process observe/input/stop，以及 plan/progress/ask/complete 控制工具。

进程所有权始终是 `(sessionId, runId, containerId)`。任何不匹配的观察、输入和终止操作返回失败；取消一个 Run 只会停止它拥有的进程。所有文件 API 都经 `/workspaces/{containerId}` 解析，并拒绝路径逃逸。

后续扩展接口应该只新增 `ToolProvider`/`AgentModelClient` adapter，不能把 Skills、MCP 或协议判断塞进 `AgentEngine`。新工具默认串行和最小权限，只有有并发证明与测试后才能标为并发安全。

## 6. Task、证据与完成门

每个 Run 生成不可变的目标、验收条件和约束，并维护以下可变事实：Plan、已变更工作区、验证记录、证据、摘要、预算消耗和 phase。

- `apply_patch` 才能把 `changedWorkspace` 置为真；
- `shell_run` 只有 foreground 且命令是 test/check/lint/build/typecheck/verify 类时产生 verification record；失败也必须记录；
- `complete_task` 必须有非空证据，且若改过工作区，至少一个 verification record 为 passed；
- `report_progress` 只能输出公开、安全、短文本；内部推理绝不进入事件或 UI。

这使“牛逼 SaaS 的宇宙级成功播报”和真实成功脱钩：前者只是展示，后者必须由运行时证据决定。

## 7. 持久化、恢复与数据治理

写入模型是 append-only event + 可重写的当前 Run/workspace/snapshot：

- event 保留时间顺序与 sequence，transient delta 不持久化；
- checkpoint 保存摘要与恢复所需 transcript；
- 文件快照在 WebContainer mount 前恢复，并通过防抖调度串行导出；
- 未知版本/畸形 record 进入 quarantine，用户可检查或删除；
- IndexedDB 不可用或读取失败时暴露错误并暂停写入，避免用临时内存状态伪装持久化成功。

恢复流程为：加载 workspace → mount snapshot → 恢复终端历史与 event/run → 将活动 Run 置为 interrupted → 用户显式继续产生新 Run。此流程的重点是复原可验证的工作事实，而不是伪装一条从未中断的执行链。

## 8. 未来阶段（明确不在本次实现）

1. **接口适配器**：在 `AgentModelClient` 下实现 Claude Messages / Responses API；核心仍只消费统一 `message + toolCalls`。
2. **Skills 与知识**：作为可版本化的 prompt/tool provider，在 Run 启动时冻结版本与哈希；不要让运行中内容热替换任务约束。
3. **MCP/插件**：先接入权限声明、命名空间、超时、审计与熔断；每个外部调用以受限 ToolProvider 暴露，绝不直接改 Engine。
4. **子 Agent**：独立 Run/sidechain/event stream，父 Run 只能接收经过摘要和证据归并的结果；不共享取消域或未审核的写权限。
5. **更强恢复校验**：为 checkpoint 添加消息数、事件尾序号、workspace snapshot revision，恢复时检测 drift 并提示用户重新检查，而不是静默拼接。

## 9. 验收指标

- 旧纯 loop Agent 完全删除，生产路径只能创建 `AgentEngine`；
- 100% 工具调用 schema 校验，所有运行时行为事件化；
- 已修改工作区的 Run 无成功验证不得完成；
- 刷新后的活动 Run 不得显示为仍在运行，继续必须产生新 runId；
- 只读并发上限为 4，写入/命令无竞态；
- 核心测试覆盖率门槛：lines/statements/functions ≥85%，branches ≥80%；
- v2 repository 只提供当前运行链使用的读写、隔离与按作用域删除接口，不预留未接入产品的导入导出代码。
