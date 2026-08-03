# 子任务1：能力引擎（capability-engine）

> 父任务：`capability-library`（08-03-capability-library）。本子任务完成能力模型、清单、注册表派生、能力运行时与引擎接线，交付"容器能力关闭时 agent 以纯聊天模式运行"这一核心能力。子任务2（容器三态流程）与子任务3（能力库 UI）依赖本子任务的清单/配置/运行时接口。

## 需求

### E1 能力模型类型（shared 契约）

- E1.1 新增 `src/shared/contracts/capability.ts`：定义 `CapabilityBuiltinModuleId`（`'agent-runtime' | 'virtual-container' | 'resources' | 'notes' | 'other'`）、`CapabilityModuleKind`（`'core' | 'extension'`）、开放的 `CapabilityModuleId`（内置枚举 ∪ `ext:<pluginId>`）、`ToolCapabilityDeclaration`、`CapabilityModuleDescriptor`、`CapabilityConfig`、默认值与类型守卫。
- E1.2 模块排序与展示元数据（label/description 的 i18n key、图标标识、扩展模块可携带 `label` 覆盖）在该契约中声明。
- E1.3 定义哨兵 containerId（纯聊天 run 使用），如 `CHAT_ONLY_CONTAINER_ID`。

### E2 工具注入式能力声明（编译期硬约束）

- E2.1 `ToolDefinition`（`src/features/agent-core/tools/base.ts`）新增**必填** `capability: ToolCapabilityDeclaration` 字段；`RegisteredTool` 透传；`defineTool` 原样携带。
- E2.2 六个工具文件（`controlTools`/`subagentTools`/`resourceTools`/`workspaceTools`/`processTools`）内**每个** `defineTool(...)` 补齐 capability：
  - `Agent运行时`：`update_plan`/`report_progress`/`ask_user`/`complete_task`/`ask_parent`/`spawn_subagent`/`wait_subagents`/`message_subagent`（`warnOnDisable: true`）。
  - `虚拟容器`：`workspace_tree`/`read_file`/`search_workspace`/`apply_patch`/`shell_run`/`process_list`/`process_observe`/`process_input`/`process_stop`/`read_user_terminal`/`materialize_resource`。
  - `资源/附件`：`list_resources`/`read_resource_text`/`read_resource_image`。
  - `其他`：当前为空，未来兜底。
- E2.3 依赖声明：`process_*`/`read_user_terminal` 依赖 `shell_run`；`materialize_resource` 依赖容器模块（不依赖具体工具）；供开关联动与 UI 灰显。
- E2.4 缺 `capability` 声明的工具**编译失败**（必填字段），构成结构性保证。

### E3 能力配置（持久化，仅存 override）

- E3.1 新增配置读写（`src/shared/lib/capabilityConfig.ts`，复用 `storage.ts` 模式）：`CapabilityConfig` 持久化模块总开关 + 工具开关。
- E3.2 **只存 override**：默认值来自静态清单；新增工具自动按 defaultEnabled 生效，无需用户重新配置（热插拔友好）。
- E3.3 默认值：容器可用时全模块开、全部默认工具开；Agent运行时默认开（`warnOnDisable`）。

### E4 模块宿主注册表（两层：核心静态 + 扩展热插拔）

- E4.1 新增 `src/features/agent-core/capability/module.ts`：**`CapabilityModule` 自包含接口**（descriptor 含 `kind: 'core'|'extension'` + `tools()` + `availability?` + `promptSections?` + `ui?`）；内置模块组合 = 四 core（agent-runtime / virtual-container / resources / other）+ notes（`kind:'extension'` 预留占位，试验田）。
- E4.2 新增 `src/features/agent-core/capability/registry.ts`：**`CapabilityRegistry`（宿主单例）**，`registerModule` / `unregisterModule` / `modules()` / `toolsOf()` / `resolveEnabledTools(config, availability)` / `subscribe`；`registerModule` 强制校验每个工具 `capability.module === descriptor.id`（注入式不变量对扩展同样成立）；`unregisterModule` 仅对 `kind: 'extension'` 生效（core 不可卸载）。
- E4.3 **静态引导**：内置五 core 模块启动时 `registerModule` 进宿主（构建期编译，非热插拔）。
- E4.4 **扩展热插拔（为 MCP/第三方插件预留的契约）**：运行时构造 `kind: 'extension'` 的 `CapabilityModule` 再 `registerModule`（id 如 `ext:mcp:serverId`），断开 `unregisterModule` 整体卸载；面板/引擎/prompt 一律读宿主当前状态。扩展工具可声明 `dependencies` 依赖核心能力工具（如 `shell_run`），核心能力关 → 扩展工具随依赖关闭（插件与容器联动，权限受核心开关约束）。
- E4.5 `resolveEnabledTools` 语义：
  - 模块总开关关 → 该模块全部工具强制关。
  - 模块总开关开 → 工具按配置 override 或默认值。
  - 依赖闭合：某工具开启而其依赖工具被关 → 自动补开依赖（或标记并剪除，实现时选一致语义并写明）。
  - availability='restricted' → 虚拟容器模块整体排除。
