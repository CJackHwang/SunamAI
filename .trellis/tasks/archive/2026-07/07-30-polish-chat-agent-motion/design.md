# Technical Design

## Overview

Implement the task as a CSS-first refinement plus three narrowly scoped UI behavior owners: imperative disclosure control, keyed sidebar layout motion, and an explicit chat-follow state machine. Keep Agent events, persistence, message paging, and workspace stores unchanged.

## Agent Activity And Message Entrance

Change the thinking sheen in `Chat.css` so the moving center band is white and carries a bounded white text glow while the base text stays legible. Account for CSS percentage background positioning being derived from the container/background size difference: use symmetric fully off-text endpoints, an explicit resting background position, and one discrete reset after the completed sweep so the final frame exactly matches the next initial frame. The effect remains text-only and layout-neutral. Reduced motion and forced colors continue to remove the animated gradient/glow and use solid text.

`Workspace` records a short-lived send-entrance request when a root prompt or queued guidance is accepted for submission. The request carries the last pre-submit projected-message identity/epoch, not persisted data. `ChatMessageList` identifies the next projected user message after that boundary and passes a one-shot entrance state to `ChatMessage`. The bubble animates from slightly below and to the right with a restrained scale/opacity settle, approximating Telegram's composer-to-thread movement. Animation completion clears the request; initial history hydration has no request and cannot replay it.

This stays inside React/UI state and avoids adding animation metadata to `Message`, Agent events, persistence schemas, or upstream model payloads.

## Automatic Child Disclosure

Refactor `useIntrinsicDisclosure` around one internal `setExpanded(next)` operation used by both click toggles and an exposed imperative open action. It keeps native `<details>/<summary>`, current measurements, WAAPI timings, rapid-reversal cancellation, scroll correction, cleanup, and reduced-motion behavior.

`SessionHistoryList` distinguishes completed child preload from later child-ID additions. Each `SessionHistoryGroup` snapshots IDs only after its initial preload is established. A later new ID for `activeSessionId` invokes the shared disclosure open action; existing historical children do not. If the user later collapses the row, the next genuinely new child may reopen it, matching the requested notification behavior.

## Pinned Row Reordering

Add one small shared layout-motion hook for keyed vertical lists. Each owner marks stable row IDs, stores the last committed bounding rectangles, measures the new sorted layout in a layout effect, and applies inverse `translateY` transforms through WAAPI before settling to zero (FLIP). Animate both the pinned row and displaced siblings, cancel stale animations on repeated changes/unmount, and skip animation on the first measurement or under reduced motion.

`SessionHistoryList` and `WorkspaceResourceList` both use the hook with an order signature so disclosure height changes do not accidentally trigger reorder motion. Store sorting and pin semantics remain untouched; unpinning naturally uses the same spatial mechanism.

## Streaming Follow State Machine

Replace the single near-bottom boolean in `useChatAutoScroll` with refs representing `following`, `detached`, and `returning`, plus minimal React state for control visibility.

- Automatic token/layout updates: while `following`, correct `scrollTop` directly before paint; never queue smooth animations per token.
- User intent: upward position changes or wheel/touch/pointer/keyboard input immediately cancel `returning` and enter `detached`, regardless of the old 100px threshold.
- Natural reattachment: only reaching the actual live-edge tolerance while moving downward/settling re-enters `following`.
- Submission: synchronously requests reattachment; remove the fixed 50ms timer so the following correction owns the newly inserted bubble.
- Explicit return: a cancellable `requestAnimationFrame` animation uses a bounded ease-out curve, recalculates the bottom target as content grows, lands with one exact final correction, then enters `following`. Reduced motion jumps immediately.

The return shortcut's visibility is deliberately independent from follow ownership. A detached viewport can remain protected from automatic scrolling while the shortcut stays hidden within one quarter of the viewport height from the bottom. During explicit return, update that visibility from the live distance on each animation frame so the control disappears before the final subpixel settle.

The hook owns animation frames and input listeners and releases both on cancellation/unmount. `Workspace` keeps its existing older/newer-page anchor correction and per-view saved positions.

## Mobile Material Compatibility

Keep `--material-blur`/`--material-blur-thick` as the shared owners. Under `max-width: 900px`, override them to a reduced regular value in the accepted `12–14px` range and `18px` thick value. Desktop tokens remain `22px`/`28px`.

Add a shared `@supports not` fallback covering both standard and WebKit backdrop-filter syntax. Unsupported surfaces use a near-opaque material tint, soft light edge, and existing restrained elevation so they read as the closest practical approximation to the blurred material. Do not override user/system `prefers-reduced-transparency` or `forced-colors` fallbacks.

## Color Tokens And FileManager

Apply the requested root token edits in `base.css`, including the user's later manual refinement of success to `#049268` and danger to `#c6071a`. Route only shared menu disabled text to `--color-text-disabled`; leave the forced-colors border token/value intact. Replace exactly five hard-coded FileManager blues with `color-mix(in srgb, var(--color-accent) <strength>, transparent)` using the existing strengths.

No React, public API, TypeScript type, or behavior change is required for the color subsection.

## Compatibility And Rollback

- No production dependency or persistence migration.
- Native disclosure and current accessible names/roles stay intact.
- Internal UI props/hooks may change only to carry ephemeral animation intent; exported domain contracts do not.
- Each behavior is file-scoped and reversible independently: sheen/message CSS, disclosure control, reorder hook, auto-scroll hook, mobile material tokens/fallback, and palette replacements.
- Mobile GPU behavior cannot be identical across all engines; the reduced token and no-filter fallback bound the known risk.

## Verification Strategy

Use hook/component tests for disclosure lifecycle, one-shot message entrance, keyed row movement/cancellation, scroll state transitions, dynamic return targets, input cancellation, and reduced motion. Use browser/visual coverage for computed material strength/fallbacks, thinking glow, mobile/desktop motion, sidebar reorder, and palette snapshots. Preserve existing Agent flow/runtime tests through the full gate.
