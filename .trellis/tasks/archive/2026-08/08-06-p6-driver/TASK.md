# TASK-P6 — 主 Agent 可替换层（AgentDriver 抽象）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**。
- 不新增运行时依赖（ClaudeCode/Codex 桥是**可选适配器**，不强制装 CLI——通过配置开关启用，未配置时优雅降级）。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

P1-P5 完成：pi 通道完整能力（对话/持久化/工具/子 agent/压缩）。最后一步——**主 Agent 可替换层**：SunamAI 的"壳"（静态网页 + UI）与主 Agent 解耦，未来可把主 Agent 换成 ClaudeCode/Codex 等外部 agent，而不改 UI。

**目标架构**：
```
UI（壳）→ AgentDriver 接口 → 实现：
  ├─ PiDriver（内置，pi 通道，已完成 P1-P5）
  ├─ ClaudeCodeDriver（适配器：调 claude CLI -p 模式）
  └─ CodexDriver（适配器：调 codex CLI）
```

**关键点**：当前默认用 PiDriver（已实现的 pi 通道）。ClaudeCode/Codex 桥是**可选实验**——适配器接口定义好 + 一个示例桥（ClaudeCode 最优先），真实切换验证是后续（外部 CLI 在浏览器环境不可行——**如实标注**：浏览器壳内不能直接 spawn 外部 CLI，桥是给"未来本地/混合部署"用的，接口先行）。

## 需求（逐条、可验收）

### R1. AgentDriver 接口（新增 `src/features/agent-core/driver/types.ts`）

- 定义主 Agent 驱动接口（对齐 piSession 的能力面）：
  - `prompt(text): Promise<...>`（发消息）
  - `abort(): void`
  - 事件（消息流/状态变化）——与 UI 桥接的现有事件模型对齐
  - 生命周期（create/destroy）
  - **接口不绑定 pi 类型**——纯抽象，pi 实现和未来外部 CLI 桥都实现它

### R2. PiDriver（现有 piSession 包一层）

- 现有 piSession 实现 AgentDriver 接口（薄适配，不改 piSession 内部逻辑）
- 这是默认驱动（现有行为不变）

### R3. ClaudeCodeDriver 桥（新增 `src/features/agent-core/driver/claudeCodeDriver.ts`，可选实验）

- 实现 AgentDriver 接口，调 Claude Code CLI（`claude -p` 模式）：
  - **浏览器内不可行**（无法 spawn 外部 CLI）——**如实标注**：此桥面向未来本地/混合部署（Tauri/Electron/本地服务器模式）
  - 接口 + 配置开关（如 `AGENT_DRIVER=claude-code` + CLI 路径配置）+ 未配置时优雅报错（"ClaudeCode driver requires a local environment"）
  - 调用示例实现（prompt → claude -p → 返回文本），**不保证浏览器内可用**（标注限制）
- Codex 桥同构（可留 TODO 或同文件标注——**给建议**：Codex 与 ClaudeCode 桥结构相同，本次先 ClaudeCode 桥 + Codex 桥骨架）

### R4. 驱动切换（useAgentV2 改）

- useAgentV2 按配置选择驱动：默认 PiDriver；配置切换时用对应驱动
- 现有 UI 无感（驱动接口统一事件模型）

### R5. 边界如实记录

- 浏览器壳的限制（外部 CLI 桥浏览器内不可行）**如实写入注释/文档**——接口先行、本地模式后补
- 若驱动切换有不支持的能力（如某驱动不支持子 agent），如实标注降级

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉
3. piSession 内部逻辑（P6 只包不改）
4. 现有引擎（自研引擎仍是可选项——AgentDriver 接口同时涵盖它或标注）
5. 零新增依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/architecture-and-data-flow.md`（owner 选择、跨层数据流）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（新增驱动测试）+ `npm run build`（bundle）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：PiDriver 适配、驱动切换、ClaudeCode 桥未配置优雅报错）
3. `npm run build` → bundle 在限制内
4. **默认行为不变**：默认 PiDriver 时现有 pi 通道功能全通过（回归测试）
5. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P6 主 Agent 可替换层（AgentDriver 抽象 + ClaudeCode 桥）`
- 一次提交完成；**先读 piSession.ts（能力面）+ useAgentV2.ts（接入点）再设计接口**
- ClaudeCode/Codex 桥是"接口先行 + 示例实现"，**不假装浏览器内可用**——限制如实标注
- 接口设计不要过度抽象（对齐现有能力面即可，不为未来过度设计）
