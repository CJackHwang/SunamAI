# Refine agent completion and verification protocol

## Goal

Make Agent runs stop when the requested outcome is genuinely complete, while preserving fail-closed verification for workspace changes. Completion failures must tell the model exactly what action can satisfy the gate instead of returning a vague revision error.

The user value is a predictable conversation: starting a server produces one final answer and leaves the service running, while code-changing tasks still cannot claim success without current-revision evidence.

## Background

- `complete_task` currently rejects a changed root task with only `Completion blocked: the current workspace revision has not passed verification.` (`src/features/agent-core/tools/controlTools.ts:60-62`). The message does not identify the required tool, foreground mode, recognized command shape, zero exit status, or the fact that later writes invalidate the pass.
- Every non-verification `shell_run`, including a successful background server start, currently sets `changedWorkspace: true` and clears verification (`src/features/agent-core/tools/processTools.ts:19-30`).
- A plain assistant response is emitted to the UI before the engine decides whether it may finish. If `requiresPlan` is true or the task is changed and unverified, the engine then injects recovery guidance and continues (`src/features/agent-core/engine.ts:462-473`). This can show a completion answer and then continue the conversation.
- The runtime deliberately advances the authoritative revision when an opaque shell process exits so delayed filesystem watch delivery cannot certify a pre-command revision (`src/features/runtime/WebContainerAgentRuntime.ts:145-170`). That safety invariant must remain intact.
- Existing project guidance requires authoritative runtime revision checks and currently says non-trivial runs finish only through `complete_task` (`.trellis/spec/frontend/agent-runtime-and-persistence.md:153-159`). This contract must be updated if guarded implicit completion is adopted.
- A prior runtime-smoke failure had the same mechanism: background commands were treated as possible workspace changes, completion was repeatedly rejected, the run exhausted its budget, and failure cleanup stopped the processes (session `019f99fb-6607-7441-9d41-1a12267469d2`).

## Requirements

### R1. Actionable verification recovery

- A completion rejection caused by missing or stale verification must explain the exact recovery sequence:
  1. use `shell_run` in `foreground` mode;
  2. run a truthful foreground check relevant to the project and task;
  3. require exit code 0 on the current workspace revision;
  4. perform verification after the final workspace write because any later mutation invalidates it;
  5. retry completion after the gate is satisfied.
- The runtime must not hardcode command names, package scripts, arguments, ports, or shell syntax as a verification whitelist. Prompt instructions own the requirement to choose relevant evidence and not mask failures.
- Verify-agent and root-agent rejection messages should share one authoritative guidance source so their instructions cannot drift.

### R2. Separate workspace mutation from runtime/process progress

- Starting or observing a background service must not by itself set the task's durable workspace-mutation flag.
- The authoritative runtime revision remains the completion and verification source of truth.
- Shell commands remain opaque mutation boundaries at process completion; the design must not allow a shell process that actually changes files to preserve stale verification.
- Runtime/process success evidence, such as an owned process ID and running status, must be usable as task progress without pretending it is a verified workspace change.

### R3. Guarded plain-response completion

- A non-empty assistant response with no tool calls is treated as a completion attempt.
- The engine may finish from that response only when the same completion state gates are satisfied: no unfinished/blocked plan items, no missing current-revision verification when workspace changes require it, and no unresolved terminal condition.
- If the gates fail, the response must not appear to the user as a completed final answer before recovery begins.
- Rejected completion attempts receive one concise, actionable recovery instruction and continue within existing model/tool budgets; no new unbounded retry loop is introduced.
- `complete_task` remains available as the preferred structured explicit completion path and continues to record supplied evidence.
- Guarded no-tool completion applies consistently to every task type once all applicable completion gates pass; it is not limited to command-only or simple tasks.

### R4. Server-start behavior

- For a request whose outcome is to start a server, a successful owned background process that remains running is sufficient runtime evidence for the Agent to produce one final answer.
- The run must finish as `completed`, not require unrelated build/test verification solely because the process was started, and must not stop the background process during successful completion.
- User cancellation, run failure, and ownership rules continue to stop only the processes covered by their existing cancellation domain.

### R5. Documentation and compatibility

- Preserve current Task/Run/Event persistence schemas unless a new durable field is demonstrably required by the design.
- Update the Agent runtime code-spec and architecture/design documentation to describe the final completion and process/revision contract.
- Preserve provider independence: completion policy stays in Agent Core, and WebContainer process/revision behavior stays behind `AgentWorkspaceRuntime`.

### R6. Mobile composer usability

