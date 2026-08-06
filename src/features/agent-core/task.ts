import type { TaskContract } from './types';

export function isNonTrivial(prompt: string): boolean {
  return prompt.length > 80 || /(?:build|implement|fix|add|change|create|delete|remove|refactor|migrate|audit|test|check|修改|实现|修复|新增|开发|删除|迁移|重构|核查|检查|测试)/i.test(prompt);
}

export function initialTask(objective: string): TaskContract {
  return {
    objective,
    acceptanceCriteria: ['Address the user request.', 'Do not fabricate results or verification.', ...(isNonTrivial(objective) ? ['Verify relevant workspace changes before completing.'] : [])],
    constraints: ['Work only inside the active Succinix container.', 'Keep extra chaos reversible and non-destructive.'],
    requiresPlan: isNonTrivial(objective),
    plan: [],
    evidence: [],
    changedWorkspace: false,
    workspaceRevision: 0,
    verified: false,
    verifiedRevision: -1,
    verificationEvidence: [],
  };
}

function cloneTask(task: TaskContract): TaskContract {
  return {
    ...task,
    acceptanceCriteria: [...task.acceptanceCriteria],
    constraints: [...task.constraints],
    plan: task.plan.map((item) => ({ ...item, ...(item.evidence ? { evidence: [...item.evidence] } : {}) })),
    evidence: [...task.evidence],
    verificationEvidence: task.verificationEvidence.map((evidence) => ({ ...evidence })),
  };
}

export function rebuildTaskForResume(task: TaskContract): TaskContract {
  const rebuilt = cloneTask(task);
  return rebuilt.changedWorkspace ? { ...rebuilt, verified: false, verifiedRevision: -1 } : rebuilt;
}
