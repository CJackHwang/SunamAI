# Hooks

## Applicability

Read this leaf when creating or changing a custom hook, effect lifetime, external subscription, async hook operation, or scroll ownership.

## Required Behavior

Hooks own reusable React state/effect orchestration. They do not own the Agent state machine, IndexedDB schema, WebContainer process registry, or persistence transaction semantics.

Examples:

- `useWorkspaceSelector` adapts the external workspace store to React.
- `useAgentV2` projects persisted Agent events/runs into bounded UI state and coordinates start/resume/stop.
- `useFileSystem` exposes a root-bounded watched file browser.
- `useChatAutoScroll` contains scroll behavior that is reusable by chat UI.

### Naming and API design

- Name every custom hook `useXxx`.
- Return a small object of state and actions when consumers need several related values.
- Accept typed dependencies explicitly. Do not read unrelated globals when a dependency can be injected.
- Keep refs for mutable callback/session identity that must not trigger renders; keep user-visible state in `useState`.

### Effects and cleanup

- Effects must unregister listeners, clear timers, unsubscribe stores, and release owned resources.
- Guard async completion with current session/container identity before updating UI.
- Use `void` only when an async operation is intentionally detached and its error is handled by the promise chain or owning service.
- Avoid fixed delays for readiness. React to a concrete event, store update, or runtime state.
- Keep dependency arrays honest. If callback identity is part of an external subscription, stabilize it with `useCallback` or a ref.

### High-frequency scroll ownership

Streaming chat updates use one owner with `following`, `detached`, and `returning` modes. Automatic following and user-requested return motion are separate paths:

```ts
// Automatic token/layout updates: correct before paint and do not queue animations.
if (modeRef.current === 'following') {
  container.scrollTop = container.scrollHeight - container.clientHeight;
}

// Explicit return only: each frame reads the current target because streaming can grow it.
const liveTarget = container.scrollHeight - container.clientHeight;
container.scrollTop += (liveTarget - container.scrollTop) * easedStep;
```

- Store the current mode in a ref updated synchronously by scroll/input handlers; React state mirrors bottom-control visibility only. Keep those contracts independent: the viewport may be `detached` while the shortcut remains hidden within one quarter of the viewport height from the bottom.
- Upward wheel, touch, pointer/scrollbar, or keyboard intent detaches immediately, even inside a near-bottom threshold. Later tokens must preserve that reading position.
- Reattach only when the viewport reaches the live edge, a submission explicitly requests follow, or the user activates return-to-bottom.
- Explicit return-to-bottom uses one cancellable `requestAnimationFrame` loop. Recalculate the target and shortcut visibility on every frame, hide the shortcut once the remaining distance is at most one quarter viewport, decelerate toward the target, apply one exact final correction, and cancel on renewed user input or unmount. Reduced motion jumps directly.
- Never start a new smooth scroll for every token, message delta, ResizeObserver callback, or composer-height update. Repeated animations fight each other and can flip the bottom detector during intermediate frames.
- Do not animate reserved bottom padding independently from the correction owner. If scrollHeight changes across CSS transition frames, the hook cannot anchor each intermediate height without reintroducing churn.
- Observe the explicit rows that contribute reserved height. Avoid observing an ancestor whose overlay/expanded body animates but is intentionally excluded from the reservation.

### External store state

Subscribe through `useWorkspaceSelector`, selecting the smallest slice the component uses. The selector cache and equality function preserve identity for equal selections. Do not subscribe to the whole workspace snapshot for convenience.

`useWorkspaceActions` exposes stable actions without recreating a large action object per render. Workspace hydrate remains idempotent.

### Async errors

Convert caught values with `toErrorMessage` when details are safe and useful. Use a translated stable message when provider details could leak or are irrelevant. Never add an in-memory success fallback for failed durable operations.

## Forbidden Behavior

- A hook that directly opens IndexedDB or creates a second WebContainer singleton.
- A hook that copies repository data into another authoritative store.
- Effects that mutate workspace state without participating in persistence/revision semantics.
- Swallowed promise rejections with no visible state, retry owner, or documented best-effort rationale.

## Required Validation

- Hook tests cover cleanup, stale async completion, external-store equality, and scroll-owner behavior when applicable. Scroll tests assert near-edge upward detachment, quarter-viewport shortcut visibility while detached/returning, dynamic target growth, input cancellation, submission reattachment, final settle, and reduced motion.
- Use [Test strategy](../quality/test-strategy.md) and [Validation gates](../quality/validation-gates.md).

## Related Contracts

- [Component composition](./component-composition.md)
- [Ownership and workspace store](../state/ownership-and-workspace-store.md)
