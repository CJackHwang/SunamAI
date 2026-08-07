import { z } from 'zod';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { ToolCapabilityDeclaration } from '@/shared/contracts/capability';
import type { AgentRole, AgentToolResult, SubagentNotification, SubagentRole, TaskContract } from '../types';
import type { ContainerMutationLease } from '../mutationLease';

export interface SubagentHost {
  spawn(input: { taskId: string; role: SubagentRole; prompt: string; writeScope?: string[] }): Promise<{ runId: string; taskId: string; status: string }>;
  wait(runIds: string[]): Promise<SubagentNotification[]>;
  message(runId: string, message: string): Promise<boolean>;
  stop(runId: string): Promise<boolean>;
  stopAll(): Promise<void>;
  snapshot(): string[];
}

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  containerId: string;
  runtime: AgentWorkspaceRuntime;
  signal: AbortSignal;
  agentRole: AgentRole;
  /** Whether the container capability is usable (false = chat-only session). */
  containerAvailable?: boolean;
  /** Whether `run_command` is exposed (false → no verification tool). */
  shellAvailable?: boolean;
  writeScope?: string[];
  subagents?: SubagentHost;
  mutationLease: ContainerMutationLease;
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
  resultType: 'text' | 'tree' | 'matches' | 'changes' | 'process' | 'plan' | 'control' | 'resources' | 'resource';
  /** Required capability declaration. A tool without one cannot compile → cannot reach the Agent. */
  capability: ToolCapabilityDeclaration;
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
  capability: ToolCapabilityDeclaration;
  execute(input: unknown, context: ToolExecutionContext): Promise<AgentToolResult>;
}

export function defineTool<TSchema extends z.ZodType>(definition: ToolDefinition<TSchema>): RegisteredTool {
  return { ...definition, execute: (input, context) => definition.execute(input as z.infer<TSchema>, context) };
}
