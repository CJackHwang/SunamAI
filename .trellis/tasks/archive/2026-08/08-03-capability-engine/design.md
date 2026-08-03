# 子任务1：能力引擎 — 技术设计

> 面向实现者的设计。先读父任务 `prd.md` 与子任务1 `prd.md`。相关 spec：`agent/architecture-and-data-flow.md`、`agent/revision-verification-and-completion.md`、`agent/subagents-and-cancellation.md`、`agent/persistence-and-snapshots.md`、`state/ownership-and-workspace-store.md`、`foundation/architecture-and-boundaries.md`、`foundation/type-safety.md`。

## 1. 核心不变量

- **I1 注入式注册**：一个工具要进 Agent，必经 `defineTool` 且带 `capability` 声明；不声明即编译失败。
- **I2 清单派生**：注册表 allow-set、能力库 UI 展示、系统提示词，全部由**同一份静态清单**（从工具数组聚合）派生，不存在第二份手写清单。
- **I3 运行时边界**：`AgentWorkspaceRuntime` 是 Agent Core 与 WebContainer 的唯一边界；能力运行时实现同一契约。
- **I4 配置默认**：默认值来自清单；持久化仅存 override。

## 2. 类型设计

### 2.1 `src/shared/contracts/capability.ts`（新）

```ts
// 内置模块 id（面板固定顺序）。扩展模块（MCP/插件）id 为 'ext:<pluginId>'，按注册序排在内置之后。
export const CAPABILITY_BUILTIN_MODULES = ['agent-runtime', 'virtual-container', 'resources', 'notes', 'other'] as const;
export type CapabilityBuiltinModuleId = (typeof CAPABILITY_BUILTIN_MODULES)[number];
export type CapabilityModuleId = string; // 开放 id：内置枚举 ∪ 'ext:<pluginId>'（如 'ext:mcp:serverId'）

// 模块种类：core=内置核心（构建期编译、不可卸载、不热插拔）；extension=扩展（运行时注册/卸载、可热插拔）。
export type CapabilityModuleKind = 'core' | 'extension';

// 容器可用性（会话态，易失）。定义在契约层供 UI 与运行时共享。
export type CapabilityAvailability = 'enabled' | 'disabled' | 'restricted';
// restricted = 启动受限：boot 失败，用户可手动重试。

// 工具能力声明，随 defineTool 注入。
export interface ToolCapabilityDeclaration {
  module: CapabilityModuleId;      // 必填。内置枚举或 'ext:<pluginId>'；'other' 仅真兜底。
  defaultEnabled: boolean;         // 默认是否暴露给 AI。
  warnOnDisable?: boolean;         // true = Agent运行时，「不建议关闭」黄标 + 二次确认。
  dependencies?: string[];         // 依赖的工具名；开启时自动补开依赖（见 4.5）。
}

// 展示元数据。labelKey/descriptionKey 为 i18n key；扩展模块可带 label 覆盖。
export interface CapabilityModuleDescriptor {
  id: CapabilityModuleId;
  kind: CapabilityModuleKind;   // core（内置）/ extension（可热插拔）
  labelKey: string;      // e.g. 'capability.module.virtual-container'
  descriptionKey: string;
  iconKey: string;       // 面板图标标识（映射 lucide 图标）。
  reserved?: boolean;    // 预留模块（notes）：面板展示但禁用开关。
  label?: string;        // extension 用：插件提供的展示名（覆盖 i18n key 回退）。
}

// 持久化配置（仅存 override）。
export interface CapabilityConfig {
  modules: Partial<Record<CapabilityModuleId, { enabled: boolean }>>;
  tools: Partial<Record<string, boolean>>; // toolName -> enabled override
}

export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = { modules: {}, tools: {} };

// 哨兵：纯聊天 run 的 containerId，不注册进 workspace store、不落快照。
export const CHAT_ONLY_CONTAINER_ID = '__chat__';

// 类型守卫
export function isCapabilityBuiltinModuleId(value: unknown): value is CapabilityBuiltinModuleId;
export function isCapabilityConfig(value: unknown): value is CapabilityConfig; // 模块键开放为任意字符串
```

