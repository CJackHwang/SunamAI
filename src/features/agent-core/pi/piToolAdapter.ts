import { Type } from '@earendil-works/pi-ai';
import type { TSchema } from '@earendil-works/pi-ai';
import type { AgentTool as PiAgentTool, AgentToolResult as PiAgentToolResult } from '@earendil-works/pi-agent-core';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { RegisteredTool, SubagentHost, ToolExecutionContext } from '../tools/base';
import { controlTools } from '../tools/controlTools';
import { processTools } from '../tools/processTools';
import { resourceTools } from '../tools/resourceTools';
import { subagentTools } from '../tools/subagentTools';
import { workspaceTools } from '../tools/workspaceTools';
import type { AgentToolResult as AppAgentToolResult } from '../types';

/**
 * P3 工具平移：把现有 18 个 Agent 工具薄封装为 pi 的 AgentTool。
 *
 * 设计边界（严格遵守现有物理边界）：
 * - 现有工具实现（processTools/workspaceTools/resourceTools/controlTools/subagentTools）**只包不改**；
 * - 现有编排上下文（runId/sessionId/runtime/task 等）通过 `getContext` 闭包从调用方（piSession）注入，
 *   不破坏现有引擎的上下文管理；
 * - schema 转换采用**手写 zod → TypeBox 映射**，不引入第三方转换库；
 * - 失败以 throw 呈现（pi 执行模型约定），不在 content 中编码错误。
 *
 * R4 边界如实记录：
 * - pi 是自治循环，`ask_user`/`ask_parent` 的阻塞语义（awaiting_user/awaiting_parent）在 pi 通道
 *   无法暂停等待 UI 输入：适配器把问题作为工具结果原样回传模型，由模型在后续回复中向用户提问，
 *   不设 `terminate`（设了会导致批次静默停止且问题不可见）。`ask_parent` 在根 Agent 下本就不合法，
 *   直接以失败 throw。
 * - `complete_task` 的 `stopRun: 'completed'` 同样不映射为 pi `terminate`：自治循环中模型应把完成
 *   摘要作为最终回复，而非在工具批次后静默停住。
 * - `read_resource_image` 的 `modelContent`（image_resource 持久引用）在 pi 工具结果协议中无对应
 *   内容类型，只保留文本描述；图像回传依赖 pi 自身的内容通道，属后续工作。
 * - P4（R2）：根 agent 的子 agent 工具走真编排器（PiSubagentCoordinator），见
 *   piSubagentCoordinator.ts；本文件不再注入「pi 通道暂不支持子 agent」的降级标注。
 *   子 agent 会话注入的哨兵 host（PI_CHILD_NO_DELEGATION）只用于「子 agent 不能继续委派」，
 *   对齐现有引擎「children cannot delegate」语义。
 */
export const PI_TOOL_CATALOG: RegisteredTool[] = [
  ...workspaceTools,
  ...processTools,
  ...resourceTools,
  ...subagentTools,
  ...controlTools,
];

/** R3：按 capability 启用集过滤工具；缺省（undefined）时返回全部 18 个。 */
export function resolveEnabledPiTools(enabledTools: ReadonlySet<string> | undefined): RegisteredTool[] {
  if (!enabledTools) return PI_TOOL_CATALOG;
  return PI_TOOL_CATALOG.filter((tool) => enabledTools.has(tool.name));
}

/** 每个工具的 TypeBox 参数 schema（zod schema 的手写映射；字段名与 zod 完全一致）。 */
const PI_TOOL_SCHEMAS: Record<string, TSchema> = {
  // ---- processTools ----
  run_command: Type.Object({
    command: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal('foreground'), Type.Literal('background')]),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 300_000 })),
  }, { additionalProperties: true }),
  manage_process: Type.Object({
    action: Type.Union([Type.Literal('list'), Type.Literal('observe'), Type.Literal('stop'), Type.Literal('input')]),
    process_id: Type.Optional(Type.String({ minLength: 1 })),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    input: Type.Optional(Type.String()),
  }, { additionalProperties: true }),
  read_user_terminal: Type.Object({}, { additionalProperties: true }),
  // ---- workspaceTools ----
  workspace_tree: Type.Object({
    max_depth: Type.Integer({ minimum: 1, maximum: 8 }),
  }, { additionalProperties: true }),
  read_file: Type.Object({
    path: Type.String({ minLength: 1 }),
    start_line: Type.Optional(Type.Integer({ minimum: 1 })),
    end_line: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  }, { additionalProperties: true }),
  search_workspace: Type.Object({
    query: Type.String({ minLength: 1 }),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
  }, { additionalProperties: true }),
  // ---- resourceTools ----
  list_resources: Type.Object({}, { additionalProperties: true }),
  read_resource_text: Type.Object({
    resource_id: Type.String({ minLength: 1 }),
    start_line: Type.Optional(Type.Integer({ minimum: 1 })),
    end_line: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    max_tokens: Type.Optional(Type.Integer({ minimum: 64, maximum: 16_000 })),
  }, { additionalProperties: true }),
  read_resource_image: Type.Object({
    resource_id: Type.String({ minLength: 1 }),
  }, { additionalProperties: true }),
  materialize_resource: Type.Object({
    resource_id: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
  }, { additionalProperties: true }),
  // ---- controlTools ----
  update_plan: Type.Object({
    items: Type.Array(Type.Object({
      id: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1 }),
      status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('blocked')]),
    }, { additionalProperties: true }), { minItems: 1, maxItems: 8 }),
  }, { additionalProperties: true }),
  report_progress: Type.Object({
    message: Type.String({ minLength: 1, maxLength: 800 }),
  }, { additionalProperties: true }),
  ask_user: Type.Object({
    question: Type.String({ minLength: 1, maxLength: 1000 }),
  }, { additionalProperties: true }),
  ask_parent: Type.Object({
    question: Type.String({ minLength: 1, maxLength: 1000 }),
  }, { additionalProperties: true }),
  complete_task: Type.Object({
    summary: Type.String({ minLength: 1, maxLength: 2000 }),
    evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 12 }),
  }, { additionalProperties: true }),
  // ---- subagentTools ----
  // spawn_subagent 的 zod schema 是 .strict()：额外字段会被现有实现拒绝，TypeBox 同样收紧。
  spawn_subagent: Type.Object({
    task_id: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('explore'), Type.Literal('task')]),
    prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    write_scope: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
  }, { additionalProperties: false }),
  wait_subagents: Type.Object({
    run_ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 6 }),
  }, { additionalProperties: true }),
  message_subagent: Type.Object({
    run_id: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1, maxLength: 2000 }),
  }, { additionalProperties: true }),
};

