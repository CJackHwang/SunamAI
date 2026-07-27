# Agent Spec Index

## Scope

Use this router for Agent execution and every contract crossing Agent Core, model adapters, WebContainer runtime, durable storage, and React projection. Select every applicable leaf; do not place this index in task context manifests.

## Routes

| Change area | Read |
| --- | --- |
| Owner selection or a new cross-layer Agent field/tool/event | [Architecture and data flow](./architecture-and-data-flow.md) |
| Model profiles, messages, provider wire data, token budgets, compaction, or reasoning deltas | [Model context and messages](./model-context-and-messages.md) |
| Resource limits, MIME validation, session isolation, model copies, or materialization | [Resources](./resources.md) |
| Canonical project roots, shell environment, file paths, or full-workspace ZIP export | [Workspace namespace](./workspace-namespace.md) |
| Mutation leases, runtime revision, verification evidence, or completion gates | [Revision, verification, and completion](./revision-verification-and-completion.md) |
| Process ownership, cross-Run management, ports, services, or forced restart | [Process lifecycle](./process-lifecycle.md) |
| Post-tool synchronization, checkpoints, watchdogs, failure projection, or resume drift | [Checkpoint and recovery](./checkpoint-and-recovery.md) |
| Delegated roles, budgets, concurrency, notifications, cancellation, or child UI | [Subagents and cancellation](./subagents-and-cancellation.md) |
| `sunam-v3` stores, guards, quarantine, deletion, pagination, or snapshots | [Persistence and snapshots](./persistence-and-snapshots.md) |

## Validation Entry Point

Use the focused tests named by each selected leaf. Release-significant Agent changes use [Validation gates](../quality/validation-gates.md).
