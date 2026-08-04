# 终端合并灵动岛 — 实施记录

> 先读 `prd.md`、`design.md`。相关 spec：`frontend/react/index.md`、`foundation/architecture-and-boundaries.md`、`quality/test-strategy.md`。

## 完成步骤

### S1 触摸滚动（R1）— ✅
- [x] `TerminalView.tsx`：在 `terminal.open` 后挂 touch 监听；纵向主导 → 向 `.xterm-scrollable-element` 派发合成 WheelEvent + `preventDefault`；`touchend/cancel` 复位；effect 清理。
- [x] `TerminalView.css`：`.xterm-scrollable-element > .scrollbar { touch-action: none; }`。
- 校验：`npm run typecheck && npm run lint` 通过；E2E `vertical touch drag on a terminal is translated into xterm scrolling` 通过。

### S2 表格横向滚动（R2）— ✅
- [x] `MarkdownRenderer.css`：`.markdown-table { width: max-content; min-width: 100%; }`（表格容器 `.markdown-table-wrap` 内部横向滚动，不再挤压列宽）。
- [x] `MarkdownRenderer.test.tsx` 增加 computed-style 断言。
- 校验：组件测试 + E2E `wide markdown tables scroll inside the chat bubble` 通过。

### S3 标签收敛（R3.1）— ✅（后续细化为 ai 单页）
- [x] `shared/contracts/terminal.ts`：新增 `ContainerSegment`（后续含 `files`）。
- [x] `TerminalTabs.tsx`：顶部模块选择器收敛为 **ai（Sunam的电脑）+ capability**；`≤1100px` 时纯 icon（文字省略策略不变，永不省略号）。
- [x] `MobileNavigation.tsx`：底部导航收敛为 **对话 / 电脑 / 能力库**（文件进入灵动岛）。
- [x] 更新 `MobileNavigation.test.tsx`、`capabilityWorkspace.test.tsx`。

### S4 胶囊灵动岛（R3.2–R3.5）— ✅（含细化）
- [x] 新建 `TerminalCapsule.tsx` + `TerminalCapsule.css`：tablist/滑块/点击/方向键/移动端滑动切换。
- [x] **细化**：四个分段 **电脑 / 终端 / 服务 / 文件**（首项用 `terminal.computer` = 「电脑」，不重复顶部「Sunam的电脑」）；i18n 三语新增 `terminal.computer`、`terminal.segmentSwitcher`。
- [x] **视觉**：灰底（`--color-bg` = 聊天背景同款灰）圆角胶囊 + 白色滑块跟随激活分段；高 46px 与聊天输入框对齐；底部间距与输入框一致（桌面 12px / 移动 10px）；胶囊→终端间距 = 输入框→任务列表间距（10px）。
- [x] **自适应**：空间不足时全部段塌缩为纯 icon（绝不省略号）；塌缩/展开宽度伸缩复用 `useLayoutSizeAnimation`（与任务列表同款 spatial `--motion-slow --motion-sheet`）。
- [x] **测量**：滑块位置从激活按钮 `offsetLeft/offsetWidth` 实测；修复「移动端在 display:none 区挂载导致初始测量为 0」问题（统一 `measure` 挂在 ResizeObserver + resize）；修复桌面展开期间 icon 塌缩回环（对照可用宽度而非自身动画宽度，动画期间跳过 fit 判定）。
- [x] 新建 `tests/component/TerminalCapsule.test.tsx`。

### S5 DualTerminal 合并（R3.6–R3.7）— ✅
- [x] `DualTerminal.tsx`：`containerSegment` 状态 + boot 复位；四个分段面板（ai/user/services/files）；boot 覆盖条件；胶囊渲染；swipe 监听（顺序 `ai → user → services → files`）。
- [x] `DualTerminal.css`：`[data-tab="files"/"services"]` 全出血选择器收敛到 ai 页内；`--capsule-h`/`--capsule-bottom`/`--capsule-gap` 空间预留；黑色终端面板（ai/user `.terminal-shell-panel`）左右上边距与胶囊间距一致（`var(--capsule-gap)`，10px）。
- 校验：`npm run typecheck` + `npx vitest run tests/component/` 通过。

### S6 验证与收尾 — ✅
- [x] `npx playwright test tests/visual --update-snapshots` 重生成基线（terminal-capsule-desktop/mobile、workspace-resources-subagents-mobile 因导航 4→3 重生成）并全绿。
- [x] `npm run check` 全绿（typecheck / lint / 架构边界 / 覆盖率 91.04% statements / build / 包体 88.09 KiB gzip initial）。
- [x] E2E `terminal-merge.spec.ts` 3/3 通过（表格横向滚动、终端触摸滚动、胶囊 4 段切换）。
- [x] 轻量更新 `docs/architecture.md`、记录 Trellis journal。

## 遗留/说明
- 顶部模块选择器（右栏）沿用既有 `show-on-narrow`/`hide-on-narrow` 规则：`≤1100px` 纯 icon、有空间显示文字，永不省略号。
- 桌面展开右栏的瞬间，灵动岛会随可用宽度先塌缩为 icon 再展开为文字（自适应伸缩动画，属预期行为）。
