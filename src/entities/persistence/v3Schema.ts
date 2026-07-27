import type { AgentCheckpoint, AgentEvent, AgentRun, DelegatedAgentTask } from '@/entities/agent/types';
import type { Message, MessageContentPart, ToolCall } from '@/entities/message/types';
import type { StoredAgentResource } from '@/entities/resource/types';
import type { WorkspaceState } from '@/entities/workspace/types';

export const V3_PERSISTENCE_DATABASE = 'sunam-v3';
export const V3_PERSISTENCE_VERSION = 3;
export const WORKSPACE_ID = 'current';
export const EVENT_PAGE_SIZE = 250;

export type V3StoreName = 'workspace' | 'runs' | 'events' | 'checkpoints' | 'terminalHistory' | 'snapshots' | 'quarantine' | 'resources' | 'agentTasks';
export interface V3DataIssue { id: string; store: V3StoreName; recordId: string; message: string; createdAt: number; }
export interface V3ReadResult<T> { value: T | null; issues: V3DataIssue[]; }
export interface V3ListResult<T> { value: T[]; issues: V3DataIssue[]; }
export interface V3EventPage extends V3ListResult<AgentEvent> { hasMore: boolean; oldestSequence: number | null; newestSequence: number | null; }
export interface V3EventCursor { createdAt: number; sequence: number; id: string; }
export interface StoredValue<T> { id: string; formatVersion: number; updatedAt: number; payload: T; }
export interface QuarantinedValue { issue: V3DataIssue; raw: unknown; }

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function isStoredValue(value: unknown): value is StoredValue<unknown> {
  return isRecord(value) && typeof value.id === 'string' && value.formatVersion === V3_PERSISTENCE_VERSION && Number.isFinite(value.updatedAt) && 'payload' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object'); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isOptionalString(value: unknown): boolean { return value === undefined || typeof value === 'string'; }
function isOptionalBoolean(value: unknown): boolean { return value === undefined || typeof value === 'boolean'; }
function isOptionalNonNegativeInteger(value: unknown): boolean { return value === undefined || Number.isInteger(value) && Number(value) >= 0; }

const AGENT_PHASES = new Set(['preparing', 'planning', 'acting', 'observing', 'verifying', 'awaiting_user', 'cancelling', 'cancelled', 'completed', 'failed', 'interrupted']);
const AGENT_ROLES = new Set(['root', 'explore', 'task', 'implement', 'verify']);
const TASK_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'blocked', 'interrupted']);

function isToolCall(value: unknown): value is ToolCall {
  return isRecord(value) && typeof value.id === 'string' && value.type === 'function' && isRecord(value.function)
    && typeof value.function.name === 'string' && typeof value.function.arguments === 'string';
}

function isContentPart(value: unknown): value is MessageContentPart {
  if (!isRecord(value)) return false;
  if (value.type === 'text') return typeof value.text === 'string';
  return (value.type === 'image_resource' || value.type === 'file_resource') && typeof value.resourceId === 'string';
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || !['system', 'user', 'assistant', 'tool'].includes(String(value.role)) || typeof value.content !== 'string') return false;
  if (value.tool_calls !== undefined && (!Array.isArray(value.tool_calls) || !value.tool_calls.every(isToolCall))) return false;
  if (value.contentParts !== undefined && (!Array.isArray(value.contentParts) || !value.contentParts.every(isContentPart))) return false;
  if (value.resourceIds !== undefined && !isStringArray(value.resourceIds)) return false;
  if (value._ui_attachments !== undefined && (!Array.isArray(value._ui_attachments) || !value._ui_attachments.every((attachment) => isRecord(attachment)
    && typeof attachment.name === 'string' && Number.isFinite(attachment.size) && Number(attachment.size) >= 0 && isOptionalString(attachment.type)
    && isOptionalString(attachment.resourceId) && attachment.file === undefined))) return false;
  return isOptionalString(value.tool_call_id) && isOptionalString(value.name) && isOptionalString(value.reasoning_content)
    && isOptionalBoolean(value._ui_streaming) && isOptionalString(value._ui_displayContent);
}

function isVerificationEvidence(value: unknown): boolean {
  return isRecord(value) && typeof value.command === 'string' && typeof value.passed === 'boolean'
    && Number.isInteger(value.workspaceRevision) && Number(value.workspaceRevision) >= 0 && Number.isFinite(value.createdAt);
}

