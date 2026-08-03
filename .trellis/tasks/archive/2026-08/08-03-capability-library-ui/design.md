# 子任务3：能力库 UI（右栏）— 技术设计

> 先读子任务1 `design.md`（清单/配置/`resolveEnabledTools`）、子任务2 `design.md`（可用性上下文）。相关 spec：`react/index.md`（组件、motion、disclosure、action menu）、`foundation/architecture-and-boundaries.md`、`quality/test-strategy.md`。

## 1. 布局接入

- 现状布局（`Workspace.tsx`）：`chat-section` | `terminal-section`（右侧栏 = 虚拟容器栏目：终端/用户/文件/服务标签页）。
- **能力库 = 右侧栏（虚拟容器栏目）的一个标签页**：`TerminalTab` 增加 `'capability'`，`DualTerminal` 在该标签下渲染 `CapabilityPanel`，与终端/文件/服务同一栏目。
- **右侧栏常驻（类比 VSC 侧边栏，专门放能力/插件）**：容器开关只影响其入口标签与运行本身，不关闭右侧栏与能力库入口。
  - 容器可用 → 标签栏：终端 / 用户 / 文件 / 服务 / 能力库。
  - 容器关闭/受限 → 终端/用户/文件/服务 标签隐藏，仅留「能力库」标签并强制为当前标签；侧栏不消失。
- 移动端（≤900px）：`MobileNavigation` 增加「能力库」导航项；容器不可用时隐藏 ai/user/files/services，只留 对话 + 能力库。
- 折叠态：`CollapsedTerminalNav` 增加能力库图标按钮（点击展开并切到该标签）。
- 开关视觉：thumb 恒为白色，开态轨道用强调色（不用警告色），统一走 `--motion-*` token；「不建议关闭」仅以行内提示徽标呈现。

## 2. 状态与数据流

### 2.1 能力上下文 `src/widgets/capability/CapabilityContext.tsx`（新）

Provider（挂在 `WorkspaceRuntimeProvider` 之上，`ConfiguredPage` 组装）：

```ts
interface CapabilityContextValue {
  modules: ReadonlyArray<{ descriptor: CapabilityModuleDescriptor; tools: RegisteredTool[] }>; // 来自 capabilityRegistry.modules()（活注册表，动态模块自动出现）
  config: CapabilityConfig;
  effectiveContainerState: 'enabled' | 'disabled' | 'restricted';
  toggleModule(id: CapabilityModuleId, enabled: boolean): void;
  toggleTool(name: string, enabled: boolean): void;
  retryContainer(): Promise<boolean>;           // 受限态重试
  resolveEnabled(): ReadonlySet<string>;        // 当前生效工具集（供调试/断言）
  containerSwitchLocked: boolean;               // Agent run 活跃锁（U4.3）：容器总开关禁用
}
```

- `config` 本地 `useState` 初始 `readCapabilityConfig()`，变更即 `saveCapabilityConfig` + 通知 runtime provider 重建注册表/运行时。
- `effectiveContainerState` 来自子任务2 的 `WorkspaceRuntimeContext`。
- 订阅运行时可用性变化：`useWorkspaceRuntime().containerAvailability`。

### 2.2 注册表重建

- 开关变更 → `useAgentV2` 依赖的能力上下文变化 → `launchTask`/`resumeTask` 下次构造用新 `resolveEnabledTools`。**运行中的 run 不中途改注册表**（保持 run 内一致性）；新 run 生效。
- 说明：这是「偏好在下一次任务生效」的语义，需在面板说明文案体现（`capability.nextRunNote`）。

## 3. 面板组件

### 3.1 `src/widgets/capability/CapabilityPanel.tsx` + `CapabilityPanel.css`（新）

```
┌ CapabilityRail ──────────────┐
│ (icon) 能力库                 │
│ ───────────────────────────── │
│ Agent运行时  [不建议关闭][◉]  │
│   展开: update_plan  [◉]     │
│         report_progress[◉]   │
│         complete_task [◉]    │
│         ...                  │
│ 虚拟容器  [◉]                │
│   展开: workspace_tree [◉]   │
│         shell_run      [◉]   │
│         ...                  │
│ 资源附件  [◉]                │
│   展开: read_resource_text[◉]│
│ 笔记管理  (预留)  [—]         │
│ 其他      (空)               │
└──────────────────────────────┘
```

- 行组件 `CapabilityRow`（标题 + 描述 + 异常备注 + chevron + switch）。**无行首 icon**（产品决策：icon 占空间且与终端标签重复，已移除）。
- 折叠：`<details>` + `useIntrinsicDisclosure`（现有 `src/shared/ui/useIntrinsicDisclosure.ts`）保持一致动效。
- Apple 风 switch：自定义 `CapabilitySwitch`（`role="switch"` + aria-checked；thumb 恒白色，开态仅轨道变色；`--motion-fast`/`--motion-snappy` 统一动效）。
- 异常备注（产品决策：**正常态不显示状态徽标**）：仅「启动受限」以备注 pill（黄）显示在标题下方（`capability.status.restricted`）；`capability.status.enabled/disabled` key 保留备用，面板不渲染。

