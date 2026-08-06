# TASK-P5 — pi 上下文压缩对齐（90% 压缩策略）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**。
- 不新增运行时依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

P1-P4 完成：pi 通道单 Agent + 会话持久化 + 工具 + 子 agent 编排。现在对齐 **上下文压缩**——SunamAI 现有引擎有 90% 压缩（`microCompact`/`compact` 策略，上下文接近上限时压缩到 ~10% 保留摘要），pi 有自己的 compaction 系统（`shouldCompact/compact/generateSummary/findCutPoint`）。目标：**pi 通道的压缩策略对齐 SunamAI 语义**（90% 压缩、可恢复执行）。

**pi compaction API（已确认）**：
- `shouldCompact(context, settings)`：是否该压缩（阈值判断）
- `compact(...)` / `prepareCompaction(...)`：执行压缩
- `generateSummary(...)`：生成摘要（可自定义）
- `findCutPoint(context)` / `findTurnStartIndex`：找剪切点
- `DEFAULT_COMPACTION_SETTINGS` / `CompactionSettings`：配置
- `estimateTokens / estimateContextTokens`：token 估算

**SunamAI 现有语义（对齐目标）**：
- 现有引擎的压缩：上下文接近上限 → 触发压缩 → 摘要保留 + 历史裁剪（90% 压缩 = 只留 ~10% 关键上下文）
- 压缩后**可恢复执行**（checkpoint 语义，P2 的 IndexedDB 会话是基础）

## 需求（逐条、可验收）

### R1. pi 压缩策略配置（piSession 改）

- 在 piSession 中配置 pi compaction：
  - **阈值**：对齐现有引擎的触发时机（上下文接近上限时，如 70-85%——以现有 engine.ts 的压缩阈值为准，grep 确认）
  - **摘要策略**：`generateSummary` 自定义或默认——对齐现有压缩的摘要语义（保留什么：任务目标/已完成/待办/关键约束）
  - settings：token 估算方式、压缩目标（90% → 保留 ~10%）
- 确认 pi 的 compaction 在浏览器端工作（纯 JS）

### R2. 压缩后继续对话验证

- 长对话 → 触发压缩 → 后续 prompt 仍能正确继续（摘要上下文 + 新消息）
- **验证压缩真实性**：压缩前后 context token 显著下降（如 >50%），不是假压缩
- mock LLM 或真实（网络允许）长对话测试

### R3. 与现有 90% 压缩语义对齐

- 对比 pi 压缩 vs 现有 engine 压缩的行为差异（触发时机/摘要内容/保留量）**如实标注**——不必完全相同，但语义对齐（压缩后可继续、关键信息保留）
- 若 pi 的压缩策略与现有差异大，给出对齐方案（自定义 generateSummary 等）

### R4. 压缩后恢复（结合 P2 会话持久化）

- 压缩后刷新页面 → 会话从 IndexedDB 恢复 → 压缩后的上下文正确加载（不是全量历史重新灌入）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉
3. 现有引擎的压缩逻辑（现有引擎不动——P5 是 pi 通道的压缩配置）
4. P1-P4 的 pi 实现（在基础上加，不重写）
5. 零新增依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/model-context-and-messages.md`（token 预算、compaction、reasoning delta）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（新增压缩测试）+ `npm run build`（bundle）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：阈值触发、压缩 token 下降、压缩后继续、刷新恢复）
3. `npm run build` → bundle 在限制内
4. **压缩真实性**：压缩前后 context token 显著下降（≥50%）的断言测试
5. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P5 pi 上下文压缩对齐（90% 压缩策略）`
- 一次提交完成；**先读 pi 的 compaction.ts 类型**（node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/）+ 现有 engine.ts 的压缩逻辑（对齐阈值/摘要语义）再动手
- 若 pi 的 compaction 需要浏览器端特判（如 IndexedDB 存储摘要），如实标注并适配
- 压缩目标是"对齐语义"不是"复制实现"——差异如实记录
