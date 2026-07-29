# Polish chat, agent motion, scrolling, and global colors

## Goal

Make SunamAI's active feedback, chat motion, sidebar reordering, streaming scroll behavior, mobile floating materials, and secondary/status colors clearer and more spatially coherent without changing product structure, Agent execution, persistence, or the established black/white/gray and Apple-blue visual direction.

## Background

- The active “Sunam 正在思考...” sheen is too dark and weak; its moving highlight should read as an obvious white glow.
- A current-chat row remains collapsed when its root Agent creates a child, so the user can miss the new Agent.
- Pinning a history conversation or container reorders the row instantly.
- Newly sent user bubbles need a restrained Telegram-like send animation.
- Streaming auto-follow currently fights upward reading gestures near the bottom, while a fixed native smooth-scroll target can fall behind long or fast output.
- Some mobile devices either do not visibly render the intended glass blur or hitch while the return-to-bottom animation settles.
- Small text, state colors, and FileManager tool-state blues need a limited contrast/token cleanup without a broader redesign.

## Confirmed Facts

- The thinking label currently uses a text-gradient sheen between secondary and normal text colors, with reduced-motion and forced-colors fallbacks at `src/features/chat/ui/Chat.css:21` and `src/features/chat/ui/Chat.css:77`.
- Sidebar sessions already use the shared native-details intrinsic-size animation, but disclosure control is click-only at `src/widgets/sidebar/SessionHistoryList.tsx:28` and `src/shared/ui/useIntrinsicDisclosure.ts:12`.
- Sessions and containers are synchronously sorted by pinned state at `src/widgets/sidebar/Sidebar.tsx:62`; both renderers have stable item IDs but no layout-transition owner at `src/widgets/sidebar/SessionHistoryList.tsx:96` and `src/features/session/ui/WorkspaceResourceList.tsx:23`.
- Every chat message currently receives the generic opacity-only `motion-fade-in` class at `src/features/chat/ui/ChatMessage.tsx:20`, and message rows use role-plus-index keys at `src/features/chat/ui/ChatMessageList.tsx:28`.
- Auto-follow uses one boolean derived from a 100px bottom threshold, then assigns `scrollTop = scrollHeight` on every streaming/content dependency update at `src/features/chat/hooks/useChatAutoScroll.ts:3` and `src/features/chat/hooks/useChatAutoScroll.ts:21`. Upward input inside that threshold is therefore overridden.
- Explicit return-to-bottom makes one native smooth-scroll call to the current fixed `scrollHeight` at `src/features/chat/hooks/useChatAutoScroll.ts:10`; later streaming growth does not extend that target.
- Keyboard and button sends schedule that same return call after a fixed 50ms delay at `src/features/chat/ui/ChatComposer.tsx:79`.
- Shared glass styles already provide standard and WebKit-prefixed backdrop filters plus reduced-transparency and forced-colors fallbacks at `src/shared/styles/effects.css:2`; existing computed-style tests cover the project browser engine, not unsupported or resource-constrained mobile engines.
- `src/features/file-manager/FileManager.css:151`, `:152`, `:202`, `:204`, and `:225` are the five production occurrences of hard-coded `rgba(0, 122, 255, …)`.
- The requested contrast ratios have been independently verified: tertiary/white `5.060:1`, tertiary/workspace background `4.566:1`, danger/white `5.384:1`, success/white `5.003:1`, and info/white `5.155:1`.
- Project motion contracts require token-based non-linear motion, reduced-motion alternatives, native disclosure semantics, cancellation on interruption, and no new motion dependency.

## Requirements

### Agent and sidebar feedback

- R1: Active agent-state text uses a clearly visible, continuously looping white highlight/glow instead of a dark highlight. Each cycle contains exactly one non-repeating sweep across the text and restarts immediately after the full pass, without changing layout or losing readable forced-colors/reduced-motion fallbacks.
- R2: When the root Agent of the currently active chat creates a new child Agent, the owning sidebar row automatically expands through the existing disclosure animation. Initial loading of historical children must not trigger automatic expansion.
- R3: Each later child creation may reopen a row the user collapsed after an earlier child; manual collapse and re-expand remain available between creation events.
- R4: Pinning an eligible history-conversation or container item animates the moved row and displaced siblings to their new positions instead of teleporting.

### Message motion and streaming scroll

- R5: A newly submitted user-authored message enters once with restrained Telegram-like motion from the composer/right-side direction into its final bubble position. Previously rendered or loaded history does not replay the send animation.
- R6: Streaming auto-follow disengages immediately when the user intentionally moves upward, including while the viewport is still near the live edge, and subsequent tokens do not change that reading position.
- R7: Auto-follow re-engages only when the user reaches the live edge, submits a new message, or activates “回到底部”. Once attached, rapid or long streaming output remains attached without a stale target.
- R8: Explicit return-to-bottom motion is interruptible, dynamically follows a growing bottom target, and ends with smooth deceleration rather than a final-frame snap or hitch on covered desktop and mobile browsers. The shortcut appears only when the viewport is more than one quarter of its own height from the bottom and hides as soon as return motion crosses back inside that threshold.
- R9: Existing history paging, per-view scroll restoration, message windowing, and Agent streaming/persistence semantics remain unchanged.

