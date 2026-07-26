# Implementation Plan

## 1. Completion gate and recovery guidance

- [x] Add one Agent-Core completion evaluator and shared actionable verification guidance.
- [x] Preserve plan-gate ordering and normalize authoritative revision drift into changed/unverified task state.
- [x] Refactor `complete_task` to use the shared evaluator while retaining structured evidence persistence.
- [x] Update root and verify-role unit assertions to require the actionable recovery details.

Primary files:

- `src/features/agent-core/tools/controlTools.ts`
- new Agent-Core completion helper near `engine.ts` / `tools/`
- `tests/unit/agentTools.test.ts`

## 2. Guarded no-tool completion

- [x] Evaluate completion before projecting a final plain assistant message.
- [x] Finish all task types from plain text when applicable plan/revision/verification gates pass.
- [x] Withhold rejected drafts from durable/UI message projection, clear transient streaming state, and inject one bounded recovery instruction.
- [x] Preserve final reasoning content on accepted plain completion.
- [x] Add regressions for accepted verified non-trivial completion, rejected unverified completion, no duplicate false-final message, and preserved budget behavior.

Primary files:

- `src/features/agent-core/engine.ts`
- `tests/unit/agentEngine.test.ts`
- `src/features/agent-core/useAgentV2.ts` only if transient clearing cannot be expressed through the existing event path

## 3. Background process versus workspace mutation

- [x] Make foreground `shell_run` record real exit evidence on the post-command revision while background service launches preserve the existing mutation flag.
- [x] Invalidate earlier verification on background launch without forcing a pure runtime-only task into workspace verification.
- [x] Ensure authoritative revision drift detected during completion becomes changed/unverified state.
- [x] Add tool regressions for background process progress, arbitrary foreground checks, failed-exit invalidation, earlier-pass invalidation, and drift blocking.
- [x] Update the real WebContainer runtime smoke fixture to finish from one guarded no-tool answer while the server/processes remain alive.

Primary files:

- `src/features/agent-core/tools/processTools.ts`
- `src/features/runtime/WebContainerAgentRuntime.ts` only if evidence shows the existing revision boundary is insufficient
- `tests/unit/agentTools.test.ts`
- `tests/unit/agentEngine.test.ts`
- `tests/unit/webcontainerRuntime.test.ts` if the runtime contract changes
- `tests/runtime/webcontainer.smoke.spec.ts`

Rollback point: keep the runtime's existing shell-exit revision bump unless a targeted failing test proves it must change.

## 4. Mobile composer child task

- [x] Start and implement child task `07-26-mobile-chat-composer-input` after its PRD review is covered by the parent planning approval.
- [x] Add responsive mobile-state handling at the existing 900px breakpoint.
- [x] Make mobile Enter insert a newline; retain desktop Enter submit and Shift+Enter newline.
- [x] Guard IME composition from premature submission.
- [x] Hide textarea scrollbar chrome while keeping vertical scrolling.
- [x] Add focused component tests for mobile, desktop, resize, button submission, and composition.
- [x] Update/inspect applicable mobile visual coverage.

Primary files:

- `src/features/chat/ui/ChatComposer.tsx`
- `src/features/chat/ui/Chat.css`
- `tests/component/ChatComposer.test.tsx`
- `tests/visual/app.visual.spec.ts` only if fixture changes are needed to expose the visual state

## 5. Documentation and executable contracts

- [x] Update `.trellis/spec/frontend/agent-runtime-and-persistence.md` to define guarded implicit completion and background process semantics.
- [x] Update `docs/agent-v2-design.md` with the completion flow and actionable verification contract.
- [x] Update `docs/refactor-acceptance.md` with regression evidence/criteria.
- [x] Keep the parent and child PRDs synchronized with any implementation-level discovery that changes observable behavior.

## 6. Validation sequence

- [x] Run focused component tests:
  - `npm test -- tests/component/ChatComposer.test.tsx`
- [x] Run focused Agent/runtime unit tests:
  - `npm test -- tests/unit/agentTools.test.ts tests/unit/agentEngine.test.ts tests/unit/webcontainerRuntime.test.ts`
- [x] Run the real WebContainer smoke regression:
  - `npm run test:runtime -- tests/runtime/webcontainer.smoke.spec.ts`
- [x] Run applicable mobile visual coverage and inspect changed baselines:
  - `npm run test:visual -- tests/visual/app.visual.spec.ts`
- [x] Run `npm run check` during iteration.
- [x] Run final release-significant gate: `npm run check:all`.
- [x] Run `git diff --check` and inspect the complete diff for schema drift, hidden retries, stale docs, or accidental visual baseline changes.

## 7. Final integration gate

- [x] Confirm the child task is complete and linked in the parent task metadata.
- [x] Confirm explicit and implicit completion both obey the same plan/revision/verification evaluator.
- [x] Confirm the server-start flow ends once, remains `completed`, and keeps its owned background process alive.
- [x] Confirm real workspace mutation still fails closed until current-revision verification passes.
- [x] Confirm mobile Enter/newline and hidden-scrollbar behavior do not alter desktop submission.

## Verification evidence

- `npm run check:all` passed on 2026-07-27: 36 test files / 189 tests, 7 E2E tests, 4 visual tests, 3 real WebContainer runtime tests, production build, bundle limits, and production dependency audit.
- Coverage: statements 91.33%, branches 83.17%, functions 90.51%, lines 95.21%.
- Mobile visual regression includes a browser assertion that `.chat-input` computes `scrollbar-width: none`; the baseline passed without an update.
- The real WebContainer server-start smoke completes from one no-tool response and preserves the owned background processes.

## 8. Verification ergonomics follow-up

- [x] Remove runtime command-name, script-name, argument, port, and shell-syntax verification whitelists.
- [x] Record every foreground shell exit status against the post-command authoritative revision.
- [x] Keep background processes separate from verification evidence.
- [x] Move relevance, failure propagation, and anti-fake-evidence requirements into the Agent prompt.
- [x] Add/update executable specs and acceptance documentation.
- [x] Run focused regressions and the final `npm run check:all` gate.

## 9. Cross-run process lifecycle follow-up

- [x] Add `process_list` for root-visible processes in the current session/container.
- [x] Resolve observe/input/stop through the registry entry's original exact ownership.
- [x] Keep other sessions/containers hidden and delegated roles Run-scoped/tool-restricted.
- [x] Rename shell output from ambiguous `PID` to `Agent process ID` and instruct the model not to kill registered services by port.
- [x] Make explicit process stop advance/flush the exit revision exactly once and synchronize task state.
- [x] Add unit regressions for earlier-Run access and scope isolation.
- [x] Add a real WebContainer regression that starts a service, completes the first Run, then lists/stops it from a follow-up Run.
- [x] Run the final focused checks and `npm run check:all`, then refresh verification evidence.
