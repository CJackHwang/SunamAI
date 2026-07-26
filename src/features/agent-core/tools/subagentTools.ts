import { z } from 'zod';
import { defineTool, type RegisteredTool } from './base';

export const subagentTools: RegisteredTool[] = [
  defineTool({
    name: 'spawn_subagent', description: 'Delegate a bounded independent task. Use explore for parallel research; implement and verify are serialized. Child agents cannot delegate again.',
    schema: z.object({ task_id: z.string().min(1), role: z.enum(['explore', 'implement', 'verify']), prompt: z.string().min(1).max(8_000), write_scope: z.array(z.string().min(1)).max(20).optional() }),
    readOnly: false, concurrencySafe: true, dataImpact: 'run', timeoutMs: 5_000, resultType: 'control',
    async execute(input, context) {
      if (!context.subagents) return { ok: false, content: 'Subagent delegation is unavailable for this run.' };
      const spawned = await context.subagents.spawn({ taskId: input.task_id, role: input.role, prompt: input.prompt, ...(input.write_scope ? { writeScope: input.write_scope } : {}) });
      return { ok: true, content: `Subagent ${spawned.runId} queued as ${input.role} for task ${input.task_id}.`, data: spawned };
    },
  }),
  defineTool({
    name: 'wait_subagents', description: 'Wait for delegated runs and receive structured task notifications for parent synthesis.',
    schema: z.object({ run_ids: z.array(z.string().min(1)).min(1).max(6) }), readOnly: false, concurrencySafe: false, dataImpact: 'task', timeoutMs: 5 * 60_000, resultType: 'control',
    async execute(input, context) {
      if (!context.subagents) return { ok: false, content: 'Subagent delegation is unavailable for this run.' };
      const notifications = await context.subagents.wait(input.run_ids);
      const currentRevision = await context.runtime.getWorkspaceRevision(context.containerId);
      const changedWorkspace = notifications.some((notification) => notification.changedPaths.length > 0);
      const currentVerification = notifications.find((notification) => notification.role === 'verify' && notification.status === 'completed' && notification.workspaceRevision === currentRevision && notification.verificationRecords.some((record) => record.passed && record.workspaceRevision === currentRevision));
      const failedVerification = notifications.some((notification) => notification.role === 'verify' && (notification.status !== 'completed' || notification.verificationRecords.some((record) => !record.passed)));
      context.updateTask((task) => {
        const verificationRecords = currentVerification
          ? [...task.verificationEvidence, ...currentVerification.verificationRecords.filter((record) => record.passed && record.workspaceRevision === currentRevision)]
          : task.verificationEvidence;
        return {
          ...task,
          changedWorkspace: task.changedWorkspace || changedWorkspace,
          workspaceRevision: currentRevision,
          verified: currentVerification ? true : changedWorkspace || failedVerification ? false : task.verified,
          verifiedRevision: currentVerification ? currentRevision : changedWorkspace || failedVerification ? -1 : task.verifiedRevision,
          verificationEvidence: verificationRecords,
        };
      });
      return { ok: true, content: JSON.stringify(notifications), data: notifications, changedWorkspace };
    },
  }),
  defineTool({
    name: 'message_subagent', description: 'Send a concise correction or additional fact to an active delegated run.',
    schema: z.object({ run_id: z.string().min(1), message: z.string().min(1).max(2_000) }), readOnly: true, concurrencySafe: true, dataImpact: 'run', timeoutMs: 5_000, resultType: 'control',
    async execute(input, context) { const sent = await context.subagents?.message(input.run_id, input.message) ?? false; return { ok: sent, content: sent ? 'Message delivered.' : 'Subagent is not active.' }; },
  }),
  defineTool({
    name: 'stop_subagent', description: 'Stop a delegated run owned by this root family.',
    schema: z.object({ run_id: z.string().min(1) }), readOnly: false, concurrencySafe: true, dataImpact: 'run', timeoutMs: 5_000, resultType: 'control',
    async execute(input, context) { const stopped = await context.subagents?.stop(input.run_id) ?? false; return { ok: stopped, content: stopped ? 'Subagent stop requested.' : 'Subagent is not active.' }; },
  }),
];
