# Agent Architecture And Data Flow

## Applicability

Read this leaf before adding/changing an Agent tool, event, Run/checkpoint field, message part, model capability, resource processor, subagent role, runtime method, durable store, or completion/recovery rule.

## Required Behavior

Ownership is fixed:

- `AgentEngine`: task progression, transcript groups, budgets, tool scheduling, completion gates, and Run cancellation domain.
- `ContextComposer`: effective token budgets, complete-round compaction, fallback summaries, and rehydration.
- `AgentModelClient`: provider capabilities, token estimation/usage, multimodal wire mapping, and provider-specific fallback detection.
- `AgentWorkspaceRuntime`: WebContainer files, processes, service/port registration, resources, snapshots, mutation serialization, and authoritative revision.
- `AgentEventStore` and `V3PersistenceRepository`: durable Runs, events, checkpoints, delegated tasks, resources, terminal history, snapshots, and quarantine.
- React: projection of durable/runtime state. Page composition owns the Agent controller shared by Sidebar and Workspace; root/child view selection remains transient.

Even a one-file change traces the complete path:

```text
user/model input
  -> canonical Message / tool schema
  -> AgentEngine
  -> AgentWorkspaceRuntime or AgentModelClient
  -> event/checkpoint/resource persistence
  -> recovery projector / RunBoard
```

Extend the owning public contract; do not create parallel local payload shapes. Reliability and recoverability take priority over bundle cosmetics, but heavy configured Agent/Workspace boundaries remain lazy.

## Forbidden Behavior

- Do not put provider behavior in `AgentEngine`, IndexedDB logic in React, MIME logic outside processors, or runtime/process truth in components.
- Do not let UI state become execution, recovery, verification, or durable truth.
- Do not add a local cast/shape at one consumer when the shared contract owns the field.
- Do not introduce recursive/team/mailbox subagent systems or unleased parallel mutations without new measured evidence and an explicit contract.

## Required Validation

- Trace every changed field through creation, persistence, recovery, and UI/model consumers.
- Search all discriminated unions, guards, fixtures, projectors, and deletion paths for the changed shape.
- Use [Sunam Agent cross-layer checklist](../../guides/sunam-agent-cross-layer-checklist.md) and the focused tests in each selected Agent leaf.

## Related Contracts

- [Foundation architecture](../foundation/architecture-and-boundaries.md)
- [Model context and messages](./model-context-and-messages.md)
- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Persistence and snapshots](./persistence-and-snapshots.md)
- Product rationale: `docs/agent-v2-design.md`; acceptance evidence: `docs/refactor-acceptance.md`.