层归属：类型与常量在 `shared`，`features/agent-core` 与 `widgets` 均可引用，符合依赖方向。

### 2.2 `ToolDefinition` 增字段（`tools/base.ts`）

```ts
export interface ToolDefinition<TSchema extends z.ZodType> {
  // ...现有字段不变
  capability: ToolCapabilityDeclaration; // 必填，新增
}
export interface RegisteredTool { /* ... */ capability: ToolCapabilityDeclaration; }
export function defineTool<TSchema extends z.ZodType>(d: ToolDefinition<TSchema>): RegisteredTool {
  return { ...d, execute: (input, ctx) => d.execute(input as z.infer<TSchema>, ctx) };
}
```

每个 `defineTool(...)` 须显式写 `capability`。为减噪音可在各工具文件顶部定义局部常量：

```ts
const C = { module: 'virtual-container' as const, defaultEnabled: true };
```

### 2.3 工具分类清单（照此补齐）

| 工具 | 模块 | warnOnDisable | dependencies |
|---|---|---|---|
| `update_plan` `report_progress` `ask_user` `complete_task` `ask_parent` | agent-runtime | true | — |
| `spawn_subagent` `wait_subagents` `message_subagent` | agent-runtime | true | — |
| `workspace_tree` `read_file` `search_workspace` | virtual-container | — | — |
| `apply_patch` | virtual-container | — | — |
| `shell_run` | virtual-container | — | — |
| `process_list` `process_observe` `process_input` `process_stop` `read_user_terminal` | virtual-container | — | `['shell_run']` |
| `materialize_resource` | virtual-container | — | — |
| `list_resources` `read_resource_text` `read_resource_image` | resources | — | — |
| （空） | notes / other | — | — |

## 3. 配置持久化

`src/shared/lib/capabilityConfig.ts`（复用 `storage.ts` 的 `readText`/`writeText`）：

```ts
const KEY = STORAGE_KEYS.capabilityConfig; // 新增 key
export function readCapabilityConfig(): CapabilityConfig;
export function saveCapabilityConfig(config: CapabilityConfig): void;
// 合并默认值，仅返回有效模块/工具键（模块键开放为任意字符串；工具键以稳定标识为准，未知键丢弃）。
```

- 工具 override 只存 `enabled` 与默认不同的值（差分写入，保持最小存储）。
- 幂等：读取时丢弃未知模块/工具键（新版本 schema 演进安全）。

## 4. 活注册表（Capability Registry）

> **关键设计**：能力清单不是"模块加载时冻结的 const 数组"，而是**运行时可变、可热插拔的模块宿主**。**模块本身（而非仅工具）是自包含单元**，整体注册/卸载——组件式开发、降耦合。内置模块启动时注册；MCP/第三方插件运行时注册/卸载。UI、引擎、prompt、CI 一律读宿主当前状态——这就是父任务 R6.3 的注入式管理落点。

### 4.1 模块接口 `src/features/agent-core/capability/module.ts`（新）

