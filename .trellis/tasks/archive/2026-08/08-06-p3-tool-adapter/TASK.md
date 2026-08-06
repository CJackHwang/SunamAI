# TASK-P3 — 工具平移：SunamAI 18 工具 → pi AgentTool

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**。
- 不新增运行时依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

P1/P2 完成：pi 框架嵌入（单 Agent 对话 + IndexedDB 会话持久化）。现在把 SunamAI 现有的 **18 个 Agent 工具**（M4 重构后：run_command / manage_process / read_user_terminal / workspace_tree / read_file / search_workspace / 资源 4 / 控制 5 / 子agent 3）**平移为 pi 的 AgentTool**——pi Agent 就能调用它们干活（执行命令、读写文件、资源、子 agent）。

**pi AgentTool 接口（P1 已确认，以实际源码为准）**：
```ts
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;                    // UI 显示名
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (toolCallId: string, params: Static<TParameters>,
            signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>)
           => Promise<AgentToolResult<TDetails>>;   // 失败 throw，不编码错误到 content
  executionMode?: 'sequential' | 'parallel';
}
```
- `Tool<TParameters>`（pi 的基类）应含 name/description/schema（TypeBox TSchema）——**以实际类型为准**
- 注册：`setTools(tools: HarnessTool[], activeNames?)` 或 `agent.tools = [...]`（harness 层）

## 需求（逐条、可验收）

### R1. 工具适配器（新增 `src/features/agent-core/pi/piToolAdapter.ts`）

- 把现有 18 个工具的**执行逻辑**包装成 pi AgentTool：
  - **复用现有工具实现**（processTools.ts 等里的 execute 逻辑），不做重复实现——适配器薄封装
  - schema：现有工具的 zod schema → pi 的 TypeBox TSchema（**转换方式**：手写映射或现成转换器，给建议）
  - execute：调现有工具实现 → 返回 AgentToolResult（content 结构对齐现有工具输出）
  - executionMode：run_command/manage_process 等进程类 = sequential；只读类（read_file/search/workspace_tree）可 parallel——**按工具语义合理设置**
  - label：工具名
- **控制类/子 agent 类**（update_plan/report_progress/ask_user/spawn_subagent 等）依赖现有编排上下文（runId/sessionId）——适配器要能拿到这些（从 piSession 上下文或闭包注入）

### R2. 接入 pi Agent（piSession.ts 改）

- pi Agent 创建时 setTools(18 个适配器工具)
- **验证**：pi Agent 收到工具调用 → 适配器 → 现有实现执行 → 结果回 pi → 继续对话（真实或 mock LLM）

### R3. 工具可见性/开关（对齐 capability）

- 现有 capability 门控（模块开关/受限模式）在 pi 通道同样生效：**只注册启用集**（resolveEnabledTools 的结果 → 注册对应的 pi 工具），不注册禁用的
- 保持与现有 UI 能力库一致（用户开关工具 → pi 通道同步）

### R4. 边界如实记录

- 若某些工具（如 ask_user 交互式）在 pi 执行模型下语义不同（pi 是自治循环，ask_user 需阻塞等待 UI 输入）——**如实标注**，给出降级方案（如返回"需要用户输入，请稍候"或接现有 ask_user 通道）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉
3. 现有工具实现（processTools/workspaceTools/resourceTools/controlTools/subagentTools——**只包不改**）
4. P1/P2 的 piSession 事件桥接（在它基础上加工具注册）
5. 零新增依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/capability-library.md`（工具 gate/能力声明）+ `.trellis/spec/frontend/agent/architecture-and-data-flow.md`
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（新增适配器测试）+ `npm run build`（bundle）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：适配器包装、schema 转换、execute 透传、capability 过滤）
3. `npm run build` → bundle 在限制内
4. **端到端**：pi Agent + 工具 → 让 LLM 调 run_command（echo 测试）→ 结果回对话（mock LLM 或真实，网络允许）
5. capability 门控生效：禁用的模块工具不注册
6. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P3 工具平移（18 工具 → pi AgentTool 适配器）`
- 一次提交完成；**先读 pi 的 Tool/AgentTool 完整类型**（types.d.ts）+ 现有工具定义（tools/ 目录）再动手
- schema 转换（zod → TypeBox）若没有现成转换器：**手写映射 18 个**（每个工具 schema 简单，工作量可控），不引第三方转换库
- 控制类工具若需要编排上下文，从 piSession 注入（不破坏现有引擎的上下文管理）
