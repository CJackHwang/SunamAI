# 能力库：Agent 与容器解耦 + 能力模块化管理

## 背景与动机

Sunam 的 Agent 系统与 WebContainer 深度耦合：`AgentEngine` 硬依赖 `AgentWorkspaceRuntime`（非空），`launchTask` 以 runtime 存在为前提，completion 门依赖容器 revision 与 `shell_run` 验证。当前容器初始化失败时，UX 只是底部错误横幅且聊天完全不可用。

在合并 HeyMean 产品线（笔记功能、新设置界面等）之前，必须先把**能力层模块化**，定义好 Agent 系统与外部能力（容器、未来的笔记/服务器/MCP/微信传输）之间的接缝，让能力可热插拔、可配置、可降级。

## 源需求集

### R1 能力清单（Capability Library）是工具层的唯一真源

- R1.1 所有提供给 AI 的可调用工具**必须**登记注册到能力库；原则上不允许存在独立、未注册、未知的工具（安全考虑，注入式管理，同 Apple 生态哲学）。
- R1.2 工具通过 `defineTool` 注入式声明能力归属（**编译期硬约束**：缺声明即编译失败，从根上杜绝"偷偷加未注册工具"）。
- R1.3 未分类工具进「其他」兜底分类，但**不得滥用**（CI 审计：超过阈值即告警）。

### R2 模块分类

| 分类 | 内容 | 开关档位 |
|---|---|---|
| **Agent运行时** | agent 自身系统工具（`update_plan`/`report_progress`/`ask_user`/`complete_task`/`ask_parent`）+ 子 agent 工具（`spawn_subagent`/`wait_subagents`/`message_subagent`） | 可管理权限，但标注「不建议关闭」 |
| **虚拟容器** | `workspace_tree`/`read_file`/`search_workspace`/`apply_patch`/`shell_run`/`process_*`/`read_user_terminal`/`materialize_resource` | 总开关 + 三态可用性 |
| **资源/附件** | `list_resources`/`read_resource_text`/`read_resource_image` | 可管理，默认开 |
| **笔记管理** | （预留槽位，产品线合并时填充） | 预留 |
| **其他** | 真·兜底，应保持近乎为空（当前 0 个） | 兜底 |

### R3 双层开关

- R3.1 **模块总开关 = 用户侧功能块**：容器总开关关闭 → 直接关闭 Sunam 的电脑/终端/文件/服务。
- R3.2 **工具子开关 = AI 侧可感知工具**：选择性暴露给 AI，个性化 + 权限管理。
- R3.3 总开关开、全部子开关关 = **容器与 Agent 拆分**：用户仍可手动使用终端文件，AI 完全碰不到容器。
- R3.4 面板需写明「不建议关闭」的模块（Agent运行时）在关闭时二次确认。

### R4 容器三态可用性

- R4.1 三态：`已开启` / `已关闭` / `启动受限`。
- R4.2 boot 失败 → **启动受限（非强制禁用）**；用户手动打开（拨动开关）触发重新初始化；失败自动回落受限态。
- R4.3 boot 失败时弹窗提示（**复用更新弹窗 AppUpdateNotice 样式**），用户知情后可放弃容器初始化并继续浏览/使用应用。
- R4.4 **关闭即释放（teardown）**：用户关闭容器 = 真正关停——先 **flush 快照落盘**（防文件丢失/损坏；与既有自动保存叠加为双保险，见子任务2 F3.3/F4.4），再 teardown WebContainer 释放内存与后台进程；重新开启 = 重新 boot，工作区从 IndexedDB 快照恢复（与首启同路径）。**Agent 运行中禁止关闭**：run（含子 agent）活跃时容器模块开关禁用（禁止操作，见子任务3 U4.3），避免 teardown 打断运行中任务；开关改动沿用「下一轮任务生效」语义。

### R5 纯聊天降级模式

- R5.1 容器能力关闭或不可用时，agent 以**普通 AI Agent 对话客户端**运行：无容器工具注入，agent 自然终止（不做强制失败护栏）。
- R5.2 附件分析仍可用（资源存于 IndexedDB，与容器无关）。
- R5.3 会话可正常持久化、刷新后可恢复（`interrupted` → 续跑语义不变）。

### R6 未来产品线/插件挂载

- R6.1 笔记模块 = **内置扩展**（同 VSCode 内置扩展：走扩展宿主 API，但随产品打包）：独立存储 + 工具族，与容器信息互通但能力独立。**它是模块开发的第一个试验田**——HeyMean 合并时以 `kind: 'extension'` 模块上线，作为首个真实消费者验证扩展宿主 API（工具注册 + 核心能力联动 + UI 插槽），为后续 MCP/第三方插件提供成型范式。**内置扩展与第三方接口一致、可随时单独打包移出**（核心不 import 扩展内部，二次开发友好），见子任务1 design「可移植性」约束。
- R6.2 未来 Sunam 系列 agent（不同 persona/输出风格/定制化）= 同一清单做 persona 过滤，插件式挂载注入。
- R6.3 **两层模块模型：内置核心（静态）∪ 扩展模块（热插拔）**：
  - **内置核心模块**（Agent运行时 / 虚拟容器 / 资源附件 / 其他）：随应用构建期编译、启动时注册进宿主、**不可卸载**，不热插拔。容器作为内置核心模块，其 UI（终端/文件/服务）静态绑定，不需要插件化。
  - **扩展模块**（MCP / 第三方插件 / 未来服务器管理、微信传输）：运行时 `registerModule` 注册 / `unregisterModule` 卸载，**可热插拔**——热插拔的目的就是拓展生态（类比 VSCode 插件）。
  - 模块 id：内置枚举 ∪ `ext:<pluginId>`（如 `ext:mcp:serverId`）；面板渲染宿主"当前存在的模块"，扩展按注册序排在内置之后。
