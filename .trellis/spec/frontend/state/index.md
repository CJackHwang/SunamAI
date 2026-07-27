# State Spec Index

## Scope

Use this router for React-local state, the external workspace store, persisted execution truth, and bounded projections.

## Routes

| Change area | Read |
| --- | --- |
| State ownership, workspace store writes, serialization, deletion, or persistence errors | [Ownership and workspace store](./ownership-and-workspace-store.md) |
| Locale-dependent default session/container names | [Localized creation defaults](./localized-creation-defaults.md) |
| Event paging, child/root projections, memoized derived state, or DOM windows | [Derived and paged state](./derived-and-paged-state.md) |

## Validation Entry Point

Use [Test strategy](../quality/test-strategy.md) and the applicable gate from [Validation gates](../quality/validation-gates.md).
