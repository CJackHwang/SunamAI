# TASK-P1 — pi 框架嵌入：单 Agent 对话跑通（事件流 → 现有 UI）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**（AgentWorkspaceRuntime 唯一边界）。
- **前端 UI 视觉零改动**：现有聊天 UI（消息列表/输入框/面板）不动——pi 的消息通过**事件适配层**喂给现有 UI 状态，不改 UI 组件。
- 不新增运行时依赖（**pi 是新增依赖，但必须纯 JS 浏览器可跑**——装 `@earendil-works/pi-agent-core@0.84.0` + `@earendil-works/pi-ai@0.84.0`，确认无 node 内置依赖，bundle 限制 350KiB 内）。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M 系列完成：SunamAI 执行引擎已切 Succinix。现在开始 **pi 重构线**——用 pi 框架（earendil-works/pi，纯 TS 浏览器可跑）**重新实现 SunamAI 当前编排**，目标：主 Agent 可灵活替换（未来 ClaudeCode/Codex）、静态网页变"壳"。

**调研结论（已确认，不要推翻）**：
- pi-agent-core 依赖纯 JS（diff/yaml/ignore/typebox/pi-ai/pi-telemetry），**无 node 内置模块**，浏览器直接跑 ✅
- 核心 API：`Agent` 类（`prompt(text)` / `continue()` / `abort()` / `waitForIdle()`）、事件流（`agent_start/turn_start/message_*/tool_execution_*/turn_end/agent_end`）
- pi-ai：`createModels() / setProvider(anthropicProvider()) / getModel(...)`，支持 OAuth token 刷新
- SunamAI↔pi 映射：消息事件 ↔ 现有 UI 状态桥接（本任务核心）；三路并发/压缩/checkpoint 后续任务

**本任务（P1）**：pi 嵌入 React 壳，单 Agent 对话跑通——用户发消息 → pi Agent → 消息事件流 → 现有 UI 显示回复。**不动现有 agent 引擎**（自研引擎保留运行，P1 是并行的 pi 通道，后续 P3-P6 逐步切换）。

## 需求（逐条、可验收）

### R1. 依赖安装（纯 JS 验证）

- 安装 `@earendil-works/pi-agent-core@0.84.0` + `@earendil-works/pi-ai@0.84.0`
- **验证纯 JS**：`grep -rn "node:" node_modules/@earendil-works/pi-agent-core/dist/ | head` → 无 node: 内置模块引用（除允许的 node:process 类型声明）
- bundle 预算确认：`npm run build` 后 bundle 增量在 350KiB 限制内（pi 是纯 JS 小包，预期 +50-100KiB）

### R2. pi 会话服务（新增 `src/features/agent-core/pi/piSession.ts`）

- 封装 pi Agent 实例生命周期：创建（含 provider 配置）、`prompt()`、`abort()`、销毁
- 模型配置：用现有 modelClient 的提供商配置（或 pi-ai 的 anthropicProvider + 现有 API key 来源——**复用现有凭据获取逻辑，不硬编码 key**）
- 事件订阅：暴露 pi 事件流给 UI 层（`onEvent` 回调或订阅器）

### R3. 消息桥接（pi ↔ 现有 UI，核心）

- pi 的消息事件（`message_start / message_delta / message_stop` 或 `assistant_message` 等——**以实际 0.84.0 的事件名为准，先读 pi 源码/类型确认**）→ 转换为现有 UI 的消息模型（ChatMessage 结构）
- 现有聊天 UI 能显示 pi Agent 的流式回复（打字机效果：delta 累积）
- 用户输入 → `agent.prompt(text)`（现有输入框的提交逻辑接 pi 通道）
- **UI 不改**：通过现有状态层（context/store）注入 pi 消息，不新增 UI 组件

### R4. 切换开关（并行不冲突）

- pi 通道与现有引擎**并行存在**：加一个配置开关（如 `FEATURE_PI_ENGINE` 或现有 feature flag 机制）——开=走 pi 通道，关=走现有引擎
- 开关默认关（现有引擎保持默认，pi 通道待验证后切换）

### R5. 模型桥接验证

- 真实对话测试：开开关 → 发消息 → pi Agent 回复显示在 UI（用现有 API key）
- 若 pi-ai 的 provider 配置与现有凭据不兼容，**如实标注**并给出适配方案（不硬编码 key、不假装成功）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. 现有 agent 引擎（engine.ts/agentFamily.ts 等——P1 不动，P3-P6 再切换）
3. UI 视觉
4. `.trellis/tasks/archive/`
5. 零新增运行时依赖（除 pi 两个包）

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/model-context-and-messages.md`（模型/消息/压缩）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（pi 相关新增测试）+ `npm run build`（bundle 预算）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（含新增 piSession 测试：事件订阅、消息转换、abort）
3. `npm run build` → bundle 增量在限制内（总 JS ≤350KiB gzip）
4. **纯 JS 验证**：pi 依赖无 node: 内置模块
5. 浏览器冒烟（可选，网络允许时）：开开关发消息 → pi 回复流式显示（真实 API key）
6. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P1 pi 框架嵌入（单 Agent 对话 + 事件流桥接现有 UI）`
- 一次提交完成；**先读 pi 源码确认实际 API/事件名**（node_modules/@earendil-works/pi-agent-core/dist/ 的 .d.ts），不要凭调研假设
- 若 pi 0.84.0 的事件模型与调研不符，**以实际源码为准**并如实报告差异
- bundle 预算超限时：先评估 pi 是否可懒加载（动态 import），再考虑其他优化，**不牺牲功能**
