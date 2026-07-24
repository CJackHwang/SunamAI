import { z } from 'zod';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { AgentToolResult, TaskContract } from '../types';

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  containerId: string;
  runtime: AgentWorkspaceRuntime;
  signal: AbortSignal;
  getTask: () => TaskContract;
  updateTask: (updater: (current: TaskContract) => TaskContract) => void;
}

export interface ToolDefinition<TSchema extends z.ZodType> {
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

export interface RegisteredTool {
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

export function defineTool<TSchema extends z.ZodType>(definition: ToolDefinition<TSchema>): RegisteredTool {
  return { ...definition, execute: (input, context) => definition.execute(input as z.infer<TSchema>, context) };
}

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