```ts
// 一个能力模块 = 自包含单元。
//  core：内置核心（容器/资源/Agent运行时），构建期编译、不可卸载、不热插拔。
//  extension：扩展（MCP/第三方），运行时注册/卸载、可热插拔，可声明对核心能力的依赖。
export interface CapabilityModule {
  descriptor: CapabilityModuleDescriptor;      // 含 kind: 'core' | 'extension'
  tools: () => RegisteredTool[];               // 该模块贡献的工具（每个自带 capability 声明）
  availability?: {                             // 可用性协调（容器三态即此实现，见子任务2）
    initialize(): Promise<CapabilityAvailability>;
    retry(): Promise<CapabilityAvailability>;
  };
  promptSections?: (ctx: PromptContext) => string[];   // 系统提示词段落贡献（R7）
  ui?: {                                       // UI 插槽贡献（本期只声明接口，扩展插槽挂载为专项后续任务）
    workspace?: React.ComponentType;           // 工作区面板插槽（未来扩展面板；核心模块 UI 保持静态绑定）
    settings?: React.ComponentType;            // 设置区插槽
    mobileNav?: React.ComponentType;
  };
}

// —— 模块化组合 ——
//  core：agent-runtime / virtual-container / resources / other（构建期静态，不热插拔）
//  extension：notes（内置扩展占位，试验田）——真实笔记随 HeyMean 合并以 kind:'extension' 上线，
//              registerModule 同 id 覆盖本占位；类比 VSCode 内置扩展走同一扩展宿主 API。
export const agentRuntimeModule: CapabilityModule = {
  descriptor: { id: 'agent-runtime', kind: 'core', labelKey: 'capability.module.agent-runtime', descriptionKey: '...', iconKey: 'cpu' },
  tools: () => [...controlTools, ...subagentTools],
  promptSections: () => [...agentLoopParagraphs()],
};
export const virtualContainerModule: CapabilityModule = {
  descriptor: { id: 'virtual-container', kind: 'core', labelKey: '...', descriptionKey: '...', iconKey: 'box' },
  tools: () => [...workspaceTools, ...processTools, materializeResourceTool],
  availability: containerAvailability,        // 子任务2 的 ContainerAvailabilityController 实现
  promptSections: () => containerParagraphs(), // 工作区/进程/验证段落，能力关时整体不注入
};
export const resourcesModule: CapabilityModule = {
  descriptor: { id: 'resources', kind: 'core', labelKey: '...', descriptionKey: '...', iconKey: 'paperclip' },
  tools: () => [listResourcesTool, readResourceTextTool, readResourceImageTool],
};
export const notesModule: CapabilityModule = { descriptor: { id: 'notes', kind: 'extension', reserved: true, labelKey: '...', descriptionKey: '...', iconKey: 'notebook' }, tools: () => [] };
export const otherModule: CapabilityModule = { descriptor: { id: 'other', kind: 'core', ... }, tools: () => [] };
```

- `PromptContext` = `{ containerId, task, agentRole, config, availability }` 的最小形状，由 `prompt.ts` 定义。
- 静态引导 = 把上述 core 模块 `registerModule`（`manifest.ts`）；扩展模块（MCP）运行时构造 `kind: 'extension'` 的同形状 `CapabilityModule` 再注册——接口一致，无两套模型。

#### 扩展宿主 API（未来形状，本期不实现）

```ts
// 插件与核心联动（类比 VSC 插件调用 IDE 系统终端）：专项后续任务。
export interface ExtensionHost {
  capabilityRuntime: AgentWorkspaceRuntime; // 受能力开关约束：容器 fs/shell/资源，关则拒绝
  registry: CapabilityRegistry;             // 注册/卸载自身工具
  // 未来：agent 事件订阅、资源读写、快照等
}
export interface SunamExtension {
  id: string;            // 'ext:mcp:serverId' / 'ext:com.vendor.plugin'
  activate(host: ExtensionHost): void;      // 构造工具 → registerModule
  deactivate?(): void;                      // → unregisterModule
}
```
- **权限受核心开关约束**：扩展工具经 `host.capabilityRuntime` 调容器能力；容器 shell 关 → `CapabilityAwareRuntime.runShell` 拒绝，扩展工具同样被拒。扩展工具也可声明 `dependencies: ['shell_run']`，核心能力关 → 随依赖关闭（同一能力库开关同时约束 AI 与扩展）。

### 4.2 注册表宿主 `src/features/agent-core/capability/registry.ts`（新）

```ts
export class CapabilityRegistry {
  private modules = new Map<CapabilityModuleId, CapabilityModule>();
  private listeners = new Set<() => void>();   // UI 订阅宿主变化

  // —— 注册/卸载（整体热插拔）——
  registerModule(module: CapabilityModule): void;   // 校验每个工具 capability.module === module.descriptor.id，否则 throw
  unregisterModule(id: CapabilityModuleId): boolean;

  // —— 读取（UI/引擎/prompt 共用）——
  modules(): CapabilityModule[];                    // 内置序 → 注册序（extension 在后）
  toolsOf(id: CapabilityModuleId): RegisteredTool[];
  hasModule(id: CapabilityModuleId): boolean;
  getTool(name: string): RegisteredTool | undefined;
  resolveEnabledTools(config: CapabilityConfig, availability?: CapabilityAvailability): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

export const capabilityRegistry = new CapabilityRegistry(); // 单例
```

