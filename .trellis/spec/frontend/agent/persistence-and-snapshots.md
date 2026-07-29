# Persistence And Snapshots

## Applicability

Read this leaf when changing `sunam-v3` stores, record guards, sanitizers, event/checkpoint pagination, quarantine, child/session/container deletion, workspace serialization, or recovery snapshots.

## Required Behavior

`V3PersistenceRepository` is the only production IndexedDB facade. It owns stable session/Run event pages, one checkpoint per Run, session-scoped resources, delegated tasks, revision-bearing snapshots, quarantine, and transactional deletion.

- Production opens only `sunam-v3`; never open, migrate, delete, or fall back to `sunam-v2`. Local Storage keys may remain `sunam_v2_*` for settings continuity.
- Stores are `workspace`, `runs`, `events`, `checkpoints`, `terminalHistory`, `snapshots`, `quarantine`, `resources`, and `agentTasks`.
- Events are append-only. Stable session and Run pages are capped at 250 records.
- Checkpoints overwrite by `runId`; one Run cannot accumulate transcript copies.
- Terminal child deletion atomically removes its Run, Run events, checkpoint, and delegated task while preserving root records and session-scoped resources. Active, `awaiting_user`, or `awaiting_parent` children reject individual deletion; parent/session cancellation is the broader live-family boundary.
- Run, Event, Checkpoint, Message, Resource, and delegated-task payloads pass deep guards. Invalid raw values enter quarantine and return an issue.
- Sanitizers recursively remove Blob, File, ArrayBuffer, data URLs, long Base64, and secrets from Runs/events/checkpoints.
- Ordinary saves, reset, and session/container deletion share the workspace serialization queue. Deletion cancels/waits for matching Runs, then updates metadata and related records in one transaction.
- Snapshot export excludes dependencies, VCS, build/coverage/Playwright output, and caches, then sanitizes the tree. Limits are 10,000 files and 100 MiB; overflow/failure preserves the previous complete snapshot.
- Full-workspace ZIP is a separate user export and never reuses snapshot exclusions/caps.
- `sunam-v3` is an intentional clean-workspace boundary. Old work data is preserved outside production access but not imported.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Deep validation fails | Quarantine raw record and return issue; never coerce or memory-fallback. |
| Delete transaction fails | Surface persistence error; do not report durable success. |
| Snapshot exceeds cap/write fails | Preserve previous complete snapshot; queued follow-up remains runnable. |
| Child deleted | Atomically remove child-owned records and preserve root/resources. |
| Session/container deleted | Cancel/wait matching Runs and commit scoped deletion transactionally. |

## Forbidden Behavior

- Do not open v2 "just in case", silently fall back to memory, or persist unsafe transport bodies/secrets.
- Do not split logically atomic deletion across independent writes.
- Do not overwrite the last complete snapshot with partial/oversized output.
- Do not apply snapshot exclusions to explicit full-workspace ZIP.

## Required Validation

- One checkpoint/Run; stable 250-event session and Run pagination; latest sequence; deep quarantine; sanitizer; transaction scope; atomic child deletion/pruning; shared-resource survival; snapshot cap/failure/queued follow-up.
- Isolation tests may create old v2 data only through raw IndexedDB APIs; production modules never import/open it.

## Related Contracts

- [Resources](./resources.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
- [Workspace namespace](./workspace-namespace.md)
- [State ownership and workspace store](../state/ownership-and-workspace-store.md)
- References: `src/entities/persistence/v3Repository.ts` and `tests/unit/v3Repository.test.ts`.
