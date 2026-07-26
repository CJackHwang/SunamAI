# Agent Runtime and Persistence

## Responsibility split

- `AgentEngine` owns task progression, budgets, transcript groups, tools, completion gates, and cancellation.
- `ContextComposer` owns token budgeting, complete-round compaction, summaries, and rehydration.
- `AgentModelClient` owns provider capabilities and wire protocol.
- `AgentWorkspaceRuntime` owns WebContainer files, resources, processes, snapshots, and real revision.
- `AgentEventStore` / `V3PersistenceRepository` own durable Runs, events, checkpoints, resources, tasks, terminal history, and snapshots.
- React projects those records; it is not execution truth.

## Completion and mutation

All Agent file/materialize/shell mutations use the container mutation lease. A shell is an opaque mutation boundary and advances revision when the process finishes. Verification records bind to the post-command revision. Any later parent or child mutation invalidates the old pass.

Non-trivial Runs cannot finish with plain assistant text. They require a maintained plan, evidence, and `complete_task`; the engine rereads the current runtime revision before completion.

Agent commands use Agent-owned `shell_run`. The Agent may read a bounded user-terminal buffer but must not inject input into the user's interactive shell.

## Context and retry limits

Tool calls and matching results are indivisible transcript groups. Context compaction strips media bodies/Base64, preserves failures/writes/verification/user feedback, and rehydrates durable IDs and recent relevant file slices.

Prompt-too-long recovery is bounded to three complete-group reductions before deterministic fallback/circuit state. Identical tool calls receive one recovery hint on the third occurrence and fail on the fourth. Do not add additional “just in case” retry layers around these limits.

## Resources

The limits are eight resources per message and 50 MiB per batch; text/image/binary files have 2/10/20 MiB limits. Resource Blob data lives only in `resources`; messages/events/checkpoints store IDs.

Reads are session-scoped. MIME spoofing, invalid UTF-8 text, cross-session IDs, and unverifiable image decoding fail closed. Vision fallback occurs only for provider errors that clearly identify unsupported image/content parts.

## sunam-v3 rules

Production uses `sunam-v3` with workspace, runs, events, checkpoints, terminalHistory, snapshots, quarantine, resources, and agentTasks.

- Events are append-only and paged by stable session/run sequence.
- Checkpoints overwrite by run ID; there is at most one checkpoint per Run.
- Persisted records pass deep guards; malformed values go to quarantine.
- Run, checkpoint, terminal, and snapshot writes are independently serialized.
- Snapshot export excludes dependencies, VCS data, build/coverage/Playwright output, and caches; limits are 10,000 files/100 MiB.
- A failed snapshot preserves the previous complete snapshot and must not poison a queued follow-up.
- Deletion cancels and waits for matching root/child Runs before the transaction removes metadata and related records.

The legacy `sunam-v2` work database remains untouched. Only Local Storage setting key names retain `sunam_v2_*` for user-setting continuity.

References: `docs/agent-v2-design.md`, `src/features/agent-core/engine.ts`, `src/features/agent-core/agentFamily.ts`, `src/entities/persistence/v3Repository.ts`, and `tests/unit/v3Repository.test.ts`.
