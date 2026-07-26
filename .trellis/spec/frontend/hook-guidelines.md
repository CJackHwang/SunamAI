# Hook Guidelines

## Scope

Hooks own reusable React state/effect orchestration. They do not own the Agent state machine, IndexedDB schema, WebContainer process registry, or persistence transaction semantics.

Examples:

- `useWorkspaceSelector` adapts the external workspace store to React.
- `useAgentV2` projects persisted Agent events/runs into bounded UI state and coordinates start/resume/stop.
- `useFileSystem` exposes a root-bounded watched file browser.
- `useChatAutoScroll` contains scroll behavior that is reusable by chat UI.

## Naming and API design

- Name every custom hook `useXxx`.
- Return a small object of state and actions when consumers need several related values.
- Accept typed dependencies explicitly. Do not read unrelated globals when a dependency can be injected.
- Keep refs for mutable callback/session identity that must not trigger renders; keep user-visible state in `useState`.

## Effects and cleanup

- Effects must unregister listeners, clear timers, unsubscribe stores, and release owned resources.
- Guard async completion with current session/container identity before updating UI.
- Use `void` only when an async operation is intentionally detached and its error is handled by the promise chain or owning service.
- Avoid fixed delays for readiness. React to a concrete event, store update, or runtime state.
- Keep dependency arrays honest. If callback identity is part of an external subscription, stabilize it with `useCallback` or a ref.

## External store state

Subscribe through `useWorkspaceSelector`, selecting the smallest slice the component uses. The selector cache and equality function preserve identity for equal selections. Do not subscribe to the whole workspace snapshot for convenience.

`useWorkspaceActions` exposes stable actions without recreating a large action object per render. Workspace hydrate remains idempotent.

## Async errors

Convert caught values with `toErrorMessage` when details are safe and useful. Use a translated stable message when provider details could leak or are irrelevant. Never add an in-memory success fallback for failed durable operations.

## Anti-patterns

- A hook that directly opens IndexedDB or creates a second WebContainer singleton.
- A hook that copies repository data into another authoritative store.
- Effects that mutate workspace state without participating in persistence/revision semantics.
- Swallowed promise rejections with no visible state, retry owner, or documented best-effort rationale.
