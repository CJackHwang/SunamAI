import type { WorkspaceState } from '@/entities/workspace/types';
import type { AgentCheckpoint, AgentEvent, AgentRun } from '@/entities/agent/types';

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
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<StoredValue<unknown>>).id === 'string' && typeof (value as Partial<StoredValue<unknown>>).formatVersion === 'number' && 'payload' in value);
}

export function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceState>;
  return Array.isArray(candidate.sessions) && Array.isArray(candidate.containers) && (typeof candidate.activeSessionId === 'string' || candidate.activeSessionId === null) && (typeof candidate.activeContainerId === 'string' || candidate.activeContainerId === null);
}

export function isRun(value: unknown): value is AgentRun {
  const candidate = value as Partial<AgentRun> | null;
  return Boolean(candidate && typeof candidate === 'object' && typeof candidate.id === 'string' && typeof candidate.sessionId === 'string' && typeof candidate.containerId === 'string' && typeof candidate.phase === 'string' && candidate.task && typeof candidate.task === 'object');
}

export function isEvent(value: unknown): value is AgentEvent {
  const candidate = value as Partial<AgentEvent> | null;
  return Boolean(candidate && typeof candidate === 'object' && typeof candidate.id === 'string' && typeof candidate.kind === 'string' && typeof candidate.runId === 'string' && typeof candidate.sessionId === 'string');
}

export function isCheckpoint(value: unknown): value is AgentCheckpoint {
  const candidate = value as Partial<AgentCheckpoint> | null;
  return Boolean(candidate && typeof candidate === 'object' && typeof candidate.id === 'string' && typeof candidate.runId === 'string' && typeof candidate.sessionId === 'string' && Array.isArray(candidate.messages));
}

function upgradeTaskPayload(value: AgentRun): AgentRun {
  return Array.isArray(value.task.verificationEvidence) ? value : { ...value, task: { ...value.task, verificationEvidence: [] } };
}

export function upgradeRecord(store: V2StoreName, raw: unknown): StoredValue<unknown> | null {
  if (!isStoredValue(raw) || raw.formatVersion < 1 || raw.formatVersion > V2_PERSISTENCE_VERSION) return null;
  let payload = cloneValue(raw.payload);
  if (store === 'runs' && isRun(payload)) payload = upgradeTaskPayload(payload);
  if (store === 'events' && isEvent(payload) && payload.kind === 'run_started') payload = { ...payload, run: upgradeTaskPayload(payload.run) };
  if (store === 'events' && isEvent(payload) && payload.kind === 'plan_updated' && !Array.isArray(payload.task.verificationEvidence)) payload = { ...payload, task: { ...payload.task, verificationEvidence: [] } };
  return { ...raw, formatVersion: V2_PERSISTENCE_VERSION, payload };
}