- **`registerModule` 强制校验** 每个 `tool.capability.module === module.descriptor.id`——扩展模块必须带能力声明才能进宿主，注入式不变量对 MCP/插件同样成立（安全：插件不可能绕过能力库直接暴露工具）。
- **UI 联动**：宿主变化（扩展连接/断开）通过 `subscribe` 通知面板刷新，扩展模块/工具即时出现或消失。
- **`unregisterModule` 语义**：卸载模块即卸载其全部工具；**`kind: 'core'` 一律拒绝卸载**（内置不可卸载），仅 `kind: 'extension'` 可卸载。
- **可用性聚合**：宿主对含 `availability` 的模块（当前仅容器）驱动初始化/重试；`resolveEnabledTools` 以 `CapabilityAvailability` 为入参（见 4.5）。

### 4.3 静态引导 `src/features/agent-core/capability/manifest.ts`（新）

```ts
import { agentRuntimeModule, virtualContainerModule, resourcesModule, notesModule, otherModule } from './module';

export function bootstrapCapabilityRegistry(): void {
  capabilityRegistry.registerModule(agentRuntimeModule);
  capabilityRegistry.registerModule(virtualContainerModule);
  capabilityRegistry.registerModule(resourcesModule);
  capabilityRegistry.registerModule(notesModule);
  capabilityRegistry.registerModule(otherModule);
}
```

- 引导在应用启动早期执行一次（`main.tsx` 或 `ConfiguredPage` 之上）。幂等（重复引导直接覆盖）。
- 内置模块即"宿主当前状态"的一部分；此后 UI/引擎不再 import 工具数组，只读宿主。

### 4.4 扩展热插拔契约（为 MCP/第三方插件预留，不实现）

```ts
// 未来 MCP 适配器（不在此任务实现；宿主 API 形状见 4.1「扩展宿主 API」）：
// 1. 扩展 activate(host)：
//    schema 列表 → tools = schema.map(s => defineTool({ ..., capability: {
//      module: `ext:mcp:serverId`, defaultEnabled: true,
//      dependencies: ['shell_run'],   // 可选：声明依赖核心能力（容器 shell 关 → 本工具随依赖关）
//    } }))
//    → capabilityRegistry.registerModule({ descriptor: { id: `ext:mcp:serverId`, kind: 'extension', ... }, tools })
// 2. 面板自动出现 `ext:mcp:serverId` 模块（kind='extension'，label 由插件提供）
// 3. 断开 → deactivate() → unregisterModule(`ext:mcp:serverId`)
// 4. 开关配置按稳定标识持久化：config.tools[`ext:mcp:serverId:${toolName}`]；断开残留 override 读取时丢弃，重连同 id 自动复用
```

- 扩展模块无需 availability 处理（无 boot 依赖）；`resolveEnabledTools` 对非容器模块统一按 config 处理。
- **扩展 UI 插槽**：扩展可声明 `ui.workspace/settings`（如笔记面板、服务器管理面板），挂载由"扩展宿主 API"专项（父任务路线图）提供；本轮仅定义接口。
- **扩展↔核心联动**：扩展工具经宿主运行时调容器能力（fs/shell/资源），权限受能力开关约束——核心能力关 → 宿主运行时拒绝，扩展工具同样被拒（同 VSC 插件与 IDE 系统终端的关系）。

#### 内置扩展试验田：笔记（`ext:notes`）

