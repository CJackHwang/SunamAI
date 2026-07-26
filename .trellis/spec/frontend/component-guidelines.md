# Component Guidelines

## Component shape

Use function components with an explicit local props interface. Keep rendering and UI event orchestration in components; move reusable stateful behavior to hooks and non-React domain/runtime behavior to the owning service.

`src/features/chat/ui/ChatMessage.tsx` is a focused, memoized renderer with typed props. `src/widgets/workspace/Workspace.tsx` is intentionally a widget because it composes multiple features and delegates runtime work to providers/hooks.

## Props and composition

- Prefer required props. Add an optional prop only when omission has a defined behavior.
- With `exactOptionalPropertyTypes`, conditionally spread optional props instead of passing `undefined`.
- Pass domain identifiers and typed contracts rather than concrete persistence/runtime objects unless the component explicitly owns that boundary.
- Use children or focused subcomponents for reusable composition; do not create a “configuration object” that mirrors an entire component tree.
- Use stable record IDs for keys. An index is acceptable only for a transient list with no independent identity, such as the local attachment preview currently keyed with name plus index.

## Rendering and performance

- Derive values with `useMemo` only when the derivation or identity stability matters.
- Use `memo` for repeated renderers such as `ChatMessage`, not as a blanket default.
- Keep streaming projections bounded. Chat rendering uses the current message window and an indexed tool-result projection; do not reintroduce scans over all later messages.
- Lazy-load heavy boundaries with an intentional visible fallback. Examples: `DualTerminal`, workspace, and syntax highlighting.
- Preserve `content-visibility` for historical Markdown and the fixed 250-message DOM window.

## Styling

Use colocated plain CSS and shared design tokens. Global font declarations live in `src/app/fonts.css`; only the shipped WOFF2 weights 400/500/600/700 and italic 400 may be referenced.

Nested rounded surfaces follow:

`inner radius = outer radius - padding`

Use the smaller/dominant padding axis when padding differs. Avoid visually unrelated large inner radii that break concentric wrapping.

For chat and nested tool surfaces, use symmetric padding so the horizontal inset does not look heavier than the vertical inset. The current message bubble uses 16px on all four sides, the thinking surface uses 10px, the tool disclosure uses 8px, and arguments/results use 12px. Chat message bubbles and nested tool disclosures do not draw borders; preserve hierarchy with the surface/background tokens, spacing, and concentric radii.

```css
.chat-message { padding: 16px; border: 0; }
.thinking-process { padding: 10px; }
.chat-tool { padding: 8px; }
.chat-tool-arguments, .chat-tool-result-content { padding: 12px; }
```

## Motion roles and presence

Use the shared motion tokens by interaction role:

- color, border, opacity, and hover feedback: `--motion-fast` with `ease`;
- small transforms and direct manipulation: `--motion-fast` / `--motion-base` with `--motion-snappy` or `--motion-spring`;
- panels, intrinsic size, grid rows, sidebars, and sheets: `--motion-slow` with `--motion-sheet`;
- exits: `--motion-exit`, normally shorter than the corresponding entrance.

Do not animate `font-size` to represent selection because it triggers layout and neighboring-text movement. Keep typography stable and use color, weight, and a small transform. Infinite spinners may remain linear and loading pulses may use `ease-in-out`; the global reduced-motion rule limits both.

When `usePresence(value, exitDuration)` retains a component for CSS exit motion, `exitDuration` must be at least the longest responsive exit animation. A mobile bottom sheet with a 240ms exit must not use the 160ms desktop-menu presence lifetime, or React will unmount it before the CSS animation finishes.

## Accessibility and error states

- Interactive controls require semantic buttons/links, labels, and keyboard support.
- Modal/overlay UI must restore focus, trap focus where appropriate, support Escape, and expose `role="dialog"` / `aria-modal`.
- Async failures must become visible state such as `role="alert"`; do not silently replace a failed user action with an unverified fallback.
- Loading regions use an appropriate status indication and must not leave controls active when the operation is unsafe.

## Chat composer keyboard contract

`ChatComposer` follows the workspace's existing `900px` responsive boundary. At widths of `900px` or less, plain Enter keeps the textarea's native newline behavior and the visible send button is the submission control. Above `900px`, plain Enter submits and Shift+Enter inserts a newline. Enter during IME composition never submits on either side of the breakpoint.

The mounted component must react when `window.innerWidth` crosses the breakpoint; do not read the viewport only once at module load or require a page refresh. The textarea keeps `overflow-y: auto` for long input while hiding scrollbar chrome with both `scrollbar-width: none` and a WebKit scrollbar rule. Component tests must cover desktop, mobile, IME, send-button, and resize behavior; browser coverage must assert the hidden-scrollbar style at mobile width.

## Intrinsic disclosure motion

Keep native `<details>/<summary>` semantics for expandable tool or diagnostic rows. When the collapsed and expanded intrinsic dimensions differ enough to cause a visible jump, the owning disclosure component may measure both `getBoundingClientRect()` states and animate explicit `width`/`height` values with the Web Animations API.

The disclosure contract is:

- the closed DOM starts without `open`; keyboard activation of `summary` still works;
- opening exposes `open` immediately, while closing keeps content present only until the exit animation completes;
- animation uses a non-linear easing curve and clips overflow during the size transition;
- `prefers-reduced-motion: reduce` and missing `Element.animate` switch state immediately;
- if the nearest scroll owner was already at the bottom, use direct `scrollTop = scrollHeight` correction during the user-triggered animation; wheel or touch input stops that correction;
- cancel animations, animation frames, and temporary listeners on rapid reversal and unmount.

```tsx
const start = details.getBoundingClientRect();
details.open = shouldOpen;
const end = details.getBoundingClientRect();

if (reduceMotion || typeof details.animate !== 'function') return;
if (!shouldOpen) details.open = true;
details.animate([
  { width: `${start.width}px`, height: `${start.height}px` },
  { width: `${end.width}px`, height: `${end.height}px` },
], { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
```

Do not replace semantic disclosure with a clickable `div`, animate to guessed `max-height` values, or start smooth scrolling on every animation frame. Component tests cover default state, toggle behavior, and reduced motion; a browser test must prove that the intrinsic-size animation actually starts and settles.

References: `src/features/terminal-session/ServicePreviewOverlay.tsx`, `src/widgets/settings/SettingsModal.tsx`, `src/shared/ui/Modal.tsx`, and component tests under `tests/component`.
