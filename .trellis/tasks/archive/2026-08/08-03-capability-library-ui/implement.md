# 子任务3：能力库 UI（右栏）— 实施计划

> 先读父任务 `prd.md`、子任务1 `design.md`、子任务2 `design.md`、子任务3 `design.md`。依赖子任务1（清单/配置）与子任务2（可用性上下文）。

## 步骤清单

### S1 能力上下文
- [ ] 新建 `src/widgets/capability/CapabilityContext.tsx`：Provider + `useCapabilityContext()`；`config` 本地态 + 持久化；`toggleModule`/`toggleTool`/`retryContainer`；订阅子任务2 可用性。
- [ ] run 活跃锁：`containerSwitchLocked` 字段（由 `agent.activeRun` 非空派生，经 props/context 下发；`interrupted`/`awaiting_user` 不锁）。
- [ ] 挂载：`ConfiguredPage` 在 `WorkspaceRuntimeProvider` 之上包一层。
- [ ] 单元测试：开关变更 → config 持久化 + 上下文通知。
- **校验**：`npm run typecheck && npm run test`。

### S2 面板组件
- [ ] 新建 `CapabilitySwitch`（`role="switch"`，键盘 + aria-checked，样式对齐 `controls.css`）。
- [ ] 新建 `CapabilityPanel.tsx` + `CapabilityPanel.css`：核心四模块 + 笔记扩展占位、展开/折叠（`useIntrinsicDisclosure`）、状态徽标、空态。
- [ ] Agent运行时黄标 + 关闭二次确认。
- [ ] 笔记扩展占位（禁用态、即将上线） + 「其他」空态。
- [ ] 组件测试 `tests/component/capabilityPanel.test.tsx`（核心四模块、展开、子开关、总开关强制、黄标+confirm、笔记扩展占位禁用、其他空态）。
- **校验**：`npm run typecheck && npx vitest run tests/component/capabilityPanel.test.tsx`。

### S3 右栏接入与容器联动
- [ ] `Workspace.tsx` 追加 `.capability-rail`；容器关/受限 → 不渲染 `.terminal-section`、RunBoard 无 `onResume`、`isTerminalReady` 视为 true。
- [ ] `Sidebar.tsx`：容器关/受限 → 隐藏「容器」区块。
- [ ] `Workspace.css` / 布局：chat-section 纯聊天全宽、窄屏图标态。
- [ ] `MobileNavigation.tsx`：移动端抽屉入口。
- [ ] 组件测试 `tests/component/capabilityWorkspace.test.tsx`。
- **校验**：`npm run typecheck && npx vitest run tests/component/capabilityWorkspace.test.tsx`。

### S4 受限态重试交互 + run 活跃锁
- [ ] 容器模块在 `restricted` 显示「启动受限」、不可展开、点击触发 `retryContainer`；成功→enabled 展开，失败→保持 restricted。
- [ ] 依赖联动标记（`capability.dependsOn`）随 `resolveEnabledTools` 补开显示。
- [ ] run 活跃锁（U4.3）：`containerSwitchLocked=true` 时容器总开关禁用灰显 + tooltip「任务结束后可关闭」（受限态点击重试同样禁用）；`interrupted`/`awaiting_user` 不锁。
- [ ] 组件测试：受限态渲染 + 重试调用；run 活跃禁用 / run 结束解除。
- **校验**：`npm run typecheck && npx vitest run tests/component/`。

### S5 i18n 与收尾
- [ ] 三语 locale 补齐 `design.md §4` key + run 锁 tooltip（`capability.switchLockedHint`）。
- [ ] 全量 `npm run check`；E2E 补场景（开面板→关容器→纯聊天→刷新保持→重开恢复）。
- **校验**：`npm run check` 全绿；`npm run test:e2e`。

## 校验命令清单

```bash
npm run typecheck
npx vitest run tests/component/capabilityPanel.test.tsx tests/component/capabilityWorkspace.test.tsx
npm run test
npm run check
npm run test:e2e
```

## 审查门

- [ ] S2 后：面板核心四模块渲染与开关行为符合 `design.md §3` 结构图。
- [ ] S3 后：容器关 → 终端/文件/服务/侧栏容器区块全部隐藏，composer 可用（手测）。
- [ ] S4 后：受限态重试手测（成功/失败两分支）。
- 全部通过 → 回父任务做跨子任务集成审查（父级验收 A1–A7）。

## 回滚点

- S3 若右栏改动波及 `Workspace` 布局过深 → 先以固定右栏 + 不阻塞 chat 布局的最小实现落地上线，后续再打磨动效。
- 任一 S 步骤失败且 30 分钟无法修复 → 还原该步骤，记录原因。
