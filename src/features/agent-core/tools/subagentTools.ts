import { z } from 'zod';
import { defineTool, type RegisteredTool } from './base';

export const subagentTools: RegisteredTool[] = [
  defineTool({
    name: 'spawn_subagent', description: 'Delegate one bounded independent task. Choose explore for read-only investigation. Choose task when the child may edit, run commands, verify, or manage its own processes. Spawn all independent children before calling wait_subagents so up to three can run concurrently. Child agents cannot delegate again.',
    schema: z.object({
      task_id: z.string().min(1),
      role: z.enum(['explore', 'task']),
      prompt: z.string().min(1).max(8_000),
      write_scope: z.array(z.string().min(1)).max(20).optional().describe('Optional task-only workspace write scope.'),
    }).strict().superRefine((input, context) => {
      if (input.role === 'explore' && input.write_scope) context.addIssue({ code: 'custom', path: ['write_scope'], message: 'Explore subagents cannot receive a write scope.' });
    }),
    readOnly: false, concurrencySafe: true, dataImpact: 'run', timeoutMs: 5_000, resultType: 'control',
    async execute(input, context) {
      if (!context.subagents) return { ok: false, content: 'Subagent delegation is unavailable for this run.' };
      const spawned = await context.subagents.spawn({ taskId: input.task_id, role: input.role, prompt: input.prompt, ...(input.role === 'task' && input.write_scope ? { writeScope: input.write_scope } : {}) });
      return { ok: true, content: `Subagent ${spawned.runId} queued as ${input.role} for task ${input.task_id}.`, data: spawned };
    },
  }),
  defineTool({
    name: 'wait_subagents', description: 'Wait for the next previously unreported lifecycle notification among the requested delegated runs. Returns exactly one structured blocked or terminal report. When status is blocked, answer the child with message_subagent, then wait again for completion. Receiving one notification never changes sibling status.',
    schema: z.object({ run_ids: z.array(z.string().min(1)).min(1).max(6) }), readOnly: false, concurrencySafe: false, dataImpact: 'task', timeoutMs: 5 * 60_000, resultType: 'control',
    async execute(input, context) {
      if (!context.subagents) return { ok: false, content: 'Subagent delegation is unavailable for this run.' };
      const notifications = await context.subagents.wait(input.run_ids);
      const currentRevision = await context.runtime.getWorkspaceRevision(context.containerId);
      const changedWorkspace = notifications.some((notification) => notification.changedPaths.length > 0);
      const currentVerification = notifications.find((notification) => notification.role === 'task' && notification.status === 'completed' && notification.workspaceRevision === currentRevision && notification.verificationRecords.some((record) => record.passed && record.workspaceRevision === currentRevision));
      const failedVerification = notifications.some((notification) => notification.role === 'task' && notification.verificationRecords.some((record) => !record.passed));
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
    name: 'message_subagent', description: 'Send a concise correction, decision, or additional fact to an active delegated run. This resumes a child that is waiting after ask_parent.',
    schema: z.object({ run_id: z.string().min(1), message: z.string().min(1).max(2_000) }), readOnly: true, concurrencySafe: true, dataImpact: 'run', timeoutMs: 5_000, resultType: 'control',
    async execute(input, context) { const sent = await context.subagents?.message(input.run_id, input.message) ?? false; return { ok: sent, content: sent ? 'Message delivered.' : 'Subagent is not active.' }; },
  }),
];
