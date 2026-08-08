import { describe, expect, it } from 'vitest';
import { initialTask, isNonTrivial, rebuildTaskForResume } from '@/features/agent-core/task';
import type { TaskContract } from '@/features/agent-core/types';

describe('agent task classification', () => {
  it('requires plans for concise mutation, migration, audit, and verification requests', () => {
    for (const prompt of ['delete old code', '迁移数据层', '核查实现', 'run tests', 'refactor runtime']) {
      expect(isNonTrivial(prompt)).toBe(true);
      expect(initialTask(prompt).requiresPlan).toBe(true);
    }
    expect(isNonTrivial('explain this line')).toBe(false);
  });

  it('treats long requests as non-trivial regardless of keywords', () => {
    expect(isNonTrivial('x'.repeat(81))).toBe(true);
  });

  it('initialTask deep-copies the acceptance criteria and constraints', () => {
    const task = initialTask('fix the build');
    expect(task.acceptanceCriteria).toContain('Verify relevant workspace changes before completing.');
    expect(task.constraints.length).toBeGreaterThan(0);
    expect(task.plan).toEqual([]);
    expect(task.verified).toBe(false);
    expect(task.verifiedRevision).toBe(-1);
  });
});

describe('rebuildTaskForResume', () => {
  function baseTask(overrides: Partial<TaskContract> = {}): TaskContract {
    return {
      objective: 'resume me',
      acceptanceCriteria: ['a'],
      constraints: ['b'],
      requiresPlan: false,
      plan: [{ id: 'p1', title: 'step', status: 'completed', evidence: ['e1'] }],
      evidence: ['ev'],
      changedWorkspace: false,
      workspaceRevision: 3,
      verified: false,
      verifiedRevision: -1,
      verificationEvidence: [{ command: 'test', passed: true, workspaceRevision: 3, createdAt: 1 }],
      ...overrides,
    };
  }

  it('keeps an unchanged task intact and clones nested collections', () => {
    const task = baseTask();
    const rebuilt = rebuildTaskForResume(task);
    expect(rebuilt).toEqual(task);
    expect(rebuilt).not.toBe(task);
    expect(rebuilt.plan[0]).not.toBe(task.plan[0]);
    expect(rebuilt.verificationEvidence[0]).not.toBe(task.verificationEvidence[0]);
  });

  it('resets verification for a task that changed the workspace before the checkpoint', () => {
    const task = baseTask({ changedWorkspace: true, verified: true, verifiedRevision: 3 });
    const rebuilt = rebuildTaskForResume(task);
    expect(rebuilt.changedWorkspace).toBe(true);
    expect(rebuilt.verified).toBe(false);
    expect(rebuilt.verifiedRevision).toBe(-1);
  });
});

