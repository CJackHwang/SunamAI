# Improve mobile chat composer input

## Goal

Make multiline message entry natural on phones: Enter adds a new line, the send button submits, and the textarea does not display an unattractive scrollbar.

## Background

- `ChatComposer` currently prevents every unmodified Enter key and calls `onSubmit`, regardless of viewport (`src/features/chat/ui/ChatComposer.tsx:69`).
- The existing workspace mobile layout switches at `900px` (`src/widgets/workspace/Workspace.tsx:72-82` and related responsive CSS).
- The textarea uses `overflow-y: auto` with no scrollbar-hiding rules (`src/features/chat/ui/Chat.css:41`).
- Existing component coverage asserts desktop Enter submission only (`tests/component/ChatComposer.test.tsx:8-18`).

## Requirements

- At viewport widths of 900px or less, Enter must retain the textarea's native newline behavior and must not call `onSubmit`.
- At mobile widths, the existing send button must continue to submit typed text or attachments.
- Above 900px, preserve Enter to send and Shift+Enter to insert a newline.
- Keyboard behavior must update when the viewport crosses the breakpoint during the mounted session.
- Preserve IME composition behavior; composing Enter must never submit prematurely.
- Keep textarea vertical scrolling functional at its current maximum height while hiding scrollbar chrome in Firefox and WebKit/Blink.
- Do not change message persistence, Agent behavior, mobile navigation, or attachment rules.

## Acceptance Criteria

- [x] A mobile-width component test proves Enter changes the text to include a newline and does not call `onSubmit`.
- [x] A mobile-width component test proves clicking the send button calls `onSubmit`.
- [x] A desktop component test proves Enter still submits.
- [x] A desktop component test proves Shift+Enter does not submit and inserts a newline.
- [x] A composition-event regression proves Enter while composing does not submit.
- [x] A resize regression proves mounted keyboard behavior follows the current side of the 900px breakpoint.
- [x] The textarea keeps `overflow-y: auto` but hides scrollbar chrome with standards-compatible CSS.
- [x] Applicable mobile visual coverage is updated and inspected if pixels change.
- [x] Targeted tests and the parent task's final `npm run check:all` gate pass.

## Out of Scope

- Changing desktop submission conventions.
- Adding keyboard preference settings.
- Replacing the textarea or changing its 120px maximum height.
- Hiding scrollbars in message lists, tool output, task lists, or other UI surfaces.

## Parent Dependency

- This child is independent at implementation time but participates in the parent task's final integration and `npm run check:all` verification.

## Acceptance evidence

- `tests/component/ChatComposer.test.tsx` covers mobile Enter/newline, mobile send-button submission, desktop Enter, desktop Shift+Enter, IME composition, and live breakpoint resize.
- `tests/visual/app.visual.spec.ts` exercises the mobile composer via the send button and asserts `scrollbar-width: none` before the visual baseline.
- The focused mobile visual regression and final `npm run check:all` passed on 2026-07-26.
