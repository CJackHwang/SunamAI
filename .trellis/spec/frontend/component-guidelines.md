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

## Accessibility and error states

- Interactive controls require semantic buttons/links, labels, and keyboard support.
- Modal/overlay UI must restore focus, trap focus where appropriate, support Escape, and expose `role="dialog"` / `aria-modal`.
- Async failures must become visible state such as `role="alert"`; do not silently replace a failed user action with an unverified fallback.
- Loading regions use an appropriate status indication and must not leave controls active when the operation is unsafe.

References: `src/features/terminal-session/ServicePreviewOverlay.tsx`, `src/widgets/settings/SettingsModal.tsx`, `src/shared/ui/Modal.tsx`, and component tests under `tests/component`.