- E4.6 引擎 `AgentEngine` 用 `resolveEnabledTools` 结果构造 `AgentToolRegistry`（沿用现有 `allowedTools` 参数），替换硬编码集合。
- E4.7 子 agent `toolPolicy`（`agentFamily`）与能力配置取交集：verify 子角色在 shell 被关时不获得 shell 工具。

### E5 能力运行时（AgentWorkspaceRuntime 实现）

- E5.1 新增 `src/features/runtime/CapabilityAwareRuntime.ts` 实现 `AgentWorkspaceRuntime`：
  - 容器能力可用且已 boot → 容器操作委托真实 `WebContainerAgentRuntime`。
  - 容器能力关/受限/未 boot → 容器操作 no-op/空值：`ensureContainer` 空转、`getWorkspaceRevision` 返回 0、`listWorkspace` 返回 `[]`、`runShell`/进程操作返回错误或空（工具已剪除，正常不会被调用）。
  - 资源操作（`listResources`/`readResourceText`/`readResourceImage`）**始终**走 IndexedDB（`V3PersistenceRepository`），与 WebContainer 无关。
- E5.2 `materializeResource` 属容器模块：容器不可用时返回明确错误（工具剪除，防御性兜底）。
- E5.3 `WorkspaceRuntimeProvider` 在容器未 boot/关/受限时仍提供非空 runtime（CapabilityAwareRuntime），并暴露可用性状态（见子任务2）；`isReady` 语义与"容器已就绪"解耦。

### E6 引擎接线（纯聊天模式跑通）

- E6.1 `useAgentV2.launchTask`：容器能力关闭且 `activeContainerId` 为 null 时，以 `CHAT_ONLY_CONTAINER_ID` 作为 run 的 containerId（不再因 null 提前 return）。
- E6.2 `Workspace.handleSubmit`：容器能力关闭时**不再调用 `createContainer()`**（避免生成真实容器）。
- E6.3 系统提示词（`prompt.ts`）能力感知：容器段落（工作区根/文件工具/进程管理/验证指引）仅在容器能力开启时渲染；纯聊天模式给出"无文件系统、无终端"的会话描述。
- E6.4 completion 门（`completion.ts`）：验证 `evaluateCompletionGate` 在无容器模式下行为正确——revision 恒 0 不漂移时不触发验证；`VERIFICATION_RECOVERY_GUIDANCE` 在 shell 不可用时不得引用 `shell_run`（改为通用话术）。

### E7 CI 审计（注册不变量兜底）

- E7.1 `scripts/check-architecture.mjs` 新增工具注册审计：扫描 `src/features/agent-core/tools/*.ts`，断言每个导出的 `defineTool` 都有 capability 声明且模块 id 合法。
- E7.2 「其他」分类滥用阈值：计数超阈值（如 1）即告警失败。
- E7.3 审计纳入 `npm run check`。

## 验收

- [ ] 类型层面：`defineTool` 缺 `capability` 时 `tsc` 编译失败。
- [ ] 注册表派生：关容器模块 → API definitions 不含容器工具；关 Agent运行时某工具 → 不含该工具。
- [ ] 系统提示词：容器关 → 不含工作区/进程/`shell_run` 段落。
- [ ] 纯聊天端到端（模拟 boot 失败/容器关）：agent 完成一轮对话，消息持久化，刷新后 `interrupted` 续跑语义正确。
- [ ] 附件分析：纯聊天模式下 `list_resources`/`read_resource_text`/`read_resource_image` 可用。
- [ ] completion 门：无容器模式任务正常完成，不引用 `shell_run` 验证。
- [ ] 子 agent：verify 子角色在 shell 关时不获得 shell 工具。
- [ ] CI：`check-architecture` 审计通过；缺声明/「其他」超阈值 → 失败。
- [ ] 回归：容器可用 + 默认配置时，暴露工具清单与现状等价（`git diff` 工具列表为空变更）。
- [ ] 单元/组件测试覆盖：`capabilityConfig` 读写与 override 合并、`resolveEnabledTools` 依赖语义、CapabilityAwareRuntime 各方法在两种可用性下的行为。