function isTask(value: unknown): value is AgentRun['task'] {
  if (!isRecord(value) || typeof value.objective !== 'string' || !isStringArray(value.acceptanceCriteria) || !isStringArray(value.constraints)
    || typeof value.requiresPlan !== 'boolean' || !Array.isArray(value.plan) || !isStringArray(value.evidence)
    || typeof value.changedWorkspace !== 'boolean' || !Number.isInteger(value.workspaceRevision) || Number(value.workspaceRevision) < 0
    || typeof value.verified !== 'boolean' || !Number.isInteger(value.verifiedRevision) || Number(value.verifiedRevision) < -1
    || !Array.isArray(value.verificationEvidence) || !value.verificationEvidence.every(isVerificationEvidence)) return false;
  return value.plan.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string'
    && ['pending', 'in_progress', 'completed', 'blocked'].includes(String(item.status))
    && (item.evidence === undefined || isStringArray(item.evidence)));
}

function isUsage(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.modelTurns) && Number(value.modelTurns) >= 0
    && Number.isInteger(value.toolCalls) && Number(value.toolCalls) >= 0 && Number.isFinite(value.durationMs) && Number(value.durationMs) >= 0
    && isOptionalNonNegativeInteger(value.estimatedTokens);
}

function isModelUsage(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.inputTokens) && Number(value.inputTokens) >= 0
    && Number.isInteger(value.outputTokens) && Number(value.outputTokens) >= 0
    && Number.isInteger(value.totalTokens) && Number(value.totalTokens) >= 0 && typeof value.estimated === 'boolean';
}

function isToolResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.content !== 'string') return false;
  if (value.modelContent !== undefined && (!Array.isArray(value.modelContent) || !value.modelContent.every(isContentPart))) return false;
  if (value.resourceReferences !== undefined && !isStringArray(value.resourceReferences)) return false;
  if (value.verification !== undefined && (!isRecord(value.verification) || typeof value.verification.command !== 'string' || typeof value.verification.passed !== 'boolean')) return false;
  return isOptionalBoolean(value.changedWorkspace) && (value.stopRun === undefined || value.stopRun === 'completed' || value.stopRun === 'awaiting_user')
    && isOptionalString(value.finalSummary);
}

export function isWorkspace(value: unknown): value is WorkspaceState {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.containers)) return false;
  const sessionsValid = value.sessions.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string' && Number.isFinite(item.updatedAt)
    && isOptionalBoolean(item.pinned) && (item.status === undefined || ['idle', 'running', 'completed_unread', 'failed_unread'].includes(String(item.status))));
  const containersValid = value.containers.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(item.updatedAt) && isOptionalBoolean(item.pinned));
  const sessionIds = new Set(value.sessions.flatMap((item) => isRecord(item) && typeof item.id === 'string' ? [item.id] : []));
  const containerIds = new Set(value.containers.flatMap((item) => isRecord(item) && typeof item.id === 'string' ? [item.id] : []));
  return sessionsValid && containersValid && sessionIds.size === value.sessions.length && containerIds.size === value.containers.length
    && (value.activeSessionId === null || typeof value.activeSessionId === 'string' && sessionIds.has(value.activeSessionId))
    && (value.activeContainerId === null || typeof value.activeContainerId === 'string' && containerIds.has(value.activeContainerId));
}

export function isRun(value: unknown): value is AgentRun {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sessionId !== 'string' || typeof value.containerId !== 'string'
    || typeof value.model !== 'string' || typeof value.persona !== 'string' || !AGENT_PHASES.has(String(value.phase))
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !isTask(value.task)
    || !isRecord(value.budget) || !Number.isInteger(value.budget.maxModelTurns) || Number(value.budget.maxModelTurns) <= 0
    || !Number.isInteger(value.budget.maxToolCalls) || Number(value.budget.maxToolCalls) <= 0 || !Number.isFinite(value.budget.maxDurationMs) || Number(value.budget.maxDurationMs) <= 0
    || !Number.isInteger(value.modelTurns) || Number(value.modelTurns) < 0 || !Number.isInteger(value.toolCalls) || Number(value.toolCalls) < 0
    || typeof value.summary !== 'string' || !isRecord(value.chaos) || typeof value.chaos.persona !== 'string'
    || typeof value.chaos.ritual !== 'string' || typeof value.chaos.privateGoods !== 'string' || typeof value.chaos.styleDirective !== 'string'
    || !isStringArray(value.chaos.invariants)) return false;
  if (!isOptionalString(value.rootRunId) || !isOptionalString(value.parentRunId) || !isOptionalString(value.delegatedTaskId)
    || !isOptionalString(value.error) || !isOptionalString(value.finalSummary) || !isOptionalNonNegativeInteger(value.depth)
    || value.agentRole !== undefined && !AGENT_ROLES.has(String(value.agentRole)) || value.modelUsage !== undefined && !isModelUsage(value.modelUsage)) return false;
  return value.toolPolicy === undefined || isRecord(value.toolPolicy) && AGENT_ROLES.has(String(value.toolPolicy.role))
    && isStringArray(value.toolPolicy.allowedTools) && (value.toolPolicy.writeScope === undefined || isStringArray(value.toolPolicy.writeScope));
}

