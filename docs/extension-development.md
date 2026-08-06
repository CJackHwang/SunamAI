# 能力库扩展模块开发指南

本文面向在 Sunam 上开发**能力扩展模块**（MCP 服务器、第三方插件、笔记模块等）的开发者。扩展模块通过能力库宿主热插拔地给 Agent 注入可调用工具，与内置核心模块（Agent运行时 / 虚拟容器 / 资源附件 / 其他）同走一套接口。

- 能力模型与注册表契约：`.trellis/spec/frontend/agent/capability-library.md`
- 核心实现：`src/features/agent-core/capability/{module,registry,manifest}.ts`
- 能力库面板：`src/widgets/capability/`
- 纯聊天降级运行时：`src/features/runtime/CapabilityAwareRuntime.ts`

> **已实现 / 规划中**：本文区分两种能力。**已实现**——`CapabilityModule` 接口、`registerModule`/`unregisterModule` 热插拔、面板自动渲染注册的模块。**规划中**——`SunamExtension.activate(host)` 宿主 API、`ExtensionHost` 与扩展 UI 插槽（见 §6），以「专项后续任务」排期，首轮落地消费者是笔记模块（内置扩展试验田）。

## 1. 核心 / 扩展两层模型

| | 内置核心模块 | 扩展模块 |
|---|---|---|
| 例子 | Agent运行时、虚拟容器、资源附件、其他 | 笔记（试验田）、MCP、第三方插件 |
| 注册时机 | 应用启动引导（`bootstrapCapabilityRegistry`） | 运行时 `registerModule` / `unregisterModule` |
| 可卸载 | **否**（`kind: 'core'`） | **是**（`kind: 'extension'`） |
| 模块 id | `agent-runtime` / `virtual-container` / `resources` / `notes` / `other` | `ext:<pluginId>`（如 `ext:mcp:serverId`） |

热插拔的目的就是拓展生态（类比 VSCode 插件）：扩展可随时接入/断开，能力库面板、Agent 工具注入与系统提示词会自动反映注册表当前状态。

## 2. 最小扩展示例

一个扩展 = 一个自包含 `CapabilityModule`，构造后注册进 `capabilityRegistry`：

```ts
import { defineTool } from '@/features/agent-core/tools/base';
import { capabilityRegistry } from '@/features/agent-core/capability/registry';
import type { CapabilityModule } from '@/features/agent-core/capability/module';

const helloTool = defineTool({
  name: 'ext_hello',
  description: 'Say hello — the extension tool signature.',
  schema: z.object({ name: z.string() }),
  readOnly: true,
  concurrencySafe: true,
  dataImpact: 'none',
  timeoutMs: 5_000,
  resultType: 'text',
  // 必填：声明归属模块，id 必须与所在模块一致（注入式注册不变量）
  capability: { module: 'ext:hello', defaultEnabled: true },
  async execute(input) { return { ok: true, content: `Hello, ${input.name}!` }; },
});

const helloModule: CapabilityModule = {
  descriptor: {
    id: 'ext:hello',
    kind: 'extension',
    labelKey: 'capability.module.other', // 或自备 i18n key
    descriptionKey: 'capability.module.other.description',
    iconKey: 'package',
    label: 'Hello 扩展', // 动态模块展示名
  },
  tools: () => [helloTool],
};

// 接入
capabilityRegistry.registerModule(helloModule);
// 断开（卸载工具 + 模块；面板即时消失）
capabilityRegistry.unregisterModule('ext:hello');
```

注册后：
- 能力库面板自动出现「Hello 扩展」模块（含总开关 + 工具子开关）。
- Agent 引擎下次 run 通过 `resolveEnabledTools` 自动注入 `ext_hello`（若开关开启）。
- 断开后面板与 Agent 注入同步移除。

## 3. 工具能力声明契约（注入式注册不变量）

每个 Agent 可调用工具**必须**通过 `defineTool` 携带 `capability`，缺失即编译失败：

