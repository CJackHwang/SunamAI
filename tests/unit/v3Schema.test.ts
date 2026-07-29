import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRun, DelegatedAgentTask } from '@/entities/agent/types';
import { V3_PERSISTENCE_VERSION, isAgentTask, isCheckpoint, isEvent, isResource, isRun, isStoredValue, isWorkspace } from '@/entities/persistence/v3Schema';

const task: AgentRun['task'] = {
  objective: 'work', acceptanceCriteria: ['safe'], constraints: ['local'], requiresPlan: true,
  plan: [{ id: 'plan', title: 'Plan', status: 'in_progress', evidence: ['started'] }], evidence: ['known'],
  changedWorkspace: true, workspaceRevision: 2, verified: true, verifiedRevision: 2,
  verificationEvidence: [{ command: 'npm test', passed: true, workspaceRevision: 2, createdAt: 2 }],
};

const run: AgentRun = {
  id: 'r-1', sessionId: 's-1', containerId: 'c-1', model: 'model', persona: 'Sunam 6.9 Pron', phase: 'acting', createdAt: 1, updatedAt: 2,
  task, chaos: { persona: 'Sunam 6.9 Pron', ritual: 'r', privateGoods: 'g', styleDirective: 's', invariants: ['truth'] },
  budget: { maxModelTurns: 10, maxToolCalls: 20, maxDurationMs: 30 }, modelTurns: 1, toolCalls: 2, summary: 'summary',
  modelUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimated: false }, rootRunId: 'r-1', parentRunId: 'r-0', agentRole: 'implement',
  delegatedTaskId: 'task-1', depth: 1, toolPolicy: { role: 'implement', allowedTools: ['read_file'], writeScope: ['src'] }, error: 'old', finalSummary: 'done',
};

const toolCall = { id: 'call', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"a.ts"}' } };
const message = {
  role: 'assistant' as const, content: 'hello', reasoning_content: 'brief', tool_calls: [toolCall], tool_call_id: 'call', name: 'read_file',
  contentParts: [{ type: 'text' as const, text: 'hello' }, { type: 'file_resource' as const, resourceId: 'res-1' }, { type: 'image_resource' as const, resourceId: 'res-2' }],
  resourceIds: ['res-1', 'res-2'], _ui_streaming: false, _ui_displayContent: 'shown',
  _ui_attachments: [{ name: 'a.txt', size: 1, type: 'text/plain', resourceId: 'res-1' }],
};

function event(kind: AgentEvent['kind'], payload: Record<string, unknown>): AgentEvent {
  return { id: `r-1:${kind}`, kind, sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 1, ...payload } as AgentEvent;
}

