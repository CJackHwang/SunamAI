# State Management

## State categories

Use local React state for transient view concerns: open menus, selected tabs, input text, loading flags, and temporary validation errors.

Use the external workspace store for shared sessions, containers, active IDs, pins, titles, and status. Components consume it through `useWorkspaceSelector` and mutate it through `useWorkspaceActions`.

Use Agent event/run persistence for execution truth. Chat messages, RunBoard state, checkpoints, and delegated task state are projections of durable Agent records, not a second global React store.

Use runtime-owned state for WebContainer files, processes, ports, terminal buffers, snapshots, and workspace revision.

## Workspace store rules

- Select the smallest needed slice. `Workspace.tsx` selects sessions and containers independently.
- Preserve no-change short circuits. Reapplying the same session status must not write IndexedDB or notify every subscriber.
- Ordinary saves, session/container deletion, reset, and reload share a serial queue. Reload waits for pending mutations.
- Session/container deletion first coordinates cancellation of active matching Runs, then performs metadata and related-data deletion transactionally.
- Surface persistence errors; never claim success from an in-memory-only fallback.

References: `src/entities/workspace/store.ts`, `useWorkspaceStore.ts`, `deletionCoordinator.ts`, and `tests/unit/workspaceStore.test.ts`.

## Derived and paged state

Derive UI data from current events with memoized pure projectors. The main session timeline initially loads 250 events and pages older data; the DOM remains a current 250-message window. Child transcripts load by run only when expanded.

Do not persist derived UI fields as new sources of truth unless recovery requires them. Resource metadata may be projected, while Blob data remains only in the resource store.

## State ownership anti-patterns

- Duplicating workspace sessions in component context.
- Updating arrays/objects when values are unchanged.
- Reading all event history to render the first screen.
- Treating a failed persistence write as successful local state.
- Storing Blob, File, ArrayBuffer, data URL, or attachment body in messages, events, or checkpoints.
- Letting a deleted Run continue and write records back after deletion.
