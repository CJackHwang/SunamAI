# Checkpoint And Recovery

## Applicability

Read this leaf when changing checkpoint shape, post-tool synchronization, watchdogs, failure projection, bounded failure persistence, resume drift, or cancellation persistence ordering.

## Required Behavior

```ts
interface AgentCheckpoint {
  id: string; // normalized to runId
  runId: string;
  sessionId: string;
  containerId: string;
  summary: string;
  messages: Message[]; // recent complete API rounds only
  createdAt: number;
  eventTailSequence?: number;
  workspaceRevision?: number;
  resourceIds?: string[];
}
```

- The complete post-tool snapshot/Run/event/checkpoint stage has an independent abort-aware watchdog covering persistence and `flushWorkspace`; the outer Run deadline is insufficient because IndexedDB/snapshot promises may ignore AbortSignal.
- Project the Run as `observing` before waiting. On timeout/error, set `run.error` and `phase = failed`, call `onRunChange` immediately, then stop only the failing Run's processes.
- Failure Run/event persistence is bounded best effort after UI projection. The timed-out operation receives an internal abort signal and checks it after every uninterruptible await so stale observing/checkpoint events cannot append later.
- Never overwrite the previous successful checkpoint from the failure path.
- Cancellation still waits for child/task terminal persistence under the parent-cancellation contract; only failure status persistence is bounded best effort.
- Resume compares checkpoint revision/tail with current durable/runtime state. Drift creates a notice and a new Run; prior reads and verification are stale.
- `awaiting_parent` is a live in-memory child coordination state. Browser/session recovery converts it to `interrupted` with the other unfinished phases; it is never recovered as a direct end-user question.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Post-tool snapshot/Run persistence hangs | Project recoverable failed, stop owned processes, bound failure writes, keep prior checkpoint. |
| Timed-out work later settles | Internal abort checks prevent stale event/checkpoint append. |
| Resume revision/tail differs | Inject drift notice and rebuild as a new Run. |
| Cancellation occurs | Preserve terminal child/task persistence ordering. |

## Forbidden Behavior

```ts
// Wrong: persistence blocks visible terminal state.
await runtime.flushWorkspace(containerId);
await store.saveRun({ ...run, phase: 'failed' });
onRunChange(run);

// Correct: project first, then bounded best effort.
run.phase = 'failed';
run.error = checkpointError.message;
onRunChange(cloneRun(run));
runtime.stopRun(exactOwnership);
await bestEffortWithin(deadline, () => store.saveRun(run));
```

Do not rely only on the model/Run timeout, let a repository hang keep React active, overwrite a good checkpoint from failure cleanup, or trust stale resume evidence.

## Required Validation

- Hanging snapshot/repository, visible failure deadline, exact process ownership, stale-write suppression, previous-checkpoint preservation, resume drift, and terminal cancellation.
- One checkpoint per Run and event-tail/revision recovery assertions use [Persistence and snapshots](./persistence-and-snapshots.md).

## Related Contracts

- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Subagents and cancellation](./subagents-and-cancellation.md)
- [Persistence and snapshots](./persistence-and-snapshots.md)