describe('v3 persistence schema guards', () => {
  it('accepts complete workspace, run, checkpoint, resource, task, and stored envelopes', () => {
    expect(isWorkspace({ sessions: [{ id: 's-1', title: 'One', updatedAt: 1, pinned: true, status: 'running' }], containers: [{ id: 'c-1', name: 'One', updatedAt: 1, pinned: false }], activeSessionId: 's-1', activeContainerId: 'c-1' })).toBe(true);
    expect(isRun(run)).toBe(true);
    expect(isRun({ ...run, phase: 'awaiting_parent' })).toBe(true);
    expect(isRun({ ...run, agentRole: 'task', toolPolicy: { role: 'task', allowedTools: ['read_file', 'apply_patch', 'shell_run'] } })).toBe(true);
    expect(isCheckpoint({ id: 'r-1', runId: 'r-1', sessionId: 's-1', containerId: 'c-1', summary: 'summary', messages: [message], createdAt: 1, eventTailSequence: 2, workspaceRevision: 2, resourceIds: ['res-1'] })).toBe(true);
    expect(isResource({ id: 'res-1', sessionId: 's-1', originatingRunId: 'r-1', name: 'a.txt', kind: 'text', mimeType: 'text/plain', size: 1, sha256: 'hash', createdAt: 1, blob: new Blob(['a']) })).toBe(true);
    const delegated: DelegatedAgentTask = { id: 'internal', taskId: 'label', sessionId: 's-1', rootRunId: 'r-1', parentRunId: 'r-1', runId: 'r-child', role: 'verify', prompt: 'verify', status: 'blocked', createdAt: 1, updatedAt: 2, summary: 'blocked', evidence: ['e'], changedPaths: ['a.ts'], verificationRecords: task.verificationEvidence, usage: { modelTurns: 1, toolCalls: 2, durationMs: 3, estimatedTokens: 4 }, blockedReason: 'input' };
    expect(isAgentTask(delegated)).toBe(true);
    expect(isAgentTask({ ...delegated, role: 'task' })).toBe(true);
    expect(isStoredValue({ id: 'r-1', formatVersion: V3_PERSISTENCE_VERSION, updatedAt: 1, payload: run })).toBe(true);
    expect(isEvent(event('phase_changed', { phase: 'awaiting_parent', detail: 'Waiting for root guidance.' }))).toBe(true);
    expect(isEvent(event('tool_finished', { toolCall, result: { ok: true, content: 'Need parent input.', stopRun: 'awaiting_parent' } }))).toBe(true);
  });

  it('accepts every event variant with its complete payload', () => {
    const events: AgentEvent[] = [
      event('run_started', { run }), event('phase_changed', { phase: 'planning', detail: 'plan' }), event('message', { message }),
      event('assistant_delta', { content: 'a', reasoningContent: 'r' }), event('plan_updated', { task }), event('progress_reported', { message: 'progress' }),
      event('tool_requested', { toolCall }), event('tool_started', { toolCall }),
      event('tool_finished', { toolCall, result: { ok: true, content: 'done', data: { path: 'a.ts' }, modelContent: message.contentParts, resourceReferences: ['res-1'], changedWorkspace: true, verification: { command: 'npm test', passed: true }, stopRun: 'completed', finalSummary: 'done' } }),
      event('verification', { command: 'npm test', passed: true, detail: 'ok' }), event('model_retry', { attempt: 1, delayMs: 10, error: 'retry' }),
      event('recovery_hint', { message: 'recover' }), event('context_compaction_status', { active: true }), event('context_compacted', { summary: 'compact', fallback: true, beforeTokens: 10, afterTokens: 5, eventTailSequence: 2, workspaceRevision: 2, rehydratedResourceIds: ['res-1'], fallbackReason: 'fallback' }),
      event('checkpoint', { summary: 'checkpoint' }), event('run_finished', { summary: 'finished' }), event('run_failed', { error: 'failed', recoverable: true }),
    ];
    expect(events.every(isEvent)).toBe(true);
  });

  it('rejects malformed nested records at the first unsafe field', () => {
    const invalidWorkspaces = [
      null,
      { sessions: [], containers: [], activeSessionId: 'missing', activeContainerId: null },
      { sessions: [{ id: 'same', title: 'A', updatedAt: 1 }, { id: 'same', title: 'B', updatedAt: 2 }], containers: [], activeSessionId: null, activeContainerId: null },
      { sessions: [{ id: 's', title: 'A', updatedAt: 1, status: 'bad' }], containers: [], activeSessionId: null, activeContainerId: null },
    ];
    expect(invalidWorkspaces.every((value) => !isWorkspace(value))).toBe(true);

    const invalidRuns = [
      { ...run, id: 1 }, { ...run, phase: 'unknown' }, { ...run, task: { ...task, acceptanceCriteria: 'bad' } },
      { ...run, task: { ...task, plan: [{ id: 'p', title: 'p', status: 'bad' }] } }, { ...run, task: { ...task, verificationEvidence: [{ command: 'x', passed: true, workspaceRevision: -1, createdAt: 1 }] } },
      { ...run, budget: { ...run.budget, maxToolCalls: 0 } }, { ...run, modelTurns: -1 }, { ...run, chaos: { ...run.chaos, invariants: 'bad' } },
      { ...run, agentRole: 'writer' }, { ...run, modelUsage: { ...run.modelUsage!, estimated: 'no' } }, { ...run, toolPolicy: { role: 'implement', allowedTools: 'bad' } },
    ];
    expect(invalidRuns.every((value) => !isRun(value))).toBe(true);

    const invalidEvents = [
      event('message', {}), event('message', { message: { ...message, contentParts: [{ type: 'unknown' }] } }),
      event('message', { message: { ...message, _ui_attachments: [{ name: 'a.txt', size: 1, file: '[Blob omitted]' }] } }),
      event('tool_finished', { toolCall, result: { ok: 'yes', content: 'bad' } }), event('context_compaction_status', { active: 'yes' }), event('context_compacted', { summary: 'x', fallback: true, beforeTokens: -1 }),
      event('model_retry', { attempt: 0, delayMs: 1, error: 'bad' }), { ...event('checkpoint', { summary: 'x' }), kind: 'unknown' },
    ];
    expect(invalidEvents.every((value) => !isEvent(value))).toBe(true);
    expect(isCheckpoint({ id: 'one', runId: 'two', sessionId: 's', containerId: 'c', summary: '', messages: [], createdAt: 1 })).toBe(false);
    expect(isResource({ id: 'r', sessionId: 's', originatingRunId: 'run', name: 'a', kind: 'text', mimeType: 'text/plain', size: 1, sha256: 'h', createdAt: 1, blob: {} })).toBe(false);
    expect(isAgentTask({ id: 't', taskId: 't', sessionId: 's', rootRunId: 'r', parentRunId: 'r', role: 'explore', prompt: 'p', status: 'unknown', createdAt: 1, updatedAt: 1, evidence: [], changedPaths: [], verificationRecords: [] })).toBe(false);
    expect(isStoredValue({ id: 'x', formatVersion: 2, updatedAt: 1, payload: {} })).toBe(false);
  });
});