### 3.2 各模块行为

- **Agent运行时**：模块行显示「不建议关闭」黄标（`capability.warnOnDisable`）；任一工具或模块关闭 → `confirm`（`capability.toggle.confirm`，含工具名插值）。
- **虚拟容器**：行 switch 绑定 `effectiveContainerState`：
  - `restricted`：switch 显示「启动受限」黄态、不可展开工具、点击行/switch 触发 `retryContainer`（成功→enabled、失败→保持 restricted）。
  - `disabled`/`enabled`：正常 switch + 可展开。
  - **run 活跃锁定（U4.3）**：`containerSwitchLocked`（由 `agent.activeRun` 非空派生，经 CapabilityContext 下发）时，容器总开关 `disabled` 灰显 + tooltip「任务结束后可关闭」，受限态点击重试同样禁用；`interrupted`/`awaiting_user` 不锁定。
  - 展开区内依赖工具（`process_*` 等）依赖 `shell_run`：`resolveEnabledTools` 自动补开依赖 → UI 中依赖工具开关显示联动（视觉标记「随 shell_run」）。
- **资源附件**：普通模块。
- **笔记管理**：`reserved`，switch 禁用（`disabled` + 文案「即将随产品线合并上线」）。
- **其他**：当前空，显示空态。

### 3.3 容器关 → UI 联动（`Workspace.tsx` / `Sidebar.tsx`）

- `effectiveContainerState === 'disabled' || 'restricted'` 时：
  - `Workspace`：不渲染 `.terminal-section`（DualTerminal）与 `ServicePreviewOverlay`；`RunBoard` 不传 `onResume`；`isTerminalReady` 视为 true（composer 可用）。
  - `Sidebar`：不渲染「容器」区块（`sidebar.containers`）；`新建任务` 不调 `createContainer`（子任务1 §6.2 已备）。
  - 纯聊天时 `.workspace-container` 仅 chat-section 全宽。

## 4. i18n（三语）

```
'capability.title' / 'capability.nextRunNote'（新 run 生效提示）
'capability.module.*'（核心四模块 + 笔记扩展占位 label/description）
'capability.warnOnDisable' / 'capability.status.*'
'capability.toggle.confirm' / 'capability.dependsOn'（依赖联动标记）
'capability.notes.placeholder'（预留文案）
'capability.empty.other'（其他空态）
```

## 5. 文件变更地图

| 动作 | 路径 |
|---|---|
| 新增 | `src/widgets/capability/CapabilityContext.tsx` |
| 新增 | `src/widgets/capability/CapabilityPanel.tsx` + `CapabilityPanel.css` |
| 新增 | `src/widgets/capability/CapabilitySwitch.tsx`（或并入面板） |
| 修改 | `src/widgets/workspace/Workspace.tsx`（右栏挂载、容器关隐藏 terminal/section、isTerminalReady） |
| 修改 | `src/widgets/workspace/Workspace.css`（布局追加右栏） |
| 修改 | `src/widgets/sidebar/Sidebar.tsx`（容器区块隐藏） |
| 修改 | `src/pages/ConfiguredPage.tsx` / `MainPage.tsx`（挂 CapabilityContext） |
| 修改 | `src/features/chat/ui/MobileNavigation.tsx`（移动端入口） |
| 修改 | `src/shared/i18n/locales/*.ts`（三语 key） |

## 6. 测试计划

- **组件** `tests/component/capabilityPanel.test.tsx`：核心四模块渲染、展开/折叠、子开关、总开关强制关、受限态（mock context）不展开 + 重试触发、Agent运行时黄标 + confirm、笔记扩展占位禁用、其他空态。
- **组件** `tests/component/capabilityWorkspace.test.tsx`：容器关时 Workspace 不渲染 terminal、Sidebar 无容器区块、composer 可用。
- **单元**：CapabilityContext 开关变更 → config 持久化 + 上下文更新（可并入 `capabilityConfig` 测试）。
- **E2E**：开面板 → 关容器 → 纯聊天全流程 → 刷新状态保持 → 重开容器恢复。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| switch 无现成组件、无障碍不足 | 新增 `role="switch"` 自绘，配套键盘操作与 `aria-checked` |
| 右栏挤占窄屏空间 | 桌面窄屏（900–1100px）收为图标态；移动端抽屉 |
| 运行中 run 与开关变更的语义混淆 | 面板标注「下一次任务生效」（`nextRunNote`），运行中 run 不受影响 |
| 受限态展开禁用与「可重试」的交互冲突 | 行点击即重试，展开被禁用并注明「容器不可用」 |