```ts
capability: {
  module: CapabilityModuleId;      // 必填：内置枚举或 'ext:<pluginId>'，必须等于所在模块 id
  defaultEnabled: boolean;         // 默认是否暴露给 AI
  warnOnDisable?: boolean;         // true → 面板显示「不建议关闭」黄标 + 关闭二次确认
  dependencies?: readonly string[]; // 依赖的工具名；开启本工具自动补开依赖
}
```

`registerModule` 会**强制校验**每个工具的 `capability.module === module.descriptor.id`，不匹配即抛错——插件不可能绕过能力库直接把工具暴露给 AI。依赖示例：`manage_process` 依赖 `run_command`，容器 shell 关闭时随依赖关闭。

## 4. 配置持久化

- 模块总开关与工具开关只存 **override**（与默认不同的值），默认值来自 manifest，新增工具自动按 `defaultEnabled` 生效。
- 扩展工具的开关键为稳定标识：`ext:<pluginId>:<toolName>`。
- 扩展断开后残留 override 无害（读取时按注册表丢弃未知键）；重连同 id 自动复用用户的开关配置。

## 5. 目录约定与可移植性

扩展模块按「一个文件夹一个模块」组织，内置扩展也不例外：

```
src/extensions/<id>/
  index.ts        // 构造 CapabilityModule 并 registerModule
  tools.ts        // 本模块工具（每个 defineTool 带 capability 声明）
  ...             // 自包含的 store / UI 插槽 / 资源
```

**可移植性硬纪律**：扩展文件夹只允许 import `@/shared/*` 公开契约 + 宿主 API，**不得 import `@/features/*`、`@/widgets/*` 内部**（沿用 feature 边界规则；CI 应检查扩展目录 import 白名单）。满足此约束即可随时把扩展单独打包移出（独立构建 / 作为构建期插件重新接入），内置扩展与第三方扩展接口完全一致、便于二次开发。未来可进一步支持 zip 分发（运行时解压 + 动态 ESM 加载），但属规划中。

## 6. 宿主 API 与扩展 UI 插槽（规划中）

本轮已实现「注册表热插拔」；`SunamExtension.activate(host)` 宿主 API 与扩展 UI 插槽为专项后续任务，**接口已定、未实现**：

```ts
// 插件与核心联动（类比 VSC 插件调用 IDE 系统终端）
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

- **权限受核心开关约束**：扩展工具经 `host.capabilityRuntime` 调容器能力；容器 shell 关闭时宿主运行时拒绝，扩展工具同样被拒（同一能力库开关同时约束 AI 与扩展）。
- **扩展 UI 插槽**：`CapabilityModule.ui`（`workspace` / `settings` / `mobileNav`）可声明扩展面板，挂载由扩展宿主专项提供。
- 扩展激活获得宿主 API 后，`registerModule` 校验照旧，无法绕过能力库。

## 7. 笔记模块 = 首个试验田

笔记模块（随 HeyMean 产品线合并落地）将是**第一个真实扩展**，作为扩展宿主 API 的成型范式：

- `descriptor: { id: 'notes', kind: 'extension' }`（面板当前以预留占位展示，合并时 `registerModule` 同 id 覆盖为真实模块）。
- 工具族 `note_search` / `note_read` / `note_write` / `note_pin` 等，存储独立于容器（IndexedDB notes store）。
- 笔记↔容器联动：`note_materialize` 可把笔记落盘到容器工作区，声明 `dependencies: ['run_command']`，容器文件关 → 该工具随依赖关闭。
- 它验证扩展 API 后，MCP / 第三方插件直接复用同一范式。

## 8. 参考

- 契约与守卫：`src/shared/contracts/capability.ts`
- 模块接口 + 内置模块组合：`src/features/agent-core/capability/module.ts`
- 注册表宿主：`src/features/agent-core/capability/registry.ts`
- 启动引导：`src/features/agent-core/capability/manifest.ts`
- 规范 leaf：`.trellis/spec/frontend/agent/capability-library.md`
- 规划：父任务 `capability-library`（`archive/2026-08/`）R6「扩展与核心联动 / 分层落地」
