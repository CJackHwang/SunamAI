import type { AgentRole, TaskContract } from './types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';

export const VERIFICATION_RECOVERY_GUIDANCE = 'Completion blocked: the current workspace revision has not passed verification. Call run_command with mode "foreground" and run a truthful, relevant project check that exits 0 on the current workspace. The system does not restrict command names, script names, arguments, ports, or normal shell composition; choose the check that fits the task. Do not mask failures or claim an unrelated command as verification. Any later workspace mutation requires another foreground check. Then retry complete_task or return the final no-tool response.';

export type CompletionGateResult =
  | { ok: true; task: TaskContract }
  | { ok: false; task: TaskContract; message: string; phase: 'planning' | 'verifying' };

export async function evaluateCompletionGate(input: {
  task: TaskContract;
  agentRole: AgentRole;
  runtime: AgentWorkspaceRuntime;
  containerId: string;
  containerAvailable?: boolean;
  /** Whether `run_command` (the verification tool) is exposed. */
  shellAvailable?: boolean;
}): Promise<CompletionGateResult> {
  if (input.agentRole === 'root' && input.task.requiresPlan && !input.task.plan.length) {
    return { ok: false, task: input.task, message: 'Completion blocked: this non-trivial task needs a recorded execution plan. Call update_plan with the required steps, complete them, then retry completion.', phase: 'planning' };
  }
  if (input.task.plan.some((item) => item.status !== 'completed')) {
    return { ok: false, task: input.task, message: 'Completion blocked: the execution plan still has unfinished or blocked steps. Finish or resolve every plan item with update_plan, then retry completion.', phase: 'planning' };
  }

  // In a chat-only session there is no mutable workspace, so workspace-revision verification
  // does not apply — even for a recovered task that carries a stale `changedWorkspace` flag.
  if (input.containerAvailable === false || input.shellAvailable === false) {
    // run_command is the only verification tool; when it is not exposed (chat-only, or the user
    // disabled it while keeping write tools), there is no way to produce verification evidence,
    // so the gate must not block completion on it — otherwise the run deadlocks until budget.
    return { ok: true, task: input.task };
  }

  const currentRevision = await input.runtime.getWorkspaceRevision(input.containerId);
  const task = input.task.workspaceRevision === currentRevision
    ? input.task
    : { ...input.task, changedWorkspace: true, workspaceRevision: currentRevision, verified: false, verifiedRevision: -1 };

  if (input.agentRole === 'root' && task.changedWorkspace && (!task.verified || task.verifiedRevision !== currentRevision)) {
    return { ok: false, task, message: VERIFICATION_RECOVERY_GUIDANCE, phase: 'verifying' };
  }
  return { ok: true, task };
}
