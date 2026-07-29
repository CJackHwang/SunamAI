# Implementation Plan

## 1. Shared motion owners

- [x] Extend `useIntrinsicDisclosure` with an imperative idempotent expand action while preserving the click API, native semantics, WAAPI cancellation, reduced motion, and cleanup.
- [x] Add a keyed vertical reorder/FLIP hook using stable DOM IDs, an explicit order signature, WAAPI cancellation, first-render suppression, and reduced-motion bypass.
- [x] Add focused hook tests for programmatic disclosure opening, already-open no-op, initial/historical suppression, reorder movement, rapid replacement, cleanup, and reduced motion.

## 2. Sidebar behavior

- [x] Track completed child preload separately from live child additions in `SessionHistoryList`.
- [x] Auto-open only the active current-chat row when a genuinely new child ID appears; verify that later new children reopen a manually collapsed row.
- [x] Apply keyed reorder motion to session and container lists without changing store sort/pin semantics.
- [x] Expand `SessionHistoryList`/resource component tests for initial collapse, live auto-open, manual control, pin motion, and stable accessibility.

## 3. Chat activity and user-message motion

- [x] Replace the thinking center sheen with a bounded white highlight/glow and retain readable reduced-motion/forced-colors fallbacks.
- [x] Carry an ephemeral submission entrance request from `Workspace` to `ChatMessageList`/`ChatMessage` without persisting or serializing it.
- [x] Add the restrained Telegram-like composer/right-origin bubble animation and clear it after one playback.
- [x] Prove initial history and unrelated rerenders do not replay the entrance; cover root prompts, active-run guidance, and reduced motion.

## 4. Streaming auto-scroll

- [x] Refactor `useChatAutoScroll` into following/detached/returning ownership with synchronous refs and minimal visible state.
- [x] Detach on upward/user intent inside any bottom threshold; cancel active return animation and preserve reading position during later tokens.
- [x] Reattach only at the live edge, on submission, or on the explicit control.
- [x] Replace the fixed native smooth target with a cancellable dynamic-target rAF ease-out and exact final settle; jump under reduced motion.
- [x] Separate shortcut visibility from follow ownership: show it only beyond one quarter viewport and hide it as return motion crosses back inside that threshold.
- [x] Remove ChatComposer's fixed 50ms timers and route send reattachment through the hook owner.
- [x] Preserve `Workspace` paging anchors and per-root/subagent scroll restoration.
- [x] Extend `useChatAutoScroll` tests for near-bottom upward intent, touch/wheel/keyboard cancellation, rapid/large target growth, final settle, unmount cleanup, submission, and reduced motion.
- [x] Remove the thinking sheen's cross-cycle dwell, make its loop boundary visually identical with fully off-text endpoints, and verify multiple continuous browser-rendered passes.

## 5. Mobile material compatibility

- [x] Add shared mobile regular/thick blur overrides (`12–14px` and `18px`) while retaining desktop `22px`/`28px`.
- [x] Add a standard/WebKit capability fallback that uses the closest high-opacity light material, soft highlight border, and restrained elevation.
- [x] Preserve and test `prefers-reduced-transparency` and `forced-colors` precedence.
- [x] Update computed-style/runtime assertions only where the covered viewport's intended value changes.

## 6. Global color refinement

- [x] Update the requested root tokens and add `--color-text-disabled` in `src/app/base.css`; do not touch excluded palette/material values.
- [x] Change shared menu disabled text to the new disabled token and retain the forced-colors `#8a8a90` border override.
- [x] Replace the five FileManager RGBA blues with accent-based mixes at `4%`, `8%`, `40%`, `50%`, and `80%`.
- [x] Recalculate/record requested contrast ratios and search for remaining FileManager hard-coded Apple-blue RGBA values.

## 7. Focused and visual verification

- [x] Run focused Vitest suites for `useChatAutoScroll`, `SessionHistoryList`, `ChatMessageList`, `ChatComposer`, disclosure/reorder hooks, and affected resource/menu behavior.
- [x] Run targeted browser checks for sidebar auto-expand/reorder, long/fast streaming follow, interruption, dynamic return, mobile blur, unsupported-filter fallback, reduced motion/transparency, and forced colors.
- [x] Run `npm run test:visual -- --update-snapshots`.
- [x] Inspect every changed desktop/mobile snapshot; retain only snapshots with real pixel changes.
- [x] Run `npm run test:visual` without update mode.

## 8. Final quality gate

- [x] Run `npm run check:all`.
- [x] Run `rg "rgba\\(0,\\s*122,\\s*255" src/features/file-manager/FileManager.css` and confirm no matches.
- [x] Run `git diff --check` and review the complete diff plus all changed snapshots.
- [x] If any final edit changes rendered output or behavior, rerun the narrow affected test and the required final gate before completion.

## Risk And Rollback Points

- Scroll ownership is the highest-risk behavior; keep the old hook diff isolated until dynamic-target and interruption tests pass.
- Do not accept animation tests that only assert a class; assert WAAPI/rAF calls, cancellation, final DOM state, and non-replay behavior.
- Do not update visual baselines until the rendered result is inspected.
- If unsupported-filter emulation harms contrast, roll back only the fallback block while retaining reduced mobile blur and solid accessibility fallbacks.