- In the existing mobile layout (`max-width: 900px`), Enter inserts a newline instead of submitting the message; the visible send button remains the submission control.
- Desktop behavior remains Enter to send and Shift+Enter to insert a newline.
- The composer textarea remains vertically scrollable when content exceeds its maximum height, but its visible scrollbar is hidden across supported browsers.
- Keyboard behavior must react correctly if the viewport crosses the existing mobile breakpoint without requiring a page reload.

### R7. Prompt-governed development verification

- Any foreground `shell_run` command records its real exit status as verification evidence on the post-command authoritative revision; no command-name, script-name, argument, port, or shell-composition whitelist is allowed.
- Direct validators, custom project scripts, runtime probes, read-only inspection, and ordinary compound commands therefore work without package-script ceremony or parser exceptions.
- Relevance and truthfulness are behavioral instructions in the Agent prompt: the model must choose a check appropriate to the task, must not mask failures, and must not cite an unrelated successful command as proof.
- Background commands remain process progress rather than verification because they do not provide a terminal exit result for the current revision.

## Acceptance Criteria

- [x] When a changed workspace has not passed current-revision verification, the rejection text names `shell_run`, `foreground`, a truthful relevant check, exit code 0, final-write ordering, the absence of command/port whitelists, and the retry action.
- [x] Verify-agent and root-agent stale-verification failures use consistent actionable guidance.
- [x] Starting a background server does not automatically mark the task as a workspace mutation merely because `shell_run` was used.
- [x] A short server-start scenario can start an owned background process, return one no-tool final response, finish the run as `completed`, and keep the process alive.
- [x] A no-tool final response cannot bypass an unfinished plan or missing/stale verification for an actual workspace change.
- [x] A no-tool response that fails completion gates is not projected as a completed user-visible answer before the recovery turn.
- [x] A non-trivial task with a completed plan, durable tool/plan evidence, and current-revision verification can finish through the approved completion policy without an unnecessary extra model turn.
- [x] Later workspace mutation or failed verification still invalidates an earlier pass.
- [x] Existing cancellation, process ownership, checkpoint drift, and subagent verification behavior remain intact.
- [x] Targeted unit/runtime regressions pass, followed by `npm run check:all` because this changes release-significant Agent execution and WebContainer runtime behavior.
- [x] The Agent runtime spec and relevant design/acceptance docs match the implemented contract.
- [x] At the existing mobile breakpoint, Enter adds a newline without calling submit, and the send button still submits normally.
- [x] On desktop, Enter continues to submit and Shift+Enter continues to add a newline.
- [x] The composer textarea remains scrollable while Firefox/WebKit/Blink scrollbar chrome is visually hidden.
- [x] Mobile composer behavior has focused component coverage and applicable mobile visual/E2E coverage.
- [x] Foreground checks accept arbitrary project commands, arguments, ports, and shell composition without a runtime whitelist.
- [x] A foreground read/inspection command can refresh current-revision verification without forcing another specially named test command.
- [x] The prompt explicitly requires relevant checks, truthful evidence, non-zero failure propagation, and re-verification after later workspace mutation.

## Out of Scope

- Redesigning the task classifier beyond changes necessary for the server-start regression.
- Adding a new user-facing completion setting or manual stop/continue preference.
- Changing provider wire protocols, model-specific behavior, or persona prompts unrelated to completion instructions.
- Adding another runtime command parser or project-specific verification allowlist.
- Changing persistence database versions or migrating existing `sunam-v3` records unless implementation evidence proves it unavoidable.
- Changing desktop Enter/Shift+Enter semantics or hiding scrollbars outside the composer textarea.

## Key Decisions

- Guarded no-tool completion applies to all task types after the shared completion gates pass.
- Mobile behavior follows the repository's existing `900px` workspace breakpoint; desktop keyboard behavior is preserved.
- The parent task owns completion-protocol implementation and final integration. The mobile composer change is independently planned and verified in child task `07-26-mobile-chat-composer-input`.

## Task Map

- Parent `07-26-agent-completion-protocol`: actionable verification recovery, completion gates, shell/process mutation semantics, Agent/runtime documentation, and final integration verification.
- Child `07-26-mobile-chat-composer-input`: responsive keyboard behavior, hidden textarea scrollbar, focused component/visual coverage.

There are no unresolved product, scope, compatibility, or risk decisions blocking implementation review.

## Acceptance evidence

- Shared completion-gate unit coverage proves explicit and plain completion use the same plan/revision/verification policy and actionable recovery guidance.
- Agent-engine regressions prove premature plain drafts are withheld, verified non-trivial work completes without an extra tool turn, and server-start completion keeps the process alive.
- Component and browser coverage prove the responsive Enter behavior, IME guard, resize handling, send-button path, and hidden scrollbar style.
- Final `npm run check:all` passed on 2026-07-26.
