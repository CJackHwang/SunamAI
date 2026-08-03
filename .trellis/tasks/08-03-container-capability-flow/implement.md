# 子任务2：容器三态与启动失败流程 — 实施计划

> 先读父任务 `prd.md`、子任务1 `prd.md`/`design.md`/`implement.md`、子任务2 `design.md`。依赖子任务1 的 `CapabilityAwareRuntime` 与 `CapabilityAvailability`。

## 步骤清单

### S1 可用性协调器
- [ ] 新建 `src/features/runtime/containerAvailability.ts`：`ContainerAvailabilityController`（get/subscribe/initialize/retry，单飞 in-flight）。
- [ ] 单元测试 `tests/unit/containerAvailability.test.ts`。
- **校验**：`npm run typecheck && npx vitest run tests/unit/containerAvailability.test.ts`。

### S2 共享弹窗样式抽取
- [ ] `AppUpdateNotice.css` → 抽通用 `app-notice-*` class（overlay/notice/actions）；`AppUpdateNotice.tsx` 同步改用，行为不变。
- [ ] 组件测试：`AppUpdateNotice` 回归（样式/文案/行为不变）。
- **校验**：`npm run typecheck && npx vitest run tests/component/`。

### S3 告知弹窗组件
- [ ] 新建 `src/shared/ui/ContainerBootNotice.tsx` + 样式（复用 `app-notice-*`）；主操作「放弃容器，继续纯聊天」+ 次操作「重试」。
- [ ] 注入开关 `?test-container-fail`（仿 `?test-update`）。
- [ ] 组件测试 `tests/component/containerBootNotice.test.tsx`。
- **校验**：`npm run typecheck && npx vitest run tests/component/containerBootNotice.test.tsx`。

### S4 Provider 接线
- [ ] `WorkspaceRuntimeContext.ts`：context 增加 `containerAvailability` / `effectiveContainerState` / `retryContainer`。
- [ ] `WorkspaceRuntimeProvider.tsx`：改用 `ContainerAvailabilityController`；失败 → 受限 `CapabilityAwareRuntime`（containerAvailable=false）+ 弹窗一次；`isReady` = runtime 非空。
- [ ] `CapabilityAwareRuntime` 接 availability 参数（子任务1 基础上）。
- [ ] 受限态下 `workspace-runtime-error` 横幅不显示（保留真正运行时错误）。
- [ ] 集成测试：mock boot reject → 受限 runtime + isReady=true + 横幅不显示 + 哨兵 run 持久化。
- **校验**：`npm run typecheck && npm run test`。

### S5 开关重试接线 + 关闭即释放（与子任务3 的开关 UI 协同点）
- [ ] 暴露 `toggleContainer`/`retryContainer` 动作（受限态打开 = 偏好开 + retry；成功重建真实 runtime）。
- [ ] `useAgentV2`/`Workspace` 读取 `effectiveContainerState`（disabled/restricted → 哨兵 + 不建容器路径，子任务1 已备）。
- [ ] 新增 `disposeWorkspaceRuntime()`（design §4.1）：flush 快照 → dispose → resetWebContainer → 清单例 → 重置 `controller.booting`；Provider 关闭分支调用，重开走全新 boot。
- [ ] run 活跃锁：向子任务3 暴露容器开关是否可操作（`agent.activeRun` 非空即锁），运行中禁止关闭/重试。
- [ ] 单元测试 `disposeWorkspaceRuntime`（释放后单例空、重 boot 恢复）+ 关闭前 flush 断言。
- **校验**：`npm run typecheck && npm run test`。

### S6 i18n 与收尾
- [ ] 三语 locale：弹窗标题/说明/操作、`capability.status.*`。
- [ ] 全量 `npm run check`。
- **校验**：`npm run check` 全绿。

## 校验命令清单

```bash
npm run typecheck
npx vitest run tests/unit/containerAvailability.test.ts tests/component/containerBootNotice.test.tsx
npm run test
npm run check
```

## 审查门

- [ ] S2 后：`AppUpdateNotice` 行为零回归（git diff 仅 class 重命名）。
- [ ] S4 后：模拟 boot 失败手测——弹窗出现、放弃后纯聊天可用、无错误横幅。
- [ ] S5 后：受限态重试——成功恢复容器 UI 与工具，失败回落受限不重复弹窗。
- [ ] S5 后：关闭即释放手测——run 活跃时开关禁用；关容器后内存释放、后台进程停止；重开重新 boot、工作区从快照恢复（文件/revision 不丢）。
- 全部通过 → 回父任务，交子任务3 落地能力库面板。

## 回滚点

- S4 若发现 `isReady` 语义改动波及面过大 → 改用新增字段 `chatReady` 而非改 `isReady`，避免扩大改动。
- 任一 S 步骤 `npm run check` 失败且 30 分钟无法修复 → 还原该步骤，记录原因。
