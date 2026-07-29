# 修复移动端 PWA 与 Agent 引导协作行为

## Goal

Make the PWA behave consistently on real mobile devices while preserving the
desktop workflow, and make long-running Agent work steerable without creating
competing root runs. Child agents must be governed by their parent rather than
interacting directly with the end user.

## Confirmed Facts

- Mobile devices that report increased contrast currently hit rules that add a
  dark text-color border and remove the glass backdrop filter.
- The terminal tab effect explicitly focuses xterm after a tab switch, which
  opens the mobile keyboard without a user gesture.
- The chat composer previously disabled its textarea while the root run was
  active, and its shared send/stop button could not distinguish queued guidance
  from cancellation.
- A root run currently aborts any existing session execution before launching a
  new run; it has no queue for mid-run user guidance.
- Child runs previously called `ask_user` and ended after a plain response;
  their individual user stop control must remain available without restoring
  either of those model behaviors.

## Requirements

1. On ordinary mobile/PWA devices, floating glass controls retain their soft
   visual boundary and blur material. System forced-colors accessibility mode
   still receives a solid, high-contrast fallback.
2. Selecting a mobile terminal tab must never open the software keyboard until
   the user explicitly focuses the terminal. Desktop auto-focus remains
   available.
3. While a root Agent run is active, the composer remains editable and keeps
   its normal visual treatment. The existing shared action button shows Stop
   while the input is empty; entering text changes it to Send, which queues the
   guidance for the next model turn without aborting or launching another root
   run. Do not add a separate root stop action to the RunBoard. Attachments
   remain available only for new root runs in this iteration.
4. Child agents cannot address the end user and can reach `completed` only
   through a successful `complete_task` call. Children use `ask_parent` for
   blockers and only the root can reply. The user can still stop one selected
   child independently; parent/session cancellation remains authoritative for
   whole-family shutdown.
5. The idle "Sunam is thinking" indicator has a restrained periodic horizontal
   text sheen. While automatic context compaction is actually running, the same
   location displays a localized automatic-compaction status.
6. An assistant message containing both prose and tool calls renders both. Tool
   disclosure details have a bounded height and scroll internally.

## Acceptance Criteria

- [x] In a mobile/PWA viewport without forced-colors, glass material has a
  non-black soft border and active standard/WebKit backdrop filtering; forced
  colors has an opaque accessible fallback.
- [x] Mobile terminal navigation does not call `focus()` on xterm merely from a
  tab change; typing begins only after a user focus gesture.
- [x] During an active root run, the input stays enabled and visually normal;
  the shared action is Stop when empty and Send when text is present, with sent
  guidance persisted/displayed and delivered FIFO on the next model request.
- [x] No separate root stop action appears in RunBoard.
- [x] Child tool definitions exclude `ask_user` and expose `ask_parent`; a
  child plain final response does not complete it; child blockers are
  parent-visible and parent-message continuation works; one child can be
  stopped without cancelling siblings.
- [x] Thinking sheen, active compaction status, prose-plus-tool rendering, and
  bounded tool details have focused component/E2E coverage.
- [x] Focused component/unit coverage and the final release-significant quality
  gate pass, with inspected mobile visual coverage.

## Out Of Scope

- Injecting new attachments/resources into an already running root Agent.
- Removing root-run cancellation, browser unload, workspace deletion, or
  unrecoverable runtime-failure safeguards.
- Changing the desktop visual language beyond the shared material correction.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
