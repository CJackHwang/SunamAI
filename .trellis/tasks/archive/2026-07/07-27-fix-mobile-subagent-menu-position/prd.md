# 修复移动端子 Agent 删除菜单位置

## Goal

让子 Agent 的删除操作在桌面和移动端都显示为靠近触发项的普通视口级菜单，不再在移动端变成贴底 sheet，兑现用户明确的交互要求并消除侧栏层级错位感。

## Background

- `SessionHistoryList` 已把子 Agent 菜单 portal 到 `document.body` 并复用共享菜单样式。
- `src/shared/styles/menus.css` 的移动端全局 `.context-menu` 规则会把所有菜单改为 bottom sheet，因此当前 `subagent-menu-mobile` 视觉基线仍显示贴底删除栏。
- 普通 session/container 菜单包含重命名、生成标题、置顶和删除等多项操作；本修复不改变其现有移动端 sheet 行为。

## Requirements

- 子 Agent 的单项删除菜单在 `<=900px` 时必须保留 `position: fixed` 的锚定 popover 形态，并使用触发事件的 viewport 坐标。
- 菜单必须复用现有 `context-menu`、`context-item`、危险操作颜色和 presence 动画，不创建另一套视觉组件。
- 横纵定位必须约束在可视 viewport 内，不得溢出右侧、底部或安全边距。
- 移动端遮罩可以保留，但菜单不得使用 bottom-sheet 的全宽、贴底、顶部圆角或 sheet 进退场动画。
- 桌面行为、删除语义、失败保留记录、普通资源菜单和其他 modal/sheet 行为保持不变。
- 更新组件规范，明确子 Agent 单操作菜单是共享移动端 sheet 规则的有意例外。

## Acceptance Criteria

- [x] 390x844 移动端打开子 Agent 删除菜单时，菜单位于对应操作按钮附近且 `bottom` 明显大于 0，不是全宽贴底栏。
- [x] 桌面与移动端菜单均 portal 到 `body`、只包含删除、完全位于 viewport 内，并保持现有危险操作样式。
- [x] 关闭菜单时使用 popover exit 动画并在动画完成后卸载，reduced-motion 规则继续生效。
- [x] 普通 session/container 多操作菜单的移动端 bottom-sheet 行为不变。
- [x] 更新后的移动视觉基线经人工检查无错位、遮挡或溢出。
- [x] `npm run check:all` 与 `git diff --check` 通过。

## Out Of Scope

- 重设计所有侧栏资源菜单。
- 修改子 Agent 删除的持久化、取消或权限语义。
- 改变移动端侧栏宽度、导航结构或普通底部 sheet 设计。
