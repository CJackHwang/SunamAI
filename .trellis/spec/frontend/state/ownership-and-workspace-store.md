# State Ownership And Workspace Store

## Applicability

Read this leaf when deciding where state belongs or changing workspace store selection, writes, serialization, deletion, reload, or persistence error behavior.

## Required Behavior

- Local React state owns transient view concerns: open menus, selected tabs, input, loading flags, and temporary validation errors.
- The external workspace store owns shared sessions, containers, active IDs, pins, titles, and status. Components use `useWorkspaceSelector` and `useWorkspaceActions`.
- Agent event/run persistence owns execution truth. Chat messages, RunBoard state, checkpoints, and delegated tasks are durable projections, not a second global React store.
- Runtime-owned state covers WebContainer files, processes, ports, terminal buffers, snapshots, and workspace revision.
- Select the smallest needed store slice and preserve no-change short circuits.
- Ordinary saves, session/container deletion, reset, and reload share a serial queue; reload waits for pending mutations.
- Deletion first coordinates cancellation of matching Runs, then changes metadata and related durable records transactionally.
- Surface persistence errors; never claim success from an in-memory-only fallback.

References: `src/entities/workspace/store.ts`, `useWorkspaceStore.ts`, `deletionCoordinator.ts`, and `tests/unit/workspaceStore.test.ts`.

## Forbidden Behavior

- Do not duplicate workspace sessions in component context or repository records in another authoritative store.
- Do not update arrays/objects when values are unchanged.
- Do not let a deleted Run continue writing records back after deletion.
- Do not let components own runtime process/revision truth.

## Required Validation

- Unit tests prove selective notifications, no-change writes, serialization, reload ordering, cancellation-before-deletion, transactional failure, and visible errors.
- Use [Test strategy](../quality/test-strategy.md).

## Related Contracts

- [Derived and paged state](./derived-and-paged-state.md)
- [Persistence and snapshots](../agent/persistence-and-snapshots.md)
- [Hooks](../react/hooks.md)
