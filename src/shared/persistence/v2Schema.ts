import type { WorkspaceState } from '@/entities/workspace/types';
import type { AgentCheckpoint, AgentEvent, AgentRun } from '@/entities/agent/types';
import type { Message, ToolCall } from '@/entities/message/types';

export const V2_PERSISTENCE_DATABASE = 'sunam-v2';
export const V2_PERSISTENCE_VERSION = 2;
export const WORKSPACE_ID = 'current';

export type V2StoreName = 'workspace' | 'runs' | 'events' | 'checkpoints' | 'terminalHistory' | 'snapshots' | 'quarantine';

export interface V2DataIssue {
  id: string;
  store: V2StoreName;
  recordId: string;
  message: string;
  createdAt: number;
}

export interface V2ReadResult<T> { value: T | null; issues: V2DataIssue[] }
export interface V2ListResult<T> { value: T[]; issues: V2DataIssue[] }
export interface StoredValue<T> { id: string; formatVersion: number; updatedAt: number; payload: T }
export interface QuarantinedValue { issue: V2DataIssue; raw: unknown }

export function cloneValue<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

export function isStoredValue(value: unknown): value is StoredValue<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<StoredValue<unknown>>).id === 'string' && Number.isInteger((value as Partial<StoredValue<unknown>>).formatVersion) && Number.isFinite((value as Partial<StoredValue<unknown>>).updatedAt) && 'payload' in value);
}

