# Data Flow And Contracts Guide

## Use When

- a value crosses three or more owners;
- request/response shapes or environment keys change;
- several consumers parse the same payload;
- validation or fallback ownership is unclear;
- runtime/persistence/UI behavior must remain synchronized.

## Map The Flow

Write the concrete path before coding:

```text
source input
  -> boundary validation/canonicalization
  -> domain owner
  -> runtime or persistence boundary
  -> recovery/projector
  -> UI/model consumer
```

For each arrow ask:

- What exact typed shape crosses it?
- Which owner validates unknown input?
- Which errors/fallbacks are allowed, and who owns the retry budget?
- Which IDs define tenant/session/container/Run ownership?
- Does the action mutate authoritative state or only a projection?

## Common Mistakes

- Implicit format assumptions between provider, engine, store, and UI.
- Scattered validation of the same value in several layers.
- Leaky abstractions where UI imports runtime/repository implementations.
- Every consumer casts the same raw payload field locally.
- A fallback added around an existing retry owner, creating an unbounded circuit.

## Local Ownership Examples

- Agent provider wire mapping belongs to `AgentModelClient` adapters.
- Resource MIME and model-copy rules belong to `ResourceProcessorRegistry` processors.
- WebContainer files/processes/revisions belong to `AgentWorkspaceRuntime`.
- Durable records and transaction scope belong to `V3PersistenceRepository`.
- Cross-feature React composition belongs in widgets/pages, never a lower feature import.

## Follow Through

Select exact leaves from [Foundation](../../frontend/foundation/index.md), [Agent](../../frontend/agent/index.md), [State](../../frontend/state/index.md), and [Quality](../../frontend/quality/index.md) as applicable.
