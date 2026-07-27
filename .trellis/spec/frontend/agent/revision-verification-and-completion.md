# Revision Verification And Completion

## Applicability

Read this leaf when changing workspace mutations, authoritative revision, shell evidence, verification invalidation, plan gates, `complete_task`, or plain-response completion.

## Required Behavior

```ts
interface ShellRunRequest {
  command: string;
  containerId: string;
  sessionId: string;
  runId: string;
  mode: 'foreground' | 'background';
  timeoutMs?: number;
  signal?: AbortSignal;
}

function evaluateCompletionGate(input: {
  task: TaskContract;
  agentRole: AgentRole;
  runtime: AgentWorkspaceRuntime;
  containerId: string;
}): Promise<CompletionGateResult>;
```

- `apply_patch`, `materialize_resource`, and `shell_run` use the container mutation lease.
- `TaskContract.workspaceRevision` is progress metadata. `AgentWorkspaceRuntime.getWorkspaceRevision()` is authoritative for checkpoints, recovery drift, child notifications, and completion.
- Shell exit is an explicit revision boundary because filesystem watchers may lag.
- Verification evidence binds to the post-command revision. Any later parent/child mutation or failed child verification invalidates the pass.
- Every foreground shell records real exit pass/fail on the post-command revision. Background shell is process progress: it preserves the existing mutation flag but invalidates prior verification; actual revision drift still marks changed/unverified.
- `complete_task` is the preferred structured path. Every non-empty plain response is also a completion attempt and passes the same plan/revision/verification gates.
- Immediately before completion, flush/read authoritative revision. Rejected plain drafts never enter durable/UI messages; clear transient output, inject one actionable recovery instruction, and continue within existing budgets.
- Recovery names foreground `shell_run`, a truthful relevant check, exit code 0, final-write ordering, and retry action.
- Runtime never parses/whitelists command names, scripts, arguments, ports, redirects, or shell composition. The prompt owns relevance, unmasked failure, and re-verification instructions.
- Current-revision verification gates root completion only. Depth-one children may complete with unverified changes while reporting truthful optional evidence.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Verification revision differs from runtime | Mark unverified and require new evidence. |
| Arbitrary foreground command | Record real exit on post-command revision without parsing syntax. |
| Foreground exits non-zero/times out | Record failure and invalidate prior pass. |
| Plain completion has unfinished plan/stale verification | Withhold draft, clear transient output, recover actionably. |
| Background server starts with unchanged revision | Record process progress and allow guarded completion with service alive. |
| Model uses forced success/unrelated evidence | Prompt/evidence violation; runtime still records actual terminal result. |

## Forbidden Behavior

```ts
// Wrong: task-local counters authorize completion.
if (task.verifiedRevision === task.workspaceRevision) finish();

// Correct: runtime revision is authoritative.
await runtime.flushWorkspace(containerId);
const revision = await runtime.getWorkspaceRevision(containerId);
if (task.verifiedRevision !== revision) requireVerification();
```

Do not hardcode known verification commands, mask failing exits, project rejected drafts, apply the root gate to every child, or bypass root verification.

## Required Validation

- Explicit/plain completion share plan/revision ordering; root-only verification; arbitrary command/port/syntax; failure and later-write invalidation; rejected draft absence; actionable recovery; server remains alive; authoritative drift blocks.
- Real runtime tests prove shell-exit revision synchronization where implementation changes the WebContainer boundary.

## Related Contracts

- [Process lifecycle](./process-lifecycle.md)
- [Subagents and cancellation](./subagents-and-cancellation.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
