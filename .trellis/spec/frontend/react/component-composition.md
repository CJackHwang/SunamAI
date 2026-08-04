# Component Composition

## Applicability

Read this leaf when creating or changing React component boundaries, props, repeated renderers, projections, or lazy-loading behavior.

## Required Behavior

- Use function components with an explicit local props interface.
- Keep rendering and UI event orchestration in components. Move reusable stateful behavior to hooks and non-React domain/runtime behavior to the owning service.
- Prefer required props. Add an optional prop only when omission has defined behavior; with `exactOptionalPropertyTypes`, conditionally spread optional props instead of passing `undefined`.
- Pass identifiers and typed contracts rather than concrete persistence/runtime objects unless the component owns that boundary.
- Use focused subcomponents or children for composition. Use stable record IDs for keys; an index is acceptable only for a transient list with no independent identity.
- Derive with `useMemo` only when cost or identity stability matters. Use `memo` for repeated renderers such as `ChatMessage`, not by default.
- Keep streaming projections bounded. Chat uses the current message window and indexed tool-result projection; historical Markdown keeps `content-visibility` and a fixed 250-message DOM window.
- Lazy-load heavy boundaries with visible fallbacks, including `ComputerView`, Workspace, and syntax highlighting.

Local patterns: `src/features/chat/ui/ChatMessage.tsx` is a focused memoized renderer. `src/widgets/workspace/Workspace.tsx` is a widget because it composes multiple features and delegates runtime work.

## Forbidden Behavior

- Do not create configuration objects that mirror an entire component tree.
- Do not import runtime or persistence implementations merely to render their state.
- Do not scan all later messages during each streaming render.
- Do not apply memoization or eager imports as blanket defaults.

## Required Validation

- Component tests cover rendered behavior and interactions at the owning boundary.
- Performance-sensitive changes prove bounded projections and preserve intentional lazy chunks.
- Use [Test strategy](../quality/test-strategy.md) and [Validation gates](../quality/validation-gates.md).

## Related Contracts

- [Hooks](./hooks.md)
- [State ownership and workspace store](../state/ownership-and-workspace-store.md)
- [Architecture and boundaries](../foundation/architecture-and-boundaries.md)
