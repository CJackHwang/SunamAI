# 子任务2：容器三态与启动失败流程 — 技术设计

> 先读子任务1 `design.md`（能力运行时、可用性契约、哨兵 containerId）。相关 spec：`agent/architecture-and-data-flow.md`、`agent/process-lifecycle.md`、`state/ownership-and-workspace-store.md`。

## 1. 状态模型

```
能力上下文暴露：
  containerPreference: boolean          // 持久化，用户偏好（CapabilityConfig.modules['virtual-container'].enabled）
  containerAvailability: CapabilityAvailability   // 会话态：'enabled' | 'restricted'
  effectiveContainerState: 'enabled' | 'disabled' | 'restricted'
      enabled    ← preference=true  && availability=enabled
      disabled   ← preference=false
      restricted ← preference=true  && availability=restricted
```

- `CapabilityAvailability`（`capability.ts`）新增 `'disabled'` 仅为完整枚举，会话可用性只可能是 `enabled | restricted`；`effectiveContainerState` 是给 UI/运行时的最终语义。
- 可用性变化驱动运行时重建：`CapabilityAwareRuntime` 在构造期锁定 `containerAvailable`；availability 由 `restricted→enabled` 时，provider 重建实例并通知订阅者（`useAgentV2` 因 runtime 实例变化而拿到新 runtime）。

## 2. 模块位置

> 对齐子任务1 的模块接口：`ContainerAvailabilityController` 即容器模块的 `availability` 实现（`CapabilityModule.availability`）。宿主在启动时调用 `initialize`，用户重试时调用 `retry`。

### 2.1 `src/features/runtime/containerAvailability.ts`（新）

容器可用性的**会话级协调器**，替代现有 `WorkspaceRuntimeProvider` 内嵌的 boot 逻辑：

```ts
export type ContainerAvailabilityListener = (a: CapabilityAvailability) => void;

export class ContainerAvailabilityController {
  get(): CapabilityAvailability;                      // 'enabled' | 'restricted'
  subscribe(l: ContainerAvailabilityListener): () => void;
  /** 首次进入：尝试 boot。成功后 availability=enabled；失败 restricted，并触发一次失败回调（弹窗）。 */
  async initialize(onFailure?: (error: string) => void): Promise<void>;
  /** 用户重试：重新 getWorkspaceRuntime()。成功 → enabled；失败 → 维持 restricted，不重复弹窗。 */
  async retry(): Promise<boolean>;
}
```

- 复用 `runtimeSingleton` 的 boot 单例：失败后 `bootPromise` 已置空（`webcontainer.ts:36`），`retry()` 再次调用 `getWorkspaceRuntime()` 即重新 boot。
- `initialize` 只弹一次窗：`onFailure` 由 provider 注入（内部去重，`restricted→restricted` 不触发）。
- **不自动重试**。

### 2.2 `WorkspaceRuntimeProvider` 改造

- 状态：`{ availability, runtimeInstance, error }`。
- `initialize()` 成功 → 持有真实 `WebContainerAgentRuntime`，`containerAvailable=true`；失败 → `containerAvailable=false` 的 `CapabilityAwareRuntime`（无容器实例），并调 `onFailure` 弹出告知弹窗。
- `useMemo` 组装 context：`{ runtime, webcontainer(可空), isReady: Boolean(runtime), containerAvailability, effectiveContainerState, retryContainer, getContainerRoot }`。
- **`isReady` 语义改为"聊天可用"**：runtime 非空即 true（受限态也 true）。容器就绪与否由 `effectiveContainerState` 表达。受影响的调用点：
  - `Workspace.handleSubmit` 的 `if (!isTerminalReady || !isRuntimeReady) return`：受限态下 isReady=true，`isTerminalReady` 由 `DualTerminal` onReady 控制——受限态右栏渲染能力库标签页（DualTerminal 常驻），`runtime=null` 时 onReady 不触发，故 Workspace 向 ChatComposer 传 `isTerminalReady={containerAvailable ? isTerminalReady : true}`（受限态视为已就绪，composer 直接可用）。
  - `Workspace.tsx` 现有 `runtimeError` 横幅：仅展示"非受限的运行时错误"。

### 2.3 `runtimeSingleton` 微调

- `getWorkspaceRuntime()` 保持现有语义（boot 成功返回真实实例）。`ContainerAvailabilityController` 负责捕获 reject 并转 restricted，不改变 `runtimeSingleton` 的契约。

## 3. 告知弹窗

### 3.1 组件 `src/shared/ui/ContainerBootNotice.tsx`（新）