/**
 * 当 pi 通道未接入 AgentWorkspaceRuntime 时使用的边界哨兵：任何方法都如实报不可用。
 * 生产路径（useAgentV2）始终传入 CapabilityAwareRuntime，此哨兵只兜底直接构造 PiSession 的场景。
 */
const unavail = (method: string): never => {
  throw new Error(`Runtime method ${method} is unavailable: no AgentWorkspaceRuntime is wired to the pi channel.`);
};

export const UNWIRED_PI_RUNTIME: AgentWorkspaceRuntime = {
  ensureContainer: async () => unavail('ensureContainer'),
  getWorkspaceRevision: async () => unavail('getWorkspaceRevision'),
  flushWorkspace: async () => unavail('flushWorkspace'),
  flushSnapshots: async () => unavail('flushSnapshots'),
  listResources: async () => unavail('listResources'),
  readResourceText: async () => unavail('readResourceText'),
  readResourceImage: async () => unavail('readResourceImage'),
  materializeResource: async () => unavail('materializeResource'),
  listWorkspace: async () => unavail('listWorkspace'),
  readWorkspaceFile: async () => unavail('readWorkspaceFile'),
  searchWorkspace: async () => unavail('searchWorkspace'),
  applyWorkspaceChanges: async () => unavail('applyWorkspaceChanges'),
  runShell: async () => unavail('runShell'),
  observeProcess: () => unavail('observeProcess'),
  sendProcessInput: async () => unavail('sendProcessInput'),
  stopProcess: async () => unavail('stopProcess'),
  stopRun: () => unavail('stopRun'),
  getProcesses: () => unavail('getProcesses'),
  subscribe: () => unavail('subscribe'),
  getUserTerminalBuffer: () => unavail('getUserTerminalBuffer'),
  appendUserTerminalBuffer: () => unavail('appendUserTerminalBuffer'),
};

/**
 * 子 agent host 哨兵（P4，仅限子 agent）：pi 子 agent 不能再委派（对齐现有引擎
 * 「children cannot delegate」）。根 agent 的工具上下文注入的是真编排器
 * （PiSubagentCoordinator，见 piSession.buildToolContext）；此哨兵只注入到子 agent
 * 会话，使任何意外暴露的委派调用如实拒绝。
 * snapshot 返回空列表（子 agent 不存在活跃孙代）。
 */
const subagentUnavailable = (tool: string): never => {
  throw new Error(`Tool ${tool} is unavailable: subagent delegation is allowed only from the root agent, not from a child agent.`);
};

export const PI_CHILD_NO_DELEGATION: SubagentHost = {
  spawn: () => subagentUnavailable('spawn_subagent'),
  wait: () => subagentUnavailable('wait_subagents'),
  message: () => subagentUnavailable('message_subagent'),
  stop: () => subagentUnavailable('stop'),
  stopAll: () => subagentUnavailable('stopAll'),
  snapshot: () => [],
};

/** 现有工具结果 → pi AgentToolResult。失败（ok:false）在 execute 中已以 throw 呈现。 */
function toPiToolResult(result: AppAgentToolResult): PiAgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: result.content }],
    details: result.data,
  };
}

export interface PiToolAdapterOptions {
  /** 需要封装的现有工具（R3 已按启用集过滤）。 */
  tools: RegisteredTool[];
  /** 每次执行时提供现有编排上下文（runId/sessionId/runtime/task 等）。 */
  getContext: () => ToolExecutionContext;
}

/** 把现有工具数组封装为 pi AgentTool 数组。 */
export function createPiAgentTools(options: PiToolAdapterOptions): PiAgentTool[] {
  return options.tools.map((tool) => createPiToolAdapter(tool, options.getContext));
}

/** 封装单个现有工具为 pi AgentTool（薄封装：复用现有 execute 实现，不重复实现）。 */
export function createPiToolAdapter(tool: RegisteredTool, getContext: () => ToolExecutionContext): PiAgentTool {
  const parameters = PI_TOOL_SCHEMAS[tool.name] ?? Type.Any();
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    label: tool.name,
    // 进程类/变更类（concurrencySafe: false）串行，只读类（concurrencySafe: true）可并行。
    executionMode: tool.concurrencySafe ? 'parallel' : 'sequential',
    async execute(_toolCallId, params, signal) {
      // 复用现有 zod schema 做输入校验（含 superRefine 跨字段规则），再透传现有实现。
      const parsed = tool.schema.safeParse(params);
      if (!parsed.success) {
        throw new Error(`Tool ${tool.name} input validation failed: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      }
      const context = getContext();
      const result = await tool.execute(parsed.data, { ...context, signal: signal ?? context.signal });
      // pi 执行模型：失败 throw，不编码错误到 content。
      if (!result.ok) throw new Error(result.content);
      return toPiToolResult(result);
    },
  };
}
