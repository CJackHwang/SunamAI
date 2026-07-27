# Subagents And Cancellation

## Applicability

Read this leaf when changing delegated roles/tools, provider schemas, depth/count/concurrency, budgets, wait notifications, write scopes, parent cancellation, pruning, or child UI projection.

## Required Behavior

Function tools publish object-root schemas; role-dependent constraints remain execution refinements:

```ts
const spawnSubagentSchema = z.object({
  task_id: z.string().min(1),
  role: z.enum(['explore', 'task']),
  prompt: z.string().min(1).max(8_000),
  write_scope: z.array(z.string().min(1)).max(20).optional(),
}).strict().superRefine(rejectExploreWriteScope);

interface SubagentNotification {
  runId: string;
  taskId: string; // model-visible label
  role: 'explore' | 'task';
  status: AgentTaskStatus;
  summary: string;
  evidence: string[];
  changedPaths: string[];
  verificationRecords: VerificationEvidence[];
  workspaceRevision: number;
  usage: AgentUsage;
  blockedReason?: string;
}

interface SubagentHost {
  wait(runIds: string[]): Promise<SubagentNotification[]>; // exactly one item
}

interface AgentBudget {
  maxModelTurns: number;
  maxToolCalls: number;
  maxDurationMs: number;
}
```

- Children receive compressed parent summary, Task Contract, resource manifest, authoritative revision, and explicit goal, never the parent transcript.
- Depth is 1; at most 6 children/root and 3 mixed-role lifecycles concurrently. Children cannot delegate.
- New roles are `explore | task`. Explore has bounded read/resource/control tools. Task has complete workspace/resource/process/control tools except delegation and may have `writeScope`.
- Every provider function schema has top-level JSON Schema `type: object`; never publish a root union.
- The root prompt selects explore for read-only work and task for edits/commands/verification/processes, spawning independent work before waiting.
- Each wait returns exactly one previously unreported terminal notification. It never mutates sibling Run/task status; later waits continue for remaining work.
- Child reasoning/read lifecycles may run concurrently, while all apply/materialize/shell mutations serialize through the shared container lease across root families.
- v3 reads legacy `implement | verify` roles and displays them as task; new spawn rejects them without a DB upgrade.
- Each child copies the root Run's exact three budget limits and gets an independent counter. Root/sibling consumption never reduces it.
- Delegated-task durable IDs are unique; repeated model `taskId` values are labels.
- Parent cancellation cascades to children/processes and waits for terminal persistence before the parent cancellation record.
- Root Chat/stream/latest Run/RunBoard/status filter depth zero. Child transcripts load on selection, remain read-only, and show only their own plan/RunBoard when non-empty.
- Root verification gate applies only to root. Children may report changed paths with empty truthful verification records.
- Stopping/deleting one child affects only it. Before the first spawn of a new root family, prune terminal older-family depth-one Runs only.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| `implement`, `verify`, or explore write scope requested | Reject at Zod boundary before durable task creation. |
| Published schema has union/no object root | Fail tool-definition regression. |
| Three mixed children active | Run lifecycles concurrently; serialize mutations only. |
| Fourth child queued | Start only after an active child becomes terminal. |
| One requested child completes | Return one new notification; siblings remain unchanged. |
| All requested notifications consumed | Reject already-reported instead of replaying stale data. |
| Child changes files without verification | Allow completion, report paths and empty records; root remains gated. |
| Root/sibling counter exhausted | Child retains independent full copied budget. |
| Selected child has/no local plan | Show its own RunBoard only when non-empty. |

## Forbidden Behavior

```ts
// Wrong: wait for every child.
return Promise.all(runIds.map((id) => children.get(id)!.promise));

// Correct: deliver one unreported completion.
const candidates = requestedChildren.filter((child) => !reportedRunIds.has(child.runId));
const notification = await Promise.race(candidates.map((child) => child.promise));
reportedRunIds.add(notification.runId);
return [notification];
```

```ts
// Wrong: reduced shared family counter.
new AgentEngine({ budget: reduced, familyBudget: root.getFamilyBudget() });

// Correct: exact limits, independent counter.
const budget = { ...root.budget };
new AgentEngine({
  budget,
  familyBudget: new AgentFamilyBudget(budget.maxModelTurns, budget.maxToolCalls, budget.maxDurationMs),
});
```

Do not copy parent transcripts, recurse delegation, run unleased parallel mutations, merge child events into root, or render speculative child disclosures.

## Required Validation

- Object-root schema and execution refinements; depth/count/three-way concurrency; roles/tools; legacy reads; global lease; write scope; repeated labels; exact independent budgets; one-at-a-time delivery; sibling isolation; structured fields; child failure/verification; isolated stop/delete; parent cancellation waits/stops.
- UI/component/E2E: root-only projection, child-presence preload, lazy immutable transcript, child-local plan, positive-only verification badge, read-only controls, return/disclosure behavior, and legacy role label.

## Related Contracts

- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
- [Derived and paged state](../state/derived-and-paged-state.md)
- References: `src/features/agent-core/subagentCoordinator.ts` and Agent unit/E2E tests.
