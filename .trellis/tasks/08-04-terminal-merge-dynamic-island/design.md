# 终端合并灵动岛 — 技术设计

> 相关 spec：`frontend/react/index.md`（component-composition、hooks、styling-and-motion、interaction-and-accessibility）、`foundation/architecture-and-boundaries.md`、`quality/test-strategy.md`。

## 1. 现状与根因

### 1.1 移动端终端无法滚动（R1）

xterm v6（`@xterm/xterm@6`）使用自定义 `Scrollable`（`vs/base/browser/ui/scrollbar/scrollableElement.ts`）承载回滚，DOM 为 `.xterm-scrollable-element`（内部无 `overflow-y` 原生滚动容器）。它只监听 `wheel` 事件驱动滚动，不处理 `touchmove`；`body { touch-action: manipulation }` 下拖拽只触发 touch 事件而不触发任何原生滚动，故触屏拖拽无效。

**方案**：在 `TerminalView` 的屏幕元素上挂 touch 监听，纵向主导拖拽时向 `.xterm-scrollable-element` 派发合成 `WheelEvent('wheel', { deltaY, bubbles: true })`，复用 xterm 既有 wheel 滚动路径（像素级 1:1）。合成事件 `deltaY` 为整数，xterm `MouseWheelClassifier` 会将其判为物理滚轮，平滑滚动保持。纵向拖拽 `preventDefault()` 抑制默认行为；横向主导不拦截，冒泡给灵动岛滑动。

滚动条：`.xterm-scrollable-element > .scrollbar` 加 `touch-action: none`，令其滑块在触屏上走指针事件拖拽。

### 1.2 表格挤压（R2）

`.markdown-table { width: 100% }` 强制表格适配容器，多列被压缩。`.markdown-table-wrap` 已有 `overflow-x: auto`。改表格为 `width: max-content; min-width: 100%`：窄表铺满、宽表按内容取宽并在 wrap 内横向滚动。

## 2. 合并视图与灵动岛（R3）

### 2.1 类型

`src/shared/contracts/terminal.ts` 新增：

```ts
export type ContainerSegment = 'ai' | 'user' | 'services';
```

`TerminalTab` 保持原值；`'user'`/`'services'` 降级为合并视图内分段 id。

### 2.2 标签收敛

- `TerminalTabs.tsx`：`containerTabDefinitions` → `[['ai', Monitor, 'terminal.aiComputer'], ['files', Folder, 'terminal.files']]`；能力库常驻。桌面标签 = 电脑/文件/能力库。
- `MobileNavigation.tsx`：`containerTabs` 同步收敛；移动导航 = 对话/电脑/文件/能力库。
- `CollapsedTerminalNav` 复用同一 `tabList()`，自动收敛。

### 2.3 状态

`containerSegment` 作为 `DualTerminal` 内部 `useState<ContainerSegment>('ai')`；`containerStarting` 变真时复位 `'ai'`。不要求 Workspace 感知（顶级标签仍是 `'ai'`，`data-active-tab` 语义不变）。

### 2.4 胶囊灵动岛（新组件）

`src/features/terminal-session/TerminalCapsule.tsx` + `TerminalCapsule.css`：

- 容器：`role="tablist"` + `aria-label={t('terminal.segmentSwitcher')}`，`glass-input` 玻璃胶囊，`position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 30`。
- 滑块：绝对定位 `top/bottom/left: 4px`，`width: calc((100% - 8px) / 3)`，`transform: translateX(calc(var(--segment-index) * 100%))`，`background: var(--color-surface)` + `--elevation-1`，`transition: transform var(--motion-slow) var(--motion-spring)`（reduced-motion 由全局 `motion.css` 截断）。
- 三个 `role="tab"` 按钮：`Monitor`/`Terminal`/`Server` 图标 + 标签，`aria-selected`、`aria-controls`、`id`；`min-height: 36px`，≤900px 时 `44px`（触控目标）。
- 键盘：tablist 上 ArrowLeft/Right/Home/End 切换（interaction-and-accessibility spec）。

### 2.5 DualTerminal 合并

- 顶部标签 `'ai'` 即合并视图；`.terminal-content` 加 `data-capsule={activeTab === 'ai' ? 'true' : undefined}`，并渲染 `<TerminalCapsule />`。
- 面板：ai/user 面板保持常挂载（用户 shell 由 `TerminalView` 挂载态驱动，卸载即杀进程）；services 面板在 `activeTab === 'ai'` 时挂载（跨分段保留瞬时态）。`data-active` = `activeTab === 'ai' && containerSegment === X`。
- boot 覆盖层条件：`!isBooted && activeTab !== 'capability' && !(activeTab === 'ai' && containerSegment === 'services')`。
- 滑动：`.terminal-content` 挂 touch 监听，横向主导（`|dx| > |dy|`）且超过 ~48px 时按索引切换分段（左→+1，右→-1，到端停止），手势后复位直到 `touchend`。

### 2.6 CSS 空间预留

`.terminal-content[data-capsule='true']` 定义 `--capsule-h`（桌面 44px、≤900px 52px），面板 `bottom` 上移：

```css
.terminal-content[data-capsule='true'] .terminal-panel { bottom: calc(16px + var(--capsule-h) + 12px); }
.terminal-content[data-capsule='true'] .terminal-services-panel { bottom: calc(var(--capsule-h) + 12px); }
```

services 面板在 `data-tab="ai"` 内保持 `inset: 0`（全出血），与现「服务」标签外观一致。

## 3. i18n

三语新增 `terminal.segmentSwitcher`（胶囊 aria-label）：zh「Sunam的电脑视图切换」/ en "Sunam's computer view switcher" / ja「Sunamのコンピューター表示切替」。

## 4. 测试

- 组件：`TerminalCapsule.test.tsx`（三段渲染、点击切换、方向键）；`MobileNavigation.test.tsx`（6→4 项）；`capabilityWorkspace.test.tsx`（折叠栏 title 断言改 电脑/文件）；`MarkdownRenderer.test.tsx`（表格 `width:max-content; min-width:100%` + wrap `overflow-x`）。
- 视觉：移动基线重生成（导航 6→4）。
- 门禁：`npm run check`。

## 5. 不改动

- `Workspace.tsx`、`Sidebar`、`CapabilityPanel`、`ServicePreviewOverlay`、`FileManager`、Agent Core、runtime。
