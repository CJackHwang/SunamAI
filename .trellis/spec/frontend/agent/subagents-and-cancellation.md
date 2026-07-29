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
  wait(runIds: string[]): Promise<SubagentNotification[]>; // exactly one blocked or terminal lifecycle notification
  message(runId: string, message: string): Promise<boolean>;
  stop(runId: string): Promise<boolean>; // React/user control, never a model tool
  stopAll(): Promise<void>;
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
- Each wait returns exactly one previously unreported lifecycle notification. A child `ask_parent` call returns `status: blocked` while the child remains alive; the root replies through `message_subagent`, then waits again for that child's terminal notification. It never mutates sibling Run/task status.
- Child reasoning/read lifecycles may run concurrently, while all apply/materialize/shell mutations serialize through the shared container lease across root families.
- v3 reads legacy `implement | verify` roles and displays them as task; new spawn rejects them without a DB upgrade.
- Each child copies the root Run's exact three budget limits and gets an independent counter. Root/sibling consumption never reduces it.
- Delegated-task durable IDs are unique; repeated model `taskId` values are labels.
- Parent cancellation cascades to children/processes and waits for terminal persistence before the parent cancellation record.
- Root Chat/stream/latest Run/RunBoard/status filter depth zero. Child transcripts load on selection, remain read-only, and show only their own plan/RunBoard when non-empty.
- Root verification gate applies only to root. Children may report changed paths with empty truthful verification records.
- Children never receive `ask_user`, cannot address the end user, cannot complete from a plain response, and expose `ask_parent` only to delegated roles. The root never receives `ask_parent` in its published tool set.
- Individual child stopping is absent from model tools but available through the public React controller and the selected running-child footer. It cancels only that child and its owned processes; siblings continue. Active or `awaiting_parent` child deletion still fails closed. Parent/session cancellation, runtime failure safety, unload recovery, and terminal older-family pruning remain authoritative whole-family boundaries.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| `implement`, `verify`, or explore write scope requested | Reject at Zod boundary before durable task creation. |
| Published schema has union/no object root | Fail tool-definition regression. |
| Three mixed children active | Run lifecycles concurrently; serialize mutations only. |
| Fourth child queued | Start only after an active child becomes terminal. |
| One requested child completes | Return one new notification; siblings remain unchanged. |
| Child calls `ask_parent` | Persist `blocked`, return one blocker notification to the root, keep the child execution waiting, and resume the same Run only after `message_subagent`. |
| Child returns plain assistant text | Persist/project it as child transcript progress and continue; do not mark the Run/task completed. |
| User stops one active or `awaiting_parent` child | Cancel only that child and its owned processes; leave siblings and the parent alive. |
| All requested notifications consumed | Reject already-reported instead of replaying stale data. |
| Child changes files without verification | Allow completion, report paths and empty records; root remains gated. |
| Root/sibling counter exhausted | Child retains independent full copied budget. |
| Selected child has/no local plan | Show its own RunBoard only when non-empty. |

## Forbidden Behavior

```ts
// Wrong: wait for every child.
return Promise.all(runIds.map((id) => children.get(id)!.promise));

// Correct: deliver one unreported lifecycle notification.
const notification = requestedChildren
  .map((child) => child.notifications.shift())
  .find(Boolean);
if (notification) return [notification];
await waitForNextLifecycleNotification();
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

Do not copy parent transcripts, recurse delegation, run unleased parallel mutations, merge child events into root, render speculative child disclosures, expose `ask_user` or a self-stop model tool to a child, or treat a child plain response as completion.

## Required Validation

- Object-root schema and execution refinements; depth/count/three-way concurrency; roles/tools; legacy reads; global lease; write scope; repeated labels; exact independent budgets; one-at-a-time blocked/terminal delivery; same-child blocker then completion; isolated child stop; sibling isolation; structured fields; child failure/verification; active delete rejection; parent cancellation waits/stops.
- UI/component/E2E: root-only projection, child-presence preload, lazy immutable transcript, child-local plan, positive-only verification badge, read-only controls, running-child Stop/terminal Return footer, no unfinished-child action menu, `ask_parent -> message_subagent -> complete_task`, and legacy role label.

## Scenario: Parent-only child coordination

### 1. Scope / Trigger

Use this contract whenever child tools, lifecycle notifications, completion, cancellation, deletion, or child-facing UI changes. It prevents a delegated Agent from becoming a second user-facing conversation owner.

### 2. Signatures

```ts
type AgentPhase = /* existing phases */ | 'awaiting_parent';
type AgentToolResult = { stopRun?: 'completed' | 'awaiting_user' | 'awaiting_parent'; /* ... */ };

interface SubagentHost {
  wait(runIds: string[]): Promise<SubagentNotification[]>;
  message(runId: string, message: string): Promise<boolean>;
  stop(runId: string): Promise<boolean>; // user-facing controller only
  stopAll(): Promise<void>; // parent/session safety
}
```

### 3. Contracts

- Child tool policy contains `ask_parent` and excludes `ask_user`, delegation tools, and individual stop.
- The selected child UI exposes Stop while the child is active or `awaiting_parent`, then replaces it with Return after a terminal state.
- `ask_parent({ question })` persists `blocked`, publishes exactly one root-consumable notification, and waits without resolving the child terminal promise.
- `message_subagent({ run_id, message })` appends a parent coordination system message and resumes the same waiting child Run.
- Only successful child `complete_task` produces `completed`; ordinary assistant text is progress.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Root calls `ask_parent` | Reject as role-ineligible. |
| Child calls `ask_user` or stop | Tool absent/rejected before execution. |
| User stops one selected child | Cancel that child without cancelling a sibling or the parent. |
| Parent waits after blocker | Return the later terminal notification, not the old blocker again. |
| User deletes unfinished child | Return false and preserve durable records/execution. |
| Parent/session cancels family | Abort waiting children and await terminal persistence. |

### 5. Good/Base/Bad Cases

- Good: child asks parent, root receives `blocked`, replies, child completes explicitly.
- Base: child completes directly with `complete_task`; one terminal notification is returned.
- Bad: child plain text or direct user question marks delegated work complete.

### 6. Tests Required

- Unit: role tool lists, child plain-response continuation, blocker then terminal notification, duplicate-report rejection, isolated child stop, and waiting-child parent cancellation.
- Component: active-child Stop/terminal Return footer and no delete action for active/`awaiting_parent` children.
- E2E: child tools exclude `ask_user`; the root receives blocker JSON, sends `message_subagent`, and observes later explicit completion without a user-facing child prompt.

### 7. Wrong vs Correct

```ts
// Wrong: resolve the only child promise on ask_parent; later completion is lost.
child.resolve(blockedNotification);

// Correct: enqueue a lifecycle notification while terminalPromise stays pending.
child.notifications.push(blockedNotification);
notifyRootWaiters();
```

## Related Contracts

- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
- [Derived and paged state](../state/derived-and-paged-state.md)
- References: `src/features/agent-core/subagentCoordinator.ts` and Agent unit/E2E tests.