```ts
// 笔记 = 第一个真实扩展（内置扩展，HeyMean 合并时落地，验证扩展 API 范式）：
// 1. registerModule 覆盖 §4.1 的 notes 占位（同 id，reserved 去掉）
//    descriptor: { id: 'notes', kind: 'extension', labelKey: 'capability.module.notes', iconKey: 'notebook' }
// 2. tools: note_search / note_read / note_write / note_pin 等（每个带 capability.module='notes'）
//    —— 笔记存储独立于容器（IndexedDB notes store），能力独立
// 3. 笔记↔容器联动：note_materialize 可把笔记落盘到容器工作区（依赖容器文件能力）
//    dependencies: ['apply_patch']，容器文件关 → 该工具随依赖关闭（同 VSC 插件调 IDE 终端）
// 4. ui.workspace: 笔记面板（扩展 UI 插槽挂载，专项实现）
// 5. 开关配置持久化：config.tools['notes:note_write'] 等
```

#### 加载机制与模块接口正交（扩展分发模型）

```ts
// 扩展 = 自包含文件夹 = 未来可 zip 分发。加载方式只是"代码如何到达"，与模块接口正交：
//  A) 内置扩展（笔记）：源码文件夹 src/extensions/notes/，Vite 构建期编译进 bundle，随产品发布。
//  B) 构建期插件：插件文件夹移入仓库（如 src/extensions/<id>/），随下次构建发布。
//  C) 运行时 zip（MCP/第三方，未来）：下载 zip → 浏览器内解压 → 动态 ESM import() 加载入口，
//     → 入口构造 CapabilityModule → registerModule。
//     现实约束（实现时立项评审）：COEP credentialless 限制跨域资源加载；任意代码执行是巨大信任
//     边界（浏览器无扩展沙箱），需签名/信任模型与安全审查。
// 核心结论：接口不感知代码来源——A/B/C 进入宿主的方式完全一致，当前任务只实现 A（内置扩展）。
```

- **文件夹约定**：扩展模块按"一个文件夹一个模块"组织（`src/extensions/<id>/`，内含 `index.ts` 导出 `CapabilityModule` + 自包含的 store/工具/UI 插槽），与 zip 分发天然对应。内置核心模块（容器/资源）是注册表**包装的既有代码**，不适用文件夹约定。
- **可移植性（内置扩展可随时单独打包移出，便于二次开发）**：核心只认识"注册表里 id='notes' 的扩展"，从不 import 扩展内部——删文件夹应用照常运行（面板少一项或回占位态），移出可独立发布/独立构建。**实现约束（硬纪律）**：扩展文件夹只允许 import `@/shared/*` 公开契约 + ExtensionHost API，**不得 import `@/features/*`、`@/widgets/*` 内部**（沿用现有 feature 边界规则）；CI 检查扩展目录的 import 白名单，违规即失败。满足即保住了可移植性。

### 4.5 `resolveEnabledTools(config, availability)`：工具开关语义

```ts
export function resolveEnabledTools(config: CapabilityConfig, availability?: CapabilityAvailability): ReadonlySet<string> {
  const enabled = new Set<string>();
  for (const module of capabilityRegistry.modules()) {
    const moduleOn = module.descriptor.id === 'virtual-container' && availability === 'restricted'
      ? false                                             // 受限：容器模块整体不可用
      : (config.modules[module.descriptor.id]?.enabled ?? true);  // 模块默认开
    if (!moduleOn) continue;
    for (const tool of capabilityRegistry.toolsOf(module.descriptor.id)) {
      if (config.tools[tool.name] ?? tool.capability.defaultEnabled) enabled.add(tool.name);
    }
  }
  // 依赖闭合：process_* 开了但 shell_run 没开 → 自动补开 shell_run。
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...enabled]) {
      const deps = capabilityRegistry.getTool(name)?.capability.dependencies ?? [];
      for (const dep of deps) if (!enabled.has(dep)) { enabled.add(dep); changed = true; }
    }
  }
  return enabled;
}
```

- **availability 参数**：`'restricted'` 时容器模块工具一律不进入集合（即使配置模块开）。
- 说明：控制流工具默认 `defaultEnabled: true`，用户关闭即不入注册表 → agent 不感知 → 按父任务 C2 不做运行时强制（不新增护栏）。
- 引擎构造注册表：`new AgentToolRegistry(allowedTools)`（`AgentToolRegistry` 现有构造已支持，`tools.ts:18-21`），同时保留现有 root `hiddenTools: ['ask_parent']` 逻辑。