- 样式复用：从 `AppUpdateNotice.css` 抽共享 class（`.app-update-overlay`/`.app-update-notice`/`.app-update-actions`）为通用弹窗 class（如 `app-notice-*`），`AppUpdateNotice` 与 `ContainerBootNotice` 共用；**不复制粘贴**（父任务 C7）。
- 结构：标题「容器初始化失败」+ 说明（可能浏览器环境不支持 WebContainer，如缺失跨域隔离）+ 主操作「放弃容器，继续纯聊天」+ 可选次操作「重试」。
- 行为：主操作关闭弹窗（`dismissed=true`），应用进入受限态纯聊天；不落任何持久化（偏好仍为开，面板显示受限）。
- 挂载：`WorkspaceRuntimeProvider` 内部（或 `MainPage` 顶层），仅当首次 boot 失败且未 dismissed 时渲染。
- 测试开关：沿用 `AppUpdateNotice` 的 `?test-update` 模式（如 `?test-container-fail`）便于组件/E2E 验证。

### 3.2 不重复弹窗

- 去重由 `ContainerAvailabilityController.initialize` 的 onFailure 一次性语义保证（仅 restricted 首次触发）；页面生命周期内不再弹。

## 4. 开关重试接线

- 拨动容器开关 → `effectiveContainerState` 变化：
  - 关：`config.modules['virtual-container'].enabled = false`，持久化；**关闭即释放**：flush 快照 → `disposeWorkspaceRuntime()`（teardown WebContainer、清空单例与 `controller.booting`）→ provider 切 `CapabilityAwareRuntime(containerAvailable=false)`。**Agent run 活跃时开关禁用**（见子任务3 U4.3），故关闭只会发生在无运行中任务时。
  - 受限态打开：`config.enabled = true` + `controller.retry()`；成功 → enabled（重建真实 runtime），失败 → 保持 restricted（不弹窗）。
  - 重新开启（非受限）：`getWorkspaceRuntime()` 空单例 → 全新 boot；工作区由 `snapshotCoordinator.ensure` 从 IndexedDB 快照恢复（`restore`，revision 一并恢复），文件不丢。
- `useAgentV2`/`Workspace` 读取 `effectiveContainerState`：
  - `disabled/restricted` → 哨兵 containerId 路径（子任务1 §6.1）、不建容器（§6.2）、隐藏容器 UI（子任务3）。

### 4.1 释放流程（F4.4 实现）

- 新增 `disposeWorkspaceRuntime()`：`flushSnapshots()`（把 pending 快照写回 IndexedDB，防丢失）→ `runtime.dispose()`（停服务/进程/快照 watcher）→ `resetWebContainer()`（`teardown()` 释放 WASM 内存 + 清 `webcontainerInstance/bootPromise`）→ 清 `runtimeInstance/runtimePromise` → 重置 `controller.booting=null`（下次开启可全新 boot）。
- 与 `forceRestartWorkspaceRuntime` 的释放段同构；restart 是「释放 + 立刻重 boot」，关闭是「只释放、不 boot」。

## 5. 文件变更地图

| 动作 | 路径 |
|---|---|
| 新增 | `src/features/runtime/containerAvailability.ts` |
| 新增 | `src/shared/ui/ContainerBootNotice.tsx` + 样式 |
| 修改 | `src/shared/ui/AppUpdateNotice.css` → 抽通用 `app-notice-*` class（AppUpdateNotice 同步改用） |
| 修改 | `src/features/runtime/WorkspaceRuntimeProvider.tsx`（协调器 + 可用性 context + 弹窗挂载 + isReady 语义） |
| 修改 | `src/features/runtime/WorkspaceRuntimeContext.ts`（新增 availability/effectiveContainerState/retryContainer 字段） |
| 修改 | `src/features/runtime/CapabilityAwareRuntime.ts`（子任务1，本任务补 availability 参数接线） |
| 修改 | `src/shared/i18n/locales/*.ts`（弹窗 + 受限态文案） |

## 6. 测试计划

- **单元** `tests/unit/containerAvailability.test.ts`：initialize 成功/失败、onFailure 一次语义、retry 成功/失败转换、subscribe 通知。
- **组件** `tests/component/containerBootNotice.test.tsx`：样式 class 复用、主/次操作、`?test-container-fail` 注入。
- **集成**：模拟 boot reject（mock `runtimeSingleton`），断言 provider 提供受限 CapabilityAwareRuntime、isReady=true、横幅不显示、哨兵 run 持久化。
- **E2E**（子任务3 后）：`?test-container-fail` 下纯聊天全流程 + 重试恢复。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 受限态下 composer 因 `isTerminalReady=false` 被禁用 | 受限态不渲染 DualTerminal，`isTerminalReady` 直接视为 true（子任务3 落实，本任务在 provider 语义上准备） |
| 多次初始化竞态（initialize 与 retry 并发） | `ContainerAvailabilityController` 内部单飞（in-flight promise 复用） |
| 弹窗样式复制粘贴漂移 | 抽共享 `app-notice-*` class，两组件共用 |
| runtime 实例切换导致 run 中引用旧实例 | 切换仅发生在受限↔开启边界；运行中 run 持有的 runtime 引用不变（引擎构造时传入） |