- R6.4 **扩展与核心的联动（插件调用 IDE 终端模式）**：
  - 扩展激活时获得**宿主 API**（ExtensionHost）：以受能力开关约束的 `AgentWorkspaceRuntime` 为入口，可调用核心能力（容器文件系统 / shell / 资源 / agent 事件订阅）——同 VSC 插件调用 IDE 系统终端。
  - **权限受核心开关约束**：容器 shell 关闭时，宿主运行时拒绝 shell 调用，扩展工具同样被拒；扩展工具可声明 `dependencies: ['shell_run']`（依赖核心能力），核心能力关 → 该扩展工具随依赖关闭。
  - 扩展工具同样必须带 capability 声明（`registerModule` 强制校验 `capability.module` 匹配）——**注入式注册不变量对扩展同样成立**，插件不可能绕过能力库直接暴露工具给 AI。
  - 扩展工具开关以稳定标识持久化（`ext:<pluginId>:<toolName>`），断开残留 override 无害（读取时丢弃未知键），重连同 id 自动复用。
- R6.5 `CapabilityModule` 自包含接口（descriptor + `kind: 'core'|'extension'` + `tools()` + `availability?` + `promptSections?` + `ui?`）；注册表即**模块宿主**（core 启动注册不可卸载，extension 运行时注册/卸载）。
- R6.6 **分层落地**：本轮核心模块真正生效（工具/可用性/prompt/模块列表可配置、可降级）；扩展宿主 API（`SunamExtension.activate(host)`）与扩展 UI 插槽**只定义接口、不实现**，列为专项后续任务；**该专项的首个落地消费者是笔记模块（内置扩展试验田）**，紧随 HeyMean 合并推进，不假装修框架。
- R6.7 manifest 数据结构需显式支持上述扩展（扩展注册/卸载、扩展对核心能力依赖、persona 对清单过滤），不为此预留死代码。

### R7 系统提示词

- R7.1 系统提示词围绕能力库**动态生成**：容器段落（工作区根/文件/进程管理）仅在容器能力开启时渲染。

## 任务图

- **父任务** `capability-library`：本 PRD，负责源需求、任务映射、跨子任务验收、最终集成审查。
- **子任务1** `capability-engine`：能力模型 + 清单 + 注册表派生 + 能力运行时 + 引擎接线 + CI 审计。
- **子任务2** `container-capability-flow`：容器三态状态机 + boot 协调 + 启动失败弹窗 + 手动重试。
- **子任务3** `capability-library-ui`：右栏能力库面板 + 双层开关 + 持久化 UI + 移动端抽屉。

**依赖顺序**：`capability-engine` → `container-capability-flow` → `capability-library-ui`（后者以前者提供的清单/配置/可用性为前提）。

## 约束

- C1 `AgentWorkspaceRuntime`（`src/shared/contracts/agentRuntime.ts`）是 Agent Core 与 WebContainer 的**唯一边界**；Agent Core 不得 import `@webcontainer/api`。能力运行时也必须实现该契约，不得另造并行 payload。
- C2 **不新增运行时护栏**：工具关闭后不被注入，agent 不感知、自然终止（沿用既有预算/轮数耗尽路径）。不做强制失败。
- C3 持久化 schema（v3）**尽量不改**。优先采用哨兵 containerId 承接纯聊天 run，而非 schema 迁移（若实现中发现 schema 确需变更，须回退到父任务审查）。
- C4 保持默认行为回归：容器可用时默认全开，暴露工具清单与现状等价。
- C5 三语 i18n（zh-CN / en-US / ja-JP）。
- C6 能力库 UI 面板本身**不依赖容器可用性**——容器受限时面板照常渲染（展示受限原因与重试）。
- C7 弹窗复用 `AppUpdateNotice` 的 overlay/卡片样式（可抽共享 CSS，不复制粘贴）。

## 跨子任务验收（父级审查）

- [ ] A1 所有工具均有 capability 声明：编译通过 + CI 审计通过，无未注册工具；「其他」分类未滥用。
- [ ] A2 回归：容器可用 + 全开时，暴露工具清单与运行行为与现状等价。
- [ ] A3 纯聊天端到端：容器能力关闭/不可用时，agent 完成一轮对话并持久化，附件可分析，刷新后状态正确。
- [ ] A4 容器 boot 失败：弹窗提示（更新弹窗样式）；用户放弃后继续纯聊天；面板显示「启动受限」；手动重试可恢复。
- [ ] A5 能力库面板：核心四模块 + 笔记扩展占位、双层开关、Agent运行时「不建议关闭」黄标与二次确认。
- [ ] A6 manifest 结构支持未来 agent 系列（persona 过滤）与笔记模块挂载（新增模块条目）。
- [ ] A7 三语 i18n 齐备；移动端面板可用。

## 不在范围

- HeyMean 笔记功能**本体重构**（存储、面板、笔记工具）——产品线合并时一并实现，**以第一个扩展模块（内置扩展试验田）形态落地**，走扩展宿主 API；本任务仅定其架构槽位与扩展契约。
- 全新设置界面（设置页重构）——后续独立任务。
- 明暗主题、多模型适配（Gemini）、消息编辑/重发等 HeyMean 深层特性。
- 服务器管理 / MCP / 微信文件传输等扩展模块（仅确认宿主可承载，不做实现）。
- **扩展宿主 API 与扩展 UI 插槽**（`SunamExtension.activate(host)`、扩展面板按插槽挂载）——专项后续任务；本轮仅定义 `CapabilityModule.ui` 接口字段。核心模块（容器/资源）UI 保持静态绑定；关容器 → 隐藏终端/文件/服务用配置驱动。