### 4.6 子 agent 交集

`agentFamily.ts` 中构造子 run 的 toolPolicy 时，`allowedTools = childAllowed ∩ resolveEnabledTools(config)`。verify 子角色在 shell 关时不获得 `shell_run`。

## 5. 能力运行时

### 5.1 `src/features/runtime/CapabilityAwareRuntime.ts`（新）

```ts
export class CapabilityAwareRuntime implements AgentWorkspaceRuntime {
  constructor(opts: {
    containerRuntime: WebContainerAgentRuntime | null;  // 容器已 boot 才有
    repository?: V3PersistenceRepository;                // 默认 v3Persistence
    containerAvailable: boolean;                          // 可用性（是否进入受限）
  });
  // 容器能力生效与否由构造期决定；运行中切换由 provider 重建实例（见子任务2）。
}
```

方法语义矩阵：

| 方法 | containerAvailable=false（受限/关/未boot） | containerAvailable=true |
|---|---|---|
| `ensureContainer(id)` | no-op | 委托 containerRuntime |
| `getWorkspaceRevision(id)` | `0` | 委托 |
| `flushWorkspace(id)` / `flushSnapshots()` | no-op | 委托 |
| `listResources`/`readResourceText`/`readResourceImage` | **始终**走 `repository`（IndexedDB） | 委托（内部同为 repository，行为一致） |
| `materializeResource(...)` | throw `Capability disabled`（工具剪除，防御） | 委托 |
| `listWorkspace`/`readWorkspaceFile`/`searchWorkspace`/`applyWorkspaceChanges` | `[]` / throw（防御） | 委托 |
| `runShell`/`observeProcess`/`sendProcessInput`/`stopProcess`/`getProcesses`/`stopRun` | throw `Capability disabled` / 空 | 委托 |
| `getUserTerminalBuffer`/`appendUserTerminalBuffer` | 空字符串 / no-op | 委托 |
| `subscribe` | 空订阅器 | 委托 |

> 资源三方法在 `WebContainerAgentRuntime` 中本就走 `this.repository`（`WebContainerAgentRuntime.ts:86-110`），不依赖 WebContainer 实例——能力运行时直接复用 repository，无行为偏差。

### 5.2 资源能力独立开关的语义

资源模块工具关闭时，`CapabilityAwareRuntime` 的 `listResources` 等**仍应可调用**（runtime 方法本身不裁剪，裁剪发生在注册表）。即：runtime 提供全部资源能力，是否暴露给 AI 由注册表决定。避免"关闭开关但 runtime 也拒了"造成资源处理链路（`resourceProcessor`）断链。resourceProcessor 在 attachment 处理路径中直接调用 runtime 资源方法（`engine.ts` 的 `resourceProcessor.process`），不可因开关而失效。

## 6. 引擎接线

### 6.1 `useAgentV2.launchTask`（`useAgentV2.ts:199-202`）

```ts
const containerId = overrideContainerId
  ?? activeContainerId
  ?? (containerCapabilityOff ? CHAT_ONLY_CONTAINER_ID : undefined);
if (!sessionId || !containerId || !runtime || !userPrompt.trim()) return;
```

- `useAgentV2` 需新增一个能力上下文入参（`capabilityConfig` + `containerAvailability`），由 `ConfiguredPageContent` 从 provider 读取后传入（子任务2 提供 provider 状态；本子任务先以 `WorkspaceRuntimeContext` 暴露的可用性为准）。
- run 的 containerId 为 `CHAT_ONLY_CONTAINER_ID` 时：不创建 workspace store 容器、不落快照、不参与删除协调。恢复路径 `resumeTask` 中 `runtime.ensureContainer(CHAT_ONLY_CONTAINER_ID)` 由能力运行时 no-op，`getWorkspaceRevision` 恒 0，漂移检测自然无变化。

