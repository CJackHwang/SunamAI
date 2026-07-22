import { z } from 'zod';
import type { ToolCall } from '@/entities/message/types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { AgentPlanItem, AgentToolCall, AgentToolResult, TaskContract } from './types';

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  containerId: string;
  runtime: AgentWorkspaceRuntime;
  signal: AbortSignal;
  getTask: () => TaskContract;
  updateTask: (updater: (current: TaskContract) => TaskContract) => void;
}

interface ToolDefinition<TSchema extends z.ZodType> {
  name: string;
  description: string;
  schema: TSchema;
  readOnly: boolean;
  concurrencySafe: boolean;
  dataImpact: 'none' | 'workspace' | 'process' | 'task' | 'run';
  timeoutMs: number;
  resultType: 'text' | 'tree' | 'matches' | 'changes' | 'process' | 'plan' | 'control';
  execute(input: z.infer<TSchema>, context: ToolExecutionContext): Promise<AgentToolResult>;
}

interface RegisteredTool {
  name: string;
  description: string;
  schema: z.ZodType;
  readOnly: boolean;
  concurrencySafe: boolean;
  dataImpact: ToolDefinition<z.ZodType>['dataImpact'];
  timeoutMs: number;
  resultType: ToolDefinition<z.ZodType>['resultType'];
  execute(input: unknown, context: ToolExecutionContext): Promise<AgentToolResult>;
}

function defineTool<TSchema extends z.ZodType>(definition: ToolDefinition<TSchema>): RegisteredTool {
  return { ...definition, execute: (input, context) => definition.execute(input as z.infer<TSchema>, context) };
}

export type ParsedToolCall = AgentToolCall;

export function isVerificationCommand(command: string): boolean {
  if (/\|\||[;|]|(^|[^&])&([^&]|$)/.test(command)) return false;
  const finalCommand = command.split('&&').at(-1)?.trim() ?? '';
  return [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|build|typecheck|verify)(?=\s|$|:)/i,
    /^(?:npx\s+)?(?:pytest|vitest|jest|mocha|tsc)(?=\s|$)/i,
    /^(?:cargo|go|mvn|gradle)\s+test(?=\s|$)/i,
    /^(?:\.\/|[^\s]+\/)?(?:test|check|lint|build|typecheck|verify)(?:\.[a-z0-9]+)?(?=\s|$)/i,
  ].some((pattern) => pattern.test(finalCommand));
}

