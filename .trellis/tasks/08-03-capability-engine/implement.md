# 子任务1：能力引擎 — 实施计划

> 先读父任务 `prd.md`、子任务1 `prd.md`、`design.md`。实施顺序即依赖顺序；每步完成后跑对应校验。

## 步骤清单

### S1 能力模型类型（shared 契约）
- [ ] 新建 `src/shared/contracts/capability.ts`：模块 id、可用性、工具声明、模块描述、配置、守卫、`CHAT_ONLY_CONTAINER_ID`、`DEFAULT_CAPABILITY_CONFIG`。
- [ ] `src/shared/lib/storage.ts` 增加 `STORAGE_KEYS.capabilityConfig`。
- **校验**：`npm run typecheck`。

### S2 配置持久化
- [ ] 新建 `src/shared/lib/capabilityConfig.ts`：`readCapabilityConfig`/`saveCapabilityConfig`，差分 override、未知键丢弃、守卫合并。
- [ ] 单元测试 `tests/unit/capabilityConfig.test.ts`。
- **校验**：`npx vitest run tests/unit/capabilityConfig.test.ts`。

### S3 工具注入式能力声明
- [ ] `tools/base.ts`：`ToolDefinition`/`RegisteredTool`/`defineTool` 增加必填 `capability`。
- [ ] 五个工具文件全部 `defineTool` 补齐 `capability`（分类照 `design.md §2.3`）。
- [ ] 验证缺声明编译失败：用一个临时缺 `capability` 的工具示例跑 `tsc` 确认报错后删除示例。
- **校验**：`npm run typecheck`（全量通过 = 所有工具已带声明）。

### S4 模块接口 + 活注册表 + 静态引导
- [ ] 新建 `src/features/agent-core/capability/module.ts`：`CapabilityModule` 接口（descriptor 含 `kind` + `tools()` + `availability?` + `promptSections?` + `ui?` 字段声明）；内置模块组合（四 core：agent-runtime / virtual-container / resources / other + notes 扩展占位 reserved）。
- [ ] 新建 `src/features/agent-core/capability/registry.ts`：`CapabilityRegistry` 宿主单例（`registerModule` 校验每个工具 capability.module 匹配、`unregisterModule`、`modules()`/`toolsOf()`/`getTool()`/`resolveEnabledTools()`/`subscribe`；core 不可卸载）。
- [ ] 新建 `src/features/agent-core/capability/manifest.ts`：`bootstrapCapabilityRegistry()` 注册内置模块；应用启动早期调用一次（幂等）。
- [ ] `engine.ts`：注册表构造改走 `resolveEnabledTools(config)`（保留 root `hiddenTools: ['ask_parent']`）。
- [ ] 单元测试 `capabilityRegistry.test.ts`：静态引导覆盖、模块匹配校验、扩展注册/卸载、core 不可卸载、闭合、restricted、模块开关强制。
- **校验**：`npm run typecheck && npx vitest run tests/unit/capabilityRegistry.test.ts`；回归快照：默认配置下 `getApiDefinitions()` 与改造前一致。

### S5 能力运行时
- [ ] 新建 `src/features/runtime/CapabilityAwareRuntime.ts`（方法语义矩阵见 `design.md §5.1`；资源三方法直接走 repository）。
- [ ] `runtimeSingleton.ts`：增加受限态组装接口（`containerRuntime: null` 时可建 CapabilityAwareRuntime）。
- [ ] 单元测试 `capabilityRuntime.test.ts`：两种可用性方法行为矩阵。
- **校验**：`npm run typecheck && npx vitest run tests/unit/capabilityRuntime.test.ts`。

### S6 引擎接线
- [ ] `useAgentV2.ts`：新增能力上下文入参；`launchTask` 哨兵 containerId 解析（见 `design.md §6.1`）。
- [ ] `Workspace.tsx` `handleSubmit`：容器关时不 `createContainer()`（见 §6.2）。
- [ ] `prompt.ts`：`buildAgentSystemPrompt` 能力感知段落（见 §6.3）。
- [ ] `agentFamily.ts`：子角色 toolPolicy 与能力配置交集（verify 无 shell）。
- [ ] `completion.ts`：无容器分支验证（预期无需逻辑改动，加测试断言不可达）。
- [ ] 组件测试：`Workspace.handleSubmit` 不建容器。
- **校验**：`npm run typecheck && npm run test`。

### S7 CI 审计
- [ ] `scripts/check-architecture.mjs`：工具注册**粗筛**（`defineTool` 数 vs `capability:` 声明数，缺声明即失败）。
- [ ] 精确校验（模块 id 合法 / 唯一名 / 依赖闭合 / 「其他」阈值 ≤ 1）由 `tests/unit/capabilityRegistry.test.ts` 承担（`test:coverage` 兜住），脚本不做重复实现。
- [ ] 验证 `npm run check:architecture`；构造缺声明样本确认失败后还原。
- **校验**：`npm run check:architecture` + `npx vitest run tests/unit/capabilityRegistry.test.ts`。

### S8 i18n 与收尾
- [ ] 三语 locale 增补 `design.md §7` key。
- [ ] 全量 `npm run check`（typecheck + lint + architecture + coverage + build + bundle）。
- **校验**：`npm run check` 全绿。

## 校验命令清单

```bash
npm run typecheck
npx vitest run tests/unit/capabilityConfig.test.ts tests/unit/capabilityRegistry.test.ts tests/unit/capabilityRuntime.test.ts tests/unit/capabilityCompletion.test.ts
npm run test
npm run check:architecture
npm run check
```

## 审查门

- [ ] S3 后：`git diff` 工具文件仅新增 capability 字段，无行为改动。
- [ ] S4 后：默认配置工具清单与改造前等价（快照/断言）。
- [ ] S6 后：纯聊天端到端手测（临时将容器可用性置 false）——对话、附件、持久化、刷新续跑。
- [ ] S7 后：CI 审计通过。
- 全部通过 → 回父任务，等子任务2 落地容器三态后再集成验证。

## 回滚点

- S5/S6 期间若发现 schema 或持久化必须变更 → **停止**，回父任务重评 C3，不改 schema。
- 任一 S 步骤 `npm run check` 失败且 30 分钟内无法修复 → 还原该步骤文件，记录原因，回退重做。