### Mobile floating material

- R10: At `900px` or less, mobile smoothness takes priority: shared regular and thick blur strength is reduced from the desktop values to approximately `12–14px` and `18px` respectively, while desktop material strength stays unchanged.
- R11: When neither standard nor WebKit backdrop filtering is supported, floating surfaces use the closest practical visual fallback: a high-opacity light material, soft highlight border, and restrained elevation rather than bare transparency or a visually unrelated fill.
- R12: Existing `prefers-reduced-transparency` and `forced-colors` behavior remains authoritative.

### Global color refinement

- R13: In `src/app/base.css`, set `--color-surface-subtle: var(--color-gray-100)`, `--color-text-tertiary: #6e6e75`, add `--color-text-disabled: #8a8a90`, set the user-refined `--color-success: #049268` and `--color-danger: #c6071a`, and set `--color-info: #006bd6`.
- R14: Shared disabled menu text uses `--color-text-disabled`; the forced-colors `#8a8a90` border override remains unchanged.
- R15: Replace the five hard-coded FileManager Apple-blue RGBA values with `color-mix()` expressions based on `--color-accent`, preserving the existing `4%`, `8%`, `40%`, `50%`, and `80%` strengths and all drag/drop, rename, and delete semantics.
- R16: Do not change `--color-bg`, primary text, link color, `--color-accent`, user-message `#3a3a3a`, shadows, or desktop material opacity.

### Cross-cutting constraints

- R17: All new spatial motion is short, token-aligned, cancellable where interactive, and reduced to immediate state or a short fade under `prefers-reduced-motion`.
- R18: No production dependency, public API, persistence schema, Agent contract, or dark-mode/theme system is added.

## Acceptance Criteria

- [x] AC1 (R1): In ordinary rendering, the active thinking label has an obvious white moving highlight/glow that loops continuously without dwelling over the text; reduced motion and forced colors show readable solid text without animation.
- [x] AC2 (R2, R3): A newly created child of the active root Agent automatically reveals itself through the native disclosure animation, while initially loaded historical children stay collapsed and later manual disclosure interaction remains functional.
- [x] AC3 (R4): Pinning a session or container visibly moves it and displaced rows to their sorted positions; rapid repeated changes cancel/replace prior layout animations cleanly.
- [x] AC4 (R5): A submitted root prompt or mid-run guidance bubble performs one Telegram-like composer-origin entrance and does not replay for loaded history, unrelated rerenders, or assistant output.
- [x] AC5 (R6): Upward wheel, touch, pointer, or keyboard scrolling immediately suspends streaming follow, even inside the old 100px zone; later tokens preserve the reading position.
- [x] AC6 (R7, R8): Reaching the live edge, submitting, or pressing “回到底部” reattaches follow; a growing stream remains attached and the explicit transition decelerates smoothly, dynamically reaches the latest bottom, and can be cancelled by renewed user input. The shortcut stays hidden inside the quarter-viewport distance and disappears during return as soon as that boundary is crossed.
- [x] AC7 (R9): Older/newer event paging and root/subagent scroll restoration continue to preserve the visible anchor.
- [x] AC8 (R10–R12): Desktop retains its current computed blur strength; covered mobile rendering uses the reduced blur tokens; unsupported, reduced-transparency, and forced-colors paths remain legible and visually intentional.
- [x] AC9 (R13, R14): Computed tokens match the requested values, disabled shared-menu text uses `--color-text-disabled`, and the existing forced-colors border override remains `#8a8a90`.
- [x] AC10 (R13): Contrast remains `5.06:1` for tertiary/white, `4.56:1` for tertiary/workspace background, `3.95:1` for the user-refined success on white, `6.09:1` for the user-refined danger on white, and at least `5.15:1` for info with white text.
- [x] AC11 (R15): `rg "rgba\\(0,\\s*122,\\s*255" src/features/file-manager/FileManager.css` returns no matches, while the five replacement mixes preserve their requested intensities and FileManager states.
- [x] AC12 (R16–R18): Unchanged palette/material contracts remain unchanged, no dependency/schema/public API is added, focused tests pass, changed visual snapshots are individually inspected, `npm run check:all` passes, and the final diff is clean.

## Out of Scope

- Redesigning Agent hierarchy, pinning semantics, message persistence, or the message paging/window model.
- Animating assistant/system bubbles or adding user-configurable animation controls.
- Changing component structure, navigation, dark mode, or the primary brand direction solely for the color refinement.
- Changing `--color-bg`, primary text, link/accent colors, the user bubble color, shadows, or desktop material transparency/blur.
- Guaranteeing identical GPU performance on mobile devices/browser engines outside available coverage.
