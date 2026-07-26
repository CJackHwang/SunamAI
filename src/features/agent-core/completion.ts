import type { AgentRole, TaskContract } from './types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';

export const VERIFICATION_RECOVERY_GUIDANCE = 'Completion blocked: the current workspace revision has not passed recognized verification. After the final workspace change, call shell_run with mode "foreground" and run a recognized non-mutating project check that exits 0 (for example: npm test, npm run typecheck, npm run lint, npm run build, or npm run check). Background commands, redirected or forced-success commands, and commands that modify files do not count. Do not change the workspace after it passes; then retry complete_task or return the final no-tool response.';

export type CompletionGateResult =
  | { ok: true; task: TaskContract }
  | { ok: false; task: TaskContract; message: string; phase: 'planning' | 'verifying' };

export async function evaluateCompletionGate(input: {
  task: TaskContract;
  agentRole: AgentRole;
  runtime: AgentWorkspaceRuntime;
  containerId: string;
}): Promise<CompletionGateResult> {
  if (input.task.requiresPlan && !input.task.plan.length) {
    return { ok: false, task: input.task, message: 'Completion blocked: this non-trivial task needs a recorded execution plan. Call update_plan with the required steps, complete them, then retry completion.', phase: 'planning' };
  }
  if (input.task.plan.some((item) => item.status !== 'completed')) {
    return { ok: false, task: input.task, message: 'Completion blocked: the execution plan still has unfinished or blocked steps. Finish or resolve every plan item with update_plan, then retry completion.', phase: 'planning' };
  }

  const currentRevision = await input.runtime.getWorkspaceRevision(input.containerId);
  const task = input.task.workspaceRevision === currentRevision
    ? input.task
    : { ...input.task, changedWorkspace: true, workspaceRevision: currentRevision, verified: false, verifiedRevision: -1 };

  if (input.agentRole === 'verify' && (!task.verified || task.verifiedRevision !== currentRevision)) {
    return { ok: false, task, message: VERIFICATION_RECOVERY_GUIDANCE, phase: 'verifying' };
  }
  if (input.agentRole === 'root' && task.changedWorkspace && (!task.verified || task.verifiedRevision !== currentRevision)) {
    return { ok: false, task, message: VERIFICATION_RECOVERY_GUIDANCE, phase: 'verifying' };
  }
  return { ok: true, task };
}
