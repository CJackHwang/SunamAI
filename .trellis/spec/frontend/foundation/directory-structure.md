# Directory Structure

## Applicability

Read this leaf when adding, moving, naming, or exposing source and test files.

## Required Behavior

### Layered source tree

```text
src/
├── shared/       browser-safe utilities, API adapters, contracts, i18n, common UI
├── entities/     domain types, workspace state, resources, sunam-v3 persistence
├── features/     independently owned use cases and runtime implementations
├── widgets/      cross-feature composition such as Workspace and Sidebar
├── pages/        page-level orchestration
└── app/          application providers, startup, global styles, fonts
```

The enforced dependency direction is `shared → entities → features → widgets → pages → app`. `scripts/check-architecture.mjs` resolves `@/` and relative imports and fails the gate on reverse imports or feature-to-feature internal imports.

### Ownership rules

- Put vendor-neutral interfaces in `src/shared/contracts`. Examples: `agentRuntime.ts`, `message.ts`, and `terminal.ts`.
- Put domain records and their persistence in `src/entities`. The v3 schema, record stores, repositories, sanitizer, and database all live in `src/entities/persistence`.
- Put WebContainer file/process/snapshot behavior only in `src/features/runtime`. Terminal UI does not own Agent runtime behavior.
- Put Agent execution, tools, context compaction, resources, and child coordination in `src/features/agent-core`.
- Put cross-feature screens in `src/widgets`. `src/widgets/workspace/Workspace.tsx` composes chat, Agent Core, runtime, session title generation, and terminal UI.
- Put tests in `tests/unit`, `tests/component`, `tests/e2e`, `tests/visual`, or `tests/runtime` according to the boundary being proved.

### Module boundaries

Prefer a feature's public entry when one exists. A feature must not import a path under another feature to reuse an internal type or helper. If two features need the same contract, move the minimal contract to `shared/contracts` or an entity. If they need coordinated UI behavior, compose them in a widget.

Avoid generic dumping grounds. A helper belongs in `shared` only when it has no business-layer dependency. Persistence-specific helpers remain with persistence; Agent-only token and transcript logic remains with Agent Core.

### Naming and file placement

- React components and their files use PascalCase: `ChatMessage.tsx`, `WorkspaceRuntimeProvider.tsx`.
- Hooks use `useXxx`: `useAgentV2.ts`, `useWorkspaceStore.ts`, `useFileSystem.ts`.
- Services, stores, repositories, contracts, and utilities use descriptive camelCase file names.
- Component CSS is colocated with the owning component or widget and imported by that component.
- Test names mirror the behavior/module they prove; runtime and browser scenarios stay out of unit-test folders.
- Keep historical names only when changing them would create more migration risk than value. For example, `useAgentV2` is a historical file name, while the active database is explicitly v3.

### Reference implementations

- Layer policy: `scripts/check-architecture.mjs`
- Cross-feature composition: `src/widgets/workspace/Workspace.tsx`
- Runtime ownership: `src/features/runtime/WebContainerAgentRuntime.ts`
- Persistence ownership: `src/entities/persistence/v3Repository.ts`
- Shared boundary: `src/shared/contracts/agentRuntime.ts`

## Forbidden Behavior

- Do not reintroduce deleted `src/shared/persistence/v2*` modules, terminal-owned runtime implementations, or feature-internal type imports.
- Do not use `shared` as a dumping ground for business-layer helpers.
- Do not place runtime/browser scenarios in unit-test folders.

## Required Validation

- Run architecture checks after file moves/import changes.
- Confirm public entry points and test placement match the owning boundary.

## Related Contracts

- [Architecture and boundaries](./architecture-and-boundaries.md)
- [Type safety](./type-safety.md)
- [Test strategy](../quality/test-strategy.md)
