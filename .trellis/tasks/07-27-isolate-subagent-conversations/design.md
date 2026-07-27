# Design: Parent/Child Agent Conversation Isolation

## Ownership and data flow

`AgentRun`, events, checkpoints, and delegated tasks remain the durable source
of truth. A transient `AgentConversationView` selects either the root timeline
or one child `runId`; it is not written into workspace metadata.

The configured page shell owns the Agent controller shared by `Sidebar` and
`Workspace`. Session history preloads lightweight child Run summaries for its
visible sessions so only child-bearing rows render a disclosure; child event
transcripts remain on demand. Workspace projects messages and per-Run streaming
state through the selected view, while root status derivation always ignores
depth-one Runs.

## Contracts

```ts
type AgentConversationView =
  | { kind: 'root' }
  | { kind: 'subagent'; sessionId: string; runId: string };
```

The controller exposes session-child loading, view selection, single-child
stop/delete, and return-to-root operations. Child transcripts reuse the
existing run-indexed 250-event page. Streaming deltas are keyed by `runId`.

New delegation uses `explore | task`. Explore children receive only bounded
read/resource/control tools. Task children receive the complete workspace,
resource, process, verification, and control toolset except subagent
orchestration, so depth remains one. Three children may run concurrently; the
existing container mutation lease serializes each write/materialize/shell
operation instead of serializing the whole child lifecycle. Persisted legacy
`implement | verify` values remain schema-valid and normalize to `task` in UI
and recovery-facing projections. The published `spawn_subagent` parameter
schema remains a top-level JSON Schema object; execution-time refinement rejects
an explore request that includes `write_scope` without exposing a union root to
providers that require object function parameters.

Each child copies `root.budget` into its own `AgentRun.budget` and receives an
independent counter guard with the same three limits. Root and sibling model
turns/tool calls therefore cannot shorten a child's allowance. This budget
isolation does not change cancellation ownership or the shared container
mutation lease; parent cancellation still stops children, and filesystem/shell
mutations remain serialized across the family.

`V3PersistenceRepository.deleteChildRun` validates that the target is a depth-1
Run and deletes the Run, run-indexed events, checkpoint, and delegated-task
record in one transaction. Resources are deliberately retained because they
are session-scoped and may be referenced by root records.

`pruneTerminalChildRuns(sessionId, keepRootRunId)` uses the existing session
Run index and deletes only depth-1 Runs from another root whose phase is
terminal. The first `spawn` in a root family invokes it before creating the new
child. Failure prevents the spawn so cleanup is never silently skipped.

For an active manual deletion, the coordinator aborts that child and awaits its
terminal promise and persistence before the repository transaction begins. The
coordinator retains its resolved in-memory notification so the live parent may
still consume the result after the durable child transcript is removed.

Child completion bypasses mandatory workspace-verification gating while keeping
truthful optional verification evidence. Root completion remains gated by its
own plan, revision, and verification state. `wait_subagents` consumes exactly
one previously unreported terminal notification from the requested family per
call; this delivery marker is coordinator-local and never writes to, cancels,
or otherwise changes any sibling Run or delegated-task status. The notification
is the structured completion report and preserves summary, evidence, changed
paths, verification records, workspace revision, usage, and blocked reason.

## UI behavior

Only history sessions with retained children use native disclosure semantics.
Plain sessions render as ordinary aligned rows with no speculative chevron.
Child labels are role plus delegated task ID, ellipsized visually with the full
ID in the title. The child context menu contains Delete only, and every parent
row reserves the same fixed action slot so hover/focus controls do not shift.
The child menu is portalled to `document.body`, sharing the ordinary sidebar
context-menu classes and viewport positioning instead of inheriting the
transformed sidebar as its fixed-position containing block.

Activating a parent summary from one of its selected child views returns to the
root projection and prevents the native disclosure toggle. Once the root is
already selected, the same summary activation uses the normal intrinsic toggle.
A pinned session replaces the leading History glyph with Pin; pin state never
adds a second leading glyph. Session generation, running, success, and failure
indicators render through one fixed status slot. The status slot, optional
disclosure chevron, and always-reserved action slot have separate geometry.

Root view renders the normal composer and RunBoard. Child view uses a dedicated
compact footer: Stop for queued/running state, Return for terminal state, and
no textarea, attachment tray, or upload control. When the selected child's own
task contains a plan, its RunBoard is rendered above the child control; no root
or sibling plan is projected into that view. RunBoard suppresses the negative
unverified badge while retaining the positive verified state.

A shared intrinsic-disclosure hook/component owns the current measured Web
Animations behavior used by tool calls, RunBoard checkpoints/children, and the
sidebar tree. Native details state and reduced-motion fallbacks remain intact.

## Compatibility and failure behavior

No persisted record shape, database version, or workspace schema changes. The
role guard accepts legacy `implement | verify` values and the new `task` value;
only the new spawn tool contract is narrowed to `explore | task`.
Existing child Run summaries appear after the history presence preload; their
event transcripts still load only after selection. A selected child that is
deleted or pruned returns to the root view. Persistence or stop failures surface
through the existing Agent persistence error channel and do not optimistically
remove the entry.

Session deletion remains the broader cancellation and transactional cleanup
boundary. Root events that mention a deleted child ID remain append-only audit
records; only the child's own event side-chain is removed.
