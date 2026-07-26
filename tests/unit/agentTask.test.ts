import { describe, expect, it } from 'vitest';
import { initialTask, isNonTrivial } from '@/features/agent-core/task';

describe('agent task classification', () => {
  it('requires plans for concise mutation, migration, audit, and verification requests', () => {
    for (const prompt of ['delete old code', '迁移数据层', '核查实现', 'run tests', 'refactor runtime']) {
      expect(isNonTrivial(prompt)).toBe(true);
      expect(initialTask(prompt).requiresPlan).toBe(true);
    }
    expect(isNonTrivial('explain this line')).toBe(false);
  });
});
