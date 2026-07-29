import type { Message, ToolCall } from '@/entities/message/types';
import type { SunamModel } from '@/shared/config/models';

export type AgentPhase = 'preparing' | 'planning' | 'acting' | 'observing' | 'verifying' | 'awaiting_user' | 'awaiting_parent' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'interrupted';
type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface AgentPlanItem { id: string; title: string; status: PlanItemStatus; evidence?: string[]; }
interface VerificationEvidence { command: string; passed: boolean; workspaceRevision: number; createdAt: number; }
export interface TaskContract { objective: string; acceptanceCriteria: string[]; constraints: string[]; requiresPlan: boolean; plan: AgentPlanItem[]; evidence: string[]; changedWorkspace: boolean; workspaceRevision: number; verified: boolean; verifiedRevision: number; verificationEvidence: VerificationEvidence[]; }
export interface ChaosContract { persona: SunamModel; ritual: string; privateGoods: string; styleDirective: string; invariants: string[]; }
export interface AgentBudget { maxModelTurns: number; maxToolCalls: number; maxDurationMs: number; }
export type SubagentRole = 'explore' | 'task';
export type LegacySubagentRole = 'implement' | 'verify';
export type AgentRole = 'root' | SubagentRole | LegacySubagentRole;
interface AgentToolPolicy { role: AgentRole; allowedTools: string[]; writeScope?: string[]; }
type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'interrupted';
interface AgentUsage { modelTurns: number; toolCalls: number; durationMs: number; estimatedTokens?: number; }
export interface ModelTokenUsage { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean; }
export interface SubagentNotification { runId: string; taskId: string; role: SubagentRole; status: AgentTaskStatus; summary: string; evidence: string[]; changedPaths: string[]; verificationRecords: VerificationEvidence[]; workspaceRevision: number; usage: AgentUsage; blockedReason?: string; }
export interface DelegatedAgentTask { id: string; taskId: string; sessionId: string; rootRunId: string; parentRunId: string; runId?: string; role: Exclude<AgentRole, 'root'>; prompt: string; status: AgentTaskStatus; createdAt: number; updatedAt: number; summary?: string; evidence: string[]; changedPaths: string[]; verificationRecords: VerificationEvidence[]; usage?: AgentUsage; blockedReason?: string; }
export interface AgentRun { id: string; sessionId: string; containerId: string; model: string; persona: SunamModel; phase: AgentPhase; createdAt: number; updatedAt: number; task: TaskContract; chaos: ChaosContract; budget: AgentBudget; modelTurns: number; toolCalls: number; summary: string; modelUsage?: ModelTokenUsage; rootRunId?: string; parentRunId?: string; agentRole?: AgentRole; delegatedTaskId?: string; depth?: number; toolPolicy?: AgentToolPolicy; error?: string; finalSummary?: string; }
export interface AgentCheckpoint { id: string; runId: string; sessionId: string; containerId: string; summary: string; messages: Message[]; createdAt: number; eventTailSequence?: number; workspaceRevision?: number; resourceIds?: string[]; }

export type AgentEventKind = 'run_started' | 'phase_changed' | 'message' | 'assistant_delta' | 'plan_updated' | 'progress_reported' | 'tool_requested' | 'tool_started' | 'tool_finished' | 'verification' | 'model_retry' | 'recovery_hint' | 'context_compaction_status' | 'context_compacted' | 'checkpoint' | 'run_finished' | 'run_failed';
interface AgentEventBase { id: string; kind: AgentEventKind; sessionId: string; runId: string; sequence: number; createdAt: number; transient?: boolean; }
export type AgentEvent =
  | (AgentEventBase & { kind: 'run_started'; run: AgentRun })
  | (AgentEventBase & { kind: 'phase_changed'; phase: AgentPhase; detail?: string })
  | (AgentEventBase & { kind: 'message'; message: Message })
  | (AgentEventBase & { kind: 'assistant_delta'; content: string; reasoningContent: string })
  | (AgentEventBase & { kind: 'plan_updated'; task: TaskContract })
  | (AgentEventBase & { kind: 'progress_reported'; message: string })
  | (AgentEventBase & { kind: 'tool_requested'; toolCall: ToolCall })
  | (AgentEventBase & { kind: 'tool_started'; toolCall: ToolCall })
  | (AgentEventBase & { kind: 'tool_finished'; toolCall: ToolCall; result: AgentToolResult })
  | (AgentEventBase & { kind: 'verification'; command: string; passed: boolean; detail: string })
  | (AgentEventBase & { kind: 'model_retry'; attempt: number; delayMs: number; error: string })
  | (AgentEventBase & { kind: 'recovery_hint'; message: string })
  | (AgentEventBase & { kind: 'context_compaction_status'; active: boolean })
  | (AgentEventBase & { kind: 'context_compacted'; summary: string; fallback: boolean; beforeTokens?: number; afterTokens?: number; eventTailSequence?: number; workspaceRevision?: number; rehydratedResourceIds?: string[]; fallbackReason?: string })
  | (AgentEventBase & { kind: 'checkpoint'; summary: string })
  | (AgentEventBase & { kind: 'run_finished'; summary: string })
  | (AgentEventBase & { kind: 'run_failed'; error: string; recoverable: boolean });

export interface AgentToolResult { ok: boolean; content: string; data?: unknown; modelContent?: import('@/entities/message/types').MessageContentPart[]; resourceReferences?: string[]; changedWorkspace?: boolean; verification?: { command: string; passed: boolean }; stopRun?: 'completed' | 'awaiting_user' | 'awaiting_parent'; finalSummary?: string; }
export interface AgentToolCall { id: string; name: string; arguments: string; }
export interface AgentModelResponse { message: Message; toolCalls: AgentToolCall[]; usage?: ModelTokenUsage; }

export function normalizeSubagentRole(role: AgentRole | undefined): SubagentRole {
  return role === 'explore' ? 'explore' : 'task';
}

export function isActiveAgentPhase(phase: AgentPhase): boolean {
  return ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(phase);
}