const toolDefinitions: RegisteredTool[] = [
  defineTool({
    name: 'workspace_tree',
    description: 'Inspect the active workspace tree before editing. node_modules and .git are excluded.',
    schema: z.object({ max_depth: z.number().int().min(1).max(8) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 10_000,
    resultType: 'tree',
    async execute(input, context) {
      const entries = await context.runtime.listWorkspace(context.containerId, input.max_depth);
      return { ok: true, content: entries.map((entry) => `${entry.isDirectory ? 'dir ' : 'file'} ${entry.path}`).join('\n') || '(workspace is empty)', data: entries };
    },
  }),
  defineTool({
    name: 'read_file',
    description: 'Read a bounded range from a text file in the active workspace. Read before changing an existing file.',
    schema: z.object({ path: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).max(10_000).optional() }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 10_000,
    resultType: 'text',
    async execute(input, context) {
      const content = await context.runtime.readWorkspaceFile(context.containerId, input.path, input.start_line, input.end_line);
      return { ok: true, content, data: { path: input.path } };
    },
  }),
  defineTool({
    name: 'search_workspace',
    description: 'Search text files in the active workspace. Use this instead of guessing where code lives.',
    schema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(100).default(30) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 15_000,
    resultType: 'matches',
    async execute(input, context) {
      const matches = await context.runtime.searchWorkspace(context.containerId, input.query, input.max_results);
      return { ok: true, content: matches.map((match) => `${match.path}:${match.line}: ${match.content}`).join('\n') || '(no matches)', data: matches };
    },
  }),
  defineTool({
    name: 'apply_patch',
    description: 'Apply one or more full-file changes atomically within the active workspace. expected_content prevents overwriting a file that changed after it was read.',
    schema: z.object({ changes: z.array(z.object({ path: z.string().min(1), content: z.string(), expected_content: z.string().optional() })).min(1).max(12) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'workspace',
    timeoutMs: 30_000,
    resultType: 'changes',
    async execute(input, context) {
      const changes = await context.runtime.applyWorkspaceChanges(context.containerId, input.changes.map((change) => ({ path: change.path, content: change.content, expectedContent: change.expected_content })));
      context.updateTask((task) => ({ ...task, changedWorkspace: true, workspaceRevision: task.workspaceRevision + 1, verified: false }));
      return { ok: true, content: changes.map((change) => `${change.kind === 'created' ? 'Created' : 'Updated'} ${change.path} (${change.beforeBytes} → ${change.afterBytes} bytes)`).join('\n'), data: changes, changedWorkspace: true };
    },
  }),
  defineTool({
    name: 'shell_run',
    description: 'Run a command inside the active WebContainer. Use foreground for inspection, tests, builds, and short commands; use background only for servers or long tasks.',
    schema: z.object({ command: z.string().min(1), mode: z.enum(['foreground', 'background']), timeout_ms: z.number().int().min(1_000).max(300_000).optional() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 300_000,
    resultType: 'process',
    async execute(input, context) {
      const result = await context.runtime.runShell({ command: input.command, mode: input.mode, timeoutMs: input.timeout_ms, containerId: context.containerId, sessionId: context.sessionId, runId: context.runId, signal: context.signal });
      const process = result.process;
      const output = process.output || '(no output)';
      const content = `${result.timedOut ? 'Command still running after timeout.' : `Exit: ${process.exitCode ?? 'running'}`}\nPID: ${process.id}\n${output}`;
      const verification = input.mode === 'foreground' && isVerificationCommand(input.command) ? { command: input.command, passed: !result.timedOut && process.exitCode === 0 } : undefined;
      if (verification) context.updateTask((task) => ({
        ...task,
        verified: task.verified || verification.passed,
        verifiedRevision: verification.passed ? task.workspaceRevision : task.verifiedRevision,
        evidence: [...task.evidence, `${verification.passed ? 'Verified' : 'Failed verification'}: ${input.command}`],
        verificationEvidence: [...task.verificationEvidence, { ...verification, workspaceRevision: task.workspaceRevision, createdAt: Date.now() }],
      }));
      return { ok: !result.timedOut && (process.exitCode ?? 0) === 0, content, data: process, verification };
    },
  }),
  defineTool({
    name: 'process_observe',
    description: 'Observe incremental output and exit state of an Agent-owned background process.',
    schema: z.object({ process_id: z.string().min(1), cursor: z.number().int().min(0).optional() }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'process',
    async execute(input, context) {
      const process = context.runtime.observeProcess(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId }, input.cursor);
      if (!process) return { ok: false, content: 'Process not found.' };
      return { ok: true, content: `Running: ${process.isRunning}\nExit: ${process.exitCode ?? 'pending'}\nCursor: ${process.cursor}\n${process.output || '(no new output)'}`, data: process };
    },
  }),
  defineTool({
    name: 'process_input',
    description: 'Send input to an Agent-owned interactive process. IMPORTANT: To execute a command (press Enter), you MUST append "\\r" to your input. To send Ctrl+C, send "\\x03".',
    schema: z.object({ process_id: z.string().min(1), input: z.string() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const sent = await context.runtime.sendProcessInput(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId }, input.input);
      return { ok: sent, content: sent ? 'Input sent.' : 'Process is not running.' };
    },
  }),
  defineTool({
    name: 'process_stop',
    description: 'Stop an Agent-owned background process that is no longer needed.',
    schema: z.object({ process_id: z.string().min(1) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const stopped = context.runtime.stopProcess(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId });
      return { ok: stopped, content: stopped ? 'Process stopped.' : 'Process is not running.' };
    },
  }),
  defineTool({
    name: 'read_user_terminal',
    description: 'Read the recent output of the user\'s active terminal. Use this when the user asks you to fix an error they encountered, or to check the status of a command the user ran manually.',
    schema: z.object({}),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'text',
    async execute(_input, context) {
      const buffer = context.runtime.getUserTerminalBuffer();
      if (!buffer) return { ok: true, content: '(User terminal is currently empty or has not received any output yet)' };
      return { ok: true, content: `--- USER TERMINAL RECENT OUTPUT ---\n${buffer}\n--- END USER TERMINAL ---` };
    },
  }),
  defineTool({
    name: 'write_user_terminal',
    description: 'Send text input directly to the user\'s active terminal. Use this to execute commands in the user\'s foreground terminal, fix their running process, or take over their shell. IMPORTANT: To execute a command (press Enter), you MUST append "\\r" to your input. To send Ctrl+C, send "\\x03".',
    schema: z.object({ input: z.string().min(1) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const sent = await context.runtime.sendUserTerminalInput(input.input);
      return { ok: sent, content: sent ? 'Input sent to user terminal.' : 'User terminal is not active.' };
    },
  }),
];

const controlToolDefinitions: RegisteredTool[] = [
  defineTool({
    name: 'update_plan',
    description: 'Maintain a short execution plan. Use it for non-trivial work before editing and whenever progress changes.',
    schema: z.object({ items: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), status: z.enum(['pending', 'in_progress', 'completed', 'blocked']) })).min(1).max(8) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'task',
    timeoutMs: 5_000,
    resultType: 'plan',
    async execute(input, context) {
      const plan: AgentPlanItem[] = input.items;
      context.updateTask((task) => ({ ...task, plan }));
      return { ok: true, content: `Plan updated with ${plan.length} steps.`, data: plan };
    },
  }),
  defineTool({
    name: 'report_progress',
    description: 'Send a concise public progress update. Do not expose private chain-of-thought.',
    schema: z.object({ message: z.string().min(1).max(800) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'task',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input) { return { ok: true, content: input.message, data: { progress: input.message } }; },
  }),
  defineTool({
    name: 'ask_user',
    description: 'Ask only when blocked by missing credentials, an unrecoverable ambiguity, or an action outside the workspace.',
    schema: z.object({ question: z.string().min(1).max(1000) }),
    readOnly: true,
    concurrencySafe: false,
    dataImpact: 'run',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input) { return { ok: true, content: input.question, stopRun: 'awaiting_user' }; },
  }),
  defineTool({
    name: 'complete_task',
    description: 'Finish only after the task contract has evidence.',
    schema: z.object({ summary: z.string().min(1).max(2_000), evidence: z.array(z.string().min(1)).min(1).max(12) }),
    readOnly: true,
    concurrencySafe: false,
    dataImpact: 'run',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const task = context.getTask();
      if (task.requiresPlan && !task.plan.length) return { ok: false, content: 'Completion blocked: this non-trivial task needs a recorded execution plan.' };
      if (task.plan.some((item) => item.status === 'pending' || item.status === 'in_progress')) return { ok: false, content: 'Completion blocked: the execution plan still has unfinished steps.' };
      if (!input.evidence.length) return { ok: false, content: 'Completion blocked: provide structured evidence for the acceptance criteria.' };
      context.updateTask((current) => ({ ...current, evidence: [...current.evidence, ...input.evidence] }));
      return { ok: true, content: input.summary, finalSummary: input.summary, stopRun: 'completed' };
    },
  }),
];

export class AgentToolRegistry {
  private readonly byName = new Map([...toolDefinitions, ...controlToolDefinitions].map((tool) => [tool.name, tool]));

  getApiDefinitions(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return Array.from(this.byName.values()).map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.schema, { target: 'draft-7' }) as Record<string, unknown> } }));
  }

  getMetadata(name: string): Pick<RegisteredTool, 'readOnly' | 'concurrencySafe' | 'dataImpact' | 'timeoutMs' | 'resultType'> | null {
    const tool = this.byName.get(name);
    return tool ? { readOnly: tool.readOnly, concurrencySafe: tool.concurrencySafe, dataImpact: tool.dataImpact, timeoutMs: tool.timeoutMs, resultType: tool.resultType } : null;
  }

  async execute(call: ParsedToolCall, context: ToolExecutionContext): Promise<AgentToolResult> {
    const tool = this.byName.get(call.name);
    if (!tool) return { ok: false, content: `Tool ${call.name} is not available.` };
    let input: unknown;
    try {
      input = JSON.parse(call.arguments || '{}');
    } catch {
      return { ok: false, content: `Tool ${call.name} received invalid JSON arguments.` };
    }
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) return { ok: false, content: `Tool ${call.name} input validation failed: ${parsed.error.issues.map((issue) => issue.message).join('; ')}` };
    try {
      return await tool.execute(parsed.data, context);
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : String(error) };
    }
  }

  toMessageToolCall(call: ParsedToolCall): ToolCall {
    return { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } };
  }
}