export function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceState>;
  if (!Array.isArray(candidate.sessions) || !candidate.sessions.every((session) => isRecord(session) && typeof session.id === 'string' && typeof session.title === 'string' && Number.isFinite(session.updatedAt) && (session.pinned === undefined || typeof session.pinned === 'boolean') && (session.status === undefined || ['idle', 'running', 'completed_unread', 'failed_unread'].includes(String(session.status))))) return false;
  if (!Array.isArray(candidate.containers) || !candidate.containers.every((container) => isRecord(container) && typeof container.id === 'string' && typeof container.name === 'string' && Number.isFinite(container.updatedAt) && (container.pinned === undefined || typeof container.pinned === 'boolean'))) return false;
  const sessionIds = new Set(candidate.sessions.map((session) => session.id));
  const containerIds = new Set(candidate.containers.map((container) => container.id));
  if (sessionIds.size !== candidate.sessions.length || containerIds.size !== candidate.containers.length) return false;
  return (candidate.activeSessionId === null || typeof candidate.activeSessionId === 'string' && sessionIds.has(candidate.activeSessionId)) && (candidate.activeContainerId === null || typeof candidate.activeContainerId === 'string' && containerIds.has(candidate.activeContainerId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isToolCall(value: unknown): value is ToolCall {
  if (!isRecord(value) || value.type !== 'function' || typeof value.id !== 'string' || !isRecord(value.function)) return false;
  return typeof value.function.name === 'string' && typeof value.function.arguments === 'string';
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || !['system', 'user', 'assistant', 'tool'].includes(String(value.role)) || typeof value.content !== 'string') return false;
  if (value.tool_calls !== undefined && (!Array.isArray(value.tool_calls) || !value.tool_calls.every(isToolCall))) return false;
  if (value._ui_attachments !== undefined && (!Array.isArray(value._ui_attachments) || !value._ui_attachments.every((attachment) => isRecord(attachment) && typeof attachment.name === 'string' && typeof attachment.size === 'number' && typeof attachment.content === 'string'))) return false;
  return (value.tool_call_id === undefined || typeof value.tool_call_id === 'string')
    && (value.name === undefined || typeof value.name === 'string')
    && (value.reasoning_content === undefined || typeof value.reasoning_content === 'string')
    && (value._ui_streaming === undefined || typeof value._ui_streaming === 'boolean')
    && (value._ui_displayContent === undefined || typeof value._ui_displayContent === 'string');
}

function isTask(value: unknown, allowLegacyRevisions: boolean): value is AgentRun['task'] {
  if (!isRecord(value) || typeof value.objective !== 'string' || !isStringArray(value.acceptanceCriteria) || !isStringArray(value.constraints) || typeof value.requiresPlan !== 'boolean' || !Array.isArray(value.plan) || !isStringArray(value.evidence) || typeof value.changedWorkspace !== 'boolean' || typeof value.verified !== 'boolean') return false;
  if (!value.plan.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string' && ['pending', 'in_progress', 'completed', 'blocked'].includes(String(item.status)) && (item.evidence === undefined || isStringArray(item.evidence)))) return false;
  if (value.verificationEvidence === undefined && !allowLegacyRevisions) return false;
  if (value.verificationEvidence !== undefined && (!Array.isArray(value.verificationEvidence) || !value.verificationEvidence.every((item) => isRecord(item) && typeof item.command === 'string' && typeof item.passed === 'boolean' && Number.isFinite(item.createdAt) && (item.workspaceRevision === undefined ? allowLegacyRevisions : Number.isInteger(item.workspaceRevision) && Number(item.workspaceRevision) >= 0)))) return false;
  const validWorkspaceRevision = value.workspaceRevision === undefined ? allowLegacyRevisions : Number.isInteger(value.workspaceRevision) && Number(value.workspaceRevision) >= 0;
  const validVerifiedRevision = value.verifiedRevision === undefined ? allowLegacyRevisions : Number.isInteger(value.verifiedRevision) && Number(value.verifiedRevision) >= -1;
  return validWorkspaceRevision && validVerifiedRevision;
}

const AGENT_PHASES = ['preparing', 'planning', 'acting', 'observing', 'verifying', 'awaiting_user', 'cancelling', 'cancelled', 'completed', 'failed', 'interrupted'];

function isRunPayload(value: unknown, allowLegacyRevisions: boolean): value is AgentRun {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sessionId !== 'string' || typeof value.containerId !== 'string' || typeof value.model !== 'string' || typeof value.persona !== 'string' || !AGENT_PHASES.includes(String(value.phase)) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !isTask(value.task, allowLegacyRevisions)) return false;
  if (!isRecord(value.budget) || !Number.isFinite(value.budget.maxModelTurns) || !Number.isFinite(value.budget.maxToolCalls) || !Number.isFinite(value.budget.maxDurationMs) || !Number.isInteger(value.modelTurns) || Number(value.modelTurns) < 0 || !Number.isInteger(value.toolCalls) || Number(value.toolCalls) < 0 || typeof value.summary !== 'string') return false;
  if (!isRecord(value.chaos) || typeof value.chaos.persona !== 'string' || typeof value.chaos.ritual !== 'string' || typeof value.chaos.privateGoods !== 'string' || typeof value.chaos.styleDirective !== 'string' || !isStringArray(value.chaos.invariants)) return false;
  return (value.parentRunId === undefined || typeof value.parentRunId === 'string') && (value.error === undefined || typeof value.error === 'string') && (value.finalSummary === undefined || typeof value.finalSummary === 'string');
}

export function isRun(value: unknown): value is AgentRun {
  return isRunPayload(value, false);
}

function isEventBase(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string' && typeof value.runId === 'string' && typeof value.sessionId === 'string' && Number.isInteger(value.sequence) && Number(value.sequence) > 0 && Number.isFinite(value.createdAt) && (value.transient === undefined || typeof value.transient === 'boolean');
}

export function isEvent(value: unknown): value is AgentEvent {
  if (!isEventBase(value)) return false;
  switch (value.kind) {
    case 'run_started': return isRun(value.run);
    case 'phase_changed': return AGENT_PHASES.includes(String(value.phase)) && (value.detail === undefined || typeof value.detail === 'string');
    case 'message': return isMessage(value.message);
    case 'assistant_delta': return typeof value.content === 'string' && typeof value.reasoningContent === 'string';
    case 'plan_updated': return isTask(value.task, false);
    case 'progress_reported':
    case 'recovery_hint': return typeof value.message === 'string';
    case 'tool_requested':
    case 'tool_started': return isToolCall(value.toolCall);
    case 'tool_finished': return isToolCall(value.toolCall) && isRecord(value.result) && typeof value.result.ok === 'boolean' && typeof value.result.content === 'string';
    case 'verification': return typeof value.command === 'string' && typeof value.passed === 'boolean' && typeof value.detail === 'string';
    case 'model_retry': return typeof value.attempt === 'number' && typeof value.delayMs === 'number' && typeof value.error === 'string';
    case 'context_compacted': return typeof value.summary === 'string' && typeof value.fallback === 'boolean';
    case 'checkpoint':
    case 'run_finished': return typeof value.summary === 'string';
    case 'run_failed': return typeof value.error === 'string' && typeof value.recoverable === 'boolean';
    default: return false;
  }
}

export function isCheckpoint(value: unknown): value is AgentCheckpoint {
  return isRecord(value) && typeof value.id === 'string' && typeof value.runId === 'string' && typeof value.sessionId === 'string' && typeof value.containerId === 'string' && typeof value.summary === 'string' && typeof value.createdAt === 'number' && Array.isArray(value.messages) && value.messages.every(isMessage);
}

function upgradeTaskPayload(value: AgentRun): AgentRun {
  const legacyTask = value.task as AgentRun['task'] & { workspaceRevision?: number; verifiedRevision?: number; verificationEvidence?: Array<AgentRun['task']['verificationEvidence'][number] & { workspaceRevision?: number }> };
  const workspaceRevision = Number.isInteger(legacyTask.workspaceRevision) ? legacyTask.workspaceRevision! : legacyTask.changedWorkspace ? 1 : 0;
  const verificationEvidence = Array.isArray(legacyTask.verificationEvidence)
    ? legacyTask.verificationEvidence.map((evidence) => ({ ...evidence, workspaceRevision: Number.isInteger(evidence.workspaceRevision) ? evidence.workspaceRevision! : workspaceRevision }))
    : [];
  const latestPassedRevision = verificationEvidence.reduce((latest, evidence) => evidence.passed ? Math.max(latest, evidence.workspaceRevision) : latest, -1);
  const verifiedRevision = Number.isInteger(legacyTask.verifiedRevision) ? legacyTask.verifiedRevision! : latestPassedRevision;
  return {
    ...value,
    task: {
      ...value.task,
      workspaceRevision,
      verifiedRevision,
      verified: legacyTask.changedWorkspace ? verifiedRevision === workspaceRevision && latestPassedRevision === workspaceRevision : legacyTask.verified,
      verificationEvidence,
    },
  };
}

export interface UpgradeResult { record: StoredValue<unknown>; changed: boolean }

export function upgradeRecord(store: V2StoreName, raw: unknown): UpgradeResult | null {
  if (!isStoredValue(raw) || raw.formatVersion < 1 || raw.formatVersion > V2_PERSISTENCE_VERSION) return null;
  let payload = cloneValue(raw.payload);
  if (['runs', 'events', 'checkpoints'].includes(store) && (!isRecord(payload) || payload.id !== raw.id)) return null;
  if (store === 'terminalHistory' && (!isRecord(payload) || payload.sessionId !== raw.id)) return null;
  if (store === 'snapshots' && (!isRecord(payload) || payload.containerId !== raw.id)) return null;
  if (store === 'workspace' && raw.id !== WORKSPACE_ID) return null;
  let changed = raw.formatVersion !== V2_PERSISTENCE_VERSION;
  if (store === 'runs' && isRunPayload(payload, true)) {
    const task = payload.task as Partial<AgentRun['task']>;
    changed ||= task.workspaceRevision === undefined || task.verifiedRevision === undefined || !Array.isArray(task.verificationEvidence) || task.verificationEvidence.some((evidence) => evidence.workspaceRevision === undefined);
    payload = upgradeTaskPayload(payload);
  }
  if (store === 'events' && isEventBase(payload) && payload.kind === 'run_started' && isRunPayload(payload.run, true)) {
    const task = payload.run.task as Partial<AgentRun['task']>;
    changed ||= task.workspaceRevision === undefined || task.verifiedRevision === undefined || !Array.isArray(task.verificationEvidence) || task.verificationEvidence.some((evidence) => evidence.workspaceRevision === undefined);
    payload = { ...payload, run: upgradeTaskPayload(payload.run) };
  }
  if (store === 'events' && isEventBase(payload) && payload.kind === 'plan_updated' && isTask(payload.task, true)) {
    const task = payload.task as Partial<AgentRun['task']>;
    changed ||= task.workspaceRevision === undefined || task.verifiedRevision === undefined || !Array.isArray(task.verificationEvidence) || task.verificationEvidence.some((evidence) => evidence.workspaceRevision === undefined);
    const upgraded = upgradeTaskPayload({ task: payload.task } as AgentRun);
    payload = { ...payload, task: upgraded.task };
  }
  return { record: { ...raw, formatVersion: V2_PERSISTENCE_VERSION, payload }, changed };
}
