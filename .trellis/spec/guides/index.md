# Thinking Guide Index

## Scope

Use these guides to identify risks before selecting exact code-spec leaves. Guides are not executable contracts and must not be placed in task context manifests.

## Routes

| Trigger | Read |
| --- | --- |
| Adding similar code, a helper, a constant, or a batch edit | [Code reuse](./code-reuse/index.md) |
| Changing data that crosses owners, events, persistence, runtime, or UI projections | [Cross-layer](./cross-layer/index.md) |
| Changing Agent Core, model adapters, resources, WebContainer runtime, subagents, recovery, or v3 persistence | [Sunam Agent cross-layer checklist](./sunam-agent-cross-layer-checklist.md) |

## Validation Entry Point

After using a guide, select exact implementation and quality leaves from [Frontend specs](../frontend/index.md).
