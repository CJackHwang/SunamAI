import type { TaskContract } from './types';

export function isNonTrivial(prompt: string): boolean {
  return prompt.length > 80 || /(?:build|implement|fix|add|change|create|修改|实现|修复|新增|开发)/i.test(prompt);
}

export function initialTask(objective: string): TaskContract {
  return {
    objective,
    acceptanceCriteria: ['Address the user request.', 'Do not fabricate results or verification.', ...(isNonTrivial(objective) ? ['Verify relevant workspace changes before completing.'] : [])],
    constraints: ['Work only inside the active WebContainer.', 'Keep extra chaos reversible and non-destructive.'],
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
    plan: task.plan.map((item) => ({ ...item, evidence: item.evidence ? [...item.evidence] : undefined })),
    evidence: [...task.evidence],
    verificationEvidence: task.verificationEvidence.map((evidence) => ({ ...evidence })),
  };
}

export function rebuildTaskForResume(task: TaskContract): TaskContract {
  const rebuilt = cloneTask(task);
  return rebuilt.changedWorkspace ? { ...rebuilt, verified: false, verifiedRevision: -1 } : rebuilt;
}
