# Technical Design

## 1. Scope and ownership

This change keeps the existing layer boundaries:

- `AgentEngine` owns whether a model response may terminate a Run and whether a rejected draft is projected to the UI.
- Agent control tooling owns explicit `complete_task` behavior and user/model-facing recovery text.
- `AgentWorkspaceRuntime` remains the authority for workspace revisions and owned process state.
- `shell_run` translates foreground verification, foreground opaque commands, and background service launches into task state without introducing provider-specific logic.
- `ChatComposer` owns responsive keyboard behavior; CSS owns scrollbar presentation.

No new persistence store, event kind, TaskContract field, or database migration is planned. Existing Run, tool-result, process, revision, and verification records are sufficient.

## 2. Shared completion gate

Extract one Agent-Core completion evaluator used by both `complete_task` and the plain-response branch.

Inputs:

- current `TaskContract`;
- agent role;
- authoritative runtime and container ID.

Checks, in order:

1. A non-trivial task has a recorded plan.
2. No plan item is pending, in progress, or blocked.
3. Read the authoritative current workspace revision.
4. If the runtime revision differs from `task.workspaceRevision`, treat the task as changed/unverified and return actionable verification recovery.
5. A verify-role run must have a passed recognized verification record bound to the current revision.
6. A root task with a changed workspace must have a passed verification record bound to the current revision.

The evaluator returns the normalized task state together with either success or one failure message. Callers persist the normalized task before continuing.

Structured evidence remains specific to explicit `complete_task`: its schema requires evidence and the tool appends it to `task.evidence`. Guarded implicit completion relies on the already durable plan, tool-result, verification, and process event ledger; it does not fabricate a new evidence string.

## 3. Actionable verification recovery

Define one authoritative recovery message for missing/stale verification and reuse it for root and verify roles. It states:

- call `shell_run`;
- use `mode: "foreground"`;
- run a recognized non-mutating project verification such as `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, or `npm run check`;
- require exit code 0;
- run it after the final workspace write because later mutation invalidates the pass;
- then retry `complete_task` or provide the final no-tool response again.

The message does not promise that every example exists in every workspace; the model must inspect project scripts and select the relevant recognized command.

## 4. Explicit and implicit completion flow

### Explicit `complete_task`

1. Validate structured summary/evidence input.
2. Run the shared completion evaluator.
3. On failure, return the evaluator's actionable message.
4. On success, append supplied evidence and return the existing terminal tool result.

### Plain response with no tool calls

1. Treat any non-empty assistant text as a completion attempt.
2. Run the same completion evaluator before emitting a durable assistant message.
3. If allowed, emit the assistant message once, finish the Run as `completed`, and preserve reasoning content.
4. If blocked:
   - do not append a durable `message` event for the rejected draft;
   - clear transient streaming content/reasoning so it does not remain visible as a false final answer;
   - append one concise system recovery instruction to the model transcript;
   - transition to the evaluator-appropriate recovery phase and continue inside existing budgets.

This makes completion state-based while keeping `complete_task` as the preferred structured path.

## 5. Shell/process state semantics

`shell_run` behavior is split by mode and command class:

| Shell operation | Task mutation state | Verification state | Result purpose |
| --- | --- | --- | --- |
| Recognized foreground verification | Preserve existing `changedWorkspace`; bind pass/fail to the post-command authoritative revision | Set from exit status | Certify current workspace |
| Other foreground command | Set `changedWorkspace: true` conservatively | Invalidate | Opaque command may mutate before exit |
| Background command | Preserve existing `changedWorkspace` | Invalidate any earlier pass, but do not create a new workspace-mutation claim | Record runtime/process progress |

Background mode is already documented for servers. A pure server-start task therefore remains non-mutating and can finish from a guarded plain response while the owned process stays alive.

Safety is preserved in three ways:

- filesystem watches continue to advance the authoritative revision on actual writes;
- shell process exit remains an explicit revision boundary;
- the shared completion evaluator treats any authoritative revision drift as a changed, unverified workspace even if task-local metadata lagged.

Thus a background command that exits or mutates before completion cannot silently preserve stale verification, while a long-running server is not forced through unrelated test/build verification solely because it was launched.

## 6. Server-start regression path

The real WebContainer runtime smoke flow becomes:

```text
user asks to start services
  -> model records/updates plan if required
  -> shell_run(background) returns owned running processes
  -> model completes plan
  -> model returns one no-tool final answer
  -> shared gate sees no workspace mutation/revision drift
  -> Run completes and owned background processes remain alive
```

Failure and cancellation cleanup remain unchanged: aborted or failed Runs still stop processes in their existing ownership domain.

## 7. Mobile composer child integration

The child task implements the existing `900px` breakpoint directly in `ChatComposer`:

- maintain reactive mobile state from the mounted viewport and resize events;
- ignore Enter submission while the mobile breakpoint is active so the textarea performs its native newline insertion;
- preserve desktop Enter-to-send and Shift+Enter newline behavior;
- never submit Enter during IME composition;
- keep the send button behavior unchanged;
- retain `overflow-y: auto` and hide only the textarea scrollbar using `scrollbar-width: none` plus the WebKit scrollbar pseudo-element.

No message schema, persistence, or Workspace state change is required.

## 8. Compatibility, risks, and rollback

### Compatibility

- Existing explicit `complete_task` model behavior continues to work.
- Persisted v3 records require no migration.
- Desktop composer keyboard behavior remains unchanged.
- Existing process ownership and cancellation semantics remain unchanged.

### Risks

- A rejected streamed draft could linger visually unless transient state is explicitly cleared.
- Background shell commands are opaque; revision drift must be checked at completion to prevent stale certification.
- Centralizing completion checks can subtly change error ordering; tests must lock plan-before-verification precedence.
- Viewport tests can leak global dimensions between cases; tests must restore globals/dispatch behavior.

### Rollback

- The completion evaluator can be reverted to explicit-tool-only callers without a data migration.
- Background shell classification can be reverted independently because no durable field changes.
- Composer keyboard/CSS changes are isolated to `ChatComposer`, `Chat.css`, and focused tests.
