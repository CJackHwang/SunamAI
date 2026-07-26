# Architecture and Boundaries

## Enforced graph

`shared → entities → features → widgets → pages → app` is a build rule, not a diagram-only preference.

- `shared` cannot depend on business entities or UI features.
- `entities` can depend on shared contracts/utilities but not features or React composition.
- `features` can depend on shared and entities. One feature cannot penetrate another feature's internal files.
- `widgets` are the first layer allowed to compose multiple features.
- `pages` and `app` orchestrate higher-level UI and providers; lower layers never import them.

Run `npm run check:architecture` when moving files or changing imports. Never “fix” a violation by adding an allow-list exception without documenting a real architectural reason.

## Runtime boundaries

`AgentWorkspaceRuntime` in `src/shared/contracts/agentRuntime.ts` is the only boundary between Agent Core and WebContainer behavior. Agent Core must not import `@webcontainer/api`, terminal components, or concrete runtime classes.

`AgentModelClient` owns provider capabilities, context profiles, token estimation, wire content mapping, streaming, and usage. Provider-specific conditions do not belong in `AgentEngine`.

`V3PersistenceRepository` owns durable records. React components and Agent tools do not open IndexedDB directly.

## Cross-cutting changes

When adding a model provider, implement/extend an adapter rather than branching inside the engine. When adding a resource type, implement a processor rather than teaching the engine MIME details. When adding a cross-feature interaction, introduce a small shared contract or compose it in a widget.

Workspace file writes are a security and correctness boundary. Every path goes through `getContainerRoot` / `resolveContainerPath`; every Agent mutation goes through the container mutation lease and advances the real workspace revision.

## Anti-patterns

- Importing `src/features/<other-feature>/internal-file` from a feature.
- Moving runtime behavior into terminal UI because the terminal happens to display it.
- Calling IndexedDB from components as a shortcut around repositories.
- Adding vendor checks to `AgentEngine`.
- Constructing container paths with string concatenation outside path helpers.
- Adding “temporary” architecture exceptions that are not tested or documented.

Evidence: `docs/architecture.md`, `scripts/check-architecture.mjs`, `src/features/agent-core/engine.ts`, `src/shared/contracts/agentRuntime.ts`, and `src/widgets/workspace/Workspace.tsx`.
