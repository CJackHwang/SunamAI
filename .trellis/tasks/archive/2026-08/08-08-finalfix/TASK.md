# TASK-FINALFIX — 终审组2 M/L 级修复（逃生门接线 + 供应商 api 传播 + 皮套提示词生效）

## 背景

终审组2（UX3/R4/BOOTUI）发现 3 个 M 级 + 3 个 L 级缺口（无 H1）。全部修复后进文档整理 + CI 结项。

## 物理边界

- contracts 一字不改、UI 视觉零改动、零新增依赖
- `.trellis/tasks/archive/` 禁止动

## 需求

### M1 — 逃生门语义接线（R4）

`featureFlag.ts` 注释声明"localStorage 关 pi → useAgentV2 不启动 Agent 运行（聊天-only）"，但 `isPiEngineEnabled` 全生产代码 0 处调用（仅测试/e2e 读取）。`useAgentV2.ts:295-302` 只查 containerAvailable 不查 flag；`tests/e2e/configure.ts:20` 的 piEngineOff 设了 localStorage 无行为效果。

**修复**：useAgentV2 启动 run 前检查 `isPiEngineEnabled()`，false 时不启动 Agent 运行（对齐注释语义：聊天-only）。补测试：piEngineOff → run 不启动。

### M2 — 供应商 api 字段 UI 传播（UX3 R4）

预设 `providerPresets.ts:17` 标了 anthropic 的 `api: 'anthropic-messages'`，piSession 也实现了多 API 分发，但 UI 路径无法产生该字段：`ProvidersPanel.tsx:58-64` handleSubmit 不携带 api、`useAppConfig.ts:20-28` AddProviderInput 无 api、`createProviderConfig`（providers.ts:37）默认 openai-completions。→ 用户选 Anthropic 预设创建的供应商仍是 openai-completions，打 `https://api.anthropic.com/v1/chat/completions` 404。

**修复**：预设选择时 `preset.api` 传入 `createProviderConfig` / 表单 state（handlePresetChange 一并写入）。补测试：选 anthropic 预设 → provider.api = 'anthropic-messages'。

### M3 — 内置皮套系统提示词生效（UX3 R5）

内置皮套 `systemPrompt=''`（personas.ts builtinPersonas），personaSystemPrompt 返回空 → useAgentV2 不传 → piSession 用 DEFAULT_SYSTEM_PROMPT。皮套提示词只进 `run.chaos.styleDirective`（useAgentV2.ts:238）但 pi agent 不消费 run.chaos → **切换皮套只换名不换人格**。

**修复**（二选一，选更干净的）：
- 方案 A：useAgentV2 在 personaStyle 为空时把 createChaosContract 解析出的 styleDirective 作为 driver systemPrompt 传入
- 方案 B：personaSystemPrompt 对内置皮套回填全文（personas.ts 内置皮套补 systemPrompt 全文）

**注意**：内置皮套（Sunam 6.9 Pron / Sunam 11.4 Homo）的提示词全文在 `prompt.ts`（现有硬编码），迁移时确保对齐。补测试：切换皮套 → piSession 收到对应 systemPrompt。

### L1 — 陈旧注释（R4）

`piSubagentCoordinator.ts:24/32/53` 注释仍称"现有 AgentFamilyCoordinator（subagentCoordinator.ts）一字不动"——该文件已删。改为历史说明。

### L2 — 旧弹窗孤儿文件（UX3）

`widgets/settings/SettingsModal.tsx` 全仓无导入（grep SettingsModal 仅自身）。**删除**（确认无引用后）。

### L3 — isSunamModel 门卫（UX3）

`models.ts` isSunamModel 对任意非空串返回 true（SunamModel 放宽为 string 别名）。更新为按皮套名集合判断，或直接删守卫（选更简洁的，说明理由）。

## 质量门禁

1. `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增：逃生门/M2 api 传播/M3 皮套提示词测试）
3. `npm run build` + check-bundle 通过
4. `git diff --check` 干净
5. e2e 抽查（ux3-verify 或新增：皮套切换 → 系统提示词变化生效）

## 提交

`fix: 终审组2 修复（逃生门接线 + 供应商 api 传播 + 皮套提示词生效）`