export function isEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string' || typeof value.sessionId !== 'string'
    || typeof value.runId !== 'string' || !Number.isInteger(value.sequence) || Number(value.sequence) <= 0 || !Number.isFinite(value.createdAt)
    || !isOptionalBoolean(value.transient)) return false;
  switch (value.kind) {
    case 'run_started': return isRun(value.run);
    case 'phase_changed': return AGENT_PHASES.has(String(value.phase)) && isOptionalString(value.detail);
    case 'message': return isMessage(value.message);
    case 'assistant_delta': return typeof value.content === 'string' && typeof value.reasoningContent === 'string';
    case 'plan_updated': return isTask(value.task);
    case 'progress_reported':
    case 'recovery_hint': return typeof value.message === 'string';
    case 'tool_requested':
    case 'tool_started': return isToolCall(value.toolCall);
    case 'tool_finished': return isToolCall(value.toolCall) && isToolResult(value.result);
    case 'verification': return typeof value.command === 'string' && typeof value.passed === 'boolean' && typeof value.detail === 'string';
    case 'model_retry': return Number.isInteger(value.attempt) && Number(value.attempt) > 0 && Number.isFinite(value.delayMs) && typeof value.error === 'string';
    case 'context_compacted': return typeof value.summary === 'string' && typeof value.fallback === 'boolean'
      && isOptionalNonNegativeInteger(value.beforeTokens) && isOptionalNonNegativeInteger(value.afterTokens)
      && isOptionalNonNegativeInteger(value.eventTailSequence) && isOptionalNonNegativeInteger(value.workspaceRevision)
      && (value.rehydratedResourceIds === undefined || isStringArray(value.rehydratedResourceIds)) && isOptionalString(value.fallbackReason);
    case 'checkpoint':
    case 'run_finished': return typeof value.summary === 'string';
    case 'run_failed': return typeof value.error === 'string' && typeof value.recoverable === 'boolean';
    default: return false;
  }
}

export function isCheckpoint(value: unknown): value is AgentCheckpoint {
  return isRecord(value) && typeof value.id === 'string' && typeof value.runId === 'string' && value.id === value.runId
    && typeof value.sessionId === 'string' && typeof value.containerId === 'string' && typeof value.summary === 'string'
    && Array.isArray(value.messages) && value.messages.every(isMessage) && Number.isFinite(value.createdAt)
    && isOptionalNonNegativeInteger(value.eventTailSequence) && isOptionalNonNegativeInteger(value.workspaceRevision)
    && (value.resourceIds === undefined || isStringArray(value.resourceIds));
}

export function isResource(value: unknown): value is StoredAgentResource {
  return isRecord(value) && typeof value.id === 'string' && typeof value.sessionId === 'string' && typeof value.originatingRunId === 'string' && typeof value.name === 'string'
    && ['text', 'image', 'binary'].includes(String(value.kind)) && typeof value.mimeType === 'string' && Number.isInteger(value.size) && Number(value.size) >= 0
    && typeof value.sha256 === 'string' && Number.isFinite(value.createdAt) && isBlobLike(value.blob)
    && (value.modelBlob === undefined || isBlobLike(value.modelBlob));
}

function isBlobLike(value: unknown): value is Blob {
  return isRecord(value) && typeof value.arrayBuffer === 'function' && typeof value.text === 'function'
    && typeof value.type === 'string' && Number.isInteger(value.size) && Number(value.size) >= 0;
}

export function isAgentTask(value: unknown): value is DelegatedAgentTask {
  return isRecord(value) && typeof value.id === 'string' && typeof value.taskId === 'string' && typeof value.sessionId === 'string' && typeof value.rootRunId === 'string'
    && typeof value.parentRunId === 'string' && ['explore', 'task', 'implement', 'verify'].includes(String(value.role)) && typeof value.prompt === 'string'
    && TASK_STATUSES.has(String(value.status)) && Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt)
    && isStringArray(value.evidence) && isStringArray(value.changedPaths) && Array.isArray(value.verificationRecords) && value.verificationRecords.every(isVerificationEvidence)
    && isOptionalString(value.runId) && isOptionalString(value.summary) && isOptionalString(value.blockedReason)
    && (value.usage === undefined || isUsage(value.usage));
}
