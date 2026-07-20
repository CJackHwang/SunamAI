import type { Message, ToolCall } from '@/entities/message/types';
import type { SunamModel } from '@/shared/config/models';

export type AgentPhase = 'preparing' | 'planning' | 'acting' | 'observing' | 'verifying' | 'awaiting_user' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'interrupted';
export type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface AgentPlanItem { id: string; title: string; status: PlanItemStatus; evidence?: string[]; }
export interface TaskContract { objective: string; acceptanceCriteria: string[]; constraints: string[]; requiresPlan: boolean; plan: AgentPlanItem[]; evidence: string[]; changedWorkspace: boolean; verified: boolean; verificationEvidence: Array<{ command: string; passed: boolean; createdAt: number }>; }
export interface ChaosContract { persona: SunamModel; ritual: string; privateGoods: string; styleDirective: string; invariants: string[]; }
export interface AgentBudget { maxModelTurns: number; maxToolCalls: number; maxDurationMs: number; }
export interface AgentRun { id: string; sessionId: string; containerId: string; model: string; persona: SunamModel; phase: AgentPhase; createdAt: number; updatedAt: number; task: TaskContract; chaos: ChaosContract; budget: AgentBudget; modelTurns: number; toolCalls: number; summary: string; error?: string; finalSummary?: string; }
export interface AgentCheckpoint { id: string; runId: string; sessionId: string; containerId: string; summary: string; messages: Message[]; createdAt: number; }

export type AgentEventKind = 'run_started' | 'phase_changed' | 'message' | 'assistant_delta' | 'plan_updated' | 'progress_reported' | 'tool_requested' | 'tool_started' | 'tool_finished' | 'verification' | 'model_retry' | 'recovery_hint' | 'context_compacted' | 'checkpoint' | 'run_finished' | 'run_failed';
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
  | (AgentEventBase & { kind: 'context_compacted'; summary: string; fallback: boolean })
  | (AgentEventBase & { kind: 'checkpoint'; summary: string })
  | (AgentEventBase & { kind: 'run_finished'; summary: string })
  | (AgentEventBase & { kind: 'run_failed'; error: string; recoverable: boolean });

export interface AgentToolResult { ok: boolean; content: string; data?: unknown; changedWorkspace?: boolean; verification?: { command: string; passed: boolean }; stopRun?: 'completed' | 'awaiting_user'; finalSummary?: string; }
export interface AgentToolCall { id: string; name: string; arguments: string; }
export interface AgentModelResponse { message: Message; toolCalls: AgentToolCall[]; }

export function isActiveAgentPhase(phase: AgentPhase): boolean {
  return ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(phase);
}
