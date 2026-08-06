# TASK-P4 — pi 通道子 agent 编排（多实例并发）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**。
- 不新增运行时依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

P1-P3 完成：pi 通道单 Agent 对话 + 会话持久化 + 18 工具适配。**pi 无原生子 agent API**（已调研确认）——需用**多 Agent 实例 + 编排层**实现子 agent 并发（对齐现有 `AgentFamilyCoordinator` 语义：并发上限、队列、通知、取消）。

**现有语义（对齐目标，不推翻）**：
- `AgentFamilyCoordinator`（subagentCoordinator.ts，294 行）：子 agent 队列、并发上限（三路并发）、`spawn/wait/message/stop/stopAll` 工具、`SubagentNotification`（状态/消息）、父子取消级联
- P3 已把子 agent 三工具在 pi 通道标为"暂不支持"（哨兵 host 拒绝）——**P4 把它变成真实现**

**pi 实现方式**：每个子 agent 一个独立 `Agent` 实例（pi 的 Agent 类）+ 编排器管理（并发池、队列、消息路由）。子 agent 实例共享/继承：模型配置、工具集（部分子集）、会话存储。

## 需求（逐条、可验收）

### R1. pi 子 agent 编排器（新增 `src/features/agent-core/pi/piSubagentCoordinator.ts`）

- 实现 `SubagentHost` 接口（现有 `tools/base.ts` 定义——P3 哨兵 host 的替换实现）：
  - `spawn(task)`：创建 pi Agent 实例（子 agent 用独立 prompt/上下文），加入并发池
  - `wait()`：等子 agent 完成/通知
  - `message(runId, text)`：向子 agent 发消息（pi Agent 的 `prompt()` 续聊）
  - `stop(runId)` / `stopAll()`：取消子 agent（pi Agent 的 `abort()`）
  - 通知：子 agent 事件 → `SubagentNotification`（对齐现有结构）
- **并发上限 3**（对齐现有"三路并发"）：并发池 + 队列，超限排队
- 父子取消级联：根 agent abort → 所有子 agent abort（对齐现有语义）

### R2. 工具接入（piToolAdapter 改）

- P3 的 `PI_UNSUPPORTED_SUBAGENTS` 哨兵 → 换成真编排器 host
- `spawn_subagent/wait_subagents/message_subagent` 走真编排器（execute 调协调器）
- 移除"pi 通道暂不支持子 agent"的降级标注（改为真实能力）

### R3. 子 agent 工具集

- 子 agent 可用工具：继承根的工具集或子集（对齐现有：子 agent 有受限工具集——**以现有 agentFamily/CHILD_TASK_TOOLS 为准**）
- 子 agent 的模型/凭据：继承根配置（pi-ai createProvider 复用）

### R4. 端到端验证（真实或 mock LLM）

- 根 agent 调 `spawn_subagent` → 子 agent 并发执行（2-3 个同时）→ `wait_subagents` 收结果 → 通知路由回根/UI
- 并发上限生效：4 个任务 → 3 并发 + 1 排队
- 取消级联：根 abort → 子全停

### R5. 边界如实记录

- pi 多实例的内存/性能成本（每个 Agent 实例的上下文占用）**如实标注**；若并发 3 有内存压力，记录观察
- 子 agent 消息路由（现有 `message_subagent` 的通道语义）在 pi 模型下的差异如实说明

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉
3. 现有 AgentFamilyCoordinator（现有引擎的子 agent 编排——P4 是 pi 通道的并行实现，不动现有）
4. P1-P3 的 piSession/适配器（在基础上加，不重写）
5. 零新增依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/subagents-and-cancellation.md`（子 agent 角色、预算、并发、通知、取消）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（新增编排器测试）+ `npm run build`（bundle）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：spawn 并发池、上限 3 排队、wait 聚合、message 路由、取消级联、工具集过滤）
3. `npm run build` → bundle 在限制内
4. **端到端**：pi 根 agent 调 spawn_subagent → 子并发执行 → wait 收结果（mock LLM，真实可加）
5. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P4 pi 通道子 agent 编排（多实例并发，上限 3）`
- 一次提交完成；**先读 subagentCoordinator.ts（对齐语义）+ tools/base.ts（SubagentHost 接口）+ piSession.ts（复用 Agent 创建/凭据）再动手**
- 子 agent 工具集对齐现有 CHILD_TASK_TOOLS（grep 确认），不发明新子集
- 并发上限 3 是硬约束（对齐现有），内存压力如实记录不硬撑