### 6.2 `Workspace.handleSubmit`（`Workspace.tsx:154`）

```ts
const containerId = activeContainerId ?? (containerCapabilityOff ? undefined : createContainer());
```

容器能力关时不建真实容器，交给 `launchTask` 解析为哨兵。

### 6.3 系统提示词（`prompt.ts`）

`buildAgentSystemPrompt` 增加 `capabilities` 入参（或 `containerAvailable: boolean`）。渲染条件：

- `containerAvailable=true`：现状全部段落（工作区根路径、文件工具、进程管理、验证指引、路径禁止项）。
- `containerAvailable=false`：替换为一段「会话环境」说明：无文件系统、无终端、无进程；只能基于对话与附件资源回答；完成遵循完整性与真实性。

同时引擎内对 `verify` 角色的生成（`agentFamily.ts`）在无 shell 时不下发"运行 shell 验证"指令。

### 6.4 completion 门（`completion.ts`）

- 现状：`evaluateCompletionGate` 读 `getWorkspaceRevision(containerId)`（受限时恒 0）与 `task.verifiedRevision` 比较。
- 无容器：无 mutation 工具 → revision 恒 0 不漂移 → 不触发验证分支。**预期无需逻辑改动**，但需测试确认。
- `VERIFICATION_RECOVERY_GUIDANCE` 在 shell 不可用时不得出现——该消息只在 `ok:false, phase:'verifying'` 时返回；若无容器场景不会进入此分支，仍加一个测试断言其不可达；若实现中发现会进入，则按 capability 分支改用通用话术（不引用 `shell_run`）。

### 6.5 `WorkspaceRuntimeProvider` / `runtimeSingleton`

- `getWorkspaceRuntime()` 现于 boot 失败时 reject（`runtimeSingleton.ts:19-22`）。子任务2 会重构为"受限态提供 CapabilityAwareRuntime"。本子任务先行提供 `createCapabilityAwareRuntime({ containerRuntime: null, ... })` 与 `runtimeSingleton` 的受限分支接口，供子任务2 组装；`isReady` 语义改为"聊天可用"（非"容器就绪"）。

## 7. i18n key 草案

三个 locale（`zh-CN`/`en-US`/`ja-JP`）各加：

```
'capability.title'                   能力库 / Capabilities / 機能ライブラリ
'capability.module.agent-runtime'    Agent运行时 / Agent Runtime / エージェントランタイム
'capability.module.virtual-container' 虚拟容器 / Virtual Container / 仮想コンテナ
'capability.module.resources'        资源附件 / Attachments / リソース
'capability.module.notes'            笔记管理 / Notes / ノート管理
'capability.module.other'            其他 / Other / その他
'capability.warnOnDisable'           不建议关闭 / Not recommended to disable / 無効化は推奨されません
'capability.status.restricted'       启动受限 / Startup restricted / 起動制限
'capability.status.enabled'          已开启 / Enabled / 有効
'capability.status.disabled'         已关闭 / Disabled / 無効
'capability.toggle.confirm'          关闭「{{name}}」后 AI 将无法调用该能力，确定吗？ / ...
```

## 8. CI 审计（`scripts/check-architecture.mjs`）

- 扫描 `src/features/agent-core/tools/*.ts` 中每个 `defineTool` 调用（正则，与现有脚本风格一致）。
- **脚本 = 粗筛 tripwire**：`defineTool` 数量 vs `capability:` 声明数量比对，缺声明即失败（`process.exitCode = 1`，纳入 `npm run check`）。
- **精确校验由单元测试承担**（`tests/unit/capabilityRegistry.test.ts`，被 `test:coverage` 门禁兜住）：`capability.module` 合法、工具名唯一、`registerModule` 模块匹配、依赖闭合、「其他」阈值 ≤ 1。
- 说明：工具文件用 `capability: VIRTUAL_CONTAINER` 这类 const 引用声明归属，正则无法解析出模块 id，故模块合法性、唯一名、「其他」阈值只能交给能求值注册表的单测，脚本不做重复实现。

## 9. 文件变更地图

