import { z } from 'zod';
import type { ToolCall } from '@/entities/message/types';
import type { AgentToolCall, AgentToolResult } from './types';
import { type RegisteredTool, type ToolExecutionContext, isVerificationCommand } from './tools/base';
import { workspaceTools } from './tools/workspaceTools';
import { processTools } from './tools/processTools';
import { controlTools } from './tools/controlTools';
import { resourceTools } from './tools/resourceTools';
import { subagentTools } from './tools/subagentTools';
import { resolveContainerPath } from '@/shared/lib/containerPaths';

export type { ToolExecutionContext } from './tools/base';
export { isVerificationCommand };

export type ParsedToolCall = AgentToolCall;

export class AgentToolRegistry {
  private readonly byName: Map<string, RegisteredTool>;

  constructor(allowedTools?: ReadonlySet<string>) {
    const tools = [...workspaceTools, ...processTools, ...resourceTools, ...subagentTools, ...controlTools];
    this.byName = new Map(tools.filter((tool) => !allowedTools || allowedTools.has(tool.name)).map((tool) => [tool.name, tool]));
  }

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
      if (context.agentRole === 'verify' && call.name === 'shell_run') {
        const shell = parsed.data as { mode?: unknown; command?: unknown };
        if (shell.mode !== 'foreground' || typeof shell.command !== 'string' || !isVerificationCommand(shell.command)) return { ok: false, content: 'Verify agents may run foreground verification commands only.' };
      }
      if (context.writeScope?.length && (call.name === 'apply_patch' || call.name === 'materialize_resource')) {
        const paths = call.name === 'apply_patch'
          ? ((parsed.data as { changes?: Array<{ path: string }> }).changes ?? []).map((change) => change.path)
          : [String((parsed.data as { path?: unknown }).path ?? '')];
        const scopes = context.writeScope.map((scope) => resolveContainerPath(context.containerId, scope));
        if (paths.some((path) => {
          const target = resolveContainerPath(context.containerId, path);
          return !scopes.some((scope) => target === scope || target.startsWith(`${scope}/`));
        })) return { ok: false, content: 'Tool call is outside the delegated write scope.' };
      }
      const execute = () => tool.execute(parsed.data, context);
      return ['apply_patch', 'materialize_resource', 'shell_run'].includes(call.name) ? await context.mutationLease.run(context.containerId, execute) : await execute();
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : String(error) };
    }
  }

  toMessageToolCall(call: ParsedToolCall): ToolCall {
    return { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } };
  }
}
