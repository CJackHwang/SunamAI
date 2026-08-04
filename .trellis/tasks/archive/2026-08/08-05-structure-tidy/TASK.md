# TASK-08-05-structure-tidy：灵动岛合并后的目录/命名整理

## 背景

08-05 完成「终端合并灵动岛」后，代码结构未跟上功能演变，遗留三处「名不副实 / 放错层」问题。**本次是纯结构整理（rename + move + 文档同步），零功能变更、零行为变更、零契约变更。**

已由 Hermes 完成全量引用面扫描，以下引用点即完整影响面，不需要自行扩大搜索（但完成后仍须 grep 自查确认）。

## 需求

### R1 `DualTerminal` → `ComputerView`

`src/widgets/workspace/DualTerminal.tsx`（215 行）实际是合并后的四段「Sunam的电脑」主视图（电脑/终端/服务/文件 + 灵动岛胶囊 + 服务面板 + 懒加载文件管理器），名字已严重过时。

- 文件改名 `src/widgets/workspace/ComputerView.tsx`；组件名 `DualTerminal` → `ComputerView`（含默认导出、接口名 `DualTerminalProps` → `ComputerViewProps`、内部注释里的过时描述）。
- 同名 CSS 一并改名：`DualTerminal.css` → `ComputerView.css`、`DualTerminalLayout.css` → `ComputerViewLayout.css`（仅文件名与 import 路径，CSS 内容零改动）。
- 更新唯一调用方 `src/widgets/workspace/Workspace.tsx` 的 lazy import 与 JSX 使用。
- 更新 `docs/architecture.md` 第 20 行目录职责表：`Workspace 与 DualTerminal 等跨功能组合` → 改为引用 ComputerView。
- 更新活动 spec `.trellis/spec/frontend/react/component-composition.md` 第 16 行中的 `DualTerminal` 字样为 `ComputerView`。

### R2 `TerminalCapsule` → 移入 `widgets/workspace` 并改名 `ContainerCapsule`

`src/features/terminal-session/TerminalCapsule.tsx`（135 行）是四段容器视图（含文件段）的灵动岛切换胶囊，归属 `terminal-session`（终端会话）已不合适——它是跨功能组合 UI，应住进组合层。

- 移动并改名：`src/widgets/workspace/ContainerCapsule.tsx` + `ContainerCapsule.css`（组件名 `TerminalCapsule` → `ContainerCapsule`，CSS 内容零改动）。
- 更新引用方（R1 改名后的 `ComputerView.tsx`）的 import。
- 更新测试：`tests/component/TerminalCapsule.test.tsx` → `tests/component/ContainerCapsule.test.tsx`，import 路径与组件名同步更新，测试断言逻辑零改动。
- `tests/visual/app.visual.spec.ts` 中 `openTerminalCapsuleView` helper 是函数名不是 import 路径，**保留不动**。

### R3 拆分伪 feature `src/features/session/`（仅 2 个模块，且互不相关）

- `src/features/session/ui/WorkspaceResourceList.tsx`（39 行纯列表 UI，唯一消费方是 `src/widgets/sidebar/Sidebar.tsx`）→ 移入 `src/widgets/sidebar/WorkspaceResourceList.tsx`，更新 Sidebar 的 import。组件名与 props 零改动。
- `src/features/session/titleService.ts`（LLM 会话标题生成服务，消费方：`src/widgets/sidebar/useSidebarActions.ts` 与 `src/widgets/workspace/Workspace.tsx`）→ 移入 `src/entities/workspace/titleService.ts`（Session/Container 领域归属 entities/workspace，entities 可依赖 shared/api，符合分层）。函数签名零改动。
- 删除整个 `src/features/session/` 目录。

### R4 文档同步

- `docs/architecture.md`：
  - 第 18 行目录职责表：`src/features/chat`、`file-manager`、`settings`（settings 实际在 `widgets/settings/`）→ 改为 `src/features/chat`、`file-manager`；并在 widgets 行补 `src/widgets/settings`（设置交互，组合 shared/entities）。
  - 第 20 行按 R1 改 ComputerView。
  - 「当前架构基线」一节：日期从 2026-08-03 更新为本次任务完成日期，并同步 08-05 已落地的 UI 事实（四段胶囊「电脑/终端/服务/文件」、顶级标签收敛为 电脑/文件/能力库、文件入岛；`TerminalCapsule`→`ContainerCapsule`、`DualTerminal`→`ComputerView`）。基线数字（88.03 KiB gzip 等）以 `npm run check` 实际输出为准更新，不要照抄旧值。
  - 目录职责表中 `src/features/terminal-session` 的描述如仍提胶囊，同步为「胶囊已移至 widgets/workspace」。
- `docs/extension-development.md` 第 122 行的 `settings` 是 UI 插槽名（CapabilityModule.ui），**与目录无关，不动**。

## 保留项（禁止改动）

- **零行为变更**：组件 props、状态、事件、i18n key、CSS token、视觉快照、契约（`shared/contracts/*`）、持久化 schema 一律不动。改名/移动后的组件输出必须与原来逐字节等价（仅 import 路径与标识符不同）。
- **不改任何测试断言逻辑**：只改 import 路径/组件名引用。
- **不动 `.trellis/tasks/archive/` 下的任何历史任务文档**（归档是历史记录，其中的 DualTerminal 字样保留）。
- **不加新依赖、不引入新工具、不顺手重构**：本任务范围外的一切代码（engine、runtime、capability 引擎等）一律不碰。
- **不重生成视觉基线快照**；如 `npm run check` 因快照路径报错（不应发生），停下来报告而不是自行更新快照。

## 质量门禁

1. `npm run check` 全绿：typecheck（tsc -b）、lint（oxlint）、architecture（scripts/check-architecture.mjs）、coverage（vitest --coverage，门槛见 vitest 配置）、build（vite build）、bundle（scripts/check-bundle.mjs）。
2. 静态自查：`grep -rn "DualTerminal" src tests docs .trellis/spec` 与 `grep -rn "features/session" src tests docs .trellis/spec` 必须零结果；`grep -rn "TerminalCapsule" src tests docs .trellis/spec` 除 `tests/visual/app.visual.spec.ts` 的 `openTerminalCapsuleView` helper 外必须零结果。
3. 报告最终基线数字（初始 JS gzip、总 JS gzip、dist 大小）写入 docs/architecture.md 的「当前架构基线」。

## 约束

- TypeScript strict 全开（`noUncheckedIndexedAccess` 等），新文件保持与旧文件相同的严格性。
- 全英文注释/代码（项目既有约定），禁 emoji。
- 不改变任何导出名的**公共语义**——即本任务只允许重命名 `DualTerminal`/`TerminalCapsule`/session 目录相关标识符，项目里其他一切符号名不动。

## 开始

先读：`docs/architecture.md`（目录职责表 + 变更守则）、`src/widgets/workspace/Workspace.tsx`、`src/widgets/workspace/DualTerminal.tsx`、`src/features/terminal-session/TerminalCapsule.tsx`、`src/widgets/sidebar/Sidebar.tsx`、`tests/component/TerminalCapsule.test.tsx`、`.trellis/spec/frontend/foundation/directory-structure.md`（层定义）。

## 交付清单

- [ ] R1 改名完成，Workspace 编译通过
- [ ] R2 移动+改名完成，测试 import 同步
- [ ] R3 features/session 目录删除，两个模块各归其位
- [ ] R4 文档同步（含基线数字更新）
- [ ] `npm run check` 全绿
- [ ] grep 静态自查零残留（除允许的 helper 名）
- [ ] 总结：改了哪些文件、门禁各步结果、有无意外发现