| 动作 | 路径 |
|---|---|
| 新增 | `src/shared/contracts/capability.ts` |
| 新增 | `src/shared/lib/capabilityConfig.ts` |
| 新增 | `src/features/agent-core/capability/module.ts`（CapabilityModule 接口 + 内置模块组合） |
| 新增 | `src/features/agent-core/capability/registry.ts`（CapabilityRegistry 宿主单例） |
| 新增 | `src/features/agent-core/capability/manifest.ts`（静态引导 bootstrapCapabilityRegistry） |
| 新增 | `src/features/runtime/CapabilityAwareRuntime.ts` |
| 修改 | `src/features/agent-core/tools/base.ts`（capability 字段） |
| 修改 | `src/features/agent-core/tools/{control,subagent,resource,workspace,process}Tools.ts`（每个工具补声明） |
| 修改 | `src/features/agent-core/engine.ts`（注册表派生、prompt 入参） |
| 修改 | `src/features/agent-core/useAgentV2.ts`（哨兵 containerId、能力入参） |
| 修改 | `src/features/agent-core/prompt.ts`（能力感知段落） |
| 修改 | `src/features/agent-core/agentFamily.ts`（子角色 toolPolicy 交集） |
| 修改 | `src/features/agent-core/completion.ts`（验证提示可达性，视实现） |
| 修改 | `src/features/runtime/WorkspaceRuntimeProvider.tsx` / `runtimeSingleton.ts`（受限运行时组装接口） |
| 修改 | `src/widgets/workspace/Workspace.tsx`（handleSubmit 不建容器） |
| 修改 | `scripts/check-architecture.mjs`（注册审计） |
| 修改 | `src/shared/i18n/locales/*.ts`（三语 key） |
| 修改 | `src/shared/lib/storage.ts`（STORAGE_KEYS.capabilityConfig） |

## 10. 测试计划

- **单元** `tests/unit/capabilityConfig.test.ts`：读/写/merge override、未知键丢弃、默认合并。
- **单元** `tests/unit/capabilityRegistry.test.ts`：静态引导覆盖全部内置模块与工具、无重复名、`registerModule` 模块匹配校验（工具 capability.module 必须等于模块 id）、`unregisterModule` 卸载工具、`modules()` 排序（内置在前 extension 在后）、预留模块不可卸载；`resolveEnabledTools` 依赖闭合与 availability=restricted 语义。
- **单元** `tests/unit/capabilityRuntime.test.ts`：两种可用性下 CapabilityAwareRuntime 方法行为矩阵（重点：受限时 revision 恒 0、资源方法可用）。
- **单元/集成** `tests/unit/capabilityCompletion.test.ts`：无容器模式下 completion 门通过、不触发 `shell_run` 引用。
- **组件** `tests/component/*`：`Workspace.handleSubmit` 在容器关时不调 `createContainer`。
- **回归**：容器可用 + 默认配置时，`AgentToolRegistry.getApiDefinitions()` 与改造前一致（可加快照断言）。
- **E2E**（子任务2/3 落地后补充）：容器不可用 → 纯聊天全流程。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| completion 门/验证在无容器下出现未知路径 | 提前写 `capabilityCompletion.test`，无容器分支先行隔离 |
| resourceProcessor 依赖 runtime 资源方法而开关误伤 | runtime 资源方法不裁剪，仅注册表裁剪；测试覆盖附件流程 |
| 哨兵 containerId 与删除/恢复协调冲突 | 哨兵不进 store、不落快照；`deleteContainer` 过滤天然排除 |
| 「其他」分类被滥用 | CI 阈值 + `module` 必填编译约束 |
| **扩展接口抽象过度（YAGNI）** | 本轮只把模块接口定到"工具+可用性+prompt"层（core 真实生效）；扩展宿主 API 与扩展 UI 插槽**只声明接口字段不实现**，列为专项后续任务，不假装修框架 |
| 扩展模块注册导致工具名冲突 | `registerModule` 校验重复工具名，冲突即 throw；扩展工具名以稳定标识命名（`ext:<pluginId>:<tool>`） |
