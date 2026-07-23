import { describe, expect, it } from 'vitest';
import { AgentEventEmitter } from '@/features/agent-core/events';
import { projectLatestTask, projectMessages, projectModelMessages, projectProgress, projectRunEvents, sanitizeToolTranscript } from '@/features/agent-core/projector';
import type { AgentEvent, AgentRun, TaskContract } from '@/features/agent-core/types';

const task: TaskContract = { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] };
const run: AgentRun = { id: 'r-1', sessionId: 's-1', containerId: 'c-1', model: 'm', persona: 'Sunam 6.9 Pron', phase: 'acting', createdAt: 1, updatedAt: 1, task, chaos: { persona: 'Sunam 6.9 Pron', styleDirective: 's', invariants: [] }, budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '' };

describe('agent event projections', () => {
  it('projects transcript, current task, run-scoped progress, and emitter sequence', async () => {
    const events: AgentEvent[] = [
      { id: 'r-1:1', kind: 'message', sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 1, message: { role: 'user', content: 'hello' } },
      { id: 'r-1:2', kind: 'progress_reported', sessionId: 's-1', runId: 'r-1', sequence: 2, createdAt: 2, message: 'first' },
      { id: 'r-1:3', kind: 'plan_updated', sessionId: 's-1', runId: 'r-1', sequence: 3, createdAt: 3, task: { ...task, objective: 'updated' } },
      { id: 'r-2:1', kind: 'progress_reported', sessionId: 's-2', runId: 'r-2', sequence: 1, createdAt: 4, message: 'other' },
    ];
    expect(projectMessages(events)).toEqual([{ role: 'user', content: 'hello' }]);
    expect(projectLatestTask(events, run)?.objective).toBe('updated');
    expect(projectLatestTask([], run)).toBe(task);
    expect(projectLatestTask([])).toBeNull();
    expect(projectRunEvents(events, 'r-1')).toHaveLength(3);
    expect(projectRunEvents(events, null)).toEqual([]);
    expect(projectProgress(events, 'r-1')).toBe('first');
    expect(projectProgress([], 'r-1')).toBeNull();

    const emitted: AgentEvent[] = [];
    const emitter = new AgentEventEmitter('s-1', 'r-1', (event) => { emitted.push(event); });
    emitter.setSequence(3);
    await emitter.start(run);
    await emitter.emit('progress_reported', { message: 'next' });
    expect(emitted.map((event) => event.id)).toEqual(['r-1:4', 'r-1:5']);
  });

  it('drops interrupted and orphaned tool protocol fragments from model history', () => {
    const assistant = { role: 'assistant' as const, content: '', tool_calls: [
      { id: 'one', type: 'function' as const, function: { name: 'a', arguments: '{}' } },
      { id: 'two', type: 'function' as const, function: { name: 'b', arguments: '{}' } },
    ] };
    const partialTool = { role: 'tool' as const, content: 'one result', tool_call_id: 'one' };
    const nextUser = { role: 'user' as const, content: 'continue' };
    expect(sanitizeToolTranscript([assistant, partialTool, nextUser])).toEqual([nextUser]);

    const secondTool = { role: 'tool' as const, content: 'two result', tool_call_id: 'two' };
    expect(sanitizeToolTranscript([assistant, partialTool, secondTool, nextUser])).toEqual([assistant, partialTool, secondTool, nextUser]);
    expect(sanitizeToolTranscript([partialTool, nextUser])).toEqual([nextUser]);
  });

  it('keeps an in-flight tool call visible in the UI while excluding it from model history', () => {
    const inFlight: AgentEvent[] = [{
      id: 'r-1:1', kind: 'message', sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 1,
      message: { role: 'assistant', content: '', reasoning_content: 'I should inspect first.', tool_calls: [{ id: 'pending', type: 'function', function: { name: 'workspace_tree', arguments: '{}' } }] },
    }];
    expect(projectMessages(inFlight)).toHaveLength(1);
    expect(projectMessages(inFlight)[0]?.reasoning_content).toBe('I should inspect first.');
    expect(projectModelMessages(inFlight)).toEqual([]);
  });
});
