# 父子 Agent 会话隔离与临时导航

## Goal

Keep the main conversation stable while delegated Agent Runs execute. Root and
child transcripts must be independently inspectable, cancellable, and durable
without presenting child output as if it came from the user or root Agent.

## Background

The v3 runtime already persists child Runs, events, checkpoints, and delegated
tasks independently, but the React projection currently merges every message
in a session and chooses active/latest Runs without checking depth. Child user
prompts, deltas, and task state can therefore replace or pollute the root view.

## Requirements

- The root conversation displays only depth-zero Run messages, streaming
  output, active/latest Run state, task board, and session unread state.
- Each retained child Run appears beneath its parent history session as an
  immutable secondary entry labelled by role and delegated task ID.
- Selecting a child keeps the parent session active and displays only that
  child's on-demand transcript. Selecting a session or reloading returns to the
  root view.
- A child view hides the input and upload control, remains read-only, and shows
  that child's isolated plan only when one exists. Running or queued children
  expose a stop control; terminal children expose a return-to-root control.
- Stopping a child cancels only that child. Deleting an active child first
  cancels it and waits for terminal persistence; deletion failure remains
  visible and keeps the navigation entry.
- Child deletion transactionally removes its Run, events, checkpoint, and
  delegated task. It preserves root records and session-scoped resources.
- Before the first child of a new root Run starts, permanently delete terminal
  children belonging to older root Runs in the same session. Preserve active
  older children and every child in the current root family.
- Deleting a parent session continues to delete every child record through the
  existing session deletion transaction.
- New child Runs expose only two roles: `explore` is read-only and `task` has
  the complete non-delegating execution toolset. The root model is explicitly
  told which role to choose and to spawn independent work before waiting.
- Up to three children may reason and execute concurrently regardless of role.
  Workspace mutations and shell operations remain serialized by the existing
  container mutation lease.
- Every child inherits the current root Run's complete model-turn, tool-call,
  and wall-clock budget. Child budget consumption is independent from the root
  and every sibling, so one Run cannot exhaust another Run's counters.
- Child completion is not blocked by the root Run's mandatory verification
  gate. Children may still run and report truthful checks, but an unverified
  child workspace change may be returned to the root as completion evidence.
- `wait_subagents` reports one previously unreported terminal child at a time.
  Completing or inspecting one child never changes a sibling Run or delegated
  task status; the root may inspect that result and wait again for the rest.
- Each child owns its own optional plan. Child plan updates remain scoped to
  the child Run, never alter the root plan, and are visible only in that child
  conversation. Terminal notifications carry the child's structured work
  summary, evidence, changed paths, verification records, and revision state.
- Existing persisted `implement` and `verify` children remain readable and are
  presented as legacy `task` children without a database version upgrade.
- RunBoard checkpoint and child summaries are collapsed by default and use the
  same intrinsic-size disclosure motion as tool calls, including reduced-motion
  behavior and native keyboard semantics.
- User bubbles use the visibly dark-gray `--color-gray-700` token instead of
  pure black or the near-black gray-800 token.
- Child delete actions use the same viewport-level context-menu surface as
  ordinary sidebar actions and must never be positioned relative to the
  transformed sidebar.
- When a selected child is visible, activating its parent row returns to the
  root transcript without collapsing the open child list. Activating that row
  again from the root view toggles the disclosure.
- A pinned history row replaces its History icon with the Pin icon instead of
  rendering both icons and consuming an extra horizontal slot.
- Every published tool parameter schema has a top-level JSON Schema object;
  `spawn_subagent` remains compatible with providers that reject union roots.
- Session generation/running/success/failure indicators share one fixed status
  slot before disclosure and action icons, with no overlap in any state.
- RunBoard does not render an `Unverified` / `未验收` / `未検証` badge. A
  successful verification badge may still be shown when current evidence exists.
- The feature remains compatible with the current workspace and v3 schemas; no
  IndexedDB version upgrade or workspace metadata field is introduced.

## Acceptance Criteria

- [x] Child prompts, tools, deltas, and final messages never appear in the root
  chat or drive its RunBoard/session status while the child runs.
- [x] Expanding a history session reveals its retained child Runs; selecting
  different children shows only the selected `runId` transcript and status.
- [x] Child entries cannot be renamed, generated, or pinned and expose only the
  delete action with the full immutable ID available as a tooltip.
- [x] Child view controls match the running and terminal behaviors above on
  desktop and mobile, and stopping one child does not stop its parent.
- [x] Manual deletion and next-root cleanup remove exactly the intended durable
  records atomically and update the visible navigation without reload.
- [x] Current-root children remain available until manual deletion or a later
  root Run creates its first child.
- [x] Checkpoint and child disclosures animate smoothly, are borderless with
  concentric radii, and work with keyboard and reduced-motion settings.
- [x] Desktop/mobile visual baselines show no overlap or clipped long IDs and
  user bubbles render with `var(--color-gray-700)` (`#3a3a3a`).
- [x] Chinese, English, and Japanese UI strings and project architecture,
  runtime, and acceptance documentation describe the final behavior.
- [x] `npm run check:all` and `git diff --check` pass.
- [x] New delegation accepts only `explore` and `task`; three mixed-role child
  Runs can execute concurrently while mutation tools remain lease-serialized.
- [x] The root prompt explains role selection and parallel spawn-before-wait;
  legacy `implement`/`verify` records still load and display as `task`.
- [x] Child deletion opens the normal viewport-level sidebar menu on desktop
  and mobile rather than a sidebar-constrained sheet.
- [x] Returning from a child keeps its parent disclosure open; a second parent
  activation from the root view collapses it.
- [x] Pinned history rows render one Pin icon in the leading icon slot with no
  History-plus-Pin spacing regression.
- [x] `spawn_subagent` publishes `type: object` with the two-role enum while
  still rejecting legacy roles and explore write scopes at execution time.
- [x] Session red/green/loading states use one reserved status slot and remain
  geometrically separate from the disclosure and action icons.
- [x] Task children can complete after workspace changes without mandatory
  verification while the same unverified root change remains completion-blocked.
- [x] Waiting on multiple children returns one new terminal notification per
  call and never mutates the state of any sibling child.
- [x] A child-created plan appears only in that child's read-only view and does
  not change the root RunBoard or any sibling plan.
- [x] Child completion returns a structured work report to the root, including
  summary and available evidence/change/verification metadata.
- [x] RunBoard never displays the unverified label in any locale.
- [x] Each child Run persists the same budget values as its root Run and can
  consume them independently without a root/sibling family-budget failure.
