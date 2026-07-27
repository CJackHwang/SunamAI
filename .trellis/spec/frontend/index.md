# Frontend Spec Index

## Scope

Use this router for SunamAI production code, tests, and executable frontend contracts. Task context manifests reference exact leaves selected below, never this index.

## Routes

| Change area | Read |
| --- | --- |
| Dependency graph, source placement, public boundaries, or TypeScript validation | [Foundation](./foundation/index.md) |
| React components, hooks, styling, motion, interaction, accessibility, disclosures, or action menus | [React](./react/index.md) |
| Workspace state, persistence-facing store behavior, localized defaults, or paged projections | [State](./state/index.md) |
| Agent Core, model context, resources, WebContainer runtime, completion, processes, subagents, or v3 durability | [Agent](./agent/index.md) |
| Validation gates, test placement, failure policy, or final review | [Quality](./quality/index.md) |

## Validation Entry Point

Select the implementation leaf first, then select the applicable leaf from [Quality](./quality/index.md).
